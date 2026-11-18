import { BotWorkerEngine } from './engine.js';
import { renderDeviceVerifyHtml } from './verifyPage.js';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) {
    diff |= ba[i] ^ bb[i];
  }
  return diff === 0;
}

function validateWebhookSecret(request, env) {
  const expected = String(env.WEBHOOK_SECRET || '').trim();
  if (!expected) {
    return { ok: false, status: 500, error: 'WEBHOOK_SECRET is not configured in Worker environment.' };
  }
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || '';
  if (!timingSafeEqualStr(provided, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized webhook request.' };
  }
  return { ok: true };
}

function validateSetupAuth(request, url, env) {
  const expected = String(env.WEBHOOK_SECRET || '').trim();
  if (!expected) {
    return { ok: false, status: 500, error: 'WEBHOOK_SECRET is not configured in Worker environment.' };
  }
  const authHeader = request.headers.get('Authorization') || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const provided =
    request.headers.get('X-Setup-Secret') ||
    bearer ||
    url.searchParams.get('secret') ||
    '';
  if (!timingSafeEqualStr(provided, expected)) {
    return { ok: false, status: 401, error: 'Unauthorized setup request.' };
  }
  return { ok: true };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'GET' && (path === '/' || path === '/health')) {
      return jsonResponse({
        ok: true,
        status: 'healthy',
        service: 'telegram-bot-maker-worker',
      });
    }

    if ((method === 'GET' || method === 'POST') && path === '/setup') {
      const auth = validateSetupAuth(request, url, env);
      if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
      if (!env.DB) return jsonResponse({ ok: false, error: 'D1 binding DB is not configured.' }, 500);
      const engine = new BotWorkerEngine(env, url.origin, ctx);
      const res = await engine.setupWebhooks();
      return jsonResponse(res, res.ok ? 200 : 500);
    }

    if (method === 'POST' && (path === '/webhook' || path === '/webhook/master')) {
      const auth = validateWebhookSecret(request, env);
      if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
      if (!env.BOT_TOKEN || !env.DB) {
        return jsonResponse({ ok: false, error: 'Missing BOT_TOKEN or DB binding.' }, 500);
      }

      let update;
      try {
        update = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
      }

      const engine = new BotWorkerEngine(env, url.origin, ctx);
      try {
        await engine.handleMasterUpdate(update);
      } catch (err) {
        console.error('[Master Webhook Error]', err);
      }
      return jsonResponse({ ok: true });
    }

    const childMatch = path.match(/^\/webhook\/child\/(\d+)$/);
    if (method === 'POST' && childMatch) {
      const auth = validateWebhookSecret(request, env);
      if (!auth.ok) return jsonResponse({ ok: false, error: auth.error }, auth.status);
      if (!env.DB) return jsonResponse({ ok: false, error: 'Missing DB binding.' }, 500);

      const botId = Number(childMatch[1]);
      let update;
      try {
        update = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
      }

      const engine = new BotWorkerEngine(env, url.origin, ctx);
      try {
        await engine.handleChildUpdate(botId, update);
      } catch (err) {
        console.error(`[Child Webhook #${botId} Error]`, err);
      }
      return jsonResponse({ ok: true });
    }

    if (method === 'GET' && path === '/verify') {
      if (!env.DB) return htmlResponse('Database not configured.', 500);
      const token = String(url.searchParams.get('token') || '').trim();
      if (!token) {
        return htmlResponse(
          '<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;"><h2>Invalid Verification Link</h2><p>Missing token parameter. Please request a fresh verification link inside Telegram.</p></body></html>',
          400
        );
      }
      const engine = new BotWorkerEngine(env, url.origin, ctx);
      const info = await engine.getDeviceTokenInfo(token);
      if (!info.valid) {
        return htmlResponse(
          '<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:40px;text-align:center;"><h2>Verification Link Expired</h2><p>This verification link has expired or was already used. Return to Telegram and send /start to get a new link.</p></body></html>',
          400
        );
      }
      return htmlResponse(renderDeviceVerifyHtml(token, info.botLabel));
    }

    if (method === 'POST' && path === '/api/verify-device') {
      if (!env.DB) return jsonResponse({ ok: false, error: 'Database not configured.' }, 500);
      let body = {};
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400);
      }
      const token = String(body.token || '').trim();
      const deviceHash = String(body.deviceHash || '').trim();
      const ip =
        request.headers.get('CF-Connecting-IP') ||
        String(request.headers.get('X-Forwarded-For') || '').split(',')[0].trim() ||
        '';
      const engine = new BotWorkerEngine(env, url.origin, ctx);
      const result = await engine.verifyDeviceByToken(token, deviceHash, ip);
      return jsonResponse(
        { ok: result.ok, message: result.message, error: result.error },
        result.status
      );
    }

    return jsonResponse({ ok: false, error: 'Not Found' }, 404);
  },
};
