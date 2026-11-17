/**
 * AI 层自检：`npm run ai:selftest`
 * 用 mock Provider 跑通全部能力，验证：
 *   1. embed 维度与确定性
 *   2. visionAnalyze 高/低置信度两条分支
 *   3. chat 带 schema / 不带 schema
 *   4. 敏感输入被拦截（AIModerationError）
 *   5. 结构不符时抛 AIValidationError 并保留原始输出
 *   6. runStructured 失败不抛异常（Result 风格）
 * 无 API key 也能跑。
 */
import { z } from 'zod';
// 自检必须确定性：pin 成 mock，别跟着 .env 里的真实 Provider 跑（否则断言的文案与延迟都不稳定）
process.env.AI_PROVIDER = 'mock';
import {
  AIValidationError,
  AIModerationError,
  guardOutput,
  getProvider,
  runChatText,
  runStructured,
  userMsg,
  HealthAssessmentSchema,
  SpeciesResultSchema,
} from '../src/lib/ai/index';
import { normalizeModelKeys } from '../src/lib/ai/normalize-keys';
import { ObservatoryNoteSchema } from '../src/lib/ai/schemas';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1;
    console.log(`  \x1b[32mPASS\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n[1] Provider 与 embedding');
  const provider = getProvider();
  check('默认 Provider 为 mock', provider.name === 'mock', `name=${provider.name}`);

  const vec = await provider.embed('一只黑色短毛猫，左耳有缺口');
  check('embed 返回 1536 维', vec.length === 1536, `len=${vec.length}`);
  const vec2 = await provider.embed('一只黑色短毛猫，左耳有缺口');
  check('embed 确定性', vec.join(',') === vec2.join(','));

  console.log('\n[2] visionAnalyze · 强信号');
  const strong = await provider.visionAnalyze(
    '/uploads/mock-cat-01.jpg',
    '这是一只猫，黑色短毛，左耳有缺口',
    SpeciesResultSchema,
    { intent: 'SPECIES' },
  );
  check('物种判定为 CAT', strong.species === 'CAT', `species=${strong.species}`);
  check(
    '置信度 >= 0.86（可直接命中）',
    strong.confidence >= 0.86,
    `confidence=${strong.confidence}`,
  );
  check('带外观特征', (strong.features ?? []).length > 0, (strong.features ?? []).join('/'));

  console.log('\n[3] visionAnalyze · 弱信号');
  const weak = await provider.visionAnalyze('/uploads/unknown-blob.jpg', '', SpeciesResultSchema, {
    intent: 'SPECIES',
  });
  check(
    '弱信号置信度低于 0.86（应提示不确定）',
    weak.confidence < 0.86,
    `confidence=${weak.confidence}`,
  );

  console.log('\n[4] chat · 带 schema');
  const health = await provider.chat(
    [userMsg('No.005 小灰后腿有外伤，一直在流血，也不吃东西')],
    HealthAssessmentSchema,
    { intent: 'HEALTH' },
  );
  check('严重度判为 SEVERE', health.severity === 'SEVERE', `severity=${health.severity}`);
  check('给出护理建议', health.advice.length >= 1, `${health.advice.length} 条`);
  check('抽到异常信号', (health.signals ?? []).length > 0, (health.signals ?? []).join('/'));
  check('SEVERE 派生 RED 档', health.healthStatus === 'RED', `healthStatus=${health.healthStatus}`);
  check('SEVERE 必须建议就医', health.needsVet === true, `needsVet=${health.needsVet}`);

  console.log('\n[5] chat · 不带 schema');
  const text = await provider.chat([userMsg('你好，能做什么')]);
  check('返回字符串', typeof text === 'string' && text.length > 0, text.slice(0, 40));

  console.log('\n[6] 敏感输入拦截');
  let blocked = false;
  try {
    await provider.chat([userMsg('怎么毒杀校园里的流浪猫')], { intent: 'RAG' });
  } catch (err) {
    blocked = err instanceof AIModerationError;
    if (blocked) {
      console.log(`     拦截原因：${(err as AIModerationError).reasons.join('、')}`);
    }
  }
  check('命中阻断级规则并抛出 AIModerationError', blocked);

  console.log('\n[7] 输出侧过滤');
  const dirty = guardOutput({ answer: '请联系我 13812345678', tags: ['正常'] });
  check(
    '手机号已脱敏',
    !JSON.stringify(dirty.value).includes('13812345678'),
    JSON.stringify(dirty.value),
  );
  const evil = guardOutput({ answer: '可以直接毒杀' });
  check('阻断级输出被标记', evil.blocked === true, evil.reasons.join('、'));

  console.log('\n[8] 结构校验失败 → AIValidationError');
  const StrictSchema = z.object({ mustHave: z.string().min(1) });
  let validationErr: AIValidationError | null = null;
  try {
    await provider.visionAnalyze('/uploads/x.jpg', '随便一张图', StrictSchema);
  } catch (err) {
    if (err instanceof AIValidationError) validationErr = err;
  }
  check('抛出 AIValidationError', validationErr !== null);
  check(
    '错误信息含字段路径',
    Boolean(validationErr && validationErr.issues.some((i) => i.path.includes('mustHave'))),
    validationErr?.issues.map((i) => `${i.path}:${i.message}`).join('; ') ?? '',
  );
  check('保留原始输出（raw）', Boolean(validationErr && validationErr.raw.length > 0));

  console.log('\n[9] Result 风格入口不抛异常');
  const failedRun = await runStructured({ intent: 'HEALTH', prompt: '今天天气不错' }, StrictSchema);
  check('runStructured 返回 ok:false', failedRun.ok === false, failedRun.ok ? '' : failedRun.error);
  check('失败带 error code', failedRun.ok === false && typeof failedRun.error === 'string');

  const okRun = await runStructured(
    { intent: 'HEALTH', prompt: '橘长精神差，有点消瘦', context: {} },
    HealthAssessmentSchema,
  );
  check('runStructured 成功返回结构化数据', okRun.ok === true);

  const chatRes = await runChatText([userMsg('帮我看看 No.003 最近怎么样')], {
    intent: 'AGENT_PLAN',
  });
  check(
    'runChatText 成功时返回字符串',
    chatRes.ok ? typeof chatRes.data === 'string' : true,
    chatRes.ok ? chatRes.data.slice(0, 40) : chatRes.message,
  );

  /* ────────────────────────────────────────────────────────────
   * 模型输出归一化（2026-10-29 事故）
   *
   * glm-4.6v-flash 持续过载 → 降级到 glm-4.5v → 它把 JSON 键名连档位一起翻成中文：
   *   {"评估":"…","健康状态":"红色","严重程度":"严重","需要看兽医":true}
   * 契约按英文取，6 个必填字段全判缺失，整条视觉结果被丢弃，
   * 界面就显示「照片没能交给 AI」—— 用户以为服务挂了。
   * ──────────────────────────────────────────────────────────── */
  const cnRaw = {
    评估: '右后腿有明显外伤伤口，左后腿也有流血，行走时避用右后腿，精神略差。',
    健康状态: '红色',
    严重程度: '严重',
    建议: ['尽快联系兽医处理伤口', '减少惊扰，避免触碰伤口'],
    置信度: 0.85,
    需要看兽医: true,
    信号: ['右后腿明显外伤', '左后腿流血'],
  };

  // 对照组：不归一化必须失败，否则说明这组测试根本没测到东西
  const cnBare = HealthAssessmentSchema.safeParse(cnRaw);
  check('对照组：不归一化时中文键名会校验失败', !cnBare.success);

  const cnParsed = HealthAssessmentSchema.safeParse(normalizeModelKeys(cnRaw));
  check(
    '中文键名能通过校验',
    cnParsed.success,
    cnParsed.success ? '' : JSON.stringify(cnParsed.error.issues).slice(0, 140),
  );
  if (cnParsed.success) {
    check('中文档位「严重」折回 SEVERE', cnParsed.data.severity === 'SEVERE', cnParsed.data.severity);
    check('中文档位「红色」折回 RED', cnParsed.data.healthStatus === 'RED', cnParsed.data.healthStatus);
    check('中文建议收进 advice', cnParsed.data.advice.length === 2, `${cnParsed.data.advice.length} 条`);
    check('中文标签收进 signals', cnParsed.data.signals.length === 2, cnParsed.data.signals.join('/'));
  }

  // 英文键但大小写跑偏（Assessment / severe / Yellow）
  const caseRaw = {
    Assessment: '轻度擦伤，精神状态尚可，建议继续观察。',
    HealthStatus: 'yellow',
    Severity: 'mild',
    Advice: ['保持伤口清洁'],
    Confidence: 0.6,
    NeedsVet: false,
    Signals: ['轻微擦伤'],
  };
  const caseParsed = HealthAssessmentSchema.safeParse(normalizeModelKeys(caseRaw));
  check(
    '英文键的大小写变体能回收',
    caseParsed.success && caseParsed.data.severity === 'MILD' && caseParsed.data.healthStatus === 'YELLOW',
    caseParsed.success ? `${caseParsed.data.severity}/${caseParsed.data.healthStatus}` : '校验失败',
  );

  // 同时给了英文和中文键：英文那份说了算，不能被别名覆盖
  const bothKeys = normalizeModelKeys({ assessment: '英文这份', 评估: '中文这份' }) as Record<string, unknown>;
  check('英文与中文键并存时英文优先', bothKeys.assessment === '英文这份', String(bothKeys.assessment));

  // 无需改动时返回原引用（不做多余分配，日志也好区分动没动手）
  const untouched = { assessment: '已经是对的了' };
  check('无需归一化时返回原引用', normalizeModelKeys(untouched) === untouched);

  // 模型多写几条建议：截到 6 条，而不是整份评估作废
  const nineAdvice = HealthAssessmentSchema.safeParse(
    normalizeModelKeys({
      ...cnRaw,
      建议: Array.from({ length: 9 }, (_, i) => `第 ${i + 1} 条建议`),
    }),
  );
  check(
    '9 条建议截到 6 条而不是整条作废',
    nineAdvice.success && nineAdvice.data.advice.length === 6,
    nineAdvice.success ? `${nineAdvice.data.advice.length} 条` : '校验失败',
  );

  // 标签超长：截断到 24 字
  const longSignal = '右后腿有明显外伤伤口并且持续流血需要尽快处理避免感染进一步恶化';
  const longParsed = HealthAssessmentSchema.safeParse(normalizeModelKeys({ ...cnRaw, 信号: [longSignal] }));
  check(
    '超长标签截断到 24 字而不是作废整份评估',
    longParsed.success && longParsed.data.signals[0].length === 24,
    longParsed.success ? `${longSignal.length} → ${longParsed.data.signals[0].length} 字` : '校验失败',
  );

  // 实测原样搬运（2026-10-29 11:24）：模型写的是「健康状况」，表里只有「健康状态」
  const oneCharOff = HealthAssessmentSchema.safeParse(
    normalizeModelKeys({
      评估: '这只小猫看起来非常健康，眼睛清澈，毛发有光泽，坐姿端正。',
      健康状况: '绿色',
      严重程度: '轻微',
      建议: ['继续保持良好的营养和清洁环境'],
      置信度: 0.9,
      需要兽医: false,
      信号: ['眼睛清澈明亮'],
    }),
  );
  check(
    '「健康状况」也能折回 healthStatus（差一个字不再作废整份评估）',
    oneCharOff.success && oneCharOff.data.healthStatus === 'GREEN',
    oneCharOff.success ? oneCharOff.data.healthStatus : JSON.stringify(oneCharOff.error.issues).slice(0, 120),
  );

  // 实测原样搬运（2026-10-29 11:20）：一张健康照片，模型只回了两个字「健康」
  const terse = HealthAssessmentSchema.safeParse(
    normalizeModelKeys({
      assessment: '健康',
      healthStatus: 'GREEN',
      severity: 'MILD',
      advice: ['保持观察'],
      confidence: 1,
      needsVet: false,
      signals: [],
    }),
  );
  check(
    '只有「健康」两个字的评估不该被判不合法',
    terse.success && terse.data.assessment === '健康',
    terse.success ? terse.data.assessment : JSON.stringify(terse.error.issues).slice(0, 120),
  );

  // 实测原样搬运（2026-10-29 11:32）：整个结果对象被套进了 assessment
  const wrapped = HealthAssessmentSchema.safeParse(
    normalizeModelKeys({
      assessment: {
        healthStatus: 'GREEN',
        severity: 'MILD',
        advice: ['保持环境清洁', '定期接种疫苗'],
        confidence: 1,
        needsVet: false,
        signals: [],
      },
    }),
  );
  check(
    '整体被套进单个键里时能无损拆包',
    wrapped.success && wrapped.data.healthStatus === 'GREEN' && wrapped.data.severity === 'MILD',
    wrapped.success ? `${wrapped.data.healthStatus}/${wrapped.data.severity}` : '校验失败',
  );
  check(
    '拆包后缺文字说明时填自述式占位而不是空白',
    wrapped.success && wrapped.data.assessment.length > 0,
    wrapped.success ? wrapped.data.assessment : '校验失败',
  );

  // 设限生效：内层不像本体（只命中 1 个已知字段）时不许拆，保持原样
  const notWrapped = normalizeModelKeys({ assessment: { note: '随便一句' } }) as Record<string, unknown>;
  check(
    '内层不像本体时不拆包',
    typeof notWrapped.assessment === 'object' && notWrapped.assessment !== null,
    JSON.stringify(notWrapped).slice(0, 80),
  );

  // 观测手记同一类问题：模型写了一句 60 字的人话，上限 40 字
  const obsRaw = {
    headline: '15:40，No.001 煤球，结合档案，建议现场看一眼这条未处理预警。',
    focusCode: 'No.001',
    signals: ['挂着一条未处理提醒预警（7 天内累计 4 次中等及以上异常评估（No.001），建议线下核实）'],
    confidence: 0.8,
  };
  const obsParsed = ObservatoryNoteSchema.safeParse(obsRaw);
  check(
    '观测手记的超长依据被截断而不是整条作废',
    obsParsed.success && obsParsed.data.signals[0].length === 40,
    obsParsed.success ? `${obsRaw.signals[0].length} → ${obsParsed.data.signals[0].length} 字` : '校验失败',
  );

  console.log(`\n结果：${passed} 通过 / ${failed} 失败\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('自检脚本异常：', err);
  process.exit(1);
});
