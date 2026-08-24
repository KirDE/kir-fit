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
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { z } from "zod";
import { nextWorkoutDay, shouldSuggestIncrease, volume } from "./domain.js";

const prisma = new PrismaClient();
const app = express();
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32)
  throw new Error("JWT_SECRET must be at least 32 characters");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({ origin: process.env.ORIGIN?.split(",") || false, credentials: true }),
);
app.use(express.json({ limit: "1mb" }));
app.use((pinoHttp as any)());
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
const userId = (req: any) => req.auth.sub as string;
const num = (v: any) => Number(v);

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
    const session = await prisma.workoutSession.create({
      data: {
        userId: userId(req),
        templateId: template.id,
        clientMutationId: body.clientMutationId,
        exercises: {
          create: template.exercises.map((t) => ({
            exerciseId: t.exerciseId,
            sortOrder: t.sortOrder,
            plannedSets:
              body.introWeeks && t.exercise.exerciseType === "compound"
                ? Math.min(2, t.sets)
                : t.sets,
            minReps: t.minReps,
            maxReps: t.maxReps,
            restSeconds: t.restSeconds,
            exerciseNameSnapshot: t.exercise.nameEn,
            machineId: t.exercise.machines[0]?.id,
            machineSettingsSnapshot: t.exercise.machines[0]
              ? {
                  seat: t.exercise.machines[0].seatSetting,
                  backrest: t.exercise.machines[0].backrestSetting,
                }
              : undefined,
          })),
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
    const ex = await prisma.workoutExercise.findFirstOrThrow({
      where: {
        id: body.workoutExerciseId,
        sessionId: req.params.sessionId,
        session: { userId: userId(req), status: "active" },
      },
    });
    const set = await prisma.workoutSet.upsert({
      where: { clientMutationId: body.clientMutationId },
      update: {},
      create: {
        workoutExerciseId: ex.id,
        setNumber: body.setNumber,
        weight: new Prisma.Decimal(body.weight),
        reps: body.reps,
        rir: body.rir,
        clientMutationId: body.clientMutationId,
      },
    });
    res.status(201).json({ ...set, weight: num(set.weight) });
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
app.use(express.static(publicDir, { maxAge: "1h" }));
app.get("/{*splat}", (req, res, next) =>
  req.path.startsWith("/api/")
    ? next()
    : res.sendFile(path.join(publicDir, "index.html")),
);
app.use((err: any, _req: any, res: any, _next: any) => {
  _req.log?.error(err);
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({ error: "Invalid input", details: err.issues });
  if (err.code === "P2025") return res.status(404).json({ error: "Not found" });
  res.status(500).json({ error: "Unexpected server error" });
});
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () =>
  console.log(`kir-fit listening on ${port}`),
);
const stop = async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

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
