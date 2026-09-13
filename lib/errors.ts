// 统一的应用错误类型与 API 响应助手。

/** 带有 HTTP 状态码的业务错误 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const unauthorized = (message = '请先登录。') =>
  new AppError(401, 'UNAUTHORIZED', message);

export const notFound = (message = '资源不存在。') => new AppError(404, 'NOT_FOUND', message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError(409, 'CONFLICT', message, details);

/** 余额不足：单独一个 code，便于前端与测试精确识别 */
export const insufficientPoints = (required: number, current: number) =>
  new AppError(400, 'INSUFFICIENT_POINTS', `积分不足：需要 ${required} 积分，当前仅有 ${current} 积分。`, {
    required,
    current,
  });

/** 把任意异常转换为统一的 JSON 响应 */
export function toErrorResponse(err: unknown): {
  status: number;
  body: { error: { code: string; message: string; details?: Record<string, unknown> } };
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message, details: err.details } },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  // 非预期错误：不向客户端泄漏内部细节，但保留在服务端日志中。
  console.error('[api] 未预期错误:', err);
  return {
    status: 500,
    body: { error: { code: 'INTERNAL_ERROR', message: `服务器内部错误：${message}` } },
  };
}
