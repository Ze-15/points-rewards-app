// 数据库与项目路径的共享配置。
// 若设置了 DATABASE_URL，则使用外部 PostgreSQL；否则使用内置的 embedded-postgres。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录 */
export const ROOT = path.resolve(here, '..');

/** 内置 PostgreSQL 实例的参数 */
export const PG = {
  host: process.env.PGHOST || '127.0.0.1',
  port: Number(process.env.PGPORT || 55432),
  user: process.env.PGUSER || 'app_user',
  password: process.env.PGPASSWORD || 'app_password',
  database: process.env.PGDATABASE || 'points_app',
  dataDir: process.env.PGDATA_DIR || path.join(ROOT, '.pgdata'),
};

/** 业务库连接串 */
export const DATABASE_URL =
  process.env.DATABASE_URL ||
  `postgresql://${PG.user}:${PG.password}@${PG.host}:${PG.port}/${PG.database}`;

/** 用于建库的管理库连接串 */
export const ADMIN_DATABASE_URL = DATABASE_URL.replace(/\/[^/]*$/, '/postgres');

/** 是否使用内置数据库（未显式提供 DATABASE_URL 时） */
export const USING_EMBEDDED = !process.env.DATABASE_URL;
