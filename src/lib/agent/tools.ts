import { z } from 'zod';
import { prisma } from '@/lib/db';
import { buildRagContext } from '@/lib/rag/retriever';
import { loadWhereabouts, describeWhereabouts } from '@/lib/animals/whereabouts';
import {
  LOCATION_SPOT_NAMES,
  recordSightingLocation,
  type RecordLocationData,
} from '@/lib/animals/location';
import { loadDbSnapshot, describeSnapshot } from '@/lib/insight/db-stats';
import { listAnimals as listAnimalsFromDb, listObservations } from '@/lib/insight/list';
import { runIdentify } from '@/lib/identify/pipeline';
import { createAnimal } from '@/lib/identify/create-animal';
import { assessHealth as assessHealthChain } from '@/lib/health/assess';
import { createObservation } from '@/lib/observations/create';
import { ObservationFormSchema, ObservationTypeSchema } from '@/lib/api/observation-contract';
import { ALERT_NOTICE, LIMITS } from '@/lib/constants';
import { isOwnUploadUrl } from '@/lib/uploads';
import { ALERT_META, HEALTH_META, SPECIES_META } from '@/lib/semantic';
import type { HealthAssessData } from '@/lib/api/health-contract';
import type { ObservationData } from '@/lib/api/observation-contract';
import type { Prisma } from '@prisma/client';

/**
 * 星枢的工具注册表（阶段 8）。
 *
 * 与 S6 的差别：这里的工具接的是**完整业务链路**（runIdentify / assessHealth /
 * createObservation），不是临时拼的只读查询 —— 校验、限流、同事务预警全部复用手动提交
 * 的那一套，Agent 只是另一个调用方，不享有任何旁路。
 *
 * 每个工具 = zod 输入契约 + description + summarize + 可选 harvest。
 * harvest 负责把结果里的关键实体（animalId/animalCode）写回 ctx，
 * 供 ReAct 循环的后续步骤使用 —— 这是"observe 反哺下一步决策"的数据通道。
 */

export interface ToolContext {
  animalId?: string;
  animalCode?: string;
  /** Agent 请求携带的主照片（已由 saveUpload 落盘）—— 档案封面 / 观察记录图都用它 */
  photoUrl?: string;
  /**
   * 本次请求附带的全部照片（2026-10-28 多图）。
   * 工具按需取用：识别与建档只认主图（比对基准照片一张就够），
   * 健康评估会把其余视角一起交给视觉模型 —— 伤口特写 + 全身姿态比两张重复拍摄有用得多。
   */
  photoUrls?: string[];
  /**
   * 本轮用户点「用当前位置」授权的设备定位（2026-10-29）。
   *
   * **坐标只从这里来，不从模型参数来**：模型连 lat/lng 的入参都没有，
   * 它只能表达「用当前位置」这个意图，真实坐标由前端授权后随请求带上来。
   * 这条约束和「photoUrl 只认 ctx」是同一个道理 —— 模型看不见、就不该让它编。
   */
  userLocation?: { lat: number; lng: number; accuracyM?: number | null };
  ip?: string;
  /** 自测注入：与 createObservation / assessHealth 的事务注入点对齐 */
  transact?: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  /** 输入契约：Input 用 unknown，允许 .default() 造成的 input/output 差异 */
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  run(input: I, ctx: ToolContext): Promise<O>;
  /** 把工具结果压成一句话，供 trace 与最终回答使用 */
  summarize(output: O): string;
  /** 把结果里的关键实体写回 ctx（识别到谁、档案编号等） */
  harvest?(output: O, ctx: ToolContext): void;
  /** 从结果里提取横切信息（预警通知、免责声明、置信度），API 层原样带回 */
  meta?(output: O): { notice?: string; disclaimer?: string; confidence?: number };
}

/** 注册表的统一形状：抹掉各工具的输入输出类型，供编排层动态调用 */
export interface AnyToolDefinition {
  name: string;
  description: string;
  input: z.ZodType<unknown, z.ZodTypeDef, unknown>;
  run(input: unknown, ctx: ToolContext): Promise<unknown>;
  summarize(output: unknown): string;
  harvest?(output: unknown, ctx: ToolContext): void;
  meta?(output: unknown): { notice?: string; disclaimer?: string; confidence?: number };
}

/**
 * 本次请求真正可用的照片（只认 ctx）。
 *
 * 铁律：模型侧不再暴露 photoUrl 入参，取图能力只从 ctx 来。
 *
 * 为什么（2026-10-29 实测）：带图问「这张照片里是什么动物」时，模型会把
 * `photoUrl` 填成「这张照片里是什么动物？」「$photoUrl」「用户提供的照片URL」——
 * 它看不到落盘地址，只能照着提示词编。而这些假值一旦通过
 * `photoUrl ?? ctx.photoUrl` 抢到优先级，视觉就拿不到字节，整条链路降级成
 * 「没看懂照片」，用户看到的就是「星枢不会识图」。
 * 照片本来就是请求级输入，模型没有表达它的需要，删掉这个口子比校验它更可靠。
 * isOwnUploadUrl 再挡一层：ctx 里也绝不放行任意外链。
 */
function requestPhotos(ctx: ToolContext): string[] {
  return (ctx.photoUrls?.length ? ctx.photoUrls : ctx.photoUrl ? [ctx.photoUrl] : []).filter(
    isOwnUploadUrl,
  );
}

const registry = new Map<string, AnyToolDefinition>();

/**
 * 模型分不清 `animalId`（数据库 cuid）与档案编号（No.001）。
 *
 * 实测把 `assessHealth({animalId:"No.001"})` 直接发过来，工具按 id 查不到，
 * 回一句「这只动物的档案不存在」，一步就把整条链路打成降级 —— 而用户其实说得清清楚楚。
 * 用户嘴里说的永远是编号，所以这里两种都认：先按 id 查，再按编号查。
 */
/**
 * 把模型给的「个体引用」收敛成可能的编号写法。
 *
 * 实测（2026-10-29）：识别结果摘要里写着「No.003 雪梨」，模型就把这个**整串**当成
 * animalId 传下来，`findUnique({code:'No.003 雪梨'})` 自然查不到，
 * 工具回一句「找不到档案」，好端端的评估直接失败 —— 而用户根本没提过这个名字。
 *
 * 只做「从一串话里认出编号」这一件事，认不出就原样返回，绝不猜档案。
 */
function animalCodeCandidates(raw: string): string[] {
  const text = raw.trim();
  const out = new Set<string>([text]);
  const m = /no\.?\s*(\d{1,6})/i.exec(text) ?? /#\s*(\d{1,6})/.exec(text);
  if (m) {
    const digits = m[1];
    out.add(`No.${digits}`);
    // 编号统一是三位补零（format.ts: formatCode），允许模型把 No.003 写成 No.3
    out.add(`No.${digits.padStart(3, '0')}`);
  }
  return [...out];
}

async function resolveAnimalId(ref: string | undefined, ctx: ToolContext): Promise<string | undefined> {
  const raw = (ref ?? ctx.animalId ?? ctx.animalCode ?? '').trim();
  if (!raw) return undefined;
  // 上一步已经定位到个体，且模型引用的正是它 → 不必再查库
  if (ctx.animalId && (raw === ctx.animalId || raw === ctx.animalCode)) return ctx.animalId;
  // 引用里带着编号（可能还捎上名字）时，先按它认得出来
  if (ctx.animalId && ctx.animalCode && animalCodeCandidates(raw).includes(ctx.animalCode)) {
    return ctx.animalId;
  }
  const byId = await prisma.animal.findUnique({ where: { id: raw }, select: { id: true } });
  if (byId) return byId.id;
  for (const code of animalCodeCandidates(raw)) {
    const byCode = await prisma.animal.findUnique({ where: { code }, select: { id: true } });
    if (byCode) return byCode.id;
  }
  return undefined;
}

/** 反向：需要编号的链路（观察记录）也认 id */
async function resolveAnimalCode(ref: string | undefined, ctx: ToolContext): Promise<string | undefined> {
  const raw = (ref ?? ctx.animalCode ?? '').trim();
  if (!raw) return undefined;
  if (ctx.animalCode && animalCodeCandidates(raw).includes(ctx.animalCode)) return ctx.animalCode;
  for (const code of animalCodeCandidates(raw)) {
    const byCode = await prisma.animal.findUnique({ where: { code }, select: { code: true } });
    if (byCode) return byCode.code;
  }
  const byId = await prisma.animal.findUnique({ where: { id: raw }, select: { code: true } });
  return byId?.code;
}

export function registerTool<I, O>(tool: ToolDefinition<I, O>): void {
  registry.set(tool.name, tool as unknown as AnyToolDefinition);
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return registry.get(name);
}

/** 供 AGENT_NEXT_STEP 的 prompt 使用：工具名 + 描述 + 输入 JSON Schema 摘要 */
export function listTools(): Array<{ name: string; description: string; schema: string }> {
  return [...registry.values()].map((t) => ({
    name: t.name,
    description: t.description,
    schema: zodSummary(t.input),
  }));
}

/** 把 zod schema 压成给 LLM 看的一行 JSON Schema 描述 */
function zodSummary(schema: z.ZodType<unknown, z.ZodTypeDef, unknown>): string {
  try {
    const json = zodToJsonSchemaish(schema);
    return JSON.stringify(json);
  } catch {
    return '{}';
  }
}

/** 轻量版 zod→JSON 描述：只覆盖本文件用到的类型，够决策用即可 */
function zodToJsonSchemaish(
  schema: z.ZodType<unknown, z.ZodTypeDef, unknown>,
): Record<string, unknown> {
  const inner = schema as unknown as { _def: { typeName: string; [k: string]: unknown } };
  const def = inner._def;
  switch (def.typeName) {
    case 'ZodObject': {
      const shape = (def.shape as () => Record<string, z.ZodTypeAny>)();
      const out: Record<string, unknown> = { type: 'object' };
      const props: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(shape)) {
        props[key] = zodToJsonSchemaish(value);
      }
      out.properties = props;
      return out;
    }
    case 'ZodString': {
      const checks = def.checks as Array<{ kind: string; value?: number }> | undefined;
      const out: Record<string, unknown> = { type: 'string' };
      for (const c of checks ?? []) {
        if (c.kind === 'min') out.minLength = c.value;
        if (c.kind === 'max') out.maxLength = c.value;
      }
      return out;
    }
    case 'ZodNumber':
      return { type: 'number' };
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodEnum':
      return { type: 'string', enum: def.values };
    case 'ZodOptional':
      return { ...zodToJsonSchemaish(def.innerType as z.ZodTypeAny), optional: true };
    case 'ZodDefault':
      return zodToJsonSchemaish(def.innerType as z.ZodTypeAny);
    case 'ZodEffects':
      return zodToJsonSchemaish(def.schema as z.ZodTypeAny);
    default:
      return {};
  }
}

// ---------------------------------------------------------------- 工具实现

interface IdentifyToolOutput {
  tier: 'matched' | 'candidate' | 'new' | 'failed';
  text: string;
  animalId?: string;
  animalCode?: string;
}

const identifyAnimal: ToolDefinition<
  { note?: string; animalCode?: string },
  IdentifyToolOutput
> = {
  name: 'identifyAnimal',
  description:
    '根据照片或外观描述识别是哪只登记过的个体。**用户已经说出编号（如 No.001）时直接把编号填进 animalCode**，' +
    '它只按编号定位、不会因为照片差异误建新档案；未登记且有照片时才自动建待审核档案。' +
    '照片由系统自动带上，你不要填任何图片地址',
  input: z.object({
    note: z.string().max(LIMITS.note).optional(),
    /**
     * 用户原话里已经给出的编号（2026-10-28 补）。
     * 补这个入参之前只有照片一条路：用户明明说了「No.001 受伤了」，模型也调
     * identifyAnimal，于是拿照片走了一遍视觉识别，判成"新个体"并**真的建了
     * 一条 No.008 待审核档案** —— 用户嘴里的编号在系统里没有表达出口。
     */
    animalCode: z.string().max(20).optional(),
  }),
  async run({ note, animalCode }, ctx) {
    // 照片由系统按本次请求注入，模型无需（也无法）指定 —— 见 requestPhotos 注释
    const url = requestPhotos(ctx)[0] ?? null;

    // 编号是硬身份：给了就按编号定位，绝不拿照片再猜一次
    const code = animalCode?.trim() || null;
    if (code) {
      const hit = await prisma.animal.findUnique({
        where: { code },
        select: { id: true, code: true, name: true },
      });
      if (!hit) {
        return { tier: 'failed' as const, text: `没有编号为 ${code} 的登记个体，请核对编号` };
      }
      return {
        tier: 'matched' as const,
        text: `已定位到 ${hit.code} ${hit.name}（按你给的编号，未重新识别）`,
        animalId: hit.id,
        animalCode: hit.code,
      };
    }

    // 上一步已经确认是哪只了：再跑一次识别，只会因为照片差异判成"新个体"而误建档案。
    // 档案已定位时识别这一步直接让位，这是数据的硬保证，不依赖模型的判断力。
    if (ctx.animalId && ctx.animalCode) {
      return {
        tier: 'matched' as const,
        text: `已定位到 ${ctx.animalCode}，无需再识别`,
        animalId: ctx.animalId,
        animalCode: ctx.animalCode,
      };
    }

    const result = await runIdentify({
      note: note ?? null,
      photoUrl: url,
      ip: ctx.ip,
    });
    if (!result.ok) {
      return { tier: 'failed' as const, text: result.message };
    }
    const data = result.data;

    if (data.tier === 'matched') {
      return {
        tier: 'matched' as const,
        text: `识别为：${data.animal.name} ${data.animal.code}（置信度 ${data.confidence.toFixed(2)}）`,
        animalId: data.animal.id,
        animalCode: data.animal.code,
      };
    }

    if (data.tier === 'candidate' && data.candidates.length) {
      const top = data.candidates[0];
      return {
        tier: 'candidate' as const,
        text: `疑似 ${top.code} ${top.name}（匹配分 ${top.score.toFixed(2)}），请到识别页确认，先不写它的档案`,
        animalId: top.animalId,
        animalCode: top.code,
      };
    }

    // tier === 'new'：有照片才够格自动建档（匿名建档本来就带 pendingReview，
    // 管理员复核是既有流程，不新增风险面）；没照片就只建议，不写库
    if (url) {
      const created = await createAnimal({
        photoUrl: url,
        name: '未命名朋友',
        species: data.suggestedSpecies === 'UNKNOWN' ? undefined : data.suggestedSpecies,
        summary: note ?? null,
        ip: ctx.ip,
      });
      if (created.ok) {
        return {
          tier: 'new' as const,
          text: `未登记过，已建待审核档案 ${created.data.animal.code}（名字待定，可在档案页改名）`,
          animalId: created.data.animal.id,
          animalCode: created.data.animal.code,
        };
      }
    }
    return {
      tier: 'new' as const,
      text: url
        ? '未登记过，建档失败，请稍后到识别页手动建档'
        : '未登记过；拍一张清晰照片到识别页建档后才能记录档案',
    };
  },
  summarize(out) {
    return out.text;
  },
  harvest(out, ctx) {
    if (out.animalId) ctx.animalId = out.animalId;
    if (out.animalCode) ctx.animalCode = out.animalCode;
  },
};

/**
 * 「这次只看了文字」的留痕文案。
 *
 * 前提：`visionUnavailable:*` 只在「图片已经读到、也已经交给模型、但模型这次没给出
 * 合规结论」时才会出现（图片本身读不到会直接 BAD_REQUEST 返回，走不到这里）。
 * 所以文案不能写「照片未读到」——那是把「模型答歪了」说成「图没传上去」，
 * 模型复述之后用户会去反复重传一张本来没问题的图。
 */
function degradedVisionNote(degraded: string[]): string {
  const hit = degraded.find((d) => d.startsWith('visionUnavailable:'));
  if (!hit) return '';
  const code = hit.slice('visionUnavailable:'.length);
  const reason =
    code === 'AI_VALIDATION_ERROR'
      ? '视觉结论格式不合规'
      : code === 'AI_TIMEOUT'
        ? '视觉识别超时'
        : code === 'AI_MODERATION_BLOCKED'
          ? '视觉结果被安全策略拦截'
          : code === 'AI_UNAVAILABLE'
            ? '视觉服务暂不可用'
            : '视觉初筛未成功';
  return `（${reason}，本次仅依据文字描述）`;
}

const assessHealth: ToolDefinition<
  { animalId?: string; description?: string },
  HealthAssessData
> = {
  name: 'assessHealth',
  description:
    '对某只个体做健康初筛：有照片且有档案时写入健康报告（可能触发预警），否则只给预览结论。' +
    'description（现场看到的情况）与照片至少要有一个，两者都没有时本工具会明确报错，不要凭空评估。' +
    '用户可以一次附多张照片（不同角度），系统会自动把它们一起交给视觉模型，你不需要指定图片地址',
  input: z.object({
    animalId: z.string().optional(),
    /**
     * 允许缺省：纯照片评估时模型给不出描述（实测它会写 null，编排层已归一为 undefined）。
     * 但「既没描述又没照片」必须拦下 —— 那时模型只会凭空编一份健康结论。
     */
    description: z.string().max(300).optional(),
  }),
  async run({ animalId, description }, ctx) {
    const id = await resolveAnimalId(animalId, ctx);
    // 给了引用却查不到 → 明确报错，别默默退成"预览模式"让用户以为评估过了
    if (animalId && !id) throw new Error(`找不到档案 ${animalId}，请确认编号是否正确`);
    // 同 identifyAnimal：照片一律取本次请求的上下文，模型不参与指定
    const photos = requestPhotos(ctx);
    const url = photos[0] ?? null;
    const extras = photos.slice(1);
    const desc = description?.trim() ? description.trim() : null;
    if (!desc && !url) {
      throw new Error('需要一张照片或一句现场描述才能做健康评估');
    }
    const result = await assessHealthChain(
      {
        animalId: id ?? null,
        description: desc,
        imageUrl: url,
        ...(extras.length ? { extraImageUrls: extras } : {}),
        ip: ctx.ip,
      },
      ctx.transact ? { transact: ctx.transact } : {},
    );
    if (!result.ok) throw new Error(result.message);
    return result.data;
  },
  summarize(data) {
    const status = HEALTH_META[data.healthStatus].label;
    // 预览与落库的区别要写清楚：模型看到「未写入档案」才会接着调 addObservation，
    // 只写「预览模式」它往往再要一次评估（同参重复，白烧一轮决策）。
    const preview = data.persisted
      ? '，已写入健康报告'
      : '（预览模式：缺照片或档案未定位，未写入档案；要留档请接着调用 addObservation）';
    const alert = data.alert ? `，已触发${ALERT_META[data.alert.level].label}预警` : '';
    // 服务端退回「只看文字」时必须在摘要里留痕：星轨上那颗星会写「✓ 评估为轻伤」，
    // 不标注就等于告诉用户「AI 看过照片了」，而那是最不该被夸大的一件事。
    //
    // 但留痕必须说真话（2026-10-29）：原来无论什么原因都写「照片未读到」，
    // 而实测三次降级里有三次是 AI_VALIDATION_ERROR（模型答了但格式不合规），
    // 照片其实读到了、也送给模型看了。错写成「照片未读到」会直接污染下游——
    // 模型照着摘要复述成「我无法看到您提到的照片」，用户就真的以为图没传上去。
    const blind = degradedVisionNote(data.degraded);
    return `健康评估：${status} · ${data.severity}${alert}${preview}${blind}`;
  },
  harvest(data, ctx) {
    if (data.animal) {
      ctx.animalId = data.animal.id;
      ctx.animalCode = data.animal.code;
    }
  },
  meta(data) {
    // confidence 一并带出：AgentConsole 要据它显 ConfidenceBadge / 低置信度提示（阶段 9）
    return { disclaimer: data.disclaimer, confidence: data.confidence };
  },
};

interface ArchiveRow {
  id: string;
  code: string;
  name: string;
  species: 'CAT' | 'DOG';
  healthLevel: 'GREEN' | 'YELLOW' | 'RED';
  summary: string | null;
  openAlerts: number;
  recentObservations: string[];
  /** 「平时在哪活动」，与图鉴「常见位置」同一算法（lib/animals/whereabouts） */
  activitySpot: string | null;
  activitySummary: string | null;
  coords: { lat: number; lng: number } | null;
}

const queryArchive: ToolDefinition<{ keyword?: string; animalId?: string }, ArchiveRow[]> = {
  name: 'queryArchive',
  description:
    '按编号/名字/关键词查找个体档案：健康等级、未处理预警数、最近几条观察记录，以及「平时在哪活动」（常出没的校园角落 + 坐标分布）',
  input: z.object({
    keyword: z.string().max(60).optional(),
    animalId: z.string().optional(),
  }),
  async run({ keyword, animalId }, ctx) {
    const id = await resolveAnimalId(animalId, ctx);
    const kw = keyword ?? ctx.animalCode;
    const where: Prisma.AnimalWhereInput = id
      ? { id }
      : kw
        ? {
            OR: [
              { code: { contains: kw, mode: 'insensitive' } },
              { name: { contains: kw, mode: 'insensitive' } },
              { summary: { contains: kw, mode: 'insensitive' } },
            ],
          }
        : {};
    if (!id && !kw) throw new Error('需要动物编号、名字或先完成识别');

    const animals = await prisma.animal.findMany({
      where,
      take: 5,
      orderBy: { createdAt: 'asc' },
      include: {
        observations: { orderBy: { createdAt: 'desc' }, take: 3, select: { content: true } },
        alerts: { where: { status: 'OPEN' }, select: { id: true } },
      },
    });

    // 位置要和图鉴说同一句话：走 lib/animals/whereabouts 那个唯一口径，
    // 不要在工具里各算一套（那样「问星枢」和「翻图鉴」会给出两个不同的角落）
    const whereabouts = await Promise.all(animals.map((a) => loadWhereabouts(a.id)));

    return animals.map((a, i) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      species: a.species,
      healthLevel: a.healthLevel,
      summary: a.summary,
      openAlerts: a.alerts.length,
      recentObservations: a.observations.map((o) => o.content.slice(0, 40)),
      activitySpot: whereabouts[i]!.spot?.name ?? null,
      activitySummary: describeWhereabouts(whereabouts[i]!),
      coords: whereabouts[i]!.coords,
    }));
  },
  summarize(rows) {
    if (!rows.length) return '没有找到匹配的个体';
    return rows
      .map((r) => {
        const base = `${r.code} ${r.name}（${SPECIES_META[r.species].label}，${HEALTH_META[r.healthLevel].label}，未处理预警 ${r.openAlerts} 条）`;
        const where = r.activitySummary ? `，常出没：${r.activitySummary}` : '，暂无位置信息';
        return base + where;
      })
      .join('；');
  },
  harvest(rows, ctx) {
    if (rows[0]) {
      ctx.animalId = rows[0].id;
      ctx.animalCode = rows[0].code;
    }
  },
};

const OBS_TYPE_LABEL: Record<z.infer<typeof ObservationTypeSchema>, string> = {
  FEEDING: '投喂',
  HEALTH: '健康',
  BEHAVIOR: '行为',
  OTHER: '其他',
};

const addObservation: ToolDefinition<
  { animalCode?: string; content: string },
  ObservationData
> = {
  name: 'addObservation',
  description:
    '把一条观察记录写进某只个体的手账。分类、标签、严重度由记录链路的 AI 语义解析判定，调用方只提供原文。' +
    '注意：recordLocation 本身就会写一条观察记录 —— 这次已经用它记过目击的，不要再重复写一条',
  input: z.object({
    animalCode: z.string().max(20).optional(),
    content: z.string().min(1).max(LIMITS.observation),
  }),
  async run({ animalCode, content }, ctx) {
    const code = await resolveAnimalCode(animalCode, ctx);
    if (!code) throw new Error('还不知道是哪只：先识别个体，或告诉我编号（如 No.003）');

    // 复用表单契约校验，不另立词表 —— Agent 与手动提交必须是同一套规则。
    // 只传原文：分类/严重度是 createObservation 内部 AI 解析的结果，
    // 让 Agent 自己传 type 等于给"绕过 AI"开一条旁路（CLAUDE.md ★1）。
    const parsed = ObservationFormSchema.safeParse({ animalCode: code, content });
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? '观察内容不合法');
    }

    const result = await createObservation(
      { ...parsed.data, ip: ctx.ip },
      ctx.transact ? { transact: ctx.transact } : {},
    );
    if (!result.ok) throw new Error(result.message);
    return result.data;
  },
  summarize(data) {
    const type = OBS_TYPE_LABEL[data.observation.type];
    const tags = data.observation.tags.length ? `，标签[${data.observation.tags.join('、')}]` : '';
    const vision = data.analysis.withImage ? '，已结合照片' : '';
    const alert = data.alert
      ? `，触发${ALERT_META[data.alert.level].label}预警，${data.notice ?? ALERT_NOTICE}`
      : '';
    return `AI 解析为${type}记录${tags}${vision}${alert}`;
  },
  meta(data) {
    return data.notice ? { notice: data.notice } : {};
  },
};

/**
 * 「在哪看到它」—— 写一条观察记录，并把星图上的点位挪过去。
 *
 * 为什么单独做一个工具，而不是让 addObservation 多收两个坐标：
 *   坐标是这条链路上最容易被模型编造的字段。给它一个 lat/lng 入参，
 *   它就会照着「武汉 30.47」这类常识填一个看起来对的值 ——
 *   星图对此没有任何防御，一个错点能把整张图缩放到别的城市。
 *   所以这里**只收地点名**，坐标由服务端从 `CAMPUS_SPOTS` 白名单查表，
 *   认不出就明确报错（见 lib/animals/location.ts 的注释）。
 *
 * 描述里把可用地点逐个列出来：模型看得见白名单，就不会去说「南门小吃街」。
 */
const recordLocation: ToolDefinition<
  {
    animalId?: string;
    place?: string;
    useCurrentPosition?: boolean;
    note?: string;
  },
  RecordLocationData
> = {
  name: 'recordLocation',
  description:
    '记录「在某处看到它」：写一条观察记录，并把这只个体在星图上的点位挪到该地点。' +
    `place 必须取自这些校园角落（或它们的常见别名）：${LOCATION_SPOT_NAMES.join('、')}。` +
    '不要自己编坐标，也不要传这些名字以外的地方 —— 认不出的地点会被直接拒绝。' +
    '用户说「用我现在的位置 / 就在这儿 / 我旁边」且本轮已带定位时，改传 useCurrentPosition=true（不要传 place）。' +
    'note 尽量原样带上用户的话（如「腿有点跛，躲在长椅下」），后续语义解析靠它判断类型与严重度。' +
    '用户只说「它现在在操场」时用它；只是聊天问「它在哪」时用 queryArchive',
  input: z
    .object({
      animalId: z.string().max(40).optional(),
      place: z.string().min(1).max(40).optional(),
      /** 用本轮用户授权的设备定位取代地点名 —— 坐标由服务端从前端授权里取 */
      useCurrentPosition: z.boolean().optional(),
      /** 观察原文；不传则用「在<地点>看到它」，记录本身必须能独立读懂 */
      note: z.string().max(LIMITS.observation).optional(),
    })
    // 「地点名」和「用当前位置」二选一。两个都没有时当场拒掉（模型还能自己改），
    // 而不是等到 run 里抛错 —— 抛错会走中断降级，把前面已成功的步骤一起丢掉。
    .refine((v) => Boolean(v.place) !== Boolean(v.useCurrentPosition), {
      message: 'place 与 useCurrentPosition 必须二选一：说了地点就给 place，用手机定位就传 useCurrentPosition=true',
    }),
  async run({ animalId, place, useCurrentPosition, note }, ctx) {
    const code = await resolveAnimalCode(animalId, ctx);
    if (!code) throw new Error('还不知道是哪只：先识别个体，或告诉我编号（如 No.003）');

    /* 用当前位置却没拿到定位（用户没点授权 / 浏览器拒了 / 非 HTTPS）：
       这时不能退回 place（它是空的），也不能猜一个角落 —— 直接让模型改口要地点名。
       这条不抛错，走的是「入参被拒」那条自愈路径要更贴切，但 run 里已经拿不到
       zod 的拒绝通道了，所以抛一条带明确出路的信息，由编排层回灌。 */
    if (useCurrentPosition && !ctx.userLocation) {
      throw new Error(
        '这一轮没有拿到你的定位（可能没授权或不是 HTTPS 环境）。请改说地点名，' +
          `可选：${LOCATION_SPOT_NAMES.join('、')}`,
      );
    }

    const result = await recordSightingLocation(
      {
        animalCode: code,
        place: useCurrentPosition ? null : (place ?? null),
        coords: useCurrentPosition ? (ctx.userLocation ?? null) : null,
        note: note ?? null,
        ip: ctx.ip ?? null,
      },
      ctx.transact ? { transact: ctx.transact } : {},
    );
    if (!result.ok) throw new Error(result.message);
    return result.data;
  },
  summarize(data) {
    const alert = data.alert ? `，触发${ALERT_META[data.alert.level].label}预警` : '';
    // 位置来源要说清楚：GPS 落点不等于「站在那个角落」，精度也该给用户看见
    const whereName =
      data.source === 'gps'
        ? `${data.spot.name}附近${data.accuracyM ? `（定位精度 ±${Math.round(data.accuracyM)} 米）` : ''}`
        : data.spot.name;
    // 点位没动也要说清楚：用户以为「记了就会挪」，实际它本来就在那儿
    const movedText = data.moved
      ? `星图点位已挪到${whereName}`
      : `点位本来就在${whereName}，未改动`;
    const via = data.source === 'gps' ? '按手机定位' : '';
    return `已${via}记下在「${whereName}」的目击（${data.animal.code} ${data.animal.name}），${movedText}${alert}`;
  },
  harvest(data, ctx) {
    ctx.animalCode = data.animal.code;
  },
  meta(data) {
    return data.notice ? { notice: data.notice } : {};
  },
};

const checkAlerts: ToolDefinition<
  { animalId?: string },
  Array<{ level: string; reason: string; code: string; name: string }>
> = {
  name: 'checkAlerts',
  description: '查看当前未处理的健康预警（可按个体过滤），确认管理员是否已被通知',
  input: z.object({ animalId: z.string().optional() }),
  async run({ animalId }, ctx) {
    const id = await resolveAnimalId(animalId, ctx);
    const rows = await prisma.alert.findMany({
      where: { status: 'OPEN', ...(id ? { animalId: id } : {}) },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 10,
      select: { level: true, reason: true, animal: { select: { code: true, name: true } } },
    });
    return rows.map((r) => ({
      level: r.level,
      reason: r.reason,
      code: r.animal.code,
      name: r.animal.name,
    }));
  },
  summarize(rows) {
    if (!rows.length) return '当前没有未处理的预警';
    return `${rows.length} 条未处理预警：${rows
      .map(
        (r) =>
          `${r.code} ${r.name} ${ALERT_META[r.level as keyof typeof ALERT_META]?.label ?? r.level}（${r.reason}）`,
      )
      .join('；')}`;
  },
};

/* ── 数据库只读工具：让星枢能回答"库里有几只、哪些要关注、最近记了什么" ─────
 * 三个工具都是只读，且都走 lib/insight —— 与星枢问答同一套口径，
 * 免得同一个问题在两个入口得到两个数字。
 */

const DB_SECTION = z.enum([
  'overview',
  'species',
  'health',
  'alerts',
  'observations',
  'photos',
  'spots',
]);

const queryDbStats: ToolDefinition<
  { section?: z.infer<typeof DB_SECTION> },
  { section: string; text: string }
> = {
  name: 'queryDbStats',
  description:
    '查看本地数据库的统计：总览（档案/猫狗/健康三色/记录/预警/照片/角落分布），也可以只取一段 —— ' +
    'section=species 猫狗数量、health 健康三色、alerts 未处理预警分级、observations 记录量与今天/近 7 天、' +
    'photos 照片数、spots 各角落落点分布',
  input: z.object({ section: DB_SECTION.optional() }),
  async run({ section }) {
    const s = await loadDbSnapshot();
    const key = section ?? 'overview';
    // 只答被问到的那一段：把整段概况丢回去，模型会在无关数字里挑错重点
    const text =
      key === 'species'
        ? `档案 ${s.animals.total} 只：猫 ${s.animals.cats} 只、狗 ${s.animals.dogs} 只`
        : key === 'health'
          ? `${s.animals.total} 只里：健康 ${s.animals.green} 只、需要观察 ${s.animals.yellow} 只、预警 ${s.animals.red} 只`
          : key === 'alerts'
            ? `未处理预警 ${s.alerts.open} 条（严重 ${s.alerts.critical} / 警告 ${s.alerts.warn} / 通知 ${s.alerts.info}）`
            : key === 'observations'
              ? `观察记录 ${s.observations.total} 条：今天 ${s.observations.today}、近 7 天 ${s.observations.last7d}` +
                `；待核实 ${s.observations.pendingReview} 条；带照片 ${s.observations.withPhoto} 条`
              : key === 'photos'
                ? `照片墙 ${s.observations.withPhoto} 张带图记录，档案头像库 ${s.photos} 张`
                : key === 'spots'
                  ? `角落分布：${
                      s.spots
                        .filter((x) => x.animals > 0 || x.observations > 0)
                        .map((x) => `${x.name}（动物 ${x.animals} 只、记录 ${x.observations} 条）`)
                        .join('、') || '暂时没有落点数据'
                    }`
                  : describeSnapshot(s);
    return { section: key, text };
  },
  summarize(out) {
    return out.text;
  },
};

const listAnimalsTool: ToolDefinition<
  {
    healthLevel?: 'RED' | 'YELLOW' | 'GREEN' | Array<'RED' | 'YELLOW' | 'GREEN'>;
    species?: 'CAT' | 'DOG';
    spotName?: string;
    missingLocation?: boolean;
    pendingReview?: boolean;
    keyword?: string;
    limit?: number;
  },
  Array<{
    code: string;
    name: string;
    species: 'CAT' | 'DOG';
    healthLevel: 'GREEN' | 'YELLOW' | 'RED';
    spot: string | null;
    openAlerts: number;
    observationCount: number;
  }>
> = {
  name: 'listAnimals',
  description:
    '按条件列出个体名单：健康档位（RED 预警 / YELLOW 观察 / GREEN 健康，可多选）、猫或狗、某个校园角落、缺位置坐标的、待核实的，也可以带关键词',
  input: z.object({
    healthLevel: z
      .union([
        z.enum(['RED', 'YELLOW', 'GREEN']),
        z
          .array(z.enum(['RED', 'YELLOW', 'GREEN']))
          .min(1)
          .max(3),
      ])
      .optional(),
    species: z.enum(['CAT', 'DOG']).optional(),
    spotName: z.string().max(20).optional(),
    missingLocation: z.boolean().optional(),
    pendingReview: z.boolean().optional(),
    keyword: z.string().max(40).optional(),
    limit: z.number().int().min(1).max(30).optional(),
  }),
  async run(input) {
    return listAnimalsFromDb({
      ...(input.healthLevel ? { healthLevel: input.healthLevel } : {}),
      ...(input.species ? { species: input.species } : {}),
      ...(input.spotName ? { spotName: input.spotName } : {}),
      ...(input.missingLocation ? { missingLocation: true } : {}),
      ...(input.pendingReview !== undefined ? { pendingReview: input.pendingReview } : {}),
      ...(input.keyword ? { keyword: input.keyword } : {}),
      limit: input.limit ?? 10,
    });
  },
  summarize(rows) {
    if (!rows.length) return '没有符合条件的个体';
    return `共 ${rows.length} 只：${rows
      .map(
        (r) =>
          `${r.code} ${r.name}（${SPECIES_META[r.species].label}，${HEALTH_META[r.healthLevel].label}` +
          `${r.openAlerts ? `，${r.openAlerts} 条未处理预警` : ''}` +
          `${r.spot ? `，常在${r.spot}附近` : ''}）`,
      )
      .join('；')}`;
  },
};

const queryObservations: ToolDefinition<
  { keyword?: string; days?: number; spotName?: string; animalCode?: string; limit?: number },
  Array<{ code: string; name: string; content: string; at: string; spot: string | null }>
> = {
  name: 'queryObservations',
  description:
    '按关键词/时间窗/校园角落检索观察记录（只读，不写库），用于回答「最近有人记过什么」「这个角落发生过什么」',
  input: z.object({
    keyword: z.string().max(40).optional(),
    days: z.number().int().min(1).max(365).optional(),
    spotName: z.string().max(20).optional(),
    animalCode: z.string().max(20).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  async run(input) {
    return listObservations({ ...input, limit: input.limit ?? 5 });
  },
  summarize(rows) {
    if (!rows.length) return '没有匹配的观察记录';
    return `最近 ${rows.length} 条：${rows.map((r) => `${r.code} ${r.name}「${r.content}」`).join('；')}`;
  },
};

const searchKnowledge: ToolDefinition<
  { question?: string; query?: string },
  { answer: string; titles: string[] }
> = {
  name: 'searchKnowledge',
  description:
    '检索校园流浪动物护理知识库，回答「怎么办/怎么护理」类问题，带出处。参数 question 填用户的问题原话',
  input: z.object({
    /**
     * 字段名收两个：实测模型 5/5 把参数写成 `query`，而契约里叫 `question`，
     * 于是每轮第一次调用必然被拒（"question：Required"），白烧一次决策。
     * 与其跟模型较劲字段名，不如两个都收。
     */
    question: z.string().max(300).optional(),
    query: z.string().max(300).optional(),
  }),
  async run(input) {
    const question = (input.question ?? input.query ?? '').trim();
    if (question.length < 2) throw new Error('question 必填：请把用户的问题原话传进来');
    const { passages } = await buildRagContext(question);
    if (!passages.length) {
      return { answer: '知识库中没有可靠依据，不做猜测，建议联系校兽医。', titles: [] };
    }
    /**
     * 交给下游的是**要点原文**，不是只有标题（2026-10-28 修）。
     * 以前 answer 只取第一段第一行、summarize 只给标题，AGENT_FINAL 手里没有可用素材，
     * 只能回一句「资料中未提供具体护理步骤」—— 明明检索到了《呕吐与腹泻》。
     */
    const answer = passages
      .slice(0, 3)
      .map((p, i) => `[${i + 1}]《${p.title}》第 ${p.index + 1} 段：${p.text.replace(/\s+/g, ' ').slice(0, 180)}`)
      .join('\n');
    return { answer, titles: passages.map((p) => p.title) };
  },
  summarize(out) {
    return out.titles.length ? out.answer : '知识库未命中';
  },
};

registerTool(identifyAnimal);
registerTool(assessHealth);
registerTool(queryArchive);
registerTool(addObservation);
registerTool(recordLocation);
registerTool(checkAlerts);
registerTool(queryDbStats);
registerTool(listAnimalsTool);
registerTool(queryObservations);
registerTool(searchKnowledge);
