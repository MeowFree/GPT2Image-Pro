"use client";

/**
 * 谷段二折「润格廊」:Pricing 的 sticky 廊道舞台(v1.0.1 跟随化)。
 * 仅由 pricing-section 在 lg+ 且非减动效时启用;窄屏/减动效/SSR
 * 走轮播轨,本层不做回退判断。
 * 书画家挂单卖画的润格传统走成一条展廊:竖向滚动驱动轴列横移
 * (与影片展墙"竖滚横推"同一镜头语言),页边那根墨线在廊顶横生为
 * 挂杆,五幅立轴被镜头逐一带到——挂绳绷直、卷轴自上而下真实展开
 * (clip 露纸 + 地杆作为卷筒沿展开线下滚,内容不变形);滚动速度
 * 化作挂轴微摆(快滚轴晃、停下回稳,全片触觉签名);行程尾声签条
 * 同拍落款、推荐轴描边浮现,静止一拍收幕。
 * 全部量为滚动进度纯函数(spring 仅作平滑跟随,目标始终由进度
 * 决定),滚回即倒放。业务内容(Card/订阅交互)由调用方注入,本层
 * 纯演出、零 i18n。
 */
import {
  type MotionValue,
  motion,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
} from "framer-motion";
import { type ReactNode, useRef } from "react";

/** 窗口线性段 */
const seg = (p: number, a: number, b: number) =>
  Math.max(0, Math.min(1, (p - a) / (b - a)));

/** easeInOutCubic:横移与展卷的起收呼吸 */
function easeInOut(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  const u = -2 * t + 2;
  return 1 - (u * u * u) / 2;
}

/** 轴面几何与行程相位常量(单点调参;卡宽须与 lg 断点轴宽一致) */
const CARD_W = 350;
const CARD_GAP = 24;
const STEP = CARD_W + CARD_GAP;
/** 横移窗口:首轴对中出发,列尾右对齐收束 */
const RAIL_WINDOW = [0.05, 0.85] as const;
const CENTER_INDEX = 2;
/** 落幅时列尾与视口右缘的边距 */
const EDGE_PAD = 24;

/**
 * 横移终点:列尾右对齐(最高两档完整亮相,裁掉的只是首档)——
 * 走查实证:终点若取推荐档对中,1280 视口下 enterprise 全程只露
 * 边缘,订阅按钮永不可达。宽视口(约 1894+)列已全见,回退为推荐
 * 档对中保住"走过廊道"的镜头量。
 */
function railEndX(viewportW: number, count: number): number {
  const totalW = count * CARD_W + (count - 1) * CARD_GAP;
  const tailAligned = viewportW / 2 + CARD_W / 2 - totalW - EDGE_PAD;
  return Math.min(tailAligned, -CENTER_INDEX * STEP);
}
/** 逐轴展卷相位:镜头带到谁,谁垂落(先到先展,逐个跟随) */
const UNROLL_START = 0.1;
const UNROLL_STEP = 0.13;
const UNROLL_SPAN = 0.26;
/** 落幅窗口:签条落款/描边浮现,其后为静止一拍 */
const SETTLE_WINDOW = [0.87, 0.94] as const;

export interface PlanGalleryItem {
  planId: string;
  /** 推荐档(签条与落幅描边只属于它;当前订阅档由 badge 自带) */
  popular: boolean;
  /** 轴身内容(Card 全体,业务交互在内) */
  card: ReactNode;
  /** 签条(推荐/当前),无则 null */
  badge: ReactNode;
}

/**
 * 单幅挂轴:自身展卷相位 + 全列摆动的逐轴微差。
 * transform(rotate/scaleY/y)与 opacity 分层绑定(铁律)。
 */
function HangingScroll({
  index,
  item,
  progress,
  sway,
}: {
  index: number;
  item: PlanGalleryItem;
  progress: MotionValue<number>;
  sway: MotionValue<number>;
}) {
  // 展卷进度:相位窗口纯函数 -> spring 平滑(纸卷的重量)
  const unrollRaw = useTransform(progress, (v) =>
    easeInOut(
      seg(
        v,
        UNROLL_START + UNROLL_STEP * index,
        UNROLL_START + UNROLL_STEP * index + UNROLL_SPAN
      )
    )
  );
  const unroll = useSpring(unrollRaw, { stiffness: 95, damping: 19 });
  // 展卷 = 裁切线下移露纸(内容不变形);展毕撤除 clip,
  // 否则 hover 投影会被裁切线切掉下缘
  const clipPath = useTransform(unroll, (v) =>
    v >= 0.995 ? "none" : `inset(0 0 ${((1 - v) * 100).toFixed(2)}% 0)`
  );
  // 卷筒前沿:地杆骑在展开线上随之下滚,展毕落底成为地杆
  // (6px 是终态地杆与轴身的装帧缝)
  const edgeTop = useTransform(
    unroll,
    (v) => `calc(${(v * 100).toFixed(2)}% + ${(v * 6).toFixed(1)}px)`
  );
  // 挂绳:轴挂上杆的一瞬绷直,随后承重不再变化
  const ropeScale = useTransform(unroll, (v) => Math.min(1, v / 0.18));
  // 全列同源摆动的逐轴微差(挂物各有轻重,不齐步)
  const rotate = useTransform(sway, (v) => v * (0.88 + index * 0.06));
  // 落幅:全轴同拍(倒放收回)
  const settle = useTransform(progress, (v) =>
    seg(v, SETTLE_WINDOW[0], SETTLE_WINDOW[1])
  );
  const badgeY = useTransform(settle, (v) => (1 - v) * -10);

  return (
    <motion.div
      style={{ rotate, transformOrigin: "top center" }}
      className="flex w-[350px] shrink-0 flex-col"
    >
      {/* 挂绳区:两根细绳自挂杆垂下(顶边即挂杆位置)。
          h-6:全轴总高须容于 900px 紧视口(挂杆到地杆一屏收纳) */}
      <div aria-hidden="true" className="relative h-6">
        <motion.span
          style={{ scaleY: ropeScale }}
          className="absolute left-[22%] top-0 h-full w-px origin-top bg-foreground/50"
        />
        <motion.span
          style={{ scaleY: ropeScale }}
          className="absolute right-[22%] top-0 h-full w-px origin-top bg-foreground/50"
        />
      </div>
      {/* 卷杆(上):展卷前就挂在绳上 */}
      <div
        aria-hidden="true"
        className="-mx-2 mb-1.5 h-1.5 rounded-full bg-foreground/75"
      />
      <div className="relative flex-1">
        <motion.div style={{ clipPath }} className="h-full">
          {item.card}
        </motion.div>
        <motion.div
          aria-hidden="true"
          style={{ top: edgeTop }}
          className="absolute inset-x-0"
        >
          <div className="relative -mx-3.5 h-2 rounded-full bg-foreground/85">
            <span className="absolute -left-1 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-foreground" />
            <span className="absolute -right-1 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-foreground" />
          </div>
        </motion.div>
        {/* 签条落款:落幅一拍自杆上垂挂(外层 opacity 内层 y,分层) */}
        {item.badge ? (
          <motion.div
            style={{ opacity: settle }}
            className="absolute -top-3 left-1/2 z-10 -translate-x-1/2"
          >
            <motion.div style={{ y: badgeY }}>{item.badge}</motion.div>
          </motion.div>
        ) : null}
        {/* 推荐轴落幅描边:行程收束时浮现的装裱线 */}
        {item.popular ? (
          <motion.div
            aria-hidden="true"
            style={{ opacity: settle }}
            className="pointer-events-none absolute inset-0 border border-foreground/30"
          />
        ) : null}
      </div>
    </motion.div>
  );
}

/**
 * 廊道舞台:240vh 行程,sticky 视口内竖滚驱动横移。
 * 落幅构图(1280 视口):推荐档居中,相邻两档全幅可见,首末两档
 * 缘边暗示——想回看,滚回即倒放,这正是影片教给观众的浏览方式。
 */
export function PlanGalleryStage({ items }: { items: PlanGalleryItem[] }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { scrollYProgress } = useScroll({
    target: stageRef,
    offset: ["start start", "end end"],
  });
  // 横移:easeInOut 起收 + spring 平滑跟随。终点读视口宽(仅客户端
  // 执行,scroll 每帧重算,resize 后随下次滚动自愈——canvasWidth 先例)
  const railTarget = useTransform(scrollYProgress, (v) => {
    const w = typeof window === "undefined" ? 1280 : window.innerWidth;
    return (
      railEndX(w, items.length) *
      easeInOut(seg(v, RAIL_WINDOW[0], RAIL_WINDOW[1]))
    );
  });
  const railX = useSpring(railTarget, { stiffness: 70, damping: 20 });
  // 滚动速度 -> 挂轴微摆:列左移时轴底因惯性滞后向右偏,
  // 钳制 ±1.4 度,弹簧回稳(快滚轴晃、停下即定)
  const railVelocity = useVelocity(railX);
  const swayTarget = useTransform(railVelocity, (v) =>
    Math.max(-1.4, Math.min(1.4, v * -0.0035))
  );
  const sway = useSpring(swayTarget, { stiffness: 55, damping: 10 });
  // 挂杆:页边那根墨线在廊顶自左向右横生(InkThread 在本段左缘)
  const rodScale = useTransform(scrollYProgress, (v) => seg(v, 0, 0.1));

  return (
    <div ref={stageRef} className="relative h-[240vh]">
      {/* pt-16:挂杆让出站点 header 的遮挡带;justify-start 使轴顶
          恒贴 header 之下,长轴向下伸展(挂物上悬是展廊常态) */}
      <div className="sticky top-0 flex h-screen flex-col justify-start overflow-hidden pt-16">
        <div className="relative">
          <motion.div
            aria-hidden="true"
            style={{ scaleX: rodScale }}
            className="absolute inset-x-[3vw] top-0 h-px origin-left bg-foreground/60"
          />
          <motion.div
            style={{ x: railX, paddingLeft: `calc(50vw - ${CARD_W / 2}px)` }}
            className="flex items-stretch"
            // gap 以内联样式固定:相位几何依赖 STEP,与断点类解耦
          >
            {items.map((item, index) => (
              <div
                key={item.planId}
                style={{ marginRight: index === items.length - 1 ? 0 : CARD_GAP }}
                className="flex shrink-0"
              >
                <HangingScroll
                  index={index}
                  item={item}
                  progress={scrollYProgress}
                  sway={sway}
                />
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </div>
  );
}
