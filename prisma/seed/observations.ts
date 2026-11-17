export interface ObservationSeed {
  animalCode: string;
  /** 提交人学号（对应 seed/users.ts） */
  authorId: string;
  type: 'FEEDING' | 'HEALTH' | 'BEHAVIOR' | 'OTHER';
  content: string;
  tags: string[];
  severity: 'MILD' | 'MODERATE' | 'SEVERE';
  /** 照片墙演示：该条观察挂上这只动物的真实照片（public/animals/{code}.jpg） */
  photoForWall?: boolean;
  /** 距今多少天，用于构造真实时间线 */
  daysAgo: number;
}

/** 15 条众包观察，覆盖四种类型与三档严重度 */
export const OBSERVATIONS: ObservationSeed[] = [
  {
    animalCode: 'No.001',
    authorId: '20230112',
    type: 'FEEDING',
    photoForWall: true,
    content: '晚 7 点在图书馆北侧花坛投喂，吃了大概半碗猫粮，喝了不少水。左耳耳标看得很清楚。',
    tags: ['投喂', '已绝育', '耳标', '定点'],
    severity: 'MILD',
    daysAgo: 1,
  },
  {
    animalCode: 'No.001',
    authorId: '20230207',
    type: 'BEHAVIOR',
    content: '主动蹭人，愿意被摸头但不让抱。旁边有同学拍照时它也没跑。',
    tags: ['亲人', '定点'],
    severity: 'MILD',
    daysAgo: 3,
  },
  {
    animalCode: 'No.001',
    authorId: '20230112',
    type: 'HEALTH',
    content: '精神好，毛色顺滑，眼睛鼻子干净，没有打喷嚏或流泪。',
    tags: ['已绝育'],
    severity: 'MILD',
    daysAgo: 6,
  },
  {
    animalCode: 'No.002',
    authorId: '20230207',
    type: 'FEEDING',
    content: '李园食堂后巷投喂，平时一口气吃完的量今天只吃了三分之一就走了。',
    tags: ['投喂', '食欲下降'],
    severity: 'MODERATE',
    daysAgo: 1,
  },
  {
    animalCode: 'No.002',
    authorId: '20230112',
    type: 'HEALTH',
    content: '看起来比上个月瘦了一圈，趴着的时间变长，叫它也不怎么抬头。',
    tags: ['食欲下降', '消瘦', '精神差'],
    severity: 'MODERATE',
    daysAgo: 2,
  },
  {
    animalCode: 'No.002',
    authorId: '20230207',
    type: 'BEHAVIOR',
    photoForWall: true,
    content: '还是占据垃圾桶旁的位置，驱赶附近另一只猫，攻击性比之前强一点。',
    tags: ['定点', '应激'],
    severity: 'MILD',
    daysAgo: 5,
  },
  {
    animalCode: 'No.002',
    authorId: '20230112',
    type: 'OTHER',
    content: '已把食欲下降的情况发到社团群，等有经验的同学一起判断要不要诱捕就医。',
    tags: ['食欲下降'],
    severity: 'MODERATE',
    daysAgo: 2,
  },
  {
    animalCode: 'No.003',
    authorId: '20230207',
    type: 'BEHAVIOR',
    content: '晚上 11 点在学生公寓 7 号楼绿化带看到它，靠近两米就跑，只拍到一张模糊的照片。',
    tags: ['警惕', '夜行'],
    severity: 'MILD',
    daysAgo: 2,
  },
  {
    animalCode: 'No.003',
    authorId: '20230112',
    type: 'FEEDING',
    content: '在绿化带边缘放了猫粮和水，早上看碗空了，但没见到本体。',
    tags: ['投喂', '夜行'],
    severity: 'MILD',
    daysAgo: 4,
  },
  {
    animalCode: 'No.003',
    authorId: '20230207',
    type: 'HEALTH',
    photoForWall: true,
    content: '远远看毛色干净，走路姿态正常，没有跛行，异瞳很显眼。',
    tags: ['夜行'],
    severity: 'MILD',
    daysAgo: 7,
  },
  {
    animalCode: 'No.004',
    authorId: '20230112',
    type: 'FEEDING',
    photoForWall: true,
    content: '田径运动场看台下喂了狗粮加水，吃完后在旁边趴了半小时，有几位同学在旁边坐着它也不介意。',
    tags: ['投喂', '亲人', '定点', '接种'],
    severity: 'MILD',
    daysAgo: 1,
  },
  {
    animalCode: 'No.004',
    authorId: '20230207',
    type: 'HEALTH',
    content: '左后腿还是有点跛，跑起来看得出来，但不影响走路。项圈有点旧了，考虑换一条。',
    tags: ['跛行', '接种'],
    severity: 'MILD',
    daysAgo: 4,
  },
  {
    animalCode: 'No.004',
    authorId: '20230112',
    type: 'OTHER',
    content: '已在社团登记接种记录（去年秋季），下次驱虫时间待补。',
    tags: ['接种', '定点'],
    severity: 'MILD',
    daysAgo: 9,
  },
  {
    animalCode: 'No.005',
    authorId: '20230207',
    type: 'HEALTH',
    photoForWall: true,
    content: '西门内非机动车棚发现的，右后腿有一道伤口，周围毛被血黏住了，走路不敢着地。已经上报，等社团来处理。',
    tags: ['外伤', '跛行', '精神差'],
    severity: 'SEVERE',
    daysAgo: 1,
  },
  {
    animalCode: 'No.005',
    authorId: '20230112',
    type: 'FEEDING',
    content: '放了狗粮和温水，它只吃了几口就缩回车棚角落。精神比昨天更差。',
    tags: ['投喂', '外伤', '应激'],
    severity: 'SEVERE',
    daysAgo: 0,
  },
];
