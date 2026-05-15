ALTER TABLE "credits_balance"
  ALTER COLUMN "balance" TYPE numeric(18, 2) USING "balance"::numeric(18, 2),
  ALTER COLUMN "balance" SET DEFAULT 0,
  ALTER COLUMN "total_earned" TYPE numeric(18, 2) USING "total_earned"::numeric(18, 2),
  ALTER COLUMN "total_earned" SET DEFAULT 0,
  ALTER COLUMN "total_spent" TYPE numeric(18, 2) USING "total_spent"::numeric(18, 2),
  ALTER COLUMN "total_spent" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "credits_batch"
  ALTER COLUMN "amount" TYPE numeric(18, 2) USING "amount"::numeric(18, 2),
  ALTER COLUMN "remaining" TYPE numeric(18, 2) USING "remaining"::numeric(18, 2);
--> statement-breakpoint
ALTER TABLE "credits_transaction"
  ALTER COLUMN "amount" TYPE numeric(18, 2) USING "amount"::numeric(18, 2);
--> statement-breakpoint
ALTER TABLE IF EXISTS "generation"
  ALTER COLUMN "credits_consumed" TYPE numeric(18, 2) USING "credits_consumed"::numeric(18, 2),
  ALTER COLUMN "credits_consumed" SET DEFAULT 0;
