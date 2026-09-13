-- 任务积分与数字商品兑换应用 —— 初始结构
-- 说明：所有积分均为虚构虚拟积分，不涉及任何真实资金。

BEGIN;

-- ---------------------------------------------------------------------------
-- 用户
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT        NOT NULL UNIQUE,
  password_hash   TEXT        NOT NULL,
  salt            TEXT        NOT NULL,
  display_name    TEXT        NOT NULL,
  -- 当前余额：由事务内与 point_ledger 同步维护。
  -- CHECK 是数据库层的最后防线，保证任何路径都无法把余额扣成负数。
  points_balance  INTEGER     NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 会话（自研，不引第三方鉴权库）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT        PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- ---------------------------------------------------------------------------
-- 任务
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT    NOT NULL UNIQUE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL,
  reward      INTEGER NOT NULL CHECK (reward > 0),
  -- 'daily' = 每天可领一次；'once' = 仅可领一次
  period      TEXT    NOT NULL CHECK (period IN ('daily', 'once')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- 任务完成记录
--
-- 这是「同一任务奖励不能重复领取」的核心保障：
-- UNIQUE(user_id, task_id, period_key) 让重复领取在数据库层直接冲突。
--   daily 任务的 period_key 为日期 'YYYY-MM-DD'，故次日可再次领取；
--   once  任务的 period_key 固定为 'once'，故终身只能领一次。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_completions (
  id          BIGSERIAL   PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id     BIGINT      NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  period_key  TEXT        NOT NULL,
  reward      INTEGER     NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT task_completions_unique UNIQUE (user_id, task_id, period_key)
);
CREATE INDEX IF NOT EXISTS task_completions_user_idx ON task_completions (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 数字商品
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          BIGSERIAL PRIMARY KEY,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL,
  price       INTEGER NOT NULL CHECK (price > 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- ---------------------------------------------------------------------------
-- 积分流水（append-only 事实表）
--
-- delta          : 本次变动（正为收入，负为支出）
-- balance_after  : 变动后的余额快照，使每笔账都可独立核对
-- note           : 人类可读的说明（如任务名、商品名）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS point_ledger (
  id            BIGSERIAL   PRIMARY KEY,
  user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta         INTEGER     NOT NULL CHECK (delta <> 0),
  reason        TEXT        NOT NULL CHECK (reason IN (
                              'signup_bonus', 'task_reward', 'redeem', 'refund'
                            )),
  ref_type      TEXT,
  ref_id        BIGINT,
  note          TEXT,
  balance_after INTEGER     NOT NULL CHECK (balance_after >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS point_ledger_user_idx ON point_ledger (user_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------------
-- 兑换记录
--
-- UNIQUE(user_id, idempotency_key)：这是「重复提交兑换不能重复扣分或发货」的核心保障。
-- 服务端先尝试插入本行，若键冲突即判定为重复提交，直接返回既有记录。
--
-- 注意：唯一约束刻意限定在「用户维度」而非全局。
-- 若做成全局 UNIQUE(idempotency_key)，则用户 B 只要提交一个与用户 A 相同的键，
-- 插入就会冲突，随后按键查询会命中 A 的记录 —— 造成越权读取他人的兑换记录
-- 与发放凭据。加上 user_id 后，键天然按用户隔离，越权路径不存在。
--
-- status 流转：
--   pending   : 已扣分，正在发放
--   delivered : 扣分成功且发货成功
--   failed    : 扣分后发货失败，已写 refund 反向流水并恢复余额
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redemptions (
  id               BIGSERIAL   PRIMARY KEY,
  user_id          BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id       BIGINT      NOT NULL REFERENCES products(id),
  price            INTEGER     NOT NULL CHECK (price > 0),
  status           TEXT        NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  idempotency_key  TEXT        NOT NULL,
  delivery_payload JSONB,
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT redemptions_user_idempotency_unique UNIQUE (user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS redemptions_user_idx ON redemptions (user_id, created_at DESC);

COMMIT;
