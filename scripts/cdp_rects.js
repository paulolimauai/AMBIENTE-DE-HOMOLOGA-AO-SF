const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs'), os = require('os'), path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const SEL = '.hero-visual,.hero-stage,.mock,.mock-note,.float-badge,.hero-copy,.hero-grid,.ticket,.atd,.nums,.num';
function gj(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function wd(t=20000){const t0=Date.now();while(Date.now()-t0<t){try{const l=await gj('http://127.0.0.1:'+PORT+'/json/list');const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('no devtools')}
class C{constructor(w){this.ws=w;this.id=0;this.p=new Map()}static async connect(u){const ws=new WebSocket(u);await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej});const c=new C(ws);ws.onmessage=ev=>{const m=JSON.parse(ev.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}};return c}send(me,pa={}){const id=++this.id;return new Promise((res,rej)=>{this.p.set(id,{res,rej});this.ws.send(JSON.stringify({id,method:me,params:pa}))})}async ev(x){const r=await this.send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r}}
const EXPR = `(()=>{
  const probe={href:location.href,m:document.querySelectorAll('.mock-note').length,f:document.querySelectorAll('.float-badge').length};
  const els=[...document.querySelectorAll(${JSON.stringify(SEL)})];
  const rows=els.map(e=>{const r=e.getBoundingClientRect();const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||r.width<2)return null;
    return{cls:(e.id?'#'+e.id+' ':'')+String(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className).split(' ').slice(0,2).join('.'),
      pos:cs.position,t:Math.round(r.top+scrollY),b:Math.round(r.bottom+scrollY),l:Math.round(r.left),r:Math.round(r.right)}}).filter(Boolean);
  return {probe,rows};
})()`;
(async()=>{
  const ud=fs.mkdtempSync(path.join(os.tmpdir(),'nx-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+ud,'--window-size=1440,1000','about:blank'],{stdio:'ignore'});
  try{
    const ws=await wd();const c=await C.connect(ws);
    await c.send('Page.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/inicio'});
    await new Promise(r=>setTimeout(r,4000));
    for(const w of [1440,1100,1024,900,768,767,600,390]){
      await c.send('Emulation.setDeviceMetricsOverride',{width:w,height:1000,deviceScaleFactor:1,mobile:w<800});
      await new Promise(r=>setTimeout(r,500));
      const r=await c.ev(EXPR);
      const v=r.result?r.result.value:null;
      console.log('\n=== W'+w+' ===');
      if(!v){console.log('NO VALUE',JSON.stringify(r).slice(0,300));continue}
      console.log('probe',JSON.stringify(v.probe));
      (v.rows||[]).forEach(o=>console.log(JSON.stringify(o)));
    }
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('ERR',e);process.exit(1)});
