import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { getMe, listLedger, listProducts, listRedemptions, listTasks } from '@/lib/repo';

/** 仪表盘所需的全部数据，一次请求取回，减少页面往返。 */
export async function GET() {
  return apiHandler(async () => {
    const user = await requireUser();
    const [me, tasks, products, ledger, redemptions] = await Promise.all([
      getMe(user.id),
      listTasks(user.id),
      listProducts(),
      listLedger(user.id, 100),
      listRedemptions(user.id, 50),
    ]);
    return { me, tasks, products, ledger, redemptions };
  });
}
