UPDATE "credits_batch"
SET
  "expires_at" = "issued_at" + INTERVAL '365 days',
  "updated_at" = now()
WHERE "expires_at" IS NULL;
