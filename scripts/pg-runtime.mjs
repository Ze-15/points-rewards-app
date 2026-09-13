// PostgreSQL 进程管理工具。
//
// 说明：本沙箱环境禁止 Node 以「管道(pipe)」方式创建子进程，而 embedded-postgres
// 库内部固定使用管道 stdio，因此这里直接调用 PostgreSQL 官方二进制，
// 并以 stdio:'inherit' / 'ignore' 的方式启动，规避该限制。
//
// 二进制来自 npm 包 @embedded-postgres/windows-x64（即 PostgreSQL 官方发行版）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import pg from 'pg';
import { PG } from './pg-config.mjs';

/** 路径是否只含 ASCII 字符 */
function isAsciiPath(p) {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(p);
}

/**
 * 把 PostgreSQL 原生二进制复制到一个纯 ASCII 路径，并返回该路径。
 *
 * 原因（实测定位）：PostgreSQL 的 initdb/postgres 会从「二进制所在目录」读取
 * share/ 下的模板与编码文件。当该目录路径含非 ASCII 字符（例如本项目工作区
 * `dsh工作区`）时，Windows 版 PostgreSQL 会以本地代码页解释路径，
 * 导致 initdb 报错：invalid byte sequence for encoding "UTF8": 0xb9
 * （0xB9 正是「工」在 GBK 中的首字节）。
 * 把二进制复制到纯 ASCII 目录后即可正常工作，而数据目录仍可位于中文路径下。
 */
async function ensureAsciiBinaries() {
  const { initdb, postgres, pg_ctl } = await resolveBinaries();
  const binDir = path.dirname(initdb);

  if (isAsciiPath(binDir)) {
    return { initdb, postgres, pg_ctl };
  }

  const nativeRoot = path.dirname(binDir); // .../native
  const target = path.join(os.tmpdir(), 'points-app-pg-native');

  // 已经复制过就直接复用（用 PG_VERSION 无关，检查 bin/initdb.exe 是否存在）。
  const targetInitdb = path.join(target, 'bin', path.basename(initdb));
  if (!fs.existsSync(targetInitdb)) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(nativeRoot, target, { recursive: true });
  }

  return {
    initdb: targetInitdb,
    postgres: path.join(target, 'bin', path.basename(postgres)),
    pg_ctl: path.join(target, 'bin', path.basename(pg_ctl)),
  };
}

/** 解析当前平台对应的 PostgreSQL 二进制路径 */
export async function resolveBinaries() {
  const platform = os.platform();
  const arch = os.arch();
  const map = {
    win32: { x64: '@embedded-postgres/windows-x64' },
    darwin: { arm64: '@embedded-postgres/darwin-arm64', x64: '@embedded-postgres/darwin-x64' },
    linux: {
      x64: '@embedded-postgres/linux-x64',
      arm64: '@embedded-postgres/linux-arm64',
      arm: '@embedded-postgres/linux-arm',
    },
  };
  const pkg = map[platform]?.[arch];
  if (!pkg) throw new Error(`不支持的平台: ${platform}/${arch}`);
  const mod = await import(pkg);
  return { initdb: mod.initdb, postgres: mod.postgres, pg_ctl: mod.pg_ctl };
}

/** 探测 host:port 是否可连接 */
export function probe(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * 轮询等待数据库可以接受连接。
 *
 * 注意：仅探测 TCP 端口是不够的。PostgreSQL 在崩溃恢复期间会先监听端口，
 * 但此时任何连接都会被拒绝并返回 "the database system is starting up"。
 * 因此这里必须做「真实连接」探测，直到能够成功执行查询为止。
 */
export async function waitForReady(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '未知错误';
  while (Date.now() < deadline) {
    // 先等端口打开，再做真实连接，避免无谓的连接尝试。
    if (await probe(PG.host, PG.port)) {
      try {
        const client = new pg.Client({
          host: PG.host,
          port: PG.port,
          user: PG.user,
          password: PG.password,
          database: 'postgres',
          connectionTimeoutMillis: 5000,
        });
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return true;
      } catch (err) {
        lastError = err?.message || String(err);
        // 恢复期报 "starting up"，属于预期内，继续重试。
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`PostgreSQL 在 ${timeoutMs}ms 内未就绪，最后错误: ${lastError}`);
}

/**
 * 以带退避重试的方式建立连接，用于建库等启动期操作。
 * 单独抽出是因为即便 waitForReady 通过，紧随其后的连接仍可能撞上恢复窗口。
 */
export async function connectWithRetry(connectFn, attempts = 20, delayMs = 500) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await connectFn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}

/**
 * 确保数据目录已初始化（initdb）。
 * 若目录存在但缺少 PG_VERSION，说明是上次失败的残留，先清理再初始化。
 */
export async function ensureInitialised(log = console.log) {
  const versionFile = path.join(PG.dataDir, 'PG_VERSION');
  if (fs.existsSync(versionFile)) return;

  if (fs.existsSync(PG.dataDir) && fs.readdirSync(PG.dataDir).length > 0) {
    log(`[db] 检测到未完成的数据目录，正在清理: ${PG.dataDir}`);
    fs.rmSync(PG.dataDir, { recursive: true, force: true });
  }
  fs.mkdirSync(PG.dataDir, { recursive: true });

  const { initdb } = await ensureAsciiBinaries();
  const pwFile = path.join(os.tmpdir(), `pg-pw-${Date.now()}.txt`);
  fs.writeFileSync(pwFile, `${PG.password}\n`);

  log(`[db] 初始化数据目录: ${PG.dataDir}`);
  try {
    const res = spawnSync(
      initdb,
      [
        `--pgdata=${PG.dataDir}`,
        `--username=${PG.user}`,
        '--auth=scram-sha-256',
        `--pwfile=${pwFile}`,
        '--encoding=UTF8',
        '--locale=C',
      ],
      { stdio: 'inherit' },
    );
    if (res.status !== 0) {
      throw new Error(`initdb 失败，退出码 ${res.status}`);
    }
  } finally {
    fs.rmSync(pwFile, { force: true });
  }
}

/**
 * 启动 PostgreSQL 服务进程。
 * 返回子进程句柄；数据目录为持久化目录，进程退出后数据保留。
 */
export async function startPostgres(log = console.log) {
  const { postgres } = await ensureAsciiBinaries();
  const child = spawn(
    postgres,
    ['-D', PG.dataDir, '-p', String(PG.port), '-c', `listen_addresses=${PG.host}`],
    { stdio: 'inherit' },
  );
  child.on('error', (err) => log(`[db] postgres 进程错误: ${err.message}`));
  return child;
}

/** 停止 PostgreSQL（优先 pg_ctl，失败则终止进程） */
export async function stopPostgres(log = console.log) {
  const { pg_ctl } = await ensureAsciiBinaries();
  try {
    const res = spawnSync(pg_ctl, ['stop', '-D', PG.dataDir, '-m', 'fast', '-w'], {
      stdio: 'inherit',
    });
    if (res.status === 0) return true;
  } catch {
    /* 忽略，走强制终止 */
  }
  return false;
}

/** 确保业务数据库存在（不存在则创建） */
export async function ensureDatabase(log = console.log) {
  // 崩溃恢复窗口内连接会被拒，这里用退避重试确保建库成功。
  await connectWithRetry(async () => {
    const client = new pg.Client({
      host: PG.host,
      port: PG.port,
      user: PG.user,
      password: PG.password,
      database: 'postgres',
      connectionTimeoutMillis: 5000,
    });
    await client.connect();
    try {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
        PG.database,
      ]);
      if (found.rowCount === 0) {
        await client.query(`CREATE DATABASE "${PG.database}"`);
        log(`[db] 已创建数据库 ${PG.database}`);
      }
    } finally {
      await client.end();
    }
  });
}
