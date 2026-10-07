import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import {
  calculateProteinTarget,
  emptyNutrients,
  localDateKey,
  localDateToUtc,
  nextLocalDate,
  nextWorkoutDay,
  scaleNutrients,
  shouldSuggestIncrease,
  sumNutrients,
  volume,
  type Nutrients,
  type ProteinTargetMode,
} from "./domain.js";
import { createNutritionPhotoRouter } from "./nutrition/photo-routes.js";
import { PrivateFoodPhotoStore } from "./nutrition/food-image.js";

const prisma = new PrismaClient();
const app = express();
const nutritionPhotoStore = new PrivateFoodPhotoStore();
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must be at least 32 characters");
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: false,
    // Google Identity Services returns the OAuth token to its opener. The
    // default `same-origin` policy severs that relationship for the Google
    // popup, leaving the login page waiting forever after account selection.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  }),
);
app.use(
  cors({ origin: process.env.ORIGIN?.split(",") || false, credentials: true }),
);
app.use(express.json({ limit: "1mb" }));
app.use((pinoHttp as any)({
  enabled: process.env.NODE_ENV !== "test",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-kirfit-device",
    ],
    censor: "[Redacted]",
  },
}));
const asyncRoute =
  (fn: (req: any, res: any, next: any) => any) =>
  (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);
const auth = asyncRoute(async (req: any, res: any, next: any) => {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try {
    req.auth = jwt.verify(token, secret);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid session" });
  }
});
const nutritionPhotoAuth = asyncRoute(async (req: any, res: any, next: any) => {
  const bearer = req.headers.authorization?.replace(/^Bearer /, "");
  if (bearer) {
    try {
      req.auth = jwt.verify(bearer, secret);
      return next();
    } catch {
      return res.status(401).json({ error: "Invalid token" });
    }
  }
  const device = String(req.headers["x-kirfit-device"] || "");
  if (!/^[0-9a-f-]{20,80}$/i.test(device))
    return res.status(401).json({ error: "Authentication required" });
  req.auth = {
    sub: `guest-${createHash("sha256")
      .update(`${req.ip}\0${device}`)
      .digest("hex")}`,
    guest: true,
  };
  return next();
});
const userId = (req: any) => req.auth.sub as string;

const rpName = "Kir Fit";
const expectedOrigins = process.env.ORIGIN?.split(",").filter(Boolean) || [
  "http://localhost:5173",
];
const expectedOrigin =
  expectedOrigins.length === 1 ? expectedOrigins[0] : expectedOrigins;
const rpID = process.env.RP_ID || new URL(expectedOrigins[0]).hostname;
const passkeyChallengeLifetimeMs = 5 * 60_000;

const num = (v: any) => Number(v);
const decimal = (value: number) => new Prisma.Decimal(value);
const nutritionSettingsSchema = z.object({
  heightCm: z.number().int().min(100, "height_cm_too_low").max(250, "height_cm_too_high").nullable().optional(),
  goalWeightKg: z.number().min(30, "goal_weight_too_low").max(500, "goal_weight_too_high").nullable().optional(),
  proteinTargetMode: z.enum(["automatic", "manual"]).optional(),
  manualProteinTargetGrams: z.number().int().min(20, "protein_target_too_low").max(400, "protein_target_too_high").nullable().optional(),
}).strict();
const nutrientSchema = z.object({
  calories: z.number().nonnegative().max(100_000),
  proteinGrams: z.number().nonnegative().max(10_000),
  fatGrams: z.number().nonnegative().max(10_000),
  carbsGrams: z.number().nonnegative().max(10_000),
  fiberGrams: z.number().nonnegative().max(10_000),
}).strict();
const nutritionItemSchema = nutrientSchema.extend({
  name: z.string().trim().min(1).max(120),
  amountGrams: z.number().nonnegative().max(100_000).nullable().optional(),
});
const entryFieldsSchema = z.object({
  occurredAt: z.string().datetime({ offset: true }),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]).nullable().optional(),
  title: z.string().trim().max(160).nullable().optional(),
  consumedPercent: z.number().min(0).max(100),
  items: z.array(nutritionItemSchema).min(1).max(50),
}).strict();
const createEntrySchema = entryFieldsSchema.extend({
  analysisId: z.string().uuid().optional(),
});
const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "invalid_local_date");

function validTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
const timeZoneSchema = z.string().min(1).max(100).refine(validTimeZone, "invalid_timezone");

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, version: process.env.APP_VERSION || "dev" }),
);
app.post(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  asyncRoute(async (req, res) => {
    const body = z
      .object({ username: z.string().min(1), password: z.string().min(1) })
      .parse(req.body);
    const user = await prisma.user.findUnique({
      where: { username: body.username },
    });
    if (
      !user?.passwordHash ||
      !(await bcrypt.compare(body.password, user.passwordHash))
    )
      return res.status(401).json({ error: "Invalid login" });
    res.json(authResponse(user));
  }),
);
app.post(
  "/api/auth/google",
  rateLimit({ windowMs: 15 * 60_000, limit: 30 }),
  asyncRoute(async (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId)
      return res
        .status(503)
        .json({ error: "Google sign-in is not configured" });
    const body = z
      .union([
        z.object({ credential: z.string().min(20) }),
        z.object({ accessToken: z.string().min(20) }),
      ])
      .parse(req.body);
    let p: any;
    if ("credential" in body) {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({
        idToken: body.credential,
        audience: clientId,
      });
      p = ticket.getPayload();
    } else {
      const [tokenResponse, userResponse] = await Promise.all([
        fetch(
          `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(body.accessToken)}`,
        ),
        fetch("https://openidconnect.googleapis.com/v1/userinfo", {
          headers: { Authorization: `Bearer ${body.accessToken}` },
        }),
      ]);
      if (!tokenResponse.ok || !userResponse.ok)
        return res
          .status(401)
          .json({ error: "Google account could not be verified" });
      const tokenInfo: any = await tokenResponse.json();
      if (tokenInfo.aud !== clientId)
        return res
          .status(401)
          .json({ error: "Google token belongs to another application" });
      p = await userResponse.json();
    }
    if (!p?.sub || !p.email || p.email_verified === false)
      return res
        .status(401)
        .json({ error: "Google account could not be verified" });
    let user = await prisma.user.findFirst({
      where: { OR: [{ googleSub: p.sub }, { email: p.email }] },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          username: `google-${p.sub}`,
          googleSub: p.sub,
          email: p.email,
          displayName: p.name || p.email.split("@")[0],
        },
      });
      await provisionStarterProgram(user.id);
    } else if (!user.googleSub)
      user = await prisma.user.update({
        where: { id: user.id },
        data: { googleSub: p.sub, email: p.email },
      });
    res.json(authResponse(user));
  }),
);

app.post(
  "/api/auth/webauthn/register-options",
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  asyncRoute(async (_req, res) => {
    await prisma.passkeyChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const userHandle = randomBytes(32).toString("base64url");
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(userHandle, "base64url"),
      userName: `passkey-${userHandle.slice(0, 12)}`,
      userDisplayName: rpName,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
    });
    const ceremony = await prisma.passkeyChallenge.create({
      data: {
        challenge: options.challenge,
        purpose: "register",
        userHandle,
        expiresAt: new Date(Date.now() + passkeyChallengeLifetimeMs),
      },
    });
    res.json({ options, ceremonyId: ceremony.id });
  }),
);

app.post(
  "/api/auth/webauthn/register-verify",
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  asyncRoute(async (req, res) => {
    const body = z
      .object({ ceremonyId: z.string().min(1), response: z.unknown() })
      .parse(req.body);
    const ceremony = await consumePasskeyChallenge(body.ceremonyId, "register");
    if (!ceremony.userHandle)
      return res.status(400).json({ error: "Invalid registration state" });
    const registrationResponse = body.response as any;
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: ceremony.challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo)
      return res.status(400).json({ error: "Verification failed" });

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    const user = await prisma.user.create({
      data: {
        username: `passkey-${ceremony.userHandle}`,
        displayName: "",
        authenticators: {
          create: {
            credentialID: credential.id,
            credentialPublicKey: Buffer.from(credential.publicKey),
            counter: BigInt(credential.counter),
            credentialDeviceType,
            credentialBackedUp,
            transports: registrationResponse.response?.transports?.join(","),
          },
        },
      },
    });
    try {
      await provisionStarterProgram(user.id);
    } catch (error) {
      await prisma.user.delete({ where: { id: user.id } });
      throw error;
    }
    res.json({ ...authResponse(user), needsDisplayName: true });
  }),
);

app.post(
  "/api/auth/webauthn/login-options",
  rateLimit({ windowMs: 15 * 60_000, limit: 20 }),
  asyncRoute(async (_req, res) => {
    await prisma.passkeyChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: "required",
    });
    const ceremony = await prisma.passkeyChallenge.create({
      data: {
        challenge: options.challenge,
        purpose: "login",
        expiresAt: new Date(Date.now() + passkeyChallengeLifetimeMs),
      },
    });
    res.json({ options, ceremonyId: ceremony.id });
  }),
);

app.post(
  "/api/auth/webauthn/login-verify",
  rateLimit({ windowMs: 15 * 60_000, limit: 20 }),
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        ceremonyId: z.string().min(1),
        response: z.object({ id: z.string().min(1) }).passthrough(),
      })
      .parse(req.body);
    const ceremony = await consumePasskeyChallenge(body.ceremonyId, "login");
    const authenticator = await prisma.authenticator.findUnique({
      where: { credentialID: body.response.id },
      include: { user: true },
    });
    if (!authenticator)
      return res.status(400).json({ error: "Authenticator not found" });
    const verification = await verifyAuthenticationResponse({
      response: body.response as any,
      expectedChallenge: ceremony.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: authenticator.credentialID,
        publicKey: Uint8Array.from(authenticator.credentialPublicKey),
        counter: Number(authenticator.counter),
        transports: authenticator.transports
          ? (authenticator.transports.split(",") as any)
          : undefined,
      },
    });
    if (!verification.verified)
      return res.status(400).json({ error: "Verification failed" });
    await prisma.authenticator.update({
      where: { id: authenticator.id },
      data: { counter: BigInt(verification.authenticationInfo.newCounter) },
    });
    res.json(authResponse(authenticator.user));
  }),
);

app.patch(
  "/api/settings/profile",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({ displayName: z.string().trim().min(1).max(80).optional() })
      .extend(nutritionSettingsSchema.shape)
      .strict()
      .refine((value) => Object.keys(value).length > 0, "empty_profile_patch")
      .parse(req.body);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: userId(req) },
    });
    validateEffectiveNutritionSettings(current, body);
    const user = await prisma.user.update({
      where: { id: userId(req) },
      data: {
        ...body,
        goalWeightKg:
          body.goalWeightKg === undefined
            ? undefined
            : body.goalWeightKg === null
              ? null
              : decimal(body.goalWeightKg),
      },
    });
    res.json({
      displayName: user.displayName,
      ...(await nutritionProfileResponse(userId(req), user)),
    });
  }),
);

app.get(
  "/api/settings/profile",
  auth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId(req) },
      select: {
        displayName: true,
        heightCm: true,
        startingWeightKg: true,
        goalWeightKg: true,
        proteinTargetMode: true,
        manualProteinTargetGrams: true,
        googleSub: true,
        _count: { select: { authenticators: true } },
      },
    });
    res.json({
      displayName: user.displayName,
      ...(await nutritionProfileResponse(userId(req), user)),
      googleLinked: Boolean(user.googleSub),
      hasPasskey: user._count.authenticators > 0,
    });
  }),
);

app.get(
  "/api/settings/nutrition",
  auth,
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId(req) },
      select: {
        heightCm: true,
        startingWeightKg: true,
        goalWeightKg: true,
        proteinTargetMode: true,
        manualProteinTargetGrams: true,
      },
    });
    res.json(await nutritionProfileResponse(userId(req), user));
  }),
);

app.patch(
  "/api/settings/nutrition",
  auth,
  asyncRoute(async (req, res) => {
    const body = nutritionSettingsSchema
      .refine((value) => Object.keys(value).length > 0, "empty_nutrition_patch")
      .parse(req.body);
    const current = await prisma.user.findUniqueOrThrow({
      where: { id: userId(req) },
    });
    validateEffectiveNutritionSettings(current, body);
    const user = await prisma.user.update({
      where: { id: userId(req) },
      data: {
        ...body,
        goalWeightKg:
          body.goalWeightKg === undefined
            ? undefined
            : body.goalWeightKg === null
              ? null
              : decimal(body.goalWeightKg),
      },
    });
    res.json(await nutritionProfileResponse(userId(req), user));
  }),
);

app.post(
  "/api/settings/passkeys/register-options",
  auth,
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  asyncRoute(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: userId(req) },
      include: { authenticators: true },
    });
    if (!user.googleSub)
      return res.status(400).json({ error: "Google account required" });
    if (user.authenticators.length)
      return res.status(409).json({ error: "A passkey is already registered" });

    await prisma.passkeyChallenge.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: Buffer.from(user.id),
      userName: user.email || user.username,
      userDisplayName: user.displayName || user.email || user.username,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required",
      },
    });
    const ceremony = await prisma.passkeyChallenge.create({
      data: {
        challenge: options.challenge,
        purpose: "link-passkey",
        userHandle: user.id,
        expiresAt: new Date(Date.now() + passkeyChallengeLifetimeMs),
      },
    });
    res.json({ options, ceremonyId: ceremony.id });
  }),
);

app.post(
  "/api/settings/passkeys/register-verify",
  auth,
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  asyncRoute(async (req, res) => {
    const body = z
      .object({ ceremonyId: z.string().min(1), response: z.unknown() })
      .parse(req.body);
    const uid = userId(req);
    const ceremony = await consumePasskeyChallenge(
      body.ceremonyId,
      "link-passkey",
    );
    if (ceremony.userHandle !== uid)
      return res.status(400).json({ error: "Invalid registration state" });

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: uid },
      include: { authenticators: true },
    });
    if (!user.googleSub)
      return res.status(400).json({ error: "Google account required" });
    if (user.authenticators.length)
      return res.status(409).json({ error: "A passkey is already registered" });

    const registrationResponse = body.response as any;
    const verification = await verifyRegistrationResponse({
      response: registrationResponse,
      expectedChallenge: ceremony.challenge,
      expectedOrigin,
      expectedRPID: rpID,
    });
    if (!verification.verified || !verification.registrationInfo)
      return res.status(400).json({ error: "Verification failed" });

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    await prisma.authenticator.create({
      data: {
        userId: uid,
        credentialID: credential.id,
        credentialPublicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        credentialDeviceType,
        credentialBackedUp,
        transports: registrationResponse.response?.transports?.join(","),
      },
    });
    res.json({ hasPasskey: true });
  }),
);

app.get(
  "/api/dashboard",
  auth,
  asyncRoute(async (req, res) => {
    const uid = userId(req);
    const program = await prisma.workoutProgram.findFirst({
      where: { userId: uid, active: true },
      include: { templates: true },
    });
    const last = await prisma.workoutSession.findFirst({
      where: { userId: uid, status: "completed" },
      orderBy: { finishedAt: "desc" },
      include: { exercises: { include: { sets: true, exercise: true } } },
    });
    const weights = await prisma.bodyWeightEntry.findMany({
      where: { userId: uid },
      orderBy: { date: "asc" },
    });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    const achievements =
      last?.exercises
        .flatMap((x) =>
          shouldSuggestIncrease(x.sets, x.plannedSets, x.maxReps)
            ? [
                `${x.exercise.nameEn}: ${x.maxReps}/${x.maxReps}/${x.maxReps} reached`,
              ]
            : [],
        )
        .slice(0, 3) || [];
    res.json({
      displayName: u.displayName,
      nextWorkout: program
        ? nextWorkoutDay(new Date(), program.preferredWeekdays)
        : null,
      template: program?.templates[0] || null,
      last: last ? sessionSummary(last) : null,
      currentWeight: weights.at(-1) ? num(weights.at(-1)!.weight) : null,
      weightChange:
        weights.at(-1) && u.startingWeightKg
          ? num(weights.at(-1)!.weight) - num(u.startingWeightKg)
          : null,
      achievements,
    });
  }),
);

app.get(
  "/api/settings/program",
  auth,
  asyncRoute(async (req, res) => {
    const program = await prisma.workoutProgram.findFirstOrThrow({
      where: { userId: userId(req), active: true },
    });
    res.json({ preferredWeekdays: program.preferredWeekdays });
  }),
);

app.patch(
  "/api/settings/program",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        preferredWeekdays: z
          .array(z.number().int().min(0).max(6))
          .min(1)
          .max(7)
          .refine((days) => new Set(days).size === days.length),
      })
      .parse(req.body);
    const program = await prisma.workoutProgram.findFirstOrThrow({
      where: { userId: userId(req), active: true },
    });
    const updated = await prisma.workoutProgram.update({
      where: { id: program.id },
      data: { preferredWeekdays: body.preferredWeekdays },
    });
    res.json({ preferredWeekdays: updated.preferredWeekdays });
  }),
);

app.get(
  "/api/workouts/active",
  auth,
  asyncRoute(async (req, res) => {
    const session = await prisma.workoutSession.findFirst({
      where: { userId: userId(req), status: "active" },
      orderBy: { startedAt: "desc" },
      include: sessionInclude,
    });
    res.json(session ? serializeSession(session) : null);
  }),
);
app.post(
  "/api/workouts/start",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        templateId: z.string(),
        clientMutationId: z.string().uuid(),
        introWeeks: z.boolean().optional(),
      })
      .parse(req.body);
    const existing = await prisma.workoutSession.findUnique({
      where: { clientMutationId: body.clientMutationId },
      include: sessionInclude,
    });
    if (existing) return res.json(serializeSession(existing));
    const template = await prisma.workoutTemplate.findFirstOrThrow({
      where: { id: body.templateId, program: { userId: userId(req) } },
      include: {
        exercises: {
          orderBy: { sortOrder: "asc" },
          include: {
            exercise: {
              include: {
                images: true,
                machines: { where: { userId: userId(req), archived: false } },
              },
            },
          },
        },
      },
    });
    const previousInputs = new Map(
      await Promise.all(
        template.exercises.map(async (templateExercise) => {
          const previousExercise = await prisma.workoutExercise.findFirst({
            where: {
              exerciseId: templateExercise.exerciseId,
              session: {
                userId: userId(req),
                status: "completed",
              },
              sets: { some: {} },
            },
            orderBy: { session: { finishedAt: "desc" } },
            include: {
              sets: {
                orderBy: [{ completedAt: "desc" }, { setNumber: "desc" }],
                take: 1,
              },
            },
          });
          const previousSet = previousExercise?.sets[0];
          return [
            templateExercise.exerciseId,
            previousSet
              ? {
                  weight: previousSet.weight,
                  reps: previousSet.reps,
                  rir: previousSet.rir,
                }
              : null,
          ] as const;
        }),
      ),
    );
    const session = await prisma.workoutSession.create({
      data: {
        userId: userId(req),
        templateId: template.id,
        clientMutationId: body.clientMutationId,
        exercises: {
          create: template.exercises.map((t) => {
            const previous = previousInputs.get(t.exerciseId);
            return {
              exerciseId: t.exerciseId,
              sortOrder: t.sortOrder,
              plannedSets:
                body.introWeeks && t.exercise.exerciseType === "compound"
                  ? Math.min(2, t.sets)
                  : t.sets,
              minReps: t.minReps,
              maxReps: t.maxReps,
              restSeconds: t.restSeconds,
              increment: t.increment,
              measurementUnit: t.measurementUnit,
              customName: t.customName,
              notes: t.notes,
              lastWeight: previous?.weight ?? null,
              lastReps: previous?.reps ?? null,
              lastRir: previous?.rir ?? null,
              exerciseNameSnapshot: t.exercise.nameEn,
              machineId: t.exercise.machines[0]?.id,
              machineSettingsSnapshot: t.exercise.machines[0]
                ? {
                    seat: t.exercise.machines[0].seatSetting,
                    backrest: t.exercise.machines[0].backrestSetting,
                  }
                : undefined,
            };
          }),
        },
      },
      include: sessionInclude,
    });
    res.status(201).json(serializeSession(session));
  }),
);
app.post(
  "/api/workouts/:sessionId/sets",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        workoutExerciseId: z.string(),
        setNumber: z.number().int().positive(),
        weight: z.number().nonnegative().max(1000),
        reps: z.number().int().positive().max(100),
        rir: z.number().int().min(0).max(4).nullable().optional(),
        clientMutationId: z.string().uuid(),
      })
      .parse(req.body);
    const weight = new Prisma.Decimal(body.weight);
    const rir = body.rir ?? null;
    const saveSet = () =>
      prisma.$transaction(async (tx) => {
        const ex = await tx.workoutExercise.findFirstOrThrow({
          where: {
            id: body.workoutExerciseId,
            sessionId: req.params.sessionId,
            session: { userId: userId(req), status: "active" },
          },
          include: { session: true },
        });
        const existing =
          (await tx.workoutSet.findUnique({
            where: { clientMutationId: body.clientMutationId },
          })) ??
          (await tx.workoutSet.findUnique({
            where: {
              workoutExerciseId_setNumber: {
                workoutExerciseId: ex.id,
                setNumber: body.setNumber,
              },
            },
          }));
        if (existing) {
          if (
            existing.workoutExerciseId !== ex.id ||
            existing.setNumber !== body.setNumber ||
            !existing.weight.equals(weight) ||
            existing.reps !== body.reps ||
            (existing.rir ?? null) !== rir
          ) {
            throw Object.assign(
              new Error("A set with different values already exists for this set number or mutation ID"),
              { status: 409 },
            );
          }
          // Keep the original mutation ID and avoid replaying old last-set values.
          return existing;
        }
        const set = await tx.workoutSet.create({
          data: {
            workoutExerciseId: ex.id,
            setNumber: body.setNumber,
            weight,
            reps: body.reps,
            rir,
            clientMutationId: body.clientMutationId,
          },
        });
        await tx.workoutExercise.update({
          where: { id: ex.id },
          data: { lastWeight: weight, lastReps: body.reps, lastRir: rir },
        });
        await tx.workoutTemplateExercise.update({
          where: {
            templateId_exerciseId: {
              templateId: ex.session.templateId,
              exerciseId: ex.exerciseId,
            },
          },
          data: { lastWeight: weight, lastReps: body.reps, lastRir: rir },
        });
        return set;
      });
    let set;
    try {
      set = await saveSet();
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== "P2002"
      ) throw error;
      // A concurrent insert can win either unique key. PostgreSQL aborts the
      // failed transaction, so reconcile in a fresh transaction with auth checks.
      set = await saveSet();
    }
    res.status(201).json({ ...set, weight: num(set.weight) });
  }),
);
app.patch(
  "/api/workouts/:sessionId/exercises/:exerciseId/settings",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        plannedSets: z.number().int().min(1).max(20),
        restSeconds: z.number().int().min(30).max(600),
        increment: z.number().positive().max(100),
        measurementUnit: z.enum(["kg", "units"]),
        customName: z
          .string()
          .trim()
          .max(80)
          .transform((value) => value || null),
        notes: z
          .string()
          .trim()
          .max(1000)
          .transform((value) => value || null)
          .optional(),
      })
      .parse(req.body);
    const exercise = await prisma.workoutExercise.findFirstOrThrow({
      where: {
        id: req.params.exerciseId,
        sessionId: req.params.sessionId,
        session: { userId: userId(req), status: "active" },
      },
      include: { session: true },
    });
    await prisma.$transaction([
      prisma.workoutExercise.update({
        where: { id: exercise.id },
        data: body,
      }),
      prisma.workoutTemplateExercise.update({
        where: {
          templateId_exerciseId: {
            templateId: exercise.session.templateId,
            exerciseId: exercise.exerciseId,
          },
        },
        data: {
          sets: body.plannedSets,
          restSeconds: body.restSeconds,
          increment: new Prisma.Decimal(body.increment),
          measurementUnit: body.measurementUnit,
          customName: body.customName,
          ...(body.notes === undefined ? {} : { notes: body.notes }),
        },
      }),
    ]);
    const session = await prisma.workoutSession.findUniqueOrThrow({
      where: { id: exercise.sessionId },
      include: sessionInclude,
    });
    res.json(serializeSession(session));
  }),
);
app.delete(
  "/api/workouts/:sessionId/sets/:setId",
  auth,
  asyncRoute(async (req, res) => {
    await prisma.workoutSet.delete({
      where: {
        id: req.params.setId,
        workoutExercise: {
          sessionId: req.params.sessionId,
          session: { userId: userId(req), status: "active" },
        },
      },
    });
    res.status(204).end();
  }),
);
app.post(
  "/api/workouts/:id/finish",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({ notes: z.string().max(1000).optional() })
      .parse(req.body);
    const s = await prisma.workoutSession.update({
      where: { id: req.params.id, userId: userId(req), status: "active" },
      data: { status: "completed", finishedAt: new Date(), notes: body.notes },
      include: sessionInclude,
    });
    res.json(serializeSession(s));
  }),
);
app.post(
  "/api/workouts/:id/resume",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timezoneOffsetMinutes: z.number().int().min(-840).max(840),
      })
      .parse(req.body);
    const [year, month, day] = body.localDate.split("-").map(Number);
    const start = new Date(
      Date.UTC(year, month - 1, day) + body.timezoneOffsetMinutes * 60_000,
    );
    const end = new Date(start.getTime() + 24 * 60 * 60_000);
    const session = await prisma.workoutSession.findFirstOrThrow({
      where: {
        id: req.params.id,
        userId: userId(req),
        status: "completed",
        finishedAt: { gte: start, lt: end },
      },
    });
    const active = await prisma.workoutSession.findFirst({
      where: { userId: userId(req), status: "active" },
    });
    if (active)
      throw Object.assign(new Error("An active workout already exists"), {
        status: 409,
      });
    const resumed = await prisma.workoutSession.update({
      where: { id: session.id },
      data: { status: "active", finishedAt: null },
      include: sessionInclude,
    });
    res.json(serializeSession(resumed));
  }),
);
app.delete(
  "/api/workouts/:id/active",
  auth,
  asyncRoute(async (req, res) => {
    await prisma.workoutSession.delete({
      where: {
        id: req.params.id,
        userId: userId(req),
        status: "active",
      },
    });
    res.status(204).end();
  }),
);
app.delete(
  "/api/workouts/:id",
  auth,
  asyncRoute(async (req, res) => {
    await prisma.workoutSession.delete({
      where: {
        id: req.params.id,
        userId: userId(req),
        status: "completed",
      },
    });
    res.status(204).end();
  }),
);
app.patch(
  "/api/sets/:id",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        weight: z.number().nonnegative().max(1000),
        reps: z.number().int().positive().max(100),
        rir: z.number().int().min(0).max(4).nullable().optional(),
      })
      .parse(req.body);
    const set = await prisma.workoutSet.update({
      where: {
        id: req.params.id,
        workoutExercise: { session: { userId: userId(req) } },
      },
      data: {
        weight: new Prisma.Decimal(body.weight),
        reps: body.reps,
        rir: body.rir,
      },
    });
    res.json({ ...set, weight: num(set.weight) });
  }),
);

app.get(
  "/api/history",
  auth,
  asyncRoute(async (req, res) => {
    const rows = await prisma.workoutSession.findMany({
      where: { userId: userId(req), status: "completed" },
      orderBy: { finishedAt: "desc" },
      include: sessionInclude,
      take: 100,
    });
    res.json(rows.map(serializeSession));
  }),
);
app.get(
  "/api/exercises",
  auth,
  asyncRoute(async (req, res) => {
    const items = await prisma.exercise.findMany({
      where: { archived: false },
      orderBy: { nameEn: "asc" },
      include: {
        images: { orderBy: { sortOrder: "asc" } },
        machines: { where: { userId: userId(req), archived: false } },
      },
    });
    res.json(items.map(serializeExercise));
  }),
);
app.get(
  "/api/exercises/:id/progress",
  auth,
  asyncRoute(async (req, res) => {
    const rows = await prisma.workoutExercise.findMany({
      where: {
        exerciseId: req.params.id,
        session: { userId: userId(req), status: "completed" },
      },
      orderBy: { session: { finishedAt: "asc" } },
      include: { sets: true, session: true, exercise: true },
    });
    res.json({
      exercise:
        rows[0]?.exercise ||
        (await prisma.exercise.findUniqueOrThrow({
          where: { id: req.params.id },
        })),
      history: rows.map((r) => ({
        date: r.session.finishedAt,
        measurementUnit: r.measurementUnit,
        weight: Math.max(0, ...r.sets.map((s) => num(s.weight))),
        volume: volume(
          r.sets.map((s) => ({ weight: num(s.weight), reps: s.reps })),
        ),
        sets: r.sets.map((s) => ({ ...s, weight: num(s.weight) })),
      })),
    });
  }),
);

app.get(
  "/api/body-weight",
  auth,
  asyncRoute(async (req, res) => {
    const rows = await prisma.bodyWeightEntry.findMany({
      where: { userId: userId(req) },
      orderBy: { date: "asc" },
    });
    res.json(rows.map((x) => ({ ...x, weight: num(x.weight) })));
  }),
);
app.post(
  "/api/body-weight",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        date: z.string(),
        weight: z.number().positive().max(500),
        notes: z.string().max(500).optional(),
      })
      .parse(req.body);
    const date = new Date(body.date + "T12:00:00Z");
    const row = await prisma.bodyWeightEntry.upsert({
      where: { userId_date: { userId: userId(req), date } },
      update: { weight: new Prisma.Decimal(body.weight), notes: body.notes },
      create: {
        userId: userId(req),
        date,
        weight: new Prisma.Decimal(body.weight),
        notes: body.notes,
      },
    });
    res.status(201).json({ ...row, weight: num(row.weight) });
  }),
);

app.post(
  "/api/nutrition/entries",
  auth,
  asyncRoute(async (req, res) => {
    const body = createEntrySchema.parse(req.body);
    const occurredAt = new Date(body.occurredAt);
    validateNutritionDate(occurredAt);
    const full = sumNutrients(body.items);
    const scaled = scaleNutrients(full, body.consumedPercent);
    const photoManifest = body.analysisId
      ? await nutritionPhotoStore.requireOwned(body.analysisId, userId(req))
      : null;
    if (photoManifest?.status === "processing")
      throw Object.assign(new Error("nutrition_analysis_still_processing"), {
        status: 409,
      });
    if (photoManifest?.status === "completed" && !photoManifest.result)
      throw Object.assign(new Error("nutrition_analysis_result_missing"), {
        status: 409,
      });
    const thumbnailBytes = photoManifest?.thumbnailFile
      ? await nutritionPhotoStore.thumbnail(photoManifest.analysisId, userId(req))
      : null;
    const analysisResult = photoManifest?.result as any;
    const providerMetadata = photoManifest?.providerMetadata as any;
    const entry = await prisma.nutritionEntry.create({
      data: {
        userId: userId(req),
        occurredAt,
        mealType: body.mealType,
        title: body.title,
        consumedPercent: decimal(body.consumedPercent),
        ...nutrientDatabaseFields(full, "full"),
        ...nutrientDatabaseFields(scaled),
        items: {
          create: body.items.map((item, index) => ({
            name: item.name,
            amountGrams:
              item.amountGrams === undefined || item.amountGrams === null
                ? null
                : decimal(item.amountGrams),
            ...nutrientDatabaseFields(item),
            sortOrder: index,
          })),
        },
        photo: photoManifest
          ? {
              create: {
                storageKey: photoManifest.analysisId,
                thumbnailStorageKey: thumbnailBytes
                  ? photoManifest.analysisId
                  : null,
                mimeType: "image/jpeg",
                sizeBytes: thumbnailBytes?.byteLength ?? 0,
                sha256: thumbnailBytes
                  ? createHash("sha256").update(thumbnailBytes).digest("hex")
                  : null,
                originalDeletedAt: new Date(),
              },
            }
          : undefined,
        analysis: photoManifest
          ? {
              create: {
                state: photoManifest.status,
                provider: providerMetadata?.provider ?? null,
                model: providerMetadata?.model ?? null,
                schemaVersion: providerMetadata?.schemaVersion ?? null,
                assumptions: analysisResult?.assumptions ?? undefined,
                uncertainty: analysisResult
                  ? {
                      overallConfidence: analysisResult.overallConfidence,
                      alternatives: analysisResult.alternatives ?? [],
                      totals: analysisResult.totals ?? null,
                    }
                  : undefined,
                analyzedAt:
                  photoManifest.status === "completed" ? new Date() : null,
                clarifications: analysisResult?.clarificationQuestions?.length
                  ? {
                      create: analysisResult.clarificationQuestions.map(
                        (question: any) => ({
                          questionKey: question.id,
                          question: question.question,
                          options: question.options ?? [],
                          required: question.required ?? true,
                        }),
                      ),
                    }
                  : undefined,
              },
            }
          : undefined,
      },
      include: nutritionEntryInclude,
    });
    if (photoManifest) {
      await nutritionPhotoStore.update(photoManifest.analysisId, userId(req), {
        expiresAt: new Date("9999-12-31T23:59:59.999Z").toISOString(),
        finalizedAt: new Date().toISOString(),
      });
    }
    res.status(201).json(serializeNutritionEntry(entry));
  }),
);

app.get(
  "/api/nutrition/entries/:id",
  auth,
  asyncRoute(async (req, res) => {
    const entry = await prisma.nutritionEntry.findFirstOrThrow({
      where: { id: req.params.id, userId: userId(req) },
      include: nutritionEntryInclude,
    });
    res.json(serializeNutritionEntry(entry));
  }),
);

app.patch(
  "/api/nutrition/entries/:id",
  auth,
  asyncRoute(async (req, res) => {
    const body = entryFieldsSchema.partial().strict()
      .refine((value) => Object.keys(value).length > 0, "empty_entry_patch")
      .parse(req.body);
    const existing = await prisma.nutritionEntry.findFirstOrThrow({
      where: { id: req.params.id, userId: userId(req) },
      include: { items: true },
    });
    const occurredAt = body.occurredAt
      ? new Date(body.occurredAt)
      : existing.occurredAt;
    validateNutritionDate(occurredAt);
    const items = body.items ?? existing.items.map(serializeNutritionItem);
    const full = sumNutrients(items);
    const consumedPercent = body.consumedPercent ?? num(existing.consumedPercent);
    const scaled = scaleNutrients(full, consumedPercent);
    const entry = await prisma.$transaction(async (tx) => {
      if (body.items) {
        await tx.nutritionItem.deleteMany({ where: { entryId: existing.id } });
      }
      return tx.nutritionEntry.update({
        where: { id: existing.id, userId: userId(req) },
        data: {
          occurredAt,
          mealType: body.mealType,
          title: body.title,
          consumedPercent: decimal(consumedPercent),
          ...nutrientDatabaseFields(full, "full"),
          ...nutrientDatabaseFields(scaled),
          items: body.items
            ? {
                create: body.items.map((item, index) => ({
                  name: item.name,
                  amountGrams:
                    item.amountGrams === undefined || item.amountGrams === null
                      ? null
                      : decimal(item.amountGrams),
                  ...nutrientDatabaseFields(item),
                  sortOrder: index,
                })),
              }
            : undefined,
        },
        include: nutritionEntryInclude,
      });
    });
    res.json(serializeNutritionEntry(entry));
  }),
);

app.delete(
  "/api/nutrition/entries/:id",
  auth,
  asyncRoute(async (req, res) => {
    const existing = await prisma.nutritionEntry.findFirstOrThrow({
      where: { id: req.params.id, userId: userId(req) },
      include: { photo: true },
    });
    await prisma.nutritionEntry.delete({
      where: { id: existing.id },
    });
    if (existing.photo?.storageKey) {
      await nutritionPhotoStore
        .remove(existing.photo.storageKey, userId(req))
        .catch(() => undefined);
    }
    res.status(204).end();
  }),
);

app.get(
  "/api/nutrition/entries",
  auth,
  asyncRoute(async (req, res) => {
    const query = z.object({
      from: localDateSchema,
      to: localDateSchema,
      timezone: timeZoneSchema,
    }).strict().parse(req.query);
    if (query.from > query.to)
      throw Object.assign(new Error("invalid_date_range"), { status: 400 });
    const start = localDateToUtc(query.from, query.timezone);
    const end = localDateToUtc(nextLocalDate(query.to), query.timezone);
    if (end.getTime() - start.getTime() > 367 * 24 * 60 * 60_000)
      throw Object.assign(new Error("date_range_too_large"), { status: 400 });
    const entries = await prisma.nutritionEntry.findMany({
      where: {
        userId: userId(req),
        occurredAt: { gte: start, lt: end },
      },
      orderBy: { occurredAt: "desc" },
      include: nutritionEntryInclude,
    });
    const days = new Map<string, any[]>();
    for (const entry of entries) {
      const key = localDateKey(entry.occurredAt, query.timezone);
      days.set(key, [...(days.get(key) ?? []), serializeNutritionEntry(entry)]);
    }
    res.json({
      from: query.from,
      to: query.to,
      timezone: query.timezone,
      days: [...days.entries()].map(([date, dayEntries]) => ({
        date,
        entries: dayEntries,
        totals: sumNutrients(dayEntries),
      })),
    });
  }),
);

app.get(
  "/api/nutrition/days/:date",
  auth,
  asyncRoute(async (req, res) => {
    const date = localDateSchema.parse(req.params.date);
    const { timezone } = z.object({ timezone: timeZoneSchema }).strict().parse(req.query);
    const start = localDateToUtc(date, timezone);
    const end = localDateToUtc(nextLocalDate(date), timezone);
    const [entries, profile] = await Promise.all([
      prisma.nutritionEntry.findMany({
        where: { userId: userId(req), occurredAt: { gte: start, lt: end } },
        orderBy: { occurredAt: "asc" },
        include: nutritionEntryInclude,
      }),
      nutritionProfileResponse(userId(req)),
    ]);
    const serialized = entries.map(serializeNutritionEntry);
    const totals = sumNutrients(serialized);
    const target = profile.calculation.targetGrams;
    const proteinPercent = target
      ? Math.round((totals.proteinGrams / target) * 1000) / 10
      : null;
    res.json({
      date,
      timezone,
      entries: serialized,
      totals,
      proteinTargetGrams: target,
      proteinPercent,
      proteinRemainingGrams:
        target === null ? null : Math.max(0, Math.round((target - totals.proteinGrams) * 100) / 100),
      proteinExcessGrams:
        target === null ? null : Math.max(0, Math.round((totals.proteinGrams - target) * 100) / 100),
    });
  }),
);

app.use(
  "/api/nutrition/photos",
  nutritionPhotoAuth,
  createNutritionPhotoRouter({
    ownerId: userId,
    store: nutritionPhotoStore,
    ephemeral: (request: any) => request.auth?.guest === true,
  }),
);

const uploads = path.resolve(process.env.UPLOAD_DIR || "/app/uploads");
fs.mkdirSync(uploads, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploads,
    filename: (_r, f, cb) =>
      cb(
        null,
        crypto.randomUUID() + path.extname(f.originalname).toLowerCase(),
      ),
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_r, f, cb) =>
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(f.mimetype)),
});
app.post(
  "/api/exercises/:id/images",
  auth,
  upload.single("image"),
  asyncRoute(async (req, res) => {
    if (!req.file)
      return res.status(400).json({ error: "Valid image required" });
    const ex = await prisma.exercise.findUniqueOrThrow({
      where: { id: req.params.id },
    });
    const count = await prisma.exerciseImage.count({
      where: { exerciseId: ex.id },
    });
    const row = await prisma.exerciseImage.create({
      data: {
        exerciseId: ex.id,
        path: "/uploads/" + req.file.filename,
        caption: String(req.body.caption || ""),
        sortOrder: count,
      },
    });
    res.status(201).json(row);
  }),
);
app.patch(
  "/api/exercises/:id",
  auth,
  asyncRoute(async (req, res) => {
    const body = z
      .object({
        nameEn: z.string().min(1).optional(),
        nameDe: z.string().min(1).optional(),
        userNotes: z.string().nullable().optional(),
        defaultSets: z.number().int().min(1).max(10).optional(),
        minReps: z.number().int().min(1).optional(),
        maxReps: z.number().int().max(100).optional(),
        defaultRestSeconds: z.number().int().min(30).max(600).optional(),
        defaultIncrement: z.number().positive().optional(),
        archived: z.boolean().optional(),
      })
      .parse(req.body);
    const row = await prisma.exercise.update({
      where: { id: req.params.id },
      data: {
        ...body,
        defaultIncrement:
          body.defaultIncrement === undefined
            ? undefined
            : new Prisma.Decimal(body.defaultIncrement),
      },
    });
    res.json(serializeExercise(row));
  }),
);

app.use(
  "/uploads",
  express.static(uploads, { maxAge: "1d", dotfiles: "deny" }),
);
const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "../../web/dist");
app.use(
  express.static(publicDir, {
    maxAge: "1h",
    setHeaders: (res, filePath) => {
      const fileName = path.basename(filePath);
      if (
        fileName === "index.html" ||
        fileName === "sw.js" ||
        fileName === "manifest.webmanifest"
      ) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  }),
);
app.get("/{*splat}", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return res.sendFile(path.join(publicDir, "index.html"));
});
app.use((err: any, _req: any, res: any, _next: any) => {
  _req.log?.error(err);
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: "Invalid input", details: err.issues });
  if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
  if (err.status) return res.status(err.status).json({ error: err.message });
  res.status(500).json({ error: "Unexpected server error" });
});
const port = Number(process.env.PORT || 3000);
const server =
  process.env.NODE_ENV === "test"
    ? null
    : app.listen(port, () => console.log(`kir-fit listening on ${port}`));
const stop = async () => {
  server?.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

export { app, prisma };

const sessionInclude = {
  template: true,
  exercises: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      exercise: {
        include: {
          images: { orderBy: { sortOrder: "asc" as const } },
          machines: true,
        },
      },
      machine: true,
      sets: { orderBy: { setNumber: "asc" as const } },
    },
  },
};
const nutritionEntryInclude = {
  items: { orderBy: { sortOrder: "asc" as const } },
  photo: true,
  analysis: { include: { clarifications: true } },
};

function validateEffectiveNutritionSettings(current: any, patch: any) {
  const mode = patch.proteinTargetMode ?? current.proteinTargetMode;
  const manual =
    patch.manualProteinTargetGrams === undefined
      ? current.manualProteinTargetGrams
      : patch.manualProteinTargetGrams;
  if (mode === "manual" && manual === null)
    throw Object.assign(new Error("manual_protein_target_required"), {
      status: 400,
    });
}

async function nutritionProfileResponse(uid: string, suppliedUser?: any) {
  const [user, latestWeight] = await Promise.all([
    suppliedUser
      ? Promise.resolve(suppliedUser)
      : prisma.user.findUniqueOrThrow({ where: { id: uid } }),
    prisma.bodyWeightEntry.findFirst({
      where: { userId: uid },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }),
  ]);
  const proteinTargetMode = user.proteinTargetMode as ProteinTargetMode;
  const calculation = calculateProteinTarget({
    heightCm: user.heightCm,
    currentWeightKg: latestWeight ? num(latestWeight.weight) : null,
    startingWeightKg:
      user.startingWeightKg === null ? null : num(user.startingWeightKg),
    goalWeightKg: user.goalWeightKg === null ? null : num(user.goalWeightKg),
    mode: proteinTargetMode,
    manualProteinTargetGrams: user.manualProteinTargetGrams,
  });
  return {
    heightCm: user.heightCm,
    startingWeightKg:
      user.startingWeightKg === null ? null : num(user.startingWeightKg),
    goalWeightKg: user.goalWeightKg === null ? null : num(user.goalWeightKg),
    proteinTargetMode,
    manualProteinTargetGrams: user.manualProteinTargetGrams,
    calculation,
    disclaimer: {
      code: "nutrition_estimate_not_medical_advice",
      clinicianReviewCode: "protein_restriction_or_kidney_disease_review",
    },
  };
}

function validateNutritionDate(date: Date) {
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() < 2000 ||
    date.getUTCFullYear() > 2100
  )
    throw Object.assign(new Error("invalid_nutrition_date"), { status: 400 });
}

type DatabaseNutrients = {
  calories: Prisma.Decimal;
  proteinGrams: Prisma.Decimal;
  fatGrams: Prisma.Decimal;
  carbsGrams: Prisma.Decimal;
  fiberGrams: Prisma.Decimal;
};
type FullDatabaseNutrients = {
  fullCalories: Prisma.Decimal;
  fullProteinGrams: Prisma.Decimal;
  fullFatGrams: Prisma.Decimal;
  fullCarbsGrams: Prisma.Decimal;
  fullFiberGrams: Prisma.Decimal;
};
function nutrientDatabaseFields(nutrients: Nutrients): DatabaseNutrients;
function nutrientDatabaseFields(
  nutrients: Nutrients,
  prefix: "full",
): FullDatabaseNutrients;
function nutrientDatabaseFields(
  nutrients: Nutrients,
  prefix: "" | "full" = "",
): DatabaseNutrients | FullDatabaseNutrients {
  const field = (name: string) =>
    prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
  return {
    [field("calories")]: decimal(nutrients.calories),
    [field("proteinGrams")]: decimal(nutrients.proteinGrams),
    [field("fatGrams")]: decimal(nutrients.fatGrams),
    [field("carbsGrams")]: decimal(nutrients.carbsGrams),
    [field("fiberGrams")]: decimal(nutrients.fiberGrams),
  } as DatabaseNutrients | FullDatabaseNutrients;
}

function serializeNutritionItem(item: any) {
  return {
    ...(item.id ? { id: item.id } : {}),
    name: item.name,
    amountGrams:
      item.amountGrams === undefined || item.amountGrams === null
        ? null
        : num(item.amountGrams),
    calories: num(item.calories),
    proteinGrams: num(item.proteinGrams),
    fatGrams: num(item.fatGrams),
    carbsGrams: num(item.carbsGrams),
    fiberGrams: num(item.fiberGrams),
    ...(item.sortOrder === undefined ? {} : { sortOrder: item.sortOrder }),
  };
}

function serializeNutritionEntry(entry: any) {
  return {
    id: entry.id,
    occurredAt: entry.occurredAt,
    mealType: entry.mealType,
    title: entry.title,
    consumedPercent: num(entry.consumedPercent),
    fullCalories: num(entry.fullCalories),
    fullProteinGrams: num(entry.fullProteinGrams),
    fullFatGrams: num(entry.fullFatGrams),
    fullCarbsGrams: num(entry.fullCarbsGrams),
    fullFiberGrams: num(entry.fullFiberGrams),
    calories: num(entry.calories),
    proteinGrams: num(entry.proteinGrams),
    fatGrams: num(entry.fatGrams),
    carbsGrams: num(entry.carbsGrams),
    fiberGrams: num(entry.fiberGrams),
    items: entry.items?.map(serializeNutritionItem) ?? [],
    photo: entry.photo
      ? {
          id: entry.photo.id,
          analysisId: entry.photo.storageKey,
          thumbnailUrl: entry.photo.thumbnailStorageKey
            ? `/api/nutrition/photos/${entry.photo.storageKey}/thumbnail`
            : null,
          mimeType: entry.photo.mimeType,
          sizeBytes: entry.photo.sizeBytes,
          width: entry.photo.width,
          height: entry.photo.height,
          originalDeletedAt: entry.photo.originalDeletedAt,
          createdAt: entry.photo.createdAt,
        }
      : null,
    analysis: entry.analysis ?? null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}
function serializeExercise(e: any) {
  return {
    ...e,
    defaultIncrement:
      e.defaultIncrement === undefined ? undefined : num(e.defaultIncrement),
    machines: e.machines?.map((m: any) => ({
      ...m,
      weightIncrement:
        m.weightIncrement === null ? null : num(m.weightIncrement),
      availableWeights: m.availableWeights.map(num),
    })),
  };
}
function serializeSession(s: any) {
  return {
    ...s,
    summary: sessionSummary(s),
    exercises: s.exercises.map((e: any) => ({
      ...e,
      increment: num(e.increment),
      lastWeight: e.lastWeight === null ? null : num(e.lastWeight),
      exercise: serializeExercise(e.exercise),
      sets: e.sets.map((x: any) => ({ ...x, weight: num(x.weight) })),
      suggestIncrease: shouldSuggestIncrease(e.sets, e.plannedSets, e.maxReps),
    })),
  };
}
function sessionSummary(s: any) {
  const sets = s.exercises.flatMap((e: any) => e.sets);
  return {
    durationMinutes: s.finishedAt
      ? Math.max(
          1,
          Math.round(
            (new Date(s.finishedAt).getTime() -
              new Date(s.startedAt).getTime()) /
              60000,
          ),
        )
      : null,
    exerciseCount: s.exercises.filter((e: any) => e.sets.length).length,
    setCount: sets.length,
    volume: volume(
      sets.map((x: any) => ({ weight: num(x.weight), reps: x.reps })),
    ),
  };
}
function authResponse(user: any) {
  return {
    token: jwt.sign({ sub: user.id, name: user.displayName }, secret!, {
      expiresIn: "30d",
    }),
    user: { name: user.displayName, email: user.email },
  };
}
async function consumePasskeyChallenge(id: string, purpose: string) {
  const ceremony = await prisma.passkeyChallenge.findUnique({ where: { id } });
  if (
    !ceremony ||
    ceremony.purpose !== purpose ||
    ceremony.expiresAt.getTime() < Date.now()
  )
    throw Object.assign(new Error("Invalid or expired passkey challenge"), {
      status: 400,
    });
  const consumed = await prisma.passkeyChallenge.deleteMany({
    where: { id, purpose },
  });
  if (consumed.count !== 1)
    throw Object.assign(new Error("Passkey challenge was already used"), {
      status: 400,
    });
  return ceremony;
}
async function provisionStarterProgram(uid: string) {
  const exercises = await prisma.exercise.findMany({
    where: { archived: false },
    orderBy: { createdAt: "asc" },
  });
  const program = await prisma.workoutProgram.create({
    data: {
      userId: uid,
      name: "Full Body 3× weekly",
      active: true,
      preferredWeekdays: [3, 5, 0],
    },
  });
  await prisma.workoutTemplate.create({
    data: {
      programId: program.id,
      name: "Full Body",
      exercises: {
        create: exercises.map((e, i) => ({
          exerciseId: e.id,
          sortOrder: i + 1,
          sets: e.defaultSets,
          minReps: e.minReps,
          maxReps: e.maxReps,
          restSeconds: e.defaultRestSeconds,
          increment: e.defaultIncrement,
        })),
      },
    },
  });
}
