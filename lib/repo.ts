// 数据访问与核心业务逻辑。
//
// 本文件承载三条硬性要求：
//   1. 同一任务奖励不能重复领取；
//   2. 重复提交兑换不能重复扣分或发货；
//   3. 余额不足 / 商品发放失败需正确处理。
// 具体实现见各函数注释。
import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from './db';
import { badRequest, conflict, insufficientPoints, notFound } from './errors';
import { ONCE_PERIOD_KEY, SIGNUP_BONUS, todayPeriodKey } from './config';
import { generateSalt, hashPassword, verifyPassword } from './auth';
import type {
  ClaimResult,
  LedgerEntry,
  LedgerReason,
  MeView,
  ProductView,
  RedeemResult,
  RedemptionStatus,
  RedemptionView,
  TaskView,
} from './types';

const num = (v: string | number): number => (typeof v === 'string' ? Number(v) : v);

// ---------------------------------------------------------------------------
// 注册与登录
// ---------------------------------------------------------------------------

export type RegisterInput = {
  email: string;
  password: string;
  displayName: string;
};

/** 注册用户，并在同一事务内发放注册赠送积分与流水。 */
export async function registerUser(input: RegisterInput): Promise<number> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw badRequest('邮箱格式不正确。');
  }
  if (input.password.length < 8) {
    throw badRequest('密码至少需要 8 位字符。');
  }
  if (displayName.length === 0 || displayName.length > 40) {
    throw badRequest('昵称长度需在 1-40 个字符之间。');
  }

  const salt = generateSalt();
  const passwordHash = await hashPassword(input.password, salt);

  return withTransaction(async (client) => {
    const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
    if (existing.rowCount && existing.rowCount > 0) {
      throw conflict('该邮箱已被注册。', { email });
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, salt, display_name, points_balance)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [email, passwordHash, salt, displayName, SIGNUP_BONUS],
    );
    const userId = num(inserted.rows[0].id);

    await insertLedger(client, {
      userId,
      delta: SIGNUP_BONUS,
      reason: 'signup_bonus',
      refType: 'user',
      refId: userId,
      note: '注册赠送积分',
      balanceAfter: SIGNUP_BONUS,
    });

    return userId;
  });
}

/** 校验登录凭据，成功返回用户 id */
export async function authenticate(email: string, password: string): Promise<number> {
  const rows = await query<{ id: string; password_hash: string; salt: string }>(
    'SELECT id, password_hash, salt FROM users WHERE email = $1',
    [email.trim().toLowerCase()],
  );

  // 邮箱不存在与口令错误返回同一文案，避免账号枚举。
  if (rows.length === 0) {
    throw badRequest('邮箱或密码不正确。');
  }

  const ok = await verifyPassword(password, rows[0].salt, rows[0].password_hash);
  if (!ok) {
    throw badRequest('邮箱或密码不正确。');
  }
  return num(rows[0].id);
}

// ---------------------------------------------------------------------------
// 积分流水写入
// ---------------------------------------------------------------------------

type LedgerInput = {
  userId: number;
  delta: number;
  reason: LedgerReason;
  refType?: string | null;
  refId?: number | null;
  note?: string | null;
  balanceAfter: number;
};

/** 写入一条积分流水。必须与余额变动处于同一事务。 */
async function insertLedger(client: PoolClient, input: LedgerInput): Promise<void> {
  await client.query(
    `INSERT INTO point_ledger (user_id, delta, reason, ref_type, ref_id, note, balance_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.userId,
      input.delta,
      input.reason,
      input.refType ?? null,
      input.refId ?? null,
      input.note ?? null,
      input.balanceAfter,
    ],
  );
}

// ---------------------------------------------------------------------------
// 当前用户
// ---------------------------------------------------------------------------

export async function getMe(userId: number): Promise<MeView> {
  const rows = await query<{
    email: string;
    display_name: string;
    points_balance: number;
    created_at: Date;
  }>('SELECT email, display_name, points_balance, created_at FROM users WHERE id = $1', [userId]);

  if (rows.length === 0) throw notFound('用户不存在。');
  const r = rows[0];
  return {
    email: r.email,
    displayName: r.display_name,
    pointsBalance: r.points_balance,
    createdAt: r.created_at.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

/** 列出全部启用任务，并标注当前用户在「当前周期」内是否已领取。 */
export async function listTasks(userId: number): Promise<TaskView[]> {
  const today = todayPeriodKey();
  const rows = await query<{
    code: string;
    title: string;
    description: string;
    reward: number;
    period: 'daily' | 'once';
    claimed_at: Date | null;
  }>(
    `SELECT t.code, t.title, t.description, t.reward, t.period,
            tc.created_at AS claimed_at
       FROM tasks t
       LEFT JOIN task_completions tc
         ON tc.task_id = t.id
        AND tc.user_id = $1
        AND tc.period_key = CASE WHEN t.period = 'daily' THEN $2 ELSE $3 END
      WHERE t.active = TRUE
      ORDER BY t.sort_order, t.id`,
    [userId, today, ONCE_PERIOD_KEY],
  );

  return rows.map((r) => ({
    code: r.code,
    title: r.title,
    description: r.description,
    reward: r.reward,
    period: r.period,
    claimed: r.claimed_at !== null,
    claimedAt: r.claimed_at ? r.claimed_at.toISOString() : null,
  }));
}

/**
 * 领取任务奖励。
 *
 * 「不能重复领取」的裁决者是数据库的 UNIQUE(user_id, task_id, period_key)：
 * 用 ON CONFLICT DO NOTHING 尝试插入完成记录，只有真正插入成功
 * （rowCount === 1）时才加积分并写流水。
 * 并发下两个请求必然只有一个能插入成功，因此不可能重复发放。
 */
export async function claimTask(userId: number, taskCode: string): Promise<ClaimResult> {
  const today = todayPeriodKey();

  return withTransaction(async (client) => {
    const taskRes = await client.query<{
      id: string;
      title: string;
      reward: number;
      period: 'daily' | 'once';
    }>(
      `SELECT id, title, reward, period FROM tasks WHERE code = $1 AND active = TRUE`,
      [taskCode],
    );
    if (taskRes.rowCount === 0) throw notFound('任务不存在或已下架。');

    const task = taskRes.rows[0];
    const periodKey = task.period === 'daily' ? today : ONCE_PERIOD_KEY;

    // 关键一步：由唯一约束裁决是否重复领取。
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO task_completions (user_id, task_id, period_key, reward)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, task_id, period_key) DO NOTHING
       RETURNING id`,
      [userId, num(task.id), periodKey, task.reward],
    );

    if (inserted.rowCount === 0) {
      // 本周期已领取过：不加分、不写流水，如实告知。
      const current = await client.query<{ points_balance: number }>(
        'SELECT points_balance FROM users WHERE id = $1',
        [userId],
      );
      return {
        outcome: 'already_claimed',
        message:
          task.period === 'daily'
            ? `今天已经领取过「${task.title}」了，明天再来吧。`
            : `「${task.title}」的奖励只能领取一次，你已经领过了。`,
        reward: 0,
        balance: current.rows[0]?.points_balance ?? 0,
      } satisfies ClaimResult;
    }

    const updated = await client.query<{ points_balance: number }>(
      `UPDATE users SET points_balance = points_balance + $2
        WHERE id = $1
        RETURNING points_balance`,
      [userId, task.reward],
    );
    const balance = updated.rows[0].points_balance;

    await insertLedger(client, {
      userId,
      delta: task.reward,
      reason: 'task_reward',
      refType: 'task',
      refId: num(task.id),
      note: `完成任务：${task.title}`,
      balanceAfter: balance,
    });

    return {
      outcome: 'claimed',
      message: `领取成功，「${task.title}」+${task.reward} 积分。`,
      reward: task.reward,
      balance,
    } satisfies ClaimResult;
  });
}

// ---------------------------------------------------------------------------
// 商品
// ---------------------------------------------------------------------------

export async function listProducts(): Promise<ProductView[]> {
  const rows = await query<{
    code: string;
    name: string;
    description: string;
    price: number;
  }>(
    `SELECT code, name, description, price FROM products
      WHERE active = TRUE ORDER BY sort_order, id`,
  );
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    description: r.description,
    price: r.price,
  }));
}

// ---------------------------------------------------------------------------
// 兑换
// ---------------------------------------------------------------------------

type RedemptionRow = {
  id: string;
  price: number;
  status: RedemptionStatus;
  failure_reason: string | null;
  delivery_payload: unknown;
  created_at: Date;
  updated_at: Date;
  product_code: string;
  product_name: string;
};

function toRedemptionView(r: RedemptionRow): RedemptionView {
  return {
    id: num(r.id),
    productCode: r.product_code,
    productName: r.product_name,
    price: r.price,
    status: r.status,
    failureReason: r.failure_reason,
    deliveryPayload: r.delivery_payload,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

const REDEMPTION_SELECT = `
  SELECT r.id, r.price, r.status, r.failure_reason, r.delivery_payload,
         r.created_at, r.updated_at,
         p.code AS product_code, p.name AS product_name
    FROM redemptions r
    JOIN products p ON p.id = r.product_id`;

/**
 * 按「用户 + 幂等键」查找既有兑换记录。
 *
 * 必须同时按 user_id 过滤：幂等键来自客户端，不同用户完全可能提交相同的键。
 * 若只按键查询，用户 B 就会读到用户 A 的兑换记录与发放凭据（越权读取）。
 */
async function findRedemptionByKey(
  client: PoolClient,
  userId: number,
  idempotencyKey: string,
): Promise<RedemptionView | null> {
  const res = await client.query<RedemptionRow>(
    `${REDEMPTION_SELECT} WHERE r.user_id = $1 AND r.idempotency_key = $2`,
    [userId, idempotencyKey],
  );
  return res.rowCount ? toRedemptionView(res.rows[0]) : null;
}

/**
 * 模拟数字商品发放。
 *
 * 本项目不接入任何真实发放系统（不涉及真实资金与真实商品）。
 * 该函数返回一个虚构的发放凭据；当被要求模拟失败、
 * 或商品已下架时，抛出异常以触发退款补偿流程。
 */
function deliverDigitalGood(params: {
  productCode: string;
  productName: string;
  userId: number;
  simulateFailure: boolean;
}): Record<string, unknown> {
  if (params.simulateFailure) {
    throw new Error('数字商品发放服务返回失败（模拟）。');
  }
  return {
    kind: 'digital_good',
    productCode: params.productCode,
    productName: params.productName,
    // 虚构的发放凭据，不具备任何真实效力。
    licenseKey: `DEMO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`,
    issuedToUserId: params.userId,
    issuedAt: new Date().toISOString(),
  };
}

/**
 * 兑换数字商品。
 *
 * 幂等性由 redemptions.idempotency_key 的 UNIQUE 约束裁决：
 *   1) 先尝试插入一条 pending 记录，若键冲突则说明是重复提交，
 *      直接返回既有记录，绝不再次扣分或发货；
 *   2) 用「条件更新」扣分 ——
 *      UPDATE ... WHERE points_balance >= price
 *      只有余额充足时才会更新成功，否则返回 0 行即余额不足，整个事务回滚，
 *      因此不会留下任何流水或兑换记录，余额也绝不会变成负数；
 *   3) 扣分提交后再执行发货（缩短事务持锁时间）；
 *      发货失败则走补偿：写 refund 反向流水、恢复余额、置为 failed。
 */
export async function redeemProduct(params: {
  userId: number;
  productCode: string;
  idempotencyKey: string;
  simulateFailure?: boolean;
}): Promise<RedeemResult> {
  const { userId, productCode, idempotencyKey } = params;
  const simulateFailure = params.simulateFailure === true;

  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
    throw badRequest('缺少有效的幂等键（Idempotency-Key）。');
  }

  // ---- 第一阶段：扣分并落库（单个事务） ----
  const phase1 = await withTransaction(async (client) => {
    // 快速路径：该（用户，幂等键）已存在，直接返回既有结果。
    const existing = await findRedemptionByKey(client, userId, idempotencyKey);
    if (existing) {
      const bal = await client.query<{ points_balance: number }>(
        'SELECT points_balance FROM users WHERE id = $1',
        [userId],
      );
      return { kind: 'duplicate' as const, redemption: existing, balance: bal.rows[0].points_balance };
    }

    const prodRes = await client.query<{
      id: string;
      code: string;
      name: string;
      price: number;
      active: boolean;
    }>('SELECT id, code, name, price, active FROM products WHERE code = $1', [productCode]);
    if (prodRes.rowCount === 0) throw notFound('商品不存在。');
    const product = prodRes.rows[0];
    if (!product.active) throw badRequest('该商品已下架，无法兑换。');

    // 1) 抢占幂等键。并发重复提交在这里被唯一约束挡住。
    //    冲突目标必须写成复合约束 (user_id, idempotency_key)。
    const claim = await client.query<{ id: string }>(
      `INSERT INTO redemptions (user_id, product_id, price, status, idempotency_key)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING id`,
      [userId, num(product.id), product.price, idempotencyKey],
    );

    if (claim.rowCount === 0) {
      // 另一个并发请求已经用同一个键插入了记录：判定为重复提交。
      const dup = await findRedemptionByKey(client, userId, idempotencyKey);
      const bal = await client.query<{ points_balance: number }>(
        'SELECT points_balance FROM users WHERE id = $1',
        [userId],
      );
      if (!dup) throw conflict('兑换请求正在处理中，请稍后查看兑换记录。');
      return { kind: 'duplicate' as const, redemption: dup, balance: bal.rows[0].points_balance };
    }

    const redemptionId = num(claim.rows[0].id);

    // 2) 条件扣减：余额不足时更新 0 行，事务回滚。
    const deducted = await client.query<{ points_balance: number }>(
      `UPDATE users SET points_balance = points_balance - $2
        WHERE id = $1 AND points_balance >= $2
        RETURNING points_balance`,
      [userId, product.price],
    );

    if (deducted.rowCount === 0) {
      const cur = await client.query<{ points_balance: number }>(
        'SELECT points_balance FROM users WHERE id = $1',
        [userId],
      );
      // 抛出异常以回滚事务：pending 记录一并撤销，不留痕迹。
      throw insufficientPoints(product.price, cur.rows[0]?.points_balance ?? 0);
    }

    const balanceAfterRedeem = deducted.rows[0].points_balance;

    await insertLedger(client, {
      userId,
      delta: -product.price,
      reason: 'redeem',
      refType: 'redemption',
      refId: redemptionId,
      note: `兑换商品：${product.name}`,
      balanceAfter: balanceAfterRedeem,
    });

    return {
      kind: 'proceed' as const,
      redemptionId,
      product,
      balanceAfterRedeem,
    };
  });

  if (phase1.kind === 'duplicate') {
    return {
      outcome: 'duplicate',
      message:
        phase1.redemption.status === 'failed'
          ? '这是一次重复提交，已返回此前的兑换记录（该次发放失败，积分已退回）。'
          : '这是一次重复提交，已返回此前的兑换记录，未重复扣分或发货。',
      redemption: phase1.redemption,
      balance: phase1.balance,
    };
  }

  const { redemptionId, product, balanceAfterRedeem } = phase1;

  // ---- 第二阶段：发放（事务外执行，避免长时间持锁） ----
  let delivered = false;
  let payload: Record<string, unknown> | null = null;
  let failureReason: string | null = null;

  try {
    payload = deliverDigitalGood({
      productCode: product.code,
      productName: product.name,
      userId,
      simulateFailure,
    });
    delivered = true;
  } catch (err) {
    failureReason = err instanceof Error ? err.message : String(err);
  }

  // ---- 第三阶段：落定结果；失败则补偿退款 ----
  const finalView = await withTransaction(async (client) => {
    if (delivered) {
      await client.query(
        `UPDATE redemptions
            SET status = 'delivered', delivery_payload = $2, failure_reason = NULL, updated_at = now()
          WHERE id = $1`,
        [redemptionId, JSON.stringify(payload)],
      );
      const res = await client.query<RedemptionRow>(`${REDEMPTION_SELECT} WHERE r.id = $1`, [
        redemptionId,
      ]);
      return { view: toRedemptionView(res.rows[0]), balance: balanceAfterRedeem };
    }

    // 发放失败：全额退回积分，并写一条 refund 反向流水。
    const locked = await client.query<{ points_balance: number }>(
      'SELECT points_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId],
    );
    const restored = locked.rows[0].points_balance + product.price;

    await client.query('UPDATE users SET points_balance = $2 WHERE id = $1', [userId, restored]);

    await insertLedger(client, {
      userId,
      delta: product.price,
      reason: 'refund',
      refType: 'redemption',
      refId: redemptionId,
      note: `发放失败退款：${product.name}`,
      balanceAfter: restored,
    });

    await client.query(
      `UPDATE redemptions
          SET status = 'failed', failure_reason = $2, updated_at = now()
        WHERE id = $1`,
      [redemptionId, failureReason],
    );

    const res = await client.query<RedemptionRow>(`${REDEMPTION_SELECT} WHERE r.id = $1`, [
      redemptionId,
    ]);
    return { view: toRedemptionView(res.rows[0]), balance: restored };
  });

  if (delivered) {
    return {
      outcome: 'delivered',
      message: `兑换成功，「${product.name}」已发放到你的账户。`,
      redemption: finalView.view,
      balance: finalView.balance,
    };
  }

  return {
    outcome: 'failed',
    message: `兑换失败：数字商品发放未成功，已全额退回 ${product.price} 积分。`,
    redemption: finalView.view,
    balance: finalView.balance,
  };
}

// ---------------------------------------------------------------------------
// 兑换记录 / 积分流水
// ---------------------------------------------------------------------------

export async function listRedemptions(userId: number, limit = 50): Promise<RedemptionView[]> {
  const rows = await query<RedemptionRow>(
    `${REDEMPTION_SELECT} WHERE r.user_id = $1 ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map(toRedemptionView);
}

export async function listLedger(userId: number, limit = 100): Promise<LedgerEntry[]> {
  const rows = await query<{
    id: string;
    delta: number;
    reason: LedgerReason;
    note: string | null;
    balance_after: number;
    created_at: Date;
  }>(
    `SELECT id, delta, reason, note, balance_after, created_at
       FROM point_ledger WHERE user_id = $1
      ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: num(r.id),
    delta: r.delta,
    reason: r.reason,
    note: r.note,
    balanceAfter: r.balance_after,
    createdAt: r.created_at.toISOString(),
  }));
}
