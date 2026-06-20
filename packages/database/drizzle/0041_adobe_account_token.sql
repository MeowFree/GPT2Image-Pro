ALTER TABLE "image_backend_adobe" ADD COLUMN IF NOT EXISTS "mode" text DEFAULT 'gateway' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adobe_account" (
  "id" text PRIMARY KEY NOT NULL,
  "adobe_id" text NOT NULL,
  "name" text NOT NULL,
  "cookie" text NOT NULL,
  "scope" text,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "display_name" text,
  "email" text,
  "account_user_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "last_refresh_at" timestamp,
  "last_refresh_error" text,
  "next_refresh_at" timestamp,
  "consecutive_failures" integer DEFAULT 0 NOT NULL,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "adobe_token" (
  "id" text PRIMARY KEY NOT NULL,
  "adobe_id" text NOT NULL,
  "account_id" text,
  "value" text NOT NULL,
  "account_user_id" text,
  "status" text DEFAULT 'active' NOT NULL,
  "fails" integer DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'auto_refresh' NOT NULL,
  "expires_at" timestamp,
  "credits_total" integer,
  "credits_used" integer,
  "credits_available" integer,
  "credits_updated_at" timestamp,
  "credits_error" text,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adobe_account" ADD CONSTRAINT "adobe_account_adobe_id_image_backend_adobe_id_fk" FOREIGN KEY ("adobe_id") REFERENCES "public"."image_backend_adobe"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adobe_token" ADD CONSTRAINT "adobe_token_adobe_id_image_backend_adobe_id_fk" FOREIGN KEY ("adobe_id") REFERENCES "public"."image_backend_adobe"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "adobe_token" ADD CONSTRAINT "adobe_token_account_id_adobe_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."adobe_account"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adobe_account_adobe_idx" ON "adobe_account" ("adobe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adobe_token_adobe_idx" ON "adobe_token" ("adobe_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adobe_token_account_idx" ON "adobe_token" ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "adobe_token_adobe_status_idx" ON "adobe_token" ("adobe_id", "status");
