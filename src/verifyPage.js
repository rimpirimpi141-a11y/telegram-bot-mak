import { esc } from './db.js';

export function renderDeviceVerifyHtml(token, botLabel) {
  const safeToken = esc(token);
  const safeLabel = esc(botLabel || 'Telegram Bot');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Device Verification · ${safeLabel}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #eef2ff 0%, #f0fdf4 50%, #fdf2f8 100%);
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      width: 100%;
      max-width: 420px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      overflow: hidden;
      box-shadow: 0 18px 40px -18px rgba(79, 70, 229, 0.25);
      text-align: center;
    }
    .hero {
      background: linear-gradient(120deg, #4f46e5, #0ea5e9, #10b981);
      padding: 22px 24px;
      color: #ffffff;
    }
    .hero h1 { margin: 0 0 6px; font-size: 21px; font-weight: 700; }
    .hero p { margin: 0; font-size: 13px; color: rgba(255, 255, 255, 0.92); line-height: 1.45; }
    .body { padding: 24px; }
    .box {
      padding: 14px 16px;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      background: #f1f5f9;
      color: #334155;
      margin-bottom: 18px;
      border: 1px solid #e2e8f0;
    }
    .ok { background: #ecfdf5; color: #065f46; border: 1px solid #6ee7b7; }
    .err { background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; }
    button {
      width: 100%;
      padding: 13px 16px;
      font-size: 15px;
      font-weight: 700;
      border: 0;
      border-radius: 12px;
      background: linear-gradient(120deg, #4f46e5, #2563eb);
      color: #ffffff;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .meta { margin-top: 14px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="hero">
      <h1>Device Verification</h1>
      <p>One account per device is allowed on <strong>${safeLabel}</strong></p>
    </div>
    <div class="body">
      <div id="statusBox" class="box">Ready to verify your device</div>
      <button id="verifyBtn" type="button">Verify My Device</button>
      <div class="meta">Return to Telegram after verification completes.</div>
    </div>
  </div>
  <script>
    (function () {
      var token = ${JSON.stringify(safeToken)};
      var btn = document.getElementById('verifyBtn');
      var box = document.getElementById('statusBox');

      function getCanvasPrint() {
        try {
          var c = document.createElement('canvas');
          c.width = 220;
          c.height = 40;
          var ctx = c.getContext('2d');
          if (!ctx) return 'no-ctx';
          ctx.textBaseline = 'top';
          ctx.font = '14px Arial';
          ctx.fillStyle = '#0f172a';
          ctx.fillText('TeleFactory-Device-Check', 4, 4);
          return c.toDataURL().slice(-64);
        } catch (e) {
          return 'no-canvas';
        }
      }

      async function buildDeviceHash() {
        var storedId = '';
        try {
          storedId = localStorage.getItem('tf_device_uid') || '';
          if (!storedId) {
            storedId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + Date.now());
            localStorage.setItem('tf_device_uid', storedId);
          }
        } catch (e) {
          storedId = 'ephemeral';
        }
        var raw = [
          navigator.userAgent || '',
          navigator.platform || '',
          navigator.language || '',
          String(navigator.hardwareConcurrency || 0),
          String(navigator.deviceMemory || 0),
          screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
          Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          getCanvasPrint(),
          storedId
        ].join('|');

        if (window.crypto && crypto.subtle) {
          var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
          return Array.from(new Uint8Array(buf)).map(function (b) {
            return b.toString(16).padStart(2, '0');
          }).join('');
        }
        var hash = 0;
        for (var i = 0; i < raw.length; i++) {
          hash = ((hash << 5) - hash) + raw.charCodeAt(i);
          hash |= 0;
        }
        return 'fp_' + Math.abs(hash).toString(16);
      }

      async function runVerify() {
        btn.disabled = true;
        box.className = 'box';
        box.textContent = 'Checking device...';
        try {
          var fp = await buildDeviceHash();
          var res = await fetch('/api/verify-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: token, deviceHash: fp })
          });
          var data = await res.json();
          if (res.ok && data.ok) {
            box.className = 'box ok';
            box.textContent = data.message || 'Device verified! Return to Telegram.';
            btn.textContent = 'Verified';
          } else {
            box.className = 'box err';
            box.textContent = data.error || 'Verification failed.';
            btn.disabled = false;
          }
        } catch (e) {
          box.className = 'box err';
          box.textContent = 'Network error. Please try again.';
          btn.disabled = false;
        }
      }

      btn.addEventListener('click', runVerify);
    })();
  </script>
</body>
</html>`;
}
