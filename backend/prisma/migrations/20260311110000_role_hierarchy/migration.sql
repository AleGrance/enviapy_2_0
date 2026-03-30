CREATE TYPE "Role_new" AS ENUM ('SUPER_ADMIN', 'TENANT_ADMIN', 'CLIENT');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "User"
ALTER COLUMN "role" TYPE "Role_new"
USING (
  CASE
    WHEN "role"::text = 'ADMIN' THEN 'SUPER_ADMIN'::"Role_new"
    WHEN "role"::text = 'CLIENT' THEN 'CLIENT'::"Role_new"
    ELSE NULL
  END
);

DROP TYPE "Role";

ALTER TYPE "Role_new" RENAME TO "Role";

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CLIENT';

ALTER TABLE "User" ADD COLUMN "numberId" TEXT;

CREATE UNIQUE INDEX "User_numberId_key" ON "User"("numberId");

ALTER TABLE "User"
ADD CONSTRAINT "User_numberId_fkey"
FOREIGN KEY ("numberId") REFERENCES "WhatsAppNumber"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
