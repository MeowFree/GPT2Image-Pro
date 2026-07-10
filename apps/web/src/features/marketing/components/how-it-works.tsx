"use client";

/**
 * 使用流程:钉住式四幕滚动播片(Scroll-Driven)。
 *
 * 区块占 400vh 滚动行程,视口 sticky 钉住;滚动进度切幕:
 * 左侧巨号步骤数字与文案交叉淡入淡出,右侧图标盘随进度旋转缩放,
 * 底部进度细线随滚动生长。滚回即倒放。i18n key 与步骤内容不变。
 * reduced-motion / 移动竖屏空间不足时退化为静态三段列表。
 */

import {
  type MotionValue,
  motion,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { Check, Download, MessageSquare, Settings } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ScrollStage } from "./scroll-fx";

/** 四幕:三个操作步骤 + 完成幕(标题"四步"即含完成,i18n 路径不同故带全路径) */
const stepConfig = [
  {
    key: "upload",
    icon: Settings,
    step: "01",
    titlePath: "steps.upload.title",
    descPath: "steps.upload.description",
  },
  {
    key: "generate",
    icon: MessageSquare,
    step: "02",
    titlePath: "steps.generate.title",
    descPath: "steps.generate.description",
  },
  {
    key: "export",
    icon: Download,
    step: "03",
    titlePath: "steps.export.title",
    descPath: "steps.export.description",
  },
  {
    key: "completion",
    icon: Check,
    step: "04",
    titlePath: "completion.title",
    descPath: "completion.description",
  },
] as const;

/**
 * 幕激活度(0-1):按滚动进度到幕中心的归一化距离计算。
 * WHY 函数式:range-array 版 useTransform 在本场景实测出现个别
 * transform 绑定错乱(执行了不相干映射),函数式回调逐帧纯计算,无此问题。
 * 首末幕在舞台两端保持激活,避免首尾空窗。
 */
function stepActivation(p: number, index: number): number {
  const count = stepConfig.length;
  const center = (index + 0.5) / count;
  let dist = Math.abs(p - center) * count;
  if (index === 0 && p <= center) dist = 0;
  if (index === count - 1 && p >= center) dist = 0;
  // dist 0-0.5 为本幕腹地(全亮),0.5-1 与邻幕交叉淡化
  return Math.max(0, Math.min(1, (1 - dist) * 2.2 - 0.2));
}

/** 单幕内容:透明度/位移由所属进度窗口驱动 */
function StageStep({
  progress,
  index,
  isZh,
}: {
  progress: MotionValue<number>;
  index: number;
  isZh: boolean;
}) {
  const t = useTranslations("HowItWorks");
  const opacity = useTransform(progress, (p) => stepActivation(p, index));
  // 位移与激活度联动:未激活时按滚动方向从 48px 外滑入/滑出
  const y = useTransform(progress, (p) => {
    const activation = stepActivation(p, index);
    const center = (index + 0.5) / stepConfig.length;
    const direction = p < center ? 1 : -1;
    return (1 - activation) * 48 * direction;
  });
  const step = stepConfig[index];
  if (!step) return null;
  const Icon = step.icon;

  return (
    // WHY 拆两层:framer-motion 12 实测同节点混绑 transform(y)与 opacity 时
    // opacity 订阅失效冻结;transform 与 opacity 分层各自绑定即恢复。
    <motion.div style={{ y }} className="absolute inset-0">
      <motion.div
        style={{ opacity }}
        className="flex h-full flex-col justify-center"
      >
        <span className="mb-6 font-serif text-7xl font-medium leading-none text-foreground/10 md:text-9xl">
          {step.step}
        </span>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-sm uppercase tracking-widest text-muted-foreground">
            {isZh ? `步骤 ${step.step}` : `Step ${step.step}`}
          </span>
        </div>
        <h3 className="mb-4 max-w-xl font-serif text-3xl font-medium leading-[1.15] tracking-tight md:text-5xl">
          {t(step.titlePath)}
        </h3>
        <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
          {t(step.descPath)}
        </p>
      </motion.div>
    </motion.div>
  );
}

/** 右侧图标盘:随全程进度旋转 + 各图标在自己的幕内点亮 */
function StageDial({ progress }: { progress: MotionValue<number> }) {
  const rotate = useTransform(progress, [0, 1], [0, -180]);
  return (
    <div className="relative hidden h-[420px] w-[420px] shrink-0 lg:block">
      {/* 外环:细线大圆随滚动缓转 */}
      <motion.div
        style={{ rotate }}
        className="absolute inset-0 rounded-full border border-border"
      >
        {stepConfig.map((step, index) => {
          const angle = index * (360 / stepConfig.length) - 90;
          return (
            <div
              key={step.key}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `rotate(${angle}deg) translateX(210px) rotate(${-angle}deg) translate(-50%, -50%)`,
              }}
            >
              <StageDialIcon progress={progress} index={index} />
            </div>
          );
        })}
      </motion.div>
      {/* 中心呼吸光晕 */}
      <div className="absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/[0.05] blur-3xl motion-safe:animate-[breathe_8s_ease-in-out_infinite]" />
    </div>
  );
}

/** 图标盘上的单个图标:所属幕激活时反色放大 */
function StageDialIcon({
  progress,
  index,
}: {
  progress: MotionValue<number>;
  index: number;
}) {
  const scale = useTransform(
    progress,
    (p) => 0.85 + stepActivation(p, index) * 0.3
  );
  const opacity = useTransform(
    progress,
    (p) => 0.35 + stepActivation(p, index) * 0.65
  );
  const step = stepConfig[index];
  if (!step) return null;
  const Icon = step.icon;
  return (
    // transform 与 opacity 分层绑定(同上 WHY)
    <motion.span style={{ scale }} className="block">
      <motion.span
        style={{ opacity }}
        className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-background shadow-whisper"
      >
        <Icon className="h-6 w-6" />
      </motion.span>
    </motion.span>
  );
}

/** 底部进度细线:随全程进度生长 */
function StageProgress({ progress }: { progress: MotionValue<number> }) {
  const scaleX = useTransform(progress, [0, 1], [0, 1]);
  return (
    <div className="absolute bottom-14 left-0 right-0">
      <div className="container">
        <div className="h-px w-full bg-border">
          <motion.div
            style={{ scaleX }}
            className="h-px origin-left bg-foreground"
          />
        </div>
      </div>
    </div>
  );
}

/** 静态回退:reduced-motion 与小屏用的普通三段列表 */
function StaticSteps({ isZh }: { isZh: boolean }) {
  const t = useTranslations("HowItWorks");
  return (
    <div className="container py-20">
      <div className="mx-auto max-w-3xl space-y-16">
        {stepConfig.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.key}>
              <span className="mb-4 block font-serif text-6xl font-medium leading-none text-foreground/10">
                {step.step}
              </span>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm uppercase tracking-widest text-muted-foreground">
                  {isZh ? `步骤 ${step.step}` : `Step ${step.step}`}
                </span>
              </div>
              <h3 className="mb-3 font-serif text-3xl font-medium tracking-tight">
                {t(step.titlePath)}
              </h3>
              <p className="max-w-lg leading-relaxed text-muted-foreground">
                {t(step.descPath)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function HowItWorks() {
  const t = useTranslations("HowItWorks");
  const isZh = useLocale().startsWith("zh");
  const reduceMotion = useReducedMotion();

  return (
    // 全幅浅底节:与前后 bg-background 节形成明暗交替的书页节奏
    <section id="how-it-works" className="bg-secondary/50">
      <div className="container pt-20 md:pt-28">
        <div className="mx-auto mb-4 max-w-4xl text-center">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t("label")}
          </p>
          <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-5xl">
            {t("title")}
          </h2>
          <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
            {t("subtitle")}
          </p>
        </div>
      </div>

      {reduceMotion ? (
        <StaticSteps isZh={isZh} />
      ) : (
        <>
          {/* 桌面/横屏:钉住舞台,320vh 行程内滚动切幕 */}
          <div className="hidden md:block">
            <ScrollStage heightVh={400}>
              {(progress) => (
                <div className="relative flex h-full w-full items-center">
                  <div className="container flex items-center justify-between gap-16">
                    <div className="relative h-[420px] flex-1">
                      {stepConfig.map((step, index) => (
                        <StageStep
                          key={step.key}
                          progress={progress}
                          index={index}
                          isZh={isZh}
                        />
                      ))}
                    </div>
                    <StageDial progress={progress} />
                  </div>
                  <StageProgress progress={progress} />
                </div>
              )}
            </ScrollStage>
          </div>
          {/* 移动端:静态列表(小屏 sticky 播片易误触且空间不足) */}
          <div className="md:hidden">
            <StaticSteps isZh={isZh} />
          </div>
        </>
      )}

      <div className="container pb-20 md:pb-4" />
    </section>
  );
}
