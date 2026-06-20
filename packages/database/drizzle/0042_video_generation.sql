CREATE TABLE IF NOT EXISTS "video_generation" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "api_key_id" text,
  "adobe_id" text,
  "model" text NOT NULL,
  "family" text NOT NULL,
  "prompt" text NOT NULL,
  "duration_seconds" integer NOT NULL,
  "aspect_ratio" text NOT NULL,
  "resolution" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "input_image_refs" json,
  "storage_key" text,
  "video_url" text,
  "credits_consumed" numeric(18, 2) DEFAULT 0 NOT NULL,
  "poll_url" text,
  "upstream_job_id" text,
  "error" text,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_generation" ADD CONSTRAINT "video_generation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "video_generation" ADD CONSTRAINT "video_generation_adobe_id_image_backend_adobe_id_fk" FOREIGN KEY ("adobe_id") REFERENCES "public"."image_backend_adobe"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_generation_user_idx"
  ON "video_generation" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_generation_status_idx"
  ON "video_generation" ("status", "created_at");
