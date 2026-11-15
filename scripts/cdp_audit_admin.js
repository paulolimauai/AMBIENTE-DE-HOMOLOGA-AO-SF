// Auditoria de erros do painel admin: console, exceptions, rede e interacoes
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs'); const os = require('os'); const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9344;
function getJson(u){return new Promise((res,rej)=>{http.get(u,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
async function waitDev(){const t=Date.now();while(Date.now()-t<20000){try{const l=await getJson(`http://127.0.0.1:${PORT}/json/list`);const p=l.find(x=>x.type==='page');if(p)return p.webSocketDebuggerUrl}catch(e){}await new Promise(r=>setTimeout(r,300))}throw new Error('devtools')}
class CDP{constructor(w){this.w=w;this.id=0;this.p=new Map();this.errors=[];this.netFails=[]}static async connect(u){const w=new WebSocket(u);await new Promise((r,j)=>{w.onopen=r;w.onerror=j});const c=new CDP(w);w.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&c.p.has(m.id)){const{res,rej}=c.p.get(m.id);c.p.delete(m.id);m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)}else if(m.method==='Runtime.exceptionThrown'){const d=m.params.exceptionDetails;c.errors.push('EXC: '+((d.exception&&d.exception.description||d.text||'').slice(0,300)))}else if(m.method==='Runtime.consoleAPICalled'&&(m.params.type==='error'||m.params.type==='warning')){c.errors.push(m.params.type.toUpperCase()+': '+(m.params.args||[]).map(a=>a.value!==undefined?String(a.value):(a.description||'')).join(' ').slice(0,300))}else if(m.method==='Network.responseReceived'&&m.params.response.status>=400){if(m.params.response.url.includes('/api/'))c.netFails.push(m.params.response.status+' '+m.params.response.url)}};return c}send(m,p={}){const i=++this.id;return new Promise((res,rej)=>{this.p.set(i,{res,rej});this.w.send(JSON.stringify({id:i,method:m,params:p}))})}async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)return{__e:r.exceptionDetails.exception?r.exceptionDetails.exception.description:r.exceptionDetails.text};return r.result?r.result.value:undefined}}
(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nx-audit-'));
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+PORT,'--user-data-dir='+dir,'--window-size=1600,900','about:blank'],{stdio:'ignore'});
  try{
    const c=await CDP.connect(await waitDev());
    await c.send('Page.enable');await c.send('Runtime.enable');await c.send('Network.enable');
    await c.send('Page.navigate',{url:'http://localhost:3000/login'});
    await new Promise(r=>setTimeout(r,3000));
    await c.ev(`(()=>{const e=document.getElementById('email'),s=document.getElementById('senha');e.value='devin.teste@nexus.local';s.value='Teste@12345';document.getElementById('enviar').click()})()`);
    await new Promise(r=>setTimeout(r,9000));
    for(const pg of ['usuarios','funcoes','ordens','pagamentos','logs']){
      const before=c.errors.length;
      await c.ev(`(typeof navigate==='function')&&navigate('${pg}')`);
      await new Promise(r=>setTimeout(r,3500));
      const st=await c.ev(`(()=>{const P=(typeof currentPage!=='undefined')?currentPage:'?';const main=document.querySelector('#pageContent');return{page:P,temConteudo:!!(main&&main.innerText.trim().length>20),placeholder:(main&&main.innerText.includes('Acesso restrito'))}})()`);
      console.log('#'+pg+':',JSON.stringify(st),'| erros novos:',c.errors.length-before);
      c.errors.slice(before).forEach(e=>console.log('   ',e));
    }
    // interacoes na pagina usuarios: busca, paginacao, abrir detalhe
    await c.ev(`(typeof navigate==='function')&&navigate('usuarios')`);
    await new Promise(r=>setTimeout(r,2500));
    const inter=await c.ev(`(()=>{const out={};const b=document.getElementById('admBusca');if(b){b.value='paulo';b.dispatchEvent(new Event('input',{bubbles:true}));out.busca='ok'}const linha=document.querySelector('tr.adm-lin,[data-adm-abrir]');if(linha){linha.click();out.detalhe='clicado'}return out})()`);
    console.log('interacoes:',JSON.stringify(inter));
    await new Promise(r=>setTimeout(r,2000));
    const det=await c.ev(`(()=>({gaveta:!!document.getElementById('admGaveta')||!!document.querySelector('.adm-gaveta,.adm-drawer'),dialogo:!!document.getElementById('admDialogo')}))()`);
    console.log('apos clique detalhe:',JSON.stringify(det));
    console.log('=== ERROS TOTAIS:',c.errors.length);
    c.errors.forEach(e=>console.log(e));
    console.log('=== FALHAS API:',c.netFails.length);
    c.netFails.forEach(e=>console.log(e));
  }finally{try{ch.kill('SIGKILL')}catch(e){}}
})().catch(e=>{console.error('FALHA',e);process.exit(1)});
