// 浏览器端 API 调用助手。
import type { ApiErrorBody } from './types';

/** 携带业务错误码的异常，便于页面区分「余额不足」「重复提交」等情况。 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 请求超时时间：避免请求挂起时页面无限停留在「加载中…」 */
const DEFAULT_TIMEOUT_MS = 15000;

/** 发起请求并解析统一响应格式；失败时抛出 ApiError。 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
  } catch (err) {
    // 区分「超时/中断」与其它网络错误，给出可操作的提示。
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError(
        0,
        'TIMEOUT',
        `请求超时（${DEFAULT_TIMEOUT_MS / 1000} 秒）。请确认应用正在运行（npm run dev）。`,
      );
    }
    throw new ApiError(0, 'NETWORK_ERROR', '网络请求失败，请确认应用正在运行（npm run dev）。');
  } finally {
    clearTimeout(timer);
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const errBody = body as ApiErrorBody | null;
    const err = errBody?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'UNKNOWN',
      err?.message ?? `请求失败（HTTP ${res.status}）`,
      err?.details,
    );
  }

  return body as T;
}

/** 生成一个幂等键，用于兑换请求的去重。 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `key-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** 格式化时间 */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 积分变动原因的中文标签 */
export function reasonLabel(reason: string): string {
  switch (reason) {
    case 'signup_bonus':
      return '注册赠送';
    case 'task_reward':
      return '任务奖励';
    case 'redeem':
      return '兑换支出';
    case 'refund':
      return '退款返还';
    default:
      return reason;
  }
}

/** 兑换状态的中文标签 */
export function statusLabel(status: string): string {
  switch (status) {
    case 'delivered':
      return '已发放';
    case 'failed':
      return '发放失败（已退款）';
    case 'pending':
      return '处理中';
    default:
      return status;
  }
}
