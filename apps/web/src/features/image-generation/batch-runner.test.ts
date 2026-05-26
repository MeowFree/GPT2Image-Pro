import { describe, expect, it } from "vitest";

import { runBatchImageGeneration } from "./batch-runner";

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
});
