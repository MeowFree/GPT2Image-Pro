-- MCP User API Keys
-- 独立于 external_api_key 的 MCP 专用密钥表。
-- 用于终端用户通过 MCP 协议访问图像生成等功能。
-- 设计上与 v1 API key 完全隔离，互不干扰。

CREATE TABLE IF NOT EXISTS "mcp_api_key" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "name" text DEFAULT 'Default MCP key' NOT NULL,
  "key_prefix" text NOT NULL,
  "key_hash" text NOT NULL,
  "last_four" text NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "last_used_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "mcp_api_key_key_hash_unique" UNIQUE("key_hash"),
  CONSTRAINT "mcp_api_key_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE
);

-- 按 keyHash 查找（鉴权热路径）
CREATE INDEX IF NOT EXISTS "mcp_api_key_key_hash_idx"
  ON "mcp_api_key" ("key_hash");

-- 按 userId 列出用户的 MCP key
CREATE INDEX IF NOT EXISTS "mcp_api_key_user_id_idx"
  ON "mcp_api_key" ("user_id");
