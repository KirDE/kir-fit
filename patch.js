const fs = require('fs');
let code = fs.readFileSync('apps/api/src/server.ts', 'utf8');

if (!code.includes('@simplewebauthn/server')) {
  code = code.replace('import { z } from "zod";', 'import { z } from "zod";\nimport { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";');
}

if (!code.includes('const rpName')) {
  code = code.replace('const userId = (req: any) => req.auth.sub as string;', 'const userId = (req: any) => req.auth.sub as string;\n\nconst rpName = "Kir Fit";\nconst rpID = process.env.RP_ID || "localhost";\nconst expectedOrigin = process.env.ORIGIN?.split(",")[0] || "http://localhost:5173";\n');
}

const passkeyRoutes = `
app.post("/api/auth/webauthn/register-options", rateLimit({ windowMs: 15 * 60_000, limit: 10 }), asyncRoute(async (req, res) => {
  const { username } = z.object({ username: z.string().min(2) }).parse(req.body);
  let user = await prisma.user.findUnique({ where: { username } });
  if (user) return res.status(409).json({ error: "Username already taken" });
  user = await prisma.user.create({ data: { username, displayName: username } });
  
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: username,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" }
  });
  await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: options.challenge } });
  res.json(options);
}));

app.post("/api/auth/webauthn/register-verify", rateLimit({ windowMs: 15 * 60_000, limit: 10 }), asyncRoute(async (req, res) => {
  const { username, response } = req.body;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user || !user.currentChallenge) return res.status(400).json({ error: "Invalid state" });
  
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: user.currentChallenge,
    expectedOrigin,
    expectedRPID: rpID,
  });
  
  if (verification.verified && verification.registrationInfo) {
    const { credentialPublicKey, credentialID, counter, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await prisma.authenticator.create({
      data: {
        credentialID: Buffer.from(credentialID).toString("base64url"),
        credentialPublicKey: Buffer.from(credentialPublicKey),
        counter: BigInt(counter),
        credentialDeviceType,
        credentialBackedUp,
        userId: user.id
      }
    });
    await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: null } });
    res.json(authResponse(user));
  } else {
    res.status(400).json({ error: "Verification failed" });
  }
}));

app.post("/api/auth/webauthn/login-options", rateLimit({ windowMs: 15 * 60_000, limit: 10 }), asyncRoute(async (req, res) => {
  const { username } = z.object({ username: z.string().min(2) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { username }, include: { authenticators: true } });
  if (!user || user.authenticators.length === 0) return res.status(404).json({ error: "User not found or no passkey" });
  
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: user.authenticators.map(a => ({
      id: Buffer.from(a.credentialID, 'base64url'),
      transports: a.transports ? a.transports.split(",") : undefined,
    })),
    userVerification: "preferred"
  });
  
  await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: options.challenge } });
  res.json(options);
}));

app.post("/api/auth/webauthn/login-verify", rateLimit({ windowMs: 15 * 60_000, limit: 10 }), asyncRoute(async (req, res) => {
  const { username, response } = req.body;
  const user = await prisma.user.findUnique({ where: { username }, include: { authenticators: true } });
  if (!user || !user.currentChallenge) return res.status(400).json({ error: "Invalid state" });
  
  const auth = user.authenticators.find(a => a.credentialID === response.id);
  if (!auth) return res.status(400).json({ error: "Authenticator not found" });
  
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: user.currentChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    authenticator: {
      credentialPublicKey: auth.credentialPublicKey,
      credentialID: Buffer.from(auth.credentialID, 'base64url'),
      counter: Number(auth.counter),
      transports: auth.transports ? auth.transports.split(',') : undefined
    }
  });
  
  if (verification.verified) {
    await prisma.authenticator.update({ where: { id: auth.id }, data: { counter: BigInt(verification.authenticationInfo.newCounter) } });
    await prisma.user.update({ where: { id: user.id }, data: { currentChallenge: null } });
    res.json(authResponse(user));
  } else {
    res.status(400).json({ error: "Verification failed" });
  }
}));

app.patch("/api/settings/profile", auth, asyncRoute(async (req, res) => {
  const { displayName } = z.object({ displayName: z.string().min(1) }).parse(req.body);
  await prisma.user.update({ where: { id: userId(req) }, data: { displayName } });
  res.json({ ok: true });
}));
`;

if (!code.includes('/api/auth/webauthn/register-options')) {
  code = code.replace('app.get(\n  "/api/dashboard",', passkeyRoutes + '\napp.get(\n  "/api/dashboard",');
}
fs.writeFileSync('apps/api/src/server.ts', code);
