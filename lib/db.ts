// 数据库访问层：连接池与事务助手。
//
// 本项目刻意使用原生 SQL 而非 ORM：核心正确性依赖
// 「唯一约束冲突」「条件更新」「行锁」这些数据库语义，
// 用原生 SQL 表达最为显式、也最便于验证。
import { Pool, type PoolClient } from 'pg';
import { DATABASE_URL } from './config';

// 开发模式下 Next.js 会热重载模块，用 globalThis 缓存连接池避免泄漏。
const globalForPool = globalThis as unknown as { __pointsAppPool?: Pool };

export const pool: Pool =
  globalForPool.__pointsAppPool ??
  new Pool({
    connectionString: DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPool.__pointsAppPool = pool;
}

/**
 * 在单个事务中执行回调。
 * 回调抛出异常时自动 ROLLBACK，正常返回则 COMMIT。
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // 回滚失败通常意味着连接已断开，忽略即可，原始异常更重要。
    }
    throw err;
  } finally {
    client.release();
  }
}

/** 简单查询助手（无事务） */
export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}
