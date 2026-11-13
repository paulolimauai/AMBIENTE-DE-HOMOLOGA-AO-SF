// Verifica a página de administração renderizada (abas do NexusAdm) num Chrome headless.
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}
async function waitDevtools(timeout=20000){const t0=Date.now();while(Date.now()-t0<timeout){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(t=>t.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools timeout')}
class CDP{constructor(ws){this.ws=ws;this.id=0;this.pending=new Map()}static async connect(url){const ws=new WebSocket(url);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});const c=new CDP(ws);ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&c.pending.has(m.id)){const{res,rej}=c.pending.get(m.id);c.pending.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;console.log('[EXCEÇÃO]',(d.exception&&d.exception.description||d.text||'').slice(0,400))}else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){const t=(m.params.args||[]).map(a=>a.value!==undefined?a.value:(a.description||'')).join(' ');console.log('[CONSOLE.ERROR]',t.slice(0,300))}};return c}send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}))})}async eval(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__error:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-chrome-'));
  const chrome=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const ws=await waitDevtools();const cdp=await CDP.connect(ws);
    await cdp.send('Page.enable');await cdp.send('Runtime.enable');
    const login=await new Promise(res=>{const q=http.request({hostname:'localhost',port:3000,path:'/api/login',method:'POST',headers:{'Content-Type':'application/json'}},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))});q.end(JSON.stringify({email:'admin@teste.nexus',password:'Admin@12345'}))});
    await cdp.send('Page.navigate',{url:'http://localhost:3000/login'});await new Promise(r=>setTimeout(r,2000));
    await cdp.eval(`(()=>{localStorage.setItem('nexus_session',JSON.stringify({email:'admin@teste.nexus',id:${login.user.id}}));localStorage.setItem('nexus_cached_user',${JSON.stringify(JSON.stringify(login.user))});localStorage.setItem('nexus_token',${JSON.stringify(login.token)});localStorage.setItem('nexus_login_v5','true');sessionStorage.setItem('nexus_session_active','true');sessionStorage.setItem('nexus_last_activity',String(Date.now()));return 1})()`);
    await cdp.send('Page.navigate',{url:'http://localhost:3000/#usuarios'});
    await new Promise(r=>setTimeout(r,9000));
    const st=await cdp.eval(`(()=>{const q=s=>document.querySelector(s);return{
      page: (typeof currentPage!=='undefined')?currentPage:'?',
      nexusAdm: typeof window.NexusAdm,
      admEhAdmin: (typeof admEhAdmin==='function')?admEhAdmin():'?',
      shellTabs: [...document.querySelectorAll('.adm-top, .admin-top, [class*=adm-]')].slice(0,10).map(e=>e.className).join(' | '),
      pageHead: (q('.page-head')||{}).innerText ? q('.page-head').innerText.slice(0,120) : 'SEM page-head',
      hasUsuariosTable: !!q('table'),
      adminMenuBtns: [...document.querySelectorAll('.menu-btn-admin')].filter(b=>getComputedStyle(b).display!=='none').length,
      htmlClass: document.documentElement.className
    }})()`);
    console.log(JSON.stringify(st,null,2));
  }finally{try{chrome.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
