# 智护流浪星 · Stray Star

基于多模态 AI Agent 的校园流浪动物智能识别与健康管理平台。
视觉概念：**星空图鉴 × 救助手账** —— 外壳是深空观测站（每只动物是一颗星），内页是纸质手账（承载众包记录）。

> **换人/换平台接手先看 [`HANDOVER.md`](./HANDOVER.md)**——里面是架构全景、数据模型、五条核心链路、当前债务与下一步规划、迁移注意事项。
> **要动 UI / 加页面先看 [`PAGE-BLUEPRINT.md`](./PAGE-BLUEPRINT.md)**——外壳与尺寸常量、12 个路由的逐页布局框图、z-index 分层、布局红线与 Roadmap。
> 本 README 讲的是「怎么跑起来」，写代码的强制约定在 [`CLAUDE.md`](./CLAUDE.md)。

## 评审导航

| 提交要求 | 对应材料 |
|---|---|
| 项目介绍 | 本文件「项目简介」「架构总览」「技术栈」，以及 [`HANDOVER.md`](./HANDOVER.md) |
| 技术架构 | 本文件「架构总览」；分页布局见 [`PAGE-BLUEPRINT.md`](./PAGE-BLUEPRINT.md)；AI 链路实测记录见 [`docs/ai-integration-audit.md`](./docs/ai-integration-audit.md) |
| 安装运行指南 | 本文件「快速开始」「环境变量」「没有 Docker 怎么办」；完整版见 [`docs/环境配置说明.md`](./docs/环境配置说明.md) |
| 环境变量模板 | [`.env.example`](./.env.example)（全部变量带注释，默认 `AI_PROVIDER=mock` 无需任何密钥即可跑通） |
| 依赖清单 | [`docs/依赖清单.md`](./docs/依赖清单.md) + `package.json` / `package-lock.json` |
| 代码规范 | [`docs/代码规范.md`](./docs/代码规范.md)（ESLint + Prettier + 分层约定，含强制规则） |
| 团队信息 | 本文件「团队信息」一节 |
| Git 记录 | 见 [`docs/Git提交说明.md`](./docs/Git提交说明.md)（含历史沿革说明） |
| 提交自查 | [`docs/提交材料自查表.md`](./docs/提交材料自查表.md)（逐条对照，标注状态与验证方式） |

## 项目简介

校园里有多少只流浪猫狗、它们最近怎么样、谁在管——这三个问题过去靠微信群里的照片和记忆回答。本项目把「看见一次」变成一条结构化数据：**认得出是哪一只、说得清什么状态、记得住谁在何时何地见过、异常能自动通知到人**。

系统面向两类使用者：

- **师生**（无需登录）：拍照识别个体、上传照片做健康初筛、随手记录目击、在地图上改点位、用自然语言问答或直接下达任务。
- **管理员**（口令门禁）：处理 AI 筛出的预警、审核匿名提交的档案、复核关键观察报告、看数据看板。

核心取舍是**AI 负责筛，人负责判**：模型做识别、分级、检索、调度这些「快但不确定」的事；确认、驳回、处置这些「慢但必须负责」的事留给人。所有 AI 结论都带置信度与证据链，低置信一律标「待核实」而不是硬给答案。

## 主要功能

| 模块 | 入口 | 说明 |
|---|---|---|
| 星枢 AI | `/agent` | 一句话把事办完：识别、评估、查档案、写记录、挪点位。ReAct 循环，工具调用 1–5 步，过程在「星轨」上逐步可见，可暂停/接管 |
| 智慧问答 | `/chat` | 基于知识库的问答，答案带引用出处；无依据时明确拒答 |
| 拍照上传 | `/scan` | 一张照片判定物种与个体，认出来给编号和置信度，没见过则自动建档 |
| 图鉴 | `/animals` | 动物档案、时间线、健康徽章、常出没位置 |
| 众包便签墙 | `/report` | 一句话 + 照片 + 位置，提交后自动结构化并触发预警规则 |
| 星图 AI | `/map` | 每只动物一颗星，支持对话改点位、设备定位落点 |
| 数据统计 | `/data` | 预警动态、观察量趋势、健康分布 |
| 管理端 | `/admin` | 预警处置、档案核实、报告审核、系统设置 |

## 架构总览

```
                ┌────────────────────────── 学生侧 (site) ──────────────────────────┐
                │  / 首页星图   /scan 拍照识别   /animals 图鉴·手账   /chat 问答   /agent 星枢 │
                └───────┬───────────────┬───────────────┬──────────────┬────────────┘
                        │               │               │              │
              POST /api/identify   POST /api/observations  POST /api/chat  POST /api/agent
              POST /api/animals    POST /api/health/assess     │              │
                        │               │               │              │
                ┌───────▼───────────────▼───────────────▼──────────────▼────────────┐
                │ lib/ 业务层（路由只做解析·限流·信封，裁决与落库全在这里）                  │
                │  identify/ 识别管线     health/ 评估+reconcile   rag/ 检索问答          │
                │  agent/ ReAct 编排+6工具  observations/ 记录落库   admin/ 处置·审核      │
                │  alerts/ 规则引擎(R1-R5)  safety/ 敏感过滤·置信度闸门  permissions/ 权限  │
                └───────┬───────────────────────────────────────────────┬───────────┘
                        │                                               │
              ┌─────────▼─────────┐                          ┌──────────▼──────────┐
              │ lib/ai Provider   │                          │ PostgreSQL 16       │
              │ mock / openai /   │                          │ + pgvector          │
              │ qwen / glm / …    │                          │ 档案·观察·报告·预警·  │
              │ 管道：过滤→调用→    │                          │ 知识向量·审计        │
              │ 脱敏→Zod 校验      │                          └─────────────────────┘
              └───────────────────┘
管理侧 /admin：口令门禁(ADMIN_TOKEN) → /admin/alerts 预警处置 + 关键报告审核（通过/驳回/修改）
```

**两条铁律**：

- **预警与业务记录同事务**：观察/报告写入与规则评估在同一个 `db.$transaction` 里，"记下了但没人被通知"比整条失败更危险。
- **Agent 只是另一个调用方**：星枢的写类工具复用与手动提交完全相同的校验、限流、同事务预警链路，不享有任何旁路。

## 技术栈

- Next.js 14（App Router）· TypeScript · Tailwind CSS · shadcn/ui
- PostgreSQL 16 + pgvector（档案与知识库向量同库）· Prisma
- Leaflet（高德路网瓦片 + 反色夜视，亮度已调到能看清路网与地名；星图可拖动、可缩放）
- AI：统一 Provider 抽象（OpenAI 兼容协议，可切 GPT-4o / 通义 VL / GLM-4V；内置 `mock`，无 key 全流程可跑）

## 快速开始

```bash
# 1 装依赖
npm install

# 2 配置环境变量（Prisma CLI、Next.js、seed 脚本都读这一个文件）
cp .env.example .env            # 默认 AI_PROVIDER=mock，无需任何 key
#   然后把 DATABASE_URL 改成你的实际连接串

# 3 起数据库（PostgreSQL 16 + pgvector，三选一，见下节）
#    Docker：npm run db:up      本机：见「没有 Docker 怎么办」

# 4 建表 + 播种
npm run db:migrate              # 走 migrations/（推荐）
npm run db:seed                 # 幂等：3 猫 2 狗 + 观察 + 护理知识 + 1 条预警，连跑不翻倍

# 5 启动
npm run dev                     # http://localhost:3000
```

种子账号（密码统一 `straystar2026`，供数据外键与后续登录接线使用）：

| 学号 | 姓名 | 角色 |
|---|---|---|
| 20230001 | 林蔚（社团负责人） | ADMIN |
| 20230112 | 阿澈 | STUDENT |
| 20230207 | 小鹿 | STUDENT |

> 学生侧当前以"匿名 + 昵称"提交（不强制登录）；**管理端**走独立口令门禁：`.env` 配 `ADMIN_TOKEN` 后访问 `/admin/login` 登录，未配置即门禁关闭。

打开 `/design` 可核对设计令牌与全部基础组件状态。

页面清单：`/` 星图（可拖动/缩放）· `/scan` 拍摄识别 · `/animals` 图鉴 · `/animals/[code]` 档案手账 · `/report` 众包记录 · `/chat` 知识问答 · `/agent` 星枢 · `/admin` 管理端（独立外壳）。
其中 `/report` 是桌面上唯一的记录入口（移动端在档案页另有底部记录条），`?animal=No.001` 可直接带出对象；
`/map` 有意重定向到首页 —— 首页本身就是星图，不维护第二份。

### 没有 Docker 怎么办

**A. 本机装 PostgreSQL + pgvector（推荐，无需 Docker）**

1 装 PostgreSQL 16：

```cmd
winget install -e --id PostgreSQL.PostgreSQL.16
```

安装向导里设好 `postgres` 超级用户密码（**记住它**，连接串要用），端口保持默认 5432。

2 装 pgvector 扩展。Windows 没有官方安装包，用第三方预编译二进制：
<https://github.com/andreiramani/pgvector_pgsql_windows/releases> —— 挑 **PostgreSQL 16** 对应的那个 zip（文件名形如 `pgvector-pg16-windows.zip`）。

解压后把文件拷进安装目录（管理员 PowerShell）：

```powershell
$pg = "C:\Program Files\PostgreSQL\16"
Copy-Item "解压目录\lib\vector.dll"            "$pg\lib\" -Force
Copy-Item "解压目录\share\extension\*"          "$pg\share\extension\" -Force
Restart-Service postgresql-x64-16
```

3 建库 + 启用扩展（脚本已备好）：

```cmd
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -f scripts\setup-db.sql
```

4 改 `.env` 的连接串，然后建表播种：

```bash
DATABASE_URL="postgresql://postgres:<你的密码>@localhost:5432/straystar?schema=public"

npm run db:migrate && npm run db:seed
```

如果安装时是静默装的（winget 默认），`postgres` 可能没有密码而连接又要求密码，会报
`fe_sendauth: no password supplied`。补救：临时把 `data\pg_hba.conf` 里的 `scram-sha-256`
改成 `trust`，重启服务，用 `psql -U postgres` 无密码登录后执行
`ALTER USER postgres PASSWORD '<新密码>';`，再把认证方式改回去重启。

**B. 装 Docker Desktop**
Windows 上从 [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) 下载安装，
安装向导里勾 **Use WSL 2 instead of Hyper-V**（推荐）。若提示 WSL 版本过旧，先在管理员终端跑 `wsl --update` 再重启。

装完确认 `docker version` 有输出，然后一条命令起库 + 建表 + 播种：

```bash
npm run db:bootstrap     # = db:up（等 healthcheck 通过）→ db:push → db:seed
```

**C. 暂时不接数据库**
只验证 UI 与 AI 链路时可跳过：`/` 与 `/design` 不查库，`npm run dev` 直接可看。
要跑通识别 / 档案 / 预警等主链路，仍需 A 或 B。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DATABASE_URL` | ✓ | PostgreSQL 连接串 |
| `NEXTAUTH_SECRET` | ✓ | 各类签名/摘要的密钥来源（管理端 cookie 也在内） |
| `NEXTAUTH_URL` | – | 默认 `http://localhost:3000` |
| `AI_PROVIDER` | – | `mock`（默认，无 key 可跑）/ `openai` / `qwen` / `glm` / `deepseek` |
| `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` / `AI_CHAT_MODEL` / `AI_VISION_MODEL` / `AI_EMBED_MODEL` | – | OpenAI 兼容统一变量，换厂商只改这几个。`AI_MODEL` 让文本与视觉共用一个多模态模型（如 `glm-4.6v-flash`），两个专用变量留空时都取它 |
| `OPENAI_API_KEY` / `QWEN_API_KEY` / `GLM_API_KEY` / `DEEPSEEK_API_KEY` | – | 厂商专用 key，任一有值即可 |
| `AI_FALLBACK_MODELS` / `AI_VISION_FALLBACK_MODELS` | – | 过载降级链（逗号分隔）。免费档模型高峰期大量返回 429 / 1305，按链顺序换模型兜住；视觉只降视觉模型 |
| `AI_THINKING` | – | `disabled` / `enabled` / 留空。GLM 4.5/4.6 的思考链开关，关闭后同一句话 17s → 1.3s |
| `AI_ATTEMPT_TIMEOUT_MS` | – | 单个模型单次尝试的超时，默认 12000。**必须小于 `AI_TIMEOUT_MS`**：总预算是整条降级链共用的，主模型卡住时会独占预算，备选模型轮不到 |
| `AI_PUBLIC_BASE_URL` | – | 图片相对路径拼绝对地址供视觉模型访问 |
| `AI_TIMEOUT_MS` | – | 单次调用总预算，默认 20000 |
| `AGENT_TOOL_TIMEOUT_MS` | – | Agent 单个工具执行上限，默认 8000。工具内部要等一次 AI 调用，接真模型时需放宽 |
| `UPLOAD_DIR` | – | 上传落盘目录，默认 `public/uploads` |
| `CAMPUS_CENTER_LAT/LNG` `CAMPUS_ZOOM` `CAMPUS_RADIUS_M` | 光谷校区 `30.469384/114.405764`、17、2000m | 地图中心与围栏。**必须是 WGS-84**：从腾讯/高德 POI 抄来的数是 GCJ-02，先用 `geo.ts` 的 `gcj02ToWgs84()` 反解。改坏会被 `db:selftest` 拦住 |
| `MAP_SNAP_GRID_M` | – | 坐标聚合网格（米），`0` = 用真实点位 |
| `NEXT_PUBLIC_MAP_TILE_URL` | – | 底图瓦片。默认高德路网（免 key）；**留空 = 内置纯星图**（离线演示用）；也可填任意 `{x}/{y}/{z}` 瓦片服务 |
| `NEXT_PUBLIC_MAP_TILE_CRS` | – | `gcj02`（高德/腾讯，需纠偏）｜`wgs84`（OSM/CARTO/自建）。留空按域名自动判断 |
| `NEXT_PUBLIC_MAP_TILE_TONE` | – | `dark`（浅色瓦片反色压暗成夜视底，高德路网默认）｜`none`（原色铺，卫星影像用） |
| `ADMIN_TOKEN` | – | 管理端口令；**未配置 = 门禁关闭**（cookie 只存 HMAC 摘要） |

> **切换 `AI_PROVIDER` 之后必须重建向量**：库里的向量是入库那一刻的 Provider 算出来的。
> mock 走本地哈希（`hashEmbedding`），换成 GLM/OpenAI 后查询向量换了空间，余弦相似度失去意义 ——
> 表现是「识别全部判成未登记星」「知识库检索命中乱套」，**而且不报错**。
> 切换后跑一次 `npm run ai:reembed`（加 `--dry` 只看不写），它会按新 Provider 重算
> `Animal` / `AnimalPhoto` / `KnowledgeDoc` / `KnowledgeChunk` 四类向量。

> **底图现在是真底图，不是纯星场**：默认接高德路网瓦片（免 key、国内直连、带道路与地名），
> 瓦片是浅色的，靠 `MAP_TILE_TONE=dark` 用一层 `invert(1) hue-rotate(180deg)` 把它压成深空底 ——
> 白底变近黑、水系回蓝、绿地留暗绿，星点仍是画面里最亮的东西。
>
> 两个必须记住的坑：
> 1. **国内瓦片是 GCJ-02**。项目所有坐标是 WGS-84，所以画之前一律过 `toTileLatLng()`（`lib/map-config.ts`）——
>    漏一处就会整体偏 300–600 米（本机实测 490m，在 zoom 17 上就是"星星掉到隔壁小区"）。
> 2. **CARTO basemaps 现在要 API key**。没 key 时它返回 HTTP 200 + 一张写着 `API KEY REQUIRED` 的水印图，
>    前端收不到 `tileerror`，降级逻辑不会触发，屏幕上就是满屏水印 —— 所以别再把默认源改回 CARTO。
>
> 留空 `NEXT_PUBLIC_MAP_TILE_URL=""` 仍可回退到内置 CSS 星场（完全离线）；瓦片连续失败 8 次也会自动切过去。
>
> **星图是能动的**：单指/鼠标拖动平移，右上角 `+/−` 或双指缩放，`maxBounds` 把它锁在校园 ±2.3km
> （拖到光谷周边看得见，但回不来这种事不会发生）。滚轮缩放刻意关掉 —— 否则在星图上往下滚页面
> 会被地图吃掉。`minZoom: 16` 也不是随手定的：Leaflet 在"视野宽过 maxBounds"时会强制居中并锁死平移，
> zoom 16 的视野刚好比围栏窄，再往外缩就会变成"拖不动"。

完整占位见 `.env.example`。

## 演示动线（5 分钟走完全部能力）

前置：`npm run db:seed` 已跑、`.env` 已配 `ADMIN_TOKEN`（演示建议值随意，如 `straystar2026`）。

| # | 操作 | 预期结果 |
|---|---|---|
| 0 | `/` 首页，按住星图拖一段、点右上角 `+/-` | 底图是武汉华夏理工学院光谷校区（关山大道、三环线、校门都在），5 颗星落在校园内；拖动时星点跟着地图走，拖到围栏边缘会被阻尼挡住 |
| 1 | `/scan` 给一只猫拍照提交 | 识别出命中的种子个体（如 No.005）；置信度 < 0.6 时显式出现「不确定」提示条 |
| 2 | 进入它的档案 → 发起健康评估 | 三色光谱结果 + ConfidenceBadge + 免责声明；SEVERE 强制「建议就医」 |
| 3 | `/report` 选一颗星（或直接进手账的记录条）提交一条观察，勾选「情况紧急」 | toast 出现「已通知管理员」；成功后这条记录就地渲染成一张便签；观察与预警**同事务**落库 |
| 4 | `/admin/login` 输入口令 → `/admin/alerts` | 列表出现第 3 步的预警 → 确认（ACK）→ 解决（RESOLVED）；关键报告区可对 AI 初筛做**通过/驳回/修改**（修改会再做一次安全校正，diff 进审计） |
| 5 | `/agent` 输入「No.001 这只猫腿上有伤口流血，帮我看看并记录一下」 | 星轨逐颗点亮：规划 → queryArchive → identifyAnimal → assessHealth → addObservation → checkAlerts → 整合；观察落库、CRITICAL 预警触发、回答带置信度与免责声明。任一工具失败则显示「改走安全航线」并回落普通问答 |

## 安全设计（全站 AI 入口统一口径）

| 防线 | 位置 | 规则 |
|---|---|---|
| 敏感过滤 | `lib/safety/moderation.ts` | 输入与 AI 输出双向过闸：虐待/交易类**阻断**，隐私类脱敏，绝对化医疗断言改写。覆盖识别/评估/观察/问答/星枢全部入口 |
| 置信度闸门 | `lib/safety/guard.ts` | 置信度 < 0.6 必须显式呈现「不确定」，不得把猜测包装成结论 |
| 免责声明 | `constants.DISCLAIMER` | 一切健康结论必带；字段缺失时由 `withDisclaimer` 补标准文案 |
| 兜底话术 | `constants.FALLBACK_TEXT` | AI 不可用/输出不合规/检索为空/敏感阻断，全站单一来源，不允许各写各的 |
| 输出契约 | Zod `safeParse` | 所有 AI 输出过 schema，失败走 fallback，**不把错误抛到客户端** |
| 权限裁决 | `lib/permissions.ts` | 唯一裁决处（预警确认/解决、报告审核）；被拒理由原样回传，前端不许改写 |
| 审计 | `lib/db/audit.ts` | 识别/建档/观察/评估/预警处置/报告审核/管理登录全部留痕，报告审核记录 diff |

一致性自查：`npm run ui:audit` 静态扫描硬编码色值、语义三色单一事实源、动效 `prefers-reduced-motion` 覆盖、WCAG AA 对比度（正文 ≥4.5:1、图形 ≥3.0:1，实测最紧 6.85:1 / 6.14:1）。

## 管理端

- **门禁**：`ADMIN_TOKEN` + HMAC 签名 cookie（`ss_admin`，12h，httpOnly）。失败关闭：没配口令时 `/admin/alerts` 只显示"未启用"，不会裸奔。
- **预警处置**：列表（未处理在前、同级按等级）→ 确认 ACK（学生也可认领）→ 解决 RESOLVED（CRITICAL 仅管理员）；全部写审计。
- **关键报告审核**（阶段 9）：只列 SEVERE / 建议就医的报告。通过（可同时修改 assessment/severity，服务端过 `reconcileHealth`：SEVERE 强制 needsVet）、驳回（必须给理由，时间线打红标「已驳回」）、diff 原样进 `AuditLog`。

## 星枢 Agent

一句话任务进，多步事情办完。`POST /api/agent`（multipart，message 必填、photoUrl 可选）：

- **工具注册表 6 个**（`lib/agent/tools.ts`）：`identifyAnimal` / `assessHealth` / `queryArchive` / `addObservation` / `checkAlerts` / `searchKnowledge`，每个带 JSON Schema 描述与 zod 入参契约。
- **ReAct 循环**（`lib/agent/orchestrator.ts`）：plan → [决策 → 工具 → 观察]* → final；工具步 ≤5、总步 ≤7、单步超时 8s；前一步的识别结果经 `harvest()` 反哺下一步。
- **失败降级**：任一工具 error → 立即中断 → 普通问答兜底 → 前端显示「改走安全航线」。
- **星轨可视化**（`/agent`）：`{steps:[{tool,status,summary}], goal, degraded}` 逐颗点亮；`running` 暖金 halo 脉冲配「正在规划路径…」；全部动效尊重 `prefers-reduced-motion`。
- 限流 6 次/分钟（全站最贵入口）+ 30s clientId 幂等 + 响应出口 Zod 校验。

## 设计令牌

值的唯一来源是 `src/styles/tokens.css`，`tailwind.config.ts` 只做映射，`globals.css` 提供语义层与动效降级。
语义色全站统一，禁止硬编码（`.eslintrc.json` 的 `no-restricted-syntax` 与 `npm run ui:audit` 双重拦截）：

| 语义 | Token | 用途 |
|---|---|---|
| 绿 | `--star-green` | 健康 · 稳定星 |
| 黄 | `--star-yellow` | 观察 · 闪烁星 |
| 红 | `--star-red` | 预警 · 告警星 |

动效基线 240ms / `cubic-bezier(.2,.8,.2,1)`，星点脉冲 2.4s，全部尊重 `prefers-reduced-motion`。

## AI Provider 切换

只改 `.env`：

```bash
AI_PROVIDER=mock      # 默认：关键词规则 + 确定性词袋向量，无 key 可跑
AI_PROVIDER=openai    # 需 AI_API_KEY；vision 用 gpt-4o
AI_PROVIDER=qwen      # 需 QWEN_API_KEY；vision 用 qwen-vl-max-latest
AI_PROVIDER=glm       # 需 GLM_API_KEY；vision 用 glm-4v-flash
AI_PROVIDER=deepseek  # 需 DEEPSEEK_API_KEY；无视觉模型，图片信息不参与判定
```

缺少 key 时自动回落 `mock`，链路不会因此中断。

### 统一接口（`src/lib/ai/provider.ts`）

```ts
provider.visionAnalyze(image, prompt, schema, opts?)  // 多模态 → 结构化对象
provider.chat(messages, schema?, opts?)               // 传 schema 得对象，不传得字符串
provider.embed(text)                                  // → number[]（维度统一 1536）
```

业务侧统一入口在 `src/lib/ai/registry.ts`：`runStructured / runVision / runChatText / runEmbed`，
返回 `Result` 风格（`{ ok, data }` 或 `{ ok:false, error }`），**不抛异常**，失败交给调用方按 `FALLBACK_TEXT` 兜底。

### 执行管道（所有 Provider 一致）

```
输入过滤(moderation) → 超时/中断 → 厂商调用 → 输出过滤(递归脱敏) → Zod 校验 → 返回
```

- 厂商只需实现 `RawProvider`（`rawVision / rawChat / rawEmbed` 吐原始值），管道由 `defineProvider` 统一封装
- 输出可能是 JSON 字符串 / 带 ```json 代码块 / 已是对象 → `coerceJson` 兜底
- 维度不符 → `normalizeVector` 截断或补零并告警
- 不支持 `response_format` / `dimensions` 的厂商 → 400 时自动降级重试

### 错误码

| code | 触发 |
|---|---|
| `AI_VALIDATION_ERROR` | 输出未通过 Zod 校验，错误对象带 `raw`（原始输出，截断 4000 字符）与 `issues` |
| `AI_MODERATION_BLOCKED` | 输入或输出命中阻断级敏感规则（虐待/交易/绝对化医疗断言） |
| `AI_UNAVAILABLE` | 网络 / 鉴权 / 限流等 Provider 故障 |
| `AI_TIMEOUT` | 超过 `AI_TIMEOUT_MS`（默认 20s） |

### 检索为什么要「向量 + 关键词」混合

本地词袋向量（`hashEmbedding`，中文 2-gram + 哈希）在短问句上区分度不够——实测
「绝育后怎么护理」的余弦分 0.105，而完全无关的「天文望远镜」也有 0.102，几乎分不开。

所以 `lib/rag/retriever.ts` 的做法是：先用 pgvector 粗召回，再算一遍**关键词覆盖率**
（`lib/rag/keyword.ts`，查询 n-gram 命中文档的比例，虚字 2-gram 先剔除），
最终取两者最大值。没有字面重叠就是 0，不会产生哈希冲突带来的伪相似。

换成真实 embedding 模型后余弦分普遍在 0.7+，关键词分更低，取最大值依然成立，
因此这套融合在 mock 与真实模型下都能用。

## 自测与验收

```bash
npm run typecheck          # 类型检查，期望 0 错误
npm run lint               # 含「禁止在 JSX 里硬编码语义色」自定义规则
npm run build              # 生产构建（含 prisma generate）
npm run ui:audit           # UI 一致性 + AA 对比度，期望 23 通过 / 0 失败
```

功能自测（**HTTP 模式必须串行跑**，共用同一个 `.next`）：

| 命令 | 覆盖 | 期望 |
|---|---|---|
| `npm run db:selftest` | 迁移、种子幂等、向量检索、预警种子 | 19 / 1（RAG 召回 1 条不达标，`RAG_ABS_MIN` 阈值偏松，已知） |
| `npm run ai:selftest` / `ai:http:selftest` | AI 管道（含超时、降级重试、模型输出归一化） | 40 / 0 · 25 / 0 |
| `npm run id:selftest` / `id:selftest:http` | 识别管线（端口 3137） | 32 / 0 · 41 / 0 |
| `npm run health:selftest` / `health:http:selftest` | 健康评估 + reconcile + 预警 + 视觉挂掉退回纯文字（3312） | 63 / 0 · 67 / 0 |
| `npm run obs:selftest` / `obs:http:selftest` | 观察落库 + 同事务预警（3314） | 38 / 0 · 49 / 0 |
| `npm run rag:selftest` / `rag:http:selftest` | RAG 检索问答 + 引用（3316） | 54 / 0 · 61 / 0 |
| `npm run alerts:selftest` / `alerts:http:selftest` | 预警规则 + 权限 + 审计 + 报告审核三动作（3318） | 51 / 0 · 61 / 0 |
| `npm run agent:selftest` / `agent:http:selftest` | ReAct 编排 + 工具链路 + 降级 + 星轨/闸门 + 位置记录（含设备定位）（3319） | 80 / 0 · 85 / 0 |
| `npm run insight:selftest` | 星图观测手记：预计算 + 三重防幻觉 + 指纹缓存 + 首屏预算 | 56 / 0 |
| `npm run ai:e2e` | **AI 核心链路端到端**（3340）：5 维度 14 条 · 强制 `AI_PROVIDER=mock` · 真实 HTTP 路由 · 契约先行 | 14 / 0 |

## 目录

```
src/
├─ app/              App Router：(site) 学生侧 · admin 管理侧 · api 接口
├─ components/
│  ├─ ui/            shadcn/ui 原子
│  ├─ star/          StarCard StarDot StickerTag NoteCard Disclaimer ConfidenceBadge
│  ├─ shell/         星尘背景 / 页头 / 底部导航 / 页面外壳
│  ├─ capture/       识别链路 ·  agent/ 星轨 ·  health/ 健康结果 ·  notebook/ 手账时间线
│  ├─ map/           星图 + 观测手记 ·  chat/ 问答   ·  admin/ 处置台
├─ lib/
│  ├─ ai/            Provider 抽象 + 五家实现 + Zod 契约
│  ├─ identify/      识别管线    ·  health/ 评估 + reconcile 派生
│  ├─ agent/         ReAct 编排 + 10 工具 + trace
│  ├─ insight/       问答口径判定 + 观测手记（全局预计算 → 一句话）
│  ├─ alerts/        规则集(R1-R5) + 引擎 + 负面标签
│  ├─ rag/           切块 / 检索 / 引用 / 提示词
│  ├─ admin/         预警处置 + 报告审核 ·  auth/ 口令门禁
│  ├─ safety/        敏感过滤 / 置信度闸门 ·  api/ 接口契约 ·  db/ 审计
│  └─ semantic.ts    语义色唯一映射源
├─ styles/tokens.css 设计令牌唯一事实源
prisma/              schema · migrations · seed
scripts/             各层自测（直连 + HTTP 双模式）
```

## 代码规范

工程约定集中写在 [`docs/代码规范.md`](./docs/代码规范.md)，要点：

- **分层**：`app/api/*/route.ts` 只做解析、限流、鉴权、统一信封；业务裁决与落库全部在 `src/lib/`，以便脱离 HTTP 单测。
- **契约**：请求/响应用 Zod 定义在 `src/lib/api/*-contract.ts`，前后端共用同一份，接口与页面不各写一套类型。
- **令牌**：颜色等视觉常量只允许来自 `src/styles/tokens.css` 与 `src/lib/semantic.ts`；ESLint 用 `no-restricted-syntax` 禁止在 JSX 里硬编码十六进制色值。
- **注释**：文件头写「为什么这么做」，决策旁标日期；不写「这里是循环」这类复述代码的注释。
- **格式**：Prettier（`semi` / `singleQuote` / `trailingComma: all` / `printWidth: 100` / Tailwind 类名排序）。

提交前自查：

```bash
npm run lint          # ESLint（next/core-web-vitals + 项目自定义规则）
npm run typecheck     # tsc --noEmit，严格模式
npm run agent:selftest   # 或任一 scripts/*-selftest.ts，按改动范围选
```

## 环境与依赖

- 运行环境：**Node.js ≥ 20**（开发用 20.19）、npm ≥ 10、**PostgreSQL 16 + pgvector**。
- 数据库可用 `docker compose up -d --wait` 一键起（端口 5433，避免与本机 5432 冲突），也可以接本机 PostgreSQL（需自行 `CREATE EXTENSION vector`）。
- AI 侧默认 `AI_PROVIDER=mock`，**不需要任何 API Key** 即可跑通全部流程；接真实模型只需填 `AI_API_KEY` + `AI_MODEL`。
- 完整变量说明见 [`.env.example`](./.env.example)（每一项都有注释）与 [`docs/环境配置说明.md`](./docs/环境配置说明.md)；逐包版本见 [`docs/依赖清单.md`](./docs/依赖清单.md)。

## 团队信息

> 下表请按实际参赛信息填写（当前为占位，提交前务必替换）。

| 角色 | 姓名 | 主要工作 |
|---|---|---|
| 队长 / 产品与前端 | 【待填】 | 需求拆解、交互与视觉设计、页面实现、答辩材料 |
| 算法与后端 | 【待填】 | 识别管线、健康评估、RAG 检索、Agent 编排 |
| 数据与测试 | 【待填】 | 数据建模、种子数据、自测脚本与验收 |
| 指导教师 | 【待填】 | 选题指导、场景确认、评审对接 |

- 学校 / 学院：【待填】
- 联系邮箱：【待填】
- 项目起止：2026-10-24 起

## 免责声明

平台所有健康评估均由 AI 基于照片与文字描述生成，**仅供参考，不构成兽医诊断**。
动物出现明显异常时请联系校兽医或当地动保组织。
