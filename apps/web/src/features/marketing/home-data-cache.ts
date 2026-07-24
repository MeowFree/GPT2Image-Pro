/**
 * 单飞 TTL 缓存:同一时刻至多一个 loader 在飞(并发请求共享同一
 * Promise,故障期不形成惊群);TTL 内直接命中;过期后刷新失败时用
 * 陈旧值兜底(营销页宁可旧数据不可 500)。纯逻辑可单测。
 */
export interface SingleFlightCache<T> {
  get(): Promise<T>;
  /** 测试与热更新用:清空缓存与在飞 Promise */
  reset(): void;
}

export function createSingleFlightCache<T>(
  loader: () => Promise<T>,
  ttlMs: number
): SingleFlightCache<T> {
  let cached: { value: T; expiresAt: number } | undefined;
  let inflight: Promise<T> | undefined;
  return {
    get() {
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        return Promise.resolve(cached.value);
      }
      if (inflight) return inflight;
      inflight = loader()
        .then((value) => {
          cached = { value, expiresAt: Date.now() + ttlMs };
          return value;
        })
        .catch((err: unknown) => {
          if (cached) {
            console.error("[home-data] 刷新失败,用陈旧缓存兜底", err);
            return cached.value;
          }
          throw err;
        })
        .finally(() => {
          inflight = undefined;
        });
      return inflight;
    },
    reset() {
      cached = undefined;
      inflight = undefined;
    },
  };
}
