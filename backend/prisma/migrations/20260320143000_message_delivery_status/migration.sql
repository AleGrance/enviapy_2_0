DO $$
BEGIN
  CREATE TYPE "MessageDeliveryStatus" AS ENUM ('SENT', 'RECEIVED', 'READ');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT;

ALTER TABLE "Message"
ADD COLUMN IF NOT EXISTS "deliveryStatus" "MessageDeliveryStatus";

CREATE UNIQUE INDEX IF NOT EXISTS "Message_providerMessageId_key"
ON "Message"("providerMessageId");
