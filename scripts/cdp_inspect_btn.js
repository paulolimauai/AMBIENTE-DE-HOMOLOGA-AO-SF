const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9343;
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function waitDev(){const t=Date.now();while(Date.now()-t<20000){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools')}
class CDP{constructor(w){this.w=w;this.id=0;this.p=new Map()}static async connect(u){const w=new WebSocket(u);await new Promise((r,j)=>{w.onopen=r;w.onerror=j});const c=new CDP(w);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}};return c}send(m,p={}){const i=++this.id;return new Promise((res,rej)=>{this.p.set(i,{res,rej});this.w.send(JSON.stringify({id:i,method:m,params:p}))})}async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__e:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-vi-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const c=await CDP.connect(await waitDev());
    await c.send('Page.enable');await c.send('Runtime.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/login'});
    await new Promise(r=>setTimeout(r,3000));
    await c.ev(`(()=>{const e=document.getElementById('email'),s=document.getElementById('senha');e.value='devin.teste@nexus.local';s.value='Teste@12345';document.getElementById('enviar').click()})()`);
    await new Promise(r=>setTimeout(r,9000));
    await c.ev(`(typeof navigate==='function')&&navigate('funcoes')`);
    await new Promise(r=>setTimeout(r,2500));
    const st=await c.ev(`(()=>{const b=document.querySelector('#menu .menu-btn-user');if(!b)return 'sem botao';const cs=getComputedStyle(b);const r=b.getBoundingClientRect();return{cls:b.className,id:b.id,inline:b.getAttribute('style'),display:cs.display,w:Math.round(r.width),h:Math.round(r.height),vis:cs.visibility,parents:(function(){let a=[],e=b;while(e&&a.length<6){a.push(e.tagName+(e.id?'#'+e.id:'')+(e.className&&typeof e.className==='string'?'.'+e.className.split(' ').slice(0,2).join('.'):'')+'['+getComputedStyle(e).display+']');e=e.parentElement}return a})()}})()`);
    console.log(JSON.stringify(st,null,1));
    // forca updateAdminMenuVisibility e mede de novo
    await c.ev(`(typeof updateAdminMenuVisibility==='function')&&updateAdminMenuVisibility(true)`);
    await new Promise(r=>setTimeout(r,800));
    const st2=await c.ev(`(()=>{const b=document.querySelector('#menu .menu-btn-user');const cs=getComputedStyle(b);const r=b.getBoundingClientRect();return{inline:b.getAttribute('style'),display:cs.display,w:Math.round(r.width)}})()`);
    console.log('apos force:',JSON.stringify(st2));
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
