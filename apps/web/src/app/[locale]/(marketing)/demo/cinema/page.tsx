/**
 * cinema 联调预览页:全片串联——CinemaFilm(七幕 + 三转场 + pass 装载)
 * + 谷段占位 + FinaleStage 终幕。谷段占位模拟 SLA/Pricing/FAQ 常规流,
 * 用于验证引擎休眠与终幕接管时序。仅开发联调用,
 * 首页集成完成后随 Task 14 删除。
 */
import {
  CinemaFilm,
  FinaleStage,
} from "@/features/marketing/components/cinema";

/** 谷段占位:常规流素面区块,站位 SLA/Pricing/FAQ(引擎应在此休眠) */
function ValleyPlaceholder({ label }: { label: string }) {
  return (
    <section className="flex min-h-[70vh] items-center justify-center border-t border-border">
      <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
    </section>
  );
}

export default function CinemaDemoPage() {
  return (
    <main className="bg-background">
      <CinemaFilm>
        <ValleyPlaceholder label="valley 01 / sla + pricing" />
        <ValleyPlaceholder label="valley 02 / faq" />
        <FinaleStage />
      </CinemaFilm>
    </main>
  );
}
