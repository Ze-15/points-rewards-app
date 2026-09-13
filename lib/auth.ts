// 鉴权：口令哈希与会话管理。
//
// 刻意不引入第三方鉴权库：
//   - 口令用 node:crypto 的 scrypt + 每用户随机盐，比对用 timingSafeEqual 防时序侧信道；
//   - 会话是 sessions 表中的一行随机 token，通过 httpOnly Cookie 传递。
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { query } from './db';
import { SESSION_COOKIE, SESSION_TTL_DAYS } from './config';
import { unauthorized } from './errors';

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

/** 生成随机盐 */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** 计算口令哈希 */
export async function hashPassword(password: string, salt: string): Promise<string> {
  const derived = await scrypt(password, salt, KEY_LEN);
  return derived.toString('hex');
}

/** 恒定时间比对口令 */
export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const derived = await scrypt(password, salt, KEY_LEN);
  const expected = Buffer.from(expectedHash, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export type SessionUser = {
  id: number;
  email: string;
  displayName: string;
  pointsBalance: number;
  createdAt: string;
};

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  points_balance: number;
  created_at: Date;
};

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: Number(row.id),
    email: row.email,
    displayName: row.display_name,
    pointsBalance: row.points_balance,
    createdAt: row.created_at.toISOString(),
  };
}

/** 创建会话并返回 token */
export async function createSession(userId: number): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
    token,
    userId,
    expiresAt,
  ]);
  return token;
}

/** 写入会话 Cookie */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
  });
}

/** 清除会话 Cookie */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** 根据 token 读取用户；token 无效或过期返回 null */
export async function getUserByToken(token: string): Promise<SessionUser | null> {
  const rows = await query<UserRow>(
    `SELECT u.id, u.email, u.display_name, u.points_balance, u.created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows.length ? toSessionUser(rows[0]) : null;
}

/** 读取当前登录用户；未登录返回 null */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token);
}

/** 读取当前登录用户；未登录则抛出 401 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  return user;
}

/** 删除会话（登出） */
export async function destroySession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token = $1', [token]);
}
