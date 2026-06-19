CREATE TABLE IF NOT EXISTS "image_backend_adobe" (
  "id" text PRIMARY KEY NOT NULL,
  "group_id" text,
  "name" text NOT NULL,
  "base_url" text NOT NULL,
  "api_key" text NOT NULL,
  "enabled_models" json,
  "default_ratio" text DEFAULT '1x1' NOT NULL,
  "default_resolution" text DEFAULT '2k' NOT NULL,
  "supports_video" boolean DEFAULT false NOT NULL,
  "content_safety_enabled" boolean DEFAULT true NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "always_active" boolean DEFAULT false NOT NULL,
  "priority" integer DEFAULT 50 NOT NULL,
  "concurrency" integer DEFAULT 10 NOT NULL,
  "failure_cooldown_enabled" boolean DEFAULT false NOT NULL,
  "success_count" integer DEFAULT 0 NOT NULL,
  "fail_count" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "last_used_at" timestamp,
  "last_acquired_at" timestamp,
  "cooldown_until" timestamp,
  "last_error" text,
  "last_error_at" timestamp,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "image_backend_adobe_group" (
  "id" text PRIMARY KEY NOT NULL,
  "adobe_id" text NOT NULL,
  "group_id" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_adobe" ADD CONSTRAINT "image_backend_adobe_group_id_image_backend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_adobe_group" ADD CONSTRAINT "image_backend_adobe_group_adobe_id_image_backend_adobe_id_fk" FOREIGN KEY ("adobe_id") REFERENCES "public"."image_backend_adobe"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "image_backend_adobe_group" ADD CONSTRAINT "image_backend_adobe_group_group_id_image_backend_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."image_backend_group"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "image_backend_adobe_group_adobe_group_unique"
  ON "image_backend_adobe_group" ("adobe_id", "group_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "image_backend_adobe_group_group_idx"
  ON "image_backend_adobe_group" ("group_id");
