'use strict';
// Screenshots do app em várias larguras (uso pontual de depuração visual).
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

const WIDTHS = [
  { w: 390, h: 844, name: 'mobile' },
  { w: 768, h: 1024, name: 'tablet' },
  { w: 1366, h: 768, name: 'notebook' },
  { w: 1920, h: 1080, name: 'monitor' },
  { w: 2560, h: 1440, name: 'wide' }
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  for (const vp of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    // semeia a sessão na origem antes de carregar o app
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
    await page.waitForTimeout(6000);
    // rola a página para forçar render de seções lazy
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(800);
    const file = path.join(__dirname, 'shots', 'app-' + vp.name + '-' + vp.w + '.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: false });
    // métricas de layout para diagnóstico
    const metrics = await page.evaluate(() => {
      const de = document.documentElement;
      const main = document.querySelector('#pageContent') || document.querySelector('main') || document.body;
      return {
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        overflowX: de.scrollWidth > de.clientWidth + 2,
        bodyScrollW: document.body.scrollWidth,
        title: document.title
      };
    });
    console.log(vp.name, vp.w + 'x' + vp.h, JSON.stringify(metrics));
    await ctx.close();
  }
  await browser.close();
})();
