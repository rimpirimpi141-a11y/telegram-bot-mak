import {
  esc,
  fmtNum,
  fmtDuration,
  fmtDateShort,
  isStarBotType,
  botTypeLabel,
} from './db.js';
import {
  tgApi,
  sendMsg,
  sendPhotoMsg,
  editMsg,
  answerCb,
  checkForceJoin,
  buildForceJoinMarkup,
  resolveChannelInput,
  executeBroadcast,
} from './tgApi.js';

const MASTER_BOT_TYPES = [
  { type: 'upi_normal', setting: 'cost_upi_normal', label: '💸 Normal UPI Bot', def: '5' },
  { type: 'upi_advanced', setting: 'cost_upi_advanced', label: '🚀 Advanced UPI Bot', def: '10' },
  { type: 'redeem_normal', setting: 'cost_redeem_normal', label: '🎟 Normal Redeem Bot', def: '5' },
  { type: 'redeem_advanced', setting: 'cost_redeem_advanced', label: '💎 Advanced Redeem Bot', def: '10' },
  { type: 'star_normal', setting: 'cost_star_normal', label: '⭐ Normal Star Bot', def: '5' },
  { type: 'star_advanced', setting: 'cost_star_advanced', label: '🌟 Advanced Star Bot', def: '10' },
  { type: 'gmail_bot', setting: 'cost_gmail_bot', label: '📧 Gmail Buy & Sell Bot', def: '10' },
];

async function setMasterState(engine, userId, state = '', stateData = '') {
  await engine.db.run(
    'UPDATE master_users SET state = ?, state_data = ? WHERE user_id = ?',
    state,
    stateData,
    userId
  );
}

async function getOrCreateMasterUser(engine, from, referredBy = 0) {
  const userId = Number(from.id);
  const now = Math.floor(Date.now() / 1000);
  const uname = from.username || '';
  const fname = from.first_name || 'User';

  let row = await engine.db.first('SELECT * FROM master_users WHERE user_id = ?', userId);
  if (!row) {
    const validRef = referredBy > 0 && referredBy !== userId ? referredBy : 0;
    await engine.db.run(
      `INSERT OR IGNORE INTO master_users
        (user_id, username, first_name, referred_by, joined_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      userId,
      uname,
      fname,
      validRef,
      now,
      now
    );
    row = await engine.db.first('SELECT * FROM master_users WHERE user_id = ?', userId);
  } else {
    await engine.db.run(
      'UPDATE master_users SET username = ?, first_name = ?, last_active_at = ? WHERE user_id = ?',
      uname,
      fname,
      now,
      userId
    );
    row.username = uname;
    row.first_name = fname;
  }
  return row;
}

export async function creditMasterReferralIfEligible(engine, userId) {
  const user = await engine.db.first('SELECT * FROM master_users WHERE user_id = ?', userId);
  if (!user || Number(user.referred_by) <= 0 || Number(user.ref_credited) === 1) return;

  const requireDev = (await engine.getSetting('master_device_verify', '1')) === '1';
  if (requireDev && Number(user.device_verified) !== 1) return;

  const res = await engine.db.run(
    'UPDATE master_users SET ref_credited = 1 WHERE user_id = ? AND ref_credited = 0 AND referred_by > 0',
    userId
  );
  if (res.changes <= 0) return;

  const refCoins = Number(await engine.getSetting('master_ref_coins', '1')) || 1;
  await engine.db.run(
    'UPDATE master_users SET coins = coins + ?, total_refs = total_refs + 1 WHERE user_id = ?',
    refCoins,
    user.referred_by
  );

  await sendMsg(
    engine.masterToken,
    user.referred_by,
    `🎉 <b>New Verified Referral!</b>\n\n👤 <b>${esc(user.first_name || 'User')}</b> joined & verified via your link.\n🪙 You earned <b>+${fmtNum(refCoins)} Coins</b>!`
  );
}

function masterMainKeyboard(isAdmin) {
  const rows = [
    [
      { text: '🤖 Create Bot', style: 'primary' },
      { text: '📱 My Bots', style: 'primary' },
    ],
    [
      { text: '🎁 Daily Coins', style: 'success' },
      { text: '💳 Buy Coins', style: 'success' },
    ],
    [
      { text: '💰 My Balance' },
      { text: '👥 Refer & Earn' },
    ],
    isAdmin
      ? [{ text: '🆘 Support' }, { text: '🛡 Master Admin', style: 'danger' }]
      : [{ text: '🆘 Support' }],
  ];
  return { keyboard: rows, resize_keyboard: true };
}

function masterCancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ Cancel', style: 'danger' }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export async function sendMasterHome(engine, userId, chatId, prefix = '') {
  const user = await engine.db.first('SELECT * FROM master_users WHERE user_id = ?', userId);
  if (!user) return;
  const isAdmin = await engine.isMasterAdmin(userId);
  const stats = await engine.db.first(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM bots WHERE owner_id = ?',
    userId
  );
  const dailyCoins = await engine.getSetting('daily_coins', '2');
  const masterRef = await engine.getSetting('master_ref_coins', '1');
  const support = await engine.getSetting('support_username', '@Support');

  const lines = [];
  if (prefix) lines.push(`✅ <b>${esc(prefix)}</b>\n`);
  lines.push(`🌟 <b>Bot Maker Factory</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`👋 Welcome, <b>${esc(user.first_name || 'User')}</b>!`);
  lines.push(``);
  lines.push(`🪙 <b>Coins Balance:</b> <code>${fmtNum(user.coins)}</code>`);
  lines.push(`🤖 <b>Your Bots:</b> <code>${Number(stats?.total || 0)}</code> (${Number(stats?.active || 0)} Active)`);
  lines.push(`👥 <b>Total Referrals:</b> <code>${Number(user.total_refs || 0)}</code>`);
  lines.push(``);
  lines.push(`🎁 Daily Bonus: <b>+${esc(dailyCoins)} Coins</b>`);
  lines.push(`👥 Per Refer: <b>+${esc(masterRef)} Coins</b>`);
  lines.push(`🆘 Support: ${esc(support)}`);
  lines.push(``);
  lines.push(`Choose an option below to get started:`);

  await sendMsg(engine.masterToken, chatId, lines.join('\n'), masterMainKeyboard(isAdmin));
}

async function sendDeviceVerifyPrompt(engine, userId, chatId) {
  const link = await engine.createDeviceVerifyLink('master', 0, userId);
  if (!link) {
    await sendMsg(
      engine.masterToken,
      chatId,
      '🛡 <b>Device Verification Required</b>\n\nVerification URL is not configured yet. Please contact the administrator.'
    );
    return;
  }
  await sendMsg(
    engine.masterToken,
    chatId,
    `🛡 <b>Device Verification Required</b>\n\nTo prevent multi-accounting, please verify your device once before using the bot.`,
    {
      inline_keyboard: [
        [{ text: '🛡 Verify My Device', url: link, style: 'primary' }],
        [{ text: '✅ Check Verification', callback_data: 'm_check_dev', style: 'success' }],
      ],
    }
  );
}

async function checkMasterGuards(engine, user, chatId) {
  const userId = Number(user.user_id);
  const isAdmin = await engine.isMasterAdmin(userId);
  if (Number(user.is_banned) === 1 && !isAdmin) {
    await sendMsg(engine.masterToken, chatId, '🚫 <b>You are banned from using this bot.</b>');
    return false;
  }
  const maint = (await engine.getSetting('maintenance', '0')) === '1';
  if (maint && !isAdmin) {
    await sendMsg(
      engine.masterToken,
      chatId,
      '🛠 <b>Maintenance Mode</b>\n\nThe bot is currently under maintenance. Please check back soon.'
    );
    return false;
  }
  if (!isAdmin) {
    const channels = await engine.db.all('SELECT * FROM master_channels ORDER BY id ASC');
    if (channels.length > 0) {
      const unjoined = await checkForceJoin(engine.masterToken, channels, userId);
      if (unjoined.length > 0) {
        await sendMsg(
          engine.masterToken,
          chatId,
          `📢 <b>Join Required Channels</b>\n\nPlease join all channels below, then tap <b>Verify</b>:`,
          buildForceJoinMarkup(unjoined, 'm_verify_join')
        );
        return false;
      }
    }
    const devReq = (await engine.getSetting('master_device_verify', '1')) === '1';
    if (devReq && Number(user.device_verified) !== 1) {
      await sendDeviceVerifyPrompt(engine, userId, chatId);
      return false;
    }
  }
  return true;
}

async function sendCreateBotMenu(engine, user, chatId) {
  const rows = [];
  const lines = [
    `🤖 <b>Create Your Own Telegram Bot</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🪙 Your Balance: <code>${fmtNum(user.coins)}</code> Coins`,
    ``,
    `Select the bot template you want to launch:`,
  ];
  for (const item of MASTER_BOT_TYPES) {
    const cost = await engine.getSetting(item.setting, item.def);
    rows.push([{ text: `${item.label} (${cost} Coins)`, callback_data: `cb_type:${item.type}`, style: 'primary' }]);
  }
  await sendMsg(engine.masterToken, chatId, lines.join('\n'), { inline_keyboard: rows });
}

async function sendMyBotsList(engine, userId, chatId, editMessageId = 0) {
  const bots = await engine.db.all('SELECT * FROM bots WHERE owner_id = ? ORDER BY id DESC', userId);
  if (bots.length === 0) {
    const txt = `📱 <b>My Bots</b>\n\nYou haven't created any bots yet.\nTap <b>🤖 Create Bot</b> to build your first bot!`;
    if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt);
    else await sendMsg(engine.masterToken, chatId, txt);
    return;
  }

  const rows = bots.map((b) => {
    const status = Number(b.is_active) === 1 ? '🟢' : '🔴';
    return [
      {
        text: `${status} @${b.bot_username || 'bot'} · ${botTypeLabel(b.bot_type)}`,
        callback_data: `mb_view:${b.id}`,
      },
    ];
  });
  const text = `📱 <b>My Created Bots (${bots.length})</b>\n\nSelect a bot below to manage it:`;
  const markup = { inline_keyboard: rows };
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, markup);
  else await sendMsg(engine.masterToken, chatId, text, markup);
}

async function sendMyBotDetail(engine, botId, userId, chatId, editMessageId = 0) {
  const bot = await engine.db.first('SELECT * FROM bots WHERE id = ?', botId);
  const isAdmin = await engine.isMasterAdmin(userId);
  if (!bot || (Number(bot.owner_id) !== userId && !isAdmin)) {
    const txt = '❌ Bot not found or access denied.';
    if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt);
    else await sendMsg(engine.masterToken, chatId, txt);
    return;
  }

  const uRow = await engine.db.first('SELECT COUNT(*) AS c FROM child_users WHERE bot_db_id = ?', bot.id);
  const wRow = await engine.db.first(
    "SELECT COUNT(*) AS c FROM withdrawals WHERE bot_db_id = ? AND status = 'pending'",
    bot.id
  );
  const active = Number(bot.is_active) === 1;

  const text = [
    `🤖 <b>@${esc(bot.bot_username)}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🆔 Bot ID: <code>#${bot.id}</code>`,
    `📦 Template: <b>${esc(botTypeLabel(bot.bot_type))}</b>`,
    `⚡ Status: ${active ? '🟢 Active' : '🔴 Paused'}`,
    `👥 Users: <code>${Number(uRow?.c || 0)}</code>`,
    `⏳ Pending Requests: <code>${Number(wRow?.c || 0)}</code>`,
    `📅 Created: ${fmtDateShort(bot.created_at)}`,
    ``,
    `💡 Open your bot and send <code>/admin</code> to manage its Admin Panel!`,
  ].join('\n');

  const markup = {
    inline_keyboard: [
      [
        { text: '🔗 Open Bot', url: `https://t.me/${bot.bot_username}`, style: 'primary' },
        {
          text: active ? '⏸ Pause Bot' : '▶ Resume Bot',
          callback_data: `mb_toggle:${bot.id}`,
          style: active ? 'danger' : 'success',
        },
      ],
      [{ text: '🗑 Delete Bot', callback_data: `mb_del:${bot.id}`, style: 'danger' }],
      [{ text: '🔙 Back to My Bots', callback_data: 'mb_list' }],
    ],
  };

  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, markup);
  else await sendMsg(engine.masterToken, chatId, text, markup);
}

async function sendBuyCoinsInfo(engine, userId, chatId) {
  const enabled = (await engine.getSetting('deposit_enabled', '1')) === '1';
  if (!enabled) {
    await sendMsg(engine.masterToken, chatId, '💳 <b>Coin Deposits</b>\n\nDeposits are currently disabled by admin.');
    return;
  }
  const rs = await engine.getSetting('deposit_rs', '10');
  const coins = await engine.getSetting('deposit_coins', '5');
  const minRs = await engine.getSetting('min_deposit_rs', '10');
  const upi = await engine.getSetting('deposit_upi_id', '');
  const qr = await engine.getSetting('deposit_qr_file_id', '');

  const lines = [
    `💳 <b>Buy Bot Maker Coins</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `💱 <b>Rate:</b> ₹${esc(rs)} = <b>${esc(coins)} Coins</b>`,
    `📉 <b>Minimum Deposit:</b> ₹${esc(minRs)}`,
    upi ? `🏦 <b>UPI ID:</b> <code>${esc(upi)}</code>` : `🏦 <b>UPI ID:</b> Contact Admin`,
    ``,
    `Tap the button below to submit your deposit & UTR.`,
  ];

  const markup = {
    inline_keyboard: [[{ text: '💳 Deposit Now', callback_data: 'm_dep_start', style: 'success' }]],
  };

  if (qr) {
    const r = await sendPhotoMsg(engine.masterToken, chatId, qr, lines.join('\n'), markup);
    if (!r.ok) await sendMsg(engine.masterToken, chatId, lines.join('\n'), markup);
  } else {
    await sendMsg(engine.masterToken, chatId, lines.join('\n'), markup);
  }
}

async function sendMasterAdminHome(engine, chatId, editMessageId = 0) {
  const text = [
    `🛡 <b>Master Admin Control Panel</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `Manage users, deposits, bots, templates, channels, and broadcasts.`,
  ].join('\n');

  const markup = {
    inline_keyboard: [
      [
        { text: '📊 Bot Stats', callback_data: 'ma_stats', style: 'primary' },
        { text: '💳 Pending Deposits', callback_data: 'ma_deps:0', style: 'success' },
      ],
      [
        { text: '👥 Users', callback_data: 'ma_users:0', style: 'primary' },
        { text: '🤖 All Bots', callback_data: 'ma_bots:0', style: 'primary' },
      ],
      [
        { text: '📢 Force Channels', callback_data: 'ma_channels:0' },
        { text: '👑 Admins', callback_data: 'ma_admins' },
      ],
      [
        { text: '🏦 Deposit Settings', callback_data: 'ma_deposit' },
        { text: '⚙ Settings & Costs', callback_data: 'ma_settings' },
      ],
      [{ text: '📣 Broadcast', callback_data: 'ma_broadcast', style: 'danger' }],
    ],
  };

  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, markup);
  else await sendMsg(engine.masterToken, chatId, text, markup);
}

async function sendMasterStats(engine, chatId, editMessageId) {
  const now = Math.floor(Date.now() / 1000);
  const uStats = await engine.db.first(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN (? - last_active_at) <= 86400 THEN 1 ELSE 0 END) AS active24h,
      SUM(CASE WHEN device_verified = 1 THEN 1 ELSE 0 END) AS verified,
      SUM(CASE WHEN is_banned = 1 THEN 1 ELSE 0 END) AS banned,
      COALESCE(SUM(coins), 0) AS totalCoins
     FROM master_users`,
    now
  );
  const dStats = await engine.db.first("SELECT COUNT(*) AS pending FROM deposits WHERE status = 'pending'");
  const bStats = await engine.db.first(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM bots'
  );
  const cStats = await engine.db.first('SELECT COUNT(*) AS total FROM child_users');

  const text = [
    `📊 <b>System Analytics</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `👥 Master Users: <code>${Number(uStats?.total || 0)}</code>`,
    `⚡ Active (24h): <code>${Number(uStats?.active24h || 0)}</code>`,
    `🛡 Verified Devices: <code>${Number(uStats?.verified || 0)}</code>`,
    `🚫 Banned Users: <code>${Number(uStats?.banned || 0)}</code>`,
    `🪙 Coins Held: <code>${fmtNum(uStats?.totalCoins || 0)}</code>`,
    `⏳ Pending Deposits: <code>${Number(dStats?.pending || 0)}</code>`,
    ``,
    `🤖 Created Child Bots: <code>${Number(bStats?.total || 0)}</code> (${Number(bStats?.active || 0)} Active)`,
    `🌐 Total Child Bot Users: <code>${Number(cStats?.total || 0)}</code>`,
  ].join('\n');

  await editMsg(engine.masterToken, chatId, editMessageId, text, {
    inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ma_home' }]],
  });
}

async function sendMasterDepositSettings(engine, chatId, editMessageId = 0) {
  const enabled = (await engine.getSetting('deposit_enabled', '1')) === '1';
  const rs = await engine.getSetting('deposit_rs', '10');
  const coins = await engine.getSetting('deposit_coins', '5');
  const minRs = await engine.getSetting('min_deposit_rs', '10');
  const upi = await engine.getSetting('deposit_upi_id', '');
  const qr = await engine.getSetting('deposit_qr_file_id', '');

  const text = [
    `🏦 <b>Master Deposit Settings</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `⚡ Deposits: ${enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
    `💱 Rate: <b>₹${esc(rs)} = ${esc(coins)} Coins</b>`,
    `📉 Min Deposit: <b>₹${esc(minRs)}</b>`,
    `🏦 UPI ID: <code>${esc(upi || 'Not Set')}</code>`,
    `🖼 QR Code: ${qr ? '✅ Uploaded' : '❌ Not Set'}`,
  ].join('\n');

  const markup = {
    inline_keyboard: [
      [
        {
          text: enabled ? '🔴 Disable Deposits' : '🟢 Enable Deposits',
          callback_data: 'ma_dep_tog',
          style: enabled ? 'danger' : 'success',
        },
      ],
      [
        { text: '🖼 Set QR Photo', callback_data: 'ma_dep_qr', style: 'primary' },
        { text: '🏦 Set UPI ID', callback_data: 'ma_dep_upi', style: 'primary' },
      ],
      [
        { text: '💱 Set Rate (₹ -> Coins)', callback_data: 'ma_dep_rate' },
        { text: '📉 Set Min ₹', callback_data: 'ma_dep_min' },
      ],
      [{ text: '⏳ Pending Deposits', callback_data: 'ma_deps:0', style: 'success' }],
      [{ text: '🔙 Back', callback_data: 'ma_home' }],
    ],
  };

  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, markup);
  else await sendMsg(engine.masterToken, chatId, text, markup);
}

async function sendMasterPendingDeposits(engine, page, chatId, editMessageId = 0) {
  const limit = 5;
  const offset = page * limit;
  const rows = await engine.db.all(
    "SELECT * FROM deposits WHERE status = 'pending' ORDER BY id ASC LIMIT ? OFFSET ?",
    limit,
    offset
  );
  const tot = await engine.db.first("SELECT COUNT(*) AS c FROM deposits WHERE status = 'pending'");
  const total = Number(tot?.c || 0);

  if (total === 0) {
    const txt = `💳 <b>Pending Coin Deposits</b>\n\n✅ No pending deposits right now.`;
    const markup = { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'ma_home' }]] };
    if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt, markup);
    else await sendMsg(engine.masterToken, chatId, txt, markup);
    return;
  }

  const lines = [`💳 <b>Pending Coin Deposits (${total})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
  const kb = [];
  for (const d of rows) {
    lines.push(
      `\n🆔 <b>#${d.id}</b> · User <code>${d.user_id}</code>\n💵 ₹${fmtNum(d.amount_rs)} → 🪙 <b>${fmtNum(d.coins)} Coins</b>\n🔖 UTR: <code>${esc(d.utr)}</code>`
    );
    kb.push([
      { text: `✅ Approve #${d.id}`, callback_data: `ma_dep_ok:${d.id}`, style: 'success' },
      { text: `❌ Reject #${d.id}`, callback_data: `ma_dep_no:${d.id}`, style: 'danger' },
    ]);
  }

  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ma_deps:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ma_deps:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ma_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(engine.masterToken, chatId, txt, { inline_keyboard: kb });
}

async function sendMasterUsersPage(engine, page, chatId, editMessageId = 0) {
  const limit = 8;
  const offset = page * limit;
  const users = await engine.db.all(
    'SELECT user_id, first_name, username, coins, is_banned FROM master_users ORDER BY joined_at DESC LIMIT ? OFFSET ?',
    limit,
    offset
  );
  const tot = await engine.db.first('SELECT COUNT(*) AS c FROM master_users');
  const total = Number(tot?.c || 0);

  const kb = [[{ text: '🔍 Search User by ID / @username', callback_data: 'ma_find_user', style: 'primary' }]];
  for (const u of users) {
    const tag = Number(u.is_banned) === 1 ? '🚫 ' : '';
    const label = `${tag}${u.first_name || 'User'} (${fmtNum(u.coins)} 🪙) [${u.user_id}]`;
    kb.push([{ text: label.slice(0, 60), callback_data: `ma_u_view:${u.user_id}` }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ma_users:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ma_users:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ma_home' }]);

  const txt = `👥 <b>Master Users (${total})</b>\nPage ${page + 1}`;
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(engine.masterToken, chatId, txt, { inline_keyboard: kb });
}

async function sendMasterUserCard(engine, targetUid, chatId, editMessageId = 0) {
  const u = await engine.db.first('SELECT * FROM master_users WHERE user_id = ?', targetUid);
  if (!u) {
    const txt = '❌ User not found.';
    if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt);
    else await sendMsg(engine.masterToken, chatId, txt);
    return;
  }
  const bCount = await engine.db.first('SELECT COUNT(*) AS c FROM bots WHERE owner_id = ?', targetUid);
  const text = [
    `👤 <b>User Profile</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🆔 ID: <code>${u.user_id}</code>`,
    `📛 Name: <b>${esc(u.first_name)}</b> ${u.username ? `(@${esc(u.username)})` : ''}`,
    `🪙 Coins: <code>${fmtNum(u.coins)}</code>`,
    `🤖 Bots Created: <code>${Number(bCount?.c || 0)}</code>`,
    `👥 Referrals: <code>${Number(u.total_refs || 0)}</code>`,
    `🛡 Device Verified: ${Number(u.device_verified) === 1 ? '✅ Yes' : '❌ No'}`,
    `🚫 Banned: ${Number(u.is_banned) === 1 ? 'Yes' : 'No'}`,
    `📅 Joined: ${fmtDateShort(u.joined_at)}`,
  ].join('\n');

  const isBan = Number(u.is_banned) === 1;
  const markup = {
    inline_keyboard: [
      [
        { text: '➕ Add Coins', callback_data: `ma_u_add:${u.user_id}`, style: 'success' },
        { text: '➖ Cut Coins', callback_data: `ma_u_sub:${u.user_id}`, style: 'danger' },
      ],
      [
        {
          text: isBan ? '✅ Unban User' : '🚫 Ban User',
          callback_data: `ma_u_ban:${u.user_id}`,
          style: isBan ? 'success' : 'danger',
        },
      ],
      [{ text: '🔙 Back to Users', callback_data: 'ma_users:0' }],
    ],
  };

  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, markup);
  else await sendMsg(engine.masterToken, chatId, text, markup);
}

async function sendMasterAdminsList(engine, chatId, editMessageId = 0) {
  const extra = await engine.db.all('SELECT * FROM master_admins ORDER BY added_at ASC');
  const lines = [
    `👑 <b>Master Admins</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🔒 <b>Primary Admins (Env):</b> ${engine.primaryAdminIds.map((id) => `<code>${id}</code>`).join(', ') || 'None'}`,
    ``,
    `➕ <b>Added Admins (${extra.length}):</b>`,
  ];
  const kb = [[{ text: '➕ Add New Admin', callback_data: 'ma_admin_add', style: 'success' }]];
  for (const a of extra) {
    lines.push(`• <code>${a.user_id}</code>`);
    kb.push([{ text: `🗑 Remove Admin ${a.user_id}`, callback_data: `ma_admin_del:${a.user_id}`, style: 'danger' }]);
  }
  kb.push([{ text: '🔙 Back', callback_data: 'ma_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(engine.masterToken, chatId, txt, { inline_keyboard: kb });
}

async function sendMasterChannelsPage(engine, page, chatId, editMessageId = 0) {
  const limit = 8;
  const offset = page * limit;
  const rows = await engine.db.all('SELECT * FROM master_channels ORDER BY id ASC LIMIT ? OFFSET ?', limit, offset);
  const tot = await engine.db.first('SELECT COUNT(*) AS c FROM master_channels');
  const total = Number(tot?.c || 0);

  const lines = [
    `📢 <b>Master Force-Join Channels (${total})</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    total === 0 ? `No force-join channels added yet.` : `Users must join all channels listed below:`,
  ];
  const kb = [[{ text: '➕ Add Channel', callback_data: 'ma_ch_add', style: 'success' }]];
  for (const ch of rows) {
    lines.push(`• <b>${esc(ch.title || ch.chat_id)}</b> (<code>${esc(ch.chat_id)}</code>)`);
    kb.push([{ text: `🗑 Remove ${ch.title || ch.chat_id}`, callback_data: `ma_ch_del:${ch.id}`, style: 'danger' }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ma_channels:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ma_channels:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ma_home' }]);

  const txt = lines.join('\n');
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(engine.masterToken, chatId, txt, { inline_keyboard: kb });
}

async function sendMasterSettingsMenu(engine, chatId, editMessageId = 0) {
  const daily = await engine.getSetting('daily_coins', '2');
  const ref = await engine.getSetting('master_ref_coins', '1');
  const supp = await engine.getSetting('support_username', '@Support');
  const maint = (await engine.getSetting('maintenance', '0')) === '1';
  const dev = (await engine.getSetting('master_device_verify', '1')) === '1';

  const costs = {};
  for (const t of MASTER_BOT_TYPES) {
    costs[t.type] = await engine.getSetting(t.setting, t.def);
  }

  const text = [
    `⚙ <b>Master Settings & Bot Prices</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🎁 Daily Coins: <code>${esc(daily)}</code> | 👥 Refer: <code>${esc(ref)}</code>`,
    `🆘 Support: <code>${esc(supp)}</code>`,
    `🛠 Maintenance: ${maint ? '🔴 ON' : '🟢 OFF'} | 🛡 Device Verify: ${dev ? '🟢 ON' : '🔴 OFF'}`,
    ``,
    `<b>Bot Creation Costs (Coins):</b>`,
    `💸 Normal UPI: <code>${esc(costs.upi_normal)}</code> | 🚀 Adv UPI: <code>${esc(costs.upi_advanced)}</code>`,
    `🎟 Normal Redeem: <code>${esc(costs.redeem_normal)}</code> | 💎 Adv Redeem: <code>${esc(costs.redeem_advanced)}</code>`,
    `⭐ Normal Star: <code>${esc(costs.star_normal)}</code> | 🌟 Adv Star: <code>${esc(costs.star_advanced)}</code>`,
    `📧 Gmail Bot: <code>${esc(costs.gmail_bot)}</code>`,
  ].join('\n');

  const kb = [
    [
      { text: `🎁 Daily (${daily})`, callback_data: 'ma_set:daily_coins' },
      { text: `👥 Refer (${ref})`, callback_data: 'ma_set:master_ref_coins' },
    ],
    [
      { text: `💸 Normal UPI (${costs.upi_normal})`, callback_data: 'ma_set:cost_upi_normal' },
      { text: `🚀 Adv UPI (${costs.upi_advanced})`, callback_data: 'ma_set:cost_upi_advanced' },
    ],
    [
      { text: `🎟 Norm Redeem (${costs.redeem_normal})`, callback_data: 'ma_set:cost_redeem_normal' },
      { text: `💎 Adv Redeem (${costs.redeem_advanced})`, callback_data: 'ma_set:cost_redeem_advanced' },
    ],
    [
      { text: `⭐ Norm Star (${costs.star_normal})`, callback_data: 'ma_set:cost_star_normal' },
      { text: `🌟 Adv Star (${costs.star_advanced})`, callback_data: 'ma_set:cost_star_advanced' },
    ],
    [
      { text: `📧 Gmail Bot (${costs.gmail_bot})`, callback_data: 'ma_set:cost_gmail_bot' },
      { text: `🆘 Support`, callback_data: 'ma_set:support_username' },
    ],
    [
      {
        text: maint ? '🟢 Maintenance: ON' : '⚪ Maintenance: OFF',
        callback_data: 'ma_toggle_maint',
        style: maint ? 'danger' : 'success',
      },
      {
        text: dev ? '🛡 Dev Verify: ON' : '⚪ Dev Verify: OFF',
        callback_data: 'ma_toggle_dev',
        style: dev ? 'success' : 'danger',
      },
    ],
    [{ text: '🔙 Back', callback_data: 'ma_home' }],
  ];

  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, { inline_keyboard: kb });
  else await sendMsg(engine.masterToken, chatId, text, { inline_keyboard: kb });
}

async function sendMasterBotsPage(engine, page, chatId, editMessageId = 0) {
  const limit = 8;
  const offset = page * limit;
  const bots = await engine.db.all('SELECT * FROM bots ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset);
  const tot = await engine.db.first('SELECT COUNT(*) AS c FROM bots');
  const total = Number(tot?.c || 0);

  const kb = [];
  for (const b of bots) {
    const st = Number(b.is_active) === 1 ? '🟢' : '🔴';
    kb.push([{ text: `${st} #${b.id} @${b.bot_username} (Owner ${b.owner_id})`, callback_data: `ma_bot_v:${b.id}` }]);
  }
  const nav = [];
  if (page > 0) nav.push({ text: '⬅ Prev', callback_data: `ma_bots:${page - 1}` });
  if (offset + limit < total) nav.push({ text: 'Next ➡', callback_data: `ma_bots:${page + 1}` });
  if (nav.length) kb.push(nav);
  kb.push([{ text: '🔙 Back', callback_data: 'ma_home' }]);

  const txt = `🤖 <b>All Created Bots (${total})</b>\nPage ${page + 1}`;
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, txt, { inline_keyboard: kb });
  else await sendMsg(engine.masterToken, chatId, txt, { inline_keyboard: kb });
}

async function sendMasterBotAdminDetail(engine, botId, chatId, editMessageId = 0) {
  const bot = await engine.db.first('SELECT * FROM bots WHERE id = ?', botId);
  if (!bot) {
    if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, '❌ Bot not found.');
    return;
  }
  const uRow = await engine.db.first('SELECT COUNT(*) AS c FROM child_users WHERE bot_db_id = ?', bot.id);
  const active = Number(bot.is_active) === 1;

  const text = [
    `🤖 <b>Child Bot #${bot.id}</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `🔗 Username: @${esc(bot.bot_username)}`,
    `👤 Owner ID: <code>${bot.owner_id}</code>`,
    `📦 Type: <b>${esc(botTypeLabel(bot.bot_type))}</b>`,
    `⚡ Status: ${active ? '🟢 Active' : '🔴 Paused'}`,
    `👥 Users: <code>${Number(uRow?.c || 0)}</code>`,
    `📅 Created: ${fmtDateShort(bot.created_at)}`,
  ].join('\n');

  const markup = {
    inline_keyboard: [
      [
        {
          text: active ? '⏸ Pause Bot' : '▶ Resume Bot',
          callback_data: `ma_bot_tog:${bot.id}`,
          style: active ? 'danger' : 'success',
        },
        { text: '🗑 Delete Bot', callback_data: `ma_bot_del:${bot.id}`, style: 'danger' },
      ],
      [{ text: '🔙 Back to All Bots', callback_data: 'ma_bots:0' }],
    ],
  };
  if (editMessageId) await editMsg(engine.masterToken, chatId, editMessageId, text, markup);
  else await sendMsg(engine.masterToken, chatId, text, markup);
}

const ALLOWED_MASTER_SETTINGS = new Set([
  'daily_coins',
  'master_ref_coins',
  'support_username',
  'cost_upi_normal',
  'cost_upi_advanced',
  'cost_redeem_normal',
  'cost_redeem_advanced',
  'cost_star_normal',
  'cost_star_advanced',
  'cost_gmail_bot',
]);

async function handleMasterCallback(engine, cb) {
  const userId = Number(cb.from.id);
  const chatId = Number(cb.message?.chat?.id || userId);
  const msgId = Number(cb.message?.message_id || 0);
  const data = cb.data || '';

  const user = await getOrCreateMasterUser(engine, cb.from);
  const isAdmin = await engine.isMasterAdmin(userId);

  if (data === 'm_verify_join') {
    const channels = await engine.db.all('SELECT * FROM master_channels ORDER BY id ASC');
    const unjoined = await checkForceJoin(engine.masterToken, channels, userId);
    if (unjoined.length > 0) {
      await answerCb(engine.masterToken, cb.id, '❌ Please join all required channels first!', true);
      return;
    }
    await answerCb(engine.masterToken, cb.id, '✅ Channels verified!');
    const devReq = (await engine.getSetting('master_device_verify', '1')) === '1';
    if (devReq && Number(user.device_verified) !== 1 && !isAdmin) {
      await sendDeviceVerifyPrompt(engine, userId, chatId);
      return;
    }
    await creditMasterReferralIfEligible(engine, userId);
    await sendMasterHome(engine, userId, chatId, 'Verified!');
    return;
  }

  if (data === 'm_check_dev') {
    const fresh = await engine.db.first('SELECT * FROM master_users WHERE user_id = ?', userId);
    if (fresh && Number(fresh.device_verified) === 1) {
      await answerCb(engine.masterToken, cb.id, '✅ Device is verified!');
      await creditMasterReferralIfEligible(engine, userId);
      await sendMasterHome(engine, userId, chatId, 'Device Verified!');
    } else {
      await answerCb(engine.masterToken, cb.id, '❌ Not verified yet. Tap "Verify My Device" link first.', true);
    }
    return;
  }

  if (data === 'm_dep_start') {
    await answerCb(engine.masterToken, cb.id);
    if (!(await checkMasterGuards(engine, user, chatId))) return;
    const minRs = await engine.getSetting('min_deposit_rs', '10');
    await setMasterState(engine, userId, 'm_dep_amt', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `💳 <b>Enter Deposit Amount (₹)</b>\n\nMinimum: ₹${esc(minRs)}\nSend the amount in numbers (e.g. <code>20</code>):`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('cb_type:')) {
    const botType = data.slice(8);
    const meta = MASTER_BOT_TYPES.find((t) => t.type === botType);
    if (!meta) {
      await answerCb(engine.masterToken, cb.id, '❌ Unknown template.', true);
      return;
    }
    const cost = Number(await engine.getSetting(meta.setting, meta.def)) || 5;
    if (Number(user.coins) < cost) {
      await answerCb(
        engine.masterToken,
        cb.id,
        `❌ Need ${cost} Coins! You have ${fmtNum(user.coins)} Coins. Claim Daily Coins or Buy Coins.`,
        true
      );
      return;
    }
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'await_bot_token', JSON.stringify({ botType }));
    await sendMsg(
      engine.masterToken,
      chatId,
      `🤖 <b>Create ${esc(meta.label)}</b>\n💰 Cost: <b>${cost} Coins</b>\n\n1️⃣ Open @BotFather & send <code>/newbot</code>\n2️⃣ Copy the Bot Token and paste it here:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data === 'mb_list') {
    await answerCb(engine.masterToken, cb.id);
    await sendMyBotsList(engine, userId, chatId, msgId);
    return;
  }

  if (data.startsWith('mb_view:')) {
    await answerCb(engine.masterToken, cb.id);
    await sendMyBotDetail(engine, Number(data.slice(8)), userId, chatId, msgId);
    return;
  }

  if (data.startsWith('mb_toggle:')) {
    const botId = Number(data.slice(10));
    const bot = await engine.db.first('SELECT * FROM bots WHERE id = ?', botId);
    if (!bot || (Number(bot.owner_id) !== userId && !isAdmin)) {
      await answerCb(engine.masterToken, cb.id, '❌ Access denied.', true);
      return;
    }
    const newActive = Number(bot.is_active) === 1 ? 0 : 1;
    await engine.db.run('UPDATE bots SET is_active = ? WHERE id = ?', newActive, botId);
    await engine.syncChildWebhook(botId, bot.token, newActive === 1);
    await answerCb(engine.masterToken, cb.id, newActive === 1 ? '▶ Bot Resumed!' : '⏸ Bot Paused!');
    await sendMyBotDetail(engine, botId, userId, chatId, msgId);
    return;
  }

  if (data.startsWith('mb_del:')) {
    const botId = Number(data.slice(7));
    await answerCb(engine.masterToken, cb.id);
    await editMsg(
      engine.masterToken,
      chatId,
      msgId,
      `⚠ <b>Delete Bot #${botId}?</b>\n\nThis will permanently remove the bot and all its user data.`,
      {
        inline_keyboard: [
          [{ text: '🗑 Yes, Delete Permanently', callback_data: `mb_del_ok:${botId}`, style: 'danger' }],
          [{ text: '🔙 Cancel', callback_data: `mb_view:${botId}` }],
        ],
      }
    );
    return;
  }

  if (data.startsWith('mb_del_ok:')) {
    const botId = Number(data.slice(10));
    const bot = await engine.db.first('SELECT * FROM bots WHERE id = ?', botId);
    if (!bot || (Number(bot.owner_id) !== userId && !isAdmin)) {
      await answerCb(engine.masterToken, cb.id, '❌ Access denied.', true);
      return;
    }
    await engine.syncChildWebhook(botId, bot.token, false);
    await engine.db.run('DELETE FROM bots WHERE id = ?', botId);
    await answerCb(engine.masterToken, cb.id, '🗑 Bot deleted.');
    await sendMyBotsList(engine, userId, chatId, msgId);
    return;
  }

  if (!data.startsWith('ma_')) {
    await answerCb(engine.masterToken, cb.id);
    return;
  }

  if (!isAdmin) {
    await answerCb(engine.masterToken, cb.id, '❌ Master Admin only.', true);
    return;
  }

  if (data === 'ma_home') {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterAdminHome(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_stats') {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterStats(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_admins') {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterAdminsList(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_admin_add') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_admin_add', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `👑 <b>Add Master Admin</b>\n\nSend the Telegram numeric User ID of the new admin:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('ma_admin_del:')) {
    const targetId = Number(data.slice(13));
    if (engine.primaryAdminIds.includes(targetId)) {
      await answerCb(engine.masterToken, cb.id, '🔒 Primary env admin cannot be removed.', true);
      return;
    }
    await engine.db.run('DELETE FROM master_admins WHERE user_id = ?', targetId);
    await answerCb(engine.masterToken, cb.id, '🗑 Admin removed.');
    await sendMasterAdminsList(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_deposit') {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterDepositSettings(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_dep_tog') {
    const cur = (await engine.getSetting('deposit_enabled', '1')) === '1';
    await engine.setSetting('deposit_enabled', cur ? '0' : '1');
    await answerCb(engine.masterToken, cb.id, cur ? '🔴 Deposits Disabled' : '🟢 Deposits Enabled');
    await sendMasterDepositSettings(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_dep_qr') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_dep_qr', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `🖼 <b>Set Deposit QR Photo</b>\n\nSend the QR Code image (photo), or send <code>clear</code> to remove it:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data === 'ma_dep_upi') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_dep_upi', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `🏦 <b>Set Deposit UPI ID</b>\n\nSend the UPI ID (e.g. <code>name@upi</code>):`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data === 'ma_dep_rate') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine.masterToken, userId, 'ma_dep_rate', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `💱 <b>Set Coin Rate</b>\n\nSend format <code>RS COINS</code> (example: <code>10 5</code> means ₹10 = 5 Coins):`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data === 'ma_dep_min') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_dep_min', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `📉 <b>Set Minimum Deposit (₹)</b>\n\nSend the minimum amount in ₹ (e.g. <code>10</code>):`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('ma_deps:')) {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterPendingDeposits(engine, Number(data.slice(8)) || 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ma_dep_ok:')) {
    const depId = Number(data.slice(10));
    const dep = await engine.db.first('SELECT * FROM deposits WHERE id = ?', depId);
    if (!dep || dep.status !== 'pending') {
      await answerCb(engine.masterToken, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE deposits SET status = 'approved', processed_by = ?, processed_at = ? WHERE id = ? AND status = 'pending'",
      userId,
      now,
      depId
    );
    if (upd.changes <= 0) {
      await answerCb(engine.masterToken, cb.id, '⚠ Already processed.', true);
      return;
    }
    await engine.db.run('UPDATE master_users SET coins = coins + ? WHERE user_id = ?', dep.coins, dep.user_id);
    await answerCb(engine.masterToken, cb.id, '✅ Deposit Approved!');
    await sendMsg(
      engine.masterToken,
      dep.user_id,
      `✅ <b>Deposit Approved! (#${depId})</b>\n\n💵 Paid: ₹${fmtNum(dep.amount_rs)}\n🪙 Credited: <b>+${fmtNum(dep.coins)} Coins</b>`
    );
    if (cb.message?.photo) {
      await sendMasterPendingDeposits(engine, 0, chatId);
    } else {
      await sendMasterPendingDeposits(engine, 0, chatId, msgId);
    }
    return;
  }

  if (data.startsWith('ma_dep_no:')) {
    const depId = Number(data.slice(10));
    const dep = await engine.db.first('SELECT * FROM deposits WHERE id = ?', depId);
    if (!dep || dep.status !== 'pending') {
      await answerCb(engine.masterToken, cb.id, '⚠ Already processed.', true);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const upd = await engine.db.run(
      "UPDATE deposits SET status = 'rejected', processed_by = ?, processed_at = ? WHERE id = ? AND status = 'pending'",
      userId,
      now,
      depId
    );
    if (upd.changes <= 0) {
      await answerCb(engine.masterToken, cb.id, '⚠ Already processed.', true);
      return;
    }
    await answerCb(engine.masterToken, cb.id, '❌ Deposit Rejected.');
    await sendMsg(
      engine.masterToken,
      dep.user_id,
      `❌ <b>Deposit Rejected (#${depId})</b>\n\n💵 Amount: ₹${fmtNum(dep.amount_rs)}\n🔖 UTR: <code>${esc(dep.utr)}</code>\nPlease contact support if you think this is a mistake.`
    );
    if (cb.message?.photo) {
      await sendMasterPendingDeposits(engine, 0, chatId);
    } else {
      await sendMasterPendingDeposits(engine, 0, chatId, msgId);
    }
    return;
  }

  if (data.startsWith('ma_users:')) {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterUsersPage(engine, Number(data.slice(9)) || 0, chatId, msgId);
    return;
  }

  if (data === 'ma_find_user') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_find_user', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `🔍 <b>Find Master User</b>\n\nSend numeric User ID or <code>@username</code>:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('ma_u_view:')) {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterUserCard(engine, Number(data.slice(10)), chatId, msgId);
    return;
  }

  if (data.startsWith('ma_u_add:')) {
    const targetUid = Number(data.slice(9));
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_add_coins', String(targetUid));
    await sendMsg(
      engine.masterToken,
      chatId,
      `➕ <b>Add Coins to User <code>${targetUid}</code></b>\n\nEnter coin amount:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('ma_u_sub:')) {
    const targetUid = Number(data.slice(9));
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_sub_coins', String(targetUid));
    await sendMsg(
      engine.masterToken,
      chatId,
      `➖ <b>Cut Coins from User <code>${targetUid}</code></b>\n\nEnter coin amount:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('ma_u_ban:')) {
    const targetUid = Number(data.slice(9));
    const target = await engine.db.first('SELECT is_banned FROM master_users WHERE user_id = ?', targetUid);
    if (!target) {
      await answerCb(engine.masterToken, cb.id, '❌ User not found.', true);
      return;
    }
    const newBan = Number(target.is_banned) === 1 ? 0 : 1;
    await engine.db.run('UPDATE master_users SET is_banned = ? WHERE user_id = ?', newBan, targetUid);
    await answerCb(engine.masterToken, cb.id, newBan === 1 ? '🚫 User Banned.' : '✅ User Unbanned.');
    await sendMasterUserCard(engine, targetUid, chatId, msgId);
    return;
  }

  if (data === 'ma_channels' || data.startsWith('ma_channels:')) {
    const page = data.includes(':') ? Number(data.split(':')[1]) || 0 : 0;
    await answerCb(engine.masterToken, cb.id);
    await sendMasterChannelsPage(engine, page, chatId, msgId);
    return;
  }

  if (data === 'ma_ch_add') {
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, 'ma_add_channel', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `📢 <b>Add Force-Join Channel</b>\n\nMake this bot Admin in the channel first, then send:\n• Public: <code>@channelusername</code>\n• Private: <code>-1001234567890 | https://t.me/+InviteLink</code>`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('ma_ch_del:')) {
    const chId = Number(data.slice(10));
    await engine.db.run('DELETE FROM master_channels WHERE id = ?', chId);
    await answerCb(engine.masterToken, cb.id, '🗑 Channel removed.');
    await sendMasterChannelsPage(engine, 0, chatId, msgId);
    return;
  }

  if (data === 'ma_settings') {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterSettingsMenu(engine, chatId, msgId);
    return;
  }

  if (data.startsWith('ma_set:')) {
    const key = data.slice(7);
    if (!ALLOWED_MASTER_SETTINGS.has(key)) {
      await answerCb(engine.masterToken, cb.id, '❌ Invalid setting.', true);
      return;
    }
    await answerCb(engine.masterToken, cb.id);
    await setMasterState(engine, userId, `ma_set:${key}`, '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `✏ <b>Update Setting: <code>${esc(key)}</code></b>\n\nSend the new value:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data === 'ma_toggle_maint') {
    const cur = (await engine.getSetting('maintenance', '0')) === '1';
    await engine.setSetting('maintenance', cur ? '0' : '1');
    await answerCb(engine.masterToken, cb.id, cur ? '🟢 Maintenance OFF' : '🔴 Maintenance ON');
    await sendMasterSettingsMenu(engine, chatId, msgId);
    return;
  }

  if (data === 'ma_toggle_dev') {
    const cur = (await engine.getSetting('master_device_verify', '1')) === '1';
    await engine.setSetting('master_device_verify', cur ? '0' : '1');
    await answerCb(engine.masterToken, cb.id, cur ? '⚪ Device Verify OFF' : '🛡 Device Verify ON');
    await sendMasterSettingsMenu(engine, chatId, msgId);
    return;
  }

  if (data.startsWith('ma_bots:')) {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterBotsPage(engine, Number(data.slice(8)) || 0, chatId, msgId);
    return;
  }

  if (data.startsWith('ma_bot_v:')) {
    await answerCb(engine.masterToken, cb.id);
    await sendMasterBotAdminDetail(engine, Number(data.slice(9)), chatId, msgId);
    return;
  }

  if (data.startsWith('ma_bot_tog:')) {
    const botId = Number(data.slice(11));
    const bot = await engine.db.first('SELECT * FROM bots WHERE id = ?', botId);
    if (!bot) {
      await answerCb(engine.masterToken, cb.id, '❌ Not found.', true);
      return;
    }
    const newActive = Number(bot.is_active) === 1 ? 0 : 1;
    await engine.db.run('UPDATE bots SET is_active = ? WHERE id = ?', newActive, botId);
    await engine.syncChildWebhook(botId, bot.token, newActive === 1);
    await answerCb(engine.masterToken, cb.id, newActive === 1 ? '▶ Resumed' : '⏸ Paused');
    await sendMasterBotAdminDetail(engine, botId, chatId, msgId);
    return;
  }

  if (data.startsWith('ma_bot_del:')) {
    const botId = Number(data.slice(11));
    const bot = await engine.db.first('SELECT * FROM bots WHERE id = ?', botId);
    if (!bot) {
      await answerCb(engine.masterToken, cb.id, '❌ Not found.', true);
      return;
    }
    await engine.syncChildWebhook(botId, bot.token, false);
    await engine.db.run('DELETE FROM bots WHERE id = ?', botId);
    await answerCb(engine.masterToken, cb.id, '🗑 Bot deleted.');
    await sendMasterBotsPage(engine, 0, chatId, msgId);
    return;
  }

  if (data === 'ma_broadcast') {
    await answerCb(engine.masterToken, cb.id);
    await editMsg(
      engine.masterToken,
      chatId,
      msgId,
      `📣 <b>Master Broadcast</b>\n━━━━━━━━━━━━━━━━━━━━━\nSelect who should receive the broadcast:`,
      {
        inline_keyboard: [
          [{ text: '👥 All Master Bot Users', callback_data: 'ma_bc_t:master', style: 'primary' }],
          [{ text: '👑 Bot Owners Only', callback_data: 'ma_bc_t:owners', style: 'primary' }],
          [{ text: '🤖 Specific Child Bot Users', callback_data: 'ma_bc_t:bot', style: 'success' }],
          [{ text: '🌐 ALL Child Bots Users', callback_data: 'ma_bc_t:all_child', style: 'danger' }],
          [{ text: '🔙 Back', callback_data: 'ma_home' }],
        ],
      }
    );
    return;
  }

  if (data.startsWith('ma_bc_t:')) {
    const target = data.slice(8);
    await answerCb(engine.masterToken, cb.id);
    if (target === 'bot') {
      await setMasterState(engine, userId, 'ma_bc_pick_bot', '');
      await sendMsg(
        engine.masterToken,
        chatId,
        `🤖 <b>Broadcast to Child Bot</b>\n\nSend the Bot numeric ID (e.g. <code>1</code>) or <code>@botusername</code>:`,
        masterCancelKeyboard()
      );
      return;
    }
    await setMasterState(engine, userId, 'ma_bc_msg', JSON.stringify({ target, botId: 0 }));
    await sendMsg(
      engine.masterToken,
      chatId,
      `📣 <b>Send Broadcast Message</b>\n\nHTML formatting supported (e.g. &lt;b&gt;Bold&lt;/b&gt;). Send your message:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (data === 'ma_bc_exec') {
    let payload = {};
    try {
      payload = JSON.parse(user.state_data || '{}');
    } catch {
      payload = {};
    }
    if (!payload.text) {
      await answerCb(engine.masterToken, cb.id, '❌ Broadcast session expired.', true);
      return;
    }
    await setMasterState(engine, userId, '', '');
    await answerCb(engine.masterToken, cb.id, '🚀 Broadcast queued!');
    await editMsg(engine.masterToken, chatId, msgId, '⏳ <b>Broadcasting in background...</b>');

    const inlineMarkup =
      payload.btnText && payload.btnUrl
        ? { inline_keyboard: [[{ text: payload.btnText, url: payload.btnUrl, style: 'primary' }]] }
        : undefined;

    engine.runBackground(
      (async () => {
        if (payload.target === 'all_child') {
          const bots = await engine.db.all('SELECT id, token FROM bots WHERE is_active = 1');
          let sent = 0;
          let failed = 0;
          for (const b of bots) {
            const cUsers = await engine.db.all('SELECT user_id FROM child_users WHERE bot_db_id = ?', b.id);
            const r = await executeBroadcast(
              b.token,
              cUsers.map((u) => Number(u.user_id)),
              payload.text,
              inlineMarkup
            );
            sent += r.sent;
            failed += r.failed;
          }
          await sendMsg(
            engine.masterToken,
            chatId,
            `✅ <b>All-Child Broadcast Complete!</b>\n\n🤖 Bots: <code>${bots.length}</code>\n📨 Delivered: <code>${sent}</code>\n❌ Failed: <code>${failed}</code>`
          );
          return;
        }

        if (payload.target === 'bot' && payload.botId) {
          const b = await engine.db.first('SELECT id, token, bot_username FROM bots WHERE id = ?', payload.botId);
          if (!b) return;
          const cUsers = await engine.db.all('SELECT user_id FROM child_users WHERE bot_db_id = ?', b.id);
          const r = await executeBroadcast(
            b.token,
            cUsers.map((u) => Number(u.user_id)),
            payload.text,
            inlineMarkup
          );
          await sendMsg(
            engine.masterToken,
            chatId,
            `✅ <b>Child Bot Broadcast Complete!</b> (@${esc(b.bot_username)})\n\n📨 Delivered: <code>${r.sent}</code>\n❌ Failed: <code>${r.failed}</code>`
          );
          return;
        }

        const rows =
          payload.target === 'owners'
            ? await engine.db.all('SELECT DISTINCT owner_id AS user_id FROM bots')
            : await engine.db.all('SELECT user_id FROM master_users WHERE is_banned = 0');
        const r = await executeBroadcast(
          engine.masterToken,
          rows.map((u) => Number(u.user_id)),
          payload.text,
          inlineMarkup
        );
        await sendMsg(
          engine.masterToken,
          chatId,
          `✅ <b>Master Broadcast Complete!</b>\n\n📨 Delivered: <code>${r.sent}</code>\n❌ Failed: <code>${r.failed}</code>`
        );
      })()
    );
  }
}

async function handleMasterStateInput(engine, user, msg, chatId, text, isAdmin) {
  const userId = Number(user.user_id);
  const state = user.state || '';

  if (state === 'm_dep_amt') {
    const amt = Number(text);
    const minRs = Number(await engine.getSetting('min_deposit_rs', '10')) || 10;
    const rateRs = Number(await engine.getSetting('deposit_rs', '10')) || 10;
    const rateCoins = Number(await engine.getSetting('deposit_coins', '5')) || 5;
    if (!Number.isFinite(amt) || amt < minRs) {
      await sendMsg(engine.masterToken, chatId, `❌ Minimum deposit is ₹${minRs}. Enter a valid number:`);
      return;
    }
    const coins = Number(((amt / rateRs) * rateCoins).toFixed(2));
    const upi = await engine.getSetting('deposit_upi_id', '');
    await setMasterState(engine, userId, 'm_dep_utr', JSON.stringify({ amount: amt, coins }));
    await sendMsg(
      engine.masterToken,
      chatId,
      `💳 <b>Step 2: Complete Payment</b>\n\n💵 Pay: <b>₹${fmtNum(amt)}</b>\n🪙 You Receive: <b>${fmtNum(coins)} Coins</b>\n${upi ? `🏦 UPI ID: <code>${esc(upi)}</code>\n` : ''}\nAfter paying, send your <b>UTR / Transaction ID</b> (you can also attach a payment screenshot with UTR in caption):`,
      masterCancelKeyboard()
    );
    return;
  }

  if (state === 'm_dep_utr') {
    let parsed = {};
    try {
      parsed = JSON.parse(user.state_data || '{}');
    } catch {
      parsed = {};
    }
    const utr = text.trim();
    const photos = msg.photo || [];
    const fileId = photos.length > 0 ? photos[photos.length - 1].file_id : '';
    if (!utr && !fileId) {
      await sendMsg(engine.masterToken, chatId, '❌ Please send the UTR / Transaction ID or screenshot:');
      return;
    }
    const finalUtr = utr || 'Screenshot Attached';
    const now = Math.floor(Date.now() / 1000);
    const res = await engine.db.run(
      `INSERT INTO deposits (user_id, amount_rs, coins, utr, screenshot_file_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      userId,
      Number(parsed.amount || 0),
      Number(parsed.coins || 0),
      finalUtr,
      fileId,
      now
    );
    await setMasterState(engine, userId, '', '');
    await sendMsg(
      engine.masterToken,
      chatId,
      `✅ <b>Deposit Request Submitted! (#${res.lastRowId})</b>\n\n💵 ₹${fmtNum(parsed.amount)} → 🪙 ${fmtNum(parsed.coins)} Coins\n🔖 UTR: <code>${esc(finalUtr)}</code>\n\nAdmin will review and approve shortly.`,
      masterMainKeyboard(isAdmin)
    );

    const admins = await engine.getAllMasterAdmins();
    const adminNotice = `🔔 <b>New Coin Deposit Request #${res.lastRowId}</b>\n\n👤 User: <b>${esc(user.first_name)}</b> (<code>${userId}</code>)\n💵 Amount: ₹${fmtNum(parsed.amount)}\n🪙 Coins: <b>${fmtNum(parsed.coins)}</b>\n🔖 UTR: <code>${esc(finalUtr)}</code>`;
    const adminMarkup = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `ma_dep_ok:${res.lastRowId}`, style: 'success' },
          { text: '❌ Reject', callback_data: `ma_dep_no:${res.lastRowId}`, style: 'danger' },
        ],
      ],
    };
    for (const adm of admins) {
      if (fileId) await sendPhotoMsg(engine.masterToken, adm, fileId, adminNotice, adminMarkup);
      else await sendMsg(engine.masterToken, adm, adminNotice, adminMarkup);
    }
    return;
  }

  if (state === 'await_bot_token') {
    let parsed = {};
    try {
      parsed = JSON.parse(user.state_data || '{}');
    } catch {
      parsed = {};
    }
    const botType = parsed.botType || 'upi_normal';
    const meta = MASTER_BOT_TYPES.find((t) => t.type === botType) || MASTER_BOT_TYPES[0];
    const tokenInput = text.trim();

    if (!/^\d{6,15}:[A-Za-z0-9_-]{25,70}$/.test(tokenInput)) {
      await sendMsg(engine.masterToken, chatId, '❌ Invalid Bot Token format. Please paste the exact token from @BotFather:');
      return;
    }

    const dup = await engine.db.first('SELECT id FROM bots WHERE token = ?', tokenInput);
    if (dup) {
      await sendMsg(engine.masterToken, chatId, '❌ This bot token is already registered.');
      return;
    }

    const me = await tgApi(tokenInput, 'getMe');
    if (!me.ok || !me.result || !me.result.is_bot) {
      await sendMsg(
        engine.masterToken,
        chatId,
        `❌ Telegram rejected this token (${esc(me.description || 'Invalid token')}). Check and try again:`
      );
      return;
    }

    const cost = Number(await engine.getSetting(meta.setting, meta.def)) || 5;
    const deduct = await engine.db.run(
      "UPDATE master_users SET coins = coins - ?, state = '', state_data = '' WHERE user_id = ? AND coins >= ?",
      cost,
      userId,
      cost
    );
    if (deduct.changes <= 0) {
      await setMasterState(engine, userId, '', '');
      await sendMsg(engine.masterToken, chatId, '❌ Insufficient coins.', masterMainKeyboard(isAdmin));
      return;
    }

    const isStar = isStarBotType(botType);
    const currency = isStar ? '⭐' : '₹';
    const perRefer = isStar ? 2 : 10;
    const minWithdraw = isStar ? 15 : 50;
    const dailyBonus = isStar ? 1 : 5;
    const support = await engine.getSetting('support_username', '@Support');
    const now = Math.floor(Date.now() / 1000);

    const ins = await engine.db.run(
      `INSERT INTO bots
        (owner_id, token, bot_id_tg, bot_username, bot_name, bot_type, is_active, per_refer, min_withdraw, daily_bonus, currency, support_username, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
      userId,
      tokenInput,
      Number(me.result.id),
      me.result.username || '',
      me.result.first_name || 'Bot',
      botType,
      perRefer,
      minWithdraw,
      dailyBonus,
      currency,
      support,
      now
    );

    const botDbId = ins.lastRowId;
    const wh = await engine.syncChildWebhook(botDbId, tokenInput, true);

    const lines = [
      `🎉 <b>Bot Created & Live!</b>`,
      `━━━━━━━━━━━━━━━━━━━━━`,
      `🤖 Bot: @${esc(me.result.username)}`,
      `📦 Template: <b>${esc(meta.label)}</b>`,
      `🪙 Cost Deducted: <b>${cost} Coins</b>`,
      `🌐 Webhook: ${wh.ok ? '🟢 Connected' : `⚠ Pending (${esc(wh.description || 'Run /setup')})`}`,
      ``,
      `Open your bot and send <code>/admin</code> to customize settings, force channels, rewards, and withdrawals!`,
    ];

    await sendMsg(engine.masterToken, chatId, lines.join('\n'), {
      inline_keyboard: [
        [{ text: `🚀 Open @${me.result.username}`, url: `https://t.me/${me.result.username}`, style: 'primary' }],
        [{ text: '📱 Manage My Bots', callback_data: 'mb_list', style: 'success' }],
      ],
    });
    await sendMsg(engine.masterToken, chatId, '✅ Returned to Main Menu.', masterMainKeyboard(isAdmin));
    return;
  }

  if (!isAdmin) {
    await setMasterState(engine, userId, '', '');
    return;
  }

  if (state === 'ma_admin_add') {
    const targetId = Number(text.trim());
    if (!Number.isInteger(targetId) || targetId <= 0) {
      await sendMsg(engine.masterToken, chatId, '❌ Send a valid numeric Telegram User ID:');
      return;
    }
    await engine.db.run(
      'INSERT OR IGNORE INTO master_admins (user_id, added_by, added_at) VALUES (?, ?, ?)',
      targetId,
      userId,
      Math.floor(Date.now() / 1000)
    );
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, `✅ Added <code>${targetId}</code> as Master Admin.`, masterMainKeyboard(true));
    await sendMasterAdminsList(engine, chatId);
    return;
  }

  if (state === 'ma_dep_qr') {
    if (text.trim().toLowerCase() === 'clear') {
      await engine.setSetting('deposit_qr_file_id', '');
      await setMasterState(engine, userId, '', '');
      await sendMsg(engine.masterToken, chatId, '🗑 QR Code cleared.', masterMainKeyboard(true));
      await sendMasterDepositSettings(engine, chatId);
      return;
    }
    const photos = msg.photo || [];
    if (photos.length === 0) {
      await sendMsg(engine.masterToken, chatId, '❌ Please send a Photo image for QR Code (or send <code>clear</code>):');
      return;
    }
    const fid = photos[photos.length - 1].file_id;
    await engine.setSetting('deposit_qr_file_id', fid);
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, '✅ Deposit QR Code updated!', masterMainKeyboard(true));
    await sendMasterDepositSettings(engine, chatId);
    return;
  }

  if (state === 'ma_dep_upi') {
    await engine.setSetting('deposit_upi_id', text.trim());
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, '✅ Deposit UPI ID updated!', masterMainKeyboard(true));
    await sendMasterDepositSettings(engine, chatId);
    return;
  }

  if (state === 'ma_dep_rate') {
    const parts = text.trim().split(/[\s,=/]+/);
    const rs = Number(parts[0]);
    const coins = Number(parts[1]);
    if (!Number.isFinite(rs) || rs <= 0 || !Number.isFinite(coins) || coins <= 0) {
      await sendMsg(engine.masterToken, chatId, '❌ Send two positive numbers like <code>10 5</code>:');
      return;
    }
    await engine.setSetting('deposit_rs', String(rs));
    await engine.setSetting('deposit_coins', String(coins));
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, `✅ Rate updated: ₹${rs} = ${coins} Coins`, masterMainKeyboard(true));
    await sendMasterDepositSettings(engine, chatId);
    return;
  }

  if (state === 'ma_dep_min') {
    const minRs = Number(text.trim());
    if (!Number.isFinite(minRs) || minRs <= 0) {
      await sendMsg(engine.masterToken, chatId, '❌ Send a valid positive amount:');
      return;
    }
    await engine.setSetting('min_deposit_rs', String(minRs));
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, `✅ Minimum deposit set to ₹${minRs}`, masterMainKeyboard(true));
    await sendMasterDepositSettings(engine, chatId);
    return;
  }

  if (state === 'ma_find_user') {
    const q = text.trim().replace(/^@/, '');
    let target = null;
    if (/^\d+$/.test(q)) {
      target = await engine.db.first('SELECT user_id FROM master_users WHERE user_id = ?', Number(q));
    } else {
      target = await engine.db.first(
        'SELECT user_id FROM master_users WHERE LOWER(username) = LOWER(?)',
        q
      );
    }
    if (!target) {
      await sendMsg(engine.masterToken, chatId, '❌ User not found. Try another ID or username:');
      return;
    }
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, '✅ User found:', masterMainKeyboard(true));
    await sendMasterUserCard(engine, Number(target.user_id), chatId);
    return;
  }

  if (state === 'ma_add_coins' || state === 'ma_sub_coins') {
    const targetUid = Number(user.state_data);
    const amt = Number(text.trim());
    if (!Number.isFinite(amt) || amt <= 0) {
      await sendMsg(engine.masterToken, chatId, '❌ Send a valid positive number:');
      return;
    }
    if (state === 'ma_add_coins') {
      await engine.db.run('UPDATE master_users SET coins = coins + ? WHERE user_id = ?', amt, targetUid);
      await sendMsg(engine.masterToken, targetUid, `🎁 Admin added <b>+${fmtNum(amt)} Coins</b> to your account!`);
    } else {
      await engine.db.run(
        'UPDATE master_users SET coins = MAX(0, coins - ?) WHERE user_id = ?',
        amt,
        targetUid
      );
      await sendMsg(engine.masterToken, targetUid, `➖ Admin deducted <b>-${fmtNum(amt)} Coins</b> from your account.`);
    }
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, '✅ Balance updated!', masterMainKeyboard(true));
    await sendMasterUserCard(engine, targetUid, chatId);
    return;
  }

  if (state === 'ma_add_channel') {
    const res = await resolveChannelInput(engine.masterToken, text);
    if (!res.ok) {
      await sendMsg(engine.masterToken, chatId, `❌ ${res.error}`);
      return;
    }
    await engine.db.run(
      `INSERT INTO master_channels (chat_id, title, invite_link, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title, invite_link = excluded.invite_link`,
      res.chatId,
      res.title,
      res.inviteLink,
      Math.floor(Date.now() / 1000)
    );
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, `✅ Channel <b>${esc(res.title)}</b> added!`, masterMainKeyboard(true));
    await sendMasterChannelsPage(engine, 0, chatId);
    return;
  }

  if (state.startsWith('ma_set:')) {
    const key = state.slice(7);
    if (!ALLOWED_MASTER_SETTINGS.has(key)) {
      await setMasterState(engine, userId, '', '');
      return;
    }
    const val = text.trim();
    if (key !== 'support_username') {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 0) {
        await sendMsg(engine.masterToken, chatId, '❌ Please send a valid non-negative number:');
        return;
      }
      await engine.setSetting(key, String(n));
    } else {
      await engine.setSetting(key, val);
    }
    await setMasterState(engine, userId, '', '');
    await sendMsg(engine.masterToken, chatId, `✅ Updated <code>${esc(key)}</code>.`, masterMainKeyboard(true));
    await sendMasterSettingsMenu(engine, chatId);
    return;
  }

  if (state === 'ma_bc_pick_bot') {
    const q = text.trim().replace(/^@/, '');
    const bot = /^\d+$/.test(q)
      ? await engine.db.first('SELECT id, bot_username FROM bots WHERE id = ?', Number(q))
      : await engine.db.first('SELECT id, bot_username FROM bots WHERE LOWER(bot_username) = LOWER(?)', q);
    if (!bot) {
      await sendMsg(engine.masterToken, chatId, '❌ Child bot not found. Enter Bot ID or @username:');
      return;
    }
    await setMasterState(engine, userId, 'ma_bc_msg', JSON.stringify({ target: 'bot', botId: bot.id }));
    await sendMsg(
      engine.masterToken,
      chatId,
      `📣 <b>Selected @${esc(bot.bot_username)}</b>\n\nSend the broadcast message (HTML supported):`,
      masterCancelKeyboard()
    );
    return;
  }

  if (state === 'ma_bc_msg') {
    let payload = {};
    try {
      payload = JSON.parse(user.state_data || '{}');
    } catch {
      payload = {};
    }
    payload.text = text;
    await setMasterState(engine, userId, 'ma_bc_btn', JSON.stringify(payload));
    await sendMsg(
      engine.masterToken,
      chatId,
      `🔗 <b>Optional Inline Button</b>\n\nSend <code>Button Text | https://link</code> or send <code>skip</code>:`,
      masterCancelKeyboard()
    );
    return;
  }

  if (state === 'ma_bc_btn') {
    let payload = {};
    try {
      payload = JSON.parse(user.state_data || '{}');
    } catch {
      payload = {};
    }
    if (text.trim().toLowerCase() !== 'skip') {
      const parts = text.split('|').map((s) => s.trim());
      if (parts.length < 2 || !/^https?:\/\//i.test(parts[1])) {
        await sendMsg(engine.masterToken, chatId, '❌ Invalid format. Send <code>Text | https://url</code> or <code>skip</code>:');
        return;
      }
      payload.btnText = parts[0];
      payload.btnUrl = parts[1];
    }
    await setMasterState(engine, userId, 'ma_bc_ready', JSON.stringify(payload));
    const previewMarkup = {
      inline_keyboard: [
        ...(payload.btnText && payload.btnUrl ? [[{ text: payload.btnText, url: payload.btnUrl }]] : []),
        [{ text: '🚀 Confirm & Send Broadcast', callback_data: 'ma_bc_exec', style: 'success' }],
      ],
    };
    await sendMsg(engine.masterToken, chatId, '✅ Preview prepared:', masterMainKeyboard(true));
    await sendMsg(engine.masterToken, chatId, payload.text, previewMarkup);
  }
}

export async function handleMasterUpdate(engine, update) {
  if (update.callback_query) {
    if (!update.callback_query.from || update.callback_query.from.is_bot) return;
    await handleMasterCallback(engine, update.callback_query);
    return;
  }

  const msg = update.message;
  if (!msg || !msg.from || msg.from.is_bot) return;
  if (msg.chat?.type !== 'private') return;

  const userId = Number(msg.from.id);
  const chatId = Number(msg.chat.id);
  const text = (msg.text || msg.caption || '').trim();

  let refId = 0;
  if (text.startsWith('/start')) {
    const arg = text.slice(6).trim();
    if (/^\d+$/.test(arg)) refId = Number(arg);
  }

  const user = await getOrCreateMasterUser(engine, msg.from, refId);
  const isAdmin = await engine.isMasterAdmin(userId);

  if (text === '/cancel' || text === '❌ Cancel') {
    await setMasterState(engine, userId, '', '');
    await sendMasterHome(engine, userId, chatId, 'Cancelled.');
    return;
  }

  if (text === '/admin' || text === '🛡 Master Admin') {
    if (!isAdmin) {
      await sendMsg(engine.masterToken, chatId, '❌ Access denied.');
      return;
    }
    await setMasterState(engine, userId, '', '');
    await sendMasterAdminHome(engine, chatId);
    return;
  }

  if (text.startsWith('/start')) {
    await setMasterState(engine, userId, '', '');
    if (!(await checkMasterGuards(engine, user, chatId))) return;
    await creditMasterReferralIfEligible(engine, userId);
    await sendMasterHome(engine, userId, chatId);
    return;
  }

  if (user.state && !user.state.startsWith('ma_bc_ready')) {
    if (!(await checkMasterGuards(engine, user, chatId))) return;
    await handleMasterStateInput(engine, user, msg, chatId, text, isAdmin);
    return;
  }

  if (!(await checkMasterGuards(engine, user, chatId))) return;

  if (text === '🎁 Daily Coins' || text === '/daily') {
    const now = Math.floor(Date.now() / 1000);
    const dailyCoins = Number(await engine.getSetting('daily_coins', '2')) || 2;
    const upd = await engine.db.run(
      'UPDATE master_users SET coins = coins + ?, last_daily_at = ? WHERE user_id = ? AND (? - last_daily_at) >= 86400',
      dailyCoins,
      now,
      userId,
      now
    );
    if (upd.changes <= 0) {
      const rem = 86400 - (now - Number(user.last_daily_at || 0));
      await sendMsg(
        engine.masterToken,
        chatId,
        `⏳ <b>Already Claimed!</b>\n\nNext Daily Coins available in <b>${fmtDuration(Math.max(1, rem))}</b>.`
      );
      return;
    }
    const fresh = await engine.db.first('SELECT coins FROM master_users WHERE user_id = ?', userId);
    await sendMsg(
      engine.masterToken,
      chatId,
      `🎁 <b>Daily Coins Claimed!</b>\n\n🪙 Received: <b>+${fmtNum(dailyCoins)} Coins</b>\n💰 New Balance: <code>${fmtNum(fresh?.coins || 0)}</code>`
    );
    return;
  }

  if (text === '💰 My Balance' || text === '/balance') {
    const uname = await engine.getMasterUsername();
    const bCount = await engine.db.first('SELECT COUNT(*) AS c FROM bots WHERE owner_id = ?', userId);
    await sendMsg(
      engine.masterToken,
      chatId,
      `💰 <b>Account Summary</b>\n━━━━━━━━━━━━━━━━━━━━━\n🪙 Coins: <code>${fmtNum(user.coins)}</code>\n🤖 Created Bots: <code>${Number(bCount?.c || 0)}</code>\n👥 Referrals: <code>${Number(user.total_refs || 0)}</code>\n\n🔗 Invite Link:\n<code>${uname ? `https://t.me/${uname}?start=${userId}` : 'Run /setup first'}</code>`
    );
    return;
  }

  if (text === '👥 Refer & Earn' || text === '/refer') {
    const uname = await engine.getMasterUsername();
    const refCoins = await engine.getSetting('master_ref_coins', '1');
    const link = uname ? `https://t.me/${uname}?start=${userId}` : '';
    const shareUrl = link
      ? `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Create your own Telegram Refer & Earn Bot!')}`
      : '';
    await sendMsg(
      engine.masterToken,
      chatId,
      `👥 <b>Refer & Earn Coins</b>\n━━━━━━━━━━━━━━━━━━━━━\n🪙 Reward per verified referral: <b>+${esc(refCoins)} Coins</b>\n👥 Total Verified Referrals: <code>${Number(user.total_refs || 0)}</code>\n\n🔗 <b>Your Invite Link:</b>\n<code>${esc(link || 'Bot username not cached yet')}</code>`,
      shareUrl ? { inline_keyboard: [[{ text: '📤 Share Link', url: shareUrl, style: 'primary' }]] } : undefined
    );
    return;
  }

  if (text === '🤖 Create Bot' || text === '/create') {
    await sendCreateBotMenu(engine, user, chatId);
    return;
  }

  if (text === '📱 My Bots' || text === '/mybots') {
    await sendMyBotsList(engine, userId, chatId);
    return;
  }

  if (text === '💳 Buy Coins' || text === '/buy' || text === '/deposit') {
    await sendBuyCoinsInfo(engine, userId, chatId);
    return;
  }

  if (text === '🆘 Support') {
    const support = await engine.getSetting('support_username', '@Support');
    await sendMsg(engine.masterToken, chatId, `🆘 <b>Support</b>\n\nNeed help? Contact ${esc(support)}`);
    return;
  }

  await sendMasterHome(engine, userId, chatId);
}
