import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '积分任务与数字商品兑换',
  description: '任务获取积分，积分兑换数字商品（演示应用，使用虚构数据）',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <header className="site-header">
            <a className="brand" href="/">
              <span className="brand-mark">P</span>
              <span>积分任务与数字商品兑换</span>
            </a>
            <span className="demo-badge">演示环境 · 虚构数据 · 不涉及真实资金</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
