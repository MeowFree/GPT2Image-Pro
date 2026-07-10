/**
 * 质量调控器:滚动出帧耗时的指数滑动平均驱动分档。
 * WHY 滞回:降档阈值(慢)与升档阈值(快)分开,且升档需连续快帧计数,
 * 避免临界机器上满档/降档来回震荡。纯逻辑,无 GL 依赖,可单测。
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
