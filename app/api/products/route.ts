import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { listProducts } from '@/lib/repo';

export async function GET() {
  return apiHandler(async () => {
    await requireUser();
    const products = await listProducts();
    return { products };
  });
}
