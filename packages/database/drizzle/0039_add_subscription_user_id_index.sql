-- subscription(user_id, updated_at DESC) 复合索引
-- getUserPlan() 热路径查询优化:WHERE user_id=? ORDER BY updated_at DESC LIMIT 1
-- 此前无索引导致顺序扫描;补索引后转为 Index Scan Backward。
-- 同 0035/0036:事务内迁移不可用 CONCURRENTLY,使用 IF NOT EXISTS 保证幂等。
CREATE INDEX IF NOT EXISTS "subscription_user_id_updated_at_idx" ON "subscription" ("user_id","updated_at" DESC);
