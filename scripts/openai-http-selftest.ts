/**
 * OpenAI 兼容 Provider 的真实 HTTP 链路自检。
 *
 * mock Provider 那条 ai-selftest 已经覆盖了，但 createCompatibleProvider 里真正联网的部分
 * （fetch 构造 / response_format 降级重试 / JSON 代码块解析 / 维度归一 / 错误映射）
 * 此前一次都没被执行过。这里起一个假的 OpenAI 服务端把它全跑一遍。
 *
 * 用法：npm run ai:http:selftest   —— 不需要任何真实 API key。
 */
import '../src/lib/load-env';
import { z } from 'zod';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SpeciesResultSchema, HealthAssessmentSchema } from '../src/lib/ai/schemas';
import { setProvider } from '../src/lib/ai/registry';
import { createCompatibleProvider } from '../src/lib/ai/providers/openai';
import { AIError, AIValidationError } from '../src/lib/ai/provider';
import { EMBEDDING_DIM } from '../src/lib/constants';

let passed = 0;
let failed = 0;

function check(name: string, ok: boolean, extra = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function jsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(buf || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function reply(res: ServerResponse, payload: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** 用 choices[0].message.content 包一层标准响应 */
function chatReply(res: ServerResponse, content: string, status = 200): void {
  reply(res, { choices: [{ message: { content } }] }, status);
}

type Mode = {
  /** 首次请求就 400 拒绝 response_format，验证降级重试 */
  rejectResponseFormatOnce: boolean;
  /** embedding 故意返回错误维度，验证归一 */
  wrongEmbedDim: boolean;
  /** 返回带 ```json 代码块的内容，验证 coerceJson */
  fencedJson: boolean;
};

const mode: Mode = {
  rejectResponseFormatOnce: false,
  wrongEmbedDim: false,
  fencedJson: false,
};

const seen: Array<{ path: string; body: any }> = [];

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await jsonBody(req);
  seen.push({ path: req.url ?? '', body });

  // 鉴权头最基本的检查：没有 Bearer 就当没带 key
  if (!String(req.headers.authorization ?? '').startsWith('Bearer ')) {
    reply(res, { error: { message: 'missing api key' } }, 401);
    return;
  }

  if (req.url?.endsWith('/embeddings')) {
    if (mode.wrongEmbedDim) {
      reply(res, { data: [{ embedding: Array.from({ length: 512 }, (_, i) => (i % 7) / 7) }] });
    } else {
      reply(res, {
        data: [
          {
            embedding: Array.from({ length: EMBEDDING_DIM }, (_, i) =>
              Number((Math.sin(i) * 0.5).toFixed(4)),
            ),
          },
        ],
      });
    }
    return;
  }

  if (req.url?.endsWith('/chat/completions')) {
    // 降级验证：第一次带 response_format 就 400
    if (mode.rejectResponseFormatOnce && body.response_format) {
      mode.rejectResponseFormatOnce = false;
      reply(res, { error: { message: "unsupported parameter: response_format" } }, 400);
      return;
    }

    const hasImage = JSON.stringify(body.messages ?? []).includes('image_url');
    const raw = hasImage
      ? JSON.stringify({
          species: 'CAT',
          confidence: 0.88,
          features: ['黑白双色', '白色爪尖'],
          note: '外观线索明确',
        })
      : JSON.stringify({
          assessment: '体表可见约 2cm 破损，伴轻度渗血，精神尚可',
          healthStatus: 'YELLOW',
          severity: 'MODERATE',
          advice: ['用生理盐水冲洗', '尽快送校医院或宠物医院处理', '保持创面干燥'],
          signals: ['外伤'],
          confidence: 0.79,
          needsVet: false,
        });

    chatReply(res, mode.fencedJson ? `\`\`\`json\n${raw}\n\`\`\`` : raw);
    return;
  }

  reply(res, { error: { message: 'not found' } }, 404);
}

async function main(): Promise<void> {
  console.log('OpenAI 兼容 Provider · 真实 HTTP 链路自检\n');
  console.log('（起一个本地假服务端，验证联网代码的每一条分支）\n');

  const server = createServer((req, res) => {
    handler(req, res).catch((e) => reply(res, { error: { message: String(e) } }, 500));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}/v1`;

  setProvider(null);
  const provider = createCompatibleProvider({
    name: 'openai',
    apiKey: 'test-key',
    baseUrl,
    chatModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o',
    embedModel: 'text-embedding-3-small',
  });

  try {
    console.log('[1] visionAnalyze · 图片 + 结构化输出');
    const vi = await provider.visionAnalyze(
      '/uploads/cat.jpg',
      '这是什么动物？',
      SpeciesResultSchema,
    );
    check('物种解析正确', vi.species === 'CAT', vi.species);
    check('置信度透传', vi.confidence === 0.88, String(vi.confidence));
    const viReq = seen.find((s) => s.path.endsWith('/chat/completions'));
    check('用了 vision 模型', viReq?.body.model === 'gpt-4o', String(viReq?.body.model));
    check(
      '图片以 image_url content part 发送',
      JSON.stringify(viReq?.body.messages).includes('"type":"image_url"'),
    );
    check('带了 response_format=json_object', viReq?.body.response_format?.type === 'json_object');

    console.log('\n[2] chat · 带 schema');
    const ch = await provider.chat([{ role: 'user', content: '这只猫受伤了' }], HealthAssessmentSchema);
    check('严重度解析正确', ch.severity === 'MODERATE', ch.severity);
    check('建议数组非空', ch.advice.length >= 3, `${ch.advice.length} 条`);
    const lastChat = [...seen].reverse().find((s) => s.path.endsWith('/chat/completions'));
    check('不带图时用了 chat 模型', lastChat?.body.model === 'gpt-4o-mini');

    console.log('\n[3] chat · 不带 schema 返回字符串');
    const txt = await provider.chat([{ role: 'user', content: '你好' }]);
    check('返回纯文本', typeof txt === 'string' && txt.length > 0, txt.slice(0, 30));

    console.log('\n[4] embed');
    const vec = await provider.embed('黑白猫');
    check('维度正确', vec.length === EMBEDDING_DIM, `${vec.length} 维`);
    const embReq = seen.find((s) => s.path.endsWith('/embeddings'));
    check('请求带 dimensions', embReq?.body.dimensions === EMBEDDING_DIM);

    console.log('\n[5] 服务端返回错误维度 → 归一');
    mode.wrongEmbedDim = true;
    const shortVec = await provider.embed('黑白猫');
    check('维度被补齐到 1536', shortVec.length === EMBEDDING_DIM, `${shortVec.length} 维`);
    mode.wrongEmbedDim = false;

    console.log('\n[6] 厂商不支持 response_format → 自动降级重试');
    mode.rejectResponseFormatOnce = true;
    const before = seen.length;
    const dl = await provider.chat([{ role: 'user', content: '这只猫受伤了' }], HealthAssessmentSchema);
    check('降级后仍成功', dl.severity === 'MODERATE', dl.severity);
    check('确实重试了一次', seen.length >= before + 2, `新增 ${seen.length - before} 次请求`);

    console.log('\n[7] 输出带 ```json 代码块 → coerceJson');
    mode.fencedJson = true;
    const fenced = await provider.chat(
      [{ role: 'user', content: '这只猫受伤了' }],
      HealthAssessmentSchema,
    );
    check('代码块被正确解析', fenced.severity === 'MODERATE', fenced.severity);
    mode.fencedJson = false;

    console.log('\n[8] 敏感输入在真实 Provider 上同样被拦（未发出 HTTP）');
    let blocked = false;
    const reqBefore = seen.length;
    try {
      await provider.chat([{ role: 'user', content: '怎么毒杀校园里的流浪猫' }]);
    } catch (e) {
      blocked = e instanceof AIError && e.code === 'AI_MODERATION_BLOCKED';
    }
    check('抛出 AIModerationError', blocked);
    check('没有发出 HTTP 请求', seen.length === reqBefore, `仍为 ${seen.length} 次`);

    console.log('\n[9] 结构校验失败 → AIValidationError 且带 raw');
    const badProvider = createCompatibleProvider({
      name: 'openai',
      apiKey: 'test-key',
      baseUrl,
      chatModel: 'broken',
      visionModel: 'broken',
      embedModel: 'broken',
    });
    // broken 模型会走到 default 分支返回物种 JSON，用它去校验 HealthAssessment 必然缺字段
    let raw = '';
    let issueCount = 0;
    try {
      await badProvider.chat(
        [{ role: 'user', content: 'x' }],
        // 加了 superRefine 之后它是 ZodEffects，不能直接 .extend —— 用 intersection 拼同一效果
        z.intersection(HealthAssessmentSchema, z.object({ mustHave: z.string() })),
      );
    } catch (e) {
      if (e instanceof AIValidationError) {
        raw = e.raw;
        issueCount = e.issues.length;
      }
    }
    check('抛出 AIValidationError', issueCount > 0, `${issueCount} 个问题`);
    check('保留原始输出', raw.length > 0 && raw.includes('"assessment"'), raw.slice(0, 40));

    console.log('\n[10] 鉴权失败 → 非 OK 响应抛错而不静默');
    const noKey = createCompatibleProvider({
      name: 'openai',
      apiKey: '',
      baseUrl,
      chatModel: 'gpt-4o-mini',
      visionModel: 'gpt-4o',
      embedModel: 'text-embedding-3-small',
    });
    let threw = false;
    try {
      await noKey.chat([{ role: 'user', content: 'hi' }]);
    } catch {
      threw = true;
    }
    check('空 key 时抛出错误', threw);

    console.log('\n[11] 超时控制 · chat');
    const slowServer = createServer((_req, res) => {
      setTimeout(() => chatReply(res, JSON.stringify({ species: 'CAT', confidence: 0.9 })), 3000);
    });
    await new Promise<void>((r) => slowServer.listen(0, '127.0.0.1', r));
    const slowPort = (slowServer.address() as { port: number }).port;
    const slow = createCompatibleProvider({
      name: 'openai',
      apiKey: 'k',
      baseUrl: `http://127.0.0.1:${slowPort}/v1`,
      chatModel: 'm',
      visionModel: 'm',
      embedModel: 'm',
    });
    const tChat = Date.now();
    let timedOut = false;
    try {
      await slow.chat([{ role: 'user', content: 'hi' }], { timeoutMs: 600 });
    } catch (e) {
      timedOut = e instanceof AIError && e.code === 'AI_TIMEOUT';
    }
    const chatMs = Date.now() - tChat;
    check('chat 超时被中断', timedOut, `${chatMs}ms`);
    check('确实在 600ms 附近中断而非等满 3s', chatMs < 1500, `${chatMs}ms`);

    console.log('\n[12] 超时控制 · embed（此前完全没有超时）');
    const tEmb = Date.now();
    let embTimedOut = false;
    try {
      await slow.embed('黑白猫', { timeoutMs: 600 });
    } catch (e) {
      embTimedOut = e instanceof AIError && e.code === 'AI_TIMEOUT';
    }
    const embMs = Date.now() - tEmb;
    check('embed 超时被中断', embTimedOut, `${embMs}ms`);
    check('embed 没等满 3s', embMs < 1500, `${embMs}ms`);
    slowServer.close();

    console.log('\n[13] 回归 · chat(msgs, undefined, opts) 不能丢掉第三个参数');
    // 这是修掉的 bug：schema 传 undefined 时 hasSchema 为 false，
    // 旧实现会把第三位的 opts 整个丢弃，导致 timeoutMs 失效。
    const tArg = Date.now();
    let argTimedOut = false;
    try {
      await (slow.chat as (m: unknown, s: unknown, o: unknown) => Promise<unknown>)(
        [{ role: 'user', content: 'hi' }],
        undefined,
        { timeoutMs: 600 },
      );
    } catch (e) {
      argTimedOut = e instanceof AIError && e.code === 'AI_TIMEOUT';
    }
    const argMs = Date.now() - tArg;
    check('三参数写法的 timeoutMs 生效', argTimedOut, `${argMs}ms`);

    console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  } finally {
    server.close();
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('自检脚本自身异常:', e);
  process.exit(1);
});
