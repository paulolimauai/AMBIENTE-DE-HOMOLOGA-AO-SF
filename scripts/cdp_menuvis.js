// Login admin -> verifica visibilidade REAL das secoes/botoes do menu usuario
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function waitDev(){const t=Date.now();while(Date.now()-t<20000){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools')}
class CDP{constructor(w){this.w=w;this.id=0;this.p=new Map()}static async connect(u){const w=new WebSocket(u);await new Promise((r,j)=>{w.onopen=r;w.onerror=j});const c=new CDP(w);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}};return c}send(m,p={}){const i=++this.id;return new Promise((res,rej)=>{this.p.set(i,{res,rej});this.w.send(JSON.stringify({id:i,method:m,params:p}))})}async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__e:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-mv-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const c=await CDP.connect(await waitDev());
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/login'});
    await new Promise(r=>setTimeout(r,3000));
    await c.ev(`(()=>{const e=document.getElementById('email'),s=document.getElementById('senha');e.value='admin@teste.nexus';s.value='Admin@12345';document.getElementById('enviar').click()})()`);
    await new Promise(r=>setTimeout(r,8000));
    const st=await c.ev(`(()=>{
      const secs=['visao','planejamento','ferramentas','minha-conta','admin'].map(n=>{
        const el=document.querySelector('.menu-section-'+n)||document.getElementById('menuSection'+n);
        if(!el)return n+':AUSENTE';
        const cs=getComputedStyle(el);
        const btns=[...el.querySelectorAll('button')].filter(b=>b.offsetParent!==null).length;
        return n+':'+cs.display+'/vis:'+cs.visibility+'/botoesVisiveis:'+btns;
      });
      const allBtns=[...document.querySelectorAll('#menu button, aside.menu button')].map(b=>{
        const cs=getComputedStyle(b);const r=b.getBoundingClientRect();
        return (b.id||b.className.slice(0,20))+'|'+cs.display+'|'+Math.round(r.width)+'x'+Math.round(r.height)+'|'+(b.innerText||'').trim().slice(0,25).replace(/\\n/g,' ');
      }).filter(x=>!x.startsWith('|'));
      return {secs, totalBotoes:allBtns.length, botoes:allBtns.slice(0,40), isAdmin:document.documentElement.className.includes('is-admin')};
    })()`);
    console.log(JSON.stringify(st,null,1));
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
