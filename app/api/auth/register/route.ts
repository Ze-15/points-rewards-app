import { apiHandler } from '@/lib/api';
import { createSession, setSessionCookie } from '@/lib/auth';
import { badRequest } from '@/lib/errors';
import { getMe, registerUser } from '@/lib/repo';

export async function POST(request: Request) {
  return apiHandler(async () => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('请求体必须是合法的 JSON。');
    }

    const { email, password, displayName } = (body ?? {}) as Record<string, unknown>;
    if (typeof email !== 'string' || typeof password !== 'string' || typeof displayName !== 'string') {
      throw badRequest('请提供 email、password 与 displayName。');
    }

    const userId = await registerUser({ email, password, displayName });
    const token = await createSession(userId);
    await setSessionCookie(token);

    const me = await getMe(userId);
    return { message: `注册成功，已赠送 ${me.pointsBalance} 积分。`, user: me };
  }, 201);
}
