const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const EXPR = process.argv[2];
function gj(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function wd(t=20000){const t0=Date.now();while(Date.now()-t0<t){try{const l=await gj('http://127.0.0.1:'+PORT+'/json/list');const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('no devtools')}
class C{constructor(w){this.ws=w;this.id=0;this.p=new Map()}static async connect(u){const ws=new WebSocket(u);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});const c=new C(ws);ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}};return c}send(me,pa={}){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:me,params:pa}))})}async ev(x){const r=await this.send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__err:JSON.stringify(r.exceptionDetails).slice(0,300)};return r.result?r.result.value:undefined}}
(async()=>{
  const ud=fs.mkdtempSync(path.join(os.tmpdir(),'nx-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+ud,'--window-size=1440,1000','about:blank'],{stdio:'ignore'});
  try{
    const ws=await wd();const c=await C.connect(ws);
    await c.send('Page.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/inicio'});
    await new Promise(r=>setTimeout(r,4000));
    await c.ev(`document.querySelectorAll('.rv').forEach(e=>e.classList.add('in'))`);
    await new Promise(r=>setTimeout(r,900));
    const out=await c.ev(EXPR);
    console.log(JSON.stringify(out,null,1));
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('ERR',e);process.exit(1)});
