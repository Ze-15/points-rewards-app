// 迁移执行器：按文件名顺序执行 migrations/*.sql，并记录已应用的迁移。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { DATABASE_URL, ROOT } from './pg-config.mjs';
import { connectWithRetry } from './pg-runtime.mjs';

const log = (msg) => process.stdout.write(`${msg}\n`);
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

async function main() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    log('[migrate] 没有找到迁移文件。');
    return;
  }

  await connectWithRetry(async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          name       TEXT PRIMARY KEY,
          checksum   TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);

      for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
        const checksum = crypto.createHash('sha256').update(sql).digest('hex');

        const existing = await client.query(
          'SELECT checksum FROM schema_migrations WHERE name = $1',
          [file],
        );

        if (existing.rowCount > 0) {
          if (existing.rows[0].checksum !== checksum) {
            throw new Error(
              `[migrate] 迁移 ${file} 内容已变更但已被应用过。请执行 npm run db:reset 重建数据库。`,
            );
          }
          log(`[migrate] 跳过（已应用）: ${file}`);
          continue;
        }

        log(`[migrate] 应用: ${file}`);
        // 迁移文件自带 BEGIN/COMMIT；这里不再额外包裹事务。
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [file, checksum],
        );
      }
      log('[migrate] 完成。');
    } finally {
      await client.end();
    }
  });
}

main().catch((err) => {
  process.stderr.write(`[migrate] 失败: ${err?.stack || err}\n`);
  process.exit(1);
});
