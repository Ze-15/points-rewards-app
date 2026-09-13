// 账实一致性校验：核对每个用户的 users.points_balance 是否等于流水累计值。
//
// 本应用有两份余额数据：
//   1) users.points_balance —— 当前余额（事务内同步维护）；
//   2) point_ledger         —— append-only 事实表，含 balance_after 快照。
// 本脚本验证两者一致，并可发现任何绕过流水直接改余额的路径。
import pg from 'pg';
import { DATABASE_URL } from './pg-config.mjs';

const log = (msg) => process.stdout.write(`${msg}\n`);
const client = new pg.Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();

  // 1) 当前余额 vs 流水累计
  const mismatch = await client.query(`
    SELECT u.id, u.email, u.points_balance AS actual, COALESCE(SUM(l.delta), 0)::int AS expected
      FROM users u
      LEFT JOIN point_ledger l ON l.user_id = u.id
     GROUP BY u.id, u.email, u.points_balance
    HAVING u.points_balance <> COALESCE(SUM(l.delta), 0)
  `);

  // 2) 每条流水的 balance_after 是否等于该用户截至该笔的累计值
  const snapshotBad = await client.query(`
    SELECT id, user_id, balance_after, running
      FROM (
        SELECT id, user_id, balance_after,
               SUM(delta) OVER (PARTITION BY user_id ORDER BY created_at, id)::int AS running
          FROM point_ledger
      ) t
     WHERE balance_after <> running
  `);

  // 3) 余额为负（应由 CHECK 约束杜绝）
  const negative = await client.query('SELECT id, email, points_balance FROM users WHERE points_balance < 0');

  // 4) 每用户流水与兑换/任务记录条数概览
  const summary = await client.query(`
    SELECT u.email,
           u.points_balance,
           (SELECT COUNT(*) FROM point_ledger l WHERE l.user_id = u.id) AS ledger_rows,
           (SELECT COUNT(*) FROM redemptions r WHERE r.user_id = u.id) AS redemptions,
           (SELECT COUNT(*) FROM task_completions tc WHERE tc.user_id = u.id) AS completions
      FROM users u ORDER BY u.id
  `);

  log('用户概览:');
  for (const r of summary.rows) {
    log(
      `  ${r.email} | 余额 ${r.points_balance} | 流水 ${r.ledger_rows} | 兑换 ${r.redemptions} | 任务 ${r.completions}`,
    );
  }

  let failed = false;
  if (mismatch.rowCount > 0) {
    failed = true;
    log('\n✗ 余额与流水累计不一致:');
    for (const r of mismatch.rows) {
      log(`  ${r.email}: 余额=${r.actual} 流水累计=${r.expected}`);
    }
  }
  if (snapshotBad.rowCount > 0) {
    failed = true;
    log('\n✗ 存在 balance_after 快照错误的流水:');
    for (const r of snapshotBad.rows) {
      log(`  流水#${r.id} 用户#${r.user_id}: 快照=${r.balance_after} 实际累计=${r.running}`);
    }
  }
  if (negative.rowCount > 0) {
    failed = true;
    log('\n✗ 存在负数余额:');
    for (const r of negative.rows) log(`  ${r.email}: ${r.points_balance}`);
  }

  await client.end();

  if (failed) {
    log('\n[check:balances] 校验未通过。');
    process.exit(1);
  }
  log('\n[check:balances] 校验通过：余额与流水完全一致，无负数余额。');
}

main().catch(async (err) => {
  process.stderr.write(`[check:balances] 失败: ${err?.message || err}\n`);
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
