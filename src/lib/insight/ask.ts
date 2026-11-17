import { prisma } from '@/lib/db';
import { spotMentionedIn } from '@/lib/map-config';
import { HEALTH_META } from '@/lib/semantic';
import { listAnimals } from './list';
import { loadDbSnapshot, type DbSnapshot } from './db-stats';
import type { PrismaClient } from '@prisma/client';

/**
 * 「这个问题能不能用数据库直接回答」—— 判定 + 作答，合一。
 *
 * 设计原则（与项目其余部分一致：没有依据就不答）：
 * 1. **算得出才认**。命中不了任何一类就返回 null，交回原来的知识与档案链路，
 *    绝不为了让统计分支"看起来有用"而把护理问题硬套成计数问题。
 * 2. **数字不由模型产生**。这里给的 answer 是确定性文本，模型只在需要润色时才碰它；
 *    星枢问答的 DATA 分支直接返回，不经过生成器 —— 模型数不清它没看见的行。
 * 3. **口径唯一**。角落归属、健康分级全部取自 db-stats / list，与图鉴、星图同源。
 */

export type DbTopic =
  | 'animalTotal'
  | 'healthDist'
  | 'alerts'
  | 'attention'
  | 'observations'
  | 'photos'
  | 'spots'
  | 'pending'
  | 'missingLocation'
  | 'recent';

export interface DbAnswer {
  topic: DbTopic;
  /** 确定性答案（中文，可直接展示） */
  answer: string;
  /** 支撑这条答案的事实行，供模型改写时参考（不含数字以外的推断） */
  facts: string[];
}

export interface AskDeps {
  db?: PrismaClient;
  now?: Date;
}

const has = (q: string, re: RegExp) => re.test(q);

/** 数量单位的出现，避免「一天喂几次」被判成统计问题 */
const COUNT_WORD =
  /多少|几(只|条|张|个|位|次记录)|数量|总数|一共|总共|共有|统计|分布|占比|最多|最少|排行|排名/;

/** 数据域名词：问题里必须至少有一个，否则不认 */
const DOMAIN_WORD =
  /动物|猫咪|流浪猫|流浪狗|猫|狗|星星|星图|档案|记录|观察|手账|照片|相片|预警|角落|区域|位置|坐标|同学|用户|数据|库里|数据库/;

const ATTENTION_WORD = /需要关注|要关注|重点关注|优先关注|异常|有问题|情况不好|危险|危急|红色|预警/;
const LIST_WORD = /哪些|哪个|谁|名单|列出|都有|有谁/;

function joinNames(rows: Array<{ code: string; name: string }>, max = 6): string {
  const shown = rows.slice(0, max).map((r) => `${r.name}（${r.code}）`);
  const rest = rows.length - shown.length;
  return shown.join('、') + (rest > 0 ? ` 等 ${rows.length} 只` : '');
}

function fmtDate(iso: string, now: Date): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `今天 ${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

/** 问句里点名的校园角落（「宿舍区有几只」「操场那边」），没有则 null。别名口径见 map-config */
function spotInQuestion(q: string) {
  return spotMentionedIn(q);
}

/**
 * 数据库问答入口。
 * @returns 命中则返回确定性答案；不属于数据库能答的范畴则 null
 */
export async function askDatabase(question: string, deps: AskDeps = {}): Promise<DbAnswer | null> {
  const q = question.trim();
  if (!q) return null;

  const db = deps.db ?? prisma;
  const now = deps.now ?? new Date();
  const named = spotInQuestion(q);

  // —— 1. 角落分布 / 某个角落有多少 ——
  // 不能只认"分布"两个字：「健康情况分布」问的是三色，不是地理分布。
  // 必须点明角落类词（或直接点名某个角落），否则留给后面的健康分布去接。
  if (
    (has(q, /角落|区域|片区|哪个地方|哪些地方/) && has(q, COUNT_WORD)) ||
    (named && has(q, COUNT_WORD))
  ) {
    const snap = await loadDbSnapshot({ db, now });
    if (named) {
      const stat = snap.spots.find((s) => s.name === named.name);
      const animals = stat?.animals ?? 0;
      const obs = stat?.observations ?? 0;
      return {
        topic: 'spots',
        answer:
          `「${named.name}」附近当前有 ${animals} 只动物的档案落在这个范围，` +
          `已核实记录里有 ${obs} 条拍/记在这个角落。` +
          (animals === 0
            ? '这个角落还没有建档的个体，可以留意一下是不是有没被记录过的小朋友。'
            : ''),
        facts: [`${named.name}: 动物 ${animals} 只、记录 ${obs} 条`],
      };
    }
    const active = snap.spots.filter((s) => s.animals > 0 || s.observations > 0);
    if (!active.length) {
      return {
        topic: 'spots',
        answer: '目前所有角落都还没有落点数据，记录一笔带定位的观察后就能看出来。',
        facts: [],
      };
    }
    const top = active[0]!;
    return {
      topic: 'spots',
      answer:
        `按档案坐标归类，最集中的是「${top.name}」（${top.animals} 只、${top.observations} 条记录）。全部分布：` +
        active.map((s) => `${s.name} ${s.animals} 只 / ${s.observations} 条`).join('、') +
        '。',
      facts: active.map((s) => `${s.name}: 动物 ${s.animals} 只、记录 ${s.observations} 条`),
    };
  }

  // —— 2. 缺位置坐标的名单（「哪些还没补位置」）——
  // 说法很杂：没位置 / 缺坐标 / 位置待补充 / 还没补位置的，
  // 只要提到"位置"且带缺失语义就认 —— 这一类的答案只有一种，不会答错方向。
  if (
    has(q, /位置|坐标/) &&
    has(q, /(没有|没|缺|未|待补充|待完善|补)/) &&
    !has(q, /在哪|哪里|哪儿|什么地方|怎么|如何/)
  ) {
    const rows = await listAnimals({ missingLocation: true, limit: 12 }, { db });
    if (!rows.length) {
      return {
        topic: 'missingLocation',
        answer: '所有档案都已经有位置坐标了，图鉴里不会再出现「位置待补充」。',
        facts: [],
      };
    }
    return {
      topic: 'missingLocation',
      answer:
        `还有 ${rows.length} 只没有位置坐标：${joinNames(rows)}。` +
        '在档案页点「补充位置」框选一个范围，它们的星点就会落到星图上。',
      facts: rows.map((r) => `${r.code} ${r.name} 缺坐标`),
    };
  }

  // —— 3. 待核实 ——
  if (has(q, /待核实|没核实|待审核|待确认|需要核实|审核/) && has(q, COUNT_WORD)) {
    const snap = await loadDbSnapshot({ db, now });
    return {
      topic: 'pending',
      answer:
        `当前有 ${snap.animals.pendingReview} 只档案、${snap.observations.pendingReview} 条观察记录等着核实。` +
        (snap.animals.pendingReview + snap.observations.pendingReview === 0
          ? '队列是空的。'
          : '待核实的内容在地图和星图上按「未确认事实」处理，管理员在处置台确认后才计入正式档案。'),
      facts: [
        `待核实档案 ${snap.animals.pendingReview} 只`,
        `待核实记录 ${snap.observations.pendingReview} 条`,
      ],
    };
  }

  // —— 4. 未处理预警 ——
  if (has(q, /预警|警报|告警/) && (has(q, COUNT_WORD) || has(q, /未处理|没处理|现在|当前|还有/))) {
    const snap = await loadDbSnapshot({ db, now });
    if (snap.alerts.open === 0) {
      return {
        topic: 'alerts',
        answer: '当前没有未处理的预警，星图上的星都是安定状态。',
        facts: ['未处理预警 0 条'],
      };
    }
    const rows = await db.alert.findMany({
      where: { status: 'OPEN' },
      orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
      take: 5,
      select: {
        level: true,
        reason: true,
        createdAt: true,
        animal: { select: { code: true, name: true } },
      },
    });
    return {
      topic: 'alerts',
      answer:
        `现在有 ${snap.alerts.open} 条未处理预警：严重 ${snap.alerts.critical} 条、警告 ${snap.alerts.warn} 条、通知 ${snap.alerts.info} 条。` +
        '最需要先看的是：' +
        rows
          .map(
            (r) =>
              `${r.animal.name}（${r.animal.code}）${r.reason}（${fmtDate(r.createdAt.toISOString(), now)}）`,
          )
          .join('；') +
        '。',
      facts: rows.map((r) => `${r.animal.code} ${r.level} ${r.reason}`),
    };
  }

  // —— 5. 「需要关注的有哪些」名单 ——
  if (has(q, LIST_WORD) && has(q, ATTENTION_WORD)) {
    const onlyRed = has(q, /红色|危急|严重/) && !has(q, /观察|黄色|需要关注/);
    const rows = await listAnimals(
      { healthLevel: onlyRed ? ['RED'] : ['RED', 'YELLOW'], limit: 12 },
      { db },
    );
    if (!rows.length) {
      return {
        topic: 'attention',
        answer: onlyRed
          ? '目前没有处于红色预警档的个体。'
          : '目前没有需要特别关注的个体，全都在健康档。',
        facts: [],
      };
    }
    return {
      topic: 'attention',
      answer:
        `需要${onlyRed ? '优先处理' : '关注'}的有 ${rows.length} 只：` +
        rows
          .map(
            (r) =>
              `${r.name}（${r.code}｜${HEALTH_META[r.healthLevel].label}` +
              (r.openAlerts ? `，${r.openAlerts} 条未处理预警` : '') +
              (r.spot ? `，常在${r.spot}附近` : '') +
              '）',
          )
          .join('；') +
        '。',
      facts: rows.map((r) => `${r.code} ${r.name} ${r.healthLevel} 预警 ${r.openAlerts} 条`),
    };
  }

  // —— 6. 健康三色分布 ——
  if (
    has(q, /健康|状态|三色|绿色|黄色|红色|星星/) &&
    has(q, /多少|几只|分布|几个|情况/) &&
    !has(q, /怎么办|如何|护理/)
  ) {
    const snap = await loadDbSnapshot({ db, now });
    return {
      topic: 'healthDist',
      answer:
        `一共 ${snap.animals.total} 只建档个体：健康 ${snap.animals.green} 只、需要观察 ${snap.animals.yellow} 只、` +
        `预警 ${snap.animals.red} 只。` +
        (snap.animals.red > 0
          ? `红色档的 ${snap.animals.red} 只建议先看，星图上它们是最亮的那种星。`
          : '目前没有红色档。'),
      facts: [
        `健康 ${snap.animals.green}`,
        `观察 ${snap.animals.yellow}`,
        `预警 ${snap.animals.red}`,
      ],
    };
  }

  // —— 7. 观察记录量 / 谁被记录得最多 ——
  if (has(q, /记录|观察|手账|笔记|发现/) && has(q, COUNT_WORD)) {
    const snap = await loadDbSnapshot({ db, now });
    const wantsTop = has(q, /谁|哪只|最多|最常/);
    const parts = [
      `累计 ${snap.observations.total} 条观察记录：今天 ${snap.observations.today} 条、近 7 天 ${snap.observations.last7d} 条。`,
    ];
    if (snap.observations.pendingReview)
      parts.push(`其中 ${snap.observations.pendingReview} 条待核实。`);
    if (wantsTop && snap.topRecorded.length) {
      parts.push(
        '近 7 天被记录最多的是 ' +
          snap.topRecorded.map((t) => `${t.name}（${t.code}，${t.count} 条）`).join('、') +
          '。',
      );
    }
    return {
      topic: 'observations',
      answer: parts.join(''),
      facts: [
        `总记录 ${snap.observations.total}`,
        `今天 ${snap.observations.today}`,
        `近 7 天 ${snap.observations.last7d}`,
      ],
    };
  }

  // —— 8. 照片 ——
  if (has(q, /照片|相片|图片|照片墙/) && has(q, COUNT_WORD)) {
    const snap = await loadDbSnapshot({ db, now });
    return {
      topic: 'photos',
      answer:
        `照片墙现在有 ${snap.observations.withPhoto} 张带图的观察照片，` +
        `档案头像库另有 ${snap.photos} 张上传过的图。` +
        (snap.observations.withPhoto === 0 ? '记录一条带照片的观察就能上墙。' : ''),
      facts: [`带图观察 ${snap.observations.withPhoto}`, `上传图片 ${snap.photos}`],
    };
  }

  // —— 9. 最近发生了什么 ——
  if (
    has(q, /最近|最新|这两天|今天/) &&
    has(q, /发生|记录|观察|发现|动态|新鲜事|有人/) &&
    !has(q, COUNT_WORD)
  ) {
    const snap = await loadDbSnapshot({ db, now });
    if (!snap.latest.length) {
      return { topic: 'recent', answer: '还没有任何已核实的观察记录。', facts: [] };
    }
    return {
      topic: 'recent',
      answer:
        '最近几条已核实记录：' +
        snap.latest
          .map((o) => `${o.name}（${o.code}）${fmtDate(o.at, now)}：${o.content.slice(0, 40)}`)
          .join('；') +
        '。',
      facts: snap.latest.map((o) => `${o.code} ${o.at} ${o.content.slice(0, 40)}`),
    };
  }

  // —— 10. 总量（放在最后：这是最宽的一条，前面更具体的先认领）——
  if (has(q, COUNT_WORD) && has(q, DOMAIN_WORD) && !has(q, /怎么办|如何|护理|喂什么|吃什么|药/)) {
    const snap: DbSnapshot = await loadDbSnapshot({ db, now });
    const wantsCat = has(q, /猫/);
    const wantsDog = has(q, /狗/);
    let answer: string;
    if (wantsCat && !wantsDog) {
      answer = `图鉴里现在有 ${snap.animals.cats} 只猫建档。`;
    } else if (wantsDog && !wantsCat) {
      answer = `图鉴里现在有 ${snap.animals.dogs} 只狗建档。`;
    } else {
      answer =
        `现在一共 ${snap.animals.total} 只动物建档：猫 ${snap.animals.cats} 只、狗 ${snap.animals.dogs} 只；` +
        `健康 ${snap.animals.green}、观察 ${snap.animals.yellow}、预警 ${snap.animals.red}。`;
    }
    return {
      topic: 'animalTotal',
      answer:
        answer + `另有 ${snap.observations.total} 条观察记录、${snap.alerts.open} 条未处理预警。`,
      facts: [
        `动物 ${snap.animals.total}（猫 ${snap.animals.cats} / 狗 ${snap.animals.dogs}）`,
        `观察 ${snap.observations.total}`,
        `未处理预警 ${snap.alerts.open}`,
      ],
    };
  }

  return null;
}
