// 重置数据库：清空业务库中的全部对象，然后重新迁移与播种。
//
// 实现说明：这里刻意不使用 `DROP DATABASE`。
// 在 PostgreSQL 18 上，DROP DATABASE 会等待全局的 proc-signal barrier；
// 若此时有并发或残留的连接，该语句可能长时间挂起并互相阻塞（实测遇到）。
// 改为在目标库内部 `DROP SCHEMA public CASCADE`，语义等价（清空所有对象）
// 但只涉及当前库的锁，快速且可靠。
import pg from 'pg';
import { DATABASE_URL } from './pg-config.mjs';
import { connectWithRetry } from './pg-runtime.mjs';

const log = (msg) => process.stdout.write(`${msg}\n`);

async function main() {
  await connectWithRetry(async () => {
    const client = new pg.Client({
      connectionString: DATABASE_URL,
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    try {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
      log('[reset] 已清空 public schema（所有表与数据）。');
    } finally {
      await client.end();
    }
  });
}

main().catch((err) => {
  process.stderr.write(`[reset] 失败: ${err?.stack || err}\n`);
  process.exit(1);
});
