'use strict';
// Screenshots do app por módulo para o manual do usuário (uso pontual).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-core');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:3000';
const SECRET = fs.readFileSync(path.join(__dirname, '.nexus_jwt_secret'), 'utf8').trim();
const OUT = path.join(__dirname, 'images', 'manual');

function jwt(user) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64({ id: user.id, email: user.email, name: user.name, role: user.role, iat: Math.floor(Date.now() / 1000), iatMs: Date.now(), exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 });
  const s = crypto.createHmac('sha256', SECRET).update(h + '.' + p).digest('base64url');
  return h + '.' + p + '.' + s;
}

// Conta usada nas capturas: vem de NEXUS_DIAG_EMAIL ou pega o primeiro usuário ativo comum do cadastro local.
const USERS = require('./local_users.json');
const DONO = USERS.find(u => u && u.active !== false && String(u.role || '') === 'Usuário') || USERS.find(u => u && u.active !== false) || {};
const EMAIL = process.env.NEXUS_DIAG_EMAIL || DONO.email || 'manual@exemplo.com';
const USER = { id: DONO.id || '1', email: EMAIL, name: DONO.name || 'Usuário', role: DONO.role || 'Usuário', active: true, device_type: 'Computador', terms_accepted: true, subscription_status: 'active', subscription_plan: 'mensal' };
const TOKEN = jwt(USER);

const PAGINAS = [
  ['dashboard', 'painel-dashboard'],
  ['transacoes', 'modulo-lancamentos'],
  ['cartoes', 'modulo-contas-cartoes'],
  ['orcamentos', 'modulo-orcamentos'],
  ['metas', 'modulo-metas'],
  ['relatorios', 'modulo-relatorios'],
  ['recorrentes', 'modulo-recorrentes'],
  ['importar', 'modulo-importar'],
  ['anexos', 'modulo-documentos'],
  ['config', 'modulo-minha-conta']
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
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
  await page.waitForTimeout(6000);

  for (const [pagina, arquivo] of PAGINAS) {
    try {
      const clicado = await page.evaluate((p) => {
        const el = document.querySelector('button[data-page="' + p + '"]');
        if (!el) return false;
        el.click();
        return true;
      }, pagina);
      if (!clicado) { console.log('skip', pagina, '(botão não achado)'); continue; }
      await page.waitForTimeout(2800);
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.screenshot({ path: path.join(OUT, arquivo + '.png') });
      console.log('ok', arquivo + '.png');
    } catch (e) { console.log('erro', pagina, e.message); }
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
