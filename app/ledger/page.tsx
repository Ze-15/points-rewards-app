'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '@/components/Nav';
import { ApiError, apiFetch, formatTime, reasonLabel } from '@/lib/client';
import type { LedgerEntry, MeView } from '@/lib/types';

type MeResponse = { me: MeView };

export default function LedgerPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeView | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meData, ledgerData] = await Promise.all([
        apiFetch<MeResponse>('/api/me'),
        apiFetch<{ ledger: LedgerEntry[] }>('/api/ledger'),
      ]);
      setMe(meData.me);
      setEntries(ledgerData.ledger);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setError(err instanceof Error ? err.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="loading">加载中…</div>;
  if (!me) return null;

  const income = entries.filter((e) => e.delta > 0).reduce((s, e) => s + e.delta, 0);
  const expense = entries.filter((e) => e.delta < 0).reduce((s, e) => s + e.delta, 0);

  return (
    <>
      <Nav />
      {error && <div className="notice err">{error}</div>}

      <section className="card balance-card">
        <div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            当前积分余额
          </div>
          <div className="balance-value">
            {me.pointsBalance}
            <span className="balance-unit">积分</span>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12.5 }}>
          累计收入 <span className="positive">+{income}</span> · 累计支出{' '}
          <span className="negative">{expense}</span>
          <br />
          合计 {income + expense} 积分
        </div>
      </section>

      <section className="card">
        <h2>收支明细</h2>
        <p className="card-sub">
          每笔记录都带有变动后的余额快照，可逐笔核对；列表按时间倒序排列。
        </p>
        {entries.length === 0 ? (
          <div className="empty">暂无积分记录。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>类型</th>
                <th>说明</th>
                <th className="num">变动</th>
                <th className="num">变动后余额</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="muted mono">{formatTime(e.createdAt)}</td>
                  <td>
                    <span className="tag">{reasonLabel(e.reason)}</span>
                  </td>
                  <td>{e.note ?? '—'}</td>
                  <td className={`num ${e.delta > 0 ? 'positive' : 'negative'}`}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta}
                  </td>
                  <td className="num">{e.balanceAfter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
