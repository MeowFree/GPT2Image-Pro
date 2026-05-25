ALTER TABLE "external_api_key"
 ADD COLUMN IF NOT EXISTS "credit_limit" numeric(18, 2);
--> statement-breakpoint
ALTER TABLE "external_api_key"
 ADD COLUMN IF NOT EXISTS "credits_used" numeric(18, 2) DEFAULT 0 NOT NULL;
