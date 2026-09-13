// 一条命令启动整个应用：内置 PostgreSQL → 迁移 → 播种 → Next.js 应用服务器。
//
// 为什么用 Next.js 的 Custom Server 模式而不是 `next dev` CLI：
// 本沙箱环境禁止 Node 以「管道(pipe)」方式创建子进程（spawn EPERM），
// 而 `next dev` CLI 会 fork 一个子进程来运行开发服务器。
// Custom Server 在当前进程内直接创建 HTTP 服务器，规避该限制。
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PG, ROOT } from './pg-config.mjs';
import {
  probe,
  waitForReady,
  ensureInitialised,
  startPostgres,
  stopPostgres,
  ensureDatabase,
} from './pg-runtime.mjs';

const log = (msg) => process.stdout.write(`${msg}\n`);
const here = path.dirname(fileURLToPath(import.meta.url));

const APP_PORT = Number(process.env.PORT || 3000);

/** 以子进程运行一个脚本（stdio 继承，不使用管道） */
function runScript(relPath, label) {
  log(`\n[dev] ${label} ...`);
  const res = spawnSync(process.execPath, [path.join(here, relPath)], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`${label} 失败（退出码 ${res.status}）`);
  }
}

async function main() {
  // ---- 1. 数据库 ----
  let weStartedDb = false;

  if (await probe(PG.host, PG.port)) {
    log(`[dev] 检测到已有 PostgreSQL 在 ${PG.host}:${PG.port}，直接复用。`);
  } else {
    await ensureInitialised(log);
    log(`[dev] 启动 PostgreSQL (端口 ${PG.port}) ...`);
    await startPostgres(log);
    weStartedDb = true;
  }

  await waitForReady();
  await ensureDatabase(log);

  // ---- 2. 迁移与播种 ----
  runScript('migrate.mjs', '执行数据库迁移');
  runScript('seed.mjs', '写入任务与商品数据');

  // ---- 3. Next.js 应用服务器（进程内） ----
  log(`\n[dev] 启动 Next.js 应用服务器 (端口 ${APP_PORT}) ...`);

  const next = (await import('next')).default;
  const app = next({ dev: true, dir: ROOT });
  await app.prepare();

  const { createServer } = await import('node:http');
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => handle(req, res));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(APP_PORT, resolve);
  });

  const url = `http://127.0.0.1:${APP_PORT}`;
  log(`\n${'='.repeat(60)}`);
  log(`  应用已就绪: ${url}`);
  log(`  数据库: ${PG.database} @ ${PG.host}:${PG.port}`);
  log(`  数据目录: ${PG.dataDir}（持久化，重启后数据仍在）`);
  log(`${'='.repeat(60)}\n`);

  // ---- 4. 优雅关闭 ----
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('\n[dev] 正在关闭 ...');
    await new Promise((resolve) => server.close(resolve));
    if (weStartedDb) {
      await stopPostgres(log);
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[dev] 启动失败: ${err?.stack || err}\n`);
  process.exit(1);
});
