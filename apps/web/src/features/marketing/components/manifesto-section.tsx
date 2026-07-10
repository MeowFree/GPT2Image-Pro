"use client";

/**
 * 宣言区:整屏衬线宣言,滚动逐词(中文逐字)点亮。
 *
 * Scroll-Driven 的"阅读节奏"段落:文字以 15% 透明度铺底,
 * 随滚动进度从左到右扫亮,滚回即倒放。双语走组件内 copy() 模式
 * (营销组件既有先例),不新增 messages key。
 */

import { useLocale } from "next-intl";
import { TextScrub } from "./scroll-fx";

export function ManifestoSection() {
  const isZh = useLocale().startsWith("zh");

  // 中文逐字点亮,西文逐词点亮(词间补回空格)
  const words = isZh
    ? Array.from("少即是多。一句话，一幅画。让创作回到语言本身。")
    : "Less, but better. One sentence, one image. Creation returns to language itself."
        .split(" ")
        .map((word, index, arr) =>
          index < arr.length - 1 ? `${word} ` : word
        );

  return (
    <section className="py-28 md:py-40">
      <div className="container">
        <div className="mx-auto max-w-4xl">
          <TextScrub
            words={words}
            className="text-balance text-center font-serif text-3xl font-medium leading-[1.4] tracking-tight text-foreground md:text-5xl md:leading-[1.35]"
          />
        </div>
      </div>
    </section>
  );
}
