import type { Transition, Variants } from 'framer-motion';

/** 全站动效基线：240ms / cubic-bezier(.2,.8,.2,1) */
export const EASE_STAR = [0.2, 0.8, 0.2, 1] as const;
export const DUR = 0.24;

export const transition: Transition = { duration: DUR, ease: EASE_STAR };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition },
};

export const stagger = (gap = 0.06): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: gap } },
});

/** 星点脉冲：2.4s 循环；由 useReducedMotion 决定是否启用 */
export const pulseTransition: Transition = {
  duration: 2.4,
  ease: 'easeInOut',
  repeat: Infinity,
};
