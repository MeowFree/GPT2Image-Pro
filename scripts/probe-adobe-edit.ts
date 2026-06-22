/**
 * Adobe gpt-image 图生图(edit)载荷探测脚本（一次性诊断用，非生产代码）。
 *
 * 背景：/v1/images/edits 路由到 Adobe direct 后端 100% 失败，Adobe 回
 *   400 {"error_code":"bad_request","message":"Image edit use case requires a reference image"}
 * 说明当前 referenceBlobs:[{id,usage:"general"}] 没被 Adobe 当作 edit 的源图。
 *
 * 本脚本：读 DB 里一个 active Adobe token + 旁路配置 → 上传一张测试图拿 blobId →
 * 对 SUBMIT_URL 逐个 POST 一批候选载荷（只提交不轮询，省额度）→ 打印每个变体的
 * status / x-access-error / body 前 500 字符，据此定位 Adobe 接受的 edit 结构。
 *
 *   DATABASE_URL=... npx tsx scripts/probe-adobe-edit.ts
 */

import fs from "node:fs";
import path from "node:path";
import { db } from "@repo/database";
import { adobeToken } from "@repo/database/schema";
import {
  AdobeFireflyClient,
  buildFireflyImagePayloadCandidates,
  ProxyFireflyTransport,
  resolveFireflyImageModel,
} from "@repo/shared/adobe/firefly-direct";
import { getRuntimeSettingString } from "@repo/shared/system-settings";
import { asc, eq } from "drizzle-orm";

const SUBMIT_URL = "https://firefly-3p.ff.adobe.io/v2/3p-images/generate-async";

// 读旁路配置（与 adobe-direct.getFireflyProxyConfig 同源：env 覆盖，回落 DB 运行时设置）。
async function loadProxy(): Promise<{ url: string; secret: string }> {
  const rawUrl =
    process.env.FIREFLY_PROXY_URL?.trim() ||
    (await getRuntimeSettingString("CHATGPT_WEB_PROXY_URL")) ||
    process.env.CHATGPT_WEB_PROXY_URL?.trim();
  const url = (rawUrl || "").replace(/\/+$/, "");
  if (!url) throw new Error("no proxy url (CHATGPT_WEB_PROXY_URL)");
  const secret =
    process.env.FIREFLY_PROXY_SECRET?.trim() ||
    (await getRuntimeSettingString("CHATGPT_WEB_PROXY_SECRET")) ||
    process.env.CHATGPT_WEB_PROXY_SECRET?.trim() ||
    "";
  return { url, secret };
}

async function pickActiveToken(): Promise<{ id: string; value: string }> {
  const rows = await db
    .select({ id: adobeToken.id, value: adobeToken.value })
    .from(adobeToken)
    .where(eq(adobeToken.status, "active"))
    .orderBy(asc(adobeToken.lastUsedAt), asc(adobeToken.createdAt));
  const row = rows.find((r) => r.value);
  if (!row?.value) throw new Error("no active adobe token in db");
  return { id: row.id, value: row.value };
}

async function main() {
  const proxy = await loadProxy();
  const transport = new ProxyFireflyTransport({
    proxyUrl: proxy.url,
    secret: proxy.secret,
    sessionKey: "probe-edit",
  });
  const token = await pickActiveToken();
  const client = new AdobeFireflyClient({ transport });

  // 上传测试图拿 blobId。
  const imgPath = path.join(
    process.cwd(),
    "apps/web/public/assets/logo.png"
  );
  const bytes = fs.readFileSync(imgPath);
  const blobId = await client.uploadImage(
    token.value,
    bytes,
    "image/png"
  );
  console.log("uploaded blobId:", blobId);

  // 被测 model id 走环境变量，默认 gpt-image-2；可传 firefly-nano-banana-pro-2k-1x1 等。
  const modelId =
    process.env.PROBE_MODEL_ID?.trim() || "firefly-gpt-image-2-2k-1x1";
  const model = resolveFireflyImageModel(modelId);
  if (!model) throw new Error(`model resolve failed: ${modelId}`);
  console.log("probing model:", modelId);

  // 用真实 builder 生成该族的 edit 候选（含正确的 module/modelSpecificPayload 等），
  // 再仅覆盖 referenceBlobs 的 usage 做对照——确保 base 结构与生产完全一致。
  const [editCandidate] = buildFireflyImagePayloadCandidates({
    prompt: "make the background a clear blue sky",
    aspectRatio: model.aspectRatio,
    outputResolution: model.outputResolution,
    upstreamModelId: model.upstreamModelId,
    upstreamModelVersion: model.upstreamModelVersion,
    qualityLevel: "high",
    sourceImageIds: [blobId],
  });
  const baseEdit = editCandidate as Record<string, unknown>;

  // PROBE_FULL=1：用真实 client.generateImage 跑完整 edit（submit→轮询→下载），
  // 验证修复后的 builder（gpt-image=subject / nano-banana=general）端到端出图。
  if (process.env.PROBE_FULL === "1") {
    console.log("running FULL edit pipeline (submit→poll→download)...");
    const out = await client.generateImage({
      token: token.value,
      prompt: "make the background a clear blue sky",
      aspectRatio: model.aspectRatio,
      outputResolution: model.outputResolution,
      upstreamModelId: model.upstreamModelId,
      upstreamModelVersion: model.upstreamModelVersion,
      qualityLevel: "high",
      sourceImageIds: [blobId],
    });
    console.log(`FULL edit OK: ${out.bytes.length} bytes returned`);
    process.exit(0);
  }

  const withUsage = (usage: string): Record<string, unknown> => ({
    ...baseEdit,
    referenceBlobs: [{ id: blobId, usage }],
  });

  // 候选：仅变 usage（module 等其余沿用 builder 产物）。命中 200 即停。
  const variants: Array<{ name: string; payload: Record<string, unknown> }> = [
    { name: "01 usage=subject", payload: withUsage("subject") },
    { name: "02 usage=general", payload: withUsage("general") },
    { name: "03 usage=structure", payload: withUsage("structure") },
    { name: "04 usage=composition", payload: withUsage("composition") },
    { name: "05 usage=style", payload: withUsage("style") },
  ];

  const headers = (
    client as unknown as {
      submitHeaders: (t: string, p: string) => Record<string, string>;
    }
  ).submitHeaders(token.value, "make the background a clear blue sky");

  for (const v of variants) {
    try {
      const resp = await transport.request({
        method: "POST",
        url: SUBMIT_URL,
        headers,
        body: JSON.stringify(v.payload),
        timeoutMs: 60_000,
      });
      const text = (await resp.text().catch(() => "")).slice(0, 500);
      const accessErr = resp.headers["x-access-error"] || "";
      const ok = resp.status === 200 ? "  <<< 200 OK" : "";
      console.log(`\n[${v.name}] status=${resp.status} ${accessErr ? `x-access-error=${accessErr}` : ""}${ok}`);
      console.log(`  body: ${text}`);
      if (resp.status === 200) {
        console.log("  >>> 该变体被接受，停止（避免继续消耗额度）");
        break;
      }
    } catch (error) {
      console.log(`\n[${v.name}] EXCEPTION: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
