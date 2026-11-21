'use strict';
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
  return h + '.' + p + '.' + crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
}
const USER = { id: '1', email: process.env.NEXUS_DIAG_EMAIL || 'diag@teste.nexus', name: 'Paulo Lima', role: 'Administrador', active: true };
const TOKEN = jwt(USER);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 2560, height: 1400 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/inicio', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([u, t]) => {
    localStorage.setItem('nexus_session', JSON.stringify({ email: u.email }));
    localStorage.setItem('nexus_cached_user', JSON.stringify(u));
    localStorage.setItem('nexus_token', JSON.stringify(t));
    localStorage.setItem('nexus_login_v5', 'true');
    sessionStorage.setItem('nexus_session_active', 'true');
    sessionStorage.setItem('nexus_last_activity', String(Date.now()));
  }, [USER, TOKEN]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const out = await page.evaluate(() => {
    const pc = document.querySelector('#pageContent');
    if (!pc) return 'sem #pageContent';
    const rows = [];
    pc.querySelectorAll(':scope > *').forEach(el => {
      const b = el.getBoundingClientRect();
      const cls = (typeof el.className === 'string' ? el.className : '') || el.id || el.tagName;
      rows.push({ cls: String(cls).slice(0, 60), x: Math.round(b.x), w: Math.round(b.width) });
    });
    return { pcW: Math.round(pc.getBoundingClientRect().width), children: rows.slice(0, 40) };
  });
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
