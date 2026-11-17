import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SITE } from '@/lib/constants';
import { StarFieldBackground } from '@/components/shell/StarFieldBackground';

export const metadata: Metadata = {
  title: {
    default: `${SITE.name} · 校园流浪动物智能识别与健康管理`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.tagline,
};

export const viewport: Viewport = {
  themeColor: SITE.themeColor,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* 霞鹜文楷：叙事与标题 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css"
        />
        {/* Inter / JetBrains Mono / Noto Serif SC：正文、数据、衬线回落 */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Noto+Serif+SC:wght@400;500&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <StarFieldBackground />
        {children}
      </body>
    </html>
  );
}
