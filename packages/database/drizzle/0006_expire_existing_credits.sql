UPDATE "credits_batch"
SET
  "expires_at" = CASE
    WHEN "source_type" = 'subscription' AND "amount" IN (60000, 240000, 960000)
      THEN "issued_at" + INTERVAL '1 year'
    WHEN "source_type" = 'subscription'
      THEN "issued_at" + INTERVAL '1 month'
    ELSE "issued_at" + INTERVAL '365 days'
  END,
  "updated_at" = now()
WHERE "expires_at" IS NULL;
