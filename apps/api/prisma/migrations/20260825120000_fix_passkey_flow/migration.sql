-- Remove fields and relations accidentally introduced by the initial WebAuthn migration.
ALTER TABLE "Authenticator" DROP CONSTRAINT IF EXISTS "Authenticator_exerciseId_fkey";
ALTER TABLE "Authenticator" DROP COLUMN IF EXISTS "exerciseId";
ALTER TABLE "Exercise" DROP COLUMN IF EXISTS "currentChallenge";
ALTER TABLE "User" DROP COLUMN IF EXISTS "currentChallenge";

-- Store short-lived ceremonies independently from users. This supports
-- discoverable passkeys and avoids creating incomplete accounts.
CREATE TABLE "PasskeyChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "userHandle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasskeyChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PasskeyChallenge_expiresAt_idx" ON "PasskeyChallenge"("expiresAt");
