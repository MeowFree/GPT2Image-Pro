/**
 * 把衬线标题渲到离屏 canvas 作 GL 纹理,供"墨渗入纸"式显影。
 * WHY 等字体:document.fonts.ready 前绘制会落到回退字体,
 * 显影出来的字形与 DOM 不一致,穿帮。
 * 衬线栈与站点一致(packages/ui globals.css 的 --font-serif)。
 */

const SERIF_FAMILY =
  '"Noto Serif Variable", "Noto Serif SC Variable", "Noto Serif", ' +
  '"Noto Serif SC", "Source Han Serif SC", Georgia, serif';

/**
 * 渲染文字纹理。深色字+透明底,配合 denoise pass 的 textMode 使用。
 * text 中的换行符为强制断行(与 DOM 标题的多行结构对应),
 * 其余按宽度自动折行。
 * WHY 贴合缩放:纹理会被拉伸到 DOM 标题矩形上,若短标题(如中文)按
 * 基准字号只占纹理一角,显影出来的字会比 DOM 小一圈;以折行结果的最宽行
 * 与总高把字号缩放到贴满纹理(断行保持不变,缩放不改变行内容)。
 */
export async function renderTextTexture(
  text: string,
  opts: { fontPx: number; width: number; height: number; color: string }
): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d 上下文不可用");
  ctx.clearRect(0, 0, opts.width, opts.height);
  ctx.fillStyle = opts.color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `500 ${opts.fontPx}px ${SERIF_FAMILY}`;
  const maxW = opts.width * 0.86;
  const maxH = opts.height * 0.86;
  // 简单折行:按空格与 CJK 字符断行,行高 1.15
  const lines = wrapText(ctx, text, maxW);
  const widest = Math.max(
    1,
    ...lines.map((line) => ctx.measureText(line).width)
  );
  const scale = Math.min(
    maxW / widest,
    maxH / (lines.length * opts.fontPx * 1.15)
  );
  const fontPx = opts.fontPx * scale;
  ctx.font = `500 ${fontPx}px ${SERIF_FAMILY}`;
  const lineH = fontPx * 1.15;
  const startY = opts.height / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, opts.width / 2, startY + i * lineH);
  });
  return canvas;
}

/** 按最大宽度折行:显式换行优先,再按空格分词与 CJK 单字断行 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const units = para.match(/[一-鿿]|\S+|\s/g) ?? [para];
    let cur = "";
    for (const u of units) {
      const probe = cur + u;
      if (ctx.measureText(probe).width > maxWidth && cur.trim() !== "") {
        lines.push(cur.trim());
        cur = u;
      } else {
        cur = probe;
      }
    }
    if (cur.trim() !== "") lines.push(cur.trim());
  }
  return lines;
}
