ALTER TABLE "user_api_config"
  ADD COLUMN IF NOT EXISTS "chat_completions_upstream_mode" text NOT NULL DEFAULT 'responses';

ALTER TABLE "image_backend_api"
  ADD COLUMN IF NOT EXISTS "chat_completions_upstream_mode" text NOT NULL DEFAULT 'responses';
