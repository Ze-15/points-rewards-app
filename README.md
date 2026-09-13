# 任务积分与数字商品兑换 Web App

一个演示用的积分系统：**注册/登录 → 完成任务获得积分 → 用积分兑换数字商品 → 查看余额、收支明细与兑换结果**。

> ⚠️ **本项目完全使用虚构数据，不接入任何真实资金、支付网关或真实商品。**
> 所有"积分"与"数字商品"均为演示用途。

技术栈：**Next.js 16 (App Router) + TypeScript + PostgreSQL**，数据库访问使用 `pg` 驱动 + 原生 SQL。

---

## 快速开始

```bash
npm install       # 依赖已安装，可跳过
npm run dev       # 一条命令：启动数据库 → 迁移 → 播种 → 启动应用
```

打开 <http://127.0.0.1:3000>，先注册一个账号即可开始。

首次运行会自动初始化内置 PostgreSQL（数据目录 `.pgdata`），无需预先安装 PostgreSQL。

### 其他命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动完整应用（推荐） |
| `npm run db:reset` | 清空并重建数据库（重新迁移 + 播种） |
| `npm run db:migrate` | 仅执行数据库迁移 |
| `npm run db:seed` | 仅写入任务与商品数据（幂等） |
| `npm run check:schema` | 校验表结构与关键约束是否存在 |
| `npm run check:balances` | 校验余额与流水是否一致 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run test:e2e` | 端到端验收测试（需应用已在运行） |

### 环境要求

- **Node.js ≥ 20**（实测 v24.20.0）、npm
- 端口：`55432`（PostgreSQL）、`3000`（应用），均为本机回环

可通过环境变量覆盖：`PORT`、`PGPORT`、`DATABASE_URL`（指向外部 PostgreSQL 时会自动改用外部库）。

---

## 功能与页面

| 页面 | 说明 |
|---|---|
| `/register`、`/login` | 注册（赠送 100 积分）与登录 |
| `/` | 仪表盘：积分余额、任务列表、数字商品兑换 |
| `/ledger` | 收支明细：每笔变动的类型、说明、金额与变动后余额 |
| `/redemptions` | 兑换记录：商品、状态、发放结果或失败原因 |

### 任务（虚构）

| 任务 | 奖励 | 周期 |
|---|---|---|
| 每日签到 | +10 | 每天 1 次 |
| 阅读一篇文章 | +15 | 每天 1 次 |
| 完善个人资料 | +20 | 仅 1 次 |
| 邀请一位好友 | +30 | 仅 1 次 |

### 数字商品（虚构）

像素头像框 50 · 暗色主题皮肤 120 · 猫咪表情包合集 200 · 高级会员 7 天 500

---

## 三条硬性要求的实现方式

### 1. 同一任务奖励不能重复领取

由**数据库唯一约束**裁决，而非应用层判断：

```sql
UNIQUE (user_id, task_id, period_key)
```

领取时用 `ON CONFLICT DO NOTHING` 尝试插入完成记录，**只有真正插入成功（`rowCount === 1`）才加分并写流水**。

- 每日任务的 `period_key` 是日期（`YYYY-MM-DD`），所以次日可再次领取；
- 一次性任务的 `period_key` 固定为 `'once'`，终身只能领一次。

并发下两个请求必然只有一个能插入成功，因此不可能重复发放。测试中 10 并发领取同一任务，结果恰好 1 次成功、9 次被识别为已领取。

### 2. 重复提交兑换不能重复扣分或发货

由**幂等键唯一约束**裁决：

```sql
idempotency_key TEXT NOT NULL UNIQUE
```

客户端每次兑换意图生成一个 `Idempotency-Key`，重试时复用同一个键。服务端**先尝试插入**兑换记录，若键冲突即判定为重复提交，**直接返回既有记录，不再扣分或发货**。

扣分使用**条件更新**保证并发安全：

```sql
UPDATE users SET points_balance = points_balance - $price
 WHERE id = $uid AND points_balance >= $price
RETURNING points_balance
```

只有余额充足时才会更新成功，因此并发下不可能超扣。测试中同一幂等键 10 并发提交，结果只产生 1 条兑换记录、只扣 1 次分。

### 3. 余额不足与商品发放失败的处理

**余额不足**：条件更新返回 0 行 → 整个事务回滚 → 返回 `400` 与 `INSUFFICIENT_POINTS` 错误码，并说明所需与当前积分。**不产生任何流水或兑换记录**（连 `pending` 记录也一并回滚）。

**商品发放失败**：采用补偿模式 —— 扣分并建 `pending` 记录 → 执行发放 → 失败则**写一条 `refund` 反向流水、恢复余额、置为 `failed` 并记录失败原因**，明确告知用户"已全额退回 N 积分"。

> 演示方式：兑换时勾选"模拟发货失败"（或调用接口时传 `simulateDeliveryFailure: true`）即可触发该路径。
> 由于本项目没有真实的数字商品发放系统，该开关用于演示并验证补偿逻辑。

### 余额的真相来源

- `point_ledger` 是 append-only 事实表，每笔含 `delta` 与 `balance_after` 快照，可逐笔审计；
- `users.points_balance` 是事务内同步维护的当前值；
- `CHECK (points_balance >= 0)` 是数据库层最后防线，任何路径都无法把余额扣成负数。

`npm run check:balances` 会校验两者是否一致、快照是否正确、是否存在负数余额。

---

## 数据模型

```
users(id, email UNIQUE, password_hash, salt, display_name,
      points_balance INT NOT NULL DEFAULT 0 CHECK (points_balance >= 0), created_at)
sessions(token PK, user_id, expires_at)
tasks(id, code UNIQUE, title, description, reward, period, active)
task_completions(id, user_id, task_id, period_key, reward,
      UNIQUE(user_id, task_id, period_key))              -- ★ 防重复领取
products(id, code UNIQUE, name, description, price, active)
point_ledger(id, user_id, delta, reason, ref_type, ref_id, note,
      balance_after, created_at)                          -- append-only 事实表
redemptions(id, user_id, product_id, price, status,
      idempotency_key UNIQUE, delivery_payload,           -- ★ 防重复扣分
      failure_reason, created_at, updated_at)
```

### API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册并登录 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/me` | 当前用户、任务、商品、流水、兑换记录 |
| GET | `/api/tasks` | 任务列表（含当前周期是否已领） |
| POST | `/api/tasks/claim` | 领取任务奖励，body: `{ code }` |
| GET | `/api/products` | 商品列表 |
| GET | `/api/redemptions` | 兑换记录 |
| POST | `/api/redemptions` | 提交兑换，需 `Idempotency-Key` 头，body: `{ productCode }` |
| GET | `/api/ledger` | 积分收支明细 |

鉴权使用 `sessions` 表中的随机 token，通过 httpOnly Cookie 传递；口令用 `node:crypto` 的 `scrypt` + 每用户随机盐存储，比对使用 `timingSafeEqual`。

---

## 验收测试

```bash
npm run dev        # 终端 1
npm run test:e2e   # 终端 2
```

覆盖 11 组场景、共 **82 条断言**，全部通过：

1. 注册 / 登录 / 登出 / 重复邮箱 / 错误密码
2. 领取任务奖励
3. 重复领取同一任务（每日与一次性）
4. **10 并发领取同一任务** → 恰好 1 次成功
5. 余额充足时兑换成功
6. **同一幂等键 10 并发提交** → 只扣 1 次分、只发 1 次货
7. 余额不足兑换 → 400，无扣分、无记录
8. **并发兑换导致余额不足** → 余额永不为负
9. 商品发放失败 → 全额退款
10. 收支明细逐笔核对，流水累计等于当前余额
11. 未登录访问受保护接口 → 401

---

## 本机环境的四个坑（已修复）

实现过程中定位并修复了四个真实缺陷，均已在代码注释中说明：

### 1. 数据库启动时过早判定就绪

PostgreSQL 在崩溃恢复期间会**先监听端口**，但此时连接会被拒并返回 `the database system is starting up`。原实现只做 TCP 端口探测，导致后续连接失败、整个启动中断。

**修复**：`waitForReady()` 改为**真实连接 + 执行查询**探测，并对启动期操作加退避重试（`connectWithRetry`）。

### 2. `initdb` 在非 ASCII 路径下失败

工作区路径含中文（`dsh工作区`）。PostgreSQL 的 `initdb`/`postgres` 会从**二进制所在目录**读取 `share/` 下的模板与编码文件，Windows 版会以本地代码页解释该路径，于是报错：

```
initdb: error: invalid byte sequence for encoding "UTF8": 0xb9
```

（`0xB9` 正是「工」在 GBK 中的首字节。）

**修复**：`ensureAsciiBinaries()` 检测到二进制路径含非 ASCII 字符时，自动把原生二进制复制到纯 ASCII 的临时目录再调用。数据目录仍可位于中文路径下（已实测验证）。

### 3. `DROP DATABASE` 在 PostgreSQL 18 上挂起

`DROP DATABASE` 会等待全局的 proc-signal barrier，在并发/残留连接存在时可能长时间挂起并互相阻塞（实测卡死且无法通过 `pg_terminate_backend` 解除）。

**修复**：`reset.mjs` 改为在目标库内部执行 `DROP SCHEMA public CASCADE` + `CREATE SCHEMA public`。语义等价（清空所有对象），但只涉及当前库的锁，快速可靠。

### 4. 用 `127.0.0.1` 打开页面时一直卡在「加载中…」

Next.js 16 默认只信任 `localhost` 作为开发来源，对其它 Host 会**拦截其开发资源请求并返回 403**：

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1".
```

此时 HTML 能正常返回（页头可见），但客户端运行时资源被拦截，React 无法接管页面，于是页面永远停留在服务端渲染的初始状态「加载中…」。用浏览器开发者工具能看到 `/_next/hmr` 返回 403。

**修复**：在 `next.config.mjs` 中加入

```js
allowedDevOrigins: ['127.0.0.1', 'localhost', '[::1]'],
```

另外 `lib/client.ts` 的请求加了 15 秒超时，避免任何请求挂起时页面无限停留在「加载中…」而没有任何提示。

> 若仍看到「加载中…」，请**强制刷新**（Ctrl+Shift+R）以清掉此前被拦截时留下的页面状态。

### 附：沙箱限制

- **`next dev` CLI 不可用**：它用 `fork()` 创建管道子进程，在本沙箱下报 `spawn EPERM`。**修复**：改用 Next.js 官方 **Custom Server** 模式，在当前进程内直接创建 HTTP 服务器（`scripts/dev.mjs`）。
- **动态路由段不可用**：Next 16 dev server 会为 `[code]` 这类动态路由段启动子进程编译，同样触发 EPERM。**修复**：领取任务的接口改为静态路径 `POST /api/tasks/claim`，任务 `code` 放在请求体中。
- `next build` 的 worker fork 同样受限，因此构建期跳过类型检查，类型安全由 `npm run typecheck`（独立运行 `tsc`）保证。

---

## 目录结构

```
app/                       页面与 API 路由
  page.tsx                 仪表盘
  login/ register/         登录、注册
  ledger/                  收支明细
  redemptions/             兑换记录
  api/                     API 路由
components/Nav.tsx         顶部导航
lib/
  db.ts                    连接池与事务助手
  auth.ts                  scrypt 口令哈希、会话管理
  repo.ts                  数据访问与核心业务逻辑
  config.ts                共享配置（赠送积分、周期键等）
  errors.ts                统一错误类型
  api.ts                   API 响应包装
  client.ts                浏览器端调用助手
  types.ts                 前后端共享类型
migrations/001_init.sql    建表与约束
scripts/
  dev.mjs                  启动编排（数据库 → 迁移 → 播种 → 应用）
  pg-runtime.mjs           PostgreSQL 进程管理与路径规避
  migrate.mjs seed.mjs reset.mjs
  check-schema.mjs check-balances.mjs
  e2e-test.mjs             端到端验收测试
```

---

## 数据持久化

数据存放在 `.pgdata` 目录，**应用与数据库重启后积分、流水与兑换记录仍然保留**。

`npm run db:reset` 会清空所有数据（重建 schema 并重新播种任务与商品）。
