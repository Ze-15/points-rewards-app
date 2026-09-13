'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '@/components/Nav';
import { ApiError, apiFetch, newIdempotencyKey } from '@/lib/client';
import type { ClaimResult, MeView, ProductView, RedeemResult, TaskView } from '@/lib/types';

type MeResponse = {
  me: MeView;
  tasks: TaskView[];
  products: ProductView[];
};

type Notice = { kind: 'ok' | 'warn' | 'err' | 'info'; text: string };

export default function DashboardPage() {
  const router = useRouter();
  const [me, setMe] = useState<MeView | null>(null);
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [products, setProducts] = useState<ProductView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // 演示开关：勾选后兑换会走「发放失败 → 全额退款」的补偿路径。
  const [simulateFailure, setSimulateFailure] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<MeResponse>('/api/me');
      setMe(data.me);
      setTasks(data.tasks);
      setProducts(data.products);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login');
        return;
      }
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : '加载失败。' });
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(code: string) {
    setBusy(`task:${code}`);
    setNotice(null);
    try {
      const res = await apiFetch<ClaimResult>('/api/tasks/claim', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      // already_claimed 是正常业务结果，用提示色而非错误色。
      setNotice({ kind: res.outcome === 'claimed' ? 'ok' : 'warn', text: res.message });
      await load();
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : '领取失败。' });
    } finally {
      setBusy(null);
    }
  }

  async function redeem(product: ProductView) {
    setBusy(`product:${product.code}`);
    setNotice(null);
    // 每次点击生成一个新的幂等键。若用户重复点击同一意图，
    // 下面通过禁用按钮避免并发；网络重试时复用同一个键即可去重。
    const key = newIdempotencyKey();
    try {
      const res = await apiFetch<RedeemResult>('/api/redemptions', {
        method: 'POST',
        headers: { 'Idempotency-Key': key },
        body: JSON.stringify({ productCode: product.code, simulateDeliveryFailure: simulateFailure }),
      });
      setNotice({
        kind: res.outcome === 'delivered' ? 'ok' : res.outcome === 'duplicate' ? 'info' : 'warn',
        text: res.message,
      });
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INSUFFICIENT_POINTS') {
        const d = err.details as { required?: number; current?: number } | undefined;
        setNotice({
          kind: 'err',
          text: `${err.message}（本次未扣分、未发货）`,
        });
        void d;
      } else {
        setNotice({ kind: 'err', text: err instanceof Error ? err.message : '兑换失败。' });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <div className="loading">加载中…</div>;
  if (!me) return null;

  return (
    <>
      <Nav />

      {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

      <section className="card balance-card">
        <div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            当前积分余额 · {me.displayName}（{me.email}）
          </div>
          <div className="balance-value">
            {me.pointsBalance}
            <span className="balance-unit">积分</span>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 12.5, maxWidth: 300 }}>
          积分为虚构数据，仅用于演示。完成任务可获得积分，积分可兑换数字商品。
        </div>
      </section>

      <section className="card">
        <h2>任务列表</h2>
        <p className="card-sub">
          每日任务每天可领取一次；一次性任务仅能领取一次。重复领取不会重复加分。
        </p>
        <div className="grid">
          {tasks.map((t) => (
            <div className="item" key={t.code}>
              <div className="item-title">
                {t.title}
                <span className={`tag ${t.period}`}>
                  {t.period === 'daily' ? '每日一次' : '仅限一次'}
                </span>
                {t.claimed && <span className="tag done">本周期已领取</span>}
              </div>
              <div className="item-desc">{t.description}</div>
              <div className="item-foot">
                <span className="positive">+{t.reward} 积分</span>
                <button
                  type="button"
                  disabled={t.claimed || busy === `task:${t.code}`}
                  onClick={() => claim(t.code)}
                >
                  {t.claimed ? '已领取' : busy === `task:${t.code}` ? '领取中…' : '领取奖励'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>数字商品兑换</h2>
        <p className="card-sub">
          兑换会立即扣除积分并发放数字商品；若发放失败，积分将全额退回。
        </p>
        <label className="row" style={{ marginBottom: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            style={{ width: 'auto' }}
            checked={simulateFailure}
            onChange={(e) => setSimulateFailure(e.target.checked)}
          />
          <span className="muted" style={{ fontSize: 12.5 }}>
            演示：模拟商品发放失败（用于验证「失败后全额退款」）
          </span>
        </label>
        <div className="grid">
          {products.map((p) => {
            const affordable = me.pointsBalance >= p.price;
            return (
              <div className="item" key={p.code}>
                <div className="item-title">{p.name}</div>
                <div className="item-desc">{p.description}</div>
                <div className="item-foot">
                  <span className="price">{p.price} 积分</span>
                  <button
                    type="button"
                    className={affordable ? '' : 'secondary'}
                    disabled={busy === `product:${p.code}`}
                    onClick={() => redeem(p)}
                  >
                    {busy === `product:${p.code}`
                      ? '处理中…'
                      : affordable
                        ? '立即兑换'
                        : '积分不足'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
