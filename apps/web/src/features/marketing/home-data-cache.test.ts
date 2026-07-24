import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSingleFlightCache } from "./home-data-cache";

// 单飞 TTL 缓存契约:TTL 内命中、过期刷新、并发共享在飞 Promise、
// 刷新失败用陈旧值兜底、从未成功则抛出。fake timers 控制 Date.now,
// loader 用可计数/可控拒绝的 stub,不触达任何真实数据源。
describe("createSingleFlightCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 兜底路径会打错误日志:静默掉,保持输出干净,并据以断言留证行为。
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("TTL 内第二次调用命中缓存,不重复执行 loader", async () => {
    const loader = vi.fn(async () => "value");
    const cache = createSingleFlightCache(loader, 1_000);

    await expect(cache.get()).resolves.toBe("value");
    // 边界:到期前 1ms 仍命中。
    vi.advanceTimersByTime(999);
    await expect(cache.get()).resolves.toBe("value");

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("TTL 过期后重新执行 loader 并缓存新值", async () => {
    let version = 0;
    const loader = vi.fn(async () => ++version);
    const cache = createSingleFlightCache(loader, 1_000);

    await expect(cache.get()).resolves.toBe(1);
    // 边界:过期 1ms 即触发刷新。
    vi.advanceTimersByTime(1_001);
    await expect(cache.get()).resolves.toBe(2);
    vi.advanceTimersByTime(999);
    await expect(cache.get()).resolves.toBe(2);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("并发 10 个 get 只触发一次 loader(单飞去重)", async () => {
    let resolveLoader: (value: string) => void = () => {};
    const loader = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveLoader = resolve;
        })
    );
    const cache = createSingleFlightCache(loader, 1_000);

    const pending = Promise.all(Array.from({ length: 10 }, () => cache.get()));
    // loader 挂起期间:并发调用共享同一在飞 Promise,不形成惊群。
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoader("shared");
    const results = await pending;
    expect(results).toEqual(Array.from({ length: 10 }, () => "shared"));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("刷新失败且有陈旧值:返回陈旧值并留错误日志", async () => {
    const failure = new Error("refresh failed");
    let shouldFail = false;
    const loader = vi.fn(async () => {
      if (shouldFail) throw failure;
      return "stale-ok";
    });
    const cache = createSingleFlightCache(loader, 1_000);

    await expect(cache.get()).resolves.toBe("stale-ok");
    vi.advanceTimersByTime(1_001);

    shouldFail = true;
    await expect(cache.get()).resolves.toBe("stale-ok");
    expect(loader).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "[home-data] 刷新失败,用陈旧缓存兜底",
      failure
    );
  });

  it("从未成功过且加载失败:错误向外抛出,inflight 清理后可重试", async () => {
    const failure = new Error("first load failed");
    const loader = vi.fn(async (): Promise<string> => {
      throw failure;
    });
    const cache = createSingleFlightCache(loader, 1_000);

    await expect(cache.get()).rejects.toBe(failure);
    // 失败后 inflight 已清理:再次调用重试 loader 而非复用 rejected Promise。
    await expect(cache.get()).rejects.toBe(failure);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("reset 清空缓存:下次调用重新执行 loader", async () => {
    const loader = vi.fn(async () => "value");
    const cache = createSingleFlightCache(loader, 1_000);

    await cache.get();
    cache.reset();
    await cache.get();

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
