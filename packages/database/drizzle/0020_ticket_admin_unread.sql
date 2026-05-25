ALTER TABLE "ticket"
  ADD COLUMN IF NOT EXISTS "admin_last_seen_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ticket"
  ADD COLUMN IF NOT EXISTS "last_user_activity_at" timestamp;
--> statement-breakpoint
UPDATE "ticket"
SET "last_user_activity_at" = "updated_at"
WHERE "last_user_activity_at" IS NULL;
--> statement-breakpoint
UPDATE "ticket"
SET "admin_last_seen_at" = "last_admin_activity_at"
WHERE "admin_last_seen_at" IS NULL
  AND "last_admin_activity_at" IS NOT NULL;
