CREATE TABLE IF NOT EXISTS "announcement" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "is_published" boolean DEFAULT false NOT NULL,
  "is_pinned" boolean DEFAULT false NOT NULL,
  "priority" integer DEFAULT 0 NOT NULL,
  "published_at" timestamp,
  "expires_at" timestamp,
  "created_by_user_id" text,
  "updated_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "announcement_read" (
  "id" text PRIMARY KEY NOT NULL,
  "announcement_id" text NOT NULL,
  "user_id" text NOT NULL,
  "read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcement"
  ADD CONSTRAINT "announcement_created_by_user_id_user_id_fk"
  FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "announcement"
  ADD CONSTRAINT "announcement_updated_by_user_id_user_id_fk"
  FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."user"("id")
  ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "announcement_read"
  ADD CONSTRAINT "announcement_read_announcement_id_announcement_id_fk"
  FOREIGN KEY ("announcement_id") REFERENCES "public"."announcement"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "announcement_read"
  ADD CONSTRAINT "announcement_read_user_id_user_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_read_user_announcement_unique"
  ON "announcement_read" USING btree ("user_id", "announcement_id");
