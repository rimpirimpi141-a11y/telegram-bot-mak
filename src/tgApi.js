import { esc } from './db.js';

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function tgApi(token, method, params = {}, timeoutMs = 15000) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: timeoutController.signal,
    });
    return await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, description: msg };
  } finally {
    clearTimeout(timer);
  }
}

export async function setBotWebhook(token, webhookUrl, secretToken = '') {
  const params = {
    url: webhookUrl,
    allowed_updates: ['message', 'callback_query'],
  };
  if (secretToken) {
    params.secret_token = secretToken;
  }
  return tgApi(token, 'setWebhook', params);
}

export async function deleteBotWebhook(token) {
  return tgApi(token, 'deleteWebhook', { drop_pending_updates: false });
}

export async function sendMsg(token, chatId, text, replyMarkup) {
  const params = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) params.reply_markup = replyMarkup;
  return tgApi(token, 'sendMessage', params);
}

export async function sendPhotoMsg(token, chatId, photoFileId, caption, replyMarkup) {
  const params = {
    chat_id: chatId,
    photo: photoFileId,
    caption,
    parse_mode: 'HTML',
  };
  if (replyMarkup) params.reply_markup = replyMarkup;
  return tgApi(token, 'sendPhoto', params);
}

export async function editMsg(token, chatId, messageId, text, replyMarkup) {
  const params = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) params.reply_markup = replyMarkup;
  return tgApi(token, 'editMessageText', params);
}

export async function answerCb(token, cbId, text = '', showAlert = false) {
  const params = { callback_query_id: cbId };
  if (text) {
    params.text = text;
    params.show_alert = showAlert;
  }
  await tgApi(token, 'answerCallbackQuery', params);
}

export async function checkForceJoin(token, channels, userId) {
  const unjoined = [];
  for (const ch of channels) {
    const res = await tgApi(token, 'getChatMember', {
      chat_id: ch.chat_id,
      user_id: userId,
    });
    if (!res.ok || !res.result) continue;
    const st = res.result.status || 'left';
    const isMem =
      st === 'creator' ||
      st === 'administrator' ||
      st === 'member' ||
      (st === 'restricted' && Boolean(res.result.is_member));
    if (!isMem) unjoined.push(ch);
  }
  return unjoined;
}

export function buildForceJoinMarkup(channels, verifyCallback) {
  const rows = [];
  channels.forEach((ch, idx) => {
    const label = ch.title || `Channel ${idx + 1}`;
    if (ch.invite_link) rows.push([{ text: `📢 Join ${label}`, url: ch.invite_link, style: 'primary' }]);
  });
  rows.push([{ text: '✅ I Joined / Verify', callback_data: verifyCallback, style: 'success' }]);
  return { inline_keyboard: rows };
}

export async function resolveChannelInput(token, rawInput) {
  let input = rawInput.trim();
  let manualLink = '';
  if (input.includes('|')) {
    const parts = input.split('|', 2).map((s) => s.trim());
    input = parts[0];
    manualLink = parts[1] || '';
  }
  const linkMatch = input.match(/^https?:\/\/t\.me\/([A-Za-z0-9_]+)$/i);
  if (linkMatch) input = '@' + linkMatch[1];

  const chatRes = await tgApi(token, 'getChat', { chat_id: input });
  if (!chatRes.ok || !chatRes.result) {
    return {
      ok: false,
      error: chatRes.description || 'Channel not found. Make sure the bot is an Admin in that channel.',
    };
  }

  const chat = chatRes.result;
  const chatId = String(chat.id);
  const title = String(chat.title || chat.username || chatId);
  const username = chat.username || '';

  const meRes = await tgApi(token, 'getMe');
  if (meRes.ok && meRes.result) {
    const memRes = await tgApi(token, 'getChatMember', {
      chat_id: chatId,
      user_id: meRes.result.id,
    });
    const botStatus = memRes.result?.status || 'left';
    if (botStatus !== 'administrator' && botStatus !== 'creator') {
      return {
        ok: false,
        error: `Please make this bot an Administrator in "${esc(title)}" first so it can verify members.`,
      };
    }
  }

  let inviteLink = manualLink;
  if (!inviteLink && username) inviteLink = `https://t.me/${username}`;
  if (!inviteLink && chat.invite_link) inviteLink = chat.invite_link;
  if (!inviteLink) {
    const exp = await tgApi(token, 'exportChatInviteLink', { chat_id: chatId });
    if (exp.ok && typeof exp.result === 'string') inviteLink = exp.result;
  }

  if (!inviteLink) {
    return {
      ok: false,
      error: 'Private channel detected without invite link. Send format: <code>-1001234567890 | https://t.me/+InviteLink</code>',
    };
  }

  return { ok: true, chatId, title, inviteLink };
}

export async function executeBroadcast(token, userIds, text, inlineMarkup) {
  let sent = 0;
  let failed = 0;
  for (const uid of userIds) {
    const res = await sendMsg(token, uid, text, inlineMarkup);
    if (res.ok) {
      sent++;
    } else if (res.error_code === 429) {
      const retry = Math.min(res.parameters?.retry_after ?? 2, 10);
      await sleep(retry * 1000);
      const retryRes = await sendMsg(token, uid, text, inlineMarkup);
      if (retryRes.ok) sent++;
      else failed++;
    } else {
      failed++;
    }
    await sleep(35);
  }
  return { sent, failed };
}
