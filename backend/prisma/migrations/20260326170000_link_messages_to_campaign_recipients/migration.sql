ALTER TABLE "Message"
ADD COLUMN "campaignId" TEXT,
ADD COLUMN "campaignRecipientId" TEXT;

CREATE INDEX "Message_campaignId_idx" ON "Message"("campaignId");
CREATE INDEX "Message_campaignRecipientId_idx" ON "Message"("campaignRecipientId");

ALTER TABLE "Message"
ADD CONSTRAINT "Message_campaignId_fkey"
FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Message"
ADD CONSTRAINT "Message_campaignRecipientId_fkey"
FOREIGN KEY ("campaignRecipientId") REFERENCES "CampaignRecipient"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
