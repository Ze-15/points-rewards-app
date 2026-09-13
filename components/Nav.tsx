'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/client';

const LINKS = [
  { href: '/', label: '仪表盘' },
  { href: '/ledger', label: '收支明细' },
  { href: '/redemptions', label: '兑换记录' },
];

/** 顶部导航：高亮当前页，并提供退出登录。 */
export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // 即便请求失败也回到登录页。
    }
    router.replace('/login');
    router.refresh();
  }

  return (
    <nav className="nav">
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`nav-link${pathname === l.href ? ' active' : ''}`}
        >
          {l.label}
        </Link>
      ))}
      <span className="spacer" />
      <button type="button" className="ghost" onClick={logout}>
        退出登录
      </button>
    </nav>
  );
}
