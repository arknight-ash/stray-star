/**
 * 敏感内容过滤：输入与 AI 输出都要过一遍。
 * 拦截四类风险：虐待/伤害动物、动物交易、个人隐私信息、绝对化医疗断言。
 */

interface Rule {
  reason: string;
  pattern: RegExp;
  block: boolean;
}

const RULES: Rule[] = [
  // 「毒死 / 药死」是最常见的措辞，原来只写了「毒杀」会漏掉它们
  { reason: '疑似虐待或伤害动物的描述', pattern: /虐杀|虐打|毒杀|毒死|药死|毒害|下毒|打死|踢死|勒死|虐待致死|用火烧|泼硫酸/, block: true },
  { reason: '疑似动物交易或遗弃信息', pattern: /出售|售卖|低价转让|有偿领养|买卖幼崽|狗肉|猫肉/, block: true },
  { reason: '包含手机号', pattern: /1[3-9]\d{9}/, block: false },
  { reason: '包含身份证号', pattern: /\b\d{17}[\dXx]\b/, block: false },
  { reason: '包含完整学号以外的长数字串', pattern: /\b\d{16,19}\b/, block: false },
];

const MEDICAL_ABSOLUTE = /(一定|肯定|保证)\s*(能|会)\s*(治好|痊愈)|无需\s*(就医|看兽医)|包治百病/;

export interface ModerationResult {
  safe: boolean;
  reasons: string[];
  sanitized: string;
}

export function moderateText(text: string): ModerationResult {
  const reasons: string[] = [];
  let sanitized = text;

  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      reasons.push(rule.reason);
      sanitized = sanitized.replace(rule.pattern, (m) =>
        rule.block ? '[已屏蔽]' : `${m.slice(0, 3)}****${m.slice(-2)}`,
      );
    }
  }

  if (MEDICAL_ABSOLUTE.test(text)) {
    reasons.push('包含绝对化医疗断言');
    sanitized = sanitized.replace(MEDICAL_ABSOLUTE, '建议尽快就医');
  }

  // 只有「阻断级」规则命中才判定为不安全；隐私类规则仅做脱敏，不阻止提交
  return { safe: !hasBlocking(text), reasons, sanitized };
}

function hasBlocking(text: string): boolean {
  return RULES.some((r) => r.block && r.pattern.test(text));
}

/** 只判断是否阻断，供 API 前置校验使用 */
export function isBlocked(text: string): boolean {
  return hasBlocking(text);
}
