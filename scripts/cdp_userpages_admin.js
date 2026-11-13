// Testa paginas de USUARIO logado como ADMIN
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function waitDev(){const t=Date.now();while(Date.now()-t<20000){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools')}
class CDP{constructor(w){this.w=w;this.id=0;this.p=new Map()}static async connect(u){const w=new WebSocket(u);await new Promise((r,j)=>{w.onopen=r;w.onerror=j});const c=new CDP(w);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;console.log('[EXC]',(d.exception&&d.exception.description||d.text||'').slice(0,300))}else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){console.log('[ERR]',(m.params.args||[]).map(a=>a.value!==undefined?a.value:(a.description||'')).join(' ').slice(0,250))}};return c}send(m,p={}){const i=++this.id;return new Promise((res,rej)=>{this.p.set(i,{res,rej});this.w.send(JSON.stringify({id:i,method:m,params:p}))})}async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__e:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-up-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const c=await CDP.connect(await waitDev());
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/login'});
    await new Promise(r=>setTimeout(r,3000));
    await c.ev(`(()=>{const e=document.getElementById('email'),s=document.getElementById('senha');e.value='admin@teste.nexus';s.value='Admin@12345';document.getElementById('enviar').click()})()`);
    await new Promise(r=>setTimeout(r,8000));
    // lista TODOS os botoes de menu visiveis
    const menu=await c.ev(`(()=>[...document.querySelectorAll('.menu-btn, .menu-btn-admin, nav button, aside button')].filter(b=>b.offsetParent!==null).map(b=>({id:b.id,t:(b.innerText||'').trim().slice(0,40)})))()`);
    console.log('MENU VISIVEL:',JSON.stringify(menu));
    for(const pg of ['dashboard','transacoes','cartoes','orcamentos','metas','relatorios','recorrentes','importar','anexos','config']){
      await c.ev(`(window.nexusNavigateTo?nexusNavigateTo('${pg}'):location.hash='${pg}')`);
      await new Promise(r=>setTimeout(r,2200));
      const st=await c.ev(`(()=>{const main=document.querySelector('main')||document.body;return{page:typeof currentPage!=='undefined'?currentPage:null,text:main.innerText.slice(0,120).replace(/\\n/g,' | ')}})()`);
      console.log('#'+pg+':',JSON.stringify(st));
    }
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
