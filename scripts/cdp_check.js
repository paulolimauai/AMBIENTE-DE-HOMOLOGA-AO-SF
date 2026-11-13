// Diagnóstico real: abre o app num Chrome headless via CDP, injeta sessão de admin/usuário,
// captura erros de console e inspeciona se a classe is-admin e os botões admin aparecem.
const { spawn } = require('child_process');
const http = require('http');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const APP = 'http://localhost:3000/';

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
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
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
      } else if (msg.method) {
        c.events.push(msg);
        if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
          const txt = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
          console.log('[CONSOLE.' + msg.params.type.toUpperCase() + ']', txt.slice(0, 300));
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          const d = msg.params.exceptionDetails;
          console.log('[EXCEÇÃO]', (d.exception && d.exception.description || d.text || '').slice(0, 500));
        }
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

(async () => {
  const userDataDir = require('fs').mkdtempSync(require('os').tmpdir() + '\\\\nexus-chrome-');
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
    '--window-size=1600,900', 'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await waitDevtools();
    const cdp = await CDP.connect(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    // Descobre o token real via API de login
    const loginResp = await new Promise((resolve) => {
      const req = http.request({
        hostname: 'localhost', port: 3000, path: '/api/login', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
      req.end(JSON.stringify({ email: 'admin@teste.nexus', password: 'Admin@12345' }));
    });
    if (!loginResp.token) { console.log('LOGIN FALHOU', JSON.stringify(loginResp)); process.exit(1); }

    // Abre a página de login primeiro (mesma origem) e injeta a sessão do admin
    await cdp.send('Page.navigate', { url: 'http://localhost:3000/login' });
    await new Promise(r => setTimeout(r, 2500));
    const inject = `(() => {
      localStorage.setItem('nexus_session', JSON.stringify({email:'admin@teste.nexus', id:${loginResp.user.id}}));
      localStorage.setItem('nexus_cached_user', ${JSON.stringify(JSON.stringify(loginResp.user))});
      localStorage.setItem('nexus_token', ${JSON.stringify(loginResp.token)});
      localStorage.setItem('nexus_login_v5', 'true');
      sessionStorage.setItem('nexus_session_active', 'true');
      sessionStorage.setItem('nexus_last_activity', String(Date.now()));
      return 'ok';
    })()`;
    console.log('inject:', await cdp.eval(inject));

    await cdp.send('Page.navigate', { url: APP });
    await new Promise(r => setTimeout(r, 8000));

    const state = await cdp.eval(`(() => {
      const de = document.documentElement;
      const adminBtns = [...document.querySelectorAll('.menu-btn-admin')];
      const visible = adminBtns.filter(b => getComputedStyle(b).display !== 'none');
      const sections = [...document.querySelectorAll('.menu-section-admin')].map(s => getComputedStyle(s).display);
      return {
        htmlClass: de.className,
        bodyClass: document.body.className,
        appMain: getComputedStyle(document.getElementById('appMain')||document.body).display,
        authPage: getComputedStyle(document.getElementById('authPage')||document.body).display,
        adminBtnsTotal: adminBtns.length,
        adminBtnsVisible: visible.length,
        adminBtnIds: adminBtns.map(b=>b.id),
        sectionsDisplay: sections,
        sidebarExists: !!document.getElementById('menu'),
        menuTrackChildren: (document.getElementById('menuTrack')||{children:[]}).children.length,
        currentUser: (typeof currentUser !== 'undefined' && currentUser) ? {email:currentUser.email, role:currentUser.role} : null,
        registeredUsers: (typeof registeredUsers !== 'undefined') ? registeredUsers.length : 'undef'
      };
    })()`);
    console.log('ESTADO:', JSON.stringify(state, null, 2));

    // screenshot para inspeção visual
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(require('path').join(__dirname, 'nexus_admin_shot.png'), Buffer.from(shot.data, 'base64'));
    console.log('screenshot salvo: scripts/nexus_admin_shot.png');
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
  }
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
