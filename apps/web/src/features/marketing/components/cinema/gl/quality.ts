/**
 * 质量调控器:滚动出帧耗时的指数滑动平均驱动分档。
 * WHY 滞回:降档阈值(慢)与升档阈值(快)分开,且升档需连续快帧计数,
 * 避免临界机器上满档/降档来回震荡。纯逻辑,无 GL 依赖,可单测。
 * v1.2 单项熔断:pickBreakerVictim 从带成本的 pass 中挑"最贵可缺"者
 * 先行牺牲(观感损失小于整档跳变),升档时按后进先出恢复。
 */

export type QualityTier = 0 | 1 | 2;

export interface QualityOptions {
  emaAlpha?: number;
  /** EMA 超过该毫秒数并持续 sustain 帧 -> 降一档 */
  downAtMs?: number;
  /** EMA 低于该毫秒数并持续 sustain 帧 -> 升一档 */
  upAtMs?: number;
  sustainFrames?: number;
}

export class QualityGovernor {
  private ema = 16;
  private slowStreak = 0;
  private fastStreak = 0;
  private current: QualityTier = 2;
  private readonly alpha: number;
  private readonly downAtMs: number;
  private readonly upAtMs: number;
  private readonly sustain: number;

  constructor(opts: QualityOptions = {}) {
    this.alpha = opts.emaAlpha ?? 0.1;
    this.downAtMs = opts.downAtMs ?? 32;
    this.upAtMs = opts.upAtMs ?? 12;
    this.sustain = opts.sustainFrames ?? 60;
  }

  get tier(): QualityTier {
    return this.current;
  }

  sample(frameMs: number): QualityTier {
    this.ema = this.ema * (1 - this.alpha) + frameMs * this.alpha;
    if (this.ema > this.downAtMs) {
      this.slowStreak += 1;
      this.fastStreak = 0;
    } else if (this.ema < this.upAtMs) {
      this.fastStreak += 1;
      this.slowStreak = 0;
    } else {
      this.slowStreak = 0;
      this.fastStreak = 0;
    }
    if (this.slowStreak >= this.sustain && this.current > 0) {
      this.current = (this.current - 1) as QualityTier;
      this.slowStreak = 0;
    }
    if (this.fastStreak >= this.sustain * 3 && this.current < 2) {
      this.current = (this.current + 1) as QualityTier;
      this.fastStreak = 0;
    }
    return this.current;
  }
}

/**
 * 单项熔断候选挑选:降档时先牺牲"贵且可缺"的单个 pass,
 * 而非整档跳变(观感损失最小化)。返回最高耗时 EMA 的候选 key;
 * 无候选返回 null。纯函数,可单测。
 */
export function pickBreakerVictim(
  candidates: readonly { key: string; cost: number; emaMs: number }[]
): string | null {
  let best: string | null = null;
  let bestMs = -1;
  for (const c of candidates) {
    if (c.cost <= 0) continue;
    if (c.emaMs > bestMs) {
      bestMs = c.emaMs;
      best = c.key;
    }
  }
  return best;
}
