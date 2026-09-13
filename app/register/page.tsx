'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, apiFetch } from '@/lib/client';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      router.replace('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card">
        <h2>注册</h2>
        <p className="card-sub">注册即赠送 100 积分（虚构数据）。</p>
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
            <label htmlFor="displayName">昵称</label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              maxLength={40}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">密码（至少 8 位）</label>
            <input
              id="password"
              type="password"
              value={password}
              autoComplete="new-password"
              minLength={8}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '注册中…' : '注册并登录'}
          </button>
        </form>
        <p className="card-sub" style={{ marginTop: 14, marginBottom: 0 }}>
          已有账号？<Link href="/login">去登录</Link>
        </p>
      </div>
    </div>
  );
}
