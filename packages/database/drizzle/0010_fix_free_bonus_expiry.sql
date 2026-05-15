UPDATE "credits_batch"
SET
  "expires_at" = "issued_at" + INTERVAL '7 days',
  "updated_at" = now()
WHERE
  "source_type" = 'bonus'
  AND "status" = 'active'
  AND (
    "expires_at" IS NULL
    OR "expires_at" > "issued_at" + INTERVAL '7 days'
  );
--> statement-breakpoint
WITH expired_bonus AS (
  UPDATE "credits_batch"
  SET
    "status" = 'expired',
    "updated_at" = now()
  WHERE
    "source_type" = 'bonus'
    AND "status" = 'active'
    AND "remaining" > 0
    AND "expires_at" < now()
  RETURNING
    "id",
    "user_id",
    "amount",
    "remaining",
    "expires_at"
),
expiration_transactions AS (
  INSERT INTO "credits_transaction" (
    "id",
    "user_id",
    "type",
    "amount",
    "debit_account",
    "credit_account",
    "description",
    "metadata",
    "created_at"
  )
  SELECT
    md5("id" || ':free-expiry-v2:' || now()::text || ':' || "user_id"),
    "user_id",
    'expiration',
    "remaining",
    'WALLET:' || "user_id",
    'SYSTEM:expired',
    '免费积分已过期',
    json_build_object(
      'batchId', "id",
      'originalAmount', "amount",
      'expiredAmount', "remaining",
      'expiresAt', "expires_at",
      'reason', 'free_credits_7_day_expiry'
    ),
    now()
  FROM expired_bonus
  RETURNING "user_id", "amount"
),
expired_totals AS (
  SELECT "user_id", SUM("amount") AS "expired_amount"
  FROM expiration_transactions
  GROUP BY "user_id"
)
UPDATE "credits_balance"
SET
  "balance" = GREATEST(0, "credits_balance"."balance" - expired_totals."expired_amount"),
  "updated_at" = now()
FROM expired_totals
WHERE "credits_balance"."user_id" = expired_totals."user_id";
