"use client";

/**
 * 第七幕「一行调用」:API 与批量能力的剧情化(v1.0)。
 * 墨底延续宣言章,等宽字逐字打出真实请求体(与序幕 prompt 打字互文
 * ——你会打字,你的程序也会),回车一拍后 4x4 墨点阵按序点亮
 * (十六张生成完成的物质表达,与增殖/展墙的 16 格同构),末行落
 * "200 OK · 16 张已生成"。材质世界观:等宽字即活字铅字,印刷属于
 * 纸墨体系。全部量为幕内进度纯函数,倒放成立;因果链:宣言(理念)
 * -> 一行调用(手段) -> 增殖(结果) -> 展墙(万象)。
 * 请求体不写域名(永真);lite/full 同一 DOM 演出,无 GL 依赖。
 */
import { motion, useMotionValueEvent, useTransform } from "framer-motion";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useSceneProgress } from "./cinema-stage";

/** 幕内窗口线性段 */
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

/** 请求体各行(等宽排版;prompt 引用序幕同一句的截断——同一个故事) */
const REQUEST_LINES = [
  "POST /v1/images/generations",
  "{",
  '  "prompt": "一笔浓墨，在宣纸上画一个圆…",',
  '  "n": 16',
  "}",
] as const;

/** 打字窗口 [0.06, 0.42]:总字符数内逐字推进,行间无停顿(机器打字) */
const TYPE_WINDOW: readonly [number, number] = [0.06, 0.42];
/** 点阵点亮窗口 [0.52, 0.82]:16 点按序亮起 */
const GRID_WINDOW: readonly [number, number] = [0.52, 0.82];

const TOTAL_CHARS = REQUEST_LINES.reduce(
  (acc, line) => acc + Array.from(line).length,
  0
);

/** 打字进度 -> 各行已显示文本(跨行连续分配) */
function typedLines(progress: number): string[] {
  let budget = Math.round(progress * TOTAL_CHARS);
  return REQUEST_LINES.map((line) => {
    const chars = Array.from(line);
    const take = Math.max(0, Math.min(chars.length, budget));
    budget -= take;
    return chars.slice(0, take).join("");
  });
}

export function InvokeScene() {
  const t = useTranslations("Cinema");
  const p = useSceneProgress("invoke");
  const [lines, setLines] = useState<string[]>(() => typedLines(0));
  const [litCount, setLitCount] = useState(0);
  useMotionValueEvent(p, "change", (v) => {
    setLines(typedLines(seg(v, TYPE_WINDOW[0], TYPE_WINDOW[1])));
    setLitCount(
      Math.round(seg(v, GRID_WINDOW[0], GRID_WINDOW[1]) * 16)
    );
  });
  // 注释行先亮(引导语),点阵回车后浮现,完成行在点阵全亮后落款
  const commentOpacity = useTransform(p, (v) => seg(v, 0.02, 0.08));
  const gridOpacity = useTransform(p, (v) => seg(v, 0.44, 0.52));
  const doneOpacity = useTransform(p, (v) => seg(v, 0.84, 0.92));
  const typingStarted = useTransform(p, (v) =>
    v > TYPE_WINDOW[0] ? 1 : 0
  );
  return (
    <div className="flex h-full items-center justify-center bg-[#0e0e0d]">
      <div className="w-[min(88vw,560px)] font-mono text-sm leading-relaxed md:text-base">
        {/* 引导注释:活字排版的旁白 */}
        <motion.p
          style={{ opacity: commentOpacity }}
          className="mb-6 text-white/45"
        >
          <span aria-hidden="true"># </span>
          {t("invokeComment")}
        </motion.p>
        {/* 请求体逐字打出 */}
        <motion.div style={{ opacity: typingStarted }} className="text-white/90">
          {lines.map((line, i) => (
            <p
              // 行序静态固定,索引即身份
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态行序列
              key={i}
              className="min-h-[1.6em] whitespace-pre"
            >
              {line}
              {i === activeLineIndex(lines) ? (
                <span className="ml-0.5 inline-block h-4 w-[7px] animate-pulse bg-white/80 align-middle" />
              ) : null}
            </p>
          ))}
        </motion.div>
        {/* 响应点阵:回车后浮现,16 张生成按序点亮(与增殖/展墙 16 格同构) */}
        <motion.div
          style={{ opacity: gridOpacity }}
          className="mt-8 grid w-fit grid-cols-8 gap-2"
        >
          {Array.from({ length: 16 }, (_, i) => (
            <span
              // 点阵位序静态固定,索引即身份
              // biome-ignore lint/suspicious/noArrayIndexKey: 静态点阵
              key={i}
              data-lit={i < litCount ? "true" : "false"}
              className="h-3 w-3 bg-white/10 transition-colors duration-300 data-[lit=true]:bg-[#f5f2ea]"
            />
          ))}
        </motion.div>
        <motion.p style={{ opacity: doneOpacity }} className="mt-6 text-white/60">
          {t("invokeDone")}
        </motion.p>
      </div>
    </div>
  );
}

/** 光标所在行:第一个未打满的行(全部打完后光标停在末行) */
function activeLineIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const full = Array.from(REQUEST_LINES[i] ?? "").length;
    const cur = Array.from(lines[i] ?? "").length;
    if (cur < full) return i;
  }
  return lines.length - 1;
}
