'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '@/components/Nav';
import { ApiError, apiFetch, formatTime, statusLabel } from '@/lib/client';
import type { MeView, RedemptionView } from '@/lib/types';

type MeResponse = { me: MeView };

export default function RedemptionsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeView | null>(null);
  const [items, setItems] = useState<RedemptionView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [meData, redData] = await Promise.all([
        apiFetch<MeResponse>('/api/me'),
        apiFetch<{ redemptions: RedemptionView[] }>('/api/redemptions'),
      ]);
      setMe(meData.me);
      setItems(redData.redemptions);
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

  return (
    <>
      <Nav />
      {error && <div className="notice err">{error}</div>}

      <section className="card">
        <h2>兑换记录</h2>
        <p className="card-sub">
          当前余额 {me.pointsBalance} 积分。发放失败的商品已自动全额退回积分，退款会同时出现在收支明细中。
        </p>
        {items.length === 0 ? (
          <div className="empty">还没有兑换记录，去仪表盘看看吧。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>商品</th>
                <th>状态</th>
                <th className="num">消耗积分</th>
                <th>发放结果</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="muted mono">{formatTime(r.createdAt)}</td>
                  <td>{r.productName}</td>
                  <td>
                    <span className={`tag ${r.status}`}>{statusLabel(r.status)}</span>
                  </td>
                  <td className="num">{r.price}</td>
                  <td className="muted mono">
                    {r.status === 'delivered' && r.deliveryPayload
                      ? `已发放 · ${String((r.deliveryPayload as { licenseKey?: string }).licenseKey ?? '')}`
                      : r.status === 'failed'
                        ? `${r.failureReason ?? '发放失败'}（已退款 ${r.price} 积分）`
                        : '处理中'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
