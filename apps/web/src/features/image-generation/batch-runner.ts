import { randomUUID } from "node:crypto";
import { runImageGenerationForUser } from "./operations";
import type { ImageGenerationCallbacks } from "./types";

export type ImageGenerationOperationResult = Awaited<
  ReturnType<typeof runImageGenerationForUser>
>;

export type RunBatchImageGenerationParams = {
  count: number;
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
  generationIds,
  run,
  callbacks,
  onResult,
  stopOnError = true,
}: RunBatchImageGenerationParams) {
  const results: ImageGenerationOperationResult[] = [];
  for (let index = 0; index < count; index++) {
    const result = await run(
      generationIds?.[index] || randomUUID(),
      callbacks?.(index)
    );
    results.push(result);
    await onResult?.(result, index);
    if (stopOnError && result.error) break;
  }
  return results;
}

export function firstBatchError(results: ImageGenerationOperationResult[]) {
  return results.find((result) => result.error);
}
