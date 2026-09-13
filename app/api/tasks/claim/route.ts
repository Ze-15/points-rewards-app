import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { badRequest } from '@/lib/errors';
import { claimTask } from '@/lib/repo';

/**
 * 领取任务奖励。
 *
 * 说明：这里刻意使用静态路径 `/api/tasks/claim`，并把任务 code 放在请求体中，
 * 而不是使用动态段 `/api/tasks/[code]/claim`。
 * 原因：本沙箱环境禁止 Node 以管道方式创建子进程，而 Next.js 16 的 dev server
 * 会为「动态路由段」启动子进程进行编译，导致 spawn EPERM。
 * 改用静态路径即可规避，同时 API 语义同样清晰。
 *
 * 重复领取会返回 outcome='already_claimed' 与 HTTP 200
 * （这是业务上的正常结果而非错误），且余额与流水保持不变。
 */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireUser();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw badRequest('请求体必须是合法的 JSON。');
    }

    const { code } = (body ?? {}) as Record<string, unknown>;
    if (typeof code !== 'string' || code.length === 0) {
      throw badRequest('请提供任务 code。');
    }

    return claimTask(user.id, code);
  });
}
