ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
ALTER TABLE "Exercise" ADD COLUMN "descriptionDe" TEXT;
ALTER TABLE "Exercise" ADD COLUMN "instructionsDe" TEXT;
