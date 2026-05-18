CREATE TABLE IF NOT EXISTS "epay_order" (
  "out_trade_no" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "business_type" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "metadata" json NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "epay_order" ADD CONSTRAINT "epay_order_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epay_order_user_id_idx" ON "epay_order" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epay_order_status_idx" ON "epay_order" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "epay_order_created_at_idx" ON "epay_order" ("created_at");
