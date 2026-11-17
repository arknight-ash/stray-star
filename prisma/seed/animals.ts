export interface AnimalSeed {
  code: string;
  name: string;
  species: 'CAT' | 'DOG';
  healthLevel: 'GREEN' | 'YELLOW' | 'RED';
  lat: number;
  lng: number;
  summary: string;
  /** 用于生成 embedding 的特征描述：毛色、体型、显著标记、常驻位置 */
  features: string[];
  /** 头像 SVG 主色（深色底上的毛色近似） */
  palette: string;
}

/**
 * 3 猫 2 狗。坐标全部落在「武汉华夏理工学院 · 光谷校区」校园内（2026-10-27 重写）。
 *
 * 口径：这里是 **WGS-84**（与库里其余坐标一致），GCJ-02 纠偏交给绘制层（lib/map-config.ts）。
 *
 * 标定方式：先用腾讯地图真实 POI（GCJ-02）反解出校园四至，再把每只动物摆在对应建筑旁边：
 *   西门 114.4037 —— 田径运动场 114.4101（东西 630m）
 *   1 号教学楼 30.4678 —— 李园食堂 30.4710（南北 356m），约 323 亩，与校方公布的光谷校区面积吻合。
 *
 * 上一版是按「一般校园」编的方位（东门/南门/一食堂/宿舍区/操场/教学楼后巷），
 * 结果小灰落在围墙外 66m、橘长落在南墙外 67m，雪梨和大黄离边界只剩 11–12m。
 * 现在五颗星离边界最近也有 26m，且都贴着真实建筑（图书馆 / 李园食堂 / 学生公寓 7 号楼 /
 * 田径运动场 / 西门车棚），与 map-config 的 CAMPUS_SPOTS 同一套点位。
 */
export const ANIMALS: AnimalSeed[] = [
  {
    code: 'No.001',
    name: '煤球',
    species: 'CAT',
    healthLevel: 'GREEN',
    lat: 30.47056,
    lng: 114.40478,
    summary: '亲人，固定投喂点，已绝育（左耳耳标）',
    features: [
      '黑色短毛猫',
      '成年，体型中等偏瘦',
      '左耳有绝育耳标缺口',
      '尾巴尖有一小撮白毛',
      '常驻图书馆北侧花坛',
      '不怕人，会主动蹭腿',
    ],
    palette: '#2B2B33',
  },
  {
    code: 'No.002',
    name: '橘长',
    species: 'CAT',
    healthLevel: 'YELLOW',
    lat: 30.47076,
    lng: 114.40748,
    summary: '近期食欲下降，需持续观察',
    features: [
      '橘色虎斑猫',
      '成年公猫，体型偏胖',
      '右前爪有旧伤疤痕',
      '脸颊肉多，尾巴粗',
      '常驻李园食堂后巷垃圾桶旁',
      '近期进食量明显减少',
    ],
    palette: '#C9762F',
  },
  {
    code: 'No.003',
    name: '雪梨',
    species: 'CAT',
    healthLevel: 'GREEN',
    lat: 30.4703,
    lng: 114.40796,
    summary: '警惕性高，仅夜间出没',
    features: [
      '白色长毛猫',
      '成年，体型纤细',
      '异瞳（左蓝右黄）',
      '颈部有一小块浅灰色斑',
      '常驻学生公寓 7 号楼绿化带',
      '白天躲藏，夜间活动',
    ],
    palette: '#E7E3DA',
  },
  {
    code: 'No.004',
    name: '大黄',
    species: 'DOG',
    healthLevel: 'GREEN',
    lat: 30.46932,
    lng: 114.40968,
    summary: '性格温顺，已接种，常有人遛',
    features: [
      '黄色中华田园犬',
      '成年中型犬，约 15 公斤',
      '脖子上戴蓝色旧项圈',
      '左后腿轻微跛行（旧伤）',
      '常驻田径运动场看台下',
      '亲人，可接受牵引',
    ],
    palette: '#D9A441',
  },
  {
    code: 'No.005',
    name: '小灰',
    species: 'DOG',
    healthLevel: 'RED',
    lat: 30.46982,
    lng: 114.4039,
    summary: '右后腿外伤，已上报预警待处理',
    features: [
      '灰色中华田园犬',
      '未成年小型犬，约 6 公斤',
      '右后腿有明显外伤伤口',
      '耳朵偏大，尾巴下垂',
      '常驻西门内非机动车棚',
      '精神略差，行走时避用右后腿',
    ],
    palette: '#8A8F98',
  },
];

/** 生成 embedding 用的文本：编号 + 名字 + 物种 + 状态 + 全部特征 */
export function animalEmbeddingText(a: AnimalSeed): string {
  return [a.code, a.name, a.species === 'CAT' ? '猫' : '狗', a.summary, ...a.features].join(' ');
}
