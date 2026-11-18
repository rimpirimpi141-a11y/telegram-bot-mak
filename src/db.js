export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtNum(num) {
  const n = Number(num || 0);
  if (Math.abs(n - Math.round(n)) < 0.00001) {
    return String(Math.round(n));
  }
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export function fmtDuration(seconds) {
  if (seconds <= 0) return 'now';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function fmtDateShort(unixSec) {
  const d = new Date(Number(unixSec || 0) * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

export function isStarBotType(t) {
  return t === 'star_normal' || t === 'star_advanced';
}

export function isRedeemBotType(t) {
  return t === 'redeem_normal' || t === 'redeem_advanced';
}

export function isAdvancedBotType(t) {
  return t === 'upi_advanced' || t === 'redeem_advanced' || t === 'star_advanced';
}

export function isGmailBotType(t) {
  return t === 'gmail_bot';
}

export function fmtAmount(currency, amount) {
  if (currency === '⭐') return `${fmtNum(amount)} ⭐`;
  return `${currency}${fmtNum(amount)}`;
}

export function botTypeLabel(t) {
  if (t === 'upi_advanced') return '🚀 Advanced UPI Bot';
  if (t === 'redeem_normal') return '🎟 Normal Redeem Bot';
  if (t === 'redeem_advanced') return '💎 Advanced Redeem Bot';
  if (t === 'star_normal') return '⭐ Normal Star Bot';
  if (t === 'star_advanced') return '🌟 Advanced Star Bot';
  if (t === 'gmail_bot') return '📧 Gmail Buy & Sell Bot';
  return '💸 Normal UPI Bot';
}

let seededInIsolate = false;

export class D1Client {
  constructor(d1) {
    this.d1 = d1;
  }

  prepare(sql, ...params) {
    const clean = params.map((v) => (v === undefined ? null : v));
    return clean.length > 0 ? this.d1.prepare(sql).bind(...clean) : this.d1.prepare(sql);
  }

  async first(sql, ...params) {
    const row = await this.prepare(sql, ...params).first();
    return row ?? null;
  }

  async all(sql, ...params) {
    const res = await this.prepare(sql, ...params).all();
    return Array.isArray(res?.results) ? res.results : [];
  }

  async run(sql, ...params) {
    const res = await this.prepare(sql, ...params).run();
    return {
      changes: Number(res?.meta?.changes ?? 0),
      lastRowId: Number(res?.meta?.last_row_id ?? 0),
    };
  }

  async batch(statements) {
    if (!statements || statements.length === 0) return [];
    const out = [];
    for (let i = 0; i < statements.length; i += 50) {
      const chunk = statements.slice(i, i + 50);
      const res = await this.d1.batch(chunk);
      out.push(...res);
    }
    return out;
  }

  async ensureSeeded(defaults = {}) {
    if (seededInIsolate) return;
    const existing = await this.first("SELECT value FROM settings WHERE key = 'daily_coins'");
    if (existing) {
      seededInIsolate = true;
      return;
    }

    const dDaily = Number(defaults.dailyCoins ?? 2);
    const dCost = Number(defaults.botCost ?? 5);
    const dRef = Number(defaults.masterRefCoins ?? 1);

    const pairs = [
      ['daily_coins', String(Number.isFinite(dDaily) ? dDaily : 2)],
      ['bot_cost', String(Number.isFinite(dCost) ? dCost : 5)],
      ['cost_upi_normal', String(Number.isFinite(dCost) ? dCost : 5)],
      ['cost_upi_advanced', String((Number.isFinite(dCost) ? dCost : 5) * 2)],
      ['cost_redeem_normal', String(Number.isFinite(dCost) ? dCost : 5)],
      ['cost_redeem_advanced', String((Number.isFinite(dCost) ? dCost : 5) * 2)],
      ['cost_star_normal', String(Number.isFinite(dCost) ? dCost : 5)],
      ['cost_star_advanced', String((Number.isFinite(dCost) ? dCost : 5) * 2)],
      ['cost_gmail_bot', String((Number.isFinite(dCost) ? dCost : 5) * 2)],
      ['master_ref_coins', String(Number.isFinite(dRef) ? dRef : 1)],
      ['maintenance', '0'],
      ['support_username', '@Support'],
      ['master_bot_username', ''],
      ['master_device_verify', '1'],
      ['deposit_enabled', '1'],
      ['deposit_rs', '10'],
      ['deposit_coins', '5'],
      ['min_deposit_rs', '10'],
      ['deposit_qr_file_id', ''],
      ['deposit_upi_id', ''],
    ];

    const stmts = pairs.map(([k, v]) => this.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v));
    await this.batch(stmts);
    seededInIsolate = true;
  }
}
