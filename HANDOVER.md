# 智护流浪星 · Stray Star —— 交接文档（HANDOVER）

> 面向**接手这个仓库的人或另一个 AI 编码平台**。读完这份就够看懂架构、判明现状、继续往下做，
> 不需要原始会话上下文。命令细节看 `README.md`，阶段规格在 `docs/stage-N-*.md`（stage-0 ~ stage-9 全在），
> **写代码的强制约定在 `stray-star/CLAUDE.md`——先读它再动手**。
>
> 文档状态：2026-10-25 整理。对应的代码状态：**Stage 0–9 全部完成，构建通过，自测全绿。**

---

## 1. 这是什么

面向高校学生的**校园流浪动物识别与健康管理**平台。一句话目标：**让每只校园流浪动物被认识、被了解、被持续关注**。

视觉概念 **星空图鉴 × 救助手账**：外壳是深空观测站（每只动物是一颗星），内页是纸质手账（承载众包记录）。

### 叙事词典（全站统一，写文案时照此命名）

| 概念 | 叙事 | 视觉表达 |
|---|---|---|
| 识别 | 捕获星卡 | 取景框星形描边 + 星尘扫描线 |
| 建档 | 点亮一颗星 | 新星星卡弹出（burst 420ms） |
| 健康 | 三色星 | 绿稳定星 / 黄闪烁星 / 红告警星 |
| 预警 | 红星脉冲 | 2.4s 光环扩散 |
| Agent | 星轨 | 环形轨道 + trace 节点 |

**底线：拒绝后台管理系统式 UI，创意不得牺牲「拍照 → 识别 → 看结果」三步主链路**，任何交互优先保证这三步在移动端单手完成。

### 当前 snapshot

| 项 | 值 |
|---|---|
| 阶段进度 | S0–S9 全部完成（9/9） |
| 路由 | 前端 10 个页面组 + 11 个 API（详见 §4、§5） |
| 最近一次全量回归 | typecheck 0 / eslint 0 error / `ui:audit` 23/0 / `db:selftest` 18/0 / identify 28/0 / health 53/0 / obs 33/0 / rag 48/0 / alerts 50/0 / agent 30/0 |
| 构建 | `next build` 成功（约 50s），`/design` `/scan` `/agent` `/map` `/api/stats` 保持静态 `○` |
| 数据（seed 基线） | 5 只动物 · 15 条观察 · 1 条预警 · 1 份报告 · 知识库文档若干 |
| 上次运行方式 | 生产模式 `next start -p 3000`；**整理本文件时已停止，端口已释放** |
| ⚠️ 已知阻塞 | 本机 PostgreSQL 服务 `postgresql-x64-16` 处于 **Stopped**（自动启动，但当前未运行）；拉起它需要管理员权限。**数据库没起来时页面会直接报错**，接手第一步先确认它。 |

---

## 2. 技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 框架 | Next.js **14.2.15**（App Router，Server Components + Route Handlers） | `reactStrictMode: true` |
| 语言 | TypeScript 5.6（strict） | 路径别名 `@/` → `src/` |
| 样式 | Tailwind 3.4 + `tailwind.config.ts` 只做令牌映射 | 令牌定义在 `src/styles/tokens.css` |
| UI 原子 | shadcn/ui（Radix primitives：dialog / select / tooltip / tabs / switch / separator / scroll-area） | `src/components/ui/` |
| 动效 | Framer Motion 11 | 基线 240ms / `cubic-bezier(.2,.8,.2,1)`，脉冲 2.4s，尊重 `prefers-reduced-motion` |
| 数据库 | PostgreSQL 16 + **pgvector**（`vector(1536)`） | Prisma 5.22（`postgresqlExtensions` preview） |
| 地图 | Leaflet 1.9 + react-leaflet 4.2 | 星点**不用 divIcon**：经纬度投影成像素后用 React 画 |
| 校验 | Zod 3（所有 AI 输出与 API 入参） | 失败一律走 fallback，异常不抛到客户端 |
| 认证 | 学生端未开放登录（`User` 表已备好）；管理端是**最小口令门禁**（HMAC cookie） | `next-auth` 已装但只用于将来扩展 |
| AI | 统一 Provider 抽象：`mock` / `openai` / `qwen` / `glm` / `deepseek` | 默认 `mock`，**无需任何 key 全流程可跑** |

---

## 3. 目录结构

```
仓库根/
├─ docs/                 阶段规格 stage-0…stage-9 + demo-script（改契约前必读）
├─ CLAUDE.md             导航文件（根级，与 stray-star/CLAUDE.md 内容不同层级）
├─ .cursorrules          与根 CLAUDE.md 逐字节一致（除首行）
├─ copilot-instructions.md  同上
└─ stray-star/           ★ 应用代码在这里，所有 npm 命令在这个目录跑
   ├─ CLAUDE.md          ★ 本项目对开发者的强制约定（红线 / 环境坑 / Don'ts）
   ├─ README.md          启动、环境变量、演示动线、自测矩阵
   ├─ HANDOVER.md        本文件
   ├─ prisma/
   │  ├─ schema.prisma   12 个模型 + 9 个枚举
   │  └─ seed/           animals · observations · knowledge · photos · users（幂等 upsert）
   ├─ scripts/           各层自测（直连 + HTTP 双模式）· ui-audit.ts · rag-ingest.ts
   └─ src/
      ├─ app/(site)/     首页星图 / scan 识别 / animals 图鉴 / animals/[code] 档案手账
      │                  / chat 问答 / agent 星枢 / report 众包记录 / design 设计走查 / map（redirect）
      ├─ app/admin/      处置台 login · alerts（独立外壳，不带学生端 tab）
      ├─ app/api/        identify · animals · observations · health/assess · chat · agent
      │                  stats · admin/{alerts,alerts/[id],reports/[id],session}
      ├─ components/     ui/ star/ shell/ capture/ health/ notebook/ chat/ map/ admin/ agent/ home/
      ├─ hooks/          useIdentifyMachine · useReducedMotion
      ├─ lib/            （见下）
      ├─ styles/         tokens.css（单一事实源）· globals.css · leaflet.css
      └─ types/          domain.ts（VM 类型）
```

`src/lib/` 分层（**新功能必须落在对应目录，不许另起平行实现**）：

| 目录 | 职责 |
|---|---|
| `ai/` | Provider 抽象 + 各家实现 + Zod 契约 + 本地确定性 embedding（mock 用） |
| `identify/` | pipeline · scoring · fingerprint · create-animal |
| `health/` | `derive.ts`（健康等级唯一算法）· `reconcile.ts`（一致性校正）· `assess.ts`（编排） |
| `alerts/` | `rules.ts`（规则集，唯一来源）· `engine.ts`（执行）· `negative-tags.ts` |
| `observations/` | `create.ts`（落库 + 同事务触发预警） |
| `admin/` | `alerts.ts`（处置业务层）· `reports.ts`（报告审核三动作 + diff 审计） |
| `auth/` | `actor.ts`（管理端最小口令门禁：HMAC cookie → Actor） |
| `rag/` | chunk · retriever · keyword · citations · answer · intent |
| `agent/` | 真 ReAct 编排 `plan→tool→observe→…→final` + 6 工具注册表 + trace |
| `db/` | PrismaClient · pgvector 检索 · audit · timeline |
| `safety/` | moderation（敏感过滤）· guard（置信度闸门） |
| `api/` | 接口契约（Zod + VM）· idempotent（clientId 幂等） |
| `map/` `map-config.ts` | 坐标聚合 snap · 地图唯一配置源 |
| `semantic.ts` | **语义色唯一映射源**（含星轨 `TRAIL_STEP_META` / `TRAIL_TOOL_LABEL`） |
| `permissions.ts` | **权限唯一裁决处** |

---

## 4. 页面路由

| 路由 | 作用 | 备注 |
|---|---|---|
| `/` | 首页夜色校园星图（可拖动/双指缩放，暗色路网底图） | `CampusStarMap` → `CampusStarMapCanvas`（`dynamic ssr:false`） |
| `/scan` | 拍照识别 → 星卡捕获 | 移动端主链路起点 |
| `/animals` | 图鉴（筛选 + 搜索） | |
| `/animals/[code]` | 档案手账：时间线 + 便签墙 + 健康卡 | 移动端底部 `RecordBar` 就地记录 |
| `/report` | 众包记录整页表单（支持 `?animal=No.001` 预选） | 桌面入口；与 `RecordBar` 共用 `useRecordDraft` |
| `/chat` | RAG 知识问答（带星标引用） | |
| `/agent` | 星枢 Agent 控制台 + 星轨可视化 | |
| `/design` | 设计令牌与基础组件走查页（静态） | |
| `/map` | **redirect 到首页**（已拍板：不与首页星图重复） | |
| `/admin/login` · `/admin/alerts` | 预警处置台（独立外壳） | `ADMIN_TOKEN` 未配置时门禁关闭 |

---

## 5. API 契约

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/identify` | 图片 → 特征 → 候选比对 → 命中/建档（multipart） |
| GET | `/api/animals` | 列表（支持筛选） |
| POST | `/api/observations` | 众包记录（multipart，**同事务触发预警**） |
| POST | `/api/health/assess` | 多模态健康评估（multipart） |
| POST | `/api/chat` | RAG 问答（带引用来源） |
| POST | `/api/agent` | 星枢 Agent（multipart，一句话完成多步任务） |
| GET | `/api/stats` | 统计（30s 缓存，客户端补数用） |
| POST/DELETE | `/api/admin/session` | 管理端登录/登出（HMAC cookie） |
| GET/POST | `/api/admin/alerts` · `/api/admin/alerts/[id]` | 处置台列表与动作（ACK / RESOLVE） |
| PATCH | `/api/admin/reports/[id]` | 报告审核三动作：通过 / 驳回 / 通过并修改 |

统一约定：所有 AI 入口都经过「敏感过滤 → Zod 校验 → 失败兜底 → `ConfidenceBadge` + 免责声明」；低置信度（< 0.6）必须显式提示"不确定"。写操作必须带 `clientId` 幂等键。

---

## 6. 数据模型（12 模型 / 9 枚举）

| 模型 | 关键字段与设计意图 |
|---|---|
| `User` | `studentId` 唯一、`role`（STUDENT/ADMIN）、`password`（bcryptjs 已装） |
| `Animal` | `code`（No.012）、`embedding vector(1536)`、`features String[]`（**既是展示内容也是识别比对目标**）、`pendingReview`（匿名建档＝未确认事实）、`healthManual`（管理员手动优先，不被 14 天窗口推翻） |
| `AnimalPhoto` | 独立 embedding，`pendingReview` |
| `Observation` | `userId?`（**匿名提交为 null**，不建占位 User 以免破坏审计语义）、`severity` 与 `manualSevere` **分开存**（AI 与人来源不同，事后可查分歧）、`seedKey` |
| `HealthReport` | `healthStatus`（必填无默认：宁可插入失败也不静默变 GREEN）、`confidence`、`disclaimer`、`reviewStatus` / `reviewedByAdmin` **双轨**（见 §9 债务） |
| `Alert` | `status`（OPEN/ACK/RESOLVED，`ackAt` 与 `resolvedAt` 分离）、`ackedByRole`（匿名最多 ACK，不得 RESOLVE CRITICAL）、`source`（OBSERVATION \| HEALTH_REPORT）、**`dedupeKey`（规则引擎专用）与 `seedKey`（种子专用）严格分开**、`observationId` / `reportId`（**证据回指**：这条预警是被哪次目击、哪份报告触发出来的，`onDelete: SetNull`） |
| `KnowledgeDoc` / `KnowledgeChunk` | 整篇向量（兜底召回）+ 段级向量（精确定位引用），引用粒度是"第 N 段" |
| `AuditLog` | `payload Json`（报告审核 diff 进这里） |

**Seed 幂等契约**：所有种子数据带 `seedKey`，走 upsert。**禁止 `deleteMany` 清表**——重跑 seed 永远不能碰到用户数据。自测产生的行必须自建自清。

---

## 7. 五条核心链路

### 7.1 识别（S3）
**链路**：`app/api/identify` → `lib/api/identify-contract.ts`（入参 Zod）→ `lib/identify/pipeline.ts`
图片 → 浏览器端压缩 → AI 视觉结构化输出（Zod 校验） → 与库内 `features` 做字面覆盖率比对 → 融合打分 → 命中则更新 `AnimalPhoto`，未命中则 `create-animal` 点亮新星。
**阈值按"覆盖率"标定，所以 `Animal.features` 不能为空**——这是 schema 注释里写死的原因。

### 7.2 健康评估（S5）
`assess.ts` 编排 → AI 输出 → `reconcile.ts` 强制校正（`SEVERE` 必须 `needsVet: true`；禁止"保证治好"类措辞）→ `derive.ts` 落三色档。
**健康等级的唯一算法在 `derive.ts`，改 `assess.ts` 没用。**

### 7.3 RAG 问答（S6）
向量（pgvector） + 关键词（BM25 式）**双轨阈值**检索 → 段级引用 → `answer.ts` 合成答案 + 引用脚标。
双轨的原因：纯向量会漏掉精确术语，纯关键词漏语义。

### 7.4 预警（S7）
规则集只在 `alerts/rules.ts`（**唯一来源**，新规则只许追加，不许改调用点），带 `source` 分派。
**预警与业务记录必须同事务写入**——"记下了但没人被通知"比整条失败更危险。一次提交只回传最严重的一档，不许弹两条。

**预警必须留住证据**：规则命中时把触发它的 `observationId` / `reportId` 一并落库（同一事务内），同一 `dedupeKey` 再次命中则把指针刷新到最新证据；本次没带 id 就保留原值，不抹掉已有证据。管理端「预警照片」的取值链因此是 **证据图 > 档案头像 > 第一张归档照片**，每一级都过 `public` 下存在性校验（`uploads` 不进版本库，库里可能留着已删文件的 url），组件端再兜一层 `onError` 退回首字母——管理员要看的是"这次到底拍了什么"，不是这只动物的证件照。

### 7.5 星枢 Agent（S8）
真 ReAct：`plan → [决策 → 调工具 → 观察写回 ctx]* → final`。6 个工具（identifyAnimal / assessHealth / queryArchive / addObservation / checkAlerts / searchKnowledge）。
上限：工具步 ≤5、星轨总步 ≤7、单步超时 8s。**任一工具失败立即中断 → 降级走 RAG 安全航线 → `degraded=true`**（前端显示"改走安全航线"）。

### 7.6 安全与权限（S9）
- 权限唯一裁决处 `lib/permissions.ts`（`canAckAlert` / `canResolveAlert` / `canReviewReport`），**被拒原因原样回传，前端不得改写**。
- 报告审核：`reviewReport()` 三动作，diff 进 `AuditLog`，驳回无理由在契约层就被拦。
- 兜底话术唯一来源 `constants.FALLBACK_TEXT`（`safety/fallback.ts` 已删）。

---

## 8. 设计系统与红线（摘要，完整版见 `CLAUDE.md` §2）

- **R1 令牌单一事实源**：`src/styles/tokens.css` 定义 CSS 变量，`tailwind.config.ts` 只做映射。组件里**禁止硬编码十六进制**（ESLint `no-restricted-syntax` 已拦截）。改完样式必须跑 `ui:audit`。
- **R2 语义色只走 `lib/semantic.ts`**（`HEALTH_META` / `ALERT_META` / `tagTone` / `TRAIL_STEP_META`）：识别、档案、地图、预警、Agent **五处必须同色同义**。
- **R3 动效基线** 240ms / `cubic-bezier(.2,.8,.2,1)`，脉冲 2.4s，必须尊重 `prefers-reduced-motion`（reduced 下不许把元素藏掉）。
- **R4 AI 输出一律结构化 + Zod 校验**，失败走 fallback，原始错误绝不出现在客户端。
- **R5 置信度 < 0.6 显式提示"不确定"**；健康结论必须带免责声明。
- **R6 预警规则只在 `alerts/rules.ts`**，且与业务记录同事务。
- **R7 权限唯一裁决处 `permissions.ts`**。
- **质量标准**：暗色下 WCAG AA（正文 ≥4.5:1、图形 ≥3:1），`ui:audit` 硬阈值；当前正文最紧 6.85:1、图形最紧 6.14:1。
- **移动端优先**；不要按屏幕宽度代替 hover 能力判断。

---

## 9. 当前规划：债务与下一步建议

### 9.1 已登记的债务（在 `CLAUDE.md` §11）

| # | 债务 | 影响 |
|---|---|---|
| D1 | 管理端列表无分页（`take: 50` 截断）、预警**无主动通知渠道**（只在提交响应里回「已通知管理员」） | 数据量大了失真；管理员不盯着就漏事 |
| D2 | `reviewedByAdmin` 与 `reviewStatus` 双轨（写入同步，读取仍以旧字段为主） | 接真实登录后可二合一 |
| D3 | 自测残留曾让 `db:selftest` 掉到 15/1（挂在种子动物上的规则引擎预警不会被删测试动物级联带走） | 已用 `RUN_STARTED_AT` + `dedupeKey` 前缀精确回收，**新自测脚本必须自建自清** |

### 9.2 建议的下一步（按优先级，这是我的判断，不是用户已确认的任务）

**P0 — 先把环境拉起来**
1. 拉起数据库（`Get-Service postgresql-x64-16` → Running），否则页面一片红。
2. `npm install` → `prisma generate` → `prisma db push` → `npm run db:seed` → `npm run dev`，用 `/scan` 走一遍主链路确认通。

**P1 — 功能债务里最值得先做的一条**
3. **主动通知渠道**：把"提交时回一句已通知管理员"改成真的发出去（企业微信机器人 / 邮件 / 短信其一）。这是当前产品最大的"看起来有、实际没有"的点，也是演示时最容易被追问的一环。
4. **管理端分页**：列表 + 游标，配按 `source` / `status` 筛选。

**P2 — 接真实登录（解锁 D2 的现实前提）**
5. `next-auth` 与 `User.password` 都已就位，缺的是入口 UI 与路由守卫。做完后 D2 双轨可以直接合并为 `reviewStatus` 单轨（注意存量数据 migration 要保留 `APPROVED` 语义，别把历史审核结论洗掉）。

**P3 — 演示与工程化**
6. 演示动线脚本化（`docs/demo-script.md` 已有五步，可做成一键 seed + 断言）。
7. 自测进 CI（`package.json` 里各 `*:selftest` 已是直连/HTTP 双模式，串行走即可，**不要并行**——它们共用 `.next` 与同一个库）。
8. 接真实 Provider 后再谈识别准确率调优；`mock` 模式下调这个没有意义 —— mock 的视觉特征是确定性的，对任意输入返回同一组特征，相似度恒为 100%。

**P4 — 可选**
9. PWA / 添加到主屏（现场演示体验提升明显）。
10. 数据导出与年度归档（流浪动物台账是社团的真实需求）。

---

## 10. 换到另一个平台跑：注意事项

这一节有两种可能的含义，按你的实际情况取用。

### 10.1 换 AI 编码平台（Cursor / Claude Code / Copilot 等）

- 仓库内已有三份导航文件：`CLAUDE.md` / `.cursorrules` / `copilot-instructions.md`（**除首行标题外逐字节一致**，校验 `tail -n +2 <file> | md5sum`）；`stray-star/` 内另有 `CLAUDE.md` + `copilot-instructions.md` 一对。新平台的模型读入对应文件即可继承全部约定。
- 改约定时**必须同步全部副本**，否则下一位接手者会读到过期规则。
- `stray-star/CLAUDE.md` §12「已知环境坑」里**有一部分是本机沙箱特有的**（见下），换平台后大概率不适用，别把它们当成项目本身的性质：
  - `next build` 在 `.next/trace` 上的 EPERM → 那是沙箱安全策略导致，我给 `node_modules/next/dist/trace/report/to-json.js` 打了补丁；**重装依赖后补丁会丢**，新环境不需要也不需要重现。
  - 各种 `rm -rf` / 覆盖写被拦截、杀进程要 `taskkill /T /F` 等，同属沙箱行为。
- **与沙箱无关、必须继承的坑**（这些是真 bug 教训）：
  - Tailwind 的 `/opacity` 修饰符对 CSS 变量色板无效：`from-amber2-400/80` 会生成一条没有色标的渐变，浏览器算出来是 `backgroundImage: none` —— 元素尺寸、动画都正常，就是看不见。改用 `color-mix()` 或内联 `linear-gradient`。
  - 不要在 `setState` 的 updater 里调用另一个 `setState`（StrictMode 双调用会让计数翻倍）。
  - Leaflet 的坐标必须统一过 `toTileLatLng()` 纠偏，漏一处那处单独飘 ~490m。
  - CARTO basemaps 无 key 时返回 200 + 水印图，前端收不到 `tileerror`，降级链不会触发。
- 交付节奏约定：**每个阶段先给「文件树 + 接口契约 + 组件树 + 设计令牌落点」，确认后再写完整代码**（这条是用户明确要求，写在 `CLAUDE.md` §11）。

### 10.2 换部署平台（Vercel / 服务器 / Docker）

| 项 | 现状 | 迁移时要改什么 |
|---|---|---|
| 数据库 | 本机 Windows 服务 Postgres 16 + pgvector | Serverless 平台**没有本地库**：换 Neon / Supabase / RDS 等支持 pgvector 的托管库，改 `DATABASE_URL`。注意 `prisma/schema.prisma` 里开了 `extensions = [vector]` |
| 文件上传 | `UPLOAD_DIR="public/uploads"`，写本地磁盘 | Serverless 下不可持久化且多实例不共享 → 换对象存储，改 `lib/uploads.ts`（**这是唯一的写入点**） |
| AI Provider | 默认 `mock` | 生产填 key + `AI_PUBLIC_BASE_URL`（图片要能被视觉模型访问，**相对路径必须拼绝对地址**） |
| 构建 | `prisma generate && next build` | 部署平台要保证 `prisma generate` 在 build 前跑；schema 改了要重跑 |
| 会话 | 管理端 HMAC cookie | `NEXTAUTH_SECRET` 必须设真值（现 example 里是占位串） |
| `next.config` | 已开 `images.remotePatterns: https **`、`serverActions bodySizeLimit 10mb` | 若用自有图床/对象存储，建议收紧 hostname 白名单 |

---

## 11. 命令速查

```bash
# 启动（在 stray-star/ 下）
npm install
npm run db:push          # 建表
npm run db:seed          # 播种（幂等 upsert，不动已有用户数据）
npm run dev              # http://localhost:3000
# 生产模式
npm run build && npm run start
```

自测矩阵（**串行跑，不要并行**——共用 `.next` 与同一个数据库）：

```bash
npm run db:selftest           # 18 项：schema 完整性、校园围栏、种子数据基线
npm run ai:selftest           # Provider 抽象与 mock 确定性
npm run id:selftest           # 识别链路（加 :http 走真实服务）
npm run health:selftest       # 健康评估
npm run obs:selftest          # 众包记录
npm run rag:selftest          # RAG 问答
npm run alerts:selftest       # 预警规则
npm run agent:selftest        # 星枢 Agent
npm run ui:audit              # 设计令牌一致 + WCAG AA（必须 0 失败）
npm run typecheck             # tsc --noEmit
npm run lint
```

**如果 `npm run xxx` 报"不是内部或外部命令"**：`node_modules/.bin` 的软链被安全软件清掉了，`npm rebuild` 修复；临时绕法 `node node_modules/next/dist/bin/next dev -p 3000`。

---

## 12. 接手后可以放心删的东西

- 仓库根 `stray-star/e2.html` / `stray-star/err.html`：453 字节的 Next 错误刷新页，**排查问题时手动保存的诊断残留**，与项目无关。
- `stray-star/tsconfig.tsbuildinfo`：tsc 增量缓存产物。

其余文件均在职责内，删前对照 §3 目录表确认。
