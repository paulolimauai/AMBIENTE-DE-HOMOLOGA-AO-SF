// Diagnostica POR QUE os botoes do menu tem 0x0 para admin
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9339;
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function waitDev(){const t=Date.now();while(Date.now()-t<20000){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools')}
class CDP{constructor(w){this.w=w;this.id=0;this.p=new Map()}static async connect(u){const w=new WebSocket(u);await new Promise((r,j)=>{w.onopen=r;w.onerror=j});const c=new CDP(w);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}};return c}send(m,p={}){const i=++this.id;return new Promise((res,rej)=>{this.p.set(i,{res,rej});this.w.send(JSON.stringify({id:i,method:m,params:p}))})}async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__e:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-dg-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const c=await CDP.connect(await waitDev());
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/login'});
    await new Promise(r=>setTimeout(r,3000));
    await c.ev(`(()=>{const e=document.getElementById('email'),s=document.getElementById('senha');e.value='admin@teste.nexus';s.value='Admin@12345';document.getElementById('enviar').click()})()`);
    await new Promise(r=>setTimeout(r,8000));
    const st=await c.ev(`(()=>{
      const info=(el)=>{if(!el)return null;const r=el.getBoundingClientRect();const cs=getComputedStyle(el);return{tag:el.tagName,id:el.id,cls:el.className.toString().slice(0,60),rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],display:cs.display,pos:cs.position,vis:cs.visibility,transform:cs.transform.slice(0,40)}};
      const aside=document.querySelector('aside.menu, nav.menu, #sidebar, #menu')?.closest('aside,nav')||document.querySelector('aside,nav');
      const menu=document.getElementById('menu');
      const btn=document.getElementById('menuUsuariosBtn')||document.querySelector('.menu-btn-admin');
      const secVisao=document.querySelector('.menu-section-visao');
      // cadeia de pais do botao
      let chain=[],el=btn;while(el&&chain.length<8){chain.push(info(el));el=el.parentElement}
      return{vw:innerWidth,vh:innerHeight,htmlCls:document.documentElement.className,bodyCls:document.body.className.slice(0,120),aside:info(aside),menu:info(menu),btn:info(btn),secVisao:info(secVisao),chain,scrollW:document.documentElement.scrollWidth};
    })()`);
    console.log(JSON.stringify(st,null,1));
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
