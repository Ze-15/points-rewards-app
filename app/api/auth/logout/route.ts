import { cookies } from 'next/headers';
import { apiHandler } from '@/lib/api';
import { clearSessionCookie, destroySession } from '@/lib/auth';
import { SESSION_COOKIE } from '@/lib/config';

export async function POST() {
  return apiHandler(async () => {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (token) {
      await destroySession(token);
    }
    await clearSessionCookie();
    return { message: '已退出登录。' };
  });
}
