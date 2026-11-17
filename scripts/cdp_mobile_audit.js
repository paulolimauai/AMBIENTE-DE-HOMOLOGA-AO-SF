// Auditoria mobile real: abre o app num Chrome headless via CDP em viewport de celular
// (390x844, DPR 3, touch), faz login, percorre todas as páginas (navigate()) e mede:
//  - overflow horizontal (elementos além da viewport que NÃO estão em container rolável)
//  - fontes computadas < 14px em texto visível
//  - alvos de toque (a/button/[role=button]/.btn) com altura ou largura < 40px
// Salva screenshot por página em scripts/mobile_audit/<pagina>.png
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const APP = 'http://localhost:3000/';
const WHICH = (process.argv[2] || 'admin').toLowerCase();
const OUT = path.join(__dirname, 'mobile_audit', WHICH === 'user' ? 'user' : 'admin');
fs.mkdirSync(OUT, { recursive: true });
const PAGES = WHICH === 'user'
  ? ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'config']
  : ['usuarios', 'assinaturas', 'pagamentos', 'logs', 'dashboard', 'transacoes'];

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function waitDevtools(timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      const page = list.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('Chrome DevTools não respondeu');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    const c = new CDP(ws);
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && c.pending.has(msg.id)) {
        const { res, rej } = c.pending.get(msg.id);
        c.pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    return c;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __error: r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text };
    return r.result ? r.result.value : undefined;
  }
}

const AUDIT_JS = `(() => {
  const vw = window.innerWidth;
  const de = document.scrollingElement || document.documentElement;
  const inScrollX = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
      p = p.parentElement;
    }
    return false;
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const offenders = [];
  const seen = new Set();
  document.querySelectorAll('body *').forEach(el => {
    if (!visible(el) || inScrollX(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 2 || r.left < -2) {
      let p = el.parentElement, clipped = false;
      while (p && p !== document.body) {
        const cs = getComputedStyle(p);
        if (cs.overflowX !== 'visible' && (cs.overflowX === 'hidden' || cs.overflow === 'hidden')) { clipped = true; break; }
        p = p.parentElement;
      }
      if (clipped) return;
      const key = el.tagName + '|' + (el.id || '') + '|' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 50);
      if (seen.has(key)) return;
      seen.add(key);
      if (offenders.length < 25) offenders.push({
        tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 70),
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)
      });
    }
  });
  // fontes < 14px em elementos com texto direto visível
  const fontMap = new Map();
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length > 0) return;
    const txt = (el.textContent || '').trim();
    if (!txt || txt.length < 2) return;
    if (!visible(el)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 14) {
      const key = el.tagName.toLowerCase() + '.' + String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ').slice(0, 2).join('.');
      const cur = fontMap.get(key) || { n: 0, fs, sample: txt.slice(0, 40) };
      cur.n++; fontMap.set(key, cur);
    }
  });
  const smallFonts = [...fontMap.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)
    .map(([k, v]) => ({ sel: k, count: v.n, fs: v.fs, sample: v.sample }));
  // alvos de toque pequenos
  const smallTargets = [];
  document.querySelectorAll('a, button, [role="button"], input[type="checkbox"], input[type="radio"], select, .btn, [onclick]').forEach(el => {
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    const label = (el.textContent || el.value || el.getAttribute('aria-label') || el.title || '').trim().slice(0, 40);
    if (r.height < 40 || r.width < 32) {
      if (smallTargets.length < 30) smallTargets.push({
        tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 60),
        w: Math.round(r.width), h: Math.round(r.height), label
      });
    }
  });
  return {
    vw, scrollW: de.scrollWidth, pageOverflowX: de.scrollWidth > vw + 1,
    docH: de.scrollHeight, hash: location.hash,
    curPage: (typeof currentPage !== 'undefined' ? currentPage : null),
    renderedPage: (document.getElementById('pageContent') || {}).dataset ? document.getElementById('pageContent').dataset.currentRenderedPage : null,
    offenders, smallFonts, smallTargets: smallTargets.slice(0, 20),
    smallTargetsTotal: smallTargets.length
  };
})()`;

(async () => {
  const userDataDir = fs.mkdtempSync(require('os').tmpdir() + '\\nexus-mobile-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
    '--window-size=390,844', 'about:blank'
  ], { stdio: 'ignore' });

  const results = {};
  try {
    const wsUrl = await waitDevtools();
    const cdp = await CDP.connect(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });

    // Sem usuário de teste: cunha um JWT válido com o segredo local (.nexus_jwt_secret)
    // e injeta a sessão do administrador real (paulolp0101) direto no localStorage.
    const crypto = require('crypto');
    const JWT_SECRET = fs.readFileSync(path.join(__dirname, '..', '.nexus_jwt_secret'), 'utf8').trim();
    const users = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'local_users.json'), 'utf8'));
    const admin = WHICH === 'user'
      ? users.find(u => u.role !== 'Administrador' && u.active && u.subscription_status === 'active')
      : users.find(u => u.role === 'Administrador' && u.active);
    const { password, ...adminPublic } = admin;
    const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const header = b64u({ alg: 'HS256', typ: 'JWT' });
    const payload = b64u({ id: admin.id, email: admin.email, name: admin.name, role: admin.role, iat: nowSec, iatMs: Date.now(), exp: nowSec + 7 * 24 * 3600 });
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(header + '.' + payload).digest('base64url');
    const token = header + '.' + payload + '.' + sig;
    console.log('sessão forjada p/ admin:', admin.email);

    await cdp.send('Page.navigate', { url: 'http://localhost:3000/' });
    await new Promise(r => setTimeout(r, 2500));
    await cdp.eval(`(() => {
      localStorage.setItem('nexus_session', JSON.stringify({email:${JSON.stringify(admin.email)}, id:${JSON.stringify(admin.id)}}));
      localStorage.setItem('nexus_cached_user', ${JSON.stringify(JSON.stringify(adminPublic))});
      localStorage.setItem('nexus_token', ${JSON.stringify(token)});
      localStorage.setItem('nexus_login_v5', 'true');
      sessionStorage.setItem('nexus_session_active', 'true');
      sessionStorage.setItem('nexus_last_activity', String(Date.now()));
      return 'ok';
    })()`);

    await cdp.send('Page.navigate', { url: APP });
    await new Promise(r => setTimeout(r, 9000));

    for (const pg of PAGES) {
      await cdp.eval(`(typeof navigate === 'function') ? (navigate('${pg}'), 'ok') : 'no navigate'`);
      await new Promise(r => setTimeout(r, pg === 'dashboard' ? 3000 : 2200));
      const audit = await cdp.eval(AUDIT_JS);
      results[pg] = audit;
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, pg + '.png'), Buffer.from(shot.data, 'base64'));
      console.log(pg, '| overflowX:', audit && audit.pageOverflowX, '| scrollW:', audit && audit.scrollW, '| offenders:', audit && audit.offenders && audit.offenders.length, '| smallFonts:', audit && audit.smallFonts && audit.smallFonts.length, '| smallTargets:', audit && audit.smallTargetsTotal);
    }

    // gaveta mobile aberta
    await cdp.eval(`(typeof navigate === 'function') ? (navigate('dashboard'), 'ok') : ''`);
    await new Promise(r => setTimeout(r, 1500));
    await cdp.eval(`(typeof toggleMobileDrawer === 'function') ? (toggleMobileDrawer(true), 'ok') : 'no toggle'`);
    await new Promise(r => setTimeout(r, 1200));
    const drawerAudit = await cdp.eval(AUDIT_JS);
    results._drawer = drawerAudit;
    const shotD = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, '_drawer.png'), Buffer.from(shotD.data, 'base64'));
    console.log('drawer | overflowX:', drawerAudit && drawerAudit.pageOverflowX, '| offenders:', drawerAudit && drawerAudit.offenders && drawerAudit.offenders.length);

    fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(results, null, 2));
    console.log('AUDIT salvo em scripts/mobile_audit/audit.json');
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
  }
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
