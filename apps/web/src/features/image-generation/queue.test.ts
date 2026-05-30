import { beforeEach, describe, expect, it, vi } from "vitest";

const runtimeSettings = vi.hoisted(() => ({
  globalConcurrency: 500,
}));

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingNumber: vi.fn(async () => runtimeSettings.globalConcurrency),
}));

import { withImageGenerationQueue } from "./queue";

// 队列模块持有进程级单例状态（running/queue/runningByUser）。为避免用例之间互相
// 污染调度状态，需要新鲜实例的用例通过 vi.resetModules + 动态 import 取得隔离副本。
async function importFreshQueue() {
  vi.resetModules();
  return await import("./queue");
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("withImageGenerationQueue", () => {
  beforeEach(() => {
    runtimeSettings.globalConcurrency = 500;
  });

  it("limits running tasks by the configured global concurrency", async () => {
    runtimeSettings.globalConcurrency = 1;
    const first = deferred<string>();
    const started: string[] = [];

    const firstRun = withImageGenerationQueue(
      {
        userId: "user-a",
        priority: "normal",
        userConcurrency: 10,
      },
      async () => {
        started.push("first");
        return await first.promise;
      }
    );
    const secondRun = withImageGenerationQueue(
      {
        userId: "user-b",
        priority: "normal",
        userConcurrency: 10,
      },
      async () => {
        started.push("second");
        return "second";
      }
    );

    await flushTasks();
    expect(started).toEqual(["first"]);

    first.resolve("first");
    await firstRun;
    await flushTasks();

    expect(started).toEqual(["first", "second"]);
    await expect(secondRun).resolves.toBe("second");
  });

  it("limits per-user concurrency independent of global", async () => {
    const { withImageGenerationQueue: queue } = await importFreshQueue();
    const first = deferred<string>();
    const started: string[] = [];

    // 同一用户的两个任务，userConcurrency=1：第二个必须等到第一个完成。
    const firstRun = queue(
      { userId: "user-a", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("a1");
        return await first.promise;
      }
    );
    const secondRun = queue(
      { userId: "user-a", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("a2");
        return "a2";
      }
    );
    // 另一用户不受前者占用影响，应当立即起跑（全局并发充足）。
    const otherRun = queue(
      { userId: "user-b", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("b1");
        return "b1";
      }
    );

    await flushTasks();
    expect(started).toEqual(["a1", "b1"]);
    await expect(otherRun).resolves.toBe("b1");

    first.resolve("a1");
    await firstRun;
    await flushTasks();

    expect(started).toEqual(["a1", "b1", "a2"]);
    await expect(secondRun).resolves.toBe("a2");
  });

  it("runs higher priority before normal", async () => {
    runtimeSettings.globalConcurrency = 1;
    const { withImageGenerationQueue: queue } = await importFreshQueue();
    const blocker = deferred<string>();
    const started: string[] = [];

    // 先占满唯一的全局槽位，使后续任务全部排队等待调度。
    const blockerRun = queue(
      { userId: "blocker", priority: "normal", userConcurrency: 10 },
      async () => {
        started.push("blocker");
        return await blocker.promise;
      }
    );

    await flushTasks();
    expect(started).toEqual(["blocker"]);

    // 先入队 normal，再入队 highest；释放槽位后应优先调度 highest（优先级加权）。
    const normalRun = queue(
      { userId: "normal-user", priority: "normal", userConcurrency: 10 },
      async () => {
        started.push("normal");
        return "normal";
      }
    );
    const highestRun = queue(
      { userId: "highest-user", priority: "highest", userConcurrency: 10 },
      async () => {
        started.push("highest");
        return "highest";
      }
    );

    blocker.resolve("blocker");
    await blockerRun;
    await flushTasks();

    expect(started).toEqual(["blocker", "highest", "normal"]);
    await expect(highestRun).resolves.toBe("highest");
    await expect(normalRun).resolves.toBe("normal");
  });

  it("frees user slot after completion", async () => {
    const { withImageGenerationQueue: queue } = await importFreshQueue();
    const started: string[] = [];

    // 串行跑两个同用户任务（userConcurrency=1），第二个能起跑即证明第一个完成后
    // runningByUser 计数被正确清理、槽位已释放。
    await queue(
      { userId: "user-a", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("a1");
        return "a1";
      }
    );
    await queue(
      { userId: "user-a", priority: "normal", userConcurrency: 1 },
      async () => {
        started.push("a2");
        return "a2";
      }
    );

    expect(started).toEqual(["a1", "a2"]);
  });

  it("rejects queued task after timeout with concurrency-limit message when user at limit", async () => {
    const { withImageGenerationQueue: queue } = await importFreshQueue();
    const blocker = deferred<string>();

    // 占满该用户的唯一并发槽位，使下一个同用户任务排队并最终超时。
    const blockerRun = queue(
      { userId: "user-a", priority: "normal", userConcurrency: 1 },
      async () => await blocker.promise
    );

    await flushTasks();

    const queuedRun = queue(
      {
        userId: "user-a",
        priority: "normal",
        userConcurrency: 1,
        timeoutMs: 5,
      },
      async () => "never"
    );

    await expect(queuedRun).rejects.toThrow(/concurrency limit reached/i);

    blocker.resolve("blocker");
    await blockerRun;
  });

  it("rejects with busy message when global slots exhausted", async () => {
    runtimeSettings.globalConcurrency = 1;
    const { withImageGenerationQueue: queue } = await importFreshQueue();
    const blocker = deferred<string>();

    // 用 user-a 占满唯一的全局槽位；user-b 仍在自身并发额度内，却因全局繁忙超时。
    const blockerRun = queue(
      { userId: "user-a", priority: "normal", userConcurrency: 10 },
      async () => await blocker.promise
    );

    await flushTasks();

    const queuedRun = queue(
      {
        userId: "user-b",
        priority: "normal",
        userConcurrency: 10,
        timeoutMs: 5,
      },
      async () => "never"
    );

    await expect(queuedRun).rejects.toThrow(/queue is busy/i);

    blocker.resolve("blocker");
    await blockerRun;
  });
});
