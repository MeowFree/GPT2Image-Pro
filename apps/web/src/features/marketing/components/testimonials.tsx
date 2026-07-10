"use client";

/**
 * 用户评价:无限走马灯。
 *
 * 视觉:整行评价卡缓慢左移循环(内容复制一份,位移 -50% 后无缝衔接),
 * 悬停暂停;两侧渐隐遮罩;reduced-motion 回退为静态网格。
 * 数据与文案 key 不变,仅展示层重构。
 */

import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@repo/ui/components/avatar";
import { Card, CardContent } from "@repo/ui/components/card";
import { Reveal } from "./reveal";

type TestimonialItem = {
  content: string;
  author: string;
  role: string;
};

/** 单张评价卡(走马灯与静态回退共用) */
function TestimonialCard({ item }: { item: TestimonialItem }) {
  return (
    <Card className="w-[320px] shrink-0 border-border bg-background py-0 shadow-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 hover:shadow-whisper sm:w-[360px]">
      <CardContent className="p-6">
        <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
          &ldquo;{item.content}&rdquo;
        </p>
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-foreground/10 font-serif text-foreground">
              {item.author.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">{item.author}</p>
            <p className="text-xs text-muted-foreground">{item.role}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function Testimonials() {
  const t = useTranslations("Testimonials");

  const testimonialItems = t.raw("items") as TestimonialItem[];

  return (
    // 全幅浅底节:与相邻 bg-background 节交替,营造书页节奏
    <section className="overflow-hidden bg-secondary/50 py-20 md:py-28">
      <div className="container">
        <Reveal className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
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
        </Reveal>
      </div>

      {/* 走马灯:hover 暂停;reduced-motion 下静止并允许横向滚动查看 */}
      <div className="group relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-secondary/50 to-transparent md:w-32"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-secondary/50 to-transparent md:w-32"
        />
        <div className="scrollbar-none motion-reduce:overflow-x-auto">
          <div className="flex w-max gap-6 pr-6 motion-safe:animate-[marquee_48s_linear_infinite] motion-safe:group-hover:[animation-play-state:paused]">
            {/* 内容渲染两遍实现 -50% 无缝循环 */}
            {[0, 1].map((pass) => (
              <div
                key={pass}
                aria-hidden={pass === 1}
                className="flex shrink-0 gap-6"
              >
                {testimonialItems.map((item) => (
                  <TestimonialCard
                    key={`${pass}-${item.author}-${item.role}`}
                    item={item}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
