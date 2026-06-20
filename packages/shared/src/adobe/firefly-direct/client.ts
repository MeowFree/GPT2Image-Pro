/**
 * Adobe Firefly 直连客户端（移植自 adobe2api core/adobe_client.py 的图像生成路径）。
 *
 * 流程（异步）：
 *   1. 用多候选 payload 依次 POST /v2/3p-images/generate-async（命中 200 即停）。
 *   2. 从响应头 x-override-status-link 或 body.links.result 取轮询 URL。
 *   3. 轮询直到 outputs[0].image.presignedUrl 出现 → 下载字节返回。
 * 图生图：先 uploadImage 拿 image id，放进 payload 的 referenceBlobs/referenceImages。
 *
 * API 调用（提交/轮询/上传）走可插拔传输（生产走 Go TLS 旁路）；产物下载用直连
 * （presigned URL 无需 TLS 伪装）。
 */

import {
  AdobeRequestError,
  AuthError,
  isRetryableStatus,
  QuotaExhaustedError,
  UpstreamTemporaryError,
} from "./errors";
import {
  buildFireflyImagePayloadCandidates,
  buildFireflyVideoPayload,
  type FireflyImagePayload,
  type FireflyVideoPayload,
} from "./payloads";
import { buildArpSessionId, buildSubmitNonce } from "./signing";
import {
  FetchFireflyTransport,
  type FireflyTransport,
  type FireflyTransportResponse,
} from "./transport";

const SUBMIT_URL = "https://firefly-3p.ff.adobe.io/v2/3p-images/generate-async";
const VIDEO_SUBMIT_URL =
  "https://firefly-3p.ff.adobe.io/v2/3p-videos/generate-async";
const UPLOAD_URL = "https://firefly-3p.ff.adobe.io/v2/storage/image";

const DEFAULT_API_KEY = "clio-playground-web";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";
const DEFAULT_SEC_CH_UA =
  '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"';

export type AdobeFireflyClientConfig = {
  apiKey?: string;
  userAgent?: string;
  secChUa?: string;
  /** API 调用（提交/轮询/上传）的传输；默认直连 fetch（生产应传 Go 旁路传输）。 */
  transport?: FireflyTransport;
  /** 产物下载传输；默认直连 fetch。 */
  downloadTransport?: FireflyTransport;
};

export type GenerateImageInput = {
  token: string;
  prompt: string;
  aspectRatio: string;
  outputResolution: string;
  upstreamModelId: string;
  upstreamModelVersion: string;
  qualityLevel?: string | null;
  detailLevel?: number | null;
  sourceImageIds?: string[] | null;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type GenerateImageOutput = {
  bytes: Buffer;
  raw: Record<string, unknown>;
};

export type GenerateVideoInput = {
  token: string;
  prompt: string;
  upstreamModel: string;
  upstreamModelId: string;
  upstreamModelVersion: string;
  engine: string;
  duration: number;
  size: { width: number; height: number };
  generateAudio: boolean;
  referenceMode?: "image";
  negativePrompt?: string | null;
  /** 已上传的输入图 id（图生视频首帧/尾帧/参考）。 */
  sourceImageIds?: string[] | null;
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
};

export type GenerateVideoOutput = {
  bytes: Buffer;
  raw: Record<string, unknown>;
};

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new Error("aborted"));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class AdobeFireflyClient {
  private readonly apiKey: string;
  private readonly userAgent: string;
  private readonly secChUa: string;
  private readonly transport: FireflyTransport;
  private readonly downloadTransport: FireflyTransport;

  constructor(config: AdobeFireflyClientConfig = {}) {
    this.apiKey = config.apiKey?.trim() || DEFAULT_API_KEY;
    this.userAgent = config.userAgent?.trim() || DEFAULT_USER_AGENT;
    this.secChUa = config.secChUa?.trim() || DEFAULT_SEC_CH_UA;
    this.transport = config.transport ?? new FetchFireflyTransport();
    this.downloadTransport =
      config.downloadTransport ?? new FetchFireflyTransport();
  }

  private browserHeaders(): Record<string, string> {
    return {
      "user-agent": this.userAgent,
      origin: "https://firefly.adobe.com",
      referer: "https://firefly.adobe.com/",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua": this.secChUa,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-site": "same-site",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
    };
  }

  private submitHeaders(token: string, prompt: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...this.browserHeaders(),
      Authorization: `Bearer ${token}`,
      "x-api-key": this.apiKey,
      "content-type": "application/json",
      accept: "*/*",
    };
    const nonce = buildSubmitNonce(token, prompt);
    if (nonce) headers["x-nonce"] = nonce;
    headers["x-arp-session-id"] = buildArpSessionId();
    return headers;
  }

  private pollHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      accept: "*/*",
      referer: "https://firefly.adobe.com/",
      origin: "https://firefly.adobe.com",
      "user-agent": this.userAgent,
    };
  }

  /** 上传图（图生图前置），返回 Adobe image id。移植 upload_image。 */
  async uploadImage(
    token: string,
    imageBytes: Buffer | Uint8Array,
    mimeType = "image/jpeg",
    signal?: AbortSignal
  ): Promise<string> {
    if (!imageBytes || imageBytes.length === 0) {
      throw new AdobeRequestError("image is empty");
    }
    const resp = await this.transport.request({
      method: "POST",
      url: UPLOAD_URL,
      headers: {
        authorization: `Bearer ${token}`,
        "x-api-key": this.apiKey,
        "content-type": mimeType,
        accept: "application/json",
      },
      body: imageBytes,
      signal,
      timeoutMs: 60_000,
    });
    await this.throwForStatus(resp, "upload image");
    const data = (await resp.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const images = (data?.images as Array<Record<string, unknown>>) || [];
    const imageId = images[0]?.id;
    if (!imageId) {
      throw new AdobeRequestError(
        "upload image succeeded but no image id returned"
      );
    }
    return String(imageId);
  }

  /** 文生图/图生图：提交→轮询→下载。移植 generate（图像路径）。 */
  async generateImage(input: GenerateImageInput): Promise<GenerateImageOutput> {
    const candidates = buildFireflyImagePayloadCandidates({
      prompt: input.prompt,
      aspectRatio: input.aspectRatio,
      outputResolution: input.outputResolution,
      upstreamModelId: input.upstreamModelId,
      upstreamModelVersion: input.upstreamModelVersion,
      qualityLevel: input.qualityLevel,
      detailLevel: input.detailLevel,
      sourceImageIds: input.sourceImageIds,
    });

    let submitResp: FireflyTransportResponse | null = null;
    let lastError = "";
    for (const payload of candidates) {
      submitResp = await this.transport.request({
        method: "POST",
        url: SUBMIT_URL,
        headers: this.submitHeaders(input.token, input.prompt),
        body: JSON.stringify(payload as FireflyImagePayload),
        signal: input.signal,
        timeoutMs: 60_000,
      });
      if (submitResp.status === 200) break;
      if (submitResp.status === 401 || submitResp.status === 403) break;
      lastError = (await submitResp.text().catch(() => "")).slice(0, 300);
    }

    if (!submitResp) throw new AdobeRequestError("submit failed: no response");

    if (submitResp.status === 401 || submitResp.status === 403) {
      const accessError = submitResp.headers["x-access-error"];
      if (accessError === "taste_exhausted") {
        throw new QuotaExhaustedError("Adobe quota exhausted for this account");
      }
      throw new AuthError("Token invalid or expired", {
        statusCode: submitResp.status,
      });
    }

    if (submitResp.status !== 200) {
      const body =
        lastError || (await submitResp.text().catch(() => "")).slice(0, 300);
      if (isRetryableStatus(submitResp.status)) {
        throw new UpstreamTemporaryError(
          `submit failed: ${submitResp.status} ${body}`,
          { statusCode: submitResp.status, errorType: "status" }
        );
      }
      throw new AdobeRequestError(
        `submit failed: ${submitResp.status} ${body}`
      );
    }

    const submitData = (await submitResp.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const pollUrl = extractResultLink(submitResp.headers, submitData);
    if (!pollUrl) {
      throw new AdobeRequestError("submit succeeded but no poll url returned");
    }

    const timeoutMs = input.timeoutMs ?? 180_000;
    const pollIntervalMs = input.pollIntervalMs ?? 3_000;
    const start = Date.now();

    for (;;) {
      const pollResp = await this.transport.request({
        method: "GET",
        url: pollUrl,
        headers: this.pollHeaders(input.token),
        signal: input.signal,
        timeoutMs: 60_000,
      });
      if (pollResp.status !== 200) {
        const body = (await pollResp.text().catch(() => "")).slice(0, 300);
        if (pollResp.status === 401 || pollResp.status === 403) {
          throw new AuthError("Token invalid or expired", {
            statusCode: pollResp.status,
          });
        }
        if (isRetryableStatus(pollResp.status)) {
          throw new UpstreamTemporaryError(
            `poll failed: ${pollResp.status} ${body}`,
            { statusCode: pollResp.status, errorType: "status" }
          );
        }
        throw new AdobeRequestError(`poll failed: ${pollResp.status} ${body}`);
      }

      const latest = (await pollResp.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const statusHeader = String(
        pollResp.headers["x-task-status"] || ""
      ).toUpperCase();
      const statusVal =
        String(latest.status || "").toUpperCase() || statusHeader;

      const outputs = (latest.outputs as Array<Record<string, unknown>>) || [];
      if (outputs.length > 0) {
        const image = outputs[0]?.image as Record<string, unknown> | undefined;
        const imageUrl = image?.presignedUrl;
        if (!imageUrl || typeof imageUrl !== "string") {
          throw new AdobeRequestError("job finished without image url");
        }
        const bytes = await this.download(imageUrl, input.signal);
        return { bytes, raw: latest };
      }

      if (
        statusVal === "FAILED" ||
        statusVal === "CANCELLED" ||
        statusVal === "ERROR"
      ) {
        throw new AdobeRequestError(
          `image job failed: ${JSON.stringify(latest).slice(0, 300)}`
        );
      }

      if (Date.now() - start > timeoutMs) {
        throw new AdobeRequestError("generation timed out");
      }
      await sleep(pollIntervalMs, input.signal);
    }
  }

  /** 文生视频/图生视频：提交→轮询→下载（视频路径，同构图像）。 */
  async generateVideo(input: GenerateVideoInput): Promise<GenerateVideoOutput> {
    const payload: FireflyVideoPayload = buildFireflyVideoPayload({
      prompt: input.prompt,
      upstreamModel: input.upstreamModel,
      upstreamModelId: input.upstreamModelId,
      upstreamModelVersion: input.upstreamModelVersion,
      engine: input.engine,
      duration: input.duration,
      size: input.size,
      generateAudio: input.generateAudio,
      ...(input.referenceMode ? { referenceMode: input.referenceMode } : {}),
      ...(input.negativePrompt != null
        ? { negativePrompt: input.negativePrompt }
        : {}),
      ...(input.sourceImageIds
        ? { sourceImageIds: input.sourceImageIds }
        : {}),
    });

    const submitResp = await this.transport.request({
      method: "POST",
      url: VIDEO_SUBMIT_URL,
      headers: this.submitHeaders(input.token, input.prompt),
      body: JSON.stringify(payload),
      signal: input.signal,
      timeoutMs: 60_000,
    });

    if (submitResp.status === 401 || submitResp.status === 403) {
      const accessError = submitResp.headers["x-access-error"];
      if (accessError === "taste_exhausted") {
        throw new QuotaExhaustedError("Adobe quota exhausted for this account");
      }
      throw new AuthError("Token invalid or expired", {
        statusCode: submitResp.status,
      });
    }
    if (submitResp.status !== 200) {
      const body = (await submitResp.text().catch(() => "")).slice(0, 300);
      if (isRetryableStatus(submitResp.status)) {
        throw new UpstreamTemporaryError(
          `video submit failed: ${submitResp.status} ${body}`,
          { statusCode: submitResp.status, errorType: "status" }
        );
      }
      throw new AdobeRequestError(
        `video submit failed: ${submitResp.status} ${body}`
      );
    }

    const submitData = (await submitResp.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const pollUrl = extractResultLink(submitResp.headers, submitData);
    if (!pollUrl) {
      throw new AdobeRequestError(
        "video submit succeeded but no poll url returned"
      );
    }

    // 视频生成耗时较长，默认 600s 超时、3s 轮询（移植视频规格）。
    const timeoutMs = input.timeoutMs ?? 600_000;
    const pollIntervalMs = input.pollIntervalMs ?? 3_000;
    const start = Date.now();

    for (;;) {
      const pollResp = await this.transport.request({
        method: "GET",
        url: pollUrl,
        headers: this.pollHeaders(input.token),
        signal: input.signal,
        timeoutMs: 60_000,
      });
      if (pollResp.status !== 200) {
        const body = (await pollResp.text().catch(() => "")).slice(0, 300);
        if (pollResp.status === 401 || pollResp.status === 403) {
          throw new AuthError("Token invalid or expired", {
            statusCode: pollResp.status,
          });
        }
        if (isRetryableStatus(pollResp.status)) {
          throw new UpstreamTemporaryError(
            `video poll failed: ${pollResp.status} ${body}`,
            { statusCode: pollResp.status, errorType: "status" }
          );
        }
        throw new AdobeRequestError(
          `video poll failed: ${pollResp.status} ${body}`
        );
      }

      const latest = (await pollResp.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const statusHeader = String(
        pollResp.headers["x-task-status"] || ""
      ).toUpperCase();
      const statusVal =
        String(latest.status || "").toUpperCase() || statusHeader;

      const outputs = (latest.outputs as Array<Record<string, unknown>>) || [];
      if (outputs.length > 0) {
        const video = outputs[0]?.video as Record<string, unknown> | undefined;
        const videoUrl = video?.presignedUrl;
        if (!videoUrl || typeof videoUrl !== "string") {
          throw new AdobeRequestError("video job finished without video url");
        }
        const bytes = await this.download(videoUrl, input.signal);
        return { bytes, raw: latest };
      }

      if (
        statusVal === "FAILED" ||
        statusVal === "CANCELLED" ||
        statusVal === "ERROR"
      ) {
        throw new AdobeRequestError(
          `video job failed: ${JSON.stringify(latest).slice(0, 300)}`
        );
      }

      if (Date.now() - start > timeoutMs) {
        throw new AdobeRequestError("video generation timed out");
      }
      await sleep(pollIntervalMs, input.signal);
    }
  }

  private async download(url: string, signal?: AbortSignal): Promise<Buffer> {
    const resp = await this.downloadTransport.request({
      method: "GET",
      url,
      headers: { accept: "*/*" },
      signal,
      timeoutMs: 60_000,
    });
    if (resp.status !== 200) {
      throw new AdobeRequestError(
        `media download failed: HTTP ${resp.status}`,
        { statusCode: resp.status }
      );
    }
    return resp.bytes();
  }

  private async throwForStatus(
    resp: FireflyTransportResponse,
    context: string
  ): Promise<void> {
    if (resp.status === 200 || resp.status === 201) return;
    const body = (await resp.text().catch(() => "")).slice(0, 300);
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthError("Token invalid or expired", {
        statusCode: resp.status,
      });
    }
    if (isRetryableStatus(resp.status)) {
      throw new UpstreamTemporaryError(
        `${context} failed: ${resp.status} ${body}`,
        { statusCode: resp.status, errorType: "status" }
      );
    }
    throw new AdobeRequestError(`${context} failed: ${resp.status} ${body}`);
  }
}

/** 移植 _extract_result_link：先取响应头 x-override-status-link，再取 body.links.result。 */
export function extractResultLink(
  headers: Record<string, string>,
  submitData: Record<string, unknown>
): string {
  const headerLink = String(headers["x-override-status-link"] || "").trim();
  if (headerLink) return headerLink;

  const links = submitData.links as Record<string, unknown> | undefined;
  if (!links || typeof links !== "object") return "";
  const resultLink = links.result;
  if (typeof resultLink === "string") return resultLink.trim();
  if (resultLink && typeof resultLink === "object") {
    return String((resultLink as Record<string, unknown>).href || "").trim();
  }
  return "";
}
