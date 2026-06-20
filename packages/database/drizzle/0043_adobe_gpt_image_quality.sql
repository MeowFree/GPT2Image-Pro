ALTER TABLE "image_backend_adobe" ADD COLUMN IF NOT EXISTS "gpt_image_quality" text DEFAULT 'high' NOT NULL;
