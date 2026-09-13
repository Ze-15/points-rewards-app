// 启动内置 PostgreSQL 实例（常驻进程）。
// 数据目录默认位于 <项目根>/.pgdata，进程退出后数据仍然保留。
import { PG } from './pg-config.mjs';
import {
  probe,
  waitForReady,
  ensureInitialised,
  startPostgres,
  stopPostgres,
  ensureDatabase,
} from './pg-runtime.mjs';

const log = (msg) => process.stdout.write(`${msg}\n`);

async function main() {
  // 端口已被占用时，认为数据库已由其它进程提供，直接复用。
  if (await probe(PG.host, PG.port)) {
    log(`[db] 端口 ${PG.host}:${PG.port} 已有 PostgreSQL 在运行，直接复用。`);
    await waitForReady();
    await ensureDatabase(log);
    log(`[db] 就绪: ${PG.database} @ ${PG.host}:${PG.port}`);
    log('DB_READY');
    keepAlive();
    return;
  }

  await ensureInitialised(log);
  log(`[db] 启动 PostgreSQL (端口 ${PG.port}) ...`);
  await startPostgres(log);

  await waitForReady();

  await ensureDatabase(log);
  log(`[db] 就绪: ${PG.database} @ ${PG.host}:${PG.port}`);
  log('DB_READY');

  const shutdown = async () => {
    log('[db] 正在关闭 PostgreSQL ...');
    await stopPostgres(log);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  keepAlive();
}

function keepAlive() {
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  process.stderr.write(`[db] 启动失败: ${err?.stack || err}\n`);
  process.exit(1);
});
