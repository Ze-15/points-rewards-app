// 前后端共享的数据传输类型。
// 本文件不得引入任何服务端依赖（如 pg），以便客户端组件安全引用。

/** 任务视图 */
export type TaskView = {
  code: string;
  title: string;
  description: string;
  reward: number;
  period: 'daily' | 'once';
  /** 当前周期内是否已领取 */
  claimed: boolean;
  claimedAt: string | null;
};

/** 商品视图 */
export type ProductView = {
  code: string;
  name: string;
  description: string;
  price: number;
};

/** 积分流水类型 */
export type LedgerReason = 'signup_bonus' | 'task_reward' | 'redeem' | 'refund';

/** 积分流水条目 */
export type LedgerEntry = {
  id: number;
  delta: number;
  reason: LedgerReason;
  note: string | null;
  balanceAfter: number;
  createdAt: string;
};

/** 兑换状态 */
export type RedemptionStatus = 'pending' | 'delivered' | 'failed';

/** 兑换记录视图 */
export type RedemptionView = {
  id: number;
  productCode: string;
  productName: string;
  price: number;
  status: RedemptionStatus;
  failureReason: string | null;
  deliveryPayload: unknown;
  createdAt: string;
  updatedAt: string;
};

/** 当前用户视图 */
export type MeView = {
  email: string;
  displayName: string;
  pointsBalance: number;
  createdAt: string;
};

/** 领取任务的结果 */
export type ClaimResult = {
  /** 'claimed' = 本次成功领取；'already_claimed' = 本周期已领过 */
  outcome: 'claimed' | 'already_claimed';
  message: string;
  reward: number;
  balance: number;
};

/** 兑换结果 */
export type RedeemResult = {
  /** delivered = 成功发货；duplicate = 重复提交（返回既有记录）；failed = 发货失败已退款 */
  outcome: 'delivered' | 'duplicate' | 'failed';
  message: string;
  redemption: RedemptionView;
  balance: number;
};

/** 统一的错误响应体 */
export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};
