// 生产模式启动：使用构建产物运行 Next.js（同样采用 Custom Server 模式）。
// 使用前需先执行 `npm run build`。
import path from 'node:path';
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

async function main() {
  let weStartedDb = false;

  if (await probe(PG.host, PG.port)) {
    log(`[start] 检测到已有 PostgreSQL 在 ${PG.host}:${PG.port}，直接复用。`);
  } else {
    await ensureInitialised(log);
    await startPostgres(log);
    weStartedDb = true;
  }
  await waitForReady();
  await ensureDatabase(log);

  const next = (await import('next')).default;
  const app = next({ dev: false, dir: ROOT });
  await app.prepare();

  const { createServer } = await import('node:http');
  const handle = app.getRequestHandler();
  const server = createServer((req, res) => handle(req, res));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(APP_PORT, resolve);
  });

  log(`[start] 应用已就绪: http://127.0.0.1:${APP_PORT}`);

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    if (weStartedDb) await stopPostgres(log);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[start] 启动失败: ${err?.stack || err}\n`);
  process.exit(1);
});
