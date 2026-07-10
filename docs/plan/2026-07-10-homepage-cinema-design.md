# 首页影片化滚动设计稿：「一次生成」+ 墨线

日期：2026-07-10
状态：设计稿（待用户评审后出实施计划）
前置：docs/plan/2026-07-04-ui-overhaul.md（UI 重构主计划，本稿为首页动效的二期深化）

## 一、定位与验收线

用户明确要求：不是通用滚动特效的堆叠（parallax/reveal/marquee 属"谁都能做的"），
而是对标 Spotify、南孚官网的创造性整页影片——有贯穿主角、镜头语言、
段落交界处全部为被设计过的转场，全页高级衔接。

## 二、概念

**整页 = 一次真实的生成任务，从 prompt 到成品交付。**

- 主角：一块画布（canvas frame），从第一屏登场后钉在视口内直到终幕，滚动是推轨镜头。
- 连接组织：一根墨线（SVG 描边扫描），在画布不在场的"静默谷"牵引视线，
  并承担章节罗马数字、步骤刻度、分隔线等编辑部记号。
- 镜头语言：穿越（zoom-through）、增殖（multiplication）、选中回中（match cut）、
  首尾同像（bookend）。
- 呼吸原则：SLA/FAQ 保持素面排版作为静默谷——全程高潮等于没有高潮。

## 三、分镜脚本（现有段落 -> 影片角色映射）

内容与 i18n key 全部保留，只重新导演其呈现。HowItWorks 的四步文案
（steps.upload/generate/export + completion）不再独占钉住舞台，
改为影片的章节步骤标注（01-04），由墨线在对应幕的页边书写点亮。

| 幕 | 现有段落/组件 | 演出 | 滚动行程预算 |
|---|---|---|---|
| 序幕 | HeroSection | 空画布居中登场，巨号衬线标题在其身后分层退场（改造现有 HeroExit）；画布从此 sticky 钉住 | 200vh |
| 第一幕 输入 | Hero 副文案 + HowItWorks step01 | prompt 随滚动逐字打出（打字机式 scrub，光标闪烁）；画布内浮起颗粒噪点 | 并入序幕行程 |
| 第二幕 生成 | FeatureGrid + step02 | 核心奇观：滚动拖动"去噪影片"，画布内帧序列逐帧扫描（噪点 -> 成品）；FeatureGrid 三个卖点化作画布两侧随进度交替浮现的解说词，不再是卡片网格 | 300vh |
| 转场 A 穿越 | -- | 图像完成刹那镜头扎进画面：画布 scale 1 -> 18 放大穿越，图像暗部漫过视口，顺势完成明暗反转（纯 transform + opacity） | 150vh |
| 第三幕 宣言 | ManifestoSection | 墨底章节：白衬线大字逐字扫描（现有 TextScrub 迁入暗章），呼吸光晕反转 | 200vh |
| 转场 B 增殖 | -- | 墨色中亮起画布残影（白色小矩形），滚动令其 1 分 2、4 分 16，细胞分裂式铺成网格，底色随分裂转回纸白 | 200vh |
| 第四幕 展墙 | UseCasesSection + Testimonials + step03 | 网格横向拉开成展墙（竖滚驱动横移 scroll-jack）：样张配衬线铭牌 + 罗马编号；用户评价化作画框间的"观展者低语"（替代跑马灯） | 400vh |
| 转场 C 选中 | -- | 镜头推近展墙中央一幅，它脱墙回到视口中央，与序幕画布同位同尺寸（match cut 前半） | 100vh |
| 第五幕 装裱 | PricingSection | 选中作品下方展开"装裱规格"——现有定价轮播交互原样保留，语义重新包装为画框规格陈列 | 常规流 |
| 静默谷 | SlaStatusSection + FAQSection | 素面排版；墨线沿页边行进牵引视线，写出章节数字 | 常规流 |
| 终幕 完成 | CTASection + step04/completion | 画布最后一次呈现并长出精装画框，画面淡出为空白纸面 + 闪烁光标——"下一张，由你来生成"；构图与序幕完全相同（bookend 闭环） | 200vh |

钉住段合计约 1750vh（约 17 屏行程）+ 常规流谷段。各幕 vh 为初值，
实施期按试滚手感统一调参（单处常量表配置）。

## 四、墨线系统

- 一根概念上连续的线，工程上按段落分段实现：每段一个 SVG path，
  strokeDashoffset 随该段滚动进度扫描；相邻段首尾坐标对齐制造"同一根线"的错觉。
- 职责：静默谷页边行进、章节罗马数字与步骤刻度（01-04）的书写、
  段落分隔线的生长、终幕前汇入 CTA 墨底。
- 移动端与 reduced-motion：线以静态完成态呈现（不扫描）。

## 五、技术架构

新增目录 `apps/web/src/features/marketing/components/cinema/`：

| 模块 | 职责 |
|---|---|
| cinema-canvas.tsx | 画布主角：sticky 主舞台、帧扫描 canvas 元素、装裱边框状态机 |
| frame-scrubber.ts | 帧序列扫描器：useTransform 进度 -> requestAnimationFrame 节流的 canvas drawImage；帧图预加载与解码（createImageBitmap） |
| scene-opening.tsx / scene-generate.tsx / scene-manifesto.tsx / scene-wall.tsx / scene-finale.tsx | 各幕编排（钉住行程、元素 choreography） |
| transitions.tsx | 三大转场：穿越（ZoomThrough）、增殖（Multiply）、选中回中（PickAndReturn） |
| ink-thread.tsx | 墨线分段系统 + 罗马数字/步骤刻度书写 |
| cinema-config.ts | 全片行程常量表（各幕 vh、转场窗口、缓动），单点调参 |

复用与铁律：

- 复用 scroll-fx.tsx 的 ScrollStage/TextScrub 原语；
- framer-motion 12 两条坑必须遵守：函数式 useTransform 回调 + transform 与
  opacity/普通样式分层绑定（memory: framer-motion-scroll-gotchas）；
- 动画仅 transform/opacity + 单 canvas 绘制；明暗反转用预渲染黑色大圆
  transform scale 扩张，不用全屏 clip-path 逐帧重绘；
- 离屏舞台用 IntersectionObserver 挂起（不订阅 scroll、不绘帧）；
- will-change 只加在钉住段活动节点，谷段清除。

## 六、资产策略（去噪帧序列）

- v1 程序化伪去噪：一张成品样张派生——顶层噪点纹理（canvas 生成一次）
  + 3-4 档预模糊变体，按进度交叉淡化 + 噪点透明度衰减，视觉近似扩散去噪；
  零外部资产依赖，立即可做。
- 接口预留真实帧序列：frame-scrubber 接受 N 帧图片数组；后续可用产品
  自身生成中间步快照（20-40 帧 WebP，约 1024px）放入 `public/cinema/frames/`
  即可无缝替换。展墙样张沿用现有营销素材。

## 七、功能与内容不变式

- 所有 i18n key 继续使用（FeatureGrid 卖点、HowItWorks 四步、宣言、评价、定价、FAQ）；
- Pricing 的查询/升级交互、SLA 数据流、FAQ 内容与 Server Components 数据获取不动；
- 全部正文保持真实 DOM（服务端渲染，SEO 不受影响），影片层是客户端增强；
- 首屏无 JS 时即为完整可读的序幕静态构图（渐进增强）。

## 八、回退策略

- `prefers-reduced-motion`：全片退化为静态编排版（各幕内容按普通文档流排版，
  沿用现有 StaticSteps 模式推广到全部幕）；
- 移动端（< md）：同静态编排 + 展墙退化为原生横滑 snap（复用定价轮播方案）；
- 弱设备：帧扫描器检测 devicePixelRatio 与首帧绘制耗时，超阈值降为
  三档关键帧淡化。

## 九、验收标准

1. 桌面 Chrome/Edge 滚动 60fps，DevTools Performance 抽查无长任务掉帧；
2. 任意位置滚回可完整倒放，无状态残留；
3. 三大转场（穿越/增殖/选中回中）与 bookend 闭环肉眼连贯，段落间无"断口"；
4. reduced-motion 与移动端内容完整可读、交互可用；
5. turbo typecheck / lint / build 全绿；
6. 首页 LCP 不劣化（正文服务端渲染，帧图懒加载不入首屏关键路径）。

## 十、实施阶段划分（供实施计划展开）

1. cinema 骨架：config + 画布主角 + 序幕/第一幕（打字 + 噪点）；
2. 第二幕帧扫描器 + 解说词编排（含程序化伪去噪资产管线）；
3. 转场 A 穿越 + 第三幕宣言迁入暗章；
4. 转场 B 增殖 + 第四幕展墙 + 转场 C；
5. 第五幕装裱包装 + 终幕 bookend；
6. 墨线系统全页铺设；
7. 回退层（静态编排/移动端/弱设备）与性能核验；
8. 旧组件退役清理（HowItWorks 钉住舞台、Testimonials 跑马灯）与文档更新。

每阶段独立 commit；阶段 4、8 结束各打一次视觉走查。
