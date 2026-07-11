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

## 十三、v0.8.1 主角与主旨重修（2026-07-11）

发布后用户定性反馈："主要问题是一直都是一个 GPT2IMAGE 的黑框作为主体，
显得莫名其妙"——主角资产是一张 GPT2IMAGE 占位排版海报，prompt 说的是
水墨而显影出的是站点 logo，展墙 16 格是同图滤镜变体，主旨崩坏。本轮以
"主角必须自身值得被看"为轴心重修，全部主线程手工完成（不派子代理）。

### 高级感六条判断标准（本轮的设计依据，后续动效工作沿用）

1. 主角必须自身值得被看——影片上限即主角作品的上限；
2. 材质世界观统一——全片一套物质系统（纸/墨/水/光），数字网点是异物；
3. 物理可信——墨按墨的方式存在（起笔重/行笔颤/收笔枯/飞白/咬边/洇），
   扩散按扩散显影（大结构先出，按亮度偏置）；
4. 因果链完整——每幕由上幕"导致"，主角矩形全程不换位不瞬移；
5. 克制 + 唯一强调色——黑白全片只留一枚朱砂印；
6. 节奏呼吸——驻留慢过渡快，显影完成必须有静止一拍（money shot）。

### 交付内容

- **程序化水墨引擎**（会话 scratchpad `paint-ink.cjs`，node+sharp 离线
  确定性渲染）：笔毫束几何（JS 计算变宽多边形带，不依赖 SVG filter）、
  飞白断笔、墨内颗粒、洇痕晕层、朱砂印章、纸纹/晕影合成。主角「一笔圆」
  五层笔毫结构（铺底水层/浓墨补笔/细毫纹理/咬边/收锋枯丝）+ 深度图 +
  15 件不同题材展墙作品（竹影/远山/孤舟/墨梅/云月/芦洲/飞瀑/松风/双鲤/
  塔影/燕柳/荷净/虹桥/疏雨/草书）。
- **样张单一事实源** `cinema-artworks.ts`：增殖/展墙/静态回退三处逐位
  一致；PICKED_INDEX 按 stripPos 推轨几何定为 14（glide=1 时恰在视口
  中带，就近取画）；铭牌启用 Cinema.wallTitles 真实题名。
- **走查缺陷成批修复**：载入显影时间线（首屏标题空白）、generate 画布
  绝对居中（主角瞬移）、显影阈值结构噪声主导 + 亮度偏置（网点纹→
  "这一笔正在被画出来"）、粒子墨键控 + 两段编排（先原位爆散保轮廓再
  收敛）、低语专属栏位（stripWhisperSlot 附署名）、章节导轨
  （Cinema.chapters，随 darkWindow 反色）、页头暗场退场、增殖墨罩
  平滑撤除、行程 1860vh + 幕界淡化 3.5% + 显影 82% 完成留静止一拍、
  查看示例滚动直达展墙（scrollToScene）。

### 新增勘误（与实施计划"实施勘误"节互补）

1. **GLSL smoothstep 反序边界未定义**：`smoothstep(0.9, 0.5, x)` 在
   edge0>=edge1 时规范未定义；反向映射写 `1.0 - smoothstep(0.5, 0.9, x)`。
2. **VS 纹理采样被误判失效的教训**：增殖粒子呈无形矩形云，先后怀疑
   采样黑纹理/纹理不完整/单元污染，页面内最小实验（独立 gl + 1 点
   VS 采样 readPixels）证明采样一直正常；真因是编排——立即向格心收敛
   + 大幅 wander 在 uP=0.1 后就抹平了轮廓。视觉结论要先用最小实验
   定位层级，再改代码。
3. **微透明粒子会叠成实心云**：数万个 alpha 0.05 的"纸底微尘"重叠
   累积成可见实心云，淹没主体；不需要的粒子应 alpha 与 size 双键控
   彻底不显。
4. **mix-blend-difference 被合成上下文隔离**：场景层（带 opacity 的
   motion.div）建立 stacking context 后，上层的 difference 只对透明底
   混合，亮底下白字隐形；跨明暗底的常驻 UI 用状态驱动的双色切换
   （darkWindow 单一事实源），不要依赖 blend。
5. **走查方法**：GL 冷启动时 QualityGovernor 可能降档/未出帧，截屏前
   先小步滚动热身 2-3 秒；本机 curl 访问 localhost 必须绕过系统代理
   （`--noproxy "*"`），否则 503 来自代理而非应用。

### 门禁记录（2026-07-11 重修收尾实测）

typecheck 全绿；build 全绿；biome cinema 目录 0 error / 6 warning
（告警级不阻断）；cinema 自有测试 16/16（新增低语栏位几何用例）；
web 全量两次分别 13/7 个失败且集合不同，全部落在 external-api /
image-generation / image-backend-pool 既有互扰 flaky 区，6 文件隔离
复跑 108/108 全绿，无 cinema 相关失败。
