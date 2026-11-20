'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000';
const SECRET = fs.readFileSync(path.join(__dirname, '.nexus_jwt_secret'), 'utf8').trim();
function jwt(u) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b({ alg: 'HS256', typ: 'JWT' });
  const p = b({ id: u.id, email: u.email, name: u.name, role: u.role, iat: Math.floor(Date.now() / 1000), iatMs: Date.now(), exp: Math.floor(Date.now() / 1000) + 604800 });
  return h + '.' + p + '.' + crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
}
const U = { id: '1', email: 'paulolp0101@gmail.com', name: 'Paulo Lima', role: 'Administrador', active: true };
const T = jwt(U);
const PAGES = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'config', 'usuarios', 'assinaturas', 'pagamentos', 'logs'];
const WIDTHS = [390, 768, 1366, 1920];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  await page.goto(BASE + '/inicio', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([u, t]) => {
    localStorage.setItem('nexus_session', JSON.stringify({ email: u.email }));
    localStorage.setItem('nexus_cached_user', JSON.stringify(u));
    localStorage.setItem('nexus_token', JSON.stringify(t));
    localStorage.setItem('nexus_login_v5', 'true');
    sessionStorage.setItem('nexus_session_active', 'true');
    sessionStorage.setItem('nexus_last_activity', String(Date.now()));
  }, [U, T]);
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);

  for (const p of PAGES) {
    // troca de página pelo botão do menu (ou função global)
    const clicked = await page.evaluate((pg) => {
      const btn = document.querySelector('button[data-page="' + pg + '"]');
      if (btn) { btn.click(); return 'btn'; }
      if (typeof window.showPage === 'function') { window.showPage(pg); return 'fn'; }
      if (typeof window.navigate === 'function') { window.navigate(pg); return 'fn2'; }
      return null;
    }, p);
    await page.waitForTimeout(1800);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(900);
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const wide = [];
        document.querySelectorAll('#pageContent *').forEach(el => {
          const b = el.getBoundingClientRect();
          if (b.width > innerWidth + 6 && wide.length < 5) {
            wide.push(String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || el.tagName).slice(0, 40) + ':' + Math.round(b.width));
          }
        });
        const pc = document.querySelector('#pageContent');
        return { ox: de.scrollWidth > de.clientWidth + 2, sw: de.scrollWidth, cw: de.clientWidth, pcw: pc ? Math.round(pc.getBoundingClientRect().width) : 0, wide };
      });
      console.log(p.padEnd(12), String(w).padStart(4), JSON.stringify(m));
    }
  }
  await browser.close();
})();
