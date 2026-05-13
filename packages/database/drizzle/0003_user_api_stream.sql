ALTER TABLE "user_api_config"
ADD COLUMN IF NOT EXISTS "use_stream" boolean DEFAULT false NOT NULL;
