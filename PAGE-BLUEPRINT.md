# 智护流浪星 · 页面布局蓝图与产品规划（PAGE-BLUEPRINT）

> 与 `HANDOVER.md` 的分工：**HANDOVER 回答「系统怎么搭的」，本文回答「屏幕上为什么长这样、还要往哪长」**。
> 本文所有尺寸、类名、组件名均取自当前代码（`2026-10-25` 快照），改代码后请同步本文 §1.2 / §3。
>
> **2026-10-25 晚视觉重构（第一轮，已被取代）**：按 6 张设计稿做过一版纸卡手账风。
>
> **2026-10-26 视觉改版定稿（当前基准）**：按用户提供的综合设计稿（蓝紫玻璃拟态方向）再次重构。
> 拍板记录：主色 amber → **蓝紫 accent（#5B6CFF 系，CTA 用蓝→紫渐变 `--grad-cta`）**；
> 底色向深靛蓝偏移（space-900 `#0A0E23`）；语义三色仍为绿/黄/红；
> 全站玻璃拟态卡（`.glass-card`），**纸质手账类（`.paper-*`/`.tape`/`.sticky-note`) 废弃**，新代码禁用；
> 桌面外壳改为**左侧竖排导航栏 + 顶栏（全局搜索/头像）**；首页 hero 用夜景城市插画底图
> `public/images/hero-city.jpg`（ImageGen 生成）+ 星座连线星点；无数据支撑的元素（天气挂件、
> 「相册」入口、管理端预警位置分布地图）暂不做。改动落点见 §1.1 / §2.2 / §3 各节。

---

## 0. 读法

- **§1 全局外壳**：所有页面共用的三层结构与尺寸常量。新增页面不用重造，直接套。
- **§2 导航地图**：路由之间怎么走，哪些入口目前是空的。
- **§3 逐页布局**：每个路由一张框图 + 区块表 + 空/错/加载三态 + 响应式差异。
- **§4–§5**：可复用区块词典与布局红线。**写新页面前先看这两节**。
- **§6–§7**：完成度盘点与 Roadmap（每条都标了会动到哪些页面与区块）。
- **§8**：新增页面的 SOP checklist。

---

## 1. 全局外壳与布局骨架

### 1.1 三层套娃

```
RootLayout   src/app/layout.tsx
 ├─ <html lang="zh-CN" class="dark">，字体 link（霞鹜文楷 / Inter / JetBrains Mono / Noto Serif SC）
 ├─ <StarFieldBackground />        全站底层 CSS 星场（fixed，z-0 之下）
 └─ 按路由组二选一：
     ├─ SiteLayout   src/app/(site)/layout.tsx  →  学生端（2026-10-26 起为「左侧栏」形态）
     │   ├─ <SideNav />         桌面端固定左栏（lg+）：logo + 竖排页签
     │   │     （首页/图鉴/星图/记录/问答），当前项蓝紫高亮胶囊
     │   ├─ <SiteHeader />      sticky top-0 z-30，h-14：全局搜索框（→ /animals?q=）
     │   │     + 已点亮数 + <Avatar />；lg 以下含汉堡/品牌
     │   ├─ {children}          flex-1（页面自己负责 max-w 与左右边距）
     │   └─ <BottomTabBar />    fixed bottom，md:hidden，56px + safe-area
     └─ AdminLayout  src/app/admin/layout.tsx   →  管理端（刻意不复用学生端外壳）
         ├─ 自己的头：星球标 + 「智护流浪星 · 管理端」 + 页签（预警处置台/回星图） + 管理员会话
         └─ 内容区 max-w-5xl px-4 py-5
```

关键取舍：**`(site)` 与 `admin` 是两个互不相借的外壳**。管理端不需要「拍摄/图鉴/问答」这些入口，学生端不需要处置流；当初为了避免"共用外壳 + 到处判断要不要显示某个入口"，直接拆成两套。

### 1.2 尺寸与间距常量表

| 项 | 取值 | 位置 | 备注 |
|---|---|---|---|
| 内容最大宽 | `max-w-5xl`（1024px）+ `px-4` | 所有 `<main>`、`PageShell` | 全站唯一容器宽度 |
| 顶部条高 | `h-14`（56px），`sticky z-30`，`bg-space-900/85 backdrop-blur` | `SiteHeader`、`AdminLayout` | 不用 h-16，移动端要省 8px |
| 底部导航 | 56px + `pb-[env(safe-area-inset-bottom)]`，`md:hidden` | `BottomTabBar` | 桌面端隐藏 |
| 内容底部留白 | `pb-28 md:pb-16`（首页 `pb-32 md:pb-16`） | `PageShell` / 首页 | 给固定元素让位，别用 margin 硬顶 |
| 主页间距节奏 | 标题区 `mb-5`、区块之间 `space-y-6`（档案页）/ `gap-4`（对话页） | 各页 | 两套节奏不要混用 |
| 星图高度 | `h-[56vh] min-h-[360px] md:h-[58vh]` | 首页地图 section | 不用固定 px，折叠屏/横屏会出事 |
| 对话流高度 | `max-h-[60vh] min-h-[320px] overflow-y-auto` | `AgentConsole`、`ChatPanel` | 输入区永远在视野内 |
| 星枢 FAB | `bottom-[calc(56px+16px+env(safe-area-inset-bottom))] right-4`，`h-11 md:h-14` | `AgentStarFab` | **必须**给底部 tab 让位 |
| 触控目标 | ≥ `44px` | 全站 | 次级筛选可放宽到 36px，主操作绝不 |
| 圆角 | card 16 / btn 12 / sticker 4 | `tokens.css` | 一级容器用 card，按钮用 btn，标签用 sticker |
| 摘要弹层 Sheet | 移动端底部抽屉；`sm:` 起居中卡片 `max-w-md` | `StarSummarySheet` | 同一个组件两种形态，靠断点切换而非两套 DOM |

### 1.3 z-index 分层表（改动前先看，别随手加 z）

| 层 | z | 典型元素 |
|---|---|---|
| Leaflet 内部 | 200–400 | tile pane / marker pane（`leaflet.css`） |
| 深空蒙版 | 450 | `.map-tint`（压在瓦片上、星点下） |
| 星点层 | 500 | `StarLayer`（`CampusStarMapCanvas`） |
| 地图空态 | 550 | 「这颗星还没有被记录」覆盖层 |
| 地图浮层 UI | 600 | 健康图例、`ZoomControl`、拖拽提示 |
| 头部 / 底部导航 | 30 | sticky header、`BottomTabBar` |
| FAB / Sheet / Overlay | 40 | `AgentStarFab`、Radix Dialog |
| 首屏星尘动画 | 50 | `StarDustIntro`（会话内只播一次） |

> 图例与拖拽提示刻意**挂在地图 section 里**（`absolute`）而不是用 fixed：它们必须跟着地图裁切，滚到一半时不能浮在页面别处。

### 1.4 断点约定（只用这三个，别引入第四个）

| 断点 | 语义 |
|---|---|
| `sm`（640） | 形态切换：Radix Sheet 从底部抽屉变居中卡片 |
| `md`（768） | **唯一的「移动端 ↔ 桌面」分界**：tab→顶部导航、`RecordBar` 隐藏、FAB 变大、底部留白减半 |
| `lg`（1024） | 只做栅格密度：图鉴 3 列、便签墙 4 列 |

两条硬规矩：**移动端优先**（先写小屏，再用 `md:` 覆盖）；**不用屏幕宽度推断 hover 能力**（`@media (hover)` 或干脆别依赖 hover 传达信息）。

---

## 2. 导航地图

### 2.1 路由总表

| 路由 | 页面 | 渲染 | 数据源 |
|---|---|---|---|
| `/` | 观测站首页（星图） | `force-dynamic` | animals + open alerts |
| `/animals` | 星图图鉴 | `force-dynamic` | animal 列表，支持 `?q` `?level` `?species` |
| `/animals/[code]` | 档案手账 | `force-dynamic` + `generateMetadata` | animal + observations + timeline + 最近 health report |
| `/scan` | 星卡捕获 | 静态壳 + 客户端状态机 | 仅 `readCampusCenter()` |
| `/report` | 记录一笔 | `force-dynamic` | animal 选项 + `?animal=` 预选 |
| `/chat` | 星枢问答（RAG） | SSR | knowledgeDoc 标题做推荐问句 |
| `/agent` | 星枢 Agent（工具流） | 静态壳 + 客户端状态机 | 无（全靠 `POST /api/agent`） |
| `/map` | **redirect('/')** | – | 正式星图尚未建 |
| `/design` | 设计系统橱窗 | 静态 | 无 |
| `/admin` | **redirect('/admin/alerts')** | – | 处置台是管理端唯一的活 |
| `/admin/login` | 管理口令登录 | 客户端表单 | `POST /api/admin/session` |
| `/admin/alerts` | 预警处置台 | `force-dynamic` + cookie 门禁 | `loadAlertBoard()` |

### 2.2 学生端导航的可达性矩阵

```
            桌面（SiteHeader 内页签 / md+）        移动端（BottomTabBar）
 ┌────────────────────────────────────────┬──────────────────────────────────┐
 │ 星图 / · 图鉴 /animals · 记录 /report  │ 拍摄 /scan · 图鉴 · 星图 · 记录 · 问答 │
 │ 问答 /chat · 星枢 /agent               │ （五个 tab，图标+文字，每格 flex-1）  │
 ├────────────────────────────────────────┼──────────────────────────────────┤
 │ Header 右侧还有：已点亮数（StarCount）+ 头像（Avatar，无登录态，默认观测员头像）│
 ├────────────────────────────────────────┴──────────────────────────────────┤
 │ 「星图」页签指向 /（首页即星图）；「星枢」页签直达 /agent（不再只有 FAB 入口）│
 │ 拍摄入口：桌面 = 首页「对准一颗星」按钮；移动端 = 底部「拍摄」tab           │
 │ 档案页的记录入口有两个：桌面 = 便签墙标题右侧「记录一笔」→ /report?animal=code │
 │                          移动端 = 底部 RecordBar 浮条（md:hidden）            │
 └───────────────────────────────────────────────────────────────────────────┘
```

> 2026-10-25 视觉重构拍板：桌面页签从「拍摄/图鉴/星图/记录/问答」改为「星图/图鉴/记录/问答/星枢」
> （对齐设计稿图1）。/map 仍是 redirect('/')，页签不再指它；星枢补齐了桌面入口（原 R5 达成一半）。

### 2.3 当前不可达 / 名不副实的入口（这是真问题，不是笔误）

| 现象 | 原因 | 归属 |
|---|---|---|
| tab「星图」点了回首页 | `/map` 是 `redirect('/')`，正式星图未建 | 规划 R2 |
| 桌面端找不到「星枢」入口（除首页外） | `AgentStarFab` 只在首页渲染，且 nav 里没有 `/agent` | 规划 R5 |
| `/admin` 没有首页 | 直接 redirect 到待办台（有意） | 不修 |
| 访问不存在的档案编号 | `notFound()` 落到 Next 默认 404 页，**黑白默认样式，和深空外壳割裂** | 规划 R1 |

---

## 3. 逐页布局

### 3.1 `/` 观测站首页 —— 叙事型星图

文件：`src/app/(site)/page.tsx`（**不用 `PageShell`**，自己写了 `main`）

> 2026-10-26 按蓝紫玻璃设计稿再次重构：**hero 区**（夜景插画底图 `hero-city.jpg` +
> 两行大标题 + 渐变 CTA「开始探索」+ 已点亮统计）+ **真实星图卡**（功能不丢）+
> **四张玻璃功能卡**（拍摄识别/图鉴/星枢问答/记录一笔）。

```
┌ SideNav（lg+ 左侧栏）──────┐┌ SiteHeader（搜索框+头像）──────────────┐
│ ┌─ hero（rounded-card）───┐ │                                        │
│ │ 夜景插画 + 左侧压暗渐变  │ │                                        │
│ │ 在城市的角落             │ │                                        │
│ │ 也有需要被看见的生命     │ │                                        │
│ │ 用你的发现，点亮属于它们的星                                       │
│ │ [开始探索 →]（--grad-cta 胶囊）                                    │
│ │ [★ 已点亮 N 颗星]（左下浮层）                                      │
│ └─────────────────────────┘ │                                        │
│ ┌─ 星图卡（rounded-card）─┐ │                                        │
│ │              [健康图例]  │ │  ← 右上 z-600                          │
│ │    Leaflet 底图 + 星点   │ │  （52vh/56vh）                         │
│ │ [图上 N 颗星/暂无位置]   │ │  ← 左下浮层卡 z-600                    │
│ └─────────────────────────┘ │                                        │
│ ┌ 拍摄识别 ┐┌ 图鉴 ┐┌ 星枢问答 ┐┌ 记录一笔 ┐  ← 玻璃功能卡 ×4        │
│  Disclaimer  ·  AgentStarFab（fixed 右下）
└ BottomTabBar（md-）──────────────────────────────────────┘
```

| 区块 | 组件 | 要点 |
|---|---|---|
| 星尘开场 | `StarDustIntro` | 600ms，`sessionStorage` 保证**每个会话只播一次**；reduced-motion 下直接不渲染 |
| hero 底图 | 内联 `backgroundImage: url(/images/hero-city.jpg)` | ImageGen 生成插画（水印已裁）；左→右压暗渐变用 `color-mix` 包 `--space-900`，**渐变必须 inline style**（Tailwind 渐变工具类对 var() 色板无效） |
| CTA | 内联 Link | `--grad-cta` 渐变胶囊（蓝→紫），指向 /scan |
| 星图容器 | `StarMapBoard` → `CampusStarMap` → `CampusStarMapCanvas`（`dynamic ssr:false`） | **页面本身不 import Leaflet**，靠这层隔离 |
| 健康图例 | `HealthLegend counts` | **右上角**；颜色+文字+数字三重编码；**刻意不用 `HealthChip`**（常驻元素跟着 2.4s 呼吸会很吵） |
| 功能卡 | 内联 FEATURES 数组 | 图标底色走令牌变量的 `color-mix`（绿=拍摄识别，蓝紫系=其余三张）；整卡为 Link |
| 星点摘要 | `StarSummarySheet`（Radix Dialog） | 点星弹出而非跳走——巡检时大多数点击只是想看一眼 |

**三态**：`pinned === 0` 时图上盖一层空态引导（z-550）；地图由 `NEXT_PUBLIC_MAP_TILE_URL` 控制，留空或连续 8 次瓦片失败 → 降到内置纯星场并显示提示。
**响应式**：地图高度 56vh→58vh；`md` 以上才显示「设计系统」链接；FAB 从 44px 变 56px。

### 3.2 `/animals` 星图图鉴

文件：`src/app/(site)/animals/page.tsx`（用 `PageShell`）

> 2026-10-26 蓝紫玻璃改版：搜索框与筛选 chips 走深色玻璃；**网格改为桌面 7 列小卡**；
> `StarCard` 网格变体为**玻璃卡**（`.star-card-glass`：照片满宽 + 亮字信息区 + `.chip-glass` chips）。

```
│ 星图图鉴                                       （PageShell 标题区）
│ 每一颗星都对应校园里的一个小家伙
│ (⌕ 搜索星号、名字或特征)          [搜索]   ← 深底玻璃胶囊 + ring
│ [●全部][●状态良好][●需要关注][●需要帮助]  ← 选中高亮，圆点冗余编码
│ ┌ grid 2 / sm:3 / md:4 / lg:7 列 ───────────┐
│ │  StarCard(grid) 玻璃卡 × N：照片满宽 →      │
│ │  名字(text-hi)+编号 · [健康档][物种][N 条]  │
│ └────────────────────────────────────────────┘
│ Disclaimer（mt-6）
```

| 区块 | 要点 |
|---|---|
| 搜索表单 | 原生 `GET` form（无 JS 也能用）；先用 hidden input 保住当前筛选，避免"一搜就把筛选清了" |
| 健康筛选 | 四个 chip 由 `HEALTH_META` 取色取字 + 彩色圆点；`orderBy: [{healthLevel:'desc'}]` 让红档自然靠前 |
| 卡片网格 | `StarCard variant="grid"` 玻璃卡（`.star-card-glass`），2/3/4/7 列；空结果给一整块居中提示 |
| 卡片色板 | `.chip-glass`：深底亮字 + 彩点冗余编码（旧 `.chip-on-paper` 已随纸质手账废弃） |
| Disclaimer | **这页曾经漏挂**——每张卡都有健康档徽标，等于每屏都在下健康结论，必须有护栏 |

**边界**：刻意不引地图。这一页回答「有没有一只 X」，`/map` 将来回答「这一带都有谁」——两个入口不许长成同一件事。

### 3.3 `/animals/[code]` 档案手账 —— 信息密度最高的一页

文件：`src/app/(site)/animals/[code]/page.tsx`（唯一的 Server Component，子树只吃 props）

> 2026-10-26 蓝紫玻璃改版：全页**去纸化**——身份卡/评估面板/报告卡/便签墙/时间线全部改玻璃卡
> （`.glass-card` / `.chip-glass`），居中窄幅（max-w-2xl）保留；`HealthSpectrum` 的 `tone="paper"`
> 随纸质手账一起删除（组件只剩深空形态）。

```
│ ┌ 身份卡（glass-card，居中 max-w-2xl）────────────┐
│ │  [照片 96px]  CODE: No.001     (管理员手动设定)? │
│ │               小橘（font-display text-hi）       │
│ │               [橘白] [雄性] [约 2 岁] chip-glass │
│ │  HealthSpectrum（深空形态）                       │
│ │  最新状态：{summary}（居中）                     │
│ └──────────────────────────────────────────────────┘
│ ┌ AssessHealthPanel（glass-card）─ AI 健康初筛 ┐
│ ┌ LatestHealthCard（glass-card，折叠态）──────┐
│ ┌ 待核实提示（虚线框，pendingCount > 0）──┐
│ ┌ 众包便签墙（glass-card）──────────────────┐
│ │  标题 + [✎ 记录一笔]（md+）            │
│ │  NoteWall：columns-2 sm:3 lg:4 玻璃便签 │
│ ┌ 手账时间线（glass-card）──────────────────┐
│ │  图例条：✦档案点亮 · ＋健康报告 · ·群众记录 · !预警核实 │
│ │  TimelineList（深空化：text-hi/lo + 语义色节点）│
│ └ Disclaimer（glass-card）──────────────────┘
│ <div class="h-24 md:h-0">  ← 给移动端 RecordBar 留位
```

| 区块 | 要点 |
|---|---|
| 全页数据源 | **只有一个 Server Component 查库**；客户端子树不再各自 fetch，否则同一份档案会派生出两个版本 |
| 特征 chips | `animal.features.slice(0, 3)`，`.chip-glass` 深底亮字 |
| 便签 | `NoteCard` 三色 tone 已玻璃化（paper=深玻璃 / amber=accent 微底 / mint=绿微底）；歪角保留（静态排版，不受 reduced-motion 约束） |
| 健康评估面板 | 唯一的健康入口；产出需 `reviewStatus` 审核后才算正式结论；错误文字用 `color-mix(star-red 62%, ink)` 压深保纸面对比度 |
| 便签墙 | 用 CSS `columns` 而非 grid——便签高度天然不等，grid 会留下规则空洞 |
| 时间线 | `loadTimeline()` 混合四类事件；title 是截断首句时 body 必须走 `bodyAfter()` 取续文，否则同一句话渲染两遍 |
| 两个记录入口 | 桌面 = 便签墙右上角链接（带 `?animal=` 直达）；移动 = 底部 `RecordBar`（`md:hidden`） |

**已知的信息重复**：便签墙与时间线都在渲染同一批 observation（形态不同：便签有图/署名/歪角，时间线是编年条目）。目前靠"一个偏众包感、一个偏档案感"区隔，但记录多时会显得啰嗦 → 规划 R3。

### 3.4 `/scan` 星卡捕获 —— 单页状态机

文件：`src/app/(site)/scan/page.tsx` + `CaptureClient.tsx`

```
│ 星卡捕获 / 拍一张照片，看看它是不是星图里那颗星
│ ┌ Viewfinder（取景框，四角星 + 扫描线）────────────┐
│ │   idle → preparing → scanning → …                │
│ ├ ResultSheet（Radix Dialog）：                     │
│ │   MatchedPanel   命中已有档案（相似度 + 最近动态） │
│ │   CandidatePanel 多个候选，人工选                │
│ │   NewStarPanel   未命中，引导建档（默认落点=校园中心）│
│ ├ UncertainNote（置信度 < 0.6 时显式提示"不确定"）  │
```

| 要点 | 说明 |
|---|---|
| Server 只做一件事 | `readCampusCenter()` 给建档表单当默认落点 |
| 上传契约 | multipart；客户端压缩 → 失败可降级"只发文字"；`clientId` 幂等键防重提 |
| 取景框动效 | 时长一律取自 `--dur-corner/scan/burst`，组件里不许写死毫秒 |
| 建档案之路 | `NewStarPanel` 落点默认校园中心，超出围栏会被拒（围栏是业务规则） |

### 3.5 `/report` 记录一笔 —— 三段式向导

文件：`src/app/(site)/report/page.tsx` + `RecordComposer.tsx`

> 2026-10-26 蓝紫玻璃改版：纸卡 → `glass-card`，输入控件统一深底（`bg-space-900/70` +
> `ring-space-700`），CTA/步进条高亮改 accent。三步进度条、关联星号下拉、存草稿均保留。
> 设计稿里的「受伤/跛行/休息」快捷标签无契约支撑（tags 由 AI 生成），未做。

```
（无动物时）玻璃卡提示：先拍一张照片让第一颗星亮起来 → /scan
┌ glass-card（max-w-3xl 居中）────────────────────┐
│  ① 选择星 ── ② 写记录 ── ③ 完成   ← 步进条，当前步 accent │
│ （step 1）你要记录的是哪一颗星？ + 关联星号下拉          │
│ （step 2）写一笔记 + 客观描述…                          │
│   ┌ 照片上传框 ┐  关联星号: [No.001 小橘 ▾]             │
│   │ 点击或拖拽 │  正文 textarea（必填 *）                │
│   └───────────┘  昵称（选填）                           │
│                  情况紧急 ———— 开关（勾选=通知管理员）  │
│         [提交记录]（--grad-cta 大按钮）  [存草稿]       │
│         草稿自动保存在本设备；照片不会被保存             │
│ （step 3）成功态：✔ 已经贴到 {name} 的手账上了          │
│          └ 直接用 <NoteCard> 就地渲染这条记录            │
│          └ toast 原文（服务端给，含"已通知管理员"）      │
│          └ [看看 TA 的档案][再记一笔][回图鉴]           │
└────────────────────────────────────────────────────┘
```

| 要点 | 说明 |
|---|---|
| 提交逻辑唯一实现 | `useRecordDraft.ts`：压缩降级 / 只发文字 / 幂等键 / 成功原文 / severe 五项，移动端 `RecordBar` 与本页面共用 |
| 存草稿 | `localStorage` 键 `ss:record-draft:<code>`，存 content/authorName/severe；内容变化即自动保存，按钮只给确认文案；提交成功或 reset 时清除；照片不持久化（UI 已说明） |
| 草稿恢复 | 换到某颗星第一次渲染表单时接回上次草稿；恢复动作每次键只执行一次 |
| `?animal=No.001` | 命中则跳过选星；查不到**静默退回选星态**（写错链接不是 404） |
| 成功态不跳走 | 就地渲染便签，用户一眼知道这句话最终长什么样 |

### 3.6 `/chat` 星枢问答（纯 RAG）

```
│ 星枢问答 / 答得上来的挂着出处，答不上来的会说不知道
│ ┌ 开场卡（仅首屏）：随便问一颗星的事 + 推荐问句 chips ─┐
│ ├ 对话流：用户气泡（右，琥珀描边）/ AnswerBubble（左） │
│ │   CitationMark 上标 → SourceCard 出处               │
│ ├ 输入区（flex items-end）：textarea + 发送按钮        │
│ └ 底部小字：当前限定在 {animal} 的档案内提问（带 animalId 时）
```

推荐问句**来自真实知识库标题**（`knowledgeDoc.title`，去掉括号副标题），不是手写死的字符串——换库后引导自动跟着变，也不会推荐一个答不上来的主题。

### 3.7 `/agent` 星枢 Agent（带工具执行）

文件：`src/app/(site)/agent/page.tsx` + `AgentConsole.tsx`

> 2026-10-26 蓝紫玻璃改版：配色跟随令牌自动换肤（running 星 accent、CTA `--grad-cta`），
> 三栏结构不变。设计稿右栏「参考证据」无 API 契约支撑，**保持删除**；「设置」不放假入口。

```
┌ 左栏（md+，w-36）─┐ ┌ 中栏对话流 ────────────────────────────┐
│ ◈ 对话（active）  │ │ 星枢 / 说得清的事，它替你跑完全程…      │
│ ◈ 轨迹            │ │ 用户气泡（左，Avatar + 深空卡）         │
│                   │ │ 星枢回复（右，Avatar + star-card）      │
│                   │ │   └ ConfidenceBadge + [建议复核] chips  │
│                   │ │   └ StarTrail / 降级「改走安全航线」     │
│                   │ │ [📎 上传照片] 描述你看到的情况  [发送]   │
└───────────────────┘ └ 底部小字：AI 生成，仅供参考…        ┘
```

| 要点 | 说明 |
|---|---|
| 等待态 | 渲染 `StarTrailPending`，文案是「正在规划路径…」而不是"思考中"——Agent 的中间态就是规划本身 |
| 降级呈现 | 任一工具失败 → 服务端改走 RAG → 前端显示"改走安全航线"，用户不感知 500 |
| 轨迹视图 | 左栏切到「轨迹」：回看本次会话所有已完成任务的 `StarTrail`（真实数据，无任务时空态引导） |
| 布局约束 | 星轨工具名用 `TRAIL_TOOL_LABEL` 中文短名，容器只有 56px，原名会被截成 `queryArc…` |

### 3.8 `/design` 设计系统橱窗

静态页，按组件分区：**语义色 · 星点变体 → HealthSpectrum → ConfidenceBadge（0.92/0.74/0.48）→ StickerTag → NoteCard → StarCard（grid/row/hero）→ Disclaimer（inline/block/toast）**。
这是"给人验收 UI 的一页"，任何新增基础组件都应在此登记一个状态样例。

### 3.9 `/admin/login`

单卡片：`管理员登录` → 口令输入 → 提交（`aria-busy`）→ 错误用 `role="alert"` 红字回显。**不在 UI 里改写被拒原因**，服务端原样回传。

### 3.10 `/admin/alerts` 预警处置台

文件：`src/app/admin/alerts/page.tsx` + `AlertBoard.tsx`

```
（服务端三态门禁）
未配置 ADMIN_TOKEN → Gate「管理端未启用」
cookie 不匹配      → Gate「需要管理员身份」+ 去登录
通过              ↓
│ 预警处置台（h1）· 未处理 N · 已认领 N · 已解决 N   ← 计数带三色冗余
│ ┌ 左栏（1fr）────────────────────┐ ┌ 右栏 220px ────┐
│ │ ┌ 预警待办（深空面板）───────┐ │ │ 高优先级        │
│ │ │ [全部][未处理][已认领][已解决]│ │ │ 2（红星大数字）│
│ │ │ AlertRow 紧凑行：● + 编号 +  │ │ │ 未处理中的紧急 │
│ │ │ 摘要 + 级别 + 时间 +        │ │ ├────────────────┤
│ │ │ [✓认领][✓解决]（行内动作）   │ │ │ 已解决         │
│ │ │ （第二行小字：名字/档案/来源）│ │ │ N（绿星大数字）│
│ │ └────────────────────────────┘ │ └────────────────┘
│ │ ┌ 关键报告审核 ───────────────┐ │
│ │ │ ReportReviewCard：通过/驳回 │ │
│ │ │ （必填理由）/ 通过并修改     │ │
│ └────────────────────────────────┘
```

> 2026-10-26 蓝紫玻璃改版：页头升级为**三张状态统计卡**（待处置=OPEN / 处理中=ACK /
> 已处理=RESOLVED，数字全部来自服务端 counts，图标底色用语义色 `color-mix`）；
> 左「待办+审核」右「统计卡」两栏与紧凑表格行保留；
> 右栏只保留**真实可算**的指标（高优先级 = OPEN∧CRITICAL、已解决 = counts.RESOLVED）；
> 设计稿的「平均响应」「今日审核柱状图」「预警位置分布地图」无数据源，**不做**。

| 要点 | 说明 |
|---|---|
| 门禁在服务端 | 未通过时**一行待办数据都不往客户端传** |
| 权限唯一裁决 | `lib/permissions.ts` 的 `canAckAlert` / `canResolveAlert` / `canReviewReport` |
| 计数要小心 | 曾在 `setItems` 的 updater 里调 `setCounts`，StrictMode 双调用导致"认领 1 条显示未处理 0 · 已认领 2" |

### 3.11 `/map`、`/admin`

两者都是 `redirect()`，无 UI。`/map` 的未来形态见规划 R2。

---

## 4. 共享区块词典

| 组件 | 变体 | 用在哪 | 选型提醒 |
|---|---|---|---|
| `StarCard` | `grid` / `row` / `hero` | grid=图鉴**玻璃卡**（`.star-card-glass`，照片满宽+亮字信息区），hero=档案身份区（hero 变体保留）；**`row` 目前只在 `/design` 登记，尚未投产** | 同一只动物在不同地方长得不一样是对的——信息密度不同 |
| `HealthChip` vs `HealthLegend` | 单个 badge / 一排图例 | 深空卡片 / 地图右上角 | 常驻成排的不脉冲；只有"有 OPEN 预警"的星点才脉冲；**玻璃卡上的健康标记用 `.chip-glass`（彩点+亮字），不用 HealthChip** |
| `HealthSpectrum` | `sm` / `md` | 卡片 / 档案身份区 | 光谱条比单一色点更能表达"档位是连续的"；`tone` 参数已随纸质手账删除 |
| `Avatar` | 默认观测员头像 / 传 src | SiteHeader 右侧、Agent 气泡 | 无登录态时的固定装饰位；接 next-auth 后传 session.user.image |
| `Disclaimer` | `inline` / `block` / `toast` | 各页底部 / 卡片旁 / 回复内 | 只要有健康结论就必须挂；**`/animals` 曾漏挂** |
| `ConfidenceBadge` | `sm` / 默认 | 识别、健康、Agent | 自带"低于可信下限"提示，**外层不要再补一句** |
| `UncertainNote` | `candidate` / `unknown` / `degraded` | 识别 / 问答 / Agent | 置信度 < 0.6 必须显式"不确定"，不许把猜测包装成结论；`degraded` 专供 Agent 降级 |
| `NoteCard` | tone（`paper`=深玻璃 默认 / `amber`=accent 微底 / `mint`=绿微底）× rotate | 便签墙 / 记录成功态 | 倾角终态写成静态 transform，reduced-motion 下照样是歪的 |
| `Radix Sheet` | 底部抽屉 → 居中卡片 | 星点摘要、识别结果 | 同一组件，靠 `sm:` 切换 |

---

## 5. 布局红线（新增/修改区块前逐条自检）

1. **容器只用 `max-w-5xl px-4`**，不要出现第二套最大宽度。
2. **颜色不许硬编码十六进制**：一律 tailwind 令牌类或 `var(--*)`（ESLint 已拦 `no-restricted-syntax`）；语义绿/黄/红必须来自 `lib/semantic.ts`，五处同色同义。
3. **禁止 `bg-*/xx`、`from-*/xx` 这类 `/opacity` 修饰符作用在 CSS 变量色板上** —— Tailwind 生成的是没有色标的渐变，算出来是 `backgroundImage: none`，元素在但看不见。需要半透明就 `color-mix()` 或内联 `linear-gradient`。
4. **触控目标 ≥ 44px**，最小间距 8px；固定元素要算上 `env(safe-area-inset-bottom)`。
5. **不要新增 z-index**：先查 §1.3 表；确需新层要写进表里。
6. **动效时长只取自 `--dur-*` 令牌**，且必须尊重 `prefers-reduced-motion`（reduced 下不许把元素藏掉，只停动画）。
7. **首屏数据要克制**：首页每条动物只 `take: 1` 取最近观察与最近报告，别为"可能要看"的数据买单。
8. **一处查库、多处渲染**：页面级 Server Component 取数，客户端子树吃 props，禁止子树各自 fetch。
9. **提交类交互必须走 `useRecordDraft`**（压缩降级/只发文字/幂等键/服务端原文），不许出现第二套实现。
10. **改动任何样式后跑 `npm run ui:audit`**（当前 23/0：正文最紧 6.85:1、图形最紧 6.14:1）。这是硬阈值，不是建议。

---

## 6. 完成度盘点

| 页面 | 布局状态 | 缺口 |
|---|---|---|
| `/` | ✅ 完工（2026-10-25 按图1 重构） | `/map` 仍 redirect 到首页（R2 正式星图未建，页签已改为指向首页） |
| `/animals` | ✅ 完工（按图2 重构，7 列纸卡） | 无分页（数据多后失真） |
| `/animals/[code]` | ✅ 完工（按图3 重构为纸叠手账；健康区块融入） | 便签墙与时间线渲染同一批记录（R3 未做）；`RecordBarPlaceholder` 死函数已删 |
| `/scan` | ✅ 完工 | — |
| `/report` | ✅ 完工（按图5 重构；存草稿已实现） | 快捷标签 chips 未做（tags 无表单契约支撑，属 AI 产出） |
| `/chat` | ✅ 完工 | — |
| `/agent` | ✅ 完工（按图4 三栏工作台；星枢已有桌面页签入口） | — |
| `/design` | ✅ 完工 | 新增组件应登记状态样例（`HealthSpectrum` tone、`Avatar`、`.star-card-paper`、`.chip-on-paper` 待登记） |
| `/admin/*` | ✅ 完工（按图6 重构；右栏真实统计卡） | 无分页/筛选（R6）；无角色视图；无主动通知（R4） |
| **全局** | ❌ 缺失 | **仍无 `not-found.tsx` / `error.tsx` / `loading.tsx`** —— 走 `notFound()` 会跌到 Next 默认黑白 404（R1 未做） |

最后一条是本次盘点最实在的缺口：整套深空视觉做得很完整，但任何一条写错的链接都会把用户扔到一个和系统毫无关系的默认页。

---

## 7. 产品规划 Roadmap

排序依据：**先补"割裂感"，再补"入口"，最后做规模能力**。规模（L）= 跨多个页面/目录，中（M）= 单页多区块，小（S）= 局部。

### R1 · 全局状态页（S｜强烈建议先做）

| | |
|---|---|
| 触及 | 所有路由的错误态、404 态 |
| 改动 | 新增 `src/app/not-found.tsx`、`error.tsx`、`loading.tsx`（必要时 `(site)/` 内再发一份继承 `SiteLayout` 的外壳） |
| 验收 | 访问 `/animals/No.999` 得到深空版「这颗星不在星图上」+ 回图鉴；API 挂掉时 `error.tsx` 接管而非白屏；形态要覆盖零星态、无网态 |
| 理由 | 成本最低、最容易被外人第一眼发现的一处断裂 |

### R2 · `/map` 正式星图（M）

| | |
|---|---|
| 触及 | 新增 `/map`；不动首页（首页保持叙事型） |
| 改动 | 新页：地图全屏 + 底部抽屉式列表；健康/物种/预警侧栏（移动端折叠为 chip 行）；一期不含点位轮询 |
| 验收 | tab「星图」不再跳首页；与首页的区别说得出：首页讲"今晚有这些星"，`/map` 讲"这一带都有谁、谁需要处理" |
| 前提 | 与 `/animals` 的分工写死在注释里（已有），别让两个入口长成同一件事 |

### R3 · 档案页信息重复治理（M）

| | |
|---|---|
| 触及 | `/animals/[code]` 的便签墙与时间线 |
| 方案 | 时间线只留**非观察类事件**（健康报告/预警/点亮），或便签墙改为"最近 6 条"+ 折叠；两种都要保留"同一条记录有两种看法"的价值，避免简单删一个 |
| 验收 | 记录超过 10 条时，页面仍能一眼读完且不觉得在复读 |
| 顺带 | 删掉 `RecordBarPlaceholder` 死函数 |

### R4 · 主动通知渠道（M｜功能债里最值得先做）

| | |
|---|---|
| 触及 | `/report` 成功态文案、`POST /api/observations` 响应、预警规则落点 |
| 改动 | 把"提交时回一句已通知管理员"改成真的发出去（企业微信机器人 / 邮件 / 短信其一），`alerts/rules.ts` 同事务不变 |
| 验收 | 管理员不在页面前也能收到；发送失败要有可见降级（不能因为通知失败就让提交失败） |
| 理由 | 当前产品最大的"看起来有、实际没有"的点，也是演示时最容易被追问的一环 |

### R5 · 入口补齐（S）

桌面端 nav 加「星枢」，FAB 从首页扩展到全站（或只在首页但形态更明确）；`/design` 登记新增组件样例。

### R6 · 管理端规模化（M）

分页 + 游标，`source`/`status`/`level` 组合筛选；顺带按角色（志愿者 / 兽医 / 管理员）给三档信息密度——兽医要看健康结论，志愿者只需要"去哪里、带什么"。

### R7 · 真实登录与审核单轨（L）

`next-auth` 与 `User.password` 已就位，缺入口 UI 与路由守卫。做完后 `reviewedByAdmin` / `reviewStatus` 双轨可合并（迁移要保留 `APPROVED` 语义，别把历史审核结论洗掉）。

### R8 · 演示与工程化（M）

演示动线脚本化（一键 seed + 断言）；自测进 CI（各 `*:selftest` **串行跑**，共用 `.next` 与同一个库，并行会互相踩）。

### R9 · 可选（PWA / 数据导出）

PWA 添加到主屏（现场演示体验提升明显）；流浪动物台账年度导出（真实社团需求）。

> 接真实 Provider 之前**不要**调识别准确率：mock 的视觉特征是确定性的，对任意输入返回同一组特征，相似度恒为 100%，在那里调参得到的结论是假的。

---

## 8. 新增页面 SOP（照此办理）

1. **决定外壳**：进 `(site)`（有 header + tab）还是 `admin`（处置流）？不要创造第三套。
2. **用 `PageShell`**：除非你要在标题与内容之间插特殊区块（首页是唯一例外），否则不许自己写 `<main>`。
3. **画框图**：按 §3 的格式先画一遍再写码；框图里出现的新区块，先在 §4 词典里登记。
4. **定数据来源**：一个 Server Component 取数，客户端子树吃 props；需要服务端刷新时用 `router.refresh()`。
5. **写三态**：空（没有数据）· 错（接口失败）· 载（骨架或等待态 UI）。缺任何一个都视为未完成。
6. **响应式核对**：移动端优先；只用 §1.4 的三个断点；固定元素检查是否给 tab / safe-area 让位。
7. **跑闸门**：`tsc --noEmit` → `eslint` → `npm run ui:audit`（必须 0 失败）→ `next build` → 真机/浏览器看两档宽度。
8. **回写文档**：改了尺寸/区块/红线，同步本文 §1.2、§3、§5；改了约定，同步 `CLAUDE.md` 及其全部副本（`tail -n +2 <file> | md5sum` 校验一致）。
