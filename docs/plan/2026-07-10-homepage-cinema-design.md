# 首页影片化滚动设计稿：「一次生成」+ 墨线（v2 极致渲染版）

日期：2026-07-10
状态：设计稿 v2（用户指示"穷尽一切想象力和渲染技术，做最极致的渲染动效"，
在 v1 分镜之上升级渲染层；v1 的 DOM/canvas2d 管线降级为中端回退，不浪费）
前置：docs/plan/2026-07-04-ui-overhaul.md（UI 重构主计划，本稿为首页动效二期深化）

## 一、定位与验收线

对标 Spotify、南孚官网：整页是一部有导演意识的影片——贯穿主角、镜头语言、
段落交界全部为被设计过的转场。通用滚动特效（parallax/reveal/marquee 堆叠）
不合格；渲染技术不设上限，以观感极致为第一优先级，以工程纪律保住 60fps。

## 二、概念

**整页 = 一次真实的生成任务，从 prompt 到成品交付。**

- 主角：一块画布，从第一屏登场后钉在视口内直到终幕；滚动是推轨镜头。
- 连接组织：一根墨线（SVG 描边扫描），在画布不在场的静默谷牵引视线，
  承担章节罗马数字、步骤刻度、分隔线等编辑部记号。
- 镜头语言：穿越（zoom-through 2.5D）、增殖（粒子重凝）、选中回中（match cut）、
  首尾同像（bookend）。
- 影调：黑白编辑部 + 胶片质感——全片一层纸纹颗粒与高光光晕后处理，
  monochrome 是世界观而非限制。
- 呼吸原则：SLA/FAQ 保持素面排版作为静默谷（GL 层整体休眠），
  全程高潮等于没有高潮。

## 三、渲染引擎（GL 摄影棚）

DOM 承载全部真实内容（SEO/可访问性），其上/其后架一层全屏 WebGL2 画布
（客户端动态加载，零 SSR 影响），DOM 元素经 bounding-rect 追踪与 GL 同步
（scrollrig 手法）。手写迷你引擎（全屏四边形多 pass + 实例化粒子），
不引入 three.js，全部效果为滚动进度的确定性函数，滚回即倒放。

核心能力：

1. **扩散去噪着色器**：蓝噪声阈值溶解 + 多倍频 simplex 噪声逐像素消融到
   成品纹理——每个像素按自己的阈值时刻"显影"，是真实的去噪过程视觉，
   而非模糊贴图交叉淡化。
2. **GPU 粒子系统**：实例化点精灵（十万级），从纹理采样取色；负责图像
   溶解/重凝、墨滴飞溅、增殖转场的布局间形变（particle morph）。
3. **墨水流体模拟**：半分辨率离屏 stable-fluids 求解器，反转章节用真实
   流动的墨吞没视口（涡旋卷曲边缘）；底层叠一张进度驱动的覆盖遮罩，
   保证反转在精确滚动点完成（流体是质感层，布局真相由遮罩保证）。
4. **2.5D 深度推轨**：主样张配深度图，穿越转场按深度分层视差 dolly，
   临界点像素拉伸为径向光痕（radial smear）后破入墨色世界。
5. **速度响应镜头**：滚动速度喂给垂直拖影/折射 uniform，快滚有"镜头惯性"，
   停下回弹——全片的触觉签名。
6. **衬线字 GL 化**：巨号标题渲到离屏纹理，经噪声阈值 + SDF 墨晕边缘显影
   ("墨渗入纸"而非淡入)；正文永远是真实 DOM。
7. **胶片后处理 pass**：纸纹颗粒、轻晕影、白部光晕（halation），
   全片统一影调。

工程纪律：

- 单 GL 上下文、单 rAF、按需渲染（滚动位置变化或模拟活跃时才出帧）；
- DPR 上限 1.5；流体/后处理离屏降采样；样张纹理图集合批；
- 静默谷经 IntersectionObserver 使 GL 完全休眠（不订阅、不出帧）；
- 自适应质量调控：帧耗时 EMA 超阈值自动降档（粒子数/模拟分辨率/后处理开关）；
- 回退阶梯：WebGL2 不可用或首帧探测过慢 -> v1 DOM/canvas2d 管线
  （伪去噪交叉淡化 + transform 转场）-> reduced-motion 静态编排。三层皆完整可读。

## 四、分镜脚本（现有段落 -> 影片角色映射）

内容与 i18n key 全部保留，只重新导演其呈现。HowItWorks 四步文案
（steps.upload/generate/export + completion）转为墨线书写的章节刻度 01-04。

| 幕 | 现有段落 | 演出（极致版） | 行程预算 |
|---|---|---|---|
| 序幕 | HeroSection | 一滴墨坠落（粒子飞溅 + 流体涟漪），SDF 墨晕晕开成巨号衬线标题；画布边框由墨线四条发丝线合拢画出；标题分层退场，画布钉住 | 200vh |
| 第一幕 输入 | Hero 副文案 + step01 | prompt 逐字打出，每个字符落纸带一次微型墨晕迸溅；画布内噪声随光标呼吸 | 并入序幕 |
| 第二幕 生成 | FeatureGrid + step02 | 核心奇观：蓝噪声阈值去噪逐像素显影；页边 EXIF 式采样步数 HUD（step 01 -> 28 跳动的日志读数）；FeatureGrid 卖点化作画布两侧随进度浮现的解说词 | 300vh |
| 转场 A 穿越 | -- | 镜头扎进完成的画面：深度图分层 2.5D dolly 推入，临界点像素拉成径向光痕，破入墨色——流体墨吞没视口完成明暗反转 | 150vh |
| 第三幕 宣言 | ManifestoSection | 墨底章节：白衬线大字循墨的流向显影（流体平流遮罩驱动 TextScrub 升级版），白部光晕呼吸 | 200vh |
| 转场 B 增殖 | -- | 画布残影在墨色中亮起，图像炸裂为粒子云，滚动驱动粒子在空中重凝为 16 格样张网格（布局间 particle morph），底色随重凝转回纸白 | 200vh |
| 第四幕 展墙 | UseCasesSection + Testimonials + step03 | 网格横向拉开成展墙：竖滚驱动横向推轨，每幅样张按各自深度做 2.5D 视差，玻璃展柜折射高光缓移；衬线铭牌 + 罗马编号；用户评价化作画框间的观展低语（DOM 同步层） | 400vh |
| 转场 C 选中 | -- | 中央一幅脱墙而出：GL 接触阴影加深、FLIP 同步飞回视口中央，与序幕画布同位同尺寸 | 100vh |
| 第五幕 装裱 | PricingSection | 选中作品下方展开"装裱规格"——现有定价轮播交互原样保留，画框发丝线挤出 + 镜面高光缓扫 | 常规流 |
| 静默谷 | SlaStatusSection + FAQSection | 素面排版，GL 休眠；墨线沿页边行进书写章节数字 | 常规流 |
| 终幕 完成 | CTASection + step04 | 同一枚蓝噪声着色器反向运行：图像逐像素退回空白纸面 + 闪烁光标——"下一张，由你来生成"；一滴墨再次坠落（bookend），涟漪，收幕 | 200vh |

钉住段合计约 1750vh（约 17 屏）+ 常规流谷段；各幕 vh 与转场窗口收敛在
cinema-config.ts 常量表，单点调参。

## 五、墨线系统

- 概念上一根连续的线，工程上分段 SVG path，strokeDashoffset 随段内进度扫描，
  相邻段首尾坐标对齐。
- 职责：静默谷页边行进、章节罗马数字与步骤刻度书写、分隔线生长、
  终幕前汇入墨底；序幕的墨滴与它是同一世界观的两种形态。
- 移动端与 reduced-motion：静态完成态。

## 六、技术架构

新增 `apps/web/src/features/marketing/components/cinema/`：

| 模块 | 职责 |
|---|---|
| gl/engine.ts | 迷你 WebGL2 引擎：上下文、全屏四边形 pass 链、纹理/图集、按需渲染循环、质量调控器 |
| gl/passes/denoise.ts | 蓝噪声阈值扩散显影着色器 |
| gl/passes/particles.ts | 实例化 GPU 粒子（溶解/重凝/墨溅/布局 morph） |
| gl/passes/fluid.ts | 半分辨率 stable-fluids 墨模拟 + 进度覆盖遮罩 |
| gl/passes/dolly.ts | 深度图 2.5D 推轨 + 径向光痕 |
| gl/passes/post.ts | 纸纹颗粒/晕影/halation 胶片后处理 |
| gl/dom-sync.ts | DOM bounding-rect 追踪与 GL 坐标同步（scrollrig） |
| cinema-canvas.tsx | 画布主角编排（挂接各 pass 与滚动进度） |
| scene-*.tsx | 各幕 choreography（opening/generate/manifesto/wall/finale） |
| transitions.tsx | 三大转场：ZoomThrough / Multiply / PickAndReturn |
| ink-thread.tsx | 墨线分段系统 |
| cinema-config.ts | 全片行程/转场窗口/缓动常量表 |
| fallback/ | v1 DOM/canvas2d 管线（中端回退）+ 静态编排（reduced-motion/移动端） |

复用与铁律：滚动进度仍由 framer-motion useScroll 供给（函数式 useTransform +
transform 与普通样式分层绑定的两条坑必须遵守）；GL uniform 由进度 MotionValue
的 on-change 喂入，不经 React 渲染。

## 七、资产策略

- 去噪帧：不再需要帧序列——着色器实时消融，仅需成品样张纹理 + 一张蓝噪声
  纹理（64KB 级，公版资源自带许可核验）。
- 深度图：主样张 1-2 张配深度图（离线单次生成或手绘灰度梯度即可满足
  2.5D 分层需求）。
- 展墙样张：沿用现有营销素材打图集；后续可用产品自产替换。
- 真实扩散中间步快照仍留接口（denoise pass 可切换为帧序列采样模式）。

## 八、功能与内容不变式

- 全部 i18n key 继续使用；Pricing 交互、SLA 数据流、FAQ 内容与
  Server Components 数据获取不动。
- 正文全部为真实 DOM（服务端渲染，SEO 不受影响）；GL 层为客户端增强，
  动态导入，不入首屏关键路径。
- 无 JS / GL 失败时首屏即为完整可读的序幕静态构图。

## 九、回退阶梯

1. 完整版：WebGL2 + 全部 pass（桌面主流 GPU）。
2. 中端版：v1 DOM/canvas2d 管线——伪去噪交叉淡化、transform 转场、无流体/粒子
   （WebGL2 不可用、首帧探测过慢、或质量调控降至底档）。
3. 静态版：reduced-motion 与 < md 移动端——静态编排 + 展墙退化原生横滑 snap；
   墨线呈完成态。

## 十、验收标准

1. 桌面 Chrome/Edge/Safari 滚动 60fps（DevTools Performance 无 >50ms 长任务）；
   质量调控在集显设备可验证降档。
2. 任意位置滚回可完整倒放（流体章节允许质感层非确定，布局遮罩精确可逆）。
3. 三大转场与 bookend 闭环肉眼连贯，段落间无断口。
4. 三层回退各自完整可读、交互可用。
5. turbo typecheck / lint / build 全绿；GL 层代码含 WebGL 上下文丢失恢复处理。
6. 首页 LCP 不劣化（GL bundle 动态导入 + 纹理懒加载）。

## 十一、实施阶段划分（供实施计划展开）

1. GL 引擎骨架：engine + dom-sync + post pass + 质量调控 + 回退探测；
2. 序幕/第一幕：墨滴粒子 + SDF 标题显影 + 画布登场 + prompt 打字；
3. 第二幕：denoise pass + 采样 HUD + 解说词编排;
4. 转场 A + 第三幕：深度 dolly + 流体反转 + 宣言墨章；
5. 转场 B + 第四幕 + 转场 C：粒子 morph 增殖 + 展墙推轨 + 选中回中；
6. 第五幕 + 终幕：装裱 + 反向显影 bookend；
7. 墨线系统全页铺设；
8. 中端/静态回退层补全 + 性能核验（三层走查）；
9. 旧组件退役（HowItWorks 舞台、Testimonials 跑马灯）、文档与 CHANGELOG。

每阶段独立 commit；阶段 5、9 结束各做一次完整视觉走查。

## 十二、完成情况（2026-07-11）

实施计划 `docs/plan/2026-07-10-homepage-cinema-plan.md`（14 Task 全码级拆解）
已全部落地 main：提交 b78fb7f（行程表纯函数）至 45000ef（三层回退查缺与
性能收口）+ 本 docs 收尾提交。首页已切换为影片化滚动，demo 联调路由
`(marketing)/demo/cinema` 已退役删除。

- **渲染引擎**：手写 WebGL2 迷你引擎（engine/quality/dom-sync +
  denoise/dolly/fluid/particles/post 五个 pass，零新依赖）；单上下文、
  按需渲染、DPR 上限 1.5、IntersectionObserver 谷段休眠、上下文丢失恢复、
  帧耗时 EMA 自适应降档全部落地。实施中的关键勘误（预乘 alpha 混合因子、
  调控器空闲间隔误杀、biome useHookAtTopLevel 误报、smooth 滚动验收轮询）
  回填在实施计划"实施勘误"节。
- **分镜**：七幕 1550vh 主行程 + 终幕独立 200vh 舞台（设计稿"约 1750vh"
  即二者之和）；三大转场（穿越/增殖/选中回中）与首尾 bookend 闭环；
  行程常量收敛在 cinema-config.ts 单点调参。
- **三层回退**：完整 GL 版 / 中端简化版（lite 转场分支）/ 静态编排版
  （reduced-motion、<md 移动端、GL 全灭），Task 13 三层走查通过。
- **内容不变式**：既有 i18n key 全部保留消费，新增 key 收敛在 Cinema
  命名空间（en/zh 同步）；正文全部真实 DOM（SSR 输出静态编排版全量正文）；
  Pricing/SLA/FAQ 数据流与交互未动。
- **旧组件退役**：hero-section/feature-grid/how-it-works/manifesto-section/
  use-cases-section/testimonials/cta-section/reveal/scroll-fx 内容迁入
  各幕后删除。
- **门禁记录（2026-07-11 收尾实测）**：typecheck 4/4 全绿；build 全绿；
  biome lint 全仓 7 error（均为 cinema 之外既有存量——admin status 与
  create 的 loading.tsx noArrayIndexKey x4、json-ld noDangerouslySetInnerHtml、
  psd-export noAssignInExpressions、internal-job-scheduler noUnreachable，
  低于规划期基线 13；cinema 目录 0 error / 6 warning 告警级）；
  test：shared 516/516 全绿，web 532/538——6 个失败为既有 flaky
  （service-web-fallback 等 5 文件，仅全量并行时互扰，隔离复跑 46/46 全过），
  无 cinema 相关失败，cinema 自有 4 文件 15 用例全过。

后置项（登记 `docs/TODO.md`「首页影片化」节）：速度响应镜头（能力 5）、
真实扩散帧序列资产、主样张深度图离线生成、展墙玻璃折射高光 GL 版。
