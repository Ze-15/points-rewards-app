import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { listLedger } from '@/lib/repo';

export async function GET() {
  return apiHandler(async () => {
    const user = await requireUser();
    const ledger = await listLedger(user.id, 200);
    return { ledger };
  });
}
