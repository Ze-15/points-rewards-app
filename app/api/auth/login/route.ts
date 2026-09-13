import { apiHandler } from '@/lib/api';
import { createSession, setSessionCookie } from '@/lib/auth';
import { badRequest } from '@/lib/errors';
import { authenticate, getMe } from '@/lib/repo';

export async function POST(request: Request) {
  return apiHandler(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('请求体必须是合法的 JSON。');
    }

    const { email, password } = (body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw badRequest('请提供 email 与 password。');
    }

    const userId = await authenticate(email, password);
    const token = await createSession(userId);
    await setSessionCookie(token);

    const me = await getMe(userId);
    return { message: '登录成功。', user: me };
  });
}
