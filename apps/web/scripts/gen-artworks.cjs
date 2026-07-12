/**
 * 影片素材生成:经 GPT2IMAGE Pro 自身 v1 API 生成 16 张水墨作品原图
 * (hero 一笔圆 2048 + 15 幅万象 1024)。产品自己生成影片主角,叙事自证。
 * 走 /v1/images/generations(gpt-image-2, b64_json):该端点带 JSON
 * keep-alive 保活,长生成不被 CDN 100s 超时掐断;/v1/responses 在该
 * 部署上 502(2026-07-12 实测),不用。
 * 用法:G2I_API_KEY=<key> [G2I_BASE=https://gpt2image.superapi.buzz] \
 *      node scripts/gen-artworks.cjs [仅生成的编号,如 hero w03 w07]
 * 输出:scripts/artwork-src/<id>.png + manifest.json(尺寸/修订提示词)。
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

/** 统一模板:与 docs/plan/2026-07-12-artwork-brief.md 逐字一致 */
const TEMPLATE =
  "Traditional Chinese ink wash painting (shuimo) on warm off-white rice" +
  " paper, {SUBJECT}, minimalist composition with vast negative space" +
  " (over 60 percent empty paper), confident single-stroke brushwork," +
  " dry-brush flying-white texture (feibai), subtle ink bleed at stroke" +
  " edges, pure black ink monochrome, no color, no text, no seal, no" +
  " watermark, no signature, square composition";

/** 16 张清单:id 与 cinema-artworks/wallTitles 对齐(hero 在展位 14) */
const JOBS = [
  {
    id: "hero",
    size: "2048x2048",
    subject:
      "a single bold enso circle drawn in one continuous brushstroke," +
      " heavy wet ink at the start of the stroke, dry scratchy trailing end",
  },
  { id: "w01", size: "1024x1024", subject: "sparse bamboo stalks and leaves in wind" },
  { id: "w02", size: "1024x1024", subject: "distant layered mountains in mist" },
  { id: "w03", size: "1024x1024", subject: "a lone small boat on empty water" },
  { id: "w04", size: "1024x1024", subject: "a single plum blossom branch" },
  { id: "w05", size: "1024x1024", subject: "clouds crossing a pale moon" },
  { id: "w06", size: "1024x1024", subject: "reeds by a riverbank" },
  { id: "w07", size: "1024x1024", subject: "a tall waterfall between cliffs" },
  { id: "w08", size: "1024x1024", subject: "wind through a lone pine tree" },
  { id: "w09", size: "1024x1024", subject: "two carp swimming" },
  { id: "w10", size: "1024x1024", subject: "a distant pagoda silhouette" },
  { id: "w11", size: "1024x1024", subject: "swallows over willow branches" },
  { id: "w12", size: "1024x1024", subject: "a single lotus flower and leaf" },
  { id: "w13", size: "1024x1024", subject: "an arched stone bridge over water" },
  { id: "w14", size: "1024x1024", subject: "sparse falling rain over a river" },
  {
    id: "w15",
    size: "1024x1024",
    subject: "wild cursive calligraphy strokes (abstract, illegible)",
  },
];

/** 单张生成:/v1/images/generations 同步调用(服务端 keep-alive 保活),
 * 15 分钟超时,失败抛出由外层重试;响应前缀空白由 JSON.parse 兼容 */
async function generateOne(job) {
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
        prompt: TEMPLATE.replace("{SUBJECT}", job.subject),
        size: job.size,
        quality: "high",
        n: 1,
        response_format: "b64_json",
        output_format: "png",
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`非 JSON 响应: ${text.slice(0, 200)}`);
    }
    if (json.error) {
      throw new Error(`API 错误: ${JSON.stringify(json.error).slice(0, 300)}`);
    }
    const item = (json.data || [])[0];
    if (!item || !item.b64_json) {
      throw new Error(
        `响应无 data[0].b64_json: ${JSON.stringify(json).slice(0, 300)}`
      );
    }
    return { base64: item.b64_json, revised: item.revised_prompt || null };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const only = process.argv.slice(2);
  const jobs = only.length
    ? JOBS.filter((j) => only.includes(j.id))
    : JOBS.filter(
        (j) => !fs.existsSync(path.join(OUT_DIR, `${j.id}.png`))
      );
  console.log(`待生成 ${jobs.length} 张 (已存在的跳过,指定编号可强制)`);

  const manifestPath = path.join(OUT_DIR, "manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    : {};

  // 并发 2:兼顾速度与后端压力/套餐并发限制
  const queue = [...jobs];
  let done = 0;
  let failed = 0;
  async function worker(wid) {
    for (;;) {
      const job = queue.shift();
      if (!job) return;
      const label = `[w${wid}] ${job.id} (${job.size})`;
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`${label} 第 ${attempt} 次请求...`);
          const t0 = Date.now();
          const { base64, revised } = await generateOne(job);
          const buf = Buffer.from(base64, "base64");
          fs.writeFileSync(path.join(OUT_DIR, `${job.id}.png`), buf);
          manifest[job.id] = {
            size: job.size,
            bytes: buf.length,
            revisedPrompt: revised || undefined,
            generatedAt: new Date().toISOString(),
          };
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
          done += 1;
          console.log(
            `${label} 完成 ${(buf.length / 1024 / 1024).toFixed(2)}MB` +
              ` 用时 ${((Date.now() - t0) / 1000).toFixed(0)}s (${done} 张已完成)`
          );
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          console.error(`${label} 失败: ${err.message}`);
          if (attempt < 3) {
            await new Promise((r) => setTimeout(r, 8000 * attempt));
          }
        }
      }
      if (lastErr) {
        failed += 1;
        console.error(`${label} 放弃 (3 次均失败)`);
      }
    }
  }
  await Promise.all([worker(1), worker(2)]);
  console.log(`结束: 成功 ${done} 失败 ${failed}`);
  if (failed > 0) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
