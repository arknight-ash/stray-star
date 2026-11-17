/** 种子账号：统一初始密码，seed 后会打印。登录页可用学号 + 该密码直接登录。 */
export const DEFAULT_PASSWORD = 'straystar2026';

export interface UserSeed {
  name: string;
  studentId: string;
  email: string;
  role: 'STUDENT' | 'ADMIN';
}

export const USERS: UserSeed[] = [
  {
    name: '林蔚（社团负责人）',
    studentId: '20230001',
    email: 'admin@campus.edu',
    role: 'ADMIN',
  },
  {
    name: '阿澈',
    studentId: '20230112',
    email: 'ache@campus.edu',
    role: 'STUDENT',
  },
  {
    name: '小鹿',
    studentId: '20230207',
    email: 'xiaolu@campus.edu',
    role: 'STUDENT',
  },
];
