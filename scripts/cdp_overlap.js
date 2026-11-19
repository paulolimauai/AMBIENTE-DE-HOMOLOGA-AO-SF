// Detecta sobreposições reais na landing /inicio via CDP headless.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const URL = process.argv[2] || 'http://localhost:3000/inicio';
const W = parseInt(process.argv[3] || '1440', 10);

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

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDataDir,
    `--window-size=${W},1000`, 'about:blank'
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await waitDevtools();
    const cdp = await CDP.connect(wsUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: 1000, deviceScaleFactor: 1, mobile: W < 800 });
    await cdp.send('Page.navigate', { url: URL });
    await new Promise(r => setTimeout(r, 4000));
    // revela todos os .rv (o IntersectionObserver só dispara com scroll; sem isso tudo fica transladado e gera falsos positivos)
    await cdp.eval(`document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'))`);
    await new Promise(r => setTimeout(r, 900));

    const report = await cdp.eval(`(() => {
      const vw = innerWidth, vh = innerHeight;
      const sel = 'main *';
      const els = [...document.querySelectorAll(sel)];
      const vis = els.filter(e => {
        if (e.closest('svg')) return false;
        if (e.checkVisibility && !e.checkVisibility({checkVisibilityCSS:true})) return false;
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.position !== 'fixed' && r.bottom > 0 && r.top < document.documentElement.scrollHeight;
      });
      function rect(e){const r=e.getBoundingClientRect();return {t:r.top+scrollY,l:r.left,b:r.bottom+scrollY,r:r.right};}
      function contains(a,b){return a.contains(b)||b.contains(a);}
      function label(e){return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.trim().split(/\\s+/).slice(0,3).join('.'):'' );}
      function sectionOf(e){const s=e.closest('section');return s?(s.id||s.className):'?';}
      const overlaps=[];
      const seen=new Set();
      for(let i=0;i<vis.length;i++){
        const a=vis[i], ra=rect(a);
        for(let j=i+1;j<vis.length;j++){
          const b=vis[j];
          if(contains(a,b)) continue;
          const rb=rect(b);
          const ox=Math.min(ra.r,rb.r)-Math.max(ra.l,rb.l);
          const oy=Math.min(ra.b,rb.b)-Math.max(ra.t,rb.t);
          const areaA=(ra.r-ra.l)*(ra.b-ra.t), areaB=(rb.r-rb.l)*(rb.b-rb.t);
          if(ox>2 && oy>2){
            const inter=ox*oy;
            // ignora sobreposições pequenas (<8% do menor)
            if(inter/Math.min(areaA,areaB) < 0.08) continue;
            const key=sectionOf(a)+'|'+label(a)+'|'+label(b);
            if(seen.has(key)) continue; seen.add(key);
            overlaps.push({sec:sectionOf(a),a:label(a),ar:ra,b:label(b),br:rb,interPct:Math.round(inter/Math.min(areaA,areaB)*100)});
          }
        }
      }
      // ordena por posição vertical e limita
      overlaps.sort((x,y)=>Math.min(x.ar.t,x.br.t)-Math.min(y.ar.t,y.br.t));
      // overflow horizontal
      const docW=document.documentElement.scrollWidth;
      const overflowers=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>vw+2&&getComputedStyle(e).position!=='fixed';}).slice(0,10).map(e=>label(e)+' right='+(e.getBoundingClientRect().right|0));
      return {vw,docW,overlaps:overlaps.slice(0,120),overflowers};
    })()`);

    console.log('VIEWPORT', W);
    console.log('scrollWidth', report.docW, 'vs vw', report.vw);
    if (report.overflowers && report.overflowers.length) console.log('OVERFLOW-X:', JSON.stringify(report.overflowers, null, 1));
    console.log('OVERLAPS:', JSON.stringify(report.overlaps, null, 1));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(__dirname, `overlap_${W}.png`), Buffer.from(shot.data, 'base64'));
    console.log('screenshot: scripts/overlap_' + W + '.png');
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) {}
  }
})().catch(e => { console.error('FALHA:', e); process.exit(1); });
