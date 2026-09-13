'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card">
        <h2>登录</h2>
        <p className="card-sub">使用你的邮箱与密码登录。</p>
        {error && <div className="notice err">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">邮箱</label>
            <input
              id="email"
              type="email"
              value={email}
              autoComplete="username"
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        <p className="card-sub" style={{ marginTop: 14, marginBottom: 0 }}>
          还没有账号？<Link href="/register">立即注册</Link>
        </p>
      </div>
    </div>
  );
}
