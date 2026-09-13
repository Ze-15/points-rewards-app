// 服务端共享配置。
// 默认值与 scripts/pg-config.mjs 保持一致（内置 PostgreSQL 实例）。
// 如需使用外部数据库，设置环境变量 DATABASE_URL 即可覆盖。

export const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://app_user:app_password@127.0.0.1:55432/points_app';

/** 注册赠送的虚拟积分 */
export const SIGNUP_BONUS = 100;

/** 会话有效期（天） */
export const SESSION_TTL_DAYS = 30;

/** 会话 Cookie 名称 */
export const SESSION_COOKIE = 'session_token';

/**
 * 是否允许请求方显式触发「模拟发货失败」。
 * 本项目没有真实的数字商品发放系统，该开关仅用于演示并验证
 * 「发放失败 → 全额退款」这条补偿路径，默认开启。
 */
export const ALLOW_SIMULATED_DELIVERY_FAILURE =
  process.env.ALLOW_SIMULATED_DELIVERY_FAILURE !== 'false';

/** 一次性任务的 period_key 固定值 */
export const ONCE_PERIOD_KEY = 'once';

/** 计算每日任务的 period_key（本地日期 YYYY-MM-DD） */
export function todayPeriodKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
