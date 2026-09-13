// 端到端验收测试：直接调用 HTTP API，验证全部硬性要求。
//
// 前置条件：应用已在 BASE_URL 上运行（npm run dev）。
// 运行：npm run test:e2e
//
// 覆盖场景见文件末尾的清单。
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';

// ---------------------------------------------------------------------------
// 极简测试框架
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function assertEqual(name, actual, expected) {
  ok(name, actual === expected, `期望 ${expected}，实际 ${actual}`);
}

// ---------------------------------------------------------------------------
// 带 Cookie 的 HTTP 客户端
// ---------------------------------------------------------------------------
class Client {
  constructor() {
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method, path, { body, headers = {} } = {}) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(this.cookies.size ? { Cookie: this.cookieHeader() } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 记录 Set-Cookie
    const setCookies = res.headers.getSetCookie?.() ?? [];
    for (const sc of setCookies) {
      const [pair] = sc.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      if (value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, body: json };
  }

  get(p) {
    return this.request('GET', p);
  }
  post(p, body, headers) {
    return this.request('POST', p, { body, headers });
  }
}

/** 未登录的裸客户端 */
function anonClient() {
  return new Client();
}

const uniqueEmail = (tag) => `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const PASSWORD = 'test-password-123';

/** 注册一个新用户并返回已登录的客户端 */
async function registerUser(tag) {
  const client = new Client();
  const email = uniqueEmail(tag);
  const res = await client.post('/api/auth/register', {
    email,
    password: PASSWORD,
    displayName: `测试用户-${tag}`,
  });
  if (res.status !== 201) {
    throw new Error(`注册失败 (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return { client, email, userId: res.body.user.email };
}

async function getBalance(client) {
  const res = await client.get('/api/me');
  if (res.status !== 200) throw new Error(`获取余额失败 (${res.status})`);
  return res.body.me.pointsBalance;
}

async function getLedger(client) {
  const res = await client.get('/api/ledger');
  if (res.status !== 200) throw new Error(`获取流水失败 (${res.status})`);
  return res.body.ledger;
}

async function getRedemptions(client) {
  const res = await client.get('/api/redemptions');
  if (res.status !== 200) throw new Error(`获取兑换记录失败 (${res.status})`);
  return res.body.redemptions;
}

/** 用指定幂等键兑换 */
function redeemWith(client, productCode, key, extra = {}) {
  return client.post('/api/redemptions', { productCode, ...extra }, { 'Idempotency-Key': key });
}

// ---------------------------------------------------------------------------
// 测试场景
// ---------------------------------------------------------------------------

async function testAuth() {
  section('【场景 1】注册 / 登录 / 未登录访问控制');

  const { client, email } = await registerUser('auth');
  const balance = await getBalance(client);
  assertEqual('注册后余额为 100（注册赠送）', balance, 100);

  const me = await client.get('/api/me');
  assertEqual('可以读取当前用户信息', me.status, 200);
  assertEqual('邮箱正确', me.body.me.email, email);

  // 登出后应无法访问
  const out = await client.post('/api/auth/logout');
  assertEqual('登出成功', out.status, 200);
  const afterLogout = await client.get('/api/me');
  assertEqual('登出后访问 /api/me 返回 401', afterLogout.status, 401);

  // 重新登录
  const login = await client.post('/api/auth/login', { email, password: PASSWORD });
  assertEqual('重新登录成功', login.status, 200);
  assertEqual('登录后余额仍为 100', await getBalance(client), 100);

  // 错误密码
  const bad = await anonClient().post('/api/auth/login', { email, password: 'wrong-password' });
  assertEqual('错误密码返回 400', bad.status, 400);

  // 重复注册
  const dup = await anonClient().post('/api/auth/register', {
    email,
    password: PASSWORD,
    displayName: '重复',
  });
  assertEqual('重复邮箱注册返回 409', dup.status, 409);

  section('【场景 11】未登录访问受保护接口');
  const anon = anonClient();
  assertEqual('未登录 GET /api/me → 401', (await anon.get('/api/me')).status, 401);
  assertEqual('未登录 GET /api/tasks → 401', (await anon.get('/api/tasks')).status, 401);
  assertEqual('未登录 GET /api/ledger → 401', (await anon.get('/api/ledger')).status, 401);
  assertEqual('未登录 GET /api/redemptions → 401', (await anon.get('/api/redemptions')).status, 401);
  assertEqual(
    '未登录 POST 领取任务 → 401',
    (await anon.post('/api/tasks/claim', { code: 'daily_checkin' })).status,
    401,
  );
  assertEqual(
    '未登录 POST 兑换 → 401',
    (await redeemWith(anon, 'avatar_frame_pixel', 'anon-key-123456')).status,
    401,
  );
}

async function testTaskClaim() {
  section('【场景 2】领取任务奖励');
  const { client } = await registerUser('claim');
  const before = await getBalance(client);

  const res = await client.post('/api/tasks/claim', { code: 'daily_checkin' });
  assertEqual('领取每日签到成功', res.status, 200);
  assertEqual('结果为 claimed', res.body.outcome, 'claimed');
  assertEqual('奖励为 10', res.body.reward, 10);
  assertEqual('余额增加 10', await getBalance(client), before + 10);

  const ledger = await getLedger(client);
  const taskRows = ledger.filter((l) => l.reason === 'task_reward');
  assertEqual('产生 1 条任务奖励流水', taskRows.length, 1);
  assertEqual('流水金额为 +10', taskRows[0].delta, 10);
  assertEqual('流水余额快照正确', taskRows[0].balanceAfter, before + 10);

  section('【场景 3】同一任务不能重复领取');
  const again = await client.post('/api/tasks/claim', { code: 'daily_checkin' });
  assertEqual('重复领取返回 200（业务上正常结果）', again.status, 200);
  assertEqual('结果为 already_claimed', again.body.outcome, 'already_claimed');
  assertEqual('余额不变', await getBalance(client), before + 10);

  const ledger2 = await getLedger(client);
  assertEqual(
    '任务奖励流水仍为 1 条',
    ledger2.filter((l) => l.reason === 'task_reward').length,
    1,
  );

  // 一次性任务同样只能领一次
  const once1 = await client.post('/api/tasks/claim', { code: 'complete_profile' });
  assertEqual('一次性任务首次领取成功', once1.body.outcome, 'claimed');
  const balAfterOnce = await getBalance(client);
  const once2 = await client.post('/api/tasks/claim', { code: 'complete_profile' });
  assertEqual('一次性任务重复领取被拒', once2.body.outcome, 'already_claimed');
  assertEqual('一次性任务重复领取后余额不变', await getBalance(client), balAfterOnce);

  section('【场景 4】并发领取同一任务（10 并发）');
  const { client: c2 } = await registerUser('concurrent-claim');
  const beforeConcurrent = await getBalance(c2);

  const results = await Promise.all(
    Array.from({ length: 10 }, () => c2.post('/api/tasks/claim', { code: 'read_article' })),
  );
  const claimedCount = results.filter((r) => r.body?.outcome === 'claimed').length;
  const alreadyCount = results.filter((r) => r.body?.outcome === 'already_claimed').length;

  assertEqual('10 并发中恰好 1 次成功领取', claimedCount, 1);
  assertEqual('其余 9 次均被识别为已领取', alreadyCount, 9);
  assertEqual('余额只增加一次（+15）', await getBalance(c2), beforeConcurrent + 15);

  const ledger3 = await getLedger(c2);
  assertEqual(
    '只产生 1 条任务奖励流水',
    ledger3.filter((l) => l.reason === 'task_reward').length,
    1,
  );
}

async function testRedeem() {
  section('【场景 5】余额充足时兑换成功');
  const { client } = await registerUser('redeem');
  // 领取任务凑够积分：100 + 10 + 15 + 20 + 30 = 175
  for (const code of ['daily_checkin', 'read_article', 'complete_profile', 'invite_friend']) {
    await client.post('/api/tasks/claim', { code });
  }
  const before = await getBalance(client);
  assertEqual('累计积分为 175', before, 175);

  const res = await redeemWith(client, 'avatar_frame_pixel', `key-ok-${Date.now()}`);
  assertEqual('兑换返回 200', res.status, 200);
  assertEqual('结果为 delivered', res.body.outcome, 'delivered');
  assertEqual('状态为 delivered', res.body.redemption.status, 'delivered');
  assertEqual('扣减 50 积分', await getBalance(client), before - 50);
  ok('返回发放凭据', Boolean(res.body.redemption.deliveryPayload));

  const ledger = await getLedger(client);
  const redeemRows = ledger.filter((l) => l.reason === 'redeem');
  assertEqual('产生 1 条兑换支出流水', redeemRows.length, 1);
  assertEqual('流水金额为 -50', redeemRows[0].delta, -50);

  section('【场景 6】同一幂等键重复提交（10 并发）');
  const { client: c2 } = await registerUser('idempotent');
  for (const code of ['daily_checkin', 'read_article', 'complete_profile', 'invite_friend']) {
    await c2.post('/api/tasks/claim', { code });
  }
  const beforeIdem = await getBalance(c2);
  const sharedKey = `key-idem-${Date.now()}`;

  const dupResults = await Promise.all(
    Array.from({ length: 10 }, () => redeemWith(c2, 'avatar_frame_pixel', sharedKey)),
  );
  const successCount = dupResults.filter((r) => r.status === 200).length;
  assertEqual('10 并发全部返回成功状态', successCount, 10);

  const reds = await getRedemptions(c2);
  assertEqual('只产生 1 条兑换记录', reds.length, 1);
  assertEqual('只扣减一次积分（-50）', await getBalance(c2), beforeIdem - 50);

  const ledger2 = await getLedger(c2);
  assertEqual(
    '只产生 1 条兑换支出流水',
    ledger2.filter((l) => l.reason === 'redeem').length,
    1,
  );

  // 顺序重复提交（模拟网络重试）同样不重复扣分
  const retry = await redeemWith(c2, 'avatar_frame_pixel', sharedKey);
  assertEqual('顺序重试返回 duplicate', retry.body.outcome, 'duplicate');
  assertEqual('顺序重试后余额不变', await getBalance(c2), beforeIdem - 50);
  assertEqual('兑换记录仍为 1 条', (await getRedemptions(c2)).length, 1);

  section('【场景 7】余额不足时兑换');
  const { client: c3 } = await registerUser('insufficient');
  const beforeIns = await getBalance(c3); // 100，不足以兑换 500 的商品
  const ledgerBefore = (await getLedger(c3)).length;
  const redsBefore = (await getRedemptions(c3)).length;

  const ins = await redeemWith(c3, 'membership_7d', `key-ins-${Date.now()}`);
  assertEqual('余额不足返回 400', ins.status, 400);
  assertEqual('错误码为 INSUFFICIENT_POINTS', ins.body.error.code, 'INSUFFICIENT_POINTS');
  ok(
    '错误信息说明了所需与当前积分',
    typeof ins.body.error.message === 'string' &&
      ins.body.error.message.includes('500') &&
      ins.body.error.message.includes(String(beforeIns)),
    ins.body.error.message,
  );
  assertEqual('余额未发生变化', await getBalance(c3), beforeIns);
  assertEqual('未产生新的流水', (await getLedger(c3)).length, ledgerBefore);
  assertEqual('未产生兑换记录', (await getRedemptions(c3)).length, redsBefore);

  section('【场景 8】并发兑换导致余额不足');
  const { client: c4 } = await registerUser('race');
  // 余额 100，兑换 50 的商品：只够 2 次
  const beforeRace = await getBalance(c4);
  const raceResults = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      redeemWith(c4, 'avatar_frame_pixel', `key-race-${Date.now()}-${i}`),
    ),
  );
  const okCount = raceResults.filter((r) => r.status === 200).length;
  const insCount = raceResults.filter(
    (r) => r.status === 400 && r.body?.error?.code === 'INSUFFICIENT_POINTS',
  ).length;
  const expectedOk = Math.floor(beforeRace / 50);

  assertEqual(`成功次数等于余额可承受次数（${expectedOk}）`, okCount, expectedOk);
  assertEqual('其余均因余额不足被拒', insCount, 6 - expectedOk);

  const finalBalance = await getBalance(c4);
  assertEqual('余额 = 初始 - 成功次数 × 50', finalBalance, beforeRace - okCount * 50);
  ok('余额从未变为负数', finalBalance >= 0, `实际 ${finalBalance}`);
  assertEqual('兑换记录数等于成功次数', (await getRedemptions(c4)).length, expectedOk);

  section('【场景 9】商品发放失败 → 全额退款');
  const { client: c5 } = await registerUser('delivery-fail');
  const beforeFail = await getBalance(c5);
  const failKey = `key-fail-${Date.now()}`;

  const failRes = await redeemWith(c5, 'avatar_frame_pixel', failKey, {
    simulateDeliveryFailure: true,
  });
  assertEqual('请求本身返回 200（已受理并处理完毕）', failRes.status, 200);
  assertEqual('结果为 failed', failRes.body.outcome, 'failed');
  assertEqual('兑换记录状态为 failed', failRes.body.redemption.status, 'failed');
  ok('记录了失败原因', typeof failRes.body.redemption.failureReason === 'string');
  assertEqual('积分已全额退回', await getBalance(c5), beforeFail);

  const ledgerFail = await getLedger(c5);
  assertEqual('产生 1 条兑换支出流水', ledgerFail.filter((l) => l.reason === 'redeem').length, 1);
  assertEqual('产生 1 条退款流水', ledgerFail.filter((l) => l.reason === 'refund').length, 1);
  const refundRow = ledgerFail.find((l) => l.reason === 'refund');
  assertEqual('退款金额为 +50', refundRow.delta, 50);
  assertEqual('退款后余额快照回到初始值', refundRow.balanceAfter, beforeFail);

  // 失败记录同样受幂等键保护：重试同一键不会再次扣分或再次退款。
  const failRetry = await redeemWith(c5, 'avatar_frame_pixel', failKey, {
    simulateDeliveryFailure: true,
  });
  assertEqual('失败后重试同一键返回 duplicate', failRetry.body.outcome, 'duplicate');
  assertEqual('重试后余额不变', await getBalance(c5), beforeFail);
  assertEqual('兑换记录仍为 1 条', (await getRedemptions(c5)).length, 1);
  const ledgerFail2 = await getLedger(c5);
  assertEqual('退款流水仍为 1 条', ledgerFail2.filter((l) => l.reason === 'refund').length, 1);

  section('【场景 10】收支明细与余额核对');
  const { client: c6 } = await registerUser('ledger');
  for (const code of ['daily_checkin', 'read_article', 'complete_profile', 'invite_friend']) {
    await c6.post('/api/tasks/claim', { code });
  }
  await redeemWith(c6, 'avatar_frame_pixel', `key-l-${Date.now()}`);
  await redeemWith(c6, 'theme_dark_pro', `key-l2-${Date.now()}`);
  await redeemWith(c6, 'membership_7d', `key-l3-${Date.now()}`); // 余额不足

  const ledger6 = await getLedger(c6);
  const balance6 = await getBalance(c6);
  const sum = ledger6.reduce((s, l) => s + l.delta, 0);

  assertEqual('流水累计等于当前余额', sum, balance6);
  ok('流水包含注册赠送', ledger6.some((l) => l.reason === 'signup_bonus'));
  ok('流水包含任务奖励', ledger6.some((l) => l.reason === 'task_reward'));
  ok('流水包含兑换支出', ledger6.some((l) => l.reason === 'redeem'));

  // 逐笔核对 balance_after：按时间正序累计应等于每笔的快照
  const chrono = [...ledger6].reverse();
  let running = 0;
  let snapshotOk = true;
  for (const row of chrono) {
    running += row.delta;
    if (running !== row.balanceAfter) snapshotOk = false;
  }
  ok('每笔流水的余额快照均可逐笔核对', snapshotOk);
  assertEqual('最后一笔快照等于当前余额', chrono[chrono.length - 1].balanceAfter, balance6);
}

async function testValidation() {
  section('【附加】输入校验');
  const { client } = await registerUser('validation');

  const noKey = await client.post('/api/redemptions', { productCode: 'avatar_frame_pixel' });
  assertEqual('缺少幂等键返回 400', noKey.status, 400);

  const badProduct = await redeemWith(client, 'no_such_product', `key-bp-${Date.now()}`);
  assertEqual('不存在的商品返回 404', badProduct.status, 404);

  const badTask = await client.post('/api/tasks/claim', { code: 'no_such_task' });
  assertEqual('不存在的任务返回 404', badTask.status, 404);

  const weakPassword = await anonClient().post('/api/auth/register', {
    email: uniqueEmail('weak'),
    password: 'short',
    displayName: '弱密码',
  });
  assertEqual('密码过短返回 400', weakPassword.status, 400);
}

/**
 * 【安全回归】幂等键必须按用户隔离。
 *
 * 历史缺陷：idempotency_key 曾是全局唯一，且按键查询未过滤 user_id。
 * 用户 B 只要提交与用户 A 相同的键，插入冲突后就会命中 A 的记录，
 * 从而读到 A 的兑换记录与发放凭据（越权读取）。
 *
 * 修复后：唯一约束为 UNIQUE(user_id, idempotency_key)，
 * 且所有按键查询都带 user_id 条件。
 * 本测试用两个真实用户复现该攻击路径，确认它已被阻断。
 */
async function testIdempotencyIsolation() {
  section('【安全】幂等键按用户隔离（防越权读取）');

  // 用户 A：领取任务凑够积分后成功兑换，拿到发放凭据
  const { client: a } = await registerUser('iso-a');
  for (const code of ['daily_checkin', 'read_article', 'complete_profile', 'invite_friend']) {
    await a.post('/api/tasks/claim', { code });
  }
  const sharedKey = `key-shared-${Date.now()}`;
  const aRes = await redeemWith(a, 'avatar_frame_pixel', sharedKey);
  assertEqual('用户 A 兑换成功', aRes.body?.outcome, 'delivered');
  const aLicense = aRes.body?.redemption?.deliveryPayload?.licenseKey;
  ok('用户 A 拿到发放凭据', typeof aLicense === 'string' && aLicense.length > 0);

  // 用户 B：故意使用与 A 完全相同的幂等键
  const { client: b } = await registerUser('iso-b');
  for (const code of ['daily_checkin', 'read_article', 'complete_profile', 'invite_friend']) {
    await b.post('/api/tasks/claim', { code });
  }
  const bBalanceBefore = await getBalance(b);
  const bRes = await redeemWith(b, 'avatar_frame_pixel', sharedKey);

  // 关键断言：B 绝不能拿到 A 的记录
  assertEqual('用户 B 的请求被当作新兑换处理（delivered）', bRes.body?.outcome, 'delivered');
  const bLicense = bRes.body?.redemption?.deliveryPayload?.licenseKey;
  ok('用户 B 拿到的是自己的凭据，而非 A 的', typeof bLicense === 'string' && bLicense !== aLicense);
  ok('用户 B 未读到 A 的兑换记录 ID', bRes.body?.redemption?.id !== aRes.body?.redemption?.id);

  // B 应当被正常扣分（说明它走的确实是自己的新兑换，而不是复用了 A 的结果）
  assertEqual('用户 B 被正常扣分 50', await getBalance(b), bBalanceBefore - 50);

  // 两个用户各自只有 1 条兑换记录
  assertEqual('用户 A 兑换记录数为 1', (await getRedemptions(a)).length, 1);
  assertEqual('用户 B 兑换记录数为 1', (await getRedemptions(b)).length, 1);

  // 同一用户重复提交仍应被幂等去重（确认修复没有破坏原有幂等语义）
  const bRetry = await redeemWith(b, 'avatar_frame_pixel', sharedKey);
  assertEqual('用户 B 重复提交返回 duplicate', bRetry.body?.outcome, 'duplicate');
  assertEqual('用户 B 重复提交后余额不变', await getBalance(b), bBalanceBefore - 50);
  assertEqual('用户 B 兑换记录仍为 1 条', (await getRedemptions(b)).length, 1);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n端到端验收测试 → ${BASE_URL}\n${'='.repeat(60)}`);

  // 先确认服务可达
  try {
    const probe = await fetch(`${BASE_URL}/api/me`);
    if (probe.status !== 401) {
      throw new Error(`预期未登录返回 401，实际 ${probe.status}`);
    }
  } catch (err) {
    console.error(`\n无法连接应用 (${BASE_URL})。请先运行 npm run dev。`);
    console.error(`原因: ${err?.message || err}`);
    process.exit(1);
  }

  await testAuth();
  await testTaskClaim();
  await testRedeem();
  await testValidation();
  await testIdempotencyIsolation();

  console.log(`\n${'='.repeat(60)}`);
  console.log(`通过: ${passed}  失败: ${failed}`);
  if (failed > 0) {
    console.log(`\n失败项:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n全部验收场景通过。');
}

main().catch((err) => {
  console.error(`\n测试执行异常: ${err?.stack || err}`);
  process.exit(1);
});
