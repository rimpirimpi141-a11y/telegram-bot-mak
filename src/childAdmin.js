import {
  esc,
  fmtNum,
  fmtDateShort,
  fmtAmount,
  isStarBotType,
  isRedeemBotType,
  isAdvancedBotType,
  isGmailBotType,
  botTypeLabel,
} from './db.js';
import {
  sendMsg,
  sendPhotoMsg,
  editMsg,
  answerCb,
  resolveChannelInput,
  executeBroadcast,
} from './tgApi.js';

const ALLOWED_CHILD_SETTINGS = new Set([
  'per_refer',
  'min_withdraw',
  'daily_bonus',
  'support_username',
  'gmail_sell_price',
]);

const ALLOWED_CHILD_TOGGLES = new Set([
  'withdrawals_open',
  'maintenance',
  'device_verify',
  'gmail_sell_open',
]);

async function setAdminState(engine, botDbId, userId, state = '', stateData = '') {
  await engine.db.run(
    'UPDATE child_users SET state = ?, state_data = ? WHERE bot_db_id = ? AND user_id = ?',
    state,
    stateData,
    botDbId,
    userId
  );
}

export async function sendChildAdminHome(engine, bot, chatId, editMessageId = 0) {
  const isRedeem = isRedeemBotType(bot.bot_type);
  const isAdv = isAdvancedBotType(bot.bot_type);
  const isGmail = isGmailBotType(bot.bot_type);

  const kb = [];
  if (isGmail) {
    kb.push([
      { text: '📦 Gmail Plans & Stock', callback_data: 'ca_gplans', style: 'primary' },
      { text: '📤 Pending Gmail Sells', callback_data: 'ca_gsells:0', style: 'success' },
    ]);
    kb.push([
      { text: '💳 Pending Deposits', callback_data: 'ca_deps:0', style: 'success' },
      { text: '💸 Pending Withdraws', callback_data: 'ca_wds:0', style: 'primary' },
    ]);
    kb.push([{ text: '🏦 Deposit QR & Settings', callback_data: 'ca_deposit' }]);
  } else if (isRedeem) {
    kb.push([
      { text: '🎟 Redeem Plans & Codes', callback_data: 'ca_plans', style: 'primary' },
      { text: '📊 Bot Stats', callback_data: 'ca_stats', style: 'primary' },
    ]);
  } else {
    kb.push([
      { text: '💸 Pending Withdrawals', callback_data: 'ca_wds:0', style: 'success' },
      { text: '📊 Bot Stats', callback_data: 'ca_stats', style: 'primary' },
    ]);
  }

  if (isAdv) {
    kb.push([
      { text: '📋 Tasks', callback_data: 'ca_tasks', style: 'primary' },
      { text: '🎫 Promo Codes', callback_data: 'ca_promos', style: 'primary' },
    ]);
  }

  if (isGmail) {
    kb.push([{ text: '📊 Bot Stats', callback_data: 'ca_stats', style: 'primary' }]);
  }

  kb.push([
    { text: '👥 Users', callback_data: 'ca_users:0' },
    { text: '📢 Force Channels', callback_data: 'ca_channels:0' },
  ]);
  kb.push([
    { text: '👑 Admins', callback_data: 'ca_admins' },
    { text: '⚙ Settings', callback_data: 'ca_settings' },
  ]);
  kb.push([{ text: '📣 Broadcast Users', callback_data: 'ca_broadcast', style: 'danger' }]);

  const text = [
    `👑 <b>Admin Panel · @${esc(bot.bot_username)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `📦 Template: <b>${esc(botTypeLabel(bot.bot_type))}</b>`,
    `Choose an option below to configure your bot:`,
  ].join('\n');

  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, text, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, text, { inline_keyboard: kb });
}

async function sendChildStats(engine, bot, chatId, editMessageId) {
  const now = Math.floor(Date.now() / 1000);
  const u = await engine.db.first(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN (? - last_active_at) <= 86400 THEN 1 ELSE 0 END) AS active24h,
      SUM(CASE WHEN device_verified = 1 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) AS banned,
      COALESCE(SUM(balance), 0) AS balSum,
      COALESCE(SUM(total_withdrawn), 0) AS wdSum
     FROM child_users WHERE bot_db_id = ?`,
    now,
    bot.id
  );
  const wd = await engine.db.first(
    "SELECT COUNT(*) AS c FROM withdrawals WHERE bot_db_id = ? AND status = 'pending'",
    bot.id
  );
  const lines = [
    `📊 <b>Bot Statistics · @${esc(bot.bot_username)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `👥 Total Users: <code>${Number(u?.total || 0)}</code>`,
    `⚡ Active (24h): <code>${Number(u?.active24h || 0)}</code>`,
    `🛡 Verified Devices: <code>${Number(u?.verified || 0)}</code>`,
    `🚫 Banned: <code>${Number(u?.banned || 0)}</code>`,
    `💰 Total User Balance: <b>${fmtAmount(bot.currency, Number(u?.balSum || 0))}</b>`,
    `✅ Total Paid/Redeemed: <b>${fmtAmount(bot.currency, Number(u?.wdSum || 0))}</b>`,
    `⏳ Pending Withdrawals: <code>${Number(wd?.c || 0)}</code>`,
  ];

  if (isGmailBotType(bot.bot_type)) {
    const dep = await engine.db.first(
      "SELECT COUNT(*) AS c FROM child_deposits WHERE bot_db_id = ? AND status = 'pending'",
      bot.id
    );
    const gsell = await engine.db.first(
      "SELECT COUNT(*) AS c FROM gmail_sell_requests WHERE bot_db_id = ? AND status = 'pending'",
      bot.id
    );
    const gstk = await engine.db.first(
      'SELECT COUNT(*) AS c FROM gmail_stock WHERE bot_db_id = ? AND is_sold = 0',
      bot.id
    );
    lines.push(`💳 Pending Deposits: <code>${Number(dep?.c || 0)}</code>`);
    lines.push(`📤 Pending Gmail Sells: <code>${Number(gsell?.c || 0)}</code>`);
    lines.push(`📦 Available Gmail Stock: <code>${Number(gstk?.c || 0)}</code>`);
  }

  await editMsg(bot.token, chatId, editMessageId, lines.join('\n'), {
    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ca_home' }]],
  });
}

async function sendChildAdminsList(engine, bot, chatId, editMessageId = 0) {
  const admins = await engine.db.all(
    'SELECT * FROM child_admins WHERE bot_db_id = ? ORDER BY added_at ASC',
    bot.id
  );
  const lines = [
    `👑 <b>Bot Admins</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🔒 <b>Owner:</b> <code>${bot.owner_id}</code>`,
    ``,
    `➕ <b>Co-Admins (${admins.length}):</b>`,
  ];
  const kb = [[{ text: '➕ Add Co-Admin', callback_data: 'ca_admin_add', style: 'success' }]];
  for (const a of admins) {
    lines.push(`• <code>${a.user_id}</code>`);
    kb.push([{ text: `🗑 Remove ${a.user_id}`, callback_data: `ca_admin_del:${a.user_id}`, style: 'danger' }]);
  }
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildChannelsPage(engine, bot, page, chatId, editMessageId = 0) {
  const limit = 8;
  const offset = page * limit;
  const rows = await engine.db.all(
    'SELECT * FROM child_channels WHERE bot_db_id = ? ORDER BY id ASC LIMIT ? OFFSET ?',
    bot.id,
    limit,
    offset
  );
  const tot = await engine.db.first('SELECT COUNT(*) AS c FROM child_channels WHERE bot_db_id = ?', bot.id);
  const total = Number(tot?.c || 0);

  const lines = [
    `📢 <b>Force-Join Channels (${total})</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    total === 0 ? 'No force-join channels added yet.' : 'Users must join all listed channels:',
  ];
  const kb = [[{ text: '➕ Add Channel', callback_data: 'ca_ch_add', style: 'success' }]];
  for (const ch of rows) {
    lines.push(`• <b>${esc(ch.title || ch.chat_id)}</b> (<code>${esc(ch.chat_id)}</code>)`);
    kb.push([{ text: `🗑 Remove ${ch.title || ch.chat_id}`, callback_data: `ca_ch_del:${ch.id}`, style: 'danger' }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ca_channels:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ca_channels:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildUsersPage(engine, bot, page, chatId, editMessageId = 0) {
  const limit = 8;
  const offset = page * limit;
  const users = await engine.db.all(
    'SELECT user_id, first_name, balance, is_banned FROM child_users WHERE bot_db_id = ? ORDER BY joined_at DESC LIMIT ? OFFSET ?',
    bot.id,
    limit,
    offset
  );
  const tot = await engine.db.first('SELECT COUNT(*) AS c FROM child_users WHERE bot_db_id = ?', bot.id);
  const total = Number(tot?.c || 0);

  const kb = [[{ text: '🔍 Search User (ID / @username)', callback_data: 'ca_find_user', style: 'primary' }]];
  for (const u of users) {
    const tag = Number(u.is_banned) === 1 ? '🚫 ' : '';
    const label = `${tag}${u.first_name || 'User'} (${fmtAmount(bot.currency, u.balance)}) [${u.user_id}]`;
    kb.push([{ text: label.slice(0, 60), callback_data: `ca_u_view:${u.user_id}` }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ca_users:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ca_users:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = `👥 <b>Bot Users (${total})</b>\nPage ${page + 1}`;
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildUserCard(engine, bot, targetUid, chatId, editMessageId = 0) {
  const u = await engine.db.first(
    'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
    bot.id,
    targetUid
  );
  if (!u) {
    const txt = '❌ User not found.';
    if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt);
    else await sendMsg(bot.token, chatId, txt);
    return;
  }

  const text = [
    `👤 <b>User Profile</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🆔 ID: <code>${u.user_id}</code>`,
    `📛 Name: <b>${esc(u.first_name)}</b> ${u.username ? `(@${esc(u.username)})` : ''}`,
    `💰 Balance: <b>${fmtAmount(bot.currency, u.balance)}</b>`,
    `📈 Total Earned: ${fmtAmount(bot.currency, u.total_earned)}`,
    `💸 Total Withdrawn: ${fmtAmount(bot.currency, u.total_withdrawn)}`,
    `👥 Referrals: <code>${Number(u.total_refs || 0)}</code>`,
    `🏦 Payout Target: <code>${esc(u.upi_id || 'Not set')}</code>`,
    `🛡 Device Verified: ${Number(u.device_verified) === 1 ? '✅ Yes' : '❌ No'}`,
    `🚫 Banned: ${Number(u.is_banned) === 1 ? 'Yes' : 'No'}`,
    `📅 Joined: ${fmtDateShort(u.joined_at)}`,
  ].join('\n');

  const isBan = Number(u.is_banned) === 1;
  const markup = {
    inline_keyboard: [
      [
        { text: '➕ Add Balance', callback_data: `ca_u_add:${u.user_id}`, style: 'success' },
        { text: '➖ Cut Balance', callback_data: `ca_u_sub:${u.user_id}`, style: 'danger' },
      ],
      [
        {
          text: isBan ? '✅ Unban User' : '🚫 Ban User',
          callback_data: `ca_u_ban:${u.user_id}`,
          style: isBan ? 'success' : 'danger',
        },
      ],
      [{ text: '🔙 Back to Users', callback_data: 'ca_users:0' }],
    ],
  };

  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, text, markup);
  else await sendMsg(bot.token, chatId, text, markup);
}

async function sendChildWithdrawalsPage(engine, bot, page, chatId, editMessageId = 0) {
  const limit = 5;
  const offset = page * limit;
  const rows = await engine.db.all(
    "SELECT * FROM withdrawals WHERE bot_db_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ? OFFSET ?",
    bot.id,
    limit,
    offset
  );
  const tot = await engine.db.first(
    "SELECT COUNT(*) AS c FROM withdrawals WHERE bot_db_id = ? AND status = 'pending'",
    bot.id
  );
  const total = Number(tot?.c || 0);

  if (total === 0) {
    const txt = '💸 <b>Pending Withdrawals</b>\n\n✅ No pending withdrawals.';
    const markup = { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ca_home' }]] };
    if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, markup);
    else await sendMsg(bot.token, chatId, txt, markup);
    return;
  }

  const lines = [`💸 <b>Pending Withdrawals (${total})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
  const kb = [];
  for (const w of rows) {
    lines.push(
      `\n🆔 <b>#${w.id}</b> · User <code>${w.user_id}</code>\n💰 <b>${fmtAmount(bot.currency, w.amount)}</b> → <code>${esc(w.upi_id)}</code>`
    );
    kb.push([
      { text: `✅ Pay #${w.id}`, callback_data: `ca_wd_ok:${w.id}`, style: 'success' },
      { text: `❌ Reject #${w.id}`, callback_data: `ca_wd_no:${w.id}`, style: 'danger' },
    ]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ca_wds:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ca_wds:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildSettingsMenu(engine, bot, chatId, editMessageId = 0) {
  const wdOpen = Number(bot.withdrawals_open) === 1;
  const maint = Number(bot.maintenance) === 1;
  const dev = Number(bot.device_verify) === 1;
  const isGmail = isGmailBotType(bot.bot_type);
  const sellOpen = Number(bot.gmail_sell_open) === 1;

  const lines = [
    `⚙ <b>Bot Settings · @${esc(bot.bot_username)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🎁 Daily Bonus: <b>${fmtAmount(bot.currency, bot.daily_bonus)}</b>`,
    `👥 Per Refer: <b>${fmtAmount(bot.currency, bot.per_refer)}</b>`,
    `📉 Min Withdraw: <b>${fmtAmount(bot.currency, bot.min_withdraw)}</b>`,
    `🆘 Support: <code>${esc(bot.support_username || '@Support')}</code>`,
    `💸 Withdrawals: ${wdOpen ? '🟢 Open' : '🔴 Closed'}`,
    `🛡 Device Verify: ${dev ? '🟢 ON' : '🔴 OFF'}`,
    `🛠 Maintenance: ${maint ? '🔴 ON' : '🟢 OFF'}`,
  ];
  if (isGmail) {
    lines.push(`📤 Gmail Sell Rate: <b>${fmtAmount(bot.currency, bot.gmail_sell_price)}</b>`);
    lines.push(`📥 Gmail Selling: ${sellOpen ? '🟢 Open' : '🔴 Closed'}`);
  }

  const kb = [
    [
      { text: `🎁 Daily (${fmtNum(bot.daily_bonus)})`, callback_data: 'ca_set:daily_bonus' },
      { text: `👥 Refer (${fmtNum(bot.per_refer)})`, callback_data: 'ca_set:per_refer' },
    ],
    [
      { text: `📉 Min Withdraw (${fmtNum(bot.min_withdraw)})`, callback_data: 'ca_set:min_withdraw' },
      { text: '🆘 Support Username', callback_data: 'ca_set:support_username' },
    ],
  ];

  if (isGmail) {
    kb.push([
      { text: `📤 Gmail Sell Price (${fmtNum(bot.gmail_sell_price)})`, callback_data: 'ca_set:gmail_sell_price' },
      {
        text: sellOpen ? '🟢 Gmail Sell: OPEN' : '🔴 Gmail Sell: CLOSED',
        callback_data: 'ca_tog:gmail_sell_open',
        style: sellOpen ? 'success' : 'danger',
      },
    ]);
  }

  kb.push([
    {
      text: wdOpen ? '🟢 Withdrawals: OPEN' : '🔴 Withdrawals: CLOSED',
      callback_data: 'ca_tog:withdrawals_open',
      style: wdOpen ? 'success' : 'danger',
    },
    {
      text: dev ? '🛡 Dev Verify: ON' : '⚪ Dev Verify: OFF',
      callback_data: 'ca_tog:device_verify',
      style: dev ? 'success' : 'danger',
    },
  ]);
  kb.push([
    {
      text: maint ? '🔴 Maintenance: ON' : '🟢 Maintenance: OFF',
      callback_data: 'ca_tog:maintenance',
      style: maint ? 'danger' : 'success',
    },
  ]);
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildRedeemPlans(engine, bot, chatId, editMessageId = 0) {
  const plans = await engine.db.all(
    `SELECT p.*, (SELECT COUNT(*) FROM redeem_codes c WHERE c.plan_id = p.id AND c.is_used = 0) AS stock
     FROM redeem_plans p WHERE p.bot_db_id = ? ORDER BY p.id DESC`,
    bot.id
  );
  const kb = [[{ text: '➕ Create Redeem Plan', callback_data: 'ca_plan_add', style: 'success' }]];
  for (const p of plans) {
    kb.push([
      {
        text: `🎟 ${p.title} (${fmtAmount(bot.currency, p.cost)}) · Stock: ${p.stock}`,
        callback_data: `ca_plan_v:${p.id}`,
      },
    ]);
  }
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = `🎟 <b>Redeem Plans (${plans.length})</b>\n\nSelect a plan to add stock codes or remove it:`;
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildPlanDetail(engine, bot, planId, chatId, editMessageId = 0) {
  const plan = await engine.db.first(
    `SELECT p.*, (SELECT COUNT(*) FROM redeem_codes c WHERE c.plan_id = p.id AND c.is_used = 0) AS stock
     FROM redeem_plans p WHERE p.id = ? AND p.bot_db_id = ?`,
    planId,
    bot.id
  );
  if (!plan) {
    await sendChildRedeemPlans(engine, bot, chatId, editMessageId);
    return;
  }
  const text = [
    `🎟 <b>${esc(plan.title)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `💰 Cost: <b>${fmtAmount(bot.currency, plan.cost)}</b>`,
    `📦 Available Codes: <code>${Number(plan.stock || 0)}</code>`,
  ].join('\n');
  const markup = {
    inline_keyboard: [
      [{ text: '➕ Add Redeem Codes', callback_data: `ca_plan_codes:${plan.id}`, style: 'success' }],
      [{ text: '🗑 Delete Plan', callback_data: `ca_plan_del:${plan.id}`, style: 'danger' }],
      [{ text: '🔙 Back to Plans', callback_data: 'ca_plans' }],
    ],
  };
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, text, markup);
  else await sendMsg(bot.token, chatId, text, markup);
}

async function sendChildTasksMenu(engine, bot, chatId, editMessageId = 0) {
  const tasks = await engine.db.all('SELECT * FROM child_tasks WHERE bot_db_id = ? ORDER BY id DESC', bot.id);
  const kb = [[{ text: '➕ Add Task', callback_data: 'ca_task_add', style: 'success' }]];
  const lines = [`📋 <b>Bot Tasks (${tasks.length})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
  for (const t of tasks) {
    lines.push(`• <b>${esc(t.title)}</b> (+${fmtAmount(bot.currency, t.reward)})`);
    kb.push([{ text: `🗑 Delete "${t.title}"`, callback_data: `ca_task_del:${t.id}`, style: 'danger' }]);
  }
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildPromosMenu(engine, bot, chatId, editMessageId = 0) {
  const promos = await engine.db.all('SELECT * FROM child_promos WHERE bot_db_id = ? ORDER BY id DESC', bot.id);
  const kb = [[{ text: '➕ Create Promo Code', callback_data: 'ca_promo_add', style: 'success' }]];
  const lines = [`🎫 <b>Promo / Gift Codes (${promos.length})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
  for (const p of promos) {
    lines.push(
      `• <code>${esc(p.code)}</code> · +${fmtAmount(bot.currency, p.reward)} (${p.used_count}/${p.max_uses} used)`
    );
    kb.push([{ text: `🗑 Delete ${p.code}`, callback_data: `ca_promo_del:${p.id}`, style: 'danger' }]);
  }
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildGmailPlans(engine, bot, chatId, editMessageId = 0) {
  const plans = await engine.db.all(
    `SELECT p.*, (SELECT COUNT(*) FROM gmail_stock s WHERE s.plan_id = p.id AND s.is_sold = 0) AS stock
     FROM gmail_plans p WHERE p.bot_db_id = ? ORDER BY p.id DESC`,
    bot.id
  );
  const kb = [[{ text: '➕ Create Gmail Plan', callback_data: 'ca_gplan_add', style: 'success' }]];
  for (const p of plans) {
    kb.push([
      {
        text: `📧 ${p.title} (${fmtAmount(bot.currency, p.price)}) · Stock: ${p.stock}`,
        callback_data: `ca_gplan_v:${p.id}`,
      },
    ]);
  }
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = `📦 <b>Gmail Plans & Stock (${plans.length})</b>\n\nSelect a plan to add Gmail accounts or delete it:`;
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildGmailPlanDetail(engine, bot, planId, chatId, editMessageId = 0) {
  const plan = await engine.db.first(
    `SELECT p.*, (SELECT COUNT(*) FROM gmail_stock s WHERE s.plan_id = p.id AND s.is_sold = 0) AS stock
     FROM gmail_plans p WHERE p.id = ? AND p.bot_db_id = ?`,
    planId,
    bot.id
  );
  if (!plan) {
    await sendChildGmailPlans(engine, bot, chatId, editMessageId);
    return;
  }
  const text = [
    `📧 <b>${esc(plan.title)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `💰 Price: <b>${fmtAmount(bot.currency, plan.price)}</b>`,
    `📦 Available Stock: <code>${Number(plan.stock || 0)}</code>`,
  ].join('\n');
  const markup = {
    inline_keyboard: [
      [{ text: '➕ Add Gmail Stock', callback_data: `ca_gplan_stock:${plan.id}`, style: 'success' }],
      [{ text: '🗑 Delete Plan', callback_data: `ca_gplan_del:${plan.id}`, style: 'danger' }],
      [{ text: '🔙 Back to Gmail Plans', callback_data: 'ca_gplans' }],
    ],
  };
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, text, markup);
  else await sendMsg(bot.token, chatId, text, markup);
}

async function sendChildGmailSellsPage(engine, bot, page, chatId, editMessageId = 0) {
  const limit = 5;
  const offset = page * limit;
  const rows = await engine.db.all(
    "SELECT * FROM gmail_sell_requests WHERE bot_db_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ? OFFSET ?",
    bot.id,
    limit,
    offset
  );
  const tot = await engine.db.first(
    "SELECT COUNT(*) AS c FROM gmail_sell_requests WHERE bot_db_id = ? AND status = 'pending'",
    bot.id
  );
  const total = Number(tot?.c || 0);

  if (total === 0) {
    const txt = '📤 <b>Pending Gmail Sell Requests</b>\n\n✅ No pending sell requests.';
    const markup = { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ca_home' }]] };
    if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, markup);
    else await sendMsg(bot.token, chatId, txt, markup);
    return;
  }

  const lines = [`📤 <b>Pending Gmail Sell Requests (${total})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
  const kb = [];
  for (const r of rows) {
    lines.push(
      `\n🆔 <b>#${r.id}</b> · User <code>${r.user_id}</code> · ${fmtAmount(bot.currency, r.price)}\n📧 <code>${esc(r.account_data)}</code>`
    );
    kb.push([
      { text: `✅ Pay #${r.id}`, callback_data: `ca_gsell_ok:${r.id}`, style: 'success' },
      { text: `📦 Pay+Stock #${r.id}`, callback_data: `ca_gsell_stk:${r.id}`, style: 'primary' },
      { text: `❌ Reject #${r.id}`, callback_data: `ca_gsell_no:${r.id}`, style: 'danger' },
    ]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ca_gsells:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ca_gsells:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

async function sendChildDepositSettings(engine, bot, chatId, editMessageId = 0) {
  const enabled = Number(bot.deposit_enabled) === 1;
  const text = [
    `🏦 <b>Deposit QR & UPI Settings</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ Deposits: ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
    `📉 Min Deposit: <b>${fmtAmount(bot.currency, bot.min_deposit)}</b>`,
    `🏦 UPI ID: <code>${esc(bot.deposit_upi_id || 'Not Set')}</code>`,
    `🖼 QR Code: ${bot.deposit_qr_file_id ? '✅ Uploaded' : '❌ Not Set'}`,
  ].join('\n');

  const markup = {
    inline_keyboard: [
      [
        {
          text: enabled ? '🔴 Disable Deposits' : '🟢 Enable Deposits',
          callback_data: 'ca_dep_tog',
          style: enabled ? 'danger' : 'success',
        },
      ],
      [
        { text: '🖼 Set QR Photo', callback_data: 'ca_dep_qr', style: 'primary' },
        { text: '🏦 Set UPI ID', callback_data: 'ca_dep_upi', style: 'primary' },
      ],
      [
        { text: '📉 Set Min Deposit', callback_data: 'ca_dep_min' },
        { text: '⏳ Pending Deposits', callback_data: 'ca_deps:0', style: 'success' },
      ],
      [{ text: '🔙 Back', callback_data: 'ca_home' }],
    ],
  };

  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, text, markup);
  else await sendMsg(bot.token, chatId, text, markup);
}

async function sendChildPendingDeposits(engine, bot, page, chatId, editMessageId = 0) {
  const limit = 5;
  const offset = page * limit;
  const rows = await engine.db.all(
    "SELECT * FROM child_deposits WHERE bot_db_id = ? AND status = 'pending' ORDER BY id ASC LIMIT ? OFFSET ?",
    bot.id,
    limit,
    offset
  );
  const tot = await engine.db.first(
    "SELECT COUNT(*) AS c FROM child_deposits WHERE bot_db_id = ? AND status = 'pending'",
    bot.id
  );
  const total = Number(tot?.c || 0);

  if (total === 0) {
    const txt = '💳 <b>Pending User Deposits</b>\n\n✅ No pending deposits.';
    const markup = { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ca_home' }]] };
    if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, markup);
    else await sendMsg(bot.token, chatId, txt, markup);
    return;
  }

  const lines = [`💳 <b>Pending User Deposits (${total})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
  const kb = [];
  for (const d of rows) {
    lines.push(
      `\n🆔 <b>#${d.id}</b> · User <code>${d.user_id}</code>\n💵 <b>${fmtAmount(bot.currency, d.amount)}</b> · UTR: <code>${esc(d.utr)}</code>`
    );
    kb.push([
      { text: `✅ Approve #${d.id}`, callback_data: `ca_dep_ok:${d.id}`, style: 'success' },
      { text: `❌ Reject #${d.id}`, callback_data: `ca_dep_no:${d.id}`, style: 'danger' },
    ]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ca_deps:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ca_deps:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ca_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(bot.token, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(bot.token, chatId, txt, { inline_keyboard: kb });
}

export async function handleChildAdminCallback(engine, bot, cb, user, chatId, msgId, cancelMarkup) {
  const userId = Number(cb.from.id);
  const data = cb.data || '';
  const isAdmin = await engine.isChildAdmin(bot, userId);

  if (!isAdmin) {
    await answerCb(bot.token, cb.id, '❌ Bot Admin only.', true);
    return;
  }

  if (data === 'ca_home') {
    await answerCb(bot.token, cb.id);
    await sendChildAdminHome(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_stats') {
    await answerCb(bot.token, cb.id);
    await sendChildStats(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_admins') {
    await answerCb(bot.token, cb.id);
    await sendChildAdminsList(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_admin_add') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_admin_add', '');
    await sendMsg(
      bot.token,
      chatId,
      `👑 <b>Add Co-Admin</b>\n\nSend the Telegram numeric User ID:`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_admin_del:')) {
    const targetId = Number(data.slice(13));
    if (targetId === Number(bot.owner_id)) {
      await answerCb(bot.token, cb.id, '🔒 Bot owner cannot be removed.', true);
      return;
    }
    await engine.db.run('DELETE FROM child_admins WHERE bot_db_id = ? AND user_id = ?', bot.id, targetId);
    await answerCb(bot.token, cb.id, '🗑 Co-admin removed.');
    await sendChildAdminsList(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_channels' || data.startsWith('ca_channels:')) {
    const page = data.includes(':') ? Number(data.split(':')[1]) || 0 : 0;
    await answerCb(bot.token, cb.id);
    await sendChildChannelsPage(engine, bot, page, chatId, msgId);
    return;
  }

  if (data === 'ca_ch_add') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_add_channel', '');
    await sendMsg(
      bot.token,
      chatId,
      `📢 <b>Add Force-Join Channel</b>\n\nMake @${esc(bot.bot_username)} Admin in the channel first, then send:\n• Public: <code>@channelusername</code>\n• Private: <code>-1001234567890 | https://t.me/+InviteLink</code>`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_ch_del:')) {
    await engine.db.run('DELETE FROM child_channels WHERE id = ? AND bot_db_id = ?', Number(data.slice(10)), bot.id);
    await answerCb(bot.token, cb.id, '🗑 Channel removed.');
    await sendChildChannelsPage(engine, bot, 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_users:')) {
    await answerCb(bot.token, cb.id);
    await sendChildUsersPage(engine, bot, Number(data.slice(9)) || 0, chatId, msgId);
    return;
  }

  if (data === 'ca_find_user') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_find_user', '');
    await sendMsg(bot.token, chatId, '🔍 Send User ID or <code>@username</code>:', cancelMarkup);
    return;
  }

  if (data.startsWith('ca_u_view:')) {
    await answerCb(bot.token, cb.id);
    await sendChildUserCard(engine, bot, Number(data.slice(10)), chatId, msgId);
    return;
  }

  if (data.startsWith('ca_u_add:')) {
    const tid = Number(data.slice(9));
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_add_bal', String(tid));
    await sendMsg(bot.token, chatId, `➕ Send amount to add to user <code>${tid}</code>:`, cancelMarkup);
    return;
  }

  if (data.startsWith('ca_u_sub:')) {
    const tid = Number(data.slice(9));
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_sub_bal', String(tid));
    await sendMsg(bot.token, chatId, `➖ Send amount to cut from user <code>${tid}</code>:`, cancelMarkup);
    return;
  }

  if (data.startsWith('ca_u_ban:')) {
    const tid = Number(data.slice(9));
    const target = await engine.db.first(
      'SELECT is_banned FROM child_users WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      tid
    );
    if (!target) {
      await answerCb(bot.token, cb.id, '❌ User not found.', true);
      return;
    }
    const newBan = Number(target.is_banned) === 1 ? 0 : 1;
    await engine.db.run(
      'UPDATE child_users SET is_banned = ? WHERE bot_db_id = ? AND user_id = ?',
      newBan,
      bot.id,
      tid
    );
    await answerCb(bot.token, cb.id, newBan === 1 ? '🚫 User Banned.' : '✅ User Unbanned.');
    await sendChildUserCard(engine, bot, tid, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_wds:')) {
    await answerCb(bot.token, cb.id);
    await sendChildWithdrawalsPage(engine, bot, Number(data.slice(7)) || 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_wd_ok:')) {
    const wdId = Number(data.slice(9));
    const w = await engine.db.first('SELECT * FROM withdrawals WHERE id = ? AND bot_db_id = ?', wdId, bot.id);
    if (!w || w.status !== 'pending') {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE withdrawals SET status = 'approved', processed_at = ? WHERE id = ? AND bot_db_id = ? AND status = 'pending'",
      now,
      wdId,
      bot.id
    );
    if (upd.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    await answerCb(bot.token, cb.id, '✅ Withdrawal Approved!');
    await sendMsg(
      bot.token,
      w.user_id,
      `✅ <b>Withdrawal Approved! (#${wdId})</b>\n\n💰 Amount: <b>${fmtAmount(bot.currency, w.amount)}</b>\n🏦 Sent to: <code>${esc(w.upi_id)}</code>`
    );
    await sendChildWithdrawalsPage(engine, bot, 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_wd_no:')) {
    const wdId = Number(data.slice(9));
    const w = await engine.db.first('SELECT * FROM withdrawals WHERE id = ? AND bot_db_id = ?', wdId, bot.id);
    if (!w || w.status !== 'pending') {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE withdrawals SET status = 'rejected', processed_at = ? WHERE id = ? AND bot_db_id = ? AND status = 'pending'",
      now,
      wdId,
      bot.id
    );
    if (upd.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    await engine.db.run(
      'UPDATE child_users SET balance = balance + ?, total_withdrawn = MAX(0, total_withdrawn - ?) WHERE bot_db_id = ? AND user_id = ?',
      w.amount,
      w.amount,
      bot.id,
      w.user_id
    );
    await answerCb(bot.token, cb.id, '❌ Withdrawal Rejected & Refunded.');
    await sendMsg(
      bot.token,
      w.user_id,
      `❌ <b>Withdrawal Rejected (#${wdId})</b>\n\n💰 <b>${fmtAmount(bot.currency, w.amount)}</b> has been refunded back to your balance.`
    );
    await sendChildWithdrawalsPage(engine, bot, 0, chatId, msgId);
    return;
  }

  if (data === 'ca_settings') {
    await answerCb(bot.token, cb.id);
    await sendChildSettingsMenu(engine, bot, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_set:')) {
    const field = data.slice(7);
    if (!ALLOWED_CHILD_SETTINGS.has(field)) {
      await answerCb(bot.token, cb.id, '❌ Invalid field.', true);
      return;
    }
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, `ca_set:${field}`, '');
    await sendMsg(
      bot.token,
      chatId,
      `✏ <b>Update <code>${esc(field)}</code></b>\n\nSend the new value:`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_tog:')) {
    const field = data.slice(7);
    if (!ALLOWED_CHILD_TOGGLES.has(field)) {
      await answerCb(bot.token, cb.id, '❌ Invalid setting.', true);
      return;
    }
    const newVal = Number(bot[field]) === 1 ? 0 : 1;
    await engine.db.run(`UPDATE bots SET ${field} = ? WHERE id = ?`, newVal, bot.id);
    bot[field] = newVal;
    await answerCb(bot.token, cb.id, '✅ Updated!');
    await sendChildSettingsMenu(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_plans') {
    await answerCb(bot.token, cb.id);
    await sendChildRedeemPlans(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_plan_add') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_plan_add', '');
    await sendMsg(
      bot.token,
      chatId,
      `🎟 <b>Create Redeem Plan</b>\n\nSend format: <code>Plan Title | Cost</code>\nExample: <code>₹50 Google Play Code | 50</code>`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_plan_v:')) {
    await answerCb(bot.token, cb.id);
    await sendChildPlanDetail(engine, bot, Number(data.slice(10)), chatId, msgId);
    return;
  }

  if (data.startsWith('ca_plan_codes:')) {
    const pid = Number(data.slice(14));
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_plan_codes', String(pid));
    await sendMsg(
      bot.token,
      chatId,
      `➕ <b>Add Redeem Codes to Plan #${pid}</b>\n\nSend one code per line (bulk supported):`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_plan_del:')) {
    const pid = Number(data.slice(12));
    await engine.db.run('DELETE FROM redeem_plans WHERE id = ? AND bot_db_id = ?', pid, bot.id);
    await answerCb(bot.token, cb.id, '🗑 Plan deleted.');
    await sendChildRedeemPlans(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_tasks') {
    await answerCb(bot.token, cb.id);
    await sendChildTasksMenu(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_task_add') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_task_add', '');
    await sendMsg(
      bot.token,
      chatId,
      `📋 <b>Add Task</b>\n\nSend format: <code>Title | https://link | Reward</code>\nExample: <code>Join Channel | https://t.me/mychan | 5</code>`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_task_del:')) {
    await engine.db.run('DELETE FROM child_tasks WHERE id = ? AND bot_db_id = ?', Number(data.slice(12)), bot.id);
    await answerCb(bot.token, cb.id, '🗑 Task deleted.');
    await sendChildTasksMenu(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_promos') {
    await answerCb(bot.token, cb.id);
    await sendChildPromosMenu(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_promo_add') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_promo_add', '');
    await sendMsg(
      bot.token,
      chatId,
      `🎫 <b>Create Promo Code</b>\n\nSend format: <code>CODE | Reward | MaxUses</code>\nExample: <code>BONUS50 | 10 | 100</code>`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_promo_del:')) {
    await engine.db.run('DELETE FROM child_promos WHERE id = ? AND bot_db_id = ?', Number(data.slice(13)), bot.id);
    await answerCb(bot.token, cb.id, '🗑 Promo deleted.');
    await sendChildPromosMenu(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_gplans') {
    await answerCb(bot.token, cb.id);
    await sendChildGmailPlans(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_gplan_add') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_gplan_add', '');
    await sendMsg(
      bot.token,
      chatId,
      `📧 <b>Create Gmail Plan</b>\n\nSend format: <code>Plan Title | Price</code>\nExample: <code>Fresh Verified Gmail | 15</code>`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_gplan_v:')) {
    await answerCb(bot.token, cb.id);
    await sendChildGmailPlanDetail(engine, bot, Number(data.slice(11)), chatId, msgId);
    return;
  }

  if (data.startsWith('ca_gplan_stock:')) {
    const pid = Number(data.slice(15));
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_gplan_stock', String(pid));
    await sendMsg(
      bot.token,
      chatId,
      `📦 <b>Add Gmail Stock to Plan #${pid}</b>\n\nSend one account per line (e.g. <code>email@gmail.com | password</code>):`,
      cancelMarkup
    );
    return;
  }

  if (data.startsWith('ca_gplan_del:')) {
    const pid = Number(data.slice(13));
    await engine.db.run('DELETE FROM gmail_plans WHERE id = ? AND bot_db_id = ?', pid, bot.id);
    await answerCb(bot.token, cb.id, '🗑 Gmail plan deleted.');
    await sendChildGmailPlans(engine, bot, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_gsells:')) {
    await answerCb(bot.token, cb.id);
    await sendChildGmailSellsPage(engine, bot, Number(data.slice(10)) || 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_gsell_ok:') || data.startsWith('ca_gsell_stk:')) {
    const addToStock = data.startsWith('ca_gsell_stk:');
    const reqId = Number(data.split(':')[1]);
    const r = await engine.db.first(
      'SELECT * FROM gmail_sell_requests WHERE id = ? AND bot_db_id = ?',
      reqId,
      bot.id
    );
    if (!r || r.status !== 'pending') {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE gmail_sell_requests SET status = 'approved', processed_by = ?, processed_at = ? WHERE id = ? AND bot_db_id = ? AND status = 'pending'",
      userId,
      now,
      reqId,
      bot.id
    );
    if (upd.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    await engine.db.run(
      'UPDATE child_users SET balance = balance + ?, total_earned = total_earned + ? WHERE bot_db_id = ? AND user_id = ?',
      r.price,
      r.price,
      bot.id,
      r.user_id
    );

    if (addToStock) {
      const activePlan = await engine.db.first(
        'SELECT id FROM gmail_plans WHERE bot_db_id = ? AND is_active = 1 ORDER BY id ASC LIMIT 1',
        bot.id
      );
      if (activePlan) {
        await engine.db.run(
          'INSERT INTO gmail_stock (bot_db_id, plan_id, account_data, is_sold, created_at) VALUES (?, ?, ?, 0, ?)',
          bot.id,
          activePlan.id,
          r.account_data,
          now
        );
      }
    }

    await answerCb(bot.token, cb.id, addToStock ? '✅ Approved + Added to Stock!' : '✅ Approved!');
    await sendMsg(
      bot.token,
      r.user_id,
      `✅ <b>Gmail Sale Approved! (#${reqId})</b>\n\n💰 Credited: <b>+${fmtAmount(bot.currency, r.price)}</b> to your balance!`
    );
    await sendChildGmailSellsPage(engine, bot, 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_gsell_no:')) {
    const reqId = Number(data.slice(12));
    const r = await engine.db.first(
      'SELECT * FROM gmail_sell_requests WHERE id = ? AND bot_db_id = ?',
      reqId,
      bot.id
    );
    if (!r || r.status !== 'pending') {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE gmail_sell_requests SET status = 'rejected', processed_by = ?, processed_at = ? WHERE id = ? AND bot_db_id = ? AND status = 'pending'",
      userId,
      now,
      reqId,
      bot.id
    );
    if (upd.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    await answerCb(bot.token, cb.id, '❌ Rejected.');
    await sendMsg(
      bot.token,
      r.user_id,
      `❌ <b>Gmail Sale Rejected (#${reqId})</b>\n\nAccount did not pass verification.`
    );
    await sendChildGmailSellsPage(engine, bot, 0, chatId, msgId);
    return;
  }

  if (data === 'ca_deposit') {
    await answerCb(bot.token, cb.id);
    await sendChildDepositSettings(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_dep_tog') {
    const newVal = Number(bot.deposit_enabled) === 1 ? 0 : 1;
    await engine.db.run('UPDATE bots SET deposit_enabled = ? WHERE id = ?', newVal, bot.id);
    bot.deposit_enabled = newVal;
    await answerCb(bot.token, cb.id, newVal === 1 ? '🟢 Enabled' : '🔴 Disabled');
    await sendChildDepositSettings(engine, bot, chatId, msgId);
    return;
  }

  if (data === 'ca_dep_qr') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_dep_qr', '');
    await sendMsg(
      bot.token,
      chatId,
      `🖼 <b>Set Deposit QR Photo</b>\n\nSend the QR image photo (or send <code>clear</code> to remove):`,
      cancelMarkup
    );
    return;
  }

  if (data === 'ca_dep_upi') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_dep_upi', '');
    await sendMsg(bot.token, chatId, '🏦 Send the Deposit UPI ID:', cancelMarkup);
    return;
  }

  if (data === 'ca_dep_min') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_dep_min', '');
    await sendMsg(bot.token, chatId, '📉 Send the Minimum Deposit amount:', cancelMarkup);
    return;
  }

  if (data.startsWith('ca_deps:')) {
    await answerCb(bot.token, cb.id);
    await sendChildPendingDeposits(engine, bot, Number(data.slice(8)) || 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ca_dep_ok:')) {
    const depId = Number(data.slice(10));
    const dep = await engine.db.first(
      'SELECT * FROM child_deposits WHERE id = ? AND bot_db_id = ?',
      depId,
      bot.id
    );
    if (!dep || dep.status !== 'pending') {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE child_deposits SET status = 'approved', processed_by = ?, processed_at = ? WHERE id = ? AND bot_db_id = ? AND status = 'pending'",
      userId,
      now,
      depId,
      bot.id
    );
    if (upd.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    await engine.db.run(
      'UPDATE child_users SET balance = balance + ? WHERE bot_db_id = ? AND user_id = ?',
      dep.amount,
      bot.id,
      dep.user_id
    );
    await answerCb(bot.token, cb.id, '✅ Deposit Approved!');
    await sendMsg(
      bot.token,
      dep.user_id,
      `✅ <b>Deposit Approved! (#${depId})</b>\n\n💰 Credited: <b>+${fmtAmount(bot.currency, dep.amount)}</b>`
    );
    if (cb.message?.photo) {
      await sendChildPendingDeposits(engine, bot, 0, chatId);
    } else {
      await sendChildPendingDeposits(engine, bot, 0, chatId, msgId);
    }
    return;
  }

  if (data.startsWith('ca_dep_no:')) {
    const depId = Number(data.slice(10));
    const dep = await engine.db.first(
      'SELECT * FROM child_deposits WHERE id = ? AND bot_db_id = ?',
      depId,
      bot.id
    );
    if (!dep || dep.status !== 'pending') {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE child_deposits SET status = 'rejected', processed_by = ?, processed_at = ? WHERE id = ? AND bot_db_id = ? AND status = 'pending'",
      userId,
      now,
      depId,
      bot.id
    );
    if (upd.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already processed.', true);
      return;
    }
    await answerCb(bot.token, cb.id, '❌ Deposit Rejected.');
    await sendMsg(
      bot.token,
      dep.user_id,
      `❌ <b>Deposit Rejected (#${depId})</b>\n\nAmount: ${fmtAmount(bot.currency, dep.amount)}\nUTR: <code>${esc(dep.utr)}</code>`
    );
    if (cb.message?.photo) {
      await sendChildPendingDeposits(engine, bot, 0, chatId);
    } else {
      await sendChildPendingDeposits(engine, bot, 0, chatId, msgId);
    }
    return;
  }

  if (data === 'ca_broadcast') {
    await answerCb(bot.token, cb.id);
    await setAdminState(engine, bot.id, userId, 'ca_bc_msg', '');
    await sendMsg(
      bot.token,
      chatId,
      `📣 <b>Broadcast to All Bot Users</b>\n\nSend the message you want to broadcast (HTML supported):`,
      cancelMarkup
    );
    return;
  }

  if (data === 'ca_bc_exec') {
    let payload = {};
    try {
      payload = JSON.parse(user.state_data || '{}');
    } catch {
      payload = {};
    }
    if (!payload.text) {
      await answerCb(bot.token, cb.id, '❌ Broadcast session expired.', true);
      return;
    }
    await setAdminState(engine, bot.id, userId, '', '');
    await answerCb(bot.token, cb.id, '🚀 Broadcast started!');
    await editMsg(bot.token, chatId, msgId, '⏳ <b>Broadcasting to users in background...</b>');

    const inlineMarkup =
      payload.btnText && payload.btnUrl
        ? { inline_keyboard: [[{ text: payload.btnText, url: payload.btnUrl, style: 'primary' }]] }
        : undefined;

    engine.runBackground(
      (async () => {
        const users = await engine.db.all(
          'SELECT user_id FROM child_users WHERE bot_db_id = ? AND is_banned = 0',
          bot.id
        );
        const r = await executeBroadcast(
          bot.token,
          users.map((u) => Number(u.user_id)),
          payload.text,
          inlineMarkup
        );
        await sendMsg(
          bot.token,
          chatId,
          `✅ <b>Broadcast Complete!</b>\n\n📨 Delivered: <code>${r.sent}</code>\n❌ Failed: <code>${r.failed}</code>`
        );
      })()
    );
  }
}

export async function handleChildAdminState(engine, bot, user, msg, chatId, text, cancelMarkup, mainMarkup) {
  const userId = Number(user.user_id);
  const state = user.state || '';

  if (state === 'ca_admin_add') {
    const tid = Number(text.trim());
    if (!Number.isInteger(tid) || tid <= 0) {
      await sendMsg(bot.token, chatId, '❌ Send a valid numeric Telegram User ID:');
      return true;
    }
    await engine.db.run(
      'INSERT OR IGNORE INTO child_admins (bot_db_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)',
      bot.id,
      tid,
      userId,
      Math.floor(Date.now() / 1000)
    );
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Added <code>${tid}</code> as Co-Admin.`, mainMarkup);
    await sendChildAdminsList(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_add_channel') {
    const res = await resolveChannelInput(bot.token, text);
    if (!res.ok) {
      await sendMsg(bot.token, chatId, `❌ ${res.error}`);
      return true;
    }
    await engine.db.run(
      `INSERT INTO child_channels (bot_db_id, chat_id, title, invite_link, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(bot_db_id, chat_id) DO UPDATE SET title = excluded.title, invite_link = excluded.invite_link`,
      bot.id,
      res.chatId,
      res.title,
      res.inviteLink,
      Math.floor(Date.now() / 1000)
    );
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Added channel <b>${esc(res.title)}</b>!`, mainMarkup);
    await sendChildChannelsPage(engine, bot, 0, chatId);
    return true;
  }

  if (state === 'ca_find_user') {
    const q = text.trim().replace(/^@/, '');
    const target = /^\d+$/.test(q)
      ? await engine.db.first(
          'SELECT user_id FROM child_users WHERE bot_db_id = ? AND user_id = ?',
          bot.id,
          Number(q)
        )
      : await engine.db.first(
          'SELECT user_id FROM child_users WHERE bot_db_id = ? AND LOWER(username) = LOWER(?)',
          bot.id,
          q
        );
    if (!target) {
      await sendMsg(bot.token, chatId, '❌ User not found. Send another ID or @username:');
      return true;
    }
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, '✅ Found user:', mainMarkup);
    await sendChildUserCard(engine, bot, Number(target.user_id), chatId);
    return true;
  }

  if (state === 'ca_add_bal' || state === 'ca_sub_bal') {
    const tid = Number(user.state_data);
    const amt = Number(text.trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      await sendMsg(bot.token, chatId, '❌ Send a valid positive amount:');
      return true;
    }
    if (state === 'ca_add_bal') {
      await engine.db.run(
        'UPDATE child_users SET balance = balance + ?, total_earned = total_earned + ? WHERE bot_db_id = ? AND user_id = ?',
        amt,
        amt,
        bot.id,
        tid
      );
      await sendMsg(bot.token, tid, `🎁 Admin added <b>+${fmtAmount(bot.currency, amt)}</b> to your balance!`);
    } else {
      await engine.db.run(
        'UPDATE child_users SET balance = MAX(0, balance - ?) WHERE bot_db_id = ? AND user_id = ?',
        amt,
        bot.id,
        tid
      );
      await sendMsg(bot.token, tid, `➖ Admin deducted <b>-${fmtAmount(bot.currency, amt)}</b> from your balance.`);
    }
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, '✅ Balance updated!', mainMarkup);
    await sendChildUserCard(engine, bot, tid, chatId);
    return true;
  }

  if (state.startsWith('ca_set:')) {
    const field = state.slice(7);
    if (!ALLOWED_CHILD_SETTINGS.has(field)) {
      await setAdminState(engine, bot.id, userId, '', '');
      return true;
    }
    const raw = text.trim();
    let finalVal = raw;
    if (field !== 'support_username') {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        await sendMsg(bot.token, chatId, '❌ Send a valid non-negative number:');
        return true;
      }
      finalVal = n;
    }
    await engine.db.run(`UPDATE bots SET ${field} = ? WHERE id = ?`, finalVal, bot.id);
    bot[field] = finalVal;
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Updated <code>${esc(field)}</code>!`, mainMarkup);
    await sendChildSettingsMenu(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_plan_add') {
    const parts = text.split('|').map((s) => s.trim());
    const title = parts[0];
    const cost = Number(parts[1]);
    if (!title || !Number.isFinite(cost) || cost <= 0) {
      await sendMsg(bot.token, chatId, '❌ Format: <code>Plan Title | Cost</code>');
      return true;
    }
    await engine.db.run(
      'INSERT INTO redeem_plans (bot_db_id, title, cost, is_active, created_at) VALUES (?, ?, ?, 1, ?)',
      bot.id,
      title,
      cost,
      Math.floor(Date.now() / 1000)
    );
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Plan "${esc(title)}" created!`, mainMarkup);
    await sendChildRedeemPlans(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_plan_codes') {
    const pid = Number(user.state_data);
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      await sendMsg(bot.token, chatId, '❌ Send at least one code:');
      return true;
    }
    const now = Math.floor(Date.now() / 1000);
    const stmts = lines.map((code) =>
      engine.db.prepare(
        'INSERT INTO redeem_codes (bot_db_id, plan_id, code, is_used, created_at) VALUES (?, ?, ?, 0, ?)',
        bot.id,
        pid,
        code,
        now
      )
    );
    await engine.db.batch(stmts);
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Added <b>${lines.length}</b> redeem codes!`, mainMarkup);
    await sendChildPlanDetail(engine, bot, pid, chatId);
    return true;
  }

  if (state === 'ca_task_add') {
    const parts = text.split('|').map((s) => s.trim());
    const title = parts[0];
    const url = parts[1];
    const reward = Number(parts[2]);
    if (!title || !url || !/^https?:\/\//i.test(url) || !Number.isFinite(reward) || reward <= 0) {
      await sendMsg(bot.token, chatId, '❌ Format: <code>Title | https://link | Reward</code>');
      return true;
    }
    await engine.db.run(
      'INSERT INTO child_tasks (bot_db_id, title, url, reward, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      bot.id,
      title,
      url,
      reward,
      Math.floor(Date.now() / 1000)
    );
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Task "${esc(title)}" added!`, mainMarkup);
    await sendChildTasksMenu(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_promo_add') {
    const parts = text.split('|').map((s) => s.trim());
    const code = (parts[0] || '').toUpperCase();
    const reward = Number(parts[1]);
    const maxUses = Math.floor(Number(parts[2] || 100));
    if (!code || !Number.isFinite(reward) || reward <= 0 || maxUses <= 0) {
      await sendMsg(bot.token, chatId, '❌ Format: <code>CODE | Reward | MaxUses</code>');
      return true;
    }
    await engine.db.run(
      `INSERT INTO child_promos (bot_db_id, code, reward, max_uses, used_count, created_at)
       VALUES (?, ?, ?, ?, 0, ?)
       ON CONFLICT(bot_db_id, code) DO UPDATE SET reward = excluded.reward, max_uses = excluded.max_uses, used_count = 0`,
      bot.id,
      code,
      reward,
      maxUses,
      Math.floor(Date.now() / 1000)
    );
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Promo code <code>${esc(code)}</code> ready!`, mainMarkup);
    await sendChildPromosMenu(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_gplan_add') {
    const parts = text.split('|').map((s) => s.trim());
    const title = parts[0];
    const price = Number(parts[1]);
    if (!title || !Number.isFinite(price) || price <= 0) {
      await sendMsg(bot.token, chatId, '❌ Format: <code>Plan Title | Price</code>');
      return true;
    }
    await engine.db.run(
      'INSERT INTO gmail_plans (bot_db_id, title, price, is_active, created_at) VALUES (?, ?, ?, 1, ?)',
      bot.id,
      title,
      price,
      Math.floor(Date.now() / 1000)
    );
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Gmail plan "${esc(title)}" created!`, mainMarkup);
    await sendChildGmailPlans(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_gplan_stock') {
    const pid = Number(user.state_data);
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      await sendMsg(bot.token, chatId, '❌ Send at least one Gmail account line:');
      return true;
    }
    const now = Math.floor(Date.now() / 1000);
    const stmts = lines.map((acct) =>
      engine.db.prepare(
        'INSERT INTO gmail_stock (bot_db_id, plan_id, account_data, is_sold, created_at) VALUES (?, ?, ?, 0, ?)',
        bot.id,
        pid,
        acct,
        now
      )
    );
    await engine.db.batch(stmts);
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Added <b>${lines.length}</b> Gmail accounts to stock!`, mainMarkup);
    await sendChildGmailPlanDetail(engine, bot, pid, chatId);
    return true;
  }

  if (state === 'ca_dep_qr') {
    if (text.trim().toLowerCase() === 'clear') {
      await engine.db.run("UPDATE bots SET deposit_qr_file_id = '' WHERE id = ?", bot.id);
      bot.deposit_qr_file_id = '';
      await setAdminState(engine, bot.id, userId, '', '');
      await sendMsg(bot.token, chatId, '🗑 QR Code cleared.', mainMarkup);
      await sendChildDepositSettings(engine, bot, chatId);
      return true;
    }
    const photos = msg.photo || [];
    if (photos.length === 0) {
      await sendMsg(bot.token, chatId, '❌ Please send a Photo image for QR (or send <code>clear</code>):');
      return true;
    }
    const fid = photos[photos.length - 1].file_id;
    await engine.db.run('UPDATE bots SET deposit_qr_file_id = ? WHERE id = ?', fid, bot.id);
    bot.deposit_qr_file_id = fid;
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, '✅ Deposit QR updated!', mainMarkup);
    await sendChildDepositSettings(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_dep_upi') {
    const upi = text.trim();
    await engine.db.run('UPDATE bots SET deposit_upi_id = ? WHERE id = ?', upi, bot.id);
    bot.deposit_upi_id = upi;
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, '✅ Deposit UPI ID updated!', mainMarkup);
    await sendChildDepositSettings(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_dep_min') {
    const amt = Number(text.trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      await sendMsg(bot.token, chatId, '❌ Send a valid positive amount:');
      return true;
    }
    await engine.db.run('UPDATE bots SET min_deposit = ? WHERE id = ?', amt, bot.id);
    bot.min_deposit = amt;
    await setAdminState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, `✅ Minimum deposit updated to ${fmtAmount(bot.currency, amt)}.`, mainMarkup);
    await sendChildDepositSettings(engine, bot, chatId);
    return true;
  }

  if (state === 'ca_bc_msg') {
    await setAdminState(engine, bot.id, userId, 'ca_bc_btn', JSON.stringify({ text }));
    await sendMsg(
      bot.token,
      chatId,
      `🔗 <b>Optional Inline Button</b>\n\nSend <code>Button Text | https://link</code> or send <code>skip</code>:`,
      cancelMarkup
    );
    return true;
  }

  if (state === 'ca_bc_btn') {
    let payload = {};
    try {
      payload = JSON.parse(user.state_data || '{}');
    } catch {
      payload = {};
    }
    if (text.trim().toLowerCase() !== 'skip') {
      const parts = text.split('|').map((s) => s.trim());
      if (parts.length < 2 || !/^https?:\/\//i.test(parts[1])) {
        await sendMsg(bot.token, chatId, '❌ Invalid format. Send <code>Text | https://url</code> or <code>skip</code>:');
        return true;
      }
      payload.btnText = parts[0];
      payload.btnUrl = parts[1];
    }
    await setAdminState(engine, bot.id, userId, 'ca_bc_ready', JSON.stringify(payload));
    const previewMarkup = {
      inline_keyboard: [
        ...(payload.btnText && payload.btnUrl ? [[{ text: payload.btnText, url: payload.btnUrl }]] : []),
        [{ text: '🚀 Confirm & Send Broadcast', callback_data: 'ca_bc_exec', style: 'success' }],
      ],
    };
    await sendMsg(bot.token, chatId, '✅ Preview ready:', mainMarkup);
    await sendMsg(bot.token, chatId, payload.text, previewMarkup);
    return true;
  }

  return false;
}
