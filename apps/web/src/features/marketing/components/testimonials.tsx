"use client";

import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@repo/ui/components/avatar";
import { Card, CardContent } from "@repo/ui/components/card";

export function Testimonials() {
  const t = useTranslations("Testimonials");

  const testimonialItems = t.raw("items") as Array<{
    content: string;
    author: string;
    role: string;
  }>;

  return (
    // 全幅浅底节:与相邻 bg-background 节交替,营造书页节奏
    <section className="bg-secondary/50 py-20 md:py-28">
      <div className="container">
        <div className="mx-auto max-w-6xl">
          {/* Header */}
          <div className="mb-16 text-center">
            <p className="mb-2 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t("label")}
            </p>
            <h2 className="mb-4 text-balance font-serif text-3xl font-medium tracking-tight md:text-4xl">
              {t("title")}
            </h2>
            <p className="mx-auto max-w-2xl leading-relaxed text-muted-foreground">
              {t("subtitle")}
            </p>
          </div>

          {/* Testimonials Grid - 浅底节上用白纸卡片形成层次 */}
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {testimonialItems.map((testimonial) => (
              <Card
                key={`${testimonial.author}-${testimonial.role}`}
                className="border-border bg-background shadow-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/30 hover:shadow-whisper"
              >
                <CardContent className="p-6">
                  <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                    &ldquo;{testimonial.content}&rdquo;
                  </p>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-foreground/10 font-serif text-foreground">
                        {testimonial.author.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-sm font-medium">
                        {testimonial.author}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {testimonial.role}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
