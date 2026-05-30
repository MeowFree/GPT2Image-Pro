import { describe, expect, it } from "vitest";

import {
  firstBatchError,
  type ImageGenerationOperationResult,
  runBatchImageGeneration,
} from "./batch-runner";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function flushTasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("runBatchImageGeneration", () => {
  it("runs batch jobs up to the configured concurrency and queues the rest", async () => {
    const first = deferred<{ generationId: string }>();
    const second = deferred<{ generationId: string }>();
    const started: string[] = [];
    const completed: string[] = [];

    const runPromise = runBatchImageGeneration({
      count: 3,
      concurrency: 2,
      generationIds: ["gen_1", "gen_2", "gen_3"],
      run: async (generationId) => {
        started.push(generationId);
        if (generationId === "gen_1") return await first.promise;
        if (generationId === "gen_2") return await second.promise;
        return { generationId };
      },
      onResult: (result) => {
        completed.push(result.generationId || "");
      },
    });

    await flushTasks();
    expect(started).toEqual(["gen_1", "gen_2"]);

    first.resolve({ generationId: "gen_1" });
    await flushTasks();
    expect(started).toEqual(["gen_1", "gen_2", "gen_3"]);

    second.resolve({ generationId: "gen_2" });
    const results = await runPromise;

    expect(results.map((result) => result.generationId)).toEqual([
      "gen_1",
      "gen_2",
      "gen_3",
    ]);
    expect(completed).toEqual(["gen_1", "gen_3", "gen_2"]);
  });

  it("does not start queued jobs after an error when stopOnError is enabled", async () => {
    const first = deferred<{ generationId: string; error?: string }>();
    const second = deferred<{ generationId: string; error?: string }>();
    const started: string[] = [];

    const runPromise = runBatchImageGeneration({
      count: 4,
      concurrency: 2,
      generationIds: ["gen_1", "gen_2", "gen_3", "gen_4"],
      run: async (generationId) => {
        started.push(generationId);
        if (generationId === "gen_1") return await first.promise;
        if (generationId === "gen_2") return await second.promise;
        return { generationId };
      },
    });

    await flushTasks();
    expect(started).toEqual(["gen_1", "gen_2"]);

    first.resolve({ generationId: "gen_1", error: "failed" });
    second.resolve({ generationId: "gen_2" });
    const results = await runPromise;

    expect(started).toEqual(["gen_1", "gen_2"]);
    expect(results.map((result) => result.generationId)).toEqual([
      "gen_1",
      "gen_2",
    ]);
  });

  it("rethrows the first thrown error and stops scheduling", async () => {
    const started: string[] = [];
    const boom = new Error("run threw");

    // concurrency=1 时单 worker 串行推进；第一个任务抛错后 worker 立即 return，
    // 后续任务不应再被调度，且首个抛出的错误必须被原样 rethrow（不被吞掉）。
    const runPromise = runBatchImageGeneration({
      count: 3,
      concurrency: 1,
      generationIds: ["gen_1", "gen_2", "gen_3"],
      run: async (generationId) => {
        started.push(generationId);
        if (generationId === "gen_1") throw boom;
        return { generationId };
      },
    });

    await expect(runPromise).rejects.toBe(boom);
    expect(started).toEqual(["gen_1"]);
  });

  it("with stopOnError=false runs all items despite an error", async () => {
    const started: string[] = [];

    // stopOnError=false 时即使某个结果带 error，也要继续跑完全部 count。
    const results = await runBatchImageGeneration({
      count: 3,
      concurrency: 1,
      generationIds: ["gen_1", "gen_2", "gen_3"],
      stopOnError: false,
      run: async (generationId) => {
        started.push(generationId);
        if (generationId === "gen_1") {
          return { generationId, error: "failed" };
        }
        return { generationId };
      },
    });

    expect(started).toEqual(["gen_1", "gen_2", "gen_3"]);
    expect(results.map((result) => result.generationId)).toEqual([
      "gen_1",
      "gen_2",
      "gen_3",
    ]);
  });

  it("clamps non-finite concurrency to 1", async () => {
    const active: number[] = [];
    let inFlight = 0;

    // concurrency 传 Infinity 时 Number.isFinite 为 false，应退化为单 worker 串行，
    // 任一时刻并发数恒为 1。
    await runBatchImageGeneration({
      count: 3,
      concurrency: Number.POSITIVE_INFINITY,
      generationIds: ["gen_1", "gen_2", "gen_3"],
      run: async (generationId) => {
        inFlight += 1;
        active.push(inFlight);
        await flushTasks();
        inFlight -= 1;
        return { generationId };
      },
    });

    expect(Math.max(...active)).toBe(1);
  });

  it("does not exceed count when concurrency is greater than count", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    // concurrency 大于 count 时 workerCount 被 Math.min 钳到 count，并发上限即为 count。
    await runBatchImageGeneration({
      count: 2,
      concurrency: 10,
      generationIds: ["gen_1", "gen_2"],
      run: async (generationId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await flushTasks();
        inFlight -= 1;
        return { generationId };
      },
    });

    expect(maxInFlight).toBe(2);
  });

  it("firstBatchError returns the first errored result", () => {
    expect(
      firstBatchError([
        { generationId: "gen_1" },
        { generationId: "gen_2", error: "boom" },
        { generationId: "gen_3", error: "later" },
      ] as ImageGenerationOperationResult[])
    ).toEqual({ generationId: "gen_2", error: "boom" });
  });

  it("firstBatchError returns undefined when no result errored", () => {
    expect(
      firstBatchError([
        { generationId: "gen_1" },
        { generationId: "gen_2" },
      ] as ImageGenerationOperationResult[])
    ).toBeUndefined();
  });
});
