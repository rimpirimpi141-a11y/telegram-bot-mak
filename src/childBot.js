import {
  esc,
  fmtNum,
  fmtDuration,
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
  answerCb,
  checkForceJoin,
  buildForceJoinMarkup,
} from './tgApi.js';
import {
  sendChildAdminHome,
  handleChildAdminCallback,
  handleChildAdminState,
} from './childAdmin.js';

async function setChildState(engine, botDbId, userId, state = '', stateData = '') {
  await engine.db.run(
    'UPDATE child_users SET state = ?, state_data = ? WHERE bot_db_id = ? AND user_id = ?',
    state,
    stateData,
    botDbId,
    userId
  );
}

async function getOrCreateChildUser(engine, bot, from, referredBy = 0) {
  const userId = Number(from.id);
  const now = Math.floor(Date.now() / 1000);
  const uname = from.username || '';
  const fname = from.first_name || 'User';

  let row = await engine.db.first(
    'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
    bot.id,
    userId
  );
  if (!row) {
    const validRef = referredBy > 0 && referredBy !== userId ? referredBy : 0;
    await engine.db.run(
      `INSERT OR IGNORE INTO child_users
        (bot_db_id, user_id, username, first_name, referred_by, joined_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bot.id,
      userId,
      uname,
      fname,
      validRef,
      now,
      now
    );
    row = await engine.db.first(
      'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      userId
    );
  } else {
    await engine.db.run(
      'UPDATE child_users SET username = ?, first_name = ?, last_active_at = ? WHERE bot_db_id = ? AND user_id = ?',
      uname,
      fname,
      now,
      bot.id,
      userId
    );
    row.username = uname;
    row.first_name = fname;
  }
  return row;
}

export async function creditChildReferralIfEligible(engine, bot, userId) {
  const user = await engine.db.first(
    'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
    bot.id,
    userId
  );
  if (!user || Number(user.referred_by) <= 0 || Number(user.ref_credited) === 1) return;
  if (Number(bot.device_verify) === 1 && Number(user.device_verified) !== 1) return;

  const upd = await engine.db.run(
    'UPDATE child_users SET ref_credited = 1 WHERE bot_db_id = ? AND user_id = ? AND ref_credited = 0 AND referred_by > 0',
    bot.id,
    userId
  );
  if (upd.changes <= 0) return;

  const reward = Number(bot.per_refer || 0);
  await engine.db.run(
    'UPDATE child_users SET balance = balance + ?, total_earned = total_earned + ?, total_refs = total_refs + 1 WHERE bot_db_id = ? AND user_id = ?',
    reward,
    reward,
    bot.id,
    user.referred_by
  );

  await sendMsg(
    bot.token,
    user.referred_by,
    `🎉 <b>New Verified Referral!</b>\n\n👤 <b>${esc(user.first_name || 'User')}</b> joined via your link.\n💰 You earned <b>+${fmtAmount(bot.currency, reward)}</b>!`
  );
}

function childMainKeyboard(bot, isAdmin) {
  const isStar = isStarBotType(bot.bot_type);
  const isRedeem = isRedeemBotType(bot.bot_type);
  const isAdv = isAdvancedBotType(bot.bot_type);
  const isGmail = isGmailBotType(bot.bot_type);

  const rows = [];
  if (isGmail) {
    rows.push([
      { text: '🛒 Buy Gmail', style: 'primary' },
      { text: '📤 Sell Gmail', style: 'primary' },
    ]);
    rows.push([
      { text: '💳 Deposit', style: 'success' },
      { text: '💸 Withdraw', style: 'success' },
    ]);
    rows.push([{ text: '💰 Balance' }, { text: '🎁 Daily Bonus' }]);
    rows.push([{ text: '👥 Refer & Earn' }, { text: '📜 My Gmails' }]);
  } else if (isStar) {
    rows.push([
      { text: '⭐ My Stars', style: 'primary' },
      { text: '👥 Refer & Earn', style: 'primary' },
    ]);
    rows.push([
      { text: '🎁 Daily Stars', style: 'success' },
      { text: '🌟 Withdraw Stars', style: 'success' },
    ]);
    rows.push([{ text: '👤 Set Username' }, { text: '📜 Star History' }]);
  } else if (isRedeem) {
    rows.push([
      { text: '💰 Balance', style: 'primary' },
      { text: '👥 Refer & Earn', style: 'primary' },
    ]);
    rows.push([
      { text: '🎁 Daily Bonus', style: 'success' },
      { text: '🎁 Redeem Code', style: 'success' },
    ]);
    rows.push([{ text: '📜 My Codes' }]);
  } else {
    rows.push([
      { text: '💰 Balance', style: 'primary' },
      { text: '👥 Refer & Earn', style: 'primary' },
    ]);
    rows.push([
      { text: '🎁 Daily Bonus', style: 'success' },
      { text: '💸 Withdraw', style: 'success' },
    ]);
    rows.push([{ text: '🏦 Set UPI ID' }, { text: '📜 History' }]);
  }

  if (isAdv) {
    rows.push([
      { text: '📋 Tasks' },
      { text: '🎫 Gift Code' },
      { text: '🏆 Leaderboard' },
    ]);
  }

  rows.push(
    isAdmin
      ? [{ text: '🆘 Support' }, { text: '👑 Admin Panel', style: 'danger' }]
      : [{ text: '🆘 Support' }]
  );

  return { keyboard: rows, resize_keyboard: true };
}

function childCancelKeyboard() {
  return {
    keyboard: [[{ text: '❌ Cancel', style: 'danger' }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export async function sendChildHome(engine, bot, user, chatId, prefix = '') {
  const isAdmin = await engine.isChildAdmin(bot, Number(user.user_id));
  const isStar = isStarBotType(bot.bot_type);
  const isRedeem = isRedeemBotType(bot.bot_type);
  const isGmail = isGmailBotType(bot.bot_type);

  const fresh =
    (await engine.db.first(
      'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      user.user_id
    )) || user;

  const lines = [];
  if (prefix) lines.push(`✅ <b>${esc(prefix)}</b>\n`);
  lines.push(`🌟 <b>${esc(bot.bot_name || `@${bot.bot_username}`)}</b>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(`👋 Welcome, <b>${esc(fresh.first_name || 'User')}</b>!`);
  lines.push(``);
  lines.push(
    isStar
      ? `⭐ <b>Stars Balance:</b> <code>${fmtAmount(bot.currency, fresh.balance)}</code>`
      : `💰 <b>Balance:</b> <code>${fmtAmount(bot.currency, fresh.balance)}</code>`
  );
  lines.push(`👥 <b>Referrals:</b> <code>${Number(fresh.total_refs || 0)}</code>`);
  lines.push(``);
  lines.push(`🎁 Daily Bonus: <b>${fmtAmount(bot.currency, bot.daily_bonus)}</b>`);
  lines.push(`👥 Per Refer: <b>${fmtAmount(bot.currency, bot.per_refer)}</b>`);
  if (!isRedeem) {
    lines.push(`📉 Min Withdraw: <b>${fmtAmount(bot.currency, bot.min_withdraw)}</b>`);
  }
  if (isGmail) {
    lines.push(`📤 Gmail Sell Rate: <b>${fmtAmount(bot.currency, bot.gmail_sell_price)}</b>`);
  }
  lines.push(`🆘 Support: ${esc(bot.support_username || '@Support')}`);

  await sendMsg(bot.token, chatId, lines.join('\n'), childMainKeyboard(bot, isAdmin));
}

async function sendChildDeviceVerifyPrompt(engine, bot, userId, chatId) {
  const link = await engine.createDeviceVerifyLink('child', bot.id, userId);
  if (!link) {
    await sendMsg(
      bot.token,
      chatId,
      '🛡 <b>Device Verification Required</b>\n\nVerification URL is unavailable. Contact the bot admin.'
    );
    return;
  }
  await sendMsg(
    bot.token,
    chatId,
    `🛡 <b>Device Verification Required</b>\n\nTo prevent fake/multi-accounts, please verify your device once:`,
    {
      inline_keyboard: [
        [{ text: '🛡 Verify My Device', url: link, style: 'primary' }],
        [{ text: '✅ Check Verification', callback_data: 'c_check_dev', style: 'success' }],
      ],
    }
  );
}

async function checkChildGuards(engine, bot, user, chatId) {
  const userId = Number(user.user_id);
  const isAdmin = await engine.isChildAdmin(bot, userId);

  if (Number(bot.is_active) !== 1 && !isAdmin) {
    await sendMsg(bot.token, chatId, '⏸ <b>This bot is currently paused by its owner.</b>');
    return false;
  }
  if (Number(user.is_banned) === 1 && !isAdmin) {
    await sendMsg(bot.token, chatId, '🚫 <b>You are banned from using this bot.</b>');
    return false;
  }
  if (Number(bot.maintenance) === 1 && !isAdmin) {
    await sendMsg(bot.token, chatId, '🛠 <b>Maintenance Mode</b>\n\nPlease try again shortly.');
    return false;
  }
  if (!isAdmin) {
    const channels = await engine.db.all(
      'SELECT * FROM child_channels WHERE bot_db_id = ? ORDER BY id ASC',
      bot.id
    );
    if (channels.length > 0) {
      const unjoined = await checkForceJoin(bot.token, channels, userId);
      if (unjoined.length > 0) {
        await sendMsg(
          bot.token,
          chatId,
          `📢 <b>Join Required Channels</b>\n\nPlease join all channels below, then tap <b>Verify</b>:`,
          buildForceJoinMarkup(unjoined, 'c_verify_join')
        );
        return false;
      }
    }
    if (Number(bot.device_verify) === 1 && Number(user.device_verified) !== 1) {
      await sendChildDeviceVerifyPrompt(engine, bot, userId, chatId);
      return false;
    }
  }
  return true;
}

async function executeChildWithdraw(engine, bot, user, chatId, amount) {
  const userId = Number(user.user_id);
  const isAdmin = await engine.isChildAdmin(bot, userId);
  const isStar = isStarBotType(bot.bot_type);

  if (Number(bot.withdrawals_open) !== 1) {
    await sendMsg(bot.token, chatId, '🔒 Withdrawals are currently closed.', childMainKeyboard(bot, isAdmin));
    return;
  }
  if (!user.upi_id) {
    await sendMsg(
      bot.token,
      chatId,
      isStar ? '❌ Please set your Telegram @username first.' : '❌ Please set your UPI ID first.',
      childMainKeyboard(bot, isAdmin)
    );
    return;
  }
  if (!Number.isFinite(amount) || amount < Number(bot.min_withdraw)) {
    await sendMsg(
      bot.token,
      chatId,
      `❌ Minimum withdrawal is <b>${fmtAmount(bot.currency, bot.min_withdraw)}</b>.`
    );
    return;
  }

  const upd = await engine.db.run(
    "UPDATE child_users SET balance = balance - ?, total_withdrawn = total_withdrawn + ?, state = '', state_data = '' WHERE bot_db_id = ? AND user_id = ? AND balance >= ?",
    amount,
    amount,
    bot.id,
    userId,
    amount
  );
  if (upd.changes <= 0) {
    await setChildState(engine, bot.id, userId, '', '');
    await sendMsg(bot.token, chatId, '❌ Insufficient balance.', childMainKeyboard(bot, isAdmin));
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const ins = await engine.db.run(
    "INSERT INTO withdrawals (bot_db_id, user_id, amount, upi_id, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    bot.id,
    userId,
    amount,
    user.upi_id,
    now
  );

  await sendMsg(
    bot.token,
    chatId,
    `✅ <b>Withdrawal Requested! (#${ins.lastRowId})</b>\n\n💰 Amount: <b>${fmtAmount(bot.currency, amount)}</b>\n🏦 Target: <code>${esc(user.upi_id)}</code>\n⏳ Status: Pending Admin Approval`,
    childMainKeyboard(bot, isAdmin)
  );

  const admins = await engine.getAllChildAdmins(bot);
  const notice = `🔔 <b>New Withdrawal #${ins.lastRowId}</b>\n\n👤 User: <b>${esc(user.first_name)}</b> (<code>${userId}</code>)\n💰 Amount: <b>${fmtAmount(bot.currency, amount)}</b>\n🏦 Target: <code>${esc(user.upi_id)}</code>`;
  const markup = {
    inline_keyboard: [
      [
        { text: '✅ Pay / Approve', callback_data: `ca_wd_ok:${ins.lastRowId}`, style: 'success' },
        { text: '❌ Reject & Refund', callback_data: `ca_wd_no:${ins.lastRowId}`, style: 'danger' },
      ],
    ],
  };
  for (const adm of admins) {
    await sendMsg(bot.token, adm, notice, markup);
  }
}

async function sendRedeemPlansToUser(engine, bot, user, chatId) {
  const plans = await engine.db.all(
    `SELECT p.*, (SELECT COUNT(*) FROM redeem_codes c WHERE c.plan_id = p.id AND c.is_used = 0) AS stock
     FROM redeem_plans p WHERE p.bot_db_id = ? AND p.is_active = 1 ORDER BY p.cost ASC`,
    bot.id
  );
  if (plans.length === 0) {
    await sendMsg(bot.token, chatId, '🎁 <b>Redeem Store</b>\n\nNo redeem plans added yet.');
    return;
  }
  const kb = plans.map((p) => [
    {
      text: `🎟 ${p.title} · ${fmtAmount(bot.currency, p.cost)} (${p.stock} left)`,
      callback_data: `c_redeem:${p.id}`,
      style: Number(p.stock) > 0 ? 'primary' : 'danger',
    },
  ]);
  await sendMsg(
    bot.token,
    chatId,
    `🎁 <b>Redeem Code Store</b>\n━━━━━━━━━━━━━━━━━━━━━\n💰 Your Balance: <b>${fmtAmount(bot.currency, user.balance)}</b>\n\nSelect a plan to claim instantly:`,
    { inline_keyboard: kb }
  );
}

async function sendGmailPlansToUser(engine, bot, user, chatId) {
  const plans = await engine.db.all(
    `SELECT p.*, (SELECT COUNT(*) FROM gmail_stock s WHERE s.plan_id = p.id AND s.is_sold = 0) AS stock
     FROM gmail_plans p WHERE p.bot_db_id = ? AND p.is_active = 1 ORDER BY p.price ASC`,
    bot.id
  );
  if (plans.length === 0) {
    await sendMsg(bot.token, chatId, '🛒 <b>Buy Gmail</b>\n\nNo Gmail plans available right now.');
    return;
  }
  const kb = plans.map((p) => [
    {
      text: `📧 ${p.title} · ${fmtAmount(bot.currency, p.price)} (${p.stock} in stock)`,
      callback_data: `c_gbuy:${p.id}`,
      style: Number(p.stock) > 0 ? 'primary' : 'danger',
    },
  ]);
  await sendMsg(
    bot.token,
    chatId,
    `🛒 <b>Buy Gmail Accounts</b>\n━━━━━━━━━━━━━━━━━━━━━\n💰 Your Balance: <b>${fmtAmount(bot.currency, user.balance)}</b>\n\nTap a plan to purchase instantly:`,
    { inline_keyboard: kb }
  );
}

async function sendChildDepositInfo(engine, bot, chatId) {
  if (Number(bot.deposit_enabled) !== 1) {
    await sendMsg(bot.token, chatId, '💳 Deposits are currently disabled by the admin.');
    return;
  }
  const text = [
    `💳 <b>Deposit Balance</b>`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `📉 Minimum Deposit: <b>${fmtAmount(bot.currency, bot.min_deposit)}</b>`,
    bot.deposit_upi_id
      ? `🏦 UPI ID: <code>${esc(bot.deposit_upi_id)}</code>`
      : `🏦 UPI ID: Contact Support`,
    ``,
    `Tap <b>Deposit Now</b> after paying to submit your UTR.`,
  ].join('\n');

  const markup = {
    inline_keyboard: [[{ text: '💳 Deposit Now', callback_data: 'c_dep_start', style: 'success' }]],
  };

  if (bot.deposit_qr_file_id) {
    const r = await sendPhotoMsg(bot.token, chatId, bot.deposit_qr_file_id, text, markup);
    if (!r.ok) await sendMsg(bot.token, chatId, text, markup);
  } else {
    await sendMsg(bot.token, chatId, text, markup);
  }
}

async function sendChildTasksToUser(engine, bot, userId, chatId) {
  const tasks = await engine.db.all(
    'SELECT * FROM child_tasks WHERE bot_db_id = ? AND is_active = 1 ORDER BY id DESC',
    bot.id
  );
  if (tasks.length === 0) {
    await sendMsg(bot.token, chatId, '📋 <b>Tasks</b>\n\nNo active tasks right now.');
    return;
  }
  const claims = await engine.db.all(
    'SELECT task_id FROM child_task_claims WHERE bot_db_id = ? AND user_id = ?',
    bot.id,
    userId
  );
  const doneSet = new Set(claims.map((c) => Number(c.task_id)));

  for (const t of tasks) {
    const done = doneSet.has(Number(t.id));
    await sendMsg(
      bot.token,
      chatId,
      `📋 <b>${esc(t.title)}</b>\n💰 Reward: <b>+${fmtAmount(bot.currency, t.reward)}</b>\n${done ? '✅ Already Claimed' : '⚡ Complete & Claim'}`,
      {
        inline_keyboard: done
          ? [[{ text: '✅ Completed', callback_data: 'c_noop' }]]
          : [
              [
                { text: '🔗 Open Task', url: t.url, style: 'primary' },
                { text: '✅ Claim Reward', callback_data: `c_task:${t.id}`, style: 'success' },
              ],
            ],
      }
    );
  }
}

async function handleChildCallback(engine, bot, cb) {
  const userId = Number(cb.from.id);
  const chatId = Number(cb.message?.chat?.id || userId);
  const msgId = Number(cb.message?.message_id || 0);
  const data = cb.data || '';

  const user = await getOrCreateChildUser(engine, bot, cb.from);
  const isAdmin = await engine.isChildAdmin(bot, userId);

  if (data === 'c_noop') {
    await answerCb(bot.token, cb.id, 'Already completed!');
    return;
  }

  if (data.startsWith('ca_')) {
    await handleChildAdminCallback(engine, bot, cb, user, chatId, msgId, childCancelKeyboard());
    return;
  }

  if (data === 'c_verify_join') {
    const channels = await engine.db.all(
      'SELECT * FROM child_channels WHERE bot_db_id = ? ORDER BY id ASC',
      bot.id
    );
    const unjoined = await checkForceJoin(bot.token, channels, userId);
    if (unjoined.length > 0) {
      await answerCb(bot.token, cb.id, '❌ Please join all required channels first!', true);
      return;
    }
    await answerCb(bot.token, cb.id, '✅ Channels verified!');
    if (Number(bot.device_verify) === 1 && Number(user.device_verified) !== 1 && !isAdmin) {
      await sendChildDeviceVerifyPrompt(engine, bot, userId, chatId);
      return;
    }
    await creditChildReferralIfEligible(engine, bot, userId);
    await sendChildHome(engine, bot, user, chatId, 'Verified!');
    return;
  }

  if (data === 'c_check_dev') {
    const fresh = await engine.db.first(
      'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      userId
    );
    if (fresh && Number(fresh.device_verified) === 1) {
      await answerCb(bot.token, cb.id, '✅ Device verified!');
      await creditChildReferralIfEligible(engine, bot, userId);
      await sendChildHome(engine, bot, fresh, chatId, 'Device Verified!');
    } else {
      await answerCb(bot.token, cb.id, '❌ Not verified yet. Tap "Verify My Device" first.', true);
    }
    return;
  }

  if (!(await checkChildGuards(engine, bot, user, chatId))) {
    await answerCb(bot.token, cb.id);
    return;
  }

  if (data === 'c_wd_full') {
    await answerCb(bot.token, cb.id);
    await executeChildWithdraw(engine, bot, user, chatId, Number(user.balance));
    return;
  }

  if (data.startsWith('c_star_pack:')) {
    const amt = Number(data.slice(12));
    await answerCb(bot.token, cb.id);
    await executeChildWithdraw(engine, bot, user, chatId, amt);
    return;
  }

  if (data.startsWith('c_redeem:')) {
    const planId = Number(data.slice(9));
    const plan = await engine.db.first(
      'SELECT * FROM redeem_plans WHERE id = ? AND bot_db_id = ? AND is_active = 1',
      planId,
      bot.id
    );
    if (!plan) {
      await answerCb(bot.token, cb.id, '❌ Plan not available.', true);
      return;
    }
    if (Number(user.balance) < Number(plan.cost)) {
      await answerCb(
        bot.token,
        cb.id,
        `❌ Need ${fmtAmount(bot.currency, plan.cost)}. You have ${fmtAmount(bot.currency, user.balance)}.`,
        true
      );
      return;
    }

    let claimed = null;
    const now = Math.floor(Date.now() / 1000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const codeRow = await engine.db.first(
        'SELECT id, code FROM redeem_codes WHERE bot_db_id = ? AND plan_id = ? AND is_used = 0 ORDER BY id ASC LIMIT 1',
        bot.id,
        planId
      );
      if (!codeRow) break;
      const claimRes = await engine.db.run(
        'UPDATE redeem_codes SET is_used = 1, used_by = ?, used_at = ? WHERE id = ? AND is_used = 0',
        userId,
        now,
        codeRow.id
      );
      if (claimRes.changes > 0) {
        claimed = codeRow;
        break;
      }
    }

    if (!claimed) {
      await answerCb(bot.token, cb.id, '❌ Out of stock for this plan right now.', true);
      return;
    }

    const balRes = await engine.db.run(
      'UPDATE child_users SET balance = balance - ?, total_withdrawn = total_withdrawn + ? WHERE bot_db_id = ? AND user_id = ? AND balance >= ?',
      plan.cost,
      plan.cost,
      bot.id,
      userId,
      plan.cost
    );
    if (balRes.changes <= 0) {
      await engine.db.run(
        'UPDATE redeem_codes SET is_used = 0, used_by = 0, used_at = 0 WHERE id = ?',
        claimed.id
      );
      await answerCb(bot.token, cb.id, '❌ Insufficient balance.', true);
      return;
    }

    await answerCb(bot.token, cb.id, '🎉 Code Redeemed!');
    await sendMsg(
      bot.token,
      chatId,
      `🎉 <b>Redeem Successful!</b>\n\n🎟 Plan: <b>${esc(plan.title)}</b>\n💰 Cost: ${fmtAmount(bot.currency, plan.cost)}\n🔑 Your Code:\n<code>${esc(claimed.code)}</code>`
    );
    return;
  }

  if (data.startsWith('c_gbuy:')) {
    const planId = Number(data.slice(7));
    const plan = await engine.db.first(
      'SELECT * FROM gmail_plans WHERE id = ? AND bot_db_id = ? AND is_active = 1',
      planId,
      bot.id
    );
    if (!plan) {
      await answerCb(bot.token, cb.id, '❌ Plan unavailable.', true);
      return;
    }
    if (Number(user.balance) < Number(plan.price)) {
      await answerCb(
        bot.token,
        cb.id,
        `❌ Need ${fmtAmount(bot.currency, plan.price)}. Deposit balance first!`,
        true
      );
      return;
    }

    let claimed = null;
    const now = Math.floor(Date.now() / 1000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const stk = await engine.db.first(
        'SELECT id, account_data FROM gmail_stock WHERE bot_db_id = ? AND plan_id = ? AND is_sold = 0 ORDER BY id ASC LIMIT 1',
        bot.id,
        planId
      );
      if (!stk) break;
      const claimRes = await engine.db.run(
        'UPDATE gmail_stock SET is_sold = 1, sold_to = ?, sold_at = ? WHERE id = ? AND is_sold = 0',
        userId,
        now,
        stk.id
      );
      if (claimRes.changes > 0) {
        claimed = stk;
        break;
      }
    }

    if (!claimed) {
      await answerCb(bot.token, cb.id, '❌ Out of stock right now.', true);
      return;
    }

    const balRes = await engine.db.run(
      'UPDATE child_users SET balance = balance - ?, total_withdrawn = total_withdrawn + ? WHERE bot_db_id = ? AND user_id = ? AND balance >= ?',
      plan.price,
      plan.price,
      bot.id,
      userId,
      plan.price
    );
    if (balRes.changes <= 0) {
      await engine.db.run(
        'UPDATE gmail_stock SET is_sold = 0, sold_to = 0, sold_at = 0 WHERE id = ?',
        claimed.id
      );
      await answerCb(bot.token, cb.id, '❌ Insufficient balance.', true);
      return;
    }

    await answerCb(bot.token, cb.id, '✅ Gmail Purchased!');
    await sendMsg(
      bot.token,
      chatId,
      `✅ <b>Gmail Purchase Successful!</b>\n\n📦 Plan: <b>${esc(plan.title)}</b>\n💰 Paid: ${fmtAmount(bot.currency, plan.price)}\n📧 Account Details:\n<code>${esc(claimed.account_data)}</code>`
    );
    return;
  }

  if (data === 'c_dep_start') {
    await answerCb(bot.token, cb.id);
    await setChildState(engine, bot.id, userId, 'c_dep_amt', '');
    await sendMsg(
      bot.token,
      chatId,
      `💳 <b>Enter Deposit Amount</b>\n\nMinimum: ${fmtAmount(bot.currency, bot.min_deposit)}`,
      childCancelKeyboard()
    );
    return;
  }

  if (data.startsWith('c_task:')) {
    const taskId = Number(data.slice(7));
    const task = await engine.db.first(
      'SELECT * FROM child_tasks WHERE id = ? AND bot_db_id = ? AND is_active = 1',
      taskId,
      bot.id
    );
    if (!task) {
      await answerCb(bot.token, cb.id, '❌ Task no longer active.', true);
      return;
    }
    const ins = await engine.db.run(
      'INSERT OR IGNORE INTO child_task_claims (bot_db_id, task_id, user_id, claimed_at) VALUES (?, ?, ?, ?)',
      bot.id,
      taskId,
      userId,
      Math.floor(Date.now() / 1000)
    );
    if (ins.changes <= 0) {
      await answerCb(bot.token, cb.id, '⚠ Already claimed!', true);
      return;
    }
    await engine.db.run(
      'UPDATE child_users SET balance = balance + ?, total_earned = total_earned + ? WHERE bot_db_id = ? AND user_id = ?',
      task.reward,
      task.reward,
      bot.id,
      userId
    );
    await answerCb(bot.token, cb.id, `✅ +${fmtAmount(bot.currency, task.reward)} credited!`);
    return;
  }

  await answerCb(bot.token, cb.id);
}

async function handleChildStateInput(engine, bot, user, msg, chatId, text, isAdmin) {
  const userId = Number(user.user_id);
  const state = user.state || '';
  const mainMarkup = childMainKeyboard(bot, isAdmin);
  const cancelMarkup = childCancelKeyboard();

  if (isAdmin && state.startsWith('ca_')) {
    const handled = await handleChildAdminState(engine, bot, user, msg, chatId, text, cancelMarkup, mainMarkup);
    if (handled) return;
  }

  if (state === 'c_await_upi') {
    const upi = text.trim();
    if (!upi.includes('@') || upi.length < 5) {
      await sendMsg(bot.token, chatId, '❌ Invalid UPI ID. Example: <code>name@paytm</code>');
      return;
    }
    await engine.db.run(
      "UPDATE child_users SET upi_id = ?, state = '', state_data = '' WHERE bot_db_id = ? AND user_id = ?",
      upi,
      bot.id,
      userId
    );
    await sendMsg(bot.token, chatId, `✅ UPI ID saved: <code>${esc(upi)}</code>`, mainMarkup);
    return;
  }

  if (state === 'c_await_star_user') {
    let uname = text.trim();
    if (!uname.startsWith('@')) uname = '@' + uname;
    if (!/^@[A-Za-z0-9_]{4,35}$/.test(uname)) {
      await sendMsg(bot.token, chatId, '❌ Send a valid Telegram @username (e.g. <code>@username</code>):');
      return;
    }
    await engine.db.run(
      "UPDATE child_users SET upi_id = ?, state = '', state_data = '' WHERE bot_db_id = ? AND user_id = ?",
      uname,
      bot.id,
      userId
    );
    await sendMsg(bot.token, chatId, `✅ Username saved: <code>${esc(uname)}</code>`, mainMarkup);
    return;
  }

  if (state === 'c_await_wd_amt') {
    const amt = Number(text.trim());
    await executeChildWithdraw(engine, bot, user, chatId, amt);
    return;
  }

  if (state === 'c_await_promo') {
    const code = text.trim().toUpperCase();
    const promo = await engine.db.first(
      'SELECT * FROM child_promos WHERE bot_db_id = ? AND UPPER(code) = ?',
      bot.id,
      code
    );
    if (!promo) {
      await sendMsg(bot.token, chatId, '❌ Invalid promo code. Try again or tap Cancel:');
      return;
    }
    const claimIns = await engine.db.run(
      'INSERT OR IGNORE INTO child_promo_claims (bot_db_id, promo_id, user_id, claimed_at) VALUES (?, ?, ?, ?)',
      bot.id,
      promo.id,
      userId,
      Math.floor(Date.now() / 1000)
    );
    if (claimIns.changes <= 0) {
      await setChildState(engine, bot.id, userId, '', '');
      await sendMsg(bot.token, chatId, '⚠ You have already claimed this promo code.', mainMarkup);
      return;
    }
    const promoUpd = await engine.db.run(
      'UPDATE child_promos SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses',
      promo.id
    );
    if (promoUpd.changes <= 0) {
      await engine.db.run(
        'DELETE FROM child_promo_claims WHERE bot_db_id = ? AND promo_id = ? AND user_id = ?',
        bot.id,
        promo.id,
        userId
      );
      await setChildState(engine, bot.id, userId, '', '');
      await sendMsg(bot.token, chatId, '❌ This promo code has reached its max uses.', mainMarkup);
      return;
    }
    await engine.db.run(
      "UPDATE child_users SET balance = balance + ?, total_earned = total_earned + ?, state = '', state_data = '' WHERE bot_db_id = ? AND user_id = ?",
      promo.reward,
      promo.reward,
      bot.id,
      userId
    );
    await sendMsg(
      bot.token,
      chatId,
      `🎉 <b>Promo Redeemed!</b>\n\n🎫 Code: <code>${esc(code)}</code>\n💰 Credited: <b>+${fmtAmount(bot.currency, promo.reward)}</b>`,
      mainMarkup
    );
    return;
  }

  if (state === 'c_dep_amt') {
    const amt = Number(text.trim());
    if (!Number.isFinite(amt) || amt < Number(bot.min_deposit)) {
      await sendMsg(
        bot.token,
        chatId,
        `❌ Minimum deposit is ${fmtAmount(bot.currency, bot.min_deposit)}. Enter amount:`
      );
      return;
    }
    await setChildState(engine, bot.id, userId, 'c_dep_utr', String(amt));
    await sendMsg(
      bot.token,
      chatId,
      `💳 <b>Step 2: Send UTR / Payment Proof</b>\n\nAmount: <b>${fmtAmount(bot.currency, amt)}</b>\n${bot.deposit_upi_id ? `🏦 UPI: <code>${esc(bot.deposit_upi_id)}</code>\n` : ''}\nSend your UTR ID (or screenshot photo):`,
      cancelMarkup
    );
    return;
  }

  if (state === 'c_dep_utr') {
    const amt = Number(user.state_data || 0);
    const photos = msg.photo || [];
    const fileId = photos.length > 0 ? photos[photos.length - 1].file_id : '';
    const utr = text.trim() || (fileId ? 'Screenshot Attached' : '');
    if (!utr) {
      await sendMsg(bot.token, chatId, '❌ Please send UTR or screenshot:');
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const ins = await engine.db.run(
      "INSERT INTO child_deposits (bot_db_id, user_id, amount, utr, screenshot_file_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)",
      bot.id,
      userId,
      amt,
      utr,
      fileId,
      now
    );
    await setChildState(engine, bot.id, userId, '', '');
    await sendMsg(
      bot.token,
      chatId,
      `✅ <b>Deposit Submitted! (#${ins.lastRowId})</b>\n\n💰 Amount: ${fmtAmount(bot.currency, amt)}\n🔖 UTR: <code>${esc(utr)}</code>`,
      mainMarkup
    );

    const admins = await engine.getAllChildAdmins(bot);
    const notice = `🔔 <b>New Deposit #${ins.lastRowId}</b>\n\n👤 User: <b>${esc(user.first_name)}</b> (<code>${userId}</code>)\n💰 Amount: <b>${fmtAmount(bot.currency, amt)}</b>\n🔖 UTR: <code>${esc(utr)}</code>`;
    const markup = {
      inline_keyboard: [
        [
          { text: '✅ Approve', callback_data: `ca_dep_ok:${ins.lastRowId}`, style: 'success' },
          { text: '❌ Reject', callback_data: `ca_dep_no:${ins.lastRowId}`, style: 'danger' },
        ],
      ],
    };
    for (const adm of admins) {
      if (fileId) await sendPhotoMsg(bot.token, adm, fileId, notice, markup);
      else await sendMsg(bot.token, adm, notice, markup);
    }
    return;
  }

  if (state === 'c_await_gsell') {
    const lines = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
    if (lines.length === 0) {
      await sendMsg(bot.token, chatId, '❌ Send your Gmail account(s) in format <code>email@gmail.com | password</code>:');
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const price = Number(bot.gmail_sell_price || 5);
    const stmts = lines.map((line) =>
      engine.db.prepare(
        "INSERT INTO gmail_sell_requests (bot_db_id, user_id, account_data, price, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
        bot.id,
        userId,
        line,
        price,
        now
      )
    );
    await engine.db.batch(stmts);
    await setChildState(engine, bot.id, userId, '', '');
    await sendMsg(
      bot.token,
      chatId,
      `✅ <b>Submitted ${lines.length} Gmail Account(s)!</b>\n\n💰 Payout per approved Gmail: <b>${fmtAmount(bot.currency, price)}</b>\n⏳ Admin will verify and credit your balance soon.`,
      mainMarkup
    );

    const admins = await engine.getAllChildAdmins(bot);
    for (const adm of admins) {
      await sendMsg(
        bot.token,
        adm,
        `📤 <b>New Gmail Sell Submission (${lines.length})</b>\n👤 From: <b>${esc(user.first_name)}</b> (<code>${userId}</code>)`,
        { inline_keyboard: [[{ text: '📤 Review Pending Sells', callback_data: 'ca_gsells:0', style: 'primary' }]] }
      );
    }
  }
}

export async function handleChildUpdate(engine, bot, update) {
  if (update.callback_query) {
    if (!update.callback_query.from || update.callback_query.from.is_bot) return;
    await handleChildCallback(engine, bot, update.callback_query);
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

  const user = await getOrCreateChildUser(engine, bot, msg.from, refId);
  const isAdmin = await engine.isChildAdmin(bot, userId);

  if (text === '/cancel' || text === '❌ Cancel') {
    await setChildState(engine, bot.id, userId, '', '');
    await sendChildHome(engine, bot, user, chatId, 'Cancelled.');
    return;
  }

  if (text === '/admin' || text === '👑 Admin Panel') {
    if (!isAdmin) {
      await sendMsg(bot.token, chatId, '❌ Access denied.');
      return;
    }
    await setChildState(engine, bot.id, userId, '', '');
    await sendChildAdminHome(engine, bot, chatId);
    return;
  }

  if (text.startsWith('/start')) {
    await setChildState(engine, bot.id, userId, '', '');
    if (!(await checkChildGuards(engine, bot, user, chatId))) return;
    await creditChildReferralIfEligible(engine, bot, userId);
    await sendChildHome(engine, bot, user, chatId);
    return;
  }

  if (user.state && !user.state.startsWith('ca_bc_ready')) {
    if (!(await checkChildGuards(engine, bot, user, chatId))) return;
    await handleChildStateInput(engine, bot, user, msg, chatId, text, isAdmin);
    return;
  }

  if (!(await checkChildGuards(engine, bot, user, chatId))) return;

  const isStar = isStarBotType(bot.bot_type);
  const isRedeem = isRedeemBotType(bot.bot_type);
  const isAdv = isAdvancedBotType(bot.bot_type);
  const isGmail = isGmailBotType(bot.bot_type);

  if (text === '🎁 Daily Bonus' || text === '🎁 Daily Stars' || text === '/daily') {
    const now = Math.floor(Date.now() / 1000);
    const bonus = Number(bot.daily_bonus || 0);
    const upd = await engine.db.run(
      'UPDATE child_users SET balance = balance + ?, total_earned = total_earned + ?, last_daily_at = ? WHERE bot_db_id = ? AND user_id = ? AND (? - last_daily_at) >= 86400',
      bonus,
      bonus,
      now,
      bot.id,
      userId,
      now
    );
    if (upd.changes <= 0) {
      const rem = 86400 - (now - Number(user.last_daily_at || 0));
      await sendMsg(
        bot.token,
        chatId,
        `⏳ <b>Already Claimed!</b>\n\nCome back in <b>${fmtDuration(Math.max(1, rem))}</b>.`
      );
      return;
    }
    const fresh = await engine.db.first(
      'SELECT balance FROM child_users WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      userId
    );
    await sendMsg(
      bot.token,
      chatId,
      `🎁 <b>Daily Bonus Claimed!</b>\n\n💰 Received: <b>+${fmtAmount(bot.currency, bonus)}</b>\n💼 New Balance: <b>${fmtAmount(bot.currency, fresh?.balance || 0)}</b>`
    );
    return;
  }

  if (text === '💰 Balance' || text === '⭐ My Stars' || text === '/balance' || text === '/stars') {
    const lines = [
      isStar ? `⭐ <b>Your Stars Wallet</b>` : `💰 <b>Your Wallet</b>`,
      `━━━━━━━━━━━━━━━━━━━━━`,
      `💼 Balance: <b>${fmtAmount(bot.currency, user.balance)}</b>`,
      `📈 Total Earned: ${fmtAmount(bot.currency, user.total_earned)}`,
      `💸 Total Withdrawn: ${fmtAmount(bot.currency, user.total_withdrawn)}`,
      `👥 Total Referrals: <code>${Number(user.total_refs || 0)}</code>`,
    ];
    if (!isRedeem) {
      lines.push(
        isStar
          ? `👤 Payout Username: <code>${esc(user.upi_id || 'Not set')}</code>`
          : `🏦 UPI ID: <code>${esc(user.upi_id || 'Not set')}</code>`
      );
    }
    await sendMsg(bot.token, chatId, lines.join('\n'));
    return;
  }

  if (text === '👥 Refer & Earn' || text === '/refer') {
    const link = `https://t.me/${bot.bot_username}?start=${userId}`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join & earn rewards!')}`;
    await sendMsg(
      bot.token,
      chatId,
      `👥 <b>Refer & Earn</b>\n━━━━━━━━━━━━━━━━━━━━━\n💰 Reward per verified referral: <b>+${fmtAmount(bot.currency, bot.per_refer)}</b>\n👥 Total Referrals: <code>${Number(user.total_refs || 0)}</code>\n\n🔗 <b>Your Invite Link:</b>\n<code>${esc(link)}</code>`,
      { inline_keyboard: [[{ text: '📤 Share Invite Link', url: shareUrl, style: 'primary' }]] }
    );
    return;
  }

  if (text === '🏦 Set UPI ID' || text === '/upi') {
    await setChildState(engine, bot.id, userId, 'c_await_upi', '');
    await sendMsg(
      bot.token,
      chatId,
      `🏦 <b>Set Your UPI ID</b>\n\nCurrent: <code>${esc(user.upi_id || 'None')}</code>\nSend your new UPI ID (e.g. <code>name@upi</code>):`,
      childCancelKeyboard()
    );
    return;
  }

  if (text === '👤 Set Username') {
    await setChildState(engine, bot.id, userId, 'c_await_star_user', '');
    await sendMsg(
      bot.token,
      chatId,
      `👤 <b>Set Telegram @username for Stars</b>\n\nCurrent: <code>${esc(user.upi_id || 'None')}</code>\nSend your Telegram <code>@username</code>:`,
      childCancelKeyboard()
    );
    return;
  }

  if (text === '💸 Withdraw' || text === '🌟 Withdraw Stars' || text === '/withdraw') {
    if (Number(bot.withdrawals_open) !== 1) {
      await sendMsg(bot.token, chatId, '🔒 Withdrawals are currently closed.');
      return;
    }
    if (!user.upi_id) {
      await setChildState(engine, bot.id, userId, isStar ? 'c_await_star_user' : 'c_await_upi', '');
      await sendMsg(
        bot.token,
        chatId,
        isStar
          ? '👤 Please send your Telegram <code>@username</code> first to receive Stars:'
          : '🏦 Please send your <b>UPI ID</b> first:',
        childCancelKeyboard()
      );
      return;
    }
    if (Number(user.balance) < Number(bot.min_withdraw)) {
      await sendMsg(
        bot.token,
        chatId,
        `❌ <b>Insufficient Balance</b>\n\nYour Balance: <b>${fmtAmount(bot.currency, user.balance)}</b>\nMinimum Withdraw: <b>${fmtAmount(bot.currency, bot.min_withdraw)}</b>`
      );
      return;
    }

    await setChildState(engine, bot.id, userId, 'c_await_wd_amt', '');
    if (isStar) {
      const packs = [15, 25, 50, 100].filter(
        (p) => p >= Number(bot.min_withdraw) && Number(user.balance) >= p
      );
      const kb = [];
      if (packs.length > 0) {
        kb.push(packs.map((p) => ({ text: `${p} ⭐`, callback_data: `c_star_pack:${p}`, style: 'primary' })));
      }
      kb.push([{ text: `🌟 Withdraw All (${fmtAmount(bot.currency, user.balance)})`, callback_data: 'c_wd_full', style: 'success' }]);
      await sendMsg(
        bot.token,
        chatId,
        `🌟 <b>Withdraw Stars</b>\n\n⭐ Balance: <b>${fmtAmount(bot.currency, user.balance)}</b>\n👤 Target: <code>${esc(user.upi_id)}</code>\n📉 Min: ${fmtAmount(bot.currency, bot.min_withdraw)}\n\nTap a pack or enter custom amount:`,
        { inline_keyboard: kb }
      );
      return;
    }

    await sendMsg(
      bot.token,
      chatId,
      `💸 <b>Withdraw Funds</b>\n\n💰 Balance: <b>${fmtAmount(bot.currency, user.balance)}</b>\n🏦 UPI: <code>${esc(user.upi_id)}</code>\n📉 Min Withdraw: ${fmtAmount(bot.currency, bot.min_withdraw)}\n\nEnter amount or tap below:`,
      {
        inline_keyboard: [
          [{ text: `💸 Withdraw Full (${fmtAmount(bot.currency, user.balance)})`, callback_data: 'c_wd_full', style: 'success' }],
        ],
      }
    );
    return;
  }

  if ((text === '🎁 Redeem Code' || text === '/redeem') && isRedeem) {
    await sendRedeemPlansToUser(engine, bot, user, chatId);
    return;
  }

  if (text === '📜 My Codes' && isRedeem) {
    const codes = await engine.db.all(
      `SELECT c.code, c.used_at, p.title FROM redeem_codes c
       LEFT JOIN redeem_plans p ON p.id = c.plan_id
       WHERE c.bot_db_id = ? AND c.used_by = ? ORDER BY c.used_at DESC LIMIT 15`,
      bot.id,
      userId
    );
    if (codes.length === 0) {
      await sendMsg(bot.token, chatId, '📜 <b>My Redeemed Codes</b>\n\nYou have not redeemed any codes yet.');
      return;
    }
    const lines = [`📜 <b>My Redeemed Codes (Last ${codes.length})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
    for (const c of codes) {
      lines.push(`• <b>${esc(c.title || 'Code')}</b>: <code>${esc(c.code)}</code> (${fmtDateShort(c.used_at)})`);
    }
    await sendMsg(bot.token, chatId, lines.join('\n'));
    return;
  }

  if (text === '📜 History' || text === '📜 Star History' || text === '/history') {
    const rows = await engine.db.all(
      'SELECT * FROM withdrawals WHERE bot_db_id = ? AND user_id = ? ORDER BY id DESC LIMIT 15',
      bot.id,
      userId
    );
    if (rows.length === 0) {
      await sendMsg(bot.token, chatId, '📜 <b>Withdrawal History</b>\n\nNo withdrawals yet.');
      return;
    }
    const lines = [`📜 <b>Withdrawal History</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
    for (const w of rows) {
      const icon = w.status === 'approved' ? '✅' : w.status === 'rejected' ? '❌' : '⏳';
      lines.push(
        `${icon} #${w.id} · <b>${fmtAmount(bot.currency, w.amount)}</b> (${w.status}) · ${fmtDateShort(w.created_at)}`
      );
    }
    await sendMsg(bot.token, chatId, lines.join('\n'));
    return;
  }

  if ((text === '📋 Tasks' || text === '/tasks') && isAdv) {
    await sendChildTasksToUser(engine, bot, userId, chatId);
    return;
  }

  if ((text === '🎫 Gift Code' || text === '/gift') && isAdv) {
    await setChildState(engine, bot.id, userId, 'c_await_promo', '');
    await sendMsg(
      bot.token,
      chatId,
      `🎫 <b>Redeem Gift / Promo Code</b>\n\nSend the promo code below:`,
      childCancelKeyboard()
    );
    return;
  }

  if ((text === '🏆 Leaderboard' || text === '/leaderboard') && isAdv) {
    const top = await engine.db.all(
      'SELECT first_name, total_refs, total_earned FROM child_users WHERE bot_db_id = ? ORDER BY total_refs DESC, total_earned DESC LIMIT 10',
      bot.id
    );
    const lines = [`🏆 <b>Top Referrers Leaderboard</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
    top.forEach((u, i) => {
      lines.push(
        `${i + 1}. <b>${esc(u.first_name || 'User')}</b> — ${u.total_refs} refs (${fmtAmount(bot.currency, u.total_earned)})`
      );
    });
    await sendMsg(bot.token, chatId, lines.join('\n'));
    return;
  }

  if (isGmail && (text === '🛒 Buy Gmail' || text === '/buy')) {
    await sendGmailPlansToUser(engine, bot, user, chatId);
    return;
  }

  if (isGmail && (text === '📤 Sell Gmail' || text === '/sell')) {
    if (Number(bot.gmail_sell_open) !== 1) {
      await sendMsg(bot.token, chatId, '🔒 Gmail selling is currently closed.');
      return;
    }
    await setChildState(engine, bot.id, userId, 'c_await_gsell', '');
    await sendMsg(
      bot.token,
      chatId,
      `📤 <b>Sell Gmail Accounts</b>\n\n💰 Rate per verified Gmail: <b>${fmtAmount(bot.currency, bot.gmail_sell_price)}</b>\n\nSend your Gmail(s) one per line in format:\n<code>email@gmail.com | password</code>`,
      childCancelKeyboard()
    );
    return;
  }

  if (isGmail && (text === '💳 Deposit' || text === '/deposit')) {
    await sendChildDepositInfo(engine, bot, chatId);
    return;
  }

  if (isGmail && (text === '📜 My Gmails' || text === '/mygmails')) {
    const gmails = await engine.db.all(
      `SELECT s.account_data, s.sold_at, p.title FROM gmail_stock s
       LEFT JOIN gmail_plans p ON p.id = s.plan_id
       WHERE s.bot_db_id = ? AND s.sold_to = ? ORDER BY s.sold_at DESC LIMIT 15`,
      bot.id,
      userId
    );
    if (gmails.length === 0) {
      await sendMsg(bot.token, chatId, '📜 <b>My Purchased Gmails</b>\n\nNo purchased Gmails yet.');
      return;
    }
    const lines = [`📜 <b>My Purchased Gmails (Last ${gmails.length})</b>`, `━━━━━━━━━━━━━━━━━━━━━`];
    for (const g of gmails) {
      lines.push(`• <b>${esc(g.title || 'Gmail')}</b>: <code>${esc(g.account_data)}</code>`);
    }
    await sendMsg(bot.token, chatId, lines.join('\n'));
    return;
  }

  if (text === '🆘 Support') {
    await sendMsg(
      bot.token,
      chatId,
      `🆘 <b>Support</b>\n\nNeed help? Contact ${esc(bot.support_username || '@Support')}`
    );
    return;
  }

  await sendChildHome(engine, bot, user, chatId);
}
