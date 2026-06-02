CREATE TABLE IF NOT EXISTS "image_backend_inflight_lease" (
  "id" text PRIMARY KEY NOT NULL,
  "member_type" text NOT NULL,
  "member_id" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "image_backend_inflight_lease_member_idx"
  ON "image_backend_inflight_lease" ("member_type", "member_id");

CREATE INDEX IF NOT EXISTS "image_backend_inflight_lease_expires_at_idx"
  ON "image_backend_inflight_lease" ("expires_at");

CREATE TABLE IF NOT EXISTS "image_backend_sticky_binding" (
  "id" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "binding_key" text NOT NULL,
  "member_type" text NOT NULL,
  "member_id" text NOT NULL,
  "group_id" text,
  "account_backend" text,
  "expires_at" timestamp NOT NULL,
  "last_hit_at" timestamp,
  "hit_count" integer DEFAULT 0 NOT NULL,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "image_backend_sticky_binding_scope_key_unique"
  ON "image_backend_sticky_binding" ("scope", "binding_key");

CREATE INDEX IF NOT EXISTS "image_backend_sticky_binding_member_idx"
  ON "image_backend_sticky_binding" ("member_type", "member_id");

CREATE INDEX IF NOT EXISTS "image_backend_sticky_binding_expires_at_idx"
  ON "image_backend_sticky_binding" ("expires_at");

CREATE TABLE IF NOT EXISTS "image_backend_scheduler_metric" (
  "id" text PRIMARY KEY NOT NULL,
  "bucket_started_at" timestamp NOT NULL,
  "request_kind" text NOT NULL,
  "selected_layer" text NOT NULL,
  "member_type" text,
  "member_id" text,
  "group_id" text,
  "select_count" integer DEFAULT 0 NOT NULL,
  "sticky_previous_hit_count" integer DEFAULT 0 NOT NULL,
  "sticky_session_hit_count" integer DEFAULT 0 NOT NULL,
  "load_balance_count" integer DEFAULT 0 NOT NULL,
  "switch_count" integer DEFAULT 0 NOT NULL,
  "candidate_count_total" integer DEFAULT 0 NOT NULL,
  "latency_ms_total" integer DEFAULT 0 NOT NULL,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "image_backend_scheduler_metric_bucket_unique"
  ON "image_backend_scheduler_metric" (
    "bucket_started_at",
    "request_kind",
    "selected_layer",
    "member_type",
    "member_id",
    "group_id"
  );

CREATE INDEX IF NOT EXISTS "image_backend_scheduler_metric_bucket_idx"
  ON "image_backend_scheduler_metric" ("bucket_started_at");
