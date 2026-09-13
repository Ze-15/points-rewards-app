// 数据库结构自检：确认关键表、唯一约束与 CHECK 约束确实存在。
import pg from 'pg';
import { DATABASE_URL } from './pg-config.mjs';

const c = new pg.Client({ connectionString: DATABASE_URL });

const EXPECTED_TABLES = [
  'point_ledger',
  'products',
  'redemptions',
  'schema_migrations',
  'sessions',
  'task_completions',
  'tasks',
  'users',
];

const EXPECTED_UNIQUE = [
  'task_completions_unique',
  // 幂等键的唯一约束限定在「用户维度」，防止跨用户越权读取他人兑换记录。
  'redemptions_user_idempotency_unique',
];

async function main() {
  await c.connect();

  const t = await c.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const tables = t.rows.map((r) => r.tablename);
  console.log('表:', tables.join(', '));

  const missing = EXPECTED_TABLES.filter((x) => !tables.includes(x));
  if (missing.length) throw new Error(`缺少表: ${missing.join(', ')}`);

  const u = await c.query("SELECT conname FROM pg_constraint WHERE contype = 'u' ORDER BY conname");
  const uniques = u.rows.map((r) => r.conname);
  console.log('唯一约束:', uniques.join(', '));
  for (const name of EXPECTED_UNIQUE) {
    if (!uniques.includes(name)) throw new Error(`缺少唯一约束: ${name}`);
  }

  const ck = await c.query(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE contype = 'c'",
  );
  const balanceCheck = ck.rows.find((r) => r.def.includes('points_balance >= 0'));
  if (!balanceCheck) throw new Error('缺少 points_balance >= 0 的 CHECK 约束');
  console.log('余额非负约束:', balanceCheck.conname, '=>', balanceCheck.def);

  const tasks = await c.query('SELECT code, reward, period FROM tasks ORDER BY sort_order');
  console.log('任务:', tasks.rows.map((r) => `${r.code}(+${r.reward},${r.period})`).join(', '));

  const prods = await c.query('SELECT code, price FROM products ORDER BY sort_order');
  console.log('商品:', prods.rows.map((r) => `${r.code}(${r.price})`).join(', '));

  await c.end();
  console.log('[schema] 结构自检通过。');
}

main().catch(async (err) => {
  process.stderr.write(`[schema] 失败: ${err?.message || err}\n`);
  try {
    await c.end();
  } catch {}
  process.exit(1);
});
