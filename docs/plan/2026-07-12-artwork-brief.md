# 首页影片 GPT Image 2 素材简报（v0.9）

状态：已完成（2026-07-12）。16 张全部经产品自身 v1 API 生成
（`scripts/gen-artworks.cjs`，本文档的 prompt 模板逐字使用），
`scripts/ingest-artworks.cjs` 统一化后已替换 `public/cinema/`；
原图母版入库 `scripts/artwork-src/`（AI 生成非确定性，不可复现）。

## 为什么要真实生图

程序化水墨引擎（`apps/web/scripts/paint-ink.cjs`）的质量是当前影片
上限；产品本身是 AI 生图平台，用产品生成的画作充当影片主角，
质量上限更高且叙事自证。十三节标准一：主角必须自身值得被看。

## 清单（16 张，全部方形）

| 编号 | 主题 | 用途 | 建议尺寸 |
|------|------|------|----------|
| hero | 一笔圆（enso） | 主角：显影/微距/穿越 | 2048 以上，越大越好（微距幕直接放大看笔触） |
| w01-w15 | 竹影/远山/孤舟/墨梅/云月/芦洲/飞瀑/松风/双鲤/塔影/燕柳/荷净/虹桥/疏雨/草书 | 展墙 15 幅 | 1024 以上 |

主题顺序与 `cinema-artworks.ts` 的 `WALL_CELL_SRCS` 及
`Cinema.wallTitles` 逐位对应（hero 在 index 14）。

## 统一 prompt 模板（英文，逐张替换 SUBJECT）

```
Traditional Chinese ink wash painting (shuimo) on warm off-white rice
paper, SUBJECT, minimalist composition with vast negative space (over
60 percent empty paper), confident single-stroke brushwork, dry-brush
flying-white texture (feibai), subtle ink bleed at stroke edges, pure
black ink monochrome, no color, no text, no seal, no watermark, no
signature, square composition
```

hero 的 SUBJECT：
`a single bold enso circle drawn in one continuous brushstroke, heavy
wet ink at the start of the stroke, dry scratchy trailing end`

w01-w15 的 SUBJECT（逐位）：

1. sparse bamboo stalks and leaves in wind
2. distant layered mountains in mist
3. a lone small boat on empty water
4. a single plum blossom branch
5. clouds crossing a pale moon
6. reeds by a riverbank
7. a tall waterfall between cliffs
8. wind through a lone pine tree
9. two carp swimming
10. a distant pagoda silhouette
11. swallows over willow branches
12. a single lotus flower and leaf
13. an arched stone bridge over water
14. sparse falling rain over a river
15. wild cursive calligraphy strokes (abstract, illegible)

## 硬性要求（保证 16 幅同一世界）

- 纯黑水墨、无任何彩色；留白超过一半；
- 不带文字、印章、落款、水印——朱砂印由管线统一程序化盖章
  （全片唯一强调色必须完全一致）；
- 暖白纸底（偏米色而非纯白）；方形。

## 接收后的统一化管线（待素材到位后实现）

`apps/web/scripts/ingest-artworks.cjs`（node + sharp，确定性）：

1. 底色归一：直方图白点映射到纸色 #f5f2ea，黑点对齐墨色；
2. 统一纸纹：叠加与 paint-ink.cjs 相同的纤维噪声（soft-light）；
3. 统一朱砂印：hero 右下盖「一」字章，墙作不盖（展墙铭牌已具名）；
4. 深度图：hero 亮度反相 + 高斯模糊，输出 artwork-hero-depth.webp；
5. 导出：hero 2048（微距幕需要）+ 墙作 640，webp q82。

输出路径与现役文件同名（`public/cinema/artwork-hero.webp`、
`wall/w01..w15.webp`），前端零改动。
