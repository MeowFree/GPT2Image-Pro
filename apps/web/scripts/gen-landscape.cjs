/**
 * 山水素材生成:经 GPT2IMAGE Pro 自身 v1 API 生成 dive 幕飞越的水墨
 * 山水长卷(1536x1024)。构图硬要求:中景谷道纵深 + 两侧山脊 +
 * 大量留白云雾——谷道供相机飞越,山脊供地形起伏。
 * 用法:G2I_API_KEY=<key> [G2I_BASE=...] node scripts/gen-landscape.cjs
 * 输出:scripts/artwork-src/landscape.png + landscape-manifest.json。
 * 机密纪律:key 仅经环境变量传入,本文件与输出不含任何机密。
 */
const fs = require("node:fs");
const path = require("node:path");

const BASE = process.env.G2I_BASE || "https://gpt2image.superapi.buzz";
const KEY = process.env.G2I_API_KEY;
if (!KEY) {
  console.error("缺少 G2I_API_KEY 环境变量");
  process.exit(1);
}

const OUT_DIR = path.join(__dirname, "artwork-src");
fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPT =
  "Traditional Chinese ink wash painting (shuimo) on warm off-white rice" +
  " paper, a vast mountain valley landscape: a low open valley corridor" +
  " in the center receding into misty distance, flanked by layered dark" +
  " ink mountain ridges on left and right sides, nearer ridges darker" +
  " and heavier, distant ridges paler, vast negative space of clouds" +
  " and mist (over 50 percent empty paper), confident brushwork with" +
  " dry-brush texture (feibai), pure black ink monochrome, no color," +
  " no text, no seal, no watermark, wide horizontal composition";

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15 * 60 * 1000);
  try {
    const res = await fetch(`${BASE}/v1/images/generations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: PROMPT,
        size: "1536x1024",
        quality: "high",
        response_format: "b64_json",
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const json = JSON.parse((await res.text()).trim());
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) throw new Error("响应无 b64_json");
    fs.writeFileSync(
      path.join(OUT_DIR, "landscape.png"),
      Buffer.from(b64, "base64")
    );
    fs.writeFileSync(
      path.join(OUT_DIR, "landscape-manifest.json"),
      JSON.stringify({ size: "1536x1024", prompt: PROMPT }, null, 2)
    );
    console.log("已生成 scripts/artwork-src/landscape.png");
  } finally {
    clearTimeout(timer);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
