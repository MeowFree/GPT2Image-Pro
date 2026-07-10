# UI 大改计划：全站衬线化 + 对齐 ./gpt2image 设计体系

> 日期：2026-07-04
> 范围：仅 UI 层（样式/动效/UI 性能/UI bug/UI 代码结构）。不触碰后端逻辑、API、计费、鉴权。
> 参考基准：`G:\AgentProjects\gpt2image\gpt2image`（原版 GPT2IMAGE，Vite + React）的 DESIGN.md 与 globals.css。

## 目标

1. 字体全部衬线体：中英文统一 Noto Serif / Noto Serif SC（可变字体，自托管），等宽仅保留给代码。
2. 全量向 ./gpt2image 对齐：token、圆角、过渡、交互手感、组件视觉。
3. 美化高级动态效果：主题圆形揭幕、fade-in 视图过渡、hover 微交互、骨架 shimmer。
4. 加强 UI 性能：懒加载重组件、减少重渲染、动画只用合成层属性。
5. 修复 UI bug 与不协调之处。
6. 大规模优化 UI 代码结构：删除死代码、提取重复模式。

## 参考项目对齐清单（已从 ./gpt2image 提取）

### Token（已基本对齐，存量在 packages/ui/src/globals.css）

| 类别 | 值 |
|---|---|
| 背景 | light: #ffffff / #f7f7f8 / #ececf1；dark: #1a1a1a / #242424 / #2e2e2e（暖调，非纯黑） |
| 文本 | #1a1a1a / #555568 / #8e8ea0 / #b4b4c4；dark: #e8e8e8 / #b0b0b0 / #808080 / #555555 |
| 边框 | #d9d9e3 / subtle #e8e8ed；dark #3a3a3a / #2e2e2e |
| 圆角 | sm 8 / md 12 / lg 18 / xl 24 |
| 过渡 | fast 150ms / normal 250ms / slow 400ms ease |
| 阴影 | menu: 0 4px 20px rgba(0,0,0,.08)；modal: 0 8px 40px rgba(0,0,0,.15)；whisper: 0 4px 24px rgba(0,0,0,.05) |

### 交互手感（需移植/对齐）

- 主题切换：从点击点 clip-path circle 收缩揭幕，550ms cubic-bezier(0.4,0,0.2,1)。【Phase 1 已移植】
- 视图入场：fade-in（opacity 0->1 + translateY 10px->0，400ms）。
- 下拉菜单：opacity + translateY(4px) 入场，150ms；触发器箭头 rotate 180deg。
- 图片卡 hover：整卡 overlay rgba(0,0,0,.4) 淡入 250ms，操作按钮背景 rgba(0,0,0,.6) + backdrop-blur(8px)。
- 加载点：pulse 1.2s（opacity 0.3<->1）；骨架 shimmer 1.5s（opacity 0.6<->1）。
- 序列化排版：标题衬线 500 字重；正文行高 1.6-1.7；小标签 uppercase + letter-spacing 1.2px。
- 悬浮删除按钮：默认 opacity 0，行 hover 时淡入。
- chip 建议标签：圆角 24px 胶囊、边框式、hover 提亮。

## 现状要点（Phase 0 侦察）

- Tailwind v4（@theme inline 于 packages/ui/src/globals.css），tw-animate-css 可用。
- token 已是 GPT2IMAGE 单色体系；圆角/过渡已对齐。
- 字体缺口（已修）：--font-serif 声明 Libre Baskerville 但从未加载；font-sans 为系统栈。
- html lang 硬编码 en（已修：根布局并入 [locale]/layout.tsx）。
- framer-motion 仅营销页使用（layout 注释明确防 bundle 泄漏）；dashboard 侧动画应 CSS-first。
- 仓库根存在游离 src/（271 个 git 跟踪文件，旧脚手架全套 app 结构），疑似死代码待删。
- 已知 UI bug（docs/TODO.md）：create 页 localStorage 恢复激活模式引发 hydration mismatch。
- 上帝组件：create-page-client.tsx 约 10k 行（defer 结构性拆分，本轮只做样式与安全的展示层抽取）。

## 阶段划分

### Phase 1 基础（已完成，commit 1be8ea1）

- @fontsource-variable/noto-serif + noto-serif-sc 自托管；font-sans/font-serif 双映射衬线栈。
- html lang 按 locale；OG locale 同步。
- @repo/ui/theme-reveal 圆形揭幕 + mode-toggle 接入。
- 阴影 token whisper/menu/modal。

### Phase 2 分区美化（并行子 Agent，文件集互不重叠）

划分原则：每个单元一个子 Agent，改动文件集合互不相交；统一的"对齐规范摘要"随任务下发。

已下发的单元边界（5 个并行子 Agent + 主控自持单元）：

- 单元 A（agent: unit-a-shell）：(dashboard)/layout + dashboard 首页 + features/dashboard/** + (auth)/** + features/auth/**
- 单元 B（agent: unit-b-gallery）：gallery-client/history-client/image-card/image-lightbox/recent-creations + export-psd-dialog + gallery/history 页面与 loading
- 单元 C（agent: unit-c-settings）：settings/billing/external-api/announcements/backend-help/credits-buy/support 用户侧页面 + features/settings + features/announcements + image-backend-pool/user-preference-section
- 单元 D（agent: unit-d-admin）：dashboard/admin 四页 + image-backend-pool/{admin-panel,chatgpt-register-tab} + packages/shared system-settings-panel + support admin- 组件（上帝组件只做样式层）
- 单元 E（agent: unit-e-marketing）：(marketing)/** + features/{marketing,blog,pseo} + docs/layout + features/docs/system-docs
- 单元 F（主控自持）：create-page-client（9708 行，仅关键修复+token 化）、video-create-panel、waterfall-warning-popup、create loading
- 原语层（主控已完成，d62c0ae）：packages/ui 全部基础组件

主控已完成的 F/基础项：
- create 页 hydration mismatch 修复 + 模式白名单补全 chat-web/video（d6a1951）
- success/warning 语义 token 映射进 @theme（d6a1951）
- 仓库根 278 个游离死文件清理（3de58e5）

集成审查清单（波次结束后主控执行）：
- Tabs 激活态改 bg-secondary 后，消费方对比样式校正（gallery countBadgeClass 等）
- 各单元报告的共享层请求合并处理
- turbo typecheck/lint/test/build 全绿终验

### Phase 3 UI 性能与 bug

- create 页 hydration mismatch 修复（持久化模式恢复置于 useEffect / 按套餐能力校正）。
- 重 Dialog/面板 next/dynamic 懒加载补全。
- 列表项 memo、派生状态 useMemo 热点排查。
- 动画审计：只允许 transform/opacity/clip-path；杜绝 layout 属性动画。

### Phase 4 结构优化

- 删除仓库根游离 src/（验证零引用后）。
- 提取重复 UI 模式：copy(en,zh) 双语 helper、二次确认按钮、空状态、加载态、状态 Badge。
- 终验：turbo typecheck + lint + test + build 全绿；提交推送 main。

## 验收

- 全站（含 docs/营销/admin）文字渲染为 Noto Serif/Noto Serif SC。
- 明暗双主题下视觉一致、无硬编码色破坏 token 体系。
- 主题切换、页面入场、卡片 hover、菜单展开均有统一动效。
- typecheck/lint/test/build 全绿；无新增 hydration 告警。

## 完成情况（2026-07-10）

全部 Phase 已落地 main，主体提交范围 1be8ea1 至 cb11e99（其后另有设置/工单/管理后台/认证/内容页第二轮精修与文档/版本收尾提交）；版本随本轮升至 v0.8.0（CHANGELOG 有条目）。

- **Phase 1 字体与 token**（1be8ea1 / d62c0ae / d6a1951）：Noto Serif / Noto Serif SC 自托管与 font-sans/font-serif 双映射、html lang 按 locale、主题圆形揭幕、whisper/menu/modal 阴影 token、success/warning 语义 token 进 @theme、packages/ui 基础原语全部对齐衬线单色体系。
- **Phase 2 两轮分区重构**：
  - 第一轮（并行子 Agent，单元 A-E + 共享层）：90793ce（A：dashboard 壳/认证）、299ea6d + 4af1249（B：图库/历史/灯箱/图片卡 + tab 计数徽标适配）、d42af74（C：设置/工单/账单/积分/公告）、f88e162（D：管理后台 + a11y 修复）、6534c34（E：营销/博客/pSEO/文档）、3ee65e9（共享包硬编码色 token 化 + OG 图单色化）、cface9c（F：视频创作面板微交互）。
  - 第二轮 v2 精修：6a2285d（营销首页编辑部级动效与轮播定价）、7b4480a（图库/历史高端画廊气质）、db27a19（创作页展示层分段控件与统一气泡语言）、0c1383f（dashboard 壳层悬浮玻璃顶栏/激活竖线/编辑部化页头）、0d64c37（hover 位移/缩放过渡失效与示例卡分层修复）；设置/工单/管理后台/认证/博客/pSEO/文档的第二轮精修随其后的收尾提交落地。
- **营销页滚动动效**（6dd3d10）：首页 Scroll-Driven Animation 滚动驱动动效层，函数式 + 分层绑定写法规避 framer-motion 混绑 transform+opacity 订阅失效坑（详见 memory/framer-motion-scroll-gotchas.md）。
- **Phase 3 hydration 与 a11y 修复**（d6a1951 / f88e162 等）：create 页 hydration mismatch 修复——持久化激活模式改为挂载后按套餐能力校验再恢复，并补全模式白名单缺失的 chat-web/video；管理后台等 a11y（label 关联）修复；create-page-client lint 由 7 error 清至 0 error（余 70 条告警级 warning）。
- **Phase 4 死代码清理**（3de58e5 / 4afd22d 等）：仓库根游离旧单体应用残留 278 个文件删除（零引用验证后）；分区重构中另清理 6 个死文件/死组件（ProfileForm、死 token 等）。

剩余项（转入 `docs/TODO.md`「2026-07-10 UI 全站重构」节跟踪）：
- copy(en,zh) 约 475 处内联双语迁移 next-intl（按 feature 分批）。
- ConfirmDialog / Spinner 统一封装进 packages/ui 并替换重复实现。
- 上帝组件（create-page-client.tsx 等）结构性拆分维持 defer。
- 图库/历史「加载更多」入场动画重播优化（动效限定到新增批次）。
