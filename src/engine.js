import { D1Client } from './db.js';
import { sendMsg, setBotWebhook, deleteBotWebhook, tgApi } from './tgApi.js';
import { handleMasterUpdate, creditMasterReferralIfEligible, sendMasterHome } from './masterBot.js';
import { handleChildUpdate, creditChildReferralIfEligible, sendChildHome } from './childBot.js';

function randomHex(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function parseAdminIds(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export class BotWorkerEngine {
  constructor(env, origin = '', ctx = null) {
    this.env = env;
    this.db = new D1Client(env.DB);
    this.masterToken = String(env.BOT_TOKEN || '').trim();
    this.primaryAdminIds = parseAdminIds(env.ADMIN_ID);
    this.webhookSecret = String(env.WEBHOOK_SECRET || '').trim();
    this.origin = (String(env.APP_URL || '').trim().replace(/\/+$/, '')) || String(origin || '').replace(/\/+$/, '');
    this.ctx = ctx;
    this.masterUsername = '';
    this.masterBotName = '';
  }

  async init() {
    await this.db.ensureSeeded({
      dailyCoins: Number(this.env.DEFAULT_DAILY_COINS || 2),
      botCost: Number(this.env.DEFAULT_BOT_COST || 5),
      masterRefCoins: Number(this.env.DEFAULT_MASTER_REF_COINS || 1),
    });
  }

  async getSetting(key, fallback = '') {
    const row = await this.db.first('SELECT value FROM settings WHERE key = ?', key);
    return row ? String(row.value) : fallback;
  }

  async setSetting(key, value) {
    await this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      String(value)
    );
  }

  async getMasterUsername() {
    if (this.masterUsername) return this.masterUsername;
    const cached = await this.getSetting('master_bot_username', '');
    if (cached) {
      this.masterUsername = cached;
      return cached;
    }
    if (!this.masterToken) return '';
    const me = await tgApi(this.masterToken, 'getMe');
    if (me.ok && me.result?.username) {
      this.masterUsername = me.result.username;
      this.masterBotName = me.result.first_name || 'Bot Maker';
      await this.setSetting('master_bot_username', this.masterUsername);
      return this.masterUsername;
    }
    return '';
  }

  async getAllMasterAdmins() {
    const rows = await this.db.all('SELECT user_id FROM master_admins ORDER BY added_at ASC');
    const extra = rows.map((r) => Number(r.user_id));
    return Array.from(new Set([...this.primaryAdminIds, ...extra]));
  }

  async isMasterAdmin(userId) {
    if (this.primaryAdminIds.includes(userId)) return true;
    const row = await this.db.first('SELECT 1 AS ok FROM master_admins WHERE user_id = ?', userId);
    return Boolean(row);
  }

  async isChildAdmin(bot, userId) {
    if (Number(userId) === Number(bot.owner_id)) return true;
    const row = await this.db.first(
      'SELECT 1 AS ok FROM child_admins WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      userId
    );
    return Boolean(row);
  }

  async getAllChildAdmins(bot) {
    const rows = await this.db.all('SELECT user_id FROM child_admins WHERE bot_db_id = ?', bot.id);
    const ids = rows.map((r) => Number(r.user_id));
    return Array.from(new Set([Number(bot.owner_id), ...ids]));
  }

  async getVerifyBaseUrl() {
    const custom = (await this.getSetting('verify_base_url', '')).trim().replace(/\/+$/, '');
    if (custom) return custom;
    return this.origin;
  }

  async createDeviceVerifyLink(scope, botDbId, userId) {
    const base = await this.getVerifyBaseUrl();
    if (!base.startsWith('https://') && !base.startsWith('http://')) return null;
    const token = randomHex(16);
    await this.db.run(
      'INSERT INTO device_tokens (token, scope, bot_db_id, user_id, created_at, used) VALUES (?, ?, ?, ?, ?, 0)',
      token,
      scope,
      botDbId,
      userId,
      Math.floor(Date.now() / 1000)
    );
    return `${base}/verify?token=${token}`;
  }

  async getDeviceTokenInfo(token) {
    await this.init();
    const row = await this.db.first('SELECT * FROM device_tokens WHERE token = ? AND used = 0', token);
    const now = Math.floor(Date.now() / 1000);
    if (!row || now - Number(row.created_at) > 1800) {
      return { valid: false, botLabel: 'Telegram Bot' };
    }
    if (row.scope === 'master') {
      const uname = await this.getMasterUsername();
      return { valid: true, botLabel: this.masterBotName || (uname ? `@${uname}` : 'Telegram Bot') };
    }
    const bot = await this.db.first('SELECT bot_name, bot_username FROM bots WHERE id = ?', row.bot_db_id);
    return { valid: true, botLabel: bot?.bot_name || `@${bot?.bot_username || 'Bot'}` };
  }

  async verifyDeviceByToken(token, deviceHash, ip) {
    await this.init();
    const cleanHash = String(deviceHash || '').trim().slice(0, 128);
    if (!token || !cleanHash) {
      return { ok: false, status: 400, error: 'Missing verification token or device fingerprint.' };
    }

    const row = await this.db.first('SELECT * FROM device_tokens WHERE token = ?', token);
    const now = Math.floor(Date.now() / 1000);
    if (!row || Number(row.used) === 1 || now - Number(row.created_at) > 1800) {
      return { ok: false, status: 400, error: 'Verification link expired. Request a new one in Telegram.' };
    }

    if (row.scope === 'master') {
      const dup = await this.db.first(
        'SELECT user_id FROM master_users WHERE device_hash = ? AND device_verified = 1 AND user_id != ?',
        cleanHash,
        row.user_id
      );
      if (dup) {
        await sendMsg(
          this.masterToken,
          row.user_id,
          '🚫 <b>Device Verification Failed</b>\n\nThis device is already registered to another Telegram account. Multi-accounting is not allowed.'
        );
        return { ok: false, status: 409, error: 'This device is already linked to another Telegram account.' };
      }

      await this.db.run(
        'UPDATE master_users SET device_verified = 1, device_hash = ?, device_ip = ? WHERE user_id = ?',
        cleanHash,
        String(ip || '').slice(0, 64),
        row.user_id
      );
      await this.db.run('UPDATE device_tokens SET used = 1 WHERE token = ?', token);

      await creditMasterReferralIfEligible(this, Number(row.user_id));
      await sendMasterHome(this, Number(row.user_id), Number(row.user_id), 'Device Verified! You now have full access.');
      return { ok: true, status: 200, message: 'Device verified! You can return to Telegram now.' };
    }

    const bot = await this.db.first('SELECT * FROM bots WHERE id = ?', row.bot_db_id);
    if (!bot) {
      return { ok: false, status: 404, error: 'Bot not found.' };
    }

    const dup = await this.db.first(
      'SELECT user_id FROM child_users WHERE bot_db_id = ? AND device_hash = ? AND device_verified = 1 AND user_id != ?',
      bot.id,
      cleanHash,
      row.user_id
    );
    if (dup) {
      await sendMsg(
        bot.token,
        row.user_id,
        '🚫 <b>Device Verification Failed</b>\n\nThis device is already registered to another account in this bot.'
      );
      return { ok: false, status: 409, error: 'This device is already linked to another Telegram account.' };
    }

    await this.db.run(
      'UPDATE child_users SET device_verified = 1, device_hash = ?, device_ip = ? WHERE bot_db_id = ? AND user_id = ?',
      cleanHash,
      String(ip || '').slice(0, 64),
      bot.id,
      row.user_id
    );
    await this.db.run('UPDATE device_tokens SET used = 1 WHERE token = ?', token);

    const user = await this.db.first(
      'SELECT * FROM child_users WHERE bot_db_id = ? AND user_id = ?',
      bot.id,
      row.user_id
    );
    if (user) {
      if (Number(user.referred_by) > 0 && Number(user.ref_credited) === 0) {
        await creditChildReferralIfEligible(this, bot, Number(row.user_id));
      }
      await sendChildHome(this, bot, user, Number(row.user_id), 'Device Verified! Welcome.');
    }
    return { ok: true, status: 200, message: 'Device verified! Return to Telegram now.' };
  }

  async syncChildWebhook(botId, token, isActive) {
    if (!token) return { ok: false };
    if (!isActive) {
      return deleteBotWebhook(token);
    }
    if (!this.origin) return { ok: false, description: 'Worker origin unavailable' };
    return setBotWebhook(token, `${this.origin}/webhook/child/${botId}`, this.webhookSecret);
  }

  async setupWebhooks() {
    await this.init();
    if (!this.masterToken) {
      return { ok: false, error: 'BOT_TOKEN binding is missing.' };
    }
    const me = await tgApi(this.masterToken, 'getMe');
    if (!me.ok || !me.result) {
      return { ok: false, error: me.description || 'Failed to verify BOT_TOKEN with Telegram.' };
    }
    this.masterUsername = me.result.username || '';
    this.masterBotName = me.result.first_name || 'Bot Maker';
    await this.setSetting('master_bot_username', this.masterUsername);

    const masterWebhookUrl = `${this.origin}/webhook`;
    const whRes = await setBotWebhook(this.masterToken, masterWebhookUrl, this.webhookSecret);
    if (!whRes.ok) {
      return { ok: false, error: whRes.description || 'Failed to register Master Bot webhook.' };
    }

    const activeBots = await this.db.all('SELECT id, token, bot_username FROM bots WHERE is_active = 1');
    let childSynced = 0;
    for (const b of activeBots) {
      const r = await this.syncChildWebhook(b.id, b.token, true);
      if (r.ok) childSynced++;
    }

    return {
      ok: true,
      master: {
        id: me.result.id,
        username: this.masterUsername,
        webhookUrl: masterWebhookUrl,
      },
      childBotsSynced: childSynced,
      totalActiveChildBots: activeBots.length,
    };
  }

  runBackground(promise) {
    if (this.ctx && typeof this.ctx.waitUntil === 'function') {
      this.ctx.waitUntil(promise.catch((err) => console.error('[Background Error]', err)));
    } else {
      promise.catch((err) => console.error('[Background Error]', err));
    }
  }

  async handleMasterUpdate(update) {
    await this.init();
    return handleMasterUpdate(this, update);
  }

  async handleChildUpdate(botId, update) {
    await this.init();
    const bot = await this.db.first('SELECT * FROM bots WHERE id = ?', botId);
    if (!bot) return { ignored: 'bot_not_found' };
    return handleChildUpdate(this, bot, update);
  }
}
