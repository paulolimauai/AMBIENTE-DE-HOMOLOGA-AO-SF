'use strict';
// Diagnóstico numérico do layout em várias larguras (sem screenshots).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000';
const SECRET = fs.readFileSync(path.join(__dirname, '.nexus_jwt_secret'), 'utf8').trim();

function jwt(user) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ id: user.id, email: user.email, name: user.name, role: user.role, iat: Math.floor(Date.now() / 1000), iatMs: Date.now(), exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 });
  const s = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}
const USER = { id: '1', email: 'paulolp0101@gmail.com', name: 'Paulo Lima', role: 'Administrador', active: true, device_type: 'Computador', terms_accepted: true, subscription_status: 'ativo', subscription_plan: 'mensal' };
const TOKEN = jwt(USER);

const WIDTHS = [390, 600, 768, 861, 1024, 1180, 1280, 1366, 1440, 1600, 1920, 2560];

const PROBE = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const cs = (el, prop) => el ? getComputedStyle(el)[prop] : null;
  const q = (s) => document.querySelector(s);
  const qa = (s) => Array.from(document.querySelectorAll(s));
  const out = { vw: innerWidth };
  out.sidebar = r(q('#menu, .sidebar, nav.sidebar, #sidebar'));
  out.topbar = r(q('.topheader, header, #topbar, .top-bar'));
  out.pageContent = r(q('#pageContent, .page-content, main'));
  out.h1 = qa('h1,h2').slice(0,3).map(el => ({ t: (el.textContent||'').trim().slice(0,30), fs: cs(el,'fontSize'), r: r(el) }));
  out.kpis = qa('.kpi, .tx-kpi, .orc-summary > .kpi, .kpi-card').slice(0,8).map(el => r(el));
  out.kpiGridCols = (() => { const g = q('.tx-kpis, .orc-summary, .kpi-grid, .cards-summary-panel .kpi-grid'); return g ? getComputedStyle(g).gridTemplateColumns : null; })();
  out.bodyFs = cs(document.body, 'fontSize');
  out.pFs = cs(q('p, .sub, small'), 'fontSize');
  out.tableMinW = (() => { const t = q('#pageContent table'); return t ? getComputedStyle(t).minWidth : null; })();
  out.docFs = cs(document.documentElement, 'fontSize');
  // elementos mais largos que a viewport (overflow horizontal interno)
  const wide = [];
  qa('#pageContent *').forEach(el => { const b = el.getBoundingClientRect(); if (b.width > innerWidth + 4 && wide.length < 8) wide.push((el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || el.tagName) + ':' + Math.round(b.width)); });
  out.overflowEls = wide;
  return out;
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/inicio', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([u, t]) => {
    localStorage.setItem('nexus_session', JSON.stringify({ email: u.email }));
    localStorage.setItem('nexus_cached_user', JSON.stringify(u));
    localStorage.setItem('nexus_token', JSON.stringify(t));
    localStorage.setItem('nexus_auth_token', JSON.stringify(t));
    localStorage.setItem('nexus_login_v5', 'true');
    localStorage.setItem('nexus_theme', 'dark');
    sessionStorage.setItem('nexus_session_active', 'true');
    sessionStorage.setItem('nexus_last_activity', String(Date.now()));
  }, [USER, TOKEN]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);

  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(PROBE);
    console.log('=== ' + w + 'px ===');
    console.log(JSON.stringify(m, null, 1));
  }
  await browser.close();
})();
