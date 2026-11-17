# AI 深度集成度审查报告

> 审查目标：满足比赛评分要求「AI 功能是应用的核心而非附属功能」。
> 审查范围：`src/lib/`（78 个 .ts / 12,008 行）、`src/app/api/`（16 个路由），以及会触发 AI 的前端入口（`src/hooks/`、`src/components/capture|chat|notebook`）。
> 审查日期：2026-10-28。审查方式：静态通读 + 调用点穷举（`intent: '...'`、`runStructured`、`runVision`、`getProvider`）+ 规则表密度统计 + 真实链路复跑。

---

## 0. 结论速览

| 评分维度 | 现状 | 判定 |
|---|---|---|
| AI 是否驱动写库与状态 | 识别/健康/记录/问答四条写入链路 4/4 都由模型判定驱动，且同事务落库 | ✅ 达标 |
| AI 是否只是「生成一段字」 | 主链路没有纯装饰性 AI；但有 3 处 AI 产出被丢弃、1 处可被 mock 静默顶替 | ⚠️ 有硬伤 |
| 意图理解是否由 AI 接管 | **否**。对话意图、统计问答全部由正则/词表判定（`intent.ts` 3 张词表；`ask.ts` 27 条正则、357 行） | ❌ 不达标 |
| 身份判定是否由 AI 接管 | **部分是**。个体识别（拍照→向量）是 AI；但「这句话在说哪只动物」是 `q.includes(name)` 字符串包含 | ❌ 不达标 |
| 数据清洗是否由 AI 接管 | **部分是**。记录文本→标签→严重度是 AI；但建档时名字/物种/特征全靠人手输，AI 抽出的特征没回流表单 | ❌ 不达标 |
| 核心操作能否绕过 AI | 能。图鉴搜索、管理端搜索、建档表单、记录类型手选、位置补充，5 个入口都能纯传统方式完成 | ❌ 不达标 |
| 兜底是否工程化 | 低置信度提示、超时降级、敏感拦截、置信度+免责展示齐全 | ✅ 达标 |

**一句话结论**：AI 已经在「写」这一侧接管得很彻底（这是真优势，答辩时要讲），但在「读」这一侧——**用户这句话什么意思、在说哪只动物、搜什么**——仍然是规则在做主。评委只要问一句「你把 AI 关掉，搜索和问答还能用吗」，现在的答案是「能，而且更快」，这正好踩中红线 ★1。

**AI 触达率**：16 个 API 路由中，5 个直接触发模型推理（`identify` / `health/assess` / `observations` / `chat` / `agent`），1 个只做 embedding（`animals`），其余 10 个是纯 CRUD。核心写入链路 100% 覆盖，读侧链路 0% 覆盖——这就是要补的缺口。

---

## 1. 用硬编码规则做了本该 AI 做的事

按「是否影响评分」排序。**风险等级 A** = 评委一眼能看穿的假 AI；**B** = 能解释但站不住；**C** = 合理，但需要一句话说明。

| # | 位置 | 规则干了什么 | 规模 | 风险 |
|---|---|---|---|---|
| 1 | `src/lib/insight/ask.ts` | 「这个问题能不能用数据库答、答哪一类」全靠 27 条正则 + 10 个 if 分支 | 357 行 / 27 正则 | **A** |
| 2 | `src/lib/rag/intent.ts` | 对话意图（KNOWLEDGE / ANIMAL / MIXED）靠 3 张词表 + 2 个正则 | 79 行 / 29 词 | **A** |
| 3 | `src/lib/rag/animal-index.ts:93,106` | 实体识别（这句话在说哪只动物）靠 `q.includes(a.name)` 与 `q.includes(feature)` | 2 处包含判断 | **A** |
| 4 | `src/app/(site)/animals/page.tsx:54-61` | 图鉴搜索 = `name/code ILIKE '%q%'`，占位符却写「搜索星号、名字或特征」 | 1 处 SQL 包含 | **A** |
| 5 | `src/components/admin/AnimalsManager.tsx:69-75` | 管理端搜索 = 客户端 `toLowerCase().includes()` | 1 处 | **B** |
| 6 | `src/lib/observations/create.ts:94` | 记录类型 `input.type ?? inferType(...)`：用户手选直接压过 AI 判定，且不留分歧记录 | 1 行 | **B** |
| 7 | `src/lib/observations/create.ts:90-91` | 勾「情况紧急」→ `severity` 强制 SEVERE，AI 判断被完全覆盖（人工否决合理，但没记「AI 原本判了什么」） | 2 行 | **B** |
| 8 | `src/lib/ai/embeddings.ts:22-28` | embedding 失败静默退回 `hashEmbedding`（词袋+哈希），与真向量同为 1536 维，混进同一列 | 6 行 | **B** |
| 9 | `src/lib/safety/moderation.ts` | 敏感内容靠 6 条正则 | 59 行 | **C** |
| 10 | `src/lib/rag/keyword.ts` | 中文切分靠 2-gram + 虚字表 | 108 行 | **C** |

### 1.1 `insight/ask.ts`：统计问答是纯正则专家系统（最高优先级）

```ts
// 44-55 行，十类问题的判定全在这几张表里
const COUNT_WORD = /多少|几(只|条|张|个|位|次记录)|数量|总数|一共|总共|共有|统计|分布|占比|最多|最少|排行|排名/;
const DOMAIN_WORD = /动物|猫咪|流浪猫|流浪狗|猫|狗|星星|星图|档案|记录|观察|手账|照片|相片|预警|角落|区域|位置|坐标|同学|用户|数据|库里|数据库/;
const ATTENTION_WORD = /需要关注|要关注|重点关注|优先关注|异常|有问题|情况不好|危险|危急|红色|预警/;
const LIST_WORD = /哪些|哪个|谁|名单|列出|都有|有谁/;
```

后面 260 行是 10 个 if 分支，每个分支再叠 2–4 个正则做二次判别（例如 `!/怎么办|如何|护理/` 这种否定式排除）。

**问题不在「用正则」这件事本身，而在于它承担了完整的意图理解职责**：问一句「最近谁状态不太行」能不能落到第 5 个分支，取决于「不太行」在不在词表里。实测已经踩到两次：

- 问「猫粮多少钱一袋」被第 10 个分支认领，答成库统计（知识库扩到 16 篇后，它本该答「资料里没写」）；
- 问「咱学校现在有几只喵星人」——与「现在一共几只猫」同义——因为「喵星人」不在 `DOMAIN_WORD`，直接掉出统计分支，`intent` 变成 `KNOWLEDGE`，答成了《校园投喂规范》的推荐食物段落。

见文末「实测证据 ②」。

### 1.2 `rag/intent.ts`：对话意图靠词表，且 `CHATTER` 是死分支

```ts
const ANAPHORA = ['这只', '那只', '它', '此猫', '这条', '这只猫', '这只狗', '这孩子'];
const CARE_WORDS = ['怎么办','如何','怎么','注意','护理','症状','可以吗','能不能','要不要','建议','处理','喂','药'];
const STATE_WORDS = ['最近','近况','怎么样','状态','情况','还好吗','过得好吗','现在'];
```

三个问题：

1. **词表覆盖不了否定与并列**。「它最近没怎么吃东西怎么办」同时命中 STATE 与 CARE，按 `if (wantsAnimal && STATE...) return 'ANIMAL'` 走档案路，实际用户在问护理。
2. **`ChatIntent` 声明了 `CHATTER`，但 `classifyIntent` 永不返回它**（`intent.ts:24` 定义，`63-77` 只返回三种）。兜底话术分支事实上走不到，说明这套规则已经和调用方脱节。
3. **`CODE_RE = /No\.\d{2,3}/i` 要求用户会打编号**。没人会这么问。

### 1.3 `animal-index.ts`：身份判定是字符串包含

```ts
const byName = all.filter((a) => a.name.length >= 2 && q.includes(a.name));      // 93
const byFeature = all.filter((a) => a.features.some((f) => f.length >= 2 && q.includes(f))); // 106
```

「橘长」「煤球」这种两字名字很容易撞进无关句子（「把煤球放回食堂」）；「那只耳朵有缺口的猫」因为特征词是「右耳缺口」而整句不含它，直接匹配失败 → 退化成 KNOWLEDGE → 答成百科。这就是**身份判定没交给 AI** 的直接后果，而它正是红线条目 ★4 点名的四个环节之一。

---

## 2. 调了 AI，但结果没有进入业务

### 2.1 AI 产出被丢弃（3 处，都属于「看起来接了其实白接」）

| 位置 | AI 产出了什么 | 去哪了 | 影响 |
|---|---|---|---|
| `observations/create.ts:82` | `tagging.summary`：AI 对这条记录的 20 字概括 | **没用**。`tagging` 只取 `tags` 与 `severity`，`summary` 字段从未被读 | 记录列表无法按「一句话摘要」展示，AI 白花一次 token |
| `ai/schemas.ts:66` | `followUp`：AI 建议的追问 | **没用**。`RagAnswerSchema.followUp` 带默认值，但 `answer.ts` 全程不读 | 问答页「你可能还想问」只能写死 |
| `api/identify-contract.ts:44` | `species.features`：视觉模型抽出的外观特征 | **只到响应为止**。`pipeline.ts:196` 把它放进 `base.features` 返回了，但 `NewStarPanel` 只读 `suggestedSpecies`，特征输入框仍要人手打 | 建档时最关键的一步「数据清洗」实际由人完成（见 3.3） |

### 2.2 更危险的一处：AI 可以被 mock 静默顶替，而接口签名不变

```ts
// registry.ts:52-55 —— 没有 key 就换 mock，不报错、不提示业务层
if (!hasKey()) {
  log.warn('ai.no_api_key_fallback_mock', { requested: name });
  return mockProvider;
}
```

```ts
// .env.example:11 —— 新克隆的仓库默认就是 mock
AI_PROVIDER="mock"
```

`mockProvider` 是 562 行、47 条正则、上百个关键词的**规则模拟器**（`mock.ts:105-111` 用正则判意图，`mock.ts:29-40` 用关键词判物种/严重度）。它保证了 demo 永不 500，这是它的价值；但只要 `.env` 少一行 `AI_PROVIDER=glm`，整个系统就会变成「纯规则系统，但对外仍宣称 AI 驱动」——

- 接口返回里没有 `provider` 字段，前端和管理端都看不出现在是 mock；
- `health/assess.ts:347` 是唯一判断 provider 的地方（决定要不要把 `/uploads/x.jpg` 转成公网 URL）；
- 审计日志 `IDENTIFY` / `HEALTH_ASSESS` 的 payload 里也没有记录 provider 名。

**评委拿到的若是 zip 包，跑起来就是 mock，第 1 条红线当场判死。** 这是本次审查里唯一一个「不需要写新功能、但必须马上堵」的口子。

---

## 3. 核心操作可以绕过 AI 用传统方式完成

### 3.1 图鉴搜索（读者最高频入口）

`src/app/(site)/animals/page.tsx:54-61`

```ts
...(q ? { OR: [
  { name: { contains: q, mode: 'insensitive' } },
  { code: { contains: q, mode: 'insensitive' } },
] } : {}),
```

占位符（同文件 110 行）承诺的是「搜索星号、名字或**特征**」，实际只查 name/code 两列。实测：搜「瘸腿」「图书馆」「黑猫」各 0 条，搜「煤球」1 条——**AI 完全没参与，连 embedding 都没用**，而库里 `Animal.embedding` 是现成的（5/5 有向量）。见文末「实测证据 ①」。

### 3.2 管理端搜索

`src/components/admin/AnimalsManager.tsx:69-75`：`a.name / a.code / a.summary` 三个字段的 `includes`，注释还写着「动物量级小，搜索在客户端做，不往返数据库」。量级小是事实，但这条注释本身就是「可以没有 AI」的自白。

### 3.3 建档录入（`/scan` 未登记分支）

`useIdentifyMachine.ts:129-131` 只把 AI 的物种结论写进表单：

```ts
form: { ...state.form, species: event.data.matched ? ... : event.data.suggestedSpecies }
```

`NewStarPanel.tsx` 里 name（58-66）、species（79-82）、features（109-117）三处都要人手输。也就是说：**AI 看完了照片、抽出了「黑色短毛、右耳缺口、尾巴尖白」，然后让人重新打一遍「黑色短毛，右耳缺口」**——这正好是「数据清洗」该由 AI 接管的场景，现在是人替 AI 干。

另外 `POST /api/animals` 只强制 `name`，`species` / `features` / `summary` 全可选（`api/animals/route.ts:41-43`），所以完全存在「不传照片、只传一个名字」的建档路径；此时 `create-animal.ts:55-70` 会把 name 单独喂给 embedding，产出一个语义上几乎无信息的向量，污染识别库。

### 3.4 记录类型手选

`RecordComposer.tsx:253` 让人点 4 个类型 chip；`create.ts:94` 用 `input.type ?? inferType(...)`，即**用户点了就以用户为准，AI 的 `tags`/`severity` 只是陪跑**。合理的产品设计（人不该被 AI 锁死），但工程上应该记下「AI 原本判的是什么、人改成了什么」——现在这条分歧信息完全丢失，事后无法证明 AI 有判断力。

### 3.5 补充位置

`POST /api/animals/location` 纯坐标写入，无 AI。这一条**属于合理**：地理坐标不是 AI 该判的东西，不该为凑指标硬塞模型。

---

## 4. 重构建议

分三批。P0 是「评委一问就露」的口子，P1 是把 AI 从「写」推到「读」，P2 是补完整性。每项都写明改哪个文件、新增什么契约、怎么验收。

### P0-1 意图理解交给 AI（对应红线 ★1、★4）

**改哪里**：`src/lib/rag/intent.ts` → 拆成 `classifyIntentByAI()` + 保留 `classifyIntentByRule()` 作为 fallback。

**新增契约**（`src/lib/ai/schemas.ts`）：

```ts
export const ChatRouteSchema = z.object({
  intent: z.enum(['KNOWLEDGE', 'ANIMAL', 'MIXED', 'DATA', 'CHATTER']),
  /** 用户指代的具体个体；没点名就 null —— 供 3.3 的实体消歧使用 */
  animalName: z.string().max(20).nullable().default(null),
  /** 这句话是否在问库里的数量/名单 */
  needData: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
});
```

**关键实现约束**：

1. **不额外加一次往返**。把 `intent` 塞进现有 `RagAnswerSchema`，让一次生成同时给出「路由 + 答案」；只有当 `answer` 与 `intent` 自相矛盾（比如 intent=DATA 但没给数字）时才补一次独立分类调用。
2. **规则降级要留痕**：AI 分类失败 → 走 `classifyIntentByRule()`，并在 `degraded` 里 push `intent_rule_fallback`。这样「规则」从"主力"变成"兜底"，答辩时可以直接说：AI 不可用时才降级，且有标记。
3. **`CHATTER` 要被真正使用**：现在它是死枚举，接上之后「今天天气不错」才会走到兜底话术而不是硬检索。

**验收断言**（加进 `scripts/rag-selftest.ts`）：

- 30 条 gold set（含「它最近没怎么吃东西怎么办」「最近谁状态不太行」「猫粮多少钱」），AI 路由准确率 ≥ 90%；
- 强制 `AI_PROVIDER=mock` 时仍能跑通，且 `degraded` 含 `intent_rule_fallback`；
- 同一问题连跑 3 次，intent 必须一致（防止分类抖动，抖动就降级到规则）。

### P0-2 统计问答改「AI 出查询计划，代码出数字」（对应红线 ★1、★2）

**改哪里**：`src/lib/insight/ask.ts`（357 行 → 预计 120 行）。

**核心原则不变**：数字不由模型产生（这条要继续写进文档，是加分项）。变的只是「哪一类问题」这个判断由谁做。

```ts
export const DbQueryPlanSchema = z.object({
  topic: z.enum(['animalTotal','healthDist','alerts','attention','observations','photos','spots','pending','missingLocation','recent']).nullable(),
  /** 命中的角落名（须在 CAMPUS_SPOTS 白名单内，否则丢弃） */
  spot: z.string().max(20).nullable().default(null),
  species: z.enum(['CAT','DOG']).nullable().default(null),
  /** null = 这问题不该查库，交回知识/档案链路 */
  confidence: z.number().min(0).max(1),
});
```

`askDatabase()` 变成：`runStructured(plan)` → 校验 `topic` 与 `spot` 是否在白名单（**白名单纪律和引用白名单同一套，模型编的 spot 一律丢弃**）→ 走原来的确定性查询与文案。

**验收断言**：

- 10 个原有正例全部仍命中同一 topic（gold set 固化在自测里）；
- 3 个负例（「猫粮多少钱」「它今天怎么样」「小猫一直叫」）必须 `topic=null`；
- `spot` 传一个不存在的「北门」，必须被丢弃而不是拼进 SQL。

### P0-3 身份判定改「向量召回 + LLM 消歧」（对应红线 ★4）

**改哪里**：`src/lib/rag/animal-index.ts` 的 `resolveAnimalRef()`。

三步替换掉 `includes`：

1. **候选召回**：`Animal.embedding` 现成，用问题文本检索 top-3（复用 `db/vector.ts:34` 的 `searchAnimalsByEmbedding`，和识别链路同一出口）；
2. **LLM 消歧**：`AnimalResolveSchema { code: string|null, evidence: string }`，要求模型回答「这句话在说哪只，依据是哪个词」；`code` 不在候选 3 只内 → 判 `null`（同引用白名单纪律）；
3. **代词兜底**：`它/这只` 这类无名词指代，用会话上下文解——`/api/chat` 现在只接受客户端显式传的 `animalId`（`ChatPanel.tsx:60`），没有多轮记忆。建议在响应里回传 `resolvedAnimalCode`，客户端下一轮带上，形成最小会话上下文。

**验收断言**：

- 「那只耳朵有缺口的猫」必须解析到具体 code（当前这条**一定失败**，可作为回归起点）；
- 「煤球放回食堂」这句无关句必须不误判（当前 `includes` 会误判）；
- 候选为空时返回 `null` 并给出 reason，不许硬猜。

### P1-1 建档：AI 特征回流表单（数据清洗交给 AI）

- `identify-contract.ts` 的 `IdentifyUnmatchedSchema` 增加 `suggestedFeatures: z.array(z.string()).max(6)` 与 `suggestedSummary`；
- `NewStarPanel` 用它们预填 features/summary，输入框保留可编辑（人说最后一句话）；
- `createAnimal` 增加 `featuresSource: 'ai' | 'ai_edited' | 'manual'`，写进 `ANIMAL_CREATE` 审计；
- 空输入守卫：既无照片又无 features 的建档请求，降级为 `pendingReview` 并标 `lowEvidence`（而不是直接产出垃圾向量）。

### P1-2 搜索语义化（AI 接管「搜什么」）

`/animals` 的 `q` 改成三路合并，按顺序去重：

1. 精确匹配 name/code（保留，快且可解释）；
2. 向量召回：`Animal.embedding` + `summary/features` 的 chunk（`animal-index` 已有基础设施）；
3. 结果重排：AI 只对 top-10 打相关性 0–1 分（可省略，前两路已够）。

管理端把 `AnimalsManager` 的客户端 `includes` 换成同一份 `searchAnimals()`，删掉「不往返数据库」的注释。

**验收断言**：搜「瘸腿」「图书馆」「黑猫」各至少命中 1 只；搜「不存在的东西」返回空且不超时。

### P1-3 禁止 mock 静默顶上（红线 ★1 的兜底）

三处改动，都很小但很关键：

1. `registry.ts`：新增 `AI_REQUIRE_REAL=1`（生产默认开）。缺 key 时**抛错而不是回落**；回落只在 `NODE_ENV==='test'` 或显式 `AI_ALLOW_MOCK=1` 时发生；
2. `.env.example`：`AI_PROVIDER="glm"`（占位 key 留空并注释「必须填」），把 mock 单独列成「仅本地样式调试」；
3. **provider 透出**：所有 AI 响应体加 `provider: 'glm' | 'mock'`，管理端顶栏在 mock 时显示红色徽标「当前为规则模拟，未接真实模型」；审计 payload 加 `provider`。

**验收断言**：删掉 `GLM_API_KEY` 起服务 → 请求返回 503 而非 200；管理端出现 mock 徽标。

### P1-4 embedding 降级不许混向量空间

`Animal.embedModel` / `KnowledgeChunk.embedModel`（或向量旁的 `vecSource` 列）记录来源；`hashEmbedding` 产出的向量标 `local-hash`，检索时只与同源向量比对，跨源不参与排序。当前 1536 维同列混存，是「规则悄悄替代 AI 且不可见」的最隐蔽一处。

### P2 补齐三处丢弃的 AI 产出

- `tagging.summary` 落 `Observation.aiSummary` 列，记录列表优先展示；
- `followUp` 接到问答页「你可能还想问」；
- `runChatText` 目前是导出但无人调用的死代码（`registry.ts:153`），要么接进「AI 生成公告/摘要」，要么删掉。

---

## 5. 应当保留规则的 8 个位置（不要为了评分硬改）

评委问「你哪里用了规则」时，这批是可以正大光明讲的，它们属于**判定闸门与业务规则**，不是 AI 的替代品：

| 位置 | 为什么该是规则 |
|---|---|
| `health/derive.ts` | 档位派生是**状态机**，要求可复现、可审计。同一个证据链今天判红明天判绿才是灾难 |
| `health/reconcile.ts` | 模型自相矛盾时取更严重一侧、SEVERE 强制就医——安全下限不能交给模型 |
| `alerts/rules.ts` | 预警阈值是运营策略（3 次中度→WARN），不是语义判断 |
| `identify/scoring.ts` | 融合权重与三道闸门是**标定结果**（有 docs 里的实测依据），AI 给分、规则定档 |
| `rag/keyword.ts` | 中文 2-gram 是 IR 基础设施，与 embedding 是并联的两路召回 |
| `alerts/negative-tags.ts` | 负面标签白名单保证预警可解释，AI 抽标签、规则认负面 |
| `map-config.ts` | 校园 POI 与四至是事实数据 |
| `safety/moderation.ts` | 内容安全的**底线**必须确定（正则必拦），但建议**在其之上加一层 AI 语义审核**（现在只有正则，属于「兜底偏薄」而非「假 AI」） |

判别口径可以写成一句，答辩直接用：**「模型负责理解与判断，规则负责下限与复现；凡是规则代替模型理解语义的地方，就是这次要改的地方。」**

---

## 6. 重构后的红线自检对照

| 红线 | 重构前 | 重构后 |
|---|---|---|
| ★1 严禁假 AI | 意图、统计路由、实体识别由规则承担；mock 可静默顶上 | 三处全部走 `runStructured`，规则仅 fallback 且带 `degraded` 标记；mock 要显式开关 + 界面告警 |
| ★2 AI 决定数据流 | 已达标（severity→healthLevel→预警同事务） | 不变；新增 AI 查询计划也只决定「查什么」，数字仍由代码产出 |
| ★3 Agent 总调度 | 已达标（真实 trace + 9 工具） | 不变；建议把「实体消歧」也注册成工具，让星轨多一步真实证据 |
| ★4 无 AI 则业务断裂 | 识别/健康/记录/问答断裂；**搜索、意图、实体解析不裂** | 五处全裂：意图分类不可用→问答无法路由；实体消歧不可用→不知道答谁 |
| ★5 工程化兜底 | 已达标 | 增加 provider 透出与 mock 徽标，兜底从「行为」变成「可见」 |

**验收命令**（重构完成后一次性跑）：

```bash
npx tsc --noEmit && npx eslint . --ext .ts,.tsx && npm run ui:audit
npm run rag:selftest && npm run agent:selftest && npm run obs:selftest
npm run id:selftest && npm run insight:selftest && npm run health:selftest && npm run db:selftest
# 拔掉 key 复跑一次，确认 AI_REQUIRE_REAL 生效（应 503 + 管理端徽标）
AI_PROVIDER=glm GLM_API_KEY= npm run rag:selftest
```

---

## 7. 优先级与影响面

| 批次 | 项 | 改动文件数 | 风险面 | 为什么排这个顺序 |
|---|---|---|---|---|
| P0 | 意图 / 统计 / 实体 三处 | 6 | 中（问答主链路） | 直接对应 ★1、★4，评委必问 |
| P0 | mock 静默顶上 | 3 | 低 | 改动最小、收益最大，防止「演示即翻车」 |
| P1 | 建档特征回流 / 搜索语义化 | 5 | 低 | 用户可感知，演示效果好 |
| P1 | embedding 溯源 | 2 + 1 迁移 | 中（要动 schema） | 数据正确性问题，可放最后 |
| P2 | 三处丢弃字段 | 4 | 低 | 补齐完整性，答辩时是「我们连 AI 的边角输出都用了」的证据 |

一句话给决策：**先做 P0-1 与 P0-3**（意图 + 身份），这两处一改，「把 AI 拔掉系统还能不能跑」这个问题就再也问不出来了；**P0-2 与 mock 收紧**随后跟上，一天量级。

---

## 附：实测证据（2026-10-28 在本机 dev 环境跑出，非推测）

**① 图鉴搜索只能命中名字/编号**

| 搜索词 | HTTP | 命中档案 |
|---|---|---|
| 瘸腿 | 200 | **0** |
| 图书馆 | 200 | **0** |
| 黑猫 | 200 | **0** |
| 煤球 | 200 | 1 |

同一批词在知识库与档案特征里都是有内容的（《腿伤、跛行与骨折判断》、动物的 location 是「图书馆北侧」），但 `ILIKE name/code` 一条都捞不到。

**② 统计问答换一种说法就掉出正则**

```
Q: 现在一共几只猫          → intent=DATA       A: 图鉴里现在有 3 只猫建档。另有 17 条观察记录、0 条未处理预警。
Q: 咱学校现在有几只喵星人   → intent=KNOWLEDGE  A: （走了知识检索）校园投喂规范（第 2 段）【推荐食物】猫：全价猫粮…
```

同一个问题，「喵星人」不在 `DOMAIN_WORD` 里，就直接从「查库」掉进「知识检索」，答成了投喂规范。这条是 1.1 与 1.2 的合并证据：**四个正则常量决定了系统答什么，而不是模型理解用户想问什么。**

**③ mock 可静默顶上**

```
registry.ts:52  log.warn('ai.no_api_key_fallback_mock', { requested: 'glm' })
```

清空 key 后所有接口仍返回 200，只是换成 562 行规则模拟器，响应体里没有任何字段能区分。

> 复现命令见上一节；若要长期留证，建议把这三条做成 `scripts/audit-ai-integration.ts` 的快照测试，重构前后各跑一次对比。

