import { apiHandler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ALLOW_SIMULATED_DELIVERY_FAILURE } from '@/lib/config';
import { badRequest } from '@/lib/errors';
import { listRedemptions, redeemProduct } from '@/lib/repo';

export async function GET() {
  return apiHandler(async () => {
    const user = await requireUser();
    const redemptions = await listRedemptions(user.id, 50);
    return { redemptions };
  });
}

/**
 * 提交兑换。
 *
 * 幂等：客户端必须在 Idempotency-Key 请求头中提供一个键；
 * 同一意图重试时复用同一个键，服务端据此保证不重复扣分或发货。
 *
 * 请求体可选字段 simulateDeliveryFailure：仅用于演示「发放失败 → 全额退款」。
 */
export async function POST(request: Request) {
  return apiHandler(async () => {
    const user = await requireUser();

    const idempotencyKey = request.headers.get('Idempotency-Key');
    if (!idempotencyKey) {
      throw badRequest('缺少 Idempotency-Key 请求头。重复提交保护依赖此字段。');
    }

    let body: unknown = {};
    try {
      body = await request.json();
    } catch {
      // 允许空请求体，此时等价于 {}。
    }

    const { productCode, simulateDeliveryFailure } = (body ?? {}) as Record<string, unknown>;
    if (typeof productCode !== 'string' || productCode.length === 0) {
      throw badRequest('请提供 productCode。');
    }

    const simulateFailure =
      ALLOW_SIMULATED_DELIVERY_FAILURE && simulateDeliveryFailure === true;

    const result = await redeemProduct({
      userId: user.id,
      productCode,
      idempotencyKey,
      simulateFailure,
    });
    return result;
  });
}
