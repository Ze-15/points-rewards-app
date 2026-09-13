// API 路由的统一包装：把业务异常转换为标准 JSON 错误响应。
import { NextResponse } from 'next/server';
import { toErrorResponse } from './errors';

export async function apiHandler<T>(fn: () => Promise<T>, successStatus = 200): Promise<NextResponse> {
  try {
    const data = await fn();
    return NextResponse.json(data as unknown as Record<string, unknown>, { status: successStatus });
  } catch (err) {
    const { status, body } = toErrorResponse(err);
    return NextResponse.json(body, { status });
  }
}
