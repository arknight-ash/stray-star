import type { Config } from 'tailwindcss';

/**
 * 设计令牌落点 A
 * 这里只做「CSS 变量 -> Tailwind 工具类」的映射，真正的取值唯一来源在 src/styles/tokens.css。
 * 任何新增颜色必须先加 CSS 变量，再在这里映射，禁止直接写十六进制。
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/hooks/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        space: {
          900: 'var(--space-900)',
          800: 'var(--space-800)',
          700: 'var(--space-700)',
        },
        accent: {
          300: 'var(--accent-300)',
          400: 'var(--accent-400)',
          500: 'var(--accent-500)',
          600: 'var(--accent-600)',
        },
        star: {
          green: 'var(--star-green)',
          yellow: 'var(--star-yellow)',
          red: 'var(--star-red)',
        },
        // 图表辅助紫：只给数据可视化的第四类目用，不是语义色（见 tokens.css 注释）
        violet: {
          300: 'var(--violet-300)',
          400: 'var(--violet-400)',
        },
        paper: 'var(--paper)',
        ink: 'var(--ink)',
        hi: 'var(--text-hi)',
        lo: 'var(--text-lo)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        sticker: 'var(--radius-sticker)',
        btn: 'var(--radius-btn)',
      },
      boxShadow: {
        glow: 'var(--shadow-glow)',
        'glow-strong': 'var(--shadow-glow-strong)',
        paper: 'var(--shadow-paper)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        body: 'var(--font-body)',
        mono: 'var(--font-mono)',
      },
      transitionTimingFunction: {
        star: 'var(--ease)',
      },
      transitionDuration: {
        star: '240',
        pulse: '2400',
        dust: '600',
      },
      keyframes: {
        'star-pulse': {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.18)' },
        },
        'dust-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'none' },
        },
        orbit: {
          to: { transform: 'rotate(360deg)' },
        },
        'alert-ring': {
          '0%': { opacity: '0.7', transform: 'scale(0.6)' },
          '100%': { opacity: '0', transform: 'scale(2.2)' },
        },
        /* 阶段 3 · 星卡捕获 */
        'corner-in': {
          from: { opacity: '0', transform: 'scale(0.82)' },
          to: { opacity: '1', transform: 'none' },
        },
        'scan-dust': {
          '0%': { transform: 'translateY(-10%)', opacity: '0.2' },
          '15%': { opacity: '1' },
          '85%': { opacity: '1' },
          '100%': { transform: 'translateY(108%)', opacity: '0.2' },
        },
        'star-burst': {
          '0%': { transform: 'scale(0.6)', opacity: '0.65' },
          '60%': { transform: 'scale(1.18)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        /* 阶段 4 · 手账便签飞入。终态就是 rotate(var(--note-rot))：
           reduced-motion 把动画压到 0.01ms 后落在这一帧，视觉等于静态倾斜 */ 
        'note-fly': {
          '0%': {
            opacity: '0',
            transform: 'translateY(56px) rotate(calc(var(--note-rot) - 8deg)) scale(0.94)',
          },
          '62%': {
            opacity: '1',
            transform: 'translateY(-6px) rotate(calc(var(--note-rot) + 2deg)) scale(1.02)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) rotate(var(--note-rot)) scale(1)',
          },
        },
      },
      animation: {
        'star-pulse': 'star-pulse var(--dur-pulse) var(--ease) infinite',
        'dust-in': 'dust-in var(--dur-dust) var(--ease) both',
        orbit: 'orbit 18s linear infinite',
        'alert-ring': 'alert-ring var(--dur-pulse) var(--ease) infinite',
        'corner-in': 'corner-in var(--dur-corner) var(--ease) both',
        'scan-dust': 'scan-dust var(--dur-scan) linear infinite',
        'star-burst': 'star-burst var(--dur-burst) var(--ease) both',
        'note-fly': 'note-fly var(--dur-fly) var(--ease) both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
