CREATE TABLE IF NOT EXISTS "registration_identity" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "user_id" text,
  "first_registered_at" timestamp DEFAULT now() NOT NULL,
  "last_seen_at" timestamp DEFAULT now() NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "registration_identity_email_unique" UNIQUE("email"),
  CONSTRAINT "registration_identity_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL
);

INSERT INTO "registration_identity" (
  "id",
  "email",
  "user_id",
  "first_registered_at",
  "last_seen_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  lower("email"),
  "id",
  "created_at",
  now(),
  now(),
  now()
FROM "user"
ON CONFLICT ("email") DO UPDATE SET
  "user_id" = EXCLUDED."user_id",
  "last_seen_at" = now(),
  "updated_at" = now();
