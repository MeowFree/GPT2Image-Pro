import { describe, expect, it } from "vitest";
import {
  AdobeFireflyClient,
  extractResultLink,
  normalizeVideoPollUrl,
} from "./client";
import { AuthError, QuotaExhaustedError } from "./errors";
import type {
  FireflyTransport,
  FireflyTransportRequest,
  FireflyTransportResponse,
} from "./transport";

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
): FireflyTransportResponse {
  const buf = Buffer.from(JSON.stringify(body), "utf-8");
  return {
    status,
    headers,
    bytes: async () => buf,
    text: async () => buf.toString("utf-8"),
    json: async () => JSON.parse(buf.toString("utf-8")),
  };
}

function bytesResponse(status: number, data: Buffer): FireflyTransportResponse {
  return {
    status,
    headers: {},
    bytes: async () => data,
    text: async () => data.toString("utf-8"),
    json: async () => JSON.parse(data.toString("utf-8")),
  };
}

class MockTransport implements FireflyTransport {
  calls: FireflyTransportRequest[] = [];
  constructor(
    private readonly handler: (
      req: FireflyTransportRequest,
      index: number
    ) => FireflyTransportResponse
  ) {}
  async request(
    req: FireflyTransportRequest
  ): Promise<FireflyTransportResponse> {
    const res = this.handler(req, this.calls.length);
    this.calls.push(req);
    return res;
  }
}

const FAKE_TOKEN = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
  '{"user_id":"u1"}'
).toString("base64url")}.sig`;

describe("extractResultLink", () => {
  it("优先响应头 x-override-status-link", () => {
    expect(
      extractResultLink(
        { "x-override-status-link": "https://poll/1" },
        { links: { result: "https://poll/2" } }
      )
    ).toBe("https://poll/1");
  });
  it("回落 body.links.result（字符串/对象）", () => {
    expect(extractResultLink({}, { links: { result: "https://poll/2" } })).toBe(
      "https://poll/2"
    );
    expect(
      extractResultLink({}, { links: { result: { href: "https://poll/3" } } })
    ).toBe("https://poll/3");
  });
  it("无则返回空", () => {
    expect(extractResultLink({}, {})).toBe("");
  });
});

describe("normalizeVideoPollUrl", () => {
  it("将 firefly-epo 分片地址转换为 bks 任务查询地址", () => {
    expect(
      normalizeVideoPollUrl(
        "https://firefly-epo1234-prod.adobe.io/v2/jobs/video-job-1"
      )
    ).toBe(
      "https://bks-epo1234.adobe.io/v2/jobs/result/video-job-1?host=firefly-epo1234-prod.adobe.io/"
    );
  });

  it("不修改普通、非法或无法识别分片的地址", () => {
    expect(normalizeVideoPollUrl("https://poll.example/jobs/1")).toBe(
      "https://poll.example/jobs/1"
    );
    expect(
      normalizeVideoPollUrl("https://firefly-epoabcd.adobe.io/jobs/1")
    ).toBe("https://firefly-epoabcd.adobe.io/jobs/1");
    expect(normalizeVideoPollUrl("not a url")).toBe("not a url");
  });
});

describe("AdobeFireflyClient.generateImage", () => {
  it("提交→轮询→下载 闭环", async () => {
    const imgBytes = Buffer.from("PNGDATA");
    const api = new MockTransport((req, index) => {
      if (index === 0) {
        // submit
        expect(req.url).toContain("/v2/3p-images/generate-async");
        expect(req.headers["x-api-key"]).toBe("projectx_webapp");
        expect(req.headers.origin).toBe("https://new.express.adobe.com");
        expect(req.headers.referer).toBe("https://new.express.adobe.com/");
        expect(req.headers["sec-fetch-site"]).toBe("cross-site");
        expect(req.headers["x-arp-session-id"]).toBeUndefined();
        expect(req.headers["x-nonce"]).toBeUndefined();
        return jsonResponse(
          200,
          { links: { result: "https://poll/abc" } },
          { "x-override-status-link": "https://poll/abc" }
        );
      }
      // poll
      expect(req.headers["x-api-key"]).toBe("projectx_webapp");
      expect(req.headers["content-type"]).toBe("application/json");
      expect(req.headers.origin).toBe("https://new.express.adobe.com");
      return jsonResponse(200, {
        status: "COMPLETED",
        outputs: [{ image: { presignedUrl: "https://cdn/img.png" } }],
      });
    });
    const download = new MockTransport(() => bytesResponse(200, imgBytes));
    const client = new AdobeFireflyClient({
      transport: api,
      downloadTransport: download,
    });

    const out = await client.generateImage({
      token: FAKE_TOKEN,
      prompt: "a cat",
      aspectRatio: "16:9",
      outputResolution: "2K",
      upstreamModelId: "gpt-image",
      upstreamModelVersion: "2",
      pollIntervalMs: 1,
    });
    expect(out.bytes.toString("utf-8")).toBe("PNGDATA");
    expect(download.calls[0]?.url).toBe("https://cdn/img.png");
  });

  it("401 taste_exhausted → QuotaExhaustedError", async () => {
    const api = new MockTransport(() =>
      jsonResponse(401, {}, { "x-access-error": "taste_exhausted" })
    );
    const client = new AdobeFireflyClient({ transport: api });
    await expect(
      client.generateImage({
        token: FAKE_TOKEN,
        prompt: "x",
        aspectRatio: "1:1",
        outputResolution: "2K",
        upstreamModelId: "gpt-image",
        upstreamModelVersion: "2",
      })
    ).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it("401 普通 → AuthError", async () => {
    const api = new MockTransport(() => jsonResponse(401, {}));
    const client = new AdobeFireflyClient({ transport: api });
    await expect(
      client.generateImage({
        token: FAKE_TOKEN,
        prompt: "x",
        aspectRatio: "1:1",
        outputResolution: "2K",
        upstreamModelId: "gpt-image",
        upstreamModelVersion: "2",
      })
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("gpt-image 图生图：单候选 referenceBlobs 提交成功", async () => {
    const api = new MockTransport((req) => {
      if (req.url.includes("generate-async")) {
        return jsonResponse(
          200,
          {},
          { "x-override-status-link": "https://poll/x" }
        );
      }
      return jsonResponse(200, {
        outputs: [{ image: { presignedUrl: "https://cdn/y.png" } }],
      });
    });
    const download = new MockTransport(() =>
      bytesResponse(200, Buffer.from("Y"))
    );
    const client = new AdobeFireflyClient({
      transport: api,
      downloadTransport: download,
    });
    const out = await client.generateImage({
      token: FAKE_TOKEN,
      prompt: "edit",
      aspectRatio: "1:1",
      outputResolution: "2K",
      upstreamModelId: "gpt-image",
      upstreamModelVersion: "2",
      sourceImageIds: ["img1"],
      pollIntervalMs: 1,
    });
    expect(out.bytes.toString("utf-8")).toBe("Y");
    // 现在 gpt-image 图生图只有一个 referenceBlobs 候选,一次 submit 即可。
    const submits = api.calls.filter((c) => c.url.includes("generate-async"));
    expect(submits.length).toBe(1);
  });
});

describe("AdobeFireflyClient.generateVideo", () => {
  it("规范化 firefly-epo 轮询地址后下载视频", async () => {
    const api = new MockTransport((req, index) => {
      if (index === 0) {
        return jsonResponse(
          200,
          {},
          {
            "x-override-status-link":
              "https://firefly-epo5678-prod.adobe.io/jobs/video-job-2",
          }
        );
      }
      expect(req.url).toBe(
        "https://bks-epo5678.adobe.io/v2/jobs/result/video-job-2?host=firefly-epo5678-prod.adobe.io/"
      );
      return jsonResponse(200, {
        status: "COMPLETED",
        outputs: [{ video: { presignedUrl: "https://cdn/video.mp4" } }],
      });
    });
    const download = new MockTransport(() =>
      bytesResponse(200, Buffer.from("MP4DATA"))
    );
    const client = new AdobeFireflyClient({
      transport: api,
      downloadTransport: download,
    });

    const out = await client.generateVideo({
      token: FAKE_TOKEN,
      prompt: "test video",
      upstreamModel: "openai:firefly:colligo:sora2",
      upstreamModelId: "sora",
      upstreamModelVersion: "sora-2",
      engine: "sora2",
      duration: 4,
      size: { width: 1280, height: 720 },
      generateAudio: false,
      pollIntervalMs: 1,
    });

    expect(out.bytes.toString("utf-8")).toBe("MP4DATA");
    expect(download.calls[0]?.url).toBe("https://cdn/video.mp4");
  });
});
