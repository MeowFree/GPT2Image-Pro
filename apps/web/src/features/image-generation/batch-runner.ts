import { randomUUID } from "node:crypto";
import { runImageGenerationForUser } from "./operations";
import type { ImageGenerationCallbacks } from "./types";

export type ImageGenerationOperationResult = Awaited<
  ReturnType<typeof runImageGenerationForUser>
>;

export type RunBatchImageGenerationParams = {
  count: number;
  concurrency?: number;
  generationIds?: string[];
  run: (
    generationId: string,
    callbacks?: ImageGenerationCallbacks
  ) => Promise<ImageGenerationOperationResult>;
  callbacks?: (index: number) => ImageGenerationCallbacks;
  onResult?: (
    result: ImageGenerationOperationResult,
    index: number
  ) => Promise<void> | void;
  stopOnError?: boolean;
};

export async function runBatchImageGeneration({
  count,
  concurrency = 1,
  generationIds,
  run,
  callbacks,
  onResult,
  stopOnError = true,
}: RunBatchImageGenerationParams) {
  const results: ImageGenerationOperationResult[] = [];
  const workerCount = Math.max(
    1,
    Math.min(count, Math.floor(Number.isFinite(concurrency) ? concurrency : 1))
  );
  let nextIndex = 0;
  let shouldStop = false;
  let thrownError: unknown;

  const runWorker = async () => {
    while (!shouldStop) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= count) return;

      let result: ImageGenerationOperationResult;
      try {
        result = await run(
          generationIds?.[index] || randomUUID(),
          callbacks?.(index)
        );
      } catch (error) {
        shouldStop = true;
        if (!thrownError) thrownError = error;
        return;
      }

      results[index] = result;
      await onResult?.(result, index);
      if (stopOnError && result.error) {
        shouldStop = true;
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  if (thrownError) {
    throw thrownError;
  }
  return results.filter(Boolean);
}

export function firstBatchError(results: ImageGenerationOperationResult[]) {
  return results.find((result) => result.error);
}
