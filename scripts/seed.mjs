// 写入虚构的初始数据：任务与数字商品。
// 使用 upsert，可重复执行（幂等）。
import pg from 'pg';
import { DATABASE_URL } from './pg-config.mjs';
import { connectWithRetry } from './pg-runtime.mjs';

const log = (msg) => process.stdout.write(`${msg}\n`);

/** 任务定义（全部为虚构数据） */
const TASKS = [
  {
    code: 'daily_checkin',
    title: '每日签到',
    description: '每天打开应用签到一次，保持连续活跃。',
    reward: 10,
    period: 'daily',
    sort_order: 1,
  },
  {
    code: 'read_article',
    title: '阅读一篇文章',
    description: '阅读平台推荐的技术文章，每天可完成一次。',
    reward: 15,
    period: 'daily',
    sort_order: 2,
  },
  {
    code: 'complete_profile',
    title: '完善个人资料',
    description: '填写昵称与头像等资料，仅可获得一次奖励。',
    reward: 20,
    period: 'once',
    sort_order: 3,
  },
  {
    code: 'invite_friend',
    title: '邀请一位好友',
    description: '邀请好友注册，仅可获得一次奖励。',
    reward: 30,
    period: 'once',
    sort_order: 4,
  },
];

/** 数字商品定义（全部为虚构数据，仅消耗虚拟积分） */
const PRODUCTS = [
  {
    code: 'avatar_frame_pixel',
    name: '像素头像框',
    description: '虚拟形象装饰：复古像素风格头像框。',
    price: 50,
    sort_order: 1,
  },
  {
    code: 'theme_dark_pro',
    name: '暗色主题皮肤',
    description: '界面外观：专业暗色主题配色。',
    price: 120,
    sort_order: 2,
  },
  {
    code: 'sticker_pack_cat',
    name: '猫咪表情包合集',
    description: '虚拟内容：包含 24 张猫咪表情的聊天素材包。',
    price: 200,
    sort_order: 3,
  },
  {
    code: 'membership_7d',
    name: '高级会员 7 天',
    description: '虚拟权益：7 天高级会员体验资格。',
    price: 500,
    sort_order: 4,
  },
];

async function main() {
  await connectWithRetry(async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      await client.query('BEGIN');

      for (const t of TASKS) {
        await client.query(
          `INSERT INTO tasks (code, title, description, reward, period, sort_order, active)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE)
           ON CONFLICT (code) DO UPDATE SET
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             reward = EXCLUDED.reward,
             period = EXCLUDED.period,
             sort_order = EXCLUDED.sort_order,
             active = TRUE`,
          [t.code, t.title, t.description, t.reward, t.period, t.sort_order],
        );
      }
      log(`[seed] 任务已写入: ${TASKS.length} 条`);

      for (const p of PRODUCTS) {
        await client.query(
          `INSERT INTO products (code, name, description, price, sort_order, active)
           VALUES ($1, $2, $3, $4, $5, TRUE)
           ON CONFLICT (code) DO UPDATE SET
             name = EXCLUDED.name,
             description = EXCLUDED.description,
             price = EXCLUDED.price,
             sort_order = EXCLUDED.sort_order,
             active = TRUE`,
          [p.code, p.name, p.description, p.price, p.sort_order],
        );
      }
      log(`[seed] 商品已写入: ${PRODUCTS.length} 条`);

      await client.query('COMMIT');
      log('[seed] 完成。');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      await client.end();
    }
  });
}

main().catch((err) => {
  process.stderr.write(`[seed] 失败: ${err?.stack || err}\n`);
  process.exit(1);
});
