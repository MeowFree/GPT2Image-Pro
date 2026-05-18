ALTER TABLE "user"
 ADD COLUMN IF NOT EXISTS "moderation_block_risk_level" text DEFAULT 'low' NOT NULL;
--> statement-breakpoint
ALTER TABLE "external_api_key"
 ADD COLUMN IF NOT EXISTS "moderation_block_risk_level" text DEFAULT 'low' NOT NULL;
