sed -i 's/machines Machine\[\]/machines Machine\[\]\n  authenticators Authenticator\[\]\n  currentChallenge String?/' apps/api/prisma/schema.prisma
cat << 'SCHEMA' >> apps/api/prisma/schema.prisma

model Authenticator {
  id                   String  @id @default(cuid())
  credentialID         String  @unique
  credentialPublicKey  Bytes
  counter              BigInt
  credentialDeviceType String
  credentialBackedUp   Boolean
  transports           String?
  userId               String
  user                 User    @relation(fields: [userId], references: [id], onDelete: Cascade)
}
SCHEMA
