import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { listTasks } from '@/lib/repo';

export async function GET() {
  return apiHandler(async () => {
    const user = await requireUser();
    const tasks = await listTasks(user.id);
    return { tasks };
  });
}
