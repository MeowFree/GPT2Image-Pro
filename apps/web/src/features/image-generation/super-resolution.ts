/**
 * Real-ESRGAN client.
 *
 * ONNX inference intentionally runs in the standalone super-resolution worker,
 * so image post-processing cannot block the Next.js processes serving pages.
 */

/** Model scale. Kept here because calibration tests and callers treat it as protocol metadata. */
export const SUPER_RESOLUTION_SCALE = 4;

const DEFAULT_WORKER_URL = "http://127.0.0.1:3310";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function getPositiveInteger(
  value: string | undefined,
  fallback: number
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getWorkerEndpoint(): URL {
  const baseUrl =
    process.env.SUPER_RESOLUTION_WORKER_URL?.trim() || DEFAULT_WORKER_URL;
  return new URL("/v1/super-resolution", baseUrl);
}

/**
 * Send one image to the dedicated Real-ESRGAN worker and return its PNG output.
 * Errors are handled by resolution-calibration.ts, which falls back to the input image.
 */
export async function superResolve(image: Buffer): Promise<Buffer> {
  const timeoutMs = getPositiveInteger(
    process.env.SUPER_RESOLUTION_WORKER_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const secret = process.env.SUPER_RESOLUTION_WORKER_SECRET?.trim();
  const headers: Record<string, string> = {
    "content-type": "application/octet-stream",
    "content-length": String(image.byteLength),
  };
  if (secret) headers["x-super-resolution-secret"] = secret;

  const response = await fetch(getWorkerEndpoint(), {
    method: "POST",
    headers,
    body: new Uint8Array(image),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500).trim();
    throw new Error(
      `super-resolution worker returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  const output = Buffer.from(await response.arrayBuffer());
  if (output.byteLength === 0) {
    throw new Error("super-resolution worker returned an empty image");
  }
  return output;
}
