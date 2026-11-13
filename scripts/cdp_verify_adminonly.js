// Verifica: admin ve SOMENTE funcoes admin (defensivo)
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9342;
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function waitDev(){const t=Date.now();while(Date.now()-t<20000){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools')}
class CDP{constructor(w){this.w=w;this.id=0;this.p=new Map()}static async connect(u){const w=new WebSocket(u);await new Promise((r,j)=>{w.onopen=r;w.onerror=j});const c=new CDP(w);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;console.log('[EXC]',(d.exception&&d.exception.description||d.text||'').slice(0,250))}else if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error'){console.log('[ERR]',(m.params.args||[]).map(a=>a.value!==undefined?a.value:(a.description||'')).join(' ').slice(0,200))}};return c}send(m,p={}){const i=++this.id;return new Promise((res,rej)=>{this.p.set(i,{res,rej});this.w.send(JSON.stringify({id:i,method:m,params:p}))})}async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__e:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}
const PROBE=`(()=>{const P=(typeof currentPage!=='undefined')?currentPage:'?';const vis=s=>{const e=document.querySelector(s);if(!e)return null;const cs=getComputedStyle(e);const r=e.getBoundingClientRect();return cs.display+' '+Math.round(r.width)+'x'+Math.round(r.height)};const ub=[...document.querySelectorAll('#menu .menu-btn-user')].filter(b=>{const cs=getComputedStyle(b);const r=b.getBoundingClientRect();return cs.display!=='none'&&r.width>0}).length;const ab=[...document.querySelectorAll('#menu .menu-btn-admin, #menu button[data-page="funcoes"], #menu button[data-page="ordens"]')].filter(b=>{const r=b.getBoundingClientRect();return r.width>0}).length;const tabs=[...document.querySelectorAll('.adm-tab')].map(t=>t.innerText.trim().slice(0,28));return{url:location.pathname+location.hash,page:P,menu:vis('#menu'),userVis:ub,admVis:ab,tabs:tabs,isAdmin:document.documentElement.className.includes('is-admin')}})()`;
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-vh-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const c=await CDP.connect(await waitDev());
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/login'});
    await new Promise(r=>setTimeout(r,3000));
    await c.ev(`(()=>{const e=document.getElementById('email'),s=document.getElementById('senha');if(!e)return 'no-fields';e.value='devin.teste@nexus.local';s.value='Teste@12345';document.getElementById('enviar').click();return 'ok'})()`);
    await new Promise(r=>setTimeout(r,9000));
    console.log('apos login:',JSON.stringify(await c.ev(PROBE)));
    await c.ev(`(typeof navigate==='function')&&navigate('dashboard')`);
    await new Promise(r=>setTimeout(r,1500));
    console.log('apos navigate(dashboard):',JSON.stringify(await c.ev(PROBE)));
    for(const pg of ['funcoes','ordens','usuarios']){
      await c.ev(`(typeof navigate==='function')&&navigate('${pg}')`);
      await new Promise(r=>setTimeout(r,2200));
      console.log('#'+pg+':',JSON.stringify(await c.ev(PROBE)));
    }
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
