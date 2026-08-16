try {
  require('dotenv').config();
} catch (e) {}

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const tls = require('tls');

let Pool;
try {
  Pool = require('pg').Pool;
} catch (e) {
  // pg não instalado no ambiente
}

const PORT = process.env.PORT || 3000;

// ==================== Conexão com o PostgreSQL ====================
let pool = null;
if (Pool) {
  try {
    pool = process.env.DATABASE_URL
      ? new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      })
      : new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '86266049',
        database: process.env.DB_NAME || 'AMBIENTE DE HOMOLOGAÇAO SF',
        ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
      });

    pool.on('error', (err) => {
      console.warn('[AVISO BD] Erro no pool do PostgreSQL:', err.message);
    });
  } catch (err) {
    console.warn('[AVISO BD] Falha ao configurar pool:', err.message);
    pool = null;
  }
}

// Usuário admin padrão, inserido no banco na primeira execução
const DEFAULT_ADMIN = {
  name: 'Paulo Lima',
  email: 'admin@nexusfinanceiro.com',
  password: '86266049',
  role: 'Administrador',
  active: true
};

// Disparo real de e-mail via Socket SMTP Nativo (compatível com Gmail sem pacotes externos)
function sendPasswordEmail(toEmail, userName, userPassword) {
  return new Promise((resolve) => {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '465');
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!user || !pass) {
      console.log(`[AVISO] Credenciais SMTP ausentes no Render. E-mail não enviado para ${toEmail}`);
      return resolve(false);
    }

    const socket = tls.connect(port, host, { rejectUnauthorized: false }, () => {
      let step = 0;

      const send = (cmd) => {
        try { socket.write(cmd + '\r\n'); } catch (e) { }
      };

      socket.on('data', (data) => {
        try {
          const response = data.toString();

          if (step === 0 && response.startsWith('220')) {
            step++;
            send(`EHLO ${host}`);
          } else if (step === 1 && response.startsWith('250')) {
            step++;
            send('AUTH LOGIN');
          } else if (step === 2 && response.startsWith('334')) {
            step++;
            send(Buffer.from(user).toString('base64'));
          } else if (step === 3 && response.startsWith('334')) {
            step++;
            send(Buffer.from(pass).toString('base64'));
          } else if (step === 4 && response.startsWith('235')) {
            step++;
            send(`MAIL FROM:<${user}>`);
          } else if (step === 5 && response.startsWith('250')) {
            step++;
            send(`RCPT TO:<${toEmail}>`);
          } else if (step === 6 && response.startsWith('250')) {
            step++;
            send('DATA');
          } else if (step === 7 && response.startsWith('354')) {
            step++;
            const body = [
              `From: "Nexus Financeiro" <${user}>`,
              `To: <${toEmail}>`,
              `Subject: Recuperacao de Senha - Nexus Financeiro`,
              'MIME-Version: 1.0',
              'Content-Type: text/html; charset=UTF-8',
              '',
              '<div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #1f2530; border-radius: 10px; background-color: #0b0e12; color: #e9edf3;">',
              '  <h2 style="color: #e8b04b; text-align: center;">Nexus Financeiro Hub</h2>',
              `  <p>Olá, <strong>${userName}</strong>!</p>`,
              '  <p>Você solicitou o envio da sua senha de acesso ao sistema Nexus Financeiro.</p>',
              '  <p>Sua senha cadastrada é:</p>',
              '  <div style="text-align: center; margin: 25px 0;">',
              `    <span style="font-size: 24px; font-weight: bold; color: #e8b04b; background: #141821; padding: 10px 20px; border-radius: 8px; border: 1px solid #1f2530;">${userPassword}</span>`,
              '  </div>',
              '  <p style="font-size: 12px; color: #8a93a3;">Se você não solicitou este e-mail, recomendamos alterar sua senha após realizar o login.</p>',
              '</div>',
              '.'
            ].join('\r\n');
            send(body);
          } else if (step === 8 && response.startsWith('250')) {
            step++;
            send('QUIT');
            resolve(true);
          }
        } catch (err) {
          resolve(false);
        }
      });
    });

    socket.on('error', (err) => {
      console.error('Erro na conexão SMTP:', err);
      resolve(false);
    });
  });
}

// Cria as tabelas (se não existirem) e garante o admin padrão
async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      email VARCHAR(150) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(50) NOT NULL DEFAULT 'Usuário',
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dados_financeiros (
      id SERIAL PRIMARY KEY,
      email VARCHAR(150) UNIQUE NOT NULL REFERENCES usuarios(email) ON DELETE CASCADE ON UPDATE CASCADE,
      dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_logs (
      id SERIAL PRIMARY KEY,
      timestamp TIMESTAMP NOT NULL DEFAULT now(),
      user_name VARCHAR(150),
      user_email VARCHAR(150),
      action VARCHAR(50) NOT NULL,
      entity VARCHAR(50) NOT NULL,
      details TEXT NOT NULL
    );
  `);

  await pool.query(
    `INSERT INTO usuarios (name, email, password, role, active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING;`,
    [DEFAULT_ADMIN.name, DEFAULT_ADMIN.email, DEFAULT_ADMIN.password, DEFAULT_ADMIN.role, DEFAULT_ADMIN.active]
  );
  await pool.query(
    `INSERT INTO usuarios (name, email, password, role, active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING;`,
    ['Paulo Lima', 'paulolp0101@gmail.com', '86266049', 'Administrador', true]
  );
}

// Conteúdo HTML/JS/CSS da aplicação centralizada com isolamento por usuário
const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0b0e12" id="metaThemeColor">
<script>
(function() {
  try {
    var t = localStorage.getItem('nexus_theme');
    if (t === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }

    function detectDevice() {
      var w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
      var ua = navigator.userAgent || '';
      var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || w <= 640;
      var isTablet = !isMobile && (/iPad|Tablet/i.test(ua) || (w > 640 && w <= 1024));
      var isUltrawide = w >= 1700;
      if (isMobile) return 'mobile';
      if (isTablet) return 'tablet';
      if (isUltrawide) return 'ultrawide';
      return 'desktop';
    }

    var dev = detectDevice();
    document.documentElement.setAttribute('data-device-type', dev);

    var scale = localStorage.getItem('nexus_display_scale') || 'auto';
    var actualScale = scale;
    if (scale === 'auto') {
      if (dev === 'mobile') actualScale = '100%';
      else if (dev === 'tablet') actualScale = '95%';
      else if (dev === 'ultrawide') actualScale = '110%';
      else actualScale = '100%';
    }
    var scaleNum = parseFloat(actualScale) / 100 || 1;
    document.documentElement.style.setProperty('--app-zoom', scaleNum);

    document.addEventListener('DOMContentLoaded', function() {
      if (localStorage.getItem('nexus_theme') === 'light') {
        document.body.classList.add('light');
      } else {
        document.body.classList.remove('light');
      }
      try {
        var cu = localStorage.getItem('nexus_cached_user');
        if (cu) {
          var uObj = JSON.parse(cu);
          if (uObj && uObj.name) {
            var hName = document.getElementById('headerName');
            var hRole = document.getElementById('headerRole');
            var hAv = document.getElementById('headerAvatar');
            if (hName) hName.textContent = uObj.name;
            if (hRole) hRole.textContent = uObj.role || 'Usuário';
            if (hAv) hAv.textContent = uObj.name.trim().split(/\s+/).map(function(n){return n[0];}).slice(0,2).join('').toUpperCase();
          }
        }
      } catch(e){}
    });
    var cu = localStorage.getItem('nexus_cached_user');
    var s = localStorage.getItem('nexus_session');
    if (s || cu) {
      document.documentElement.classList.add('user-logged-in');
      var uObj = cu ? JSON.parse(cu) : null;
      if (uObj && uObj.role === 'Administrador') {
        document.documentElement.classList.add('is-admin');
      }
    }
  } catch(e){}
})();
</script>
<style>
html.user-logged-in #authPage { display: none !important; }
html.user-logged-in #appMain { display: flex !important; flex-direction: column !important; min-height: 100vh !important; width: 100% !important; }

html:not(.user-logged-in) #appMain,
html:not(.user-logged-in) .topheader {
  display: none !important;
}
html:not(.user-logged-in) #authPage {
  display: flex !important;
}

html.is-admin nav.menu button:not(#menuUsuariosBtn):not(#menuLogsBtn):not(#menuFuncoesBtn),
html.is-admin nav.mobile-drawer-nav button:not(#mobileDrawerUsuariosBtn):not(#mobileDrawerLogsBtn):not(#mobileDrawerFuncoesBtn) {
  display: none !important;
}

html.is-admin #menuUsuariosBtn,
html.is-admin #menuLogsBtn,
html.is-admin #menuFuncoesBtn,
html.is-admin #mobileDrawerUsuariosBtn,
html.is-admin #mobileDrawerLogsBtn,
html.is-admin #mobileDrawerFuncoesBtn {
  display: flex !important;
}

:root{
  --bg:#0A0D14; --sidebar:#0F131D; --card:#111622; --card-border:rgba(255,255,255,0.09);
  --text:#F8FAFC; --text-dim:#94A3B8; --text-faint:#64748B;
  --green:#10B981; --green-soft:rgba(16,185,129,.14);
  --emerald:#10B981; --emerald-soft:rgba(16,185,129,.14);
  --red:#F43F5E; --red-soft:rgba(244,63,94,.14);
  --blue:#3B82F6; --purple:#A855F7; --orange:#F59E0B; --teal:#06B6D4; --pink:#EC4899;
  --hover:rgba(255,255,255,.06);
  --radius:16px;
  --shadow:0 16px 40px -10px rgba(0,0,0,.85), 0 0 1px 1px rgba(255,255,255,0.1);
}
body.light, html.light body{
  --bg:#F1F5F9; --sidebar:#FFFFFF; --card:#FFFFFF; --card-border:#CBD5E1;
  --text:#0F172A; --text-dim:#475569; --text-faint:#94A3B8;
  --hover:#E2E8F0;
  --shadow:0 10px 30px rgba(15,23,42,0.06);
}
*{box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent;}
html, body{overflow-x:clip !important; width:100%;}
body{
  font-family:'Plus Jakarta Sans','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;
  background:var(--bg); color:var(--text); min-height:100vh; transition:background .25s,color .25s;
}
button, input, select{font-family:inherit; color:inherit;}
code{background:var(--hover); padding:1px 6px; border-radius:5px; font-size:11.5px;}

/* ==================== Estabilidade de Renderização para Screenshot & Print ==================== */
* {
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

html, body {
  width: 100% !important;
  min-height: 100vh !important;
  overflow-x: clip !important;
}

#appMain {
  position: relative !important;
  z-index: 1 !important;
  width: 100% !important;
  min-height: 100vh !important;
  display: flex !important;
  flex-direction: column !important;
  overflow: visible !important;
  visibility: visible !important;
  opacity: 1 !important;
}

#pageContent {
  position: relative !important;
  width: 100% !important;
  flex: 1 0 auto !important;
  visibility: visible !important;
  opacity: 1 !important;
}

.topheader, nav.menu, .panel, .kpi, .table-panel, .auth-box, .cards-summary-panel, .tx-footer-summary {
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
  visibility: visible !important;
}

@media print {
  @page {
    size: auto;
    margin: 10mm;
  }
  html, body {
    background: #0A0D14 !important;
    color: #F8FAFC !important;
    width: 100% !important;
    height: auto !important;
    overflow: visible !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  .app-bg-scene, .app-bg-grid, .app-bg-chart, .app-blob, .mobile-drawer-overlay, .mobile-drawer, .scale-dropdown, .notif-panel {
    display: none !important;
  }
  #appMain, #pageContent, .main, .topheader, .topheader-row, nav.menu, .kpis, .kpi, .panel, .table-panel, .tx-footer-summary, .app-dev-credit {
    display: flex !important;
    visibility: visible !important;
    opacity: 1 !important;
    position: relative !important;
    top: auto !important;
    left: auto !important;
    right: auto !important;
    bottom: auto !important;
    float: none !important;
    page-break-inside: avoid !important;
    break-inside: avoid !important;
  }
  nav.menu {
    display: flex !important;
    flex-wrap: wrap !important;
  }
  .kpis {
    display: grid !important;
    grid-template-columns: repeat(5, 1fr) !important;
    gap: 10px !important;
    width: 100% !important;
  }
  .grid3 {
    display: grid !important;
    grid-template-columns: repeat(3, 1fr) !important;
    gap: 10px !important;
    width: 100% !important;
  }
}

/* ==================== Tela de Auth (Design UI de Alta Performance) ==================== */
.auth-container{
  --auth-accent:#E5A93C; --auth-accent-2:#5B94D9; --auth-accent-3:#E6C675;
  --auth-accent-soft:rgba(229,169,60,.20); --auth-text-on:#0A0F1A;
  position:relative; overflow:hidden;
  display:none; align-items:center; justify-content:center; flex-direction:column; min-height:100vh; padding:20px;
  background:var(--bg);
}
.auth-container.show { display: flex; }
.auth-grid{
  position:absolute; inset:0; z-index:0; pointer-events:none;
  background-image:
    linear-gradient(rgba(200,155,60,.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(160,175,200,.06) 1px, transparent 1px);
  background-size:54px 54px;
  -webkit-mask-image:radial-gradient(circle at 50% 42%, #000 0%, transparent 72%);
  mask-image:radial-gradient(circle at 50% 42%, #000 0%, transparent 72%);
}
.auth-chart{
  position:absolute; inset:0; width:100%; height:100%; z-index:0; pointer-events:none; opacity:.38;
  -webkit-mask-image:linear-gradient(to bottom, transparent, #000 22%, #000 92%, transparent);
  mask-image:radial-gradient(circle at 50% 42%, #000 0%, transparent 72%);
}
.auth-chart .chart-area{animation:chartBreathe 7s ease-in-out infinite;}
.auth-chart .chart-line{
  stroke-dasharray:2600; stroke-dashoffset:2600;
  animation:chartDraw 3.2s ease-out forwards, chartGlow 4s ease-in-out 3.2s infinite;
}
.auth-chart .chart-candles{animation:candlesFade 1.4s ease-out .6s backwards;}
@keyframes chartDraw{to{stroke-dashoffset:0;}}
@keyframes chartBreathe{0%,100%{opacity:1;} 50%{opacity:.65;}}
@keyframes chartGlow{0%,100%{filter:drop-shadow(0 0 0px var(--auth-accent));} 50%{filter:drop-shadow(0 0 6px var(--auth-accent));}}
@keyframes candlesFade{from{opacity:0;} to{opacity:.8;}}
body.light .auth-grid{opacity:.5;}
body.light .auth-chart{opacity:.3;}
.auth-blob{position:absolute; border-radius:50%; filter:blur(70px); opacity:.28; pointer-events:none; will-change:transform;}
.auth-blob.b1{width:360px; height:360px; background:var(--auth-accent); top:-110px; left:-100px; animation:blobFloat 24s ease-in-out infinite;}
.auth-blob.b2{width:320px; height:320px; background:var(--auth-accent-2); bottom:-130px; right:-90px; animation:blobFloat 28s ease-in-out infinite; animation-delay:-8s;}
body.light .auth-blob{opacity:.16;}
@keyframes blobFloat{
  0%,100%{transform:translate(0,0) scale(1);}
  33%{transform:translate(35px,-40px) scale(1.1);}
  66%{transform:translate(-30px,28px) scale(.92);}
}

@keyframes authIn{
  from{opacity:0; transform:translateY(26px) scale(.96);}
  to{opacity:1; transform:translateY(0) scale(1);}
}
@keyframes fieldIn{
  from{opacity:0; transform:translateY(10px);}
  to{opacity:1; transform:translateY(0);}
}
.auth-box{
  position:relative; z-index:1;
  background:var(--card); border:1px solid var(--card-border); border-radius:24px;
  padding:38px 34px; width:100%; max-width:420px;
  box-shadow:0 25px 65px -10px rgba(0,0,0,0.65), 0 0 35px rgba(229,169,60,0.10), inset 0 1px 1px rgba(255,255,255,0.08);
  backdrop-filter:blur(36px); -webkit-backdrop-filter:blur(36px);
  animation:authIn .55s cubic-bezier(.16,1,.3,1);
}
.auth-box .brand{display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:20px; padding:0;}
.auth-box .brand .logo{
  background:linear-gradient(135deg,#E6C675 0%, #D4A84B 45%, #76A5D9 100%) !important; color:#0A0D18 !important;
  animation:logoPulse 3s ease-in-out infinite; box-shadow:0 0 20px rgba(200,155,60,0.5);
  font-weight:900 !important; font-size:22px !important; width:52px !important; height:52px !important; border-radius:16px !important;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.auth-box .brand .name{font-size:20px; font-weight:800; color:var(--text); letter-spacing:0.05em;}
@keyframes logoPulse{
  0%,100%{box-shadow:0 0 0 0 rgba(200,155,60,.5);}
  50%{box-shadow:0 0 0 9px rgba(200,155,60,0);}
}
.auth-box h2{font-size:24px; font-weight:800; margin-bottom:6px; text-align:center; color:var(--text); letter-spacing:-0.01em;}
.auth-box p.sub{font-size:13.5px; color:var(--text-dim); text-align:center; margin-bottom:24px; transition:color .2s;}
.auth-box .field{margin-bottom:16px; animation:fieldIn .45s ease backwards;}
.auth-box .field:nth-of-type(1){animation-delay:.05s;}
.auth-box .field:nth-of-type(2){animation-delay:.1s;}
.auth-box .field label{display:block; font-size:13px; font-weight:600; color:var(--text-dim); margin-bottom:6px;}
.auth-box .field input{
  background:rgba(255,255,255,0.035); border:1px solid var(--card-border); border-radius:14px;
  padding:14px 16px; color:var(--text); font-size:14px; width:100%; transition:border-color .25s, box-shadow .25s, transform .15s;
}
.auth-box .field input:focus, .auth-box .field select:focus{
  border-color:#E5A93C; box-shadow:0 0 20px rgba(229,169,60,0.30); transform:translateY(-1px);
}
.auth-forgot{display:block; text-align:right; font-size:12.5px; color:#E5A93C; font-weight:700; margin-top:8px; cursor:pointer; transition:color .15s;}
.auth-forgot:hover{color:#f5c26b; text-decoration:underline;}
.auth-box .btn-auth{
  position:relative; overflow:hidden;
  width:100%; padding:14px; background:linear-gradient(90deg, #E5A93C 0%, #D4952B 35%, #5B94D9 70%, #4C84C4 100%); color:#0A0F1A; border:none;
  border-radius:14px; font-weight:800; font-size:15px; letter-spacing:0.03em; text-transform:none; cursor:pointer; margin-top:12px;
  box-shadow:0 10px 30px rgba(229,169,60,0.30), 0 0 20px rgba(76,132,196,0.30);
  transition:all .25s cubic-bezier(0.16, 1, 0.3, 1);
}
.auth-box .btn-auth::after{
  content:''; position:absolute; top:0; left:-75%; width:45%; height:100%;
  background:linear-gradient(120deg, transparent, rgba(255,255,255,.6), transparent);
  transform:skewX(-20deg);
}
.auth-box .btn-auth:hover{filter:brightness(1.08); transform:translateY(-2px); box-shadow:0 14px 34px -4px rgba(229,169,60,0.55);}
.auth-box .btn-auth:hover::after{animation:shimmer .9s ease;}
.auth-box .btn-auth:active{transform:translateY(0) scale(.98);}
@keyframes shimmer{from{left:-75%;} to{left:130%;}}
.auth-toggle{text-align:center; font-size:13px; color:#8E9BAE; margin-top:22px; padding-top:18px; border-top:1px solid #1C2436;}
.auth-toggle a{color:#E5A93C; text-decoration:none; font-weight:800; cursor:pointer;}
.auth-toggle a:hover{text-decoration:underline;}

/* ==================== App principal Centralizado ==================== */
.app{
  display:none; min-height:100vh; position:relative; flex-direction:column;
  background:
    radial-gradient(circle at 12% 0%, rgba(59,130,246,.14), transparent 40%),
    radial-gradient(circle at 88% 18%, rgba(37,99,235,.10), transparent 45%),
    radial-gradient(circle at 50% 100%, rgba(96,165,250,.06), transparent 55%),
    var(--bg);
}
.app.show{display:flex;}
body.light .app{
  background:
    radial-gradient(circle at 12% 0%, rgba(59,130,246,.10), transparent 40%),
    radial-gradient(circle at 88% 18%, rgba(37,99,235,.06), transparent 45%),
    var(--bg);
}

.app-bg-scene{position:fixed; inset:0; z-index:0; pointer-events:none; overflow:hidden;}
.app-bg-orbital-canvas{position:absolute; inset:0; width:100%; height:100%; opacity:.75; pointer-events:none;}
.app-bg-grid{
  position:absolute; inset:0;
  background-image:
    linear-gradient(rgba(59,130,246,.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(59,130,246,.05) 1px, transparent 1px);
  background-size:54px 54px;
  -webkit-mask-image:radial-gradient(circle at 50% 50%, #000 0%, transparent 75%);
  mask-image:radial-gradient(circle at 50% 50%, #000 0%, transparent 75%);
}
.app-bg-chart{position:absolute; inset:0; width:100%; height:100%; opacity:.16;}
.app-blob{position:absolute; border-radius:50%; filter:blur(90px); opacity:.16; will-change:transform;}
.app-blob.a1{width:420px; height:420px; background:var(--green); top:-140px; right:-120px; animation:blobFloat 30s ease-in-out infinite;}
.app-blob.a2{width:360px; height:360px; background:#2563eb; bottom:-150px; left:20%; animation:blobFloat 34s ease-in-out infinite; animation-delay:-10s;}
.app-blob.a3{width:300px; height:300px; background:var(--blue); opacity:.08; top:38%; left:-100px; animation:blobFloat 38s ease-in-out infinite; animation-delay:-18s;}
body.light .app-bg-grid{opacity:.6;}
body.light .app-bg-chart{opacity:.08;}
body.light .app-blob{opacity:.08;}
body.light .app-blob.a3{opacity:.05;}

/* ==================== Cabeçalho superior (nav horizontal & drawer mobile) ==================== */
.topheader{
  position:fixed !important;
  top:0 !important;
  left:0 !important;
  right:0 !important;
  z-index:99999 !important;
  width:100% !important;
  background:#0D111A !important;
  border-bottom:1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow:0 6px 25px rgba(0,0,0,0.7) !important;
  padding-top:env(safe-area-inset-top);
}
.topheader-row{
  display:flex; align-items:center; gap:20px; padding:15px 28px; max-width:1440px; margin:0 auto;
}
.mobile-menu-btn {
  display:none; width:40px; height:40px; border-radius:11px;
  background:var(--card); border:1px solid var(--card-border);
  align-items:center; justify-content:center; cursor:pointer;
  color:var(--text); flex-shrink:0; transition:background .15s;
}
.mobile-menu-btn:hover { background:var(--hover); }

/* Drawer Mobile Slide-out */
.mobile-drawer-overlay {
  position:fixed; inset:0; background:rgba(0,0,0,0.65);
  backdrop-filter:blur(4px); z-index:990; display:none; opacity:0;
  transition:opacity 0.25s ease;
}
.mobile-drawer-overlay.show { display:block; opacity:1; }

.mobile-drawer {
  position:fixed; top:0; left:0; bottom:0; width:290px; max-width:84vw;
  background:var(--sidebar); border-right:1px solid var(--card-border);
  z-index:995; display:flex; flex-direction:column; padding:20px 16px;
  transform:translateX(-100%); transition:transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow:10px 0 30px rgba(0,0,0,0.5); overflow-y:auto;
}
.mobile-drawer.open { transform:translateX(0); }
.mobile-drawer-head {
  display:flex; align-items:center; justify-content:space-between;
  padding-bottom:16px; margin-bottom:16px; border-bottom:1px solid var(--card-border);
}
.mobile-drawer-nav { display:flex; flex-direction:column; gap:8px; flex:1; }
.mobile-drawer-nav button {
  position:relative; display:flex; align-items:center; gap:12px; padding:12px 16px;
  border-radius:14px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); color:#94A3B8;
  font-size:14px; font-weight:600; cursor:pointer; text-align:left;
  transition:all 0.22s cubic-bezier(0.16, 1, 0.3, 1); white-space:nowrap;
}
.mobile-drawer-nav button:hover {
  background:rgba(59,130,246,0.14); color:#F8FAFC; border-color:rgba(59,130,246,0.30);
  transform:translateX(4px);
}
.mobile-drawer-nav button.active {
  background:linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%);
  color:#FFFFFF; font-weight:700; border-color:rgba(255,255,255,0.35);
  box-shadow:0 8px 25px rgba(37,99,235,0.45);
}
.mobile-drawer-nav button .ic {
  width:28px; height:28px; border-radius:9px; background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.08); color:#94A3B8;
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s ease;
}
.mobile-drawer-nav button.active .ic {
  background:rgba(255,255,255,0.22); color:#FFFFFF; border:1px solid rgba(255,255,255,0.4);
}
.mobile-drawer-nav button .ic svg { width:18px; height:18px; display:block; stroke-width:2.2px; }
.brand{display:flex; align-items:center; gap:11px; flex-shrink:0;}
.brand .logo{
  width:42px; height:42px; border-radius:11px; background:linear-gradient(135deg,#3B82F6,#2563EB);
  display:flex; align-items:center; justify-content:center; font-weight:800; color:#ffffff; font-size:18px; flex-shrink:0;
  box-shadow:0 0 15px rgba(59,130,246,0.5);
}
.brand .name{font-weight:700; font-size:16px; line-height:1.25; white-space:nowrap;}
.brand .name span{display:block; color:#60a5fa; font-size:11px; letter-spacing:.06em; font-weight:700;}

nav.menu{
  display:flex; align-items:center; flex-wrap:nowrap; gap:8px; width:100%;
  padding:8px 12px; max-width:1440px; margin:0 auto 16px;
  overflow-x:auto; scrollbar-width:thin;
  background:#0F1420;
  border:1px solid rgba(255, 255, 255, 0.12);
  border-radius:20px;
  box-shadow:0 20px 45px -10px rgba(0,0,0,0.85), inset 0 1px 1px rgba(255,255,255,0.15);
}
/* Scrollbars Globais Slim & Elegantes */
*::-webkit-scrollbar{width:5px; height:5px;}
*::-webkit-scrollbar-track{background:transparent;}
*::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12); border-radius:10px;}
*::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.25);}
*{scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.12) transparent;}
nav.menu::-webkit-scrollbar{height:4px;}
nav.menu::-webkit-scrollbar-track{background:rgba(0,0,0,0.25); border-radius:10px;}
nav.menu::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.2); border-radius:10px;}
nav.menu::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.4);}

.menu button{
  position:relative; display:flex; align-items:center; gap:9px; text-align:left;
  background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
  color:#CBD5E1 !important; padding:9px 16px; border-radius:13px; font-size:13px; font-weight:600; letter-spacing:0.015em; cursor:pointer;
  white-space:nowrap; flex-shrink:0; transition:all 0.22s cubic-bezier(0.16, 1, 0.3, 1); user-select:none;
}
.menu button:hover{
  background:rgba(255,255,255,0.10); color:#FFFFFF !important; border-color:rgba(255,255,255,0.22);
  transform:translateY(-2px); box-shadow:0 8px 22px rgba(0,0,0,0.45);
}
.menu button.active{
  background:linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%) !important;
  color:#FFFFFF !important; font-weight:700; border:1px solid rgba(255,255,255,0.35) !important;
  box-shadow:0 8px 25px rgba(37,99,235,0.48), inset 0 1px 1px rgba(255,255,255,0.35); transform:translateY(-2px);
  text-shadow:0 1px 2px rgba(0,0,0,0.2);
}
.menu button.active::after{
  content:''; position:absolute; bottom:-2px; left:15%; right:15%; height:3px;
  background:linear-gradient(90deg, transparent, #60A5FA, transparent); border-radius:999px; box-shadow:0 0 12px #60A5FA;
}
.menu button .ic{
  width:28px; height:28px; border-radius:9px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08); color:#94A3B8;
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s ease;
}
.menu button:hover .ic{background:rgba(255,255,255,0.18); color:#FFFFFF; border-color:rgba(255,255,255,0.25);}
.menu button.active .ic{
  background:rgba(255,255,255,0.22); color:#FFFFFF; border:1px solid rgba(255,255,255,0.4); box-shadow:inset 0 1px 0 rgba(255,255,255,0.3);
}
.menu button .ic svg, .icon-btn svg{width:17px; height:17px; display:block; stroke-width:2.2px;}

body.light nav.menu{background:linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); border-color:#cbd5e1; box-shadow:0 10px 30px rgba(15,23,42,0.08);}
body.light .menu button{color:#334155 !important; background:rgba(15,23,42,0.04); border-color:rgba(15,23,42,0.09); text-shadow:none;}
body.light .menu button .ic{background:rgba(15,23,42,0.05); border-color:rgba(15,23,42,0.1); color:#64748B;}
body.light .menu button:hover{background:rgba(15,23,42,0.08); color:#0F172A !important; border-color:rgba(15,23,42,0.2);}
body.light .menu button:hover .ic{background:rgba(15,23,42,0.12); color:#0F172A;}
body.light .menu button.active{background:linear-gradient(135deg, #0F172A 0%, #1E293B 100%) !important; color:#FFFFFF !important; border-color:#0F172A !important; box-shadow:0 8px 24px rgba(15,23,42,0.3) !important;}
body.light .menu button.active .ic{background:rgba(255,255,255,0.2); color:#FFFFFF; border-color:rgba(255,255,255,0.3);}

/* ==================== Assinatura Executiva do Desenvolvedor (Ultra-Refined) ==================== */
.auth-dev-credit{
  margin-top:24px; z-index:10;
  display:flex; justify-content:center; pointer-events:auto;
}
.app-dev-credit{
  position:relative; width:100%; z-index:10; margin-top:auto;
  display:flex; justify-content:center; padding:14px 16px calc(14px + env(safe-area-inset-bottom));
  background:var(--sidebar); border-top:1px solid var(--card-border);
}
.dev-signature{
  position:relative;
  display:inline-flex; align-items:center; gap:9px;
  background:linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.02) 100%);
  border:1px solid rgba(255, 255, 255, 0.09);
  border-radius:999px;
  padding:5px 16px 5px 6px;
  box-shadow:0 6px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12);
  backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
  transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  text-decoration:none;
}
.dev-signature:hover{
  background:rgba(255, 255, 255, 0.06);
  border-color:rgba(96, 165, 250, 0.40);
  box-shadow:0 8px 25px rgba(0,0,0,0.5), 0 0 18px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,0.2);
  transform:translateY(-1.5px);
}
.dev-signature-icon{
  width:24px; height:24px; border-radius:50%; flex-shrink:0;
  background:linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%);
  color:#FFFFFF;
  display:flex; align-items:center; justify-content:center;
  box-shadow:0 2px 8px rgba(37,99,235,0.4);
}
.dev-signature-icon svg{
  width:11px; height:11px; stroke-width:2.5px; display:block;
}
.dev-signature-text{
  display:flex; align-items:baseline; gap:5px;
}
.dev-signature-label{
  font-size:11.5px; font-weight:500; color:#94A3B8; letter-spacing:0.01em;
}
.dev-signature-name{
  font-size:12.5px; font-weight:700; color:#FFFFFF; letter-spacing:0.02em;
}
body.light .app-dev-credit{
  background:rgba(255,255,255,0.90) !important;
  border-top-color:#e2e8f0 !important;
}
body.light .dev-signature{
  background:rgba(15,23,42,0.035) !important;
  border-color:#cbd5e1 !important;
  box-shadow:0 2px 10px rgba(15,23,42,0.05) !important;
}
body.light .dev-signature:hover{
  background:rgba(15,23,42,0.06) !important;
  border-color:#94a3b8 !important;
}
body.light .dev-signature-label{
  color:#64748b !important;
}
body.light .dev-signature-name{
  color:#0f172a !important;
}

.cfg-divider{display:flex; align-items:center; gap:10px; margin:22px 0 14px;}
.cfg-divider span{font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--text-faint); white-space:nowrap;}
.cfg-divider::before, .cfg-divider::after{content:''; flex:1; height:1px; background:var(--card-border);}

/* Centralização do conteúdo principal */
.main{
  flex:1; min-width:0; padding:22px 28px 30px;
  margin-top:140px !important;
  max-width:1440px; margin-left:auto; margin-right:auto; width:100%;
}
.right{display:flex; align-items:center; gap:16px; flex-shrink:0;}
.icon-btn{
  width:40px; height:40px; border-radius:11px; background:var(--card); border:1px solid var(--card-border);
  display:flex; align-items:center; justify-content:center; cursor:pointer; position:relative; font-size:16px; flex-shrink:0;
}
.icon-btn .dot{position:absolute; top:8px; right:8px; width:7px; height:7px; border-radius:50%; background:var(--green); box-shadow:0 0 0 2px var(--sidebar);}
.user{display:flex; align-items:center; gap:10px; cursor:pointer; min-width:0;}
.avatar{width:42px; height:42px; border-radius:50%; background:linear-gradient(135deg,#f0a63a,#d85bb0); display:flex; align-items:center; justify-content:center; font-weight:700; font-size:15px; color:#1b1200; flex-shrink:0;}
.user .uname{font-size:15.5px; font-weight:700; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px;}
.user .urole{font-size:12px; color:var(--text-faint); white-space:nowrap;}
.topheader-row .btn-ghost{padding:10px 18px; font-size:13px; flex-shrink:0;}

/* ==================== Estilo Universal para Botões de Ação (Editar, Excluir, Ações) ==================== */
.row-actions {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
}

.row-actions button,
.btn-action-edit,
.btn-action-del,
.row-edit,
[data-edit], [data-del],
[data-editacc], [data-delacc],
[data-editcat], [data-delcat],
[data-editorc], [data-delorc],
[data-editmeta], [data-delmeta],
[data-editrec], [data-delrec], [data-lancar],
[data-editalert], [data-delalert],
[data-edituser],
[data-mgedit], [data-mgdel] {
  width: 32px !important;
  height: 32px !important;
  border-radius: 9px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 14px !important;
  font-weight: 700 !important;
  cursor: pointer !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
  box-shadow: 0 2px 6px rgba(0,0,0,0.25) !important;
  outline: none !important;
  flex-shrink: 0 !important;
}

/* Botão de Editar (Pencil ✎) */
.btn-action-edit,
.row-edit,
[data-edit], [data-editacc], [data-editcat], [data-editorc], [data-editmeta], [data-editrec], [data-editalert], [data-edituser], [data-mgedit] {
  background: rgba(59, 130, 246, 0.18) !important;
  color: #60A5FA !important;
  border: 1px solid rgba(59, 130, 246, 0.35) !important;
}
.btn-action-edit:hover,
.row-edit:hover,
[data-edit]:hover, [data-editacc]:hover, [data-editcat]:hover, [data-editorc]:hover, [data-editmeta]:hover, [data-editrec]:hover, [data-editalert]:hover, [data-edituser]:hover, [data-mgedit]:hover {
  background: rgba(59, 130, 246, 0.35) !important;
  color: #FFFFFF !important;
  border-color: rgba(96, 165, 250, 0.75) !important;
  transform: translateY(-1px) scale(1.05) !important;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.40) !important;
}

/* Botão de Excluir (Lixeira 🗑) */
.btn-action-del,
[data-del], [data-delacc], [data-delcat], [data-delorc], [data-delmeta], [data-delrec], [data-delalert], [data-mgdel] {
  background: rgba(244, 63, 94, 0.18) !important;
  color: #F87171 !important;
  border: 1px solid rgba(244, 63, 94, 0.35) !important;
}
.btn-action-del:hover,
[data-del]:hover, [data-delacc]:hover, [data-delcat]:hover, [data-delorc]:hover, [data-delmeta]:hover, [data-delrec]:hover, [data-delalert]:hover, [data-mgdel]:hover {
  background: rgba(244, 63, 94, 0.35) !important;
  color: #FFFFFF !important;
  border-color: rgba(248, 113, 113, 0.75) !important;
  transform: translateY(-1px) scale(1.05) !important;
  box-shadow: 0 4px 14px rgba(244, 63, 94, 0.40) !important;
}

/* Botão de Lançar (▶) */
[data-lancar] {
  background: rgba(16, 185, 129, 0.18) !important;
  color: #34D399 !important;
  border: 1px solid rgba(16, 185, 129, 0.35) !important;
}
[data-lancar]:hover {
  background: rgba(16, 185, 129, 0.35) !important;
  color: #FFFFFF !important;
  border-color: rgba(52, 211, 153, 0.75) !important;
  transform: translateY(-1px) scale(1.05) !important;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.40) !important;
}

/* Modo Claro / Light Theme Overrides */
body.light .row-actions button,
body.light .btn-action-edit,
body.light .btn-action-del,
body.light [data-edit], body.light [data-del],
body.light [data-editacc], body.light [data-delacc],
body.light [data-editcat], body.light [data-delcat],
body.light [data-editorc], body.light [data-delorc],
body.light [data-editmeta], body.light [data-delmeta],
body.light [data-editrec], body.light [data-delrec], body.light [data-lancar],
body.light [data-editalert], body.light [data-delalert],
body.light [data-edituser], body.light [data-mgedit], body.light [data-mgdel] {
  box-shadow: 0 2px 4px rgba(15,23,42,0.08) !important;
}
body.light .btn-action-edit, body.light .row-edit, body.light [data-edit], body.light [data-editacc], body.light [data-editcat], body.light [data-editorc], body.light [data-editmeta], body.light [data-editrec], body.light [data-editalert], body.light [data-edituser], body.light [data-mgedit] {
  background: rgba(37, 99, 235, 0.10) !important;
  color: #1D4ED8 !important;
  border-color: rgba(37, 99, 235, 0.25) !important;
}
body.light .btn-action-del, body.light [data-del], body.light [data-delacc], body.light [data-delcat], body.light [data-delorc], body.light [data-delmeta], body.light [data-delrec], body.light [data-delalert], body.light [data-mgdel] {
  background: rgba(220, 38, 38, 0.10) !important;
  color: #DC2626 !important;
  border-color: rgba(220, 38, 38, 0.25) !important;
}

/* Suporte de Tema Claro para Cards de Resumo */
.cards-summary-panel, .tx-footer-summary {
  background: var(--card);
  box-shadow: var(--shadow);
  border: 1px solid rgba(232,176,75,0.3);
}
body.light .cards-summary-panel, body.light .tx-footer-summary {
  background: #ffffff !important;
  border-color: #cbd5e1 !important;
  box-shadow: 0 4px 15px rgba(20,30,60,0.06) !important;
  color: #1e293b !important;
}
body.light .cards-summary-panel h3, body.light .cards-summary-panel div, body.light .tx-footer-summary div {
  color: #1e293b !important;
}
body.light .cards-summary-panel .kpi, body.light .tx-footer-summary .kpi {
  background: #f8fafc !important;
  border-color: #e2e8f0 !important;
}
body.light .cards-summary-panel .kpi .row1, body.light .cards-summary-panel .kpi .sub {
  color: #64748b !important;
}
body.light .due-bills-panel {
  background: #ffffff !important;
  box-shadow: 0 4px 15px rgba(20,30,60,0.06) !important;
}
body.light .due-bill-row {
  background: #f8fafc !important;
}

/* Alinhamento Multidispositivo de Painéis e Cards */
.due-bills-panel {
  width: 100%;
  margin-bottom: 22px;
  box-sizing: border-box;
}
.due-bill-row {
  width: 100%;
  box-sizing: border-box;
}

.page-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:22px; flex-wrap:wrap; gap:14px;}
.page-head h1{font-size:23px; font-weight:700;}
.page-head p{color:var(--text-dim); font-size:13px; margin-top:3px;}
.head-actions{display:flex; align-items:center; gap:10px; flex-wrap:wrap;}
.period-wrap{position:relative;}
.period{
  display:flex; align-items:center; gap:9px; background:var(--card); border:1px solid var(--card-border);
  padding:6px 14px 6px 6px; border-radius:12px; font-size:13px; cursor:pointer; white-space:nowrap;
  transition:border-color .18s ease, box-shadow .18s ease, transform .15s ease;
}
.period:hover{border-color:var(--green); box-shadow:0 4px 16px rgba(232,176,75,.16); transform:translateY(-1px);}
.period:active{transform:translateY(0);}
.period-ic{
  width:32px; height:32px; border-radius:9px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(135deg,var(--green),#c9862a); color:#1f1400;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.3);
}
.period-ic svg{width:16px; height:16px;}
.period-text{display:flex; align-items:baseline; gap:4px; font-weight:700; color:var(--text);}
.period-text .period-year{font-weight:500; color:var(--text-dim);}
.period-chevron{width:9px; height:9px; color:var(--text-faint); flex-shrink:0; transition:transform .25s ease;}
.period.open .period-chevron{transform:rotate(180deg); color:var(--green);}
.period-panel{
  display:none; position:absolute; top:calc(100% + 10px); right:0; background:var(--card); border:1px solid var(--card-border);
  border-radius:14px; padding:16px; z-index:60; width:236px; box-shadow:var(--shadow); transform-origin:top right;
}
.period-panel.show{display:block; animation:periodPanelIn .22s cubic-bezier(.16,1,.3,1);}
@keyframes periodPanelIn{
  from{opacity:0; transform:translateY(-8px) scale(.95);}
  to{opacity:1; transform:translateY(0) scale(1);}
}
.period-today-btn{
  display:block; width:100%; text-align:center; background:var(--green-soft); color:var(--green); border:none;
  padding:8px; border-radius:9px; font-size:12px; font-weight:700; cursor:pointer; margin-bottom:12px;
  transition:filter .15s, transform .12s;
}
.period-today-btn:hover{filter:brightness(1.1);}
.period-today-btn:active{transform:scale(.97);}

.notif-wrap{position:relative;}
.notif-panel{
  display:none; position:absolute; top:calc(100% + 10px); right:0; background:var(--card); border:1px solid var(--card-border);
  border-radius:14px; z-index:70; width:340px; max-width:88vw; box-shadow:var(--shadow); overflow:hidden;
}
.notif-panel.show{display:block;}
.notif-panel-head{display:flex; align-items:center; justify-content:space-between; gap:10px; padding:14px 16px; border-bottom:1px solid var(--card-border);}
.notif-panel-head h4{font-size:13.5px; font-weight:700;}
.notif-markall{background:none; border:none; color:var(--green); font-size:11.5px; font-weight:600; cursor:pointer; white-space:nowrap;}
.notif-markall:hover{text-decoration:underline;}
.notif-list{max-height:360px; overflow-y:auto; padding:6px;}
.notif-item{display:flex; align-items:flex-start; gap:11px; padding:10px 10px; border-radius:10px; cursor:default;}
.notif-item:hover{background:var(--hover);}
.notif-item .ic{
  width:34px; height:34px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  font-size:15px; background:var(--green-soft);
}
.notif-item .body{flex:1; min-width:0;}
.notif-item .txt{font-size:12.5px; color:var(--text); line-height:1.4;}
.notif-item .time{font-size:11px; color:var(--text-faint); margin-top:2px;}
.notif-item.unread{background:var(--green-soft);}
.notif-item .unread-dot{width:8px; height:8px; border-radius:50%; background:var(--green); flex-shrink:0; margin-top:5px;}
.notif-empty{padding:32px 16px; text-align:center; color:var(--text-faint); font-size:12.5px;}
.btn-primary{
  position:relative; overflow:hidden;
  background:linear-gradient(135deg, #3B82F6 0%, #2563EB 100%); color:#FFFFFF; border:none; padding:10px 18px; border-radius:11px;
  font-weight:700; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:7px;
  box-shadow:0 6px 18px rgba(37,99,235,0.35), inset 0 1px 0 rgba(255,255,255,0.3);
  transition:all .22s cubic-bezier(0.16, 1, 0.3, 1);
}
.btn-primary::after{
  content:''; position:absolute; top:0; left:-75%; width:45%; height:100%;
  background:linear-gradient(120deg, transparent, rgba(255,255,255,.4), transparent);
  transform:skewX(-20deg);
}
.btn-primary:hover{filter:brightness(1.08); transform:translateY(-1.5px); box-shadow:0 8px 24px rgba(37,99,235,0.5), inset 0 1px 0 rgba(255,255,255,.35);}
.btn-primary:hover::after{animation:shimmer .9s ease;}
.btn-primary:active{transform:translateY(0) scale(.98);}
.btn-ghost{
  background:rgba(255,255,255,0.05); color:#F8FAFC; border:1px solid rgba(255,255,255,0.10); padding:9px 16px;
  border-radius:11px; font-size:13px; font-weight:600; cursor:pointer; transition:all 0.2s ease;
}
.btn-ghost:hover{background:rgba(255,255,255,0.12); border-color:rgba(255,255,255,0.22); color:#FFFFFF; transform:translateY(-1px);}

body.light .btn-ghost,
body.light #logoutBtn {
  background: rgba(15, 23, 42, 0.05) !important;
  color: #0F172A !important;
  border: 1px solid rgba(15, 23, 42, 0.15) !important;
}
body.light .btn-ghost:hover,
body.light #logoutBtn:hover {
  background: rgba(239, 68, 68, 0.12) !important;
  color: #DC2626 !important;
  border-color: rgba(239, 68, 68, 0.3) !important;
  transform: translateY(-1px);
}

.kpis{display:grid; grid-template-columns:repeat(5,1fr); gap:16px; margin-bottom:20px;}
.kpi{
  position:relative; overflow:hidden;
  background:linear-gradient(145deg, rgba(17,23,34,0.85) 0%, rgba(11,15,24,0.92) 100%);
  border:1px solid rgba(255,255,255,0.09); border-radius:18px; padding:20px 18px;
  box-shadow:0 16px 36px -8px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.12);
  backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px);
  transition:all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.kpi::before{
  content:''; position:absolute; top:0; left:0; right:0; height:3px;
  background:linear-gradient(90deg, #3B82F6, #60A5FA, #06B6D4);
  opacity:0.85; transition:opacity 0.3s ease;
}
.kpi:hover{
  transform:translateY(-3px);
  border-color:rgba(59,130,246,0.5);
  box-shadow:0 20px 42px -5px rgba(0,0,0,0.9), 0 0 25px rgba(59,130,246,0.18), inset 0 1px 0 rgba(255,255,255,0.20);
}
.kpi .row1{display:flex; align-items:center; justify-content:space-between; color:var(--text-dim); font-size:12.5px; font-weight:600; margin-bottom:12px; letter-spacing:0.01em;}
.kpi .ic{
  width:40px; height:40px; border-radius:11px; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;
  background:linear-gradient(135deg, rgba(59,130,246,0.18), rgba(37,99,235,0.08));
  border:1px solid rgba(59,130,246,0.25);
  box-shadow:0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15);
  transition:transform 0.25s ease, box-shadow 0.25s ease;
}
.kpi:hover .ic{
  transform:scale(1.06);
  box-shadow:0 6px 18px rgba(59,130,246,0.35);
}
.kpi .val{font-size:24px; font-weight:800; margin-bottom:6px; color:#FFFFFF; letter-spacing:-0.02em; font-variant-numeric:tabular-nums;}
.kpi .sub{font-size:11.5px; color:var(--text-faint); font-weight:500;}
.kpi .sub.up{color:#10B981; font-weight:700;}

.kpi.kpi-balance::before { background: linear-gradient(90deg, #3B82F6, #60A5FA); }
.kpi.kpi-income::before { background: linear-gradient(90deg, #10B981, #34D399); }
.kpi.kpi-expense::before { background: linear-gradient(90deg, #EF4444, #F87171); }
.kpi.kpi-net::before { background: linear-gradient(90deg, #3B82F6, #10B981); }
.kpi.kpi-tx::before { background: linear-gradient(90deg, #8B5CF6, #C084FC); }

body.light .kpi {
  background:#ffffff !important;
  border-color:#cbd5e1 !important;
  box-shadow:0 8px 24px rgba(15,23,42,0.06) !important;
}
body.light .kpi.kpi-balance::before { background: linear-gradient(90deg, #2563EB, #3B82F6); }
body.light .kpi.kpi-income::before { background: linear-gradient(90deg, #059669, #10B981); }
body.light .kpi.kpi-expense::before { background: linear-gradient(90deg, #DC2626, #EF4444); }
body.light .kpi.kpi-net::before { background: linear-gradient(90deg, #2563EB, #059669); }
body.light .kpi.kpi-tx::before { background: linear-gradient(90deg, #7C3AED, #8B5CF6); }
body.light .kpi:hover {
  border-color:#2563EB !important;
  box-shadow:0 14px 32px rgba(15,23,42,0.12) !important;
}
body.light .kpi .val { color:#0f172a !important; text-shadow:none; }

.grid3{display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:20px; align-items:stretch;}
.panel{
  position:relative; overflow:hidden;
  background:linear-gradient(145deg, rgba(17,23,34,0.90) 0%, rgba(11,15,24,0.95) 100%);
  border:1px solid rgba(255,255,255,0.09); border-radius:20px; padding:20px 22px;
  box-shadow:0 16px 40px -10px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.12);
  backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px);
  transition:all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;
}
.panel:hover{
  border-color:rgba(255,255,255,0.18);
  box-shadow:0 20px 48px rgba(0,0,0,0.85);
}
.panel-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; gap:10px; flex-wrap:wrap;}
.panel-head h3{font-size:15px; font-weight:800; color:#ffffff; letter-spacing:-0.01em; display:flex; align-items:center; gap:8px;}
.panel-head .tag{font-size:12px; font-weight:600; color:var(--text-dim); background:rgba(255,255,255,0.06); padding:6px 12px; border-radius:10px; cursor:pointer; border:1px solid rgba(255,255,255,0.10); transition:all 0.2s ease;}
.panel-head .tag:hover{background:rgba(59,130,246,0.18); color:#ffffff; border-color:rgba(59,130,246,0.4);}

body.light .panel {
  background:#ffffff !important;
  border-color:#cbd5e1 !important;
  box-shadow:0 8px 24px rgba(15,23,42,0.06) !important;
}
body.light .panel-head h3 { color:#0f172a !important; }

.cfg-grid{display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; margin-bottom:20px;}
.cfg-grid .panel{height:100%;}
.cfg-hint{color:var(--text-faint); font-size:12px; margin:-6px 0 14px; line-height:1.4;}
.cfg-save-bar{display:flex; justify-content:flex-end; margin-bottom:24px;}
.pass-field{position:relative;}
.pass-field input{width:100%; padding-right:42px;}
.pass-toggle{
  position:absolute; top:50%; right:6px; transform:translateY(-50%);
  width:30px; height:30px; display:flex; align-items:center; justify-content:center;
  background:none; border:none; color:var(--text-faint); cursor:pointer; border-radius:8px; padding:0;
  transition:color .15s, background .15s;
}
.pass-toggle:hover{color:var(--text); background:var(--hover);}
.pass-toggle svg{width:16px; height:16px;}
@media(max-width:820px){
  .cfg-grid{grid-template-columns:1fr;}
}

.donut-wrap{display:flex; align-items:center; justify-content:center; gap:20px;}
.donut-side{font-size:12px; color:var(--text-dim);}
.donut-side b{display:block; font-size:15px; margin-top:2px;}
.donut-side.r{text-align:right;}
.donut-canvas{position:relative; width:150px; height:150px; margin: 0 auto;}
.donut-center{position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center;}
.donut-center span{font-size:11px; color:var(--text-faint);}
.donut-center b{font-size:14.5px; margin-top:2px;}
.bar-split{height:8px; border-radius:5px; background:var(--red); overflow:hidden; margin-top:16px; display:flex;}
.bar-split .g{background:var(--green); height:100%;}
.split-labels{display:flex; justify-content:space-between; font-size:11.5px; margin-top:6px; color:var(--text-dim);}

.cat-wrap{display:flex; gap:16px; align-items:center; justify-content:center;}
.cat-legend{flex:1; display:flex; flex-direction:column; gap:9px;}
.cat-row{display:flex; align-items:center; justify-content:space-between; font-size:12px;}
.cat-row .lbl{display:flex; align-items:center; gap:7px; color:var(--text-dim);}
.cat-row .dot{width:8px; height:8px; border-radius:50%; flex-shrink:0;}
.cat-row .amt{color:var(--text); font-weight:600; margin-right:6px;}
.cat-row .pct{color:var(--text-faint);}

.accounts-list{display:flex; flex-direction:column; gap:10px; margin-bottom:14px;}
.acc-row{
  display:flex; align-items:center; gap:12px; padding:10px 14px; border-radius:14px;
  background:rgba(18,21,26,0.8); border:1px solid rgba(200,155,60,0.20);
  transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.acc-row:hover{
  background:rgba(229,169,60,0.12); border-color:rgba(200,155,60,0.45);
  transform:translateX(3px); box-shadow:0 4px 16px rgba(0,0,0,0.4);
}
.acc-row:hover .acc-edit{opacity:1;}
.acc-ic{width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:14px; flex-shrink:0; color:#fff; box-shadow:0 4px 12px rgba(0,0,0,.4);}
.acc-info{flex:1; min-width:0;}
.acc-info .n{font-size:13px; font-weight:700; color:#ffffff;}
.acc-info .t{font-size:11px; color:var(--text-faint);}
.acc-val{font-size:13px; font-weight:800; white-space:nowrap; color:#E5A93C;}
.acc-val.neg{color:var(--red);}
.acc-edit{opacity:0; transition:opacity .15s; background:none; border:none; color:var(--text-faint); cursor:pointer; font-size:12px; padding:4px;}

body.light .acc-row { background:#f8fafc !important; border-color:#e2e8f0 !important; }
body.light .acc-info .n { color:#0f172a !important; }

.table-panel{
  position:relative;
  background:linear-gradient(145deg, rgba(17,23,34,0.90) 0%, rgba(11,15,24,0.95) 100%);
  border:1px solid rgba(255,255,255,0.09); border-radius:20px; padding:22px; overflow-x:auto;
  box-shadow:0 16px 40px -10px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.12);
  backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px);
}
table{width:100%; border-collapse:collapse;}
th{text-align:left; font-size:11px; color:#94A3B8; font-weight:700; padding:0 12px 14px; text-transform:uppercase; letter-spacing:.06em;}
td{padding:13px 12px; font-size:13px; border-top:1px solid rgba(255,255,255,0.06); font-variant-numeric:tabular-nums;}
tr.trow:hover td{background:rgba(255,255,255,0.035);}

body.light .table-panel { background:#ffffff !important; border-color:#cbd5e1 !important; }
body.light td { border-top-color:#e2e8f0 !important; }
body.light tr.trow:hover td { background:#f1f5f9 !important; }

.tx-date-badge{font-weight:700; color:var(--text); font-size:12.5px; letter-spacing:0.02em;}
.tx-desc{color:var(--text); font-weight:700; font-size:13.5px;}
.pill{padding:5px 12px; border-radius:999px; font-size:11.5px; font-weight:700; display:inline-flex; align-items:center; gap:5px; letter-spacing:0.01em; transition:all 0.2s ease;}
.cat-pill{font-size:11.5px; font-weight:700;}
.acc-pill{font-size:11.5px; background:rgba(255,255,255,0.05); color:var(--text-dim); border:1px solid rgba(255,255,255,0.08); font-weight:600;}
.type-pill{display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:800;}
.type-pill.in{background:rgba(16,185,129,0.14); color:#10B981; border:1px solid rgba(16,185,129,0.30);}
.type-pill.out{background:rgba(244,63,94,0.14); color:#F43F5E; border:1px solid rgba(244,63,94,0.30);}

.status-toggle-btn{cursor:pointer; user-select:none; transition:transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;}
.status-toggle-btn:hover{transform:translateY(-1px) scale(1.04); filter:brightness(1.12); box-shadow:0 4px 12px rgba(0,0,0,0.25);}
.status-pago, .status-recebido{background:rgba(16,185,129,0.16) !important; color:#10B981 !important; border:1px solid rgba(16,185,129,0.35) !important; box-shadow:0 2px 8px rgba(16,185,129,0.15);}
.status-pendente{background:rgba(245,158,11,0.16) !important; color:#F59E0B !important; border:1px solid rgba(245,158,11,0.35) !important; box-shadow:0 2px 8px rgba(245,158,11,0.15);}

.val-in{color:#10B981; font-weight:800; font-variant-numeric:tabular-nums; font-size:13.5px;}
.val-out{color:#F43F5E; font-weight:800; font-variant-numeric:tabular-nums; font-size:13.5px;}
.row-actions{display:flex; gap:6px;}
.btn-action-edit, .btn-action-del{width:32px; height:32px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; border:1px solid rgba(255,255,255,0.10); background:rgba(255,255,255,0.04); color:var(--text-dim); cursor:pointer; transition:all 0.2s ease; font-size:13px;}
.btn-action-edit:hover{background:rgba(59,130,246,0.22); border-color:rgba(59,130,246,0.5); color:#60A5FA; transform:translateY(-1px); box-shadow:0 4px 12px rgba(59,130,246,0.3);}
.btn-action-del:hover{background:rgba(244,63,94,0.22); border-color:rgba(244,63,94,0.5); color:#F43F5E; transform:translateY(-1px); box-shadow:0 4px 12px rgba(244,63,94,0.3);}

.tfoot-row{background:rgba(255,255,255,0.02); font-weight:700; border-top:2px solid var(--card-border);}
.tfoot-label{text-align:right; font-size:12.5px; color:var(--text-dim); letter-spacing:0.03em; padding:14px 12px;}
.tfoot-value{color:#F43F5E; font-size:15px; font-weight:800; padding:14px 12px; font-variant-numeric:tabular-nums;}

/* Executive KPI Footer Cards */
.tx-footer-summary{margin-top:22px; display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:16px;}
.tx-summary-card{padding:18px 20px; border-radius:16px; background:linear-gradient(145deg, rgba(17,23,34,0.92) 0%, rgba(11,15,24,0.96) 100%); border:1px solid var(--card-border); display:flex; align-items:center; gap:14px; box-shadow:0 12px 30px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08); transition:transform 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;}
.tx-summary-card:hover{transform:translateY(-2px); box-shadow:0 16px 36px -6px rgba(0,0,0,0.75);}
.tx-summary-card.expense{border-color:rgba(244,63,94,0.35);}
.tx-summary-card.income{border-color:rgba(16,185,129,0.35);}
.tx-summary-card.balance{border-color:rgba(59,130,246,0.35);}

.tx-summary-icon{width:46px; height:46px; border-radius:14px; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:800; flex-shrink:0;}
.tx-summary-icon.expense{background:rgba(244,63,94,0.14); color:#F43F5E; border:1px solid rgba(244,63,94,0.3); box-shadow:0 4px 14px rgba(244,63,94,0.20);}
.tx-summary-icon.income{background:rgba(16,185,129,0.14); color:#10B981; border:1px solid rgba(16,185,129,0.3); box-shadow:0 4px 14px rgba(16,185,129,0.20);}
.tx-summary-icon.balance{background:rgba(59,130,246,0.14); color:#3B82F6; border:1px solid rgba(59,130,246,0.3); box-shadow:0 4px 14px rgba(59,130,246,0.20);}

.tx-summary-label{font-size:11px; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.06em; font-weight:700;}
.tx-summary-val{font-size:21px; font-weight:800; margin-top:2px; font-variant-numeric:tabular-nums;}
.tx-summary-val.expense{color:#F43F5E;}
.tx-summary-val.income{color:#10B981;}
.tx-summary-sub{font-size:11.5px; color:var(--text-dim); margin-top:2px;}

.icon-picker{display:flex; gap:6px; flex-wrap:wrap;}
.icon-picker button{width:34px; height:34px; border-radius:9px; border:1px solid var(--card-border); background:var(--bg); font-size:15px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:border-color .15s, background .15s;}
.icon-picker button:hover{border-color:var(--green); background:var(--green-soft);}
.icon-picker button.sel{border-color:var(--green); background:var(--green-soft);}
.cat-manage-tabs{display:flex; gap:8px;}
.cat-manage-tabs .cat-tab{flex:1; padding:9.5px; border-radius:10px; border:1px solid var(--card-border); background:var(--bg); color:var(--text-dim); font-size:12.5px; font-weight:700; cursor:pointer; font-family:inherit; transition:all 0.2s ease;}
.cat-manage-tabs .cat-tab.active{background:linear-gradient(135deg, rgba(229,169,60,0.3), rgba(200,155,60,0.4)); color:#E5A93C; border-color:rgba(200,155,60,0.7);}
.cat-manage-row{display:flex; align-items:center; gap:10px;}
.cat-manage-row .cat-badge{font-size:16px;}
.cat-manage-row .info{min-width:0; flex:1;}
.cat-manage-row .n{font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.cat-manage-row .u{font-size:11px; color:var(--text-faint);}
.filters{display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap;}
.filters input, .filters select{
  background:var(--bg); border:1px solid var(--card-border); border-radius:10px; padding:9px 14px; font-size:12.5px; outline:none; transition:all 0.2s ease;
}
.filters input:focus, .filters select:focus{border-color:#E5A93C; box-shadow:0 0 15px rgba(229,169,60,0.3);}
.filters input{flex:1; min-width:180px;}

.placeholder{padding:60px 20px; text-align:center; color:var(--text-dim);}
.placeholder .big{font-size:38px; margin-bottom:10px;}
.placeholder h3{color:var(--text); font-size:16px; margin-bottom:6px;}

.cat-cards{display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px; justify-content:center;}
.cat-card{
  background:linear-gradient(145deg, #12151A 0%, #0D0F13 100%);
  border:1.5px solid rgba(200,155,60,0.35); border-radius:16px; padding:18px; display:flex; flex-direction:column;
  box-shadow:0 10px 26px rgba(0,0,0,0.5), inset 0 1px 1px rgba(255,255,255,0.12);
  transition:all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.cat-card:hover{
  transform:translateY(-3px) scale(1.02);
  border-color:rgba(229,169,60,0.65);
  box-shadow:0 18px 36px rgba(0,0,0,0.7), 0 0 22px rgba(200,155,60,0.22);
}
.cat-card .top{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;}
.cat-card .id-group{display:flex; align-items:center; gap:10px; min-width:0;}
.cat-card .dot{width:20px; height:20px; border-radius:6px; flex-shrink:0; box-shadow:0 0 0 3px rgba(255,255,255,.08), 0 2px 5px rgba(0,0,0,.4);}
.cat-card h4{font-size:14px; font-weight:800; color:#ffffff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.cat-card .amt{font-size:18px; font-weight:800; color:#E5A93C;}
.cat-card .row-actions{flex-shrink:0;}
.cat-badge{
  width:36px; height:36px; border-radius:11px; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  font-size:13px; font-weight:800;
}
.cat-card-stats{display:flex; align-items:baseline; justify-content:space-between; gap:8px; margin-top:auto;}
.cat-card-stats .amt{font-size:18px; font-weight:800;}
.cat-count{color:var(--text-faint); font-size:11.5px; white-space:nowrap;}
.cat-card-add{
  border:1.5px dashed rgba(200,155,60,0.4); background:rgba(229,169,60,0.04); cursor:pointer;
  border-radius:16px; padding:18px;
  display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  color:var(--text-dim); font-size:13px; font-weight:700; min-height:100px; font-family:inherit;
  transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.cat-card-add:hover{border-color:#E5A93C; color:#E5A93C; background:rgba(229,169,60,0.12); transform:translateY(-2px);}
.cat-card-add .plus{font-size:24px; line-height:1; font-weight:400;}e-height:1; font-weight:400;}

/* ==================== Admin: Usuários Cadastrados ==================== */
.user-admin-list{display:flex; flex-direction:column; gap:8px;}
.user-row{
  display:flex; align-items:center; gap:12px; padding:11px 12px; border:1px solid var(--card-border);
  border-radius:12px; background:var(--bg); transition:border-color .15s;
}
.user-row:hover{border-color:var(--green);}
.user-row.inactive{opacity:.6;}
.user-row.inactive .user-ic{filter:grayscale(1);}
.user-ic{
  width:36px; height:36px; border-radius:50%; flex-shrink:0; display:flex; align-items:center; justify-content:center;
  background:linear-gradient(135deg,var(--green),#c9862a); color:#08130c; font-weight:800; font-size:13px;
}
.user-info{flex:1; min-width:0;}
.user-info .n{font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.user-info .e{font-size:11.5px; color:var(--text-faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.user-info .stats{font-size:11px; color:var(--text-faint); margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
.role-badge{
  font-size:11px; font-weight:700; padding:4px 10px; border-radius:20px; flex-shrink:0; white-space:nowrap;
}
.role-badge.admin{background:var(--green-soft); color:var(--green);}
.role-badge.user{background:rgba(138,147,163,.14); color:var(--text-dim);}
.role-badge.inactive{background:var(--red-soft); color:var(--red);}
.funcoes-badge{
  display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:700; padding:5px 12px; border-radius:8px; white-space:nowrap;
}
.funcoes-badge.full{background:rgba(16,185,129,0.15); color:#10b981; border:1px solid rgba(16,185,129,0.3);}
.funcoes-badge.read{background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3);}
.funcoes-badge.lock{background:rgba(239,68,68,0.15); color:#f87171; border:1px solid rgba(239,68,68,0.3);}
.row-edit{
  flex-shrink:0; background:none; border:1px solid var(--card-border); color:var(--text-dim); width:30px; height:30px;
  border-radius:8px; cursor:pointer; font-size:13px; transition:background .15s,color .15s;
}
.row-edit:hover{background:var(--hover); color:var(--text);}
.row-view{
  flex-shrink:0; background:none; border:1px solid var(--card-border); color:var(--text-dim); width:30px; height:30px;
  border-radius:8px; cursor:pointer; font-size:13px; transition:background .15s,color .15s;
}
.row-view:hover{background:var(--green-soft); color:var(--green); border-color:var(--green);}
.row-toggle{
  flex-shrink:0; background:none; border:1px solid var(--card-border); color:var(--text-dim); width:30px; height:30px;
  border-radius:8px; cursor:pointer; font-size:13px; transition:background .15s,color .15s;
}
.row-toggle:hover{background:var(--red-soft); color:var(--red); border-color:var(--red);}

/* ==================== Banner: Modo Visualização (Admin) ==================== */
.view-mode-banner{
  display:none; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap;
  padding:9px 16px; background:linear-gradient(135deg, rgba(232,176,75,.16), rgba(232,176,75,.08));
  border-bottom:1.5px solid var(--green); font-size:13px; color:var(--text); text-align:center;
}
.view-mode-banner.show{display:flex;}
.view-mode-banner strong{color:var(--green);}
.view-mode-banner button{
  background:var(--green); color:#08130c; border:none; font-weight:700; font-size:12.5px;
  padding:6px 14px; border-radius:8px; cursor:pointer; flex-shrink:0;
}
.view-mode-banner button:hover{filter:brightness(1.08);}

.acc-card{background:var(--card); border:1px solid var(--card-border); border-radius:var(--radius); padding:18px; display:flex; flex-direction:column;}
.acc-card .top{display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:6px; gap:10px;}
.acc-card .row-actions{flex-shrink:0;}

.overlay{position:fixed; inset:0; background:rgba(0,0,0,.65); backdrop-filter:blur(4px); display:none; align-items:center; justify-content:center; z-index:1000; padding:20px;}
.overlay.show{display:flex;}
#overlayCatManage{z-index:1100 !important;}
#overlayCategory{z-index:1200 !important;}
.modal{background:var(--card); border:1px solid var(--card-border); border-radius:16px; padding:24px; width:100%; max-width:440px; box-shadow:var(--shadow); position:relative; max-height:88vh; overflow-y:auto;}
.modal h2{font-size:17px; margin-bottom:18px;}
.field{margin-bottom:14px;}
.field label{display:block; font-size:12px; color:var(--text-dim); margin-bottom:6px;}
.field input, .field select{
  width:100%; background:var(--bg); border:1px solid var(--card-border); border-radius:9px; padding:10px 12px; font-size:13.5px; outline:none;
}
.field input[type=color]{padding:3px; height:38px; cursor:pointer;}
.field input[type=file]{padding:8px;}
.field-row{display:flex; gap:10px;}
.field-row .field{flex:1;}
.toggle-type{display:flex; gap:8px; margin-bottom:14px;}
.toggle-type button{
  flex:1; padding:10px; border-radius:9px; border:1px solid var(--card-border); background:var(--bg); cursor:pointer; font-size:13px; font-weight:600; color:var(--text-dim);
}
.toggle-type button.sel-in{background:var(--green-soft); color:var(--green); border-color:var(--green);}
.toggle-type button.sel-out{background:var(--red-soft); color:var(--red); border-color:var(--red);}
.modal-actions{display:flex; gap:10px; margin-top:18px;}
.modal-actions button{flex:1; padding:11px; border-radius:10px; font-size:13.5px; cursor:pointer; border:1px solid var(--card-border); background:var(--bg); color:var(--text);}
.modal-actions .save{background:var(--green); border:none; color:#08130c; font-weight:700;}
.close-x{position:absolute; top:16px; right:18px; background:none; border:none; color:var(--text-dim); font-size:18px; cursor:pointer;}

.toast{
  position:fixed; top:28px; left:50%; transform:translate(-50%, -20px) scale(0.92);
  background:#082012; border:1.5px solid #22c55e; color:#ffffff;
  padding:14px 26px; border-radius:14px; font-size:15px; font-weight:800;
  box-shadow:0 14px 40px rgba(0,0,0,0.6), 0 0 24px rgba(34, 197, 94, 0.3);
  z-index:99999; display:flex; align-items:center; gap:12px; max-width:90vw;
  opacity:0; pointer-events:none; transition:all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.toast.show{
  opacity:1; pointer-events:auto; transform:translate(-50%, 0) scale(1);
}
.toast.toast-danger{
  background:#2a080c; border-color:#ef4444; box-shadow:0 14px 40px rgba(0,0,0,0.6), 0 0 24px rgba(239, 68, 68, 0.35);
}
.toast.toast-danger .d{
  background:#ef4444; box-shadow:0 0 10px #ef4444;
}
.toast .d{
  width:12px; height:12px; border-radius:50%; background:#22c55e; flex-shrink:0; box-shadow:0 0 10px #22c55e;
}

/* ==================== Popup de login bem-sucedido (Dashboard Theme 4K) ==================== */
.login-success-overlay{
  position:fixed; inset:0; background:rgba(6, 10, 20, 0.85);
  backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
  display:none; align-items:center; justify-content:center; z-index:99999 !important; padding:20px; opacity:0;
  transition:opacity .3s ease;
}
.login-success-overlay.show{display:flex;}
.login-success-overlay.in{opacity:1;}
.login-success-box{
  background:linear-gradient(145deg, rgba(17, 24, 39, 0.96) 0%, rgba(10, 15, 29, 0.98) 100%);
  border:1px solid rgba(59, 130, 246, 0.35);
  border-radius:22px;
  padding:34px 28px 26px;
  width:100%; max-width:360px; text-align:center;
  box-shadow:0 30px 80px rgba(0,0,0,0.9), 0 0 35px rgba(59, 130, 246, 0.22), inset 0 1px 1px rgba(255,255,255,0.2);
  transform:translateY(16px) scale(.94); opacity:0;
  transition:transform .35s cubic-bezier(.16,1,.3,1), opacity .35s ease;
}
.login-success-overlay.in .login-success-box{transform:translateY(0) scale(1); opacity:1;}
.login-success-check{
  width:64px; height:64px; margin:0 auto 18px; border-radius:50%;
  background:linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(37, 99, 235, 0.16) 100%);
  border:1.5px solid rgba(16, 185, 129, 0.5);
  box-shadow:0 0 25px rgba(16, 185, 129, 0.35), inset 0 1px 1px rgba(255,255,255,0.3);
  display:flex; align-items:center; justify-content:center;
}
.login-success-check svg{width:34px; height:34px;}
.login-success-check circle{stroke:rgba(16, 185, 129, 0.4); stroke-width:2.5;}
.login-success-check path{
  stroke:#10B981; stroke-width:4; stroke-linecap:round; stroke-linejoin:round;
  stroke-dasharray:40; stroke-dashoffset:40; animation:loginCheckDraw .45s ease .15s forwards;
  filter:drop-shadow(0 0 6px rgba(16,185,129,0.8));
}
@keyframes loginCheckDraw{to{stroke-dashoffset:0;}}
.login-success-box h3{
  font-size:18px; font-weight:800; color:#FFFFFF; margin-bottom:6px; letter-spacing:-0.01em;
}
.login-success-box p{
  color:#94A3B8; font-size:13px; font-weight:500; margin:0 0 16px;
}
.login-success-progress-bar{
  width:100%; height:4.5px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;
}
.login-success-progress-fill{
  height:100%; width:0; background:linear-gradient(90deg, #3B82F6, #10B981); border-radius:3px;
  animation:loginProgressFill 2.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes loginProgressFill{
  from{width:0%;}
  to{width:100%;}
}
body.light .login-success-box{
  background:#FFFFFF !important;
  border-color:#cbd5e1 !important;
  box-shadow:0 25px 60px rgba(0,0,0,0.15) !important;
}
body.light .login-success-box h3{
  color:#0f172a !important;
}
body.light .login-success-box p{
  color:#64748b !important;
}

/* ==================== Popup de conta desativada ==================== */
.account-disabled-icon{
  width:64px; height:64px; margin:0 auto 18px; border-radius:50%;
  background:var(--red-soft); display:flex; align-items:center; justify-content:center;
}
.account-disabled-icon svg{width:30px; height:30px;}
.account-disabled-icon path, .account-disabled-icon circle{stroke:var(--red); stroke-width:2.5; fill:none; stroke-linecap:round; stroke-linejoin:round;}
.login-success-box .account-disabled-btn{
  margin-top:20px; width:100%; background:var(--red); color:#fff; border:none; font-weight:700;
  font-size:13.5px; padding:11px; border-radius:10px; cursor:pointer; transition:filter .15s;
}
.login-success-box .account-disabled-btn:hover{filter:brightness(1.08);}

/* ==================== Popup de Logout (Sessão Encerrada) ==================== */
.logout-success-icon {
  width: 68px; height: 68px; margin: 0 auto 18px; border-radius: 50%;
  background: rgba(6, 214, 160, 0.15); border: 1px solid rgba(6, 214, 160, 0.35);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 0 25px rgba(6, 214, 160, 0.25);
}
.logout-success-icon svg {
  width: 32px; height: 32px; stroke: #06D6A0;
}
.logout-box h3 {
  font-size: 19px; font-weight: 800; color: #ffffff; margin-bottom: 8px; tracking-tight;
}
.logout-box p {
  color: #9ca3af; font-size: 13.5px; line-height: 1.5; margin-bottom: 20px;
}
.logout-btn-action {
  width: 100%; padding: 12px 16px; border-radius: 12px; font-weight: 700; font-size: 13.5px;
  background: linear-gradient(135deg, #06D6A0, #00E5FF); color: #060B18; border: none;
  cursor: pointer; box-shadow: 0 4px 14px rgba(6, 214, 160, 0.3);
  transition: transform 0.2s ease, filter 0.2s ease;
}
.logout-btn-action:hover {
  transform: translateY(-1px); filter: brightness(1.08);
}

/* ==================== Responsividade Master Fluida em Todos os Dispositivos ==================== */
@media (min-width: 1700px) {
  .brand .name { font-size: 18px; }
  .main { max-width: 1720px !important; }
  .kpis { grid-template-columns: repeat(5, 1fr) !important; }
}

@media (max-width: 1400px) and (min-width: 1025px) {
  .kpis { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)) !important; }
}

@media (max-width: 1024px) {
  .kpis { grid-template-columns: repeat(3, 1fr) !important; }
  .grid3 { grid-template-columns: 1fr 1fr !important; }
  .grid-2-1 { grid-template-columns: 1fr !important; }
}

@media (max-width: 768px) {
  .mobile-menu-btn { display: flex !important; }
  nav.menu { display: none !important; }
  .kpis { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
  .grid3, .grid2 { grid-template-columns: 1fr !important; }
  .topheader-row { padding: 12px 16px; gap: 10px; }
  .brand .name { font-size: 14px; }
  .user .uname, .user .urole { max-width: 110px; }
  .donut-wrap { flex-direction: column; text-align: center; gap: 14px; }
  .donut-side.r { text-align: center; }
  .cat-cards { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
  .main { margin-top: 75px !important; padding: 16px 12px 60px !important; }
}

@media (max-width: 480px) {
  .main { margin-top: 70px !important; padding: 12px 10px 60px !important; }
  .kpis { grid-template-columns: repeat(2, 1fr) !important; gap: 8px !important; }
  .kpi { padding: 14px 10px !important; }
  .kpi .val { font-size: 16px !important; }
  .page-head h1 { font-size: 17px !important; }
  .brand .name span { display: none !important; }
  .user .uname, .user .urole { display: none !important; }
  .topheader-row .btn-ghost { padding: 8px 10px; font-size: 12px; }

  /* Modais deslizantes no celular */
  .overlay { align-items: flex-end; padding: 0; }
  .modal { max-width: 100% !important; width: 100% !important; border-radius: 24px 24px 0 0 !important; max-height: 88vh; padding: 20px 16px calc(24px + env(safe-area-inset-bottom)); }
  .field-row { flex-direction: column; gap: 0; }
  .field-row .field { margin-bottom: 14px; }
  .field { margin-bottom: 16px; }
  .field label { font-size: 12.5px; margin-bottom: 7px; }
  .field input, .field select { font-size: 16px; padding: 12px 13px; }
  .toggle-type button { padding: 12px; font-size: 13.5px; }
  .modal-actions { position: sticky; bottom: 0; background: var(--card); padding-top: 10px; margin-top: 14px; border-top: 1px solid var(--card-border); }
  .modal-actions button { padding: 13px; font-size: 14px; }
  .close-x { top: 14px; right: 14px; font-size: 20px; padding: 6px; }

  /* Tabelas com rolagem limpa */
  .table-panel { padding: 12px 10px; }
  table { min-width: 580px; }
  .filters { flex-direction: column; }
  .filters input, .filters select { width: 100%; font-size: 16px; padding: 10px 12px; }
  .cat-cards { grid-template-columns: 1fr 1fr; gap: 10px; }
}
@media(max-width:360px){
  .kpis{grid-template-columns:1fr;}
  .cat-cards{grid-template-columns:1fr;}
}

/* Estilos de Escala de Tela e Dispositivo Logado */
.scale-dropdown .scale-opt-btn:hover {
  background: rgba(255, 255, 255, 0.08) !important;
}
body.light .scale-dropdown .scale-opt-btn:hover {
  background: rgba(0, 0, 0, 0.06) !important;
}
body.light .scale-dropdown {
  background: #ffffff !important;
  border-color: #cbd5e1 !important;
  box-shadow: 0 10px 30px rgba(0,0,0,0.15) !important;
}
</style>
</head>
<body>

<!-- TELA DE LOGIN / CADASTRO -->
<div class="auth-container show" id="authPage">
  <div class="auth-grid" aria-hidden="true"></div>
  <svg class="auth-chart" viewBox="0 0 1600 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--auth-accent)" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="var(--auth-accent)" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path class="chart-area" d="M 0.0,380 L 27.1,385.0 L 54.2,400.1 L 81.4,386.1 L 108.5,405.7 L 135.6,398.4 L 162.7,401.0 L 189.8,421.5 L 216.9,415.8 L 244.1,437.5 L 271.2,436.1 L 298.3,455.8 L 325.4,474.4 L 352.5,473.6 L 379.7,449.4 L 406.8,466.0 L 433.9,476.9 L 461.0,464.3 L 488.1,433.1 L 515.3,423.4 L 542.4,424.2 L 569.5,391.4 L 596.6,412.5 L 623.7,386.5 L 650.8,393.5 L 678.0,409.0 L 705.1,425.9 L 732.2,431.8 L 759.3,408.3 L 786.4,421.6 L 813.6,411.7 L 840.7,398.4 L 867.8,400.6 L 894.9,392.7 L 922.0,412.8 L 949.2,433.2 L 976.3,445.0 L 1003.4,429.4 L 1030.5,428.4 L 1057.6,433.9 L 1084.7,423.8 L 1111.9,421.3 L 1139.0,427.7 L 1166.1,405.4 L 1193.2,388.7 L 1220.3,398.3 L 1247.5,388.8 L 1274.6,382.1 L 1301.7,355.2 L 1328.8,336.7 L 1355.9,343.8 L 1383.1,310.7 L 1410.2,327.7 L 1437.3,327.2 L 1464.4,307.1 L 1491.5,322.1 L 1518.6,317.5 L 1545.8,339.1 L 1572.9,324.1 L 1600.0,303.6 L 1600.0,800 L 0.0,800 Z" fill="url(#chartFill)" stroke="none"/>
    <path class="chart-line" d="M 0.0,380 L 27.1,385.0 L 54.2,400.1 L 81.4,386.1 L 108.5,405.7 L 135.6,398.4 L 162.7,401.0 L 189.8,421.5 L 216.9,415.8 L 244.1,437.5 L 271.2,436.1 L 298.3,455.8 L 325.4,474.4 L 352.5,473.6 L 379.7,449.4 L 406.8,466.0 L 433.9,476.9 L 461.0,464.3 L 488.1,433.1 L 515.3,423.4 L 542.4,424.2 L 569.5,391.4 L 596.6,412.5 L 623.7,386.5 L 650.8,393.5 L 678.0,409.0 L 705.1,425.9 L 732.2,431.8 L 759.3,408.3 L 786.4,421.6 L 813.6,411.7 L 840.7,398.4 L 867.8,400.6 L 894.9,392.7 L 922.0,412.8 L 949.2,433.2 L 976.3,445.0 L 1003.4,429.4 L 1030.5,428.4 L 1057.6,433.9 L 1084.7,423.8 L 1111.9,421.3 L 1139.0,427.7 L 1166.1,405.4 L 1193.2,388.7 L 1220.3,398.3 L 1247.5,388.8 L 1274.6,382.1 L 1301.7,355.2 L 1328.8,336.7 L 1355.9,343.8 L 1383.1,310.7 L 1410.2,327.7 L 1437.3,327.2 L 1464.4,307.1 L 1491.5,322.1 L 1518.6,317.5 L 1545.8,339.1 L 1572.9,324.1 L 1600.0,303.6" fill="none" stroke="var(--auth-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>

  <div class="auth-blob b1"></div>
  <div class="auth-blob b2"></div>

  <!-- Login -->
  <div class="auth-box" id="loginBox">
    <div class="brand">
      <div class="logo">S</div>
      <div class="name">SISTEMA</div>
    </div>
    <h2>Bem-vindo de volta</h2>
    <p class="sub">Acesse sua conta para gerenciar suas finanças.</p>
    <form id="loginForm">
      <div class="field">
        <label>E-mail</label>
        <input type="email" id="loginEmail" placeholder="seu.email@exemplo.com" required autocomplete="username">
      </div>
      <div class="field">
        <label>Senha</label>
        <div class="pass-field">
          <input type="password" id="loginPassword" placeholder="••••••••" required autocomplete="current-password">
          <button type="button" class="pass-toggle" id="loginPasswordToggle" tabindex="-1" aria-label="Mostrar senha"></button>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-top:8px; font-size:12.5px;">
          <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#8E9BAE;">
            <input type="checkbox" id="rememberMe" checked style="accent-color:#E5A93C;">
            <span>Lembrar de mim</span>
          </label>
          <a class="auth-forgot" id="goForgot" style="margin-top:0;">Esqueceu a senha?</a>
        </div>
      </div>
      <button type="submit" class="btn-auth">Entrar na Conta →</button>
    </form>
    <div style="position:relative; margin:22px 0 16px; text-align:center;">
      <div style="position:absolute; inset:0; display:flex; align-items:center;"><div style="width:100%; height:1px; background:#1C2436;"></div></div>
      <span style="position:relative; padding:0 12px; background:#0E1322; font-size:11px; font-weight:700; color:#5C6B80; text-transform:uppercase; letter-spacing:0.1em;">OU ENTRE COM</span>
    </div>
    <div style="display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:16px;">
      <button type="button" onclick="fillDemoCredentials('admin@nexusfinanceiro.com', '86266049', 'Administrador')" title="Google" style="width:48px; height:48px; border-radius:14px; background:#141A28; border:1px solid #232D42; display:flex; align-items:center; justify-content:center; cursor:pointer;">
        <svg style="width:20px; height:20px;" viewBox="0 0 24 24">
          <path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.6l3.1-3.1C17.3 1.7 14.8 1 12 1 7.4 1 3.5 3.6 1.6 7.4l3.7 2.9C6.2 7.4 8.9 5 12 5z"/>
          <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"/>
          <path fill="#FBBC05" d="M5.3 14.7c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.6 7.2C.6 9.2 0 11.5 0 14s.6 4.8 1.6 6.8l3.7-2.9z"/>
          <path fill="#34A853" d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3.1 0-5.8-2.4-6.7-5.3L1.6 16C3.5 19.8 7.4 23 12 23z"/>
        </svg>
      </button>
      <button type="button" onclick="fillDemoCredentials('paulolp0101@gmail.com', '86266049', 'Paulo Lima')" title="Apple" style="width:48px; height:48px; border-radius:14px; background:#141A28; border:1px solid #232D42; display:flex; align-items:center; justify-content:center; cursor:pointer;">
        <svg style="width:20px; height:20px; fill:#ffffff;" viewBox="0 0 24 24">
          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.32c.67-.82 1.12-1.96.99-3.1-.96.04-2.14.64-2.83 1.44-.61.71-1.15 1.87-1 3.01 1.08.08 2.17-.53 2.84-1.35z"/>
        </svg>
      </button>
      <button type="button" onclick="fillDemoCredentials('admin@nexusfinanceiro.com', '86266049', 'Administrador')" title="LinkedIn" style="width:48px; height:48px; border-radius:14px; background:#141A28; border:1px solid #232D42; display:flex; align-items:center; justify-content:center; cursor:pointer;">
        <svg style="width:20px; height:20px; fill:#0A66C2;" viewBox="0 0 24 24">
          <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.7a1.6 1.6 0 1 0 1.6 1.6 1.61 1.61 0 0 0-1.6-1.6z"/>
        </svg>
      </button>
    </div>
    <div class="auth-toggle">
      Não tem uma conta? <a id="goRegister" style="color:#E5A93C; font-weight:800;">Cadastrar-se</a>
    </div>
  </div>

  <!-- Recuperar Senha -->
  <div class="auth-box" id="forgotBox" style="display:none;">
    <div class="brand">
      <div class="logo">N</div>
      <div class="name">NEXUS<span>FINANCEIRO HUB</span></div>
    </div>
    <h2>Recuperar Senha</h2>
    <p class="sub" id="forgotSub">Informe seu e-mail para enviarmos sua senha</p>

    <form id="forgotStep1">
      <div class="field">
        <label>E-mail</label>
        <input type="email" id="forgotEmail" placeholder="seu.email@exemplo.com" required>
      </div>
      <button type="submit" class="btn-auth" id="btnSendPassword">Enviar Senha por E-mail</button>
    </form>

    <div class="auth-toggle">
      Lembrou a senha? <a id="goLoginFromForgot">Fazer Login</a>
    </div>
  </div>

  <!-- Cadastro -->
  <div class="auth-box" id="registerBox" style="display:none;">
    <div class="brand">
      <div class="logo">N</div>
      <div class="name">NEXUS<span>FINANCEIRO HUB</span></div>
    </div>
    <h2>Criar Conta</h2>
    <p class="sub">Preencha seus dados para começar</p>
    <form id="registerForm">
      <div class="field">
        <label>Nome Completo</label>
        <input type="text" id="regName" placeholder="Ex: Maria Silva" required>
      </div>
      <div class="field">
        <label>E-mail</label>
        <input type="email" id="regEmail" placeholder="seu.email@exemplo.com" required>
      </div>
      <div class="field">
        <label>Senha</label>
        <input type="password" id="regPassword" placeholder="••••••••" required minlength="6">
      </div>
      <button type="submit" class="btn-auth">Cadastrar Conta</button>
    </form>
    <div class="auth-toggle">
      Já tem uma conta? <a id="goLogin">Fazer Login</a>
    </div>
  </div>
  <div class="auth-dev-credit">
    <div class="dev-signature">
      <div class="dev-signature-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      </div>
      <div class="dev-signature-text">
        <span class="dev-signature-label">Desenvolvido por</span>
        <strong class="dev-signature-name">Paulo Lima</strong>
      </div>
    </div>
  </div>
</div>

<!-- APLICAÇÃO PRINCIPAL -->
<div class="app" id="appMain">
  <div class="view-mode-banner" id="viewModeBanner">
    <span>👁 Visualizando dados de <strong id="viewModeUserName"></strong> (modo administrador)</span>
    <button id="viewModeExitBtn">Voltar para minha conta</button>
  </div>
  <div class="app-bg-scene" aria-hidden="true">
    <canvas id="appBgOrbitalCanvas" class="app-bg-orbital-canvas"></canvas>
    <div class="app-bg-grid"></div>
    <svg class="app-bg-chart" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
      <path d="M 0.0,380 L 32.7,355.4 L 65.3,329.5 L 98.0,306.5 L 130.6,323.9 L 163.3,315.9 L 195.9,316.3 L 228.6,311.4 L 261.2,326.5 L 293.9,338.5 L 326.5,337.9 L 359.2,348.4 L 391.8,347.3 L 424.5,367.6 L 457.1,385.0 L 489.8,371.1 L 522.4,371.6 L 555.1,367.6 L 587.8,352.5 L 620.4,356.1 L 653.1,374.8 L 685.7,357.3 L 718.4,349.4 L 751.0,338.1 L 783.7,328.7 L 816.3,301.7 L 849.0,305.2 L 881.6,288.8 L 914.3,292.0 L 946.9,285.0 L 979.6,273.5 L 1012.2,279.4 L 1044.9,296.7 L 1077.6,294.6 L 1110.2,280.3 L 1142.9,272.4 L 1175.5,271.6 L 1208.2,261.1 L 1240.8,273.6 L 1273.5,286.3 L 1306.1,291.7 L 1338.8,272.5 L 1371.4,284.3 L 1404.1,300.2 L 1436.7,316.9 L 1469.4,336.5 L 1502.0,344.4 L 1534.7,337.3 L 1567.3,317.9 L 1600.0,323.0" fill="none" stroke="var(--green)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="app-blob a1"></div>
    <div class="app-blob a2"></div>
    <div class="app-blob a3"></div>
  </div>
  <div class="topheader">
    <div class="topheader-row">
      <button class="mobile-menu-btn" id="mobileMenuToggle" title="Abrir Menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div class="brand">
        <div class="logo">N</div>
        <div class="name">NEXUS<span>FINANCEIRO HUB</span></div>
      </div>
      <div class="right" style="margin-left:auto;">
        <div class="notif-wrap">
          <div class="icon-btn" id="notifBtn" title="Notificações"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg><span class="dot" id="notifDot" style="display:none;"></span></div>
          <div class="notif-panel" id="notifPanel">
            <div class="notif-panel-head">
              <h4>Notificações</h4>
              <button class="notif-markall" id="notifMarkAllBtn">Marcar todas como lidas</button>
            </div>
            <div class="notif-list" id="notifList"></div>
          </div>
        </div>
        <div class="scale-selector-wrap" style="position:relative; display:inline-flex; align-items:center;">
          <button class="icon-btn" id="scaleMenuBtn" title="Tamanho de Visualização / Escala" style="gap:4px; width:auto; padding:0 8px; font-size:12px; font-weight:600;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            <span id="currentScaleLabel">Auto</span>
          </button>
          <div class="scale-dropdown" id="scaleDropdown" style="display:none; position:absolute; top:calc(100% + 8px); right:0; background:var(--card); border:1px solid var(--card-border); border-radius:12px; padding:6px; box-shadow:0 10px 30px rgba(0,0,0,0.5); z-index:100; min-width:170px;">
            <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-muted); padding:6px 8px 4px;">Escala da Tela</div>
            <button class="scale-opt-btn" data-scale="auto" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">⚡ Auto (Dispositivo)</button>
            <button class="scale-opt-btn" data-scale="80%" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">🔍 80% (Compacto)</button>
            <button class="scale-opt-btn" data-scale="90%" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">🔍 90% (Reduzido)</button>
            <button class="scale-opt-btn" data-scale="100%" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">🔍 100% (Padrão 1:1)</button>
            <button class="scale-opt-btn" data-scale="110%" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">🔍 110% (Ampliado)</button>
            <button class="scale-opt-btn" data-scale="125%" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">🔍 125% (Grande)</button>
            <button class="scale-opt-btn" data-scale="150%" style="width:100%; text-align:left; padding:6px 10px; border:none; background:transparent; color:var(--text); border-radius:6px; font-size:12.5px; cursor:pointer; display:flex; justify-content:space-between; align-items:center;">🔍 150% (Extra Grande)</button>
          </div>
        </div>
        <div class="icon-btn" id="miniThemeBtn" title="Alternar Tema"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/></svg></div>
        <div class="user" id="userMenu" data-nav="config">
          <div class="avatar" id="headerAvatar"></div>
          <div><div class="uname" id="headerName"></div><div class="urole" id="headerRole"></div></div>
        </div>
        <button class="btn-ghost" id="logoutBtn">Sair</button>
      </div>
    </div>
    <nav class="menu" id="menu">
      <button data-page="dashboard"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></span> Dashboard</button>
      <button data-page="transacoes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg></span> Transações</button>
      <button data-page="cartoes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg></span> Cartões</button>
      <button data-page="orcamentos"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></span> Orçamentos</button>
      <button data-page="metas"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span> Metas</button>
      <button data-page="relatorios"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8" rx="1"/><rect x="12" y="5" width="3" height="13" rx="1"/><rect x="17" y="13" width="3" height="5" rx="1"/></svg></span> Relatórios</button>
      <button data-page="recorrentes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></span> Recorrentes</button>
      <button data-page="importar"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/></svg></span> Importar</button>
      <button data-page="anexos"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 1 1 5.66 5.66l-8.59 8.58a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span> Anexos</button>
      <button data-page="config"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span> Configurações</button>
      <button data-page="funcoes" id="menuFuncoesBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span> Funções & Permissões</button>
      <button data-page="usuarios" id="menuUsuariosBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> Usuários Cadastrados</button>
      <button data-page="logs" id="menuLogsBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span> Logs do Sistema</button>
    </nav>
  </div>

  <!-- Drawer Mobile Slide-out -->
  <div class="mobile-drawer-overlay" id="mobileDrawerOverlay"></div>
  <div class="mobile-drawer" id="mobileDrawer">
    <div class="mobile-drawer-head">
      <div class="brand">
        <div class="logo">N</div>
        <div class="name">NEXUS<span>FINANCEIRO HUB</span></div>
      </div>
      <button class="close-x" id="closeMobileDrawer" style="position:static; padding:4px;">✕</button>
    </div>
    <nav class="mobile-drawer-nav" id="mobileDrawerMenu">
      <button data-page="dashboard"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></span> Dashboard</button>
      <button data-page="transacoes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg></span> Transações</button>
      <button data-page="cartoes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg></span> Cartões</button>
      <button data-page="orcamentos"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></span> Orçamentos</button>
      <button data-page="metas"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span> Metas</button>
      <button data-page="relatorios"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8" rx="1"/><rect x="12" y="5" width="3" height="13" rx="1"/><rect x="17" y="13" width="3" height="5" rx="1"/></svg></span> Relatórios</button>
      <button data-page="recorrentes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></span> Recorrentes</button>
      <button data-page="importar"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/></svg></span> Importar</button>
      <button data-page="anexos"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 1 1 5.66 5.66l-8.59 8.58a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span> Anexos</button>
      <button data-page="config"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span> Configurações</button>
      <button data-page="funcoes" id="mobileDrawerFuncoesBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span> Funções & Permissões</button>
      <button data-page="usuarios" id="mobileDrawerUsuariosBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> Usuários Cadastrados</button>
      <button data-page="logs" id="mobileDrawerLogsBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span> Logs do Sistema</button>
    </nav>
  </div>

  <main class="main">
    <div id="pageContent"></div>
  </main>
  <div class="app-dev-credit">
    <div class="dev-signature">
      <div class="dev-signature-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      </div>
      <div class="dev-signature-text">
        <span class="dev-signature-label">Desenvolvido por</span>
        <strong class="dev-signature-name">Paulo Lima</strong>
      </div>
    </div>
  </div>
</div>

<!-- Modal Transação -->
<div class="overlay" id="overlay">
  <div class="modal">
    <button class="close-x" id="closeModal">✕</button>
    <h2 id="modalTitle">Nova Transação</h2>
    <div class="toggle-type">
      <button type="button" id="typeInBtn">↓ Receita</button>
      <button type="button" id="typeOutBtn">↑ Despesa</button>
    </div>
    <div class="field"><label>Descrição</label><input id="fDesc" placeholder="Ex: Supermercado"></div>
    <div class="field-row">
      <div class="field"><label>Valor (R$)</label><input id="fValor" type="number" step="0.01" placeholder="0,00"></div>
      <div class="field"><label>Data</label><input id="fData" type="date"></div>
    </div>
    <div class="field"><label>Categoria</label>
      <div style="display:flex; gap:6px;">
        <select id="fCategoria" style="flex:1;"></select>
        <button type="button" id="fCategoriaAddBtn" title="Nova categoria" style="flex-shrink:0; width:40px; border:1px solid var(--card-border); background:var(--card); border-radius:10px; font-size:16px; font-weight:700; cursor:pointer; color:var(--text);">+</button>
      </div>
    </div>
    <div class="field"><label id="fContaLabel">Conta / Cartão</label>
      <div style="display:flex; gap:6px;">
        <select id="fConta" style="flex:1;"></select>
        <button type="button" id="fContaAddBtn" title="Nova Conta ou Cartão de Débito" style="flex-shrink:0; width:40px; border:1px solid var(--card-border); background:var(--card); border-radius:10px; font-size:16px; font-weight:700; cursor:pointer; color:var(--text);">+</button>
      </div>
      <div id="cardLimitHint" style="display:none;margin-top:6px;font-size:12px;padding:8px 12px;border-radius:8px;background:var(--green-soft);color:var(--green);font-weight:600;align-items:center;gap:6px;"></div>
    </div>
    <div class="field"><label>Status</label>
      <select id="fStatus"><option>Pago</option><option>Recebido</option><option>Pendente</option></select>
    </div>
    <div class="modal-actions">
      <button id="cancelBtn">Cancelar</button>
      <button class="save" id="saveBtn">Salvar Transação</button>
    </div>
  </div>
</div>

<!-- Modal Conta -->
<div class="overlay" id="overlayAccount">
  <div class="modal">
    <button class="close-x" id="closeAccModal">✕</button>
    <h2 id="accModalTitle">Nova Conta</h2>
    <div class="field"><label>Nome</label><input id="accName" placeholder="Ex: Nubank"></div>
    <div class="field"><label>Tipo</label>
      <select id="accType">
        <option value="Conta Corrente">Conta Corrente</option>
        <option value="Cartão de Débito">Cartão de Débito</option>
        <option value="Conta Poupança">Conta Poupança</option>
        <option value="Cartão de Crédito">Cartão de Crédito</option>
        <option value="Investimento">Investimento</option>
      </select>
    </div>
    <div class="field-row">
      <div class="field"><label id="accBalanceLabel">Saldo (R$)</label><input id="accBalance" type="number" step="0.01" placeholder="0,00"></div>
      <div class="field"><label>Cor</label><input id="accColor" type="color" value="#e8b04b"></div>
    </div>
    <div class="modal-actions">
      <button id="accCancelBtn">Cancelar</button>
      <button class="save" id="accSaveBtn">Salvar Conta</button>
    </div>
  </div>
</div>

<!-- Modal Categoria -->
<div class="overlay" id="overlayCategory">
  <div class="modal">
    <button class="close-x" id="closeCatModal">✕</button>
    <h2 id="catModalTitle">Nova Categoria</h2>
    <div class="field"><label>Nome</label><input id="catName" placeholder="Ex: Educação"></div>
    <div class="field"><label>Tipo</label>
      <select id="catTipo"><option value="despesa">Despesa</option><option value="receita">Receita</option></select>
    </div>
    <div class="field-row">
      <div class="field"><label>Ícone</label><input id="catIconInput" placeholder="📁" maxlength="4" style="text-align:center;font-size:17px;"></div>
      <div class="field"><label>Cor</label><input id="catColor" type="color" value="#e8b04b"></div>
    </div>
    <div class="field"><label>Sugestões</label><div id="catIconPicker" class="icon-picker"></div></div>
    <div class="modal-actions">
      <button id="catCancelBtn">Cancelar</button>
      <button class="save" id="catSaveBtn">Salvar Categoria</button>
    </div>
  </div>
</div>

<!-- Modal Gerenciar Categorias -->
<div class="overlay" id="overlayCatManage">
  <div class="modal" style="max-width:600px;">
    <button class="close-x" id="closeCatManageModal">✕</button>
    <h2>Gerenciar Categorias</h2>
    <div class="cat-manage-tabs">
      <button type="button" class="cat-tab" data-cattab="despesa">↓ Despesas</button>
      <button type="button" class="cat-tab" data-cattab="receita">↑ Receitas</button>
    </div>
    <div id="catManageList" class="cat-cards" style="margin-top:14px;"></div>
    <div class="modal-actions">
      <button id="catManageCloseBtn">Fechar</button>
      <button class="save" id="catManageAddBtn">+ Nova Categoria</button>
    </div>
  </div>
</div>

<!-- Modal Orçamento -->
<div class="overlay" id="overlayBudget">
  <div class="modal">
    <button class="close-x" id="closeOrcModal">✕</button>
    <h2 id="orcModalTitle">Novo Orçamento</h2>
    <div class="field"><label>Categoria</label><select id="orcCategoria"></select></div>
    <div class="field"><label>Limite mensal (R$)</label><input id="orcLimite" type="number" step="0.01" placeholder="0,00"></div>
    <div class="modal-actions">
      <button id="orcCancelBtn">Cancelar</button>
      <button class="save" id="orcSaveBtn">Salvar Orçamento</button>
    </div>
  </div>
</div>

<!-- Modal Meta -->
<div class="overlay" id="overlayGoal">
  <div class="modal">
    <button class="close-x" id="closeGoalModal">✕</button>
    <h2 id="goalModalTitle">Nova Meta</h2>
    <div class="field"><label>Nome da meta</label><input id="goalName" placeholder="Ex: Reserva de Emergência"></div>
    <div class="field-row">
      <div class="field"><label>Valor Alvo (R$)</label><input id="goalTarget" type="number" step="0.01"></div>
      <div class="field"><label>Valor Atual (R$)</label><input id="goalCurrent" type="number" step="0.01"></div>
    </div>
    <div class="field"><label>Prazo</label><input id="goalDeadline" type="date"></div>
    <div class="modal-actions">
      <button id="goalCancelBtn">Cancelar</button>
      <button class="save" id="goalSaveBtn">Salvar Meta</button>
    </div>
  </div>
</div>

<!-- Modal Recorrente -->
<div class="overlay" id="overlayRecurring">
  <div class="modal">
    <button class="close-x" id="closeRecModal">✕</button>
    <h2 id="recModalTitle">Novo Lançamento Recorrente</h2>
    <div class="toggle-type">
      <button type="button" id="recTypeInBtn">↓ Receita</button>
      <button type="button" id="recTypeOutBtn">↑ Despesa</button>
    </div>
    <div class="field"><label>Descrição</label><input id="recDesc" placeholder="Ex: Internet"></div>
    <div class="field-row">
      <div class="field"><label>Valor (R$)</label><input id="recVal" type="number" step="0.01"></div>
      <div class="field"><label>Dia do mês</label><input id="recDay" type="number" min="1" max="31"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Categoria</label><select id="recCategoria"></select></div>
      <div class="field"><label>Conta</label><select id="recConta"></select></div>
    </div>
    <div class="field"><label>Frequência</label><select id="recFreq"><option>Mensal</option><option>Semanal</option><option>Anual</option></select></div>
    <div class="modal-actions">
      <button id="recCancelBtn">Cancelar</button>
      <button class="save" id="recSaveBtn">Salvar Recorrente</button>
    </div>
  </div>
</div>

<!-- Modal Alerta -->
<div class="overlay" id="overlayAlert">
  <div class="modal">
    <button class="close-x" id="closeAlertModal">✕</button>
    <h2 id="alertModalTitle">Novo Alerta</h2>
    <div class="field"><label>Categoria</label><select id="alertCategoria"></select></div>
    <div class="field"><label>Acionar ao atingir (%) do orçamento</label><input id="alertThreshold" type="number" min="1" max="200" value="90"></div>
    <div class="modal-actions">
      <button id="alertCancelBtn">Cancelar</button>
      <button class="save" id="alertSaveBtn">Salvar Alerta</button>
    </div>
  </div>
</div>

<!-- Modal Usuário (Admin) -->
<div class="overlay" id="overlayUserAdmin">
  <div class="modal">
    <button class="close-x" id="closeUserAdminModal">✕</button>
    <h2>Editar Usuário</h2>
    <div class="field"><label>Nome</label><input id="userAdminName"></div>
    <div class="field"><label>E-mail</label><input id="userAdminEmail" disabled style="opacity:0.6;"></div>
    <div class="field"><label>Perfil de acesso</label>
      <select id="userAdminRole"><option value="Usuário">Usuário</option><option value="Administrador">Administrador</option></select>
    </div>
    <div class="field">
      <label>Nova senha</label>
      <p class="cfg-hint" style="margin:-2px 0 8px;">Deixe em branco para manter a senha atual</p>
      <div class="pass-field">
        <input id="userAdminPassword" type="password" placeholder="••••••••">
        <button type="button" class="pass-toggle" id="userAdminPasswordToggle" tabindex="-1" aria-label="Mostrar senha"></button>
      </div>
    </div>
    <div class="modal-actions">
      <button id="userAdminCancelBtn">Cancelar</button>
      <button class="save" id="userAdminSaveBtn">Salvar Usuário</button>
    </div>
  </div>
</div>

<div class="toast" id="toast"><span class="d"></span><span id="toastMsg">Salvo com sucesso!</span></div>

<div class="login-success-overlay" id="loginSuccessOverlay">
  <div class="login-success-box">
    <div class="login-success-check">
      <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M14 27l7 7 17-17"/></svg>
    </div>
    <h3 id="loginSuccessTitle">Login efetuado com sucesso!</h3>
    <p id="loginSuccessMsg">Redirecionando para o seu painel...</p>
    <div class="login-success-progress-bar">
      <div class="login-success-progress-fill"></div>
    </div>
  </div>
</div>

<div class="login-success-overlay" id="accountDisabledOverlay">
  <div class="login-success-box">
    <div class="account-disabled-icon">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/></svg>
    </div>
    <h3>Usuário desativado</h3>
    <p id="accountDisabledMsg">Seu usuário foi desativado pelo administrador. Entre em contato para mais informações.</p>
    <button type="button" class="account-disabled-btn" id="accountDisabledCloseBtn">Entendi</button>
  </div>
</div>

<div class="login-success-overlay" id="logoutSuccessOverlay">
  <div class="login-success-box logout-box">
    <div class="logout-success-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
    </div>
    <h3>Sessão Encerrada</h3>
    <p id="logoutSuccessMsg">Você saiu da sua conta com segurança. Suas informações estão salvas e protegidas.</p>
    <button type="button" class="logout-btn-action" id="logoutSuccessCloseBtn" onclick="hideLogoutPopup()">Fazer Login Novamente →</button>
  </div>
</div>

<script>
/* ==================== Gerenciamento de LocalStorage e Servidor ==================== */
function loadFromStorage(key, defaultVal) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : defaultVal;
  } catch(e) {
    return defaultVal;
  }
}
function saveToStorage(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch(e) {
    console.warn('Aviso: Armazenamento local (localStorage) excedeu a cota máxima. Os dados são mantidos e salvos no PostgreSQL.', e);
  }
}

let registeredUsers = [];

async function syncUsersWithServer() {
  try {
    const res = await fetch(window.location.origin + '/api/users');
    if (res.ok) {
      registeredUsers = await res.json();
      saveToStorage('nexus_users', registeredUsers);
    }
  } catch(e) {
    registeredUsers = loadFromStorage('nexus_users', [
      { name: 'Paulo Lima', email: 'admin@nexusfinanceiro.com', password: '86266049', role: 'Administrador', active: true },
      { name: 'Paulo Lima', email: 'paulolp0101@gmail.com', password: '86266049', role: 'Administrador', active: true },
      { name: 'Usuário Padrão', email: 'user@nexusfinanceiro.com', password: '123456', role: 'Usuário', active: true }
    ]);
  }
}

async function saveUsersToServer() {
  saveToStorage('nexus_users', registeredUsers);
  try {
    await fetch(window.location.origin + '/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registeredUsers)
    });
  } catch(e){}
}

let currentUser = null;
let isViewingOtherUser = false;
let adminOriginalUser = null;

// Formulários de Login/Cadastro
document.getElementById('goRegister').onclick = () => {
  document.getElementById('loginBox').style.display = 'none';
  document.getElementById('forgotBox').style.display = 'none';
  document.getElementById('registerBox').style.display = 'block';
};
document.getElementById('goLogin').onclick = () => {
  document.getElementById('registerBox').style.display = 'none';
  document.getElementById('forgotBox').style.display = 'none';
  document.getElementById('loginBox').style.display = 'block';
};

// Esqueceu a senha - Enviar por E-mail
document.getElementById('goForgot').onclick = async (e) => {
  e.preventDefault();
  document.getElementById('loginBox').style.display = 'none';
  document.getElementById('registerBox').style.display = 'none';
  document.getElementById('forgotBox').style.display = 'block';
  document.getElementById('forgotStep1').reset();
  document.getElementById('forgotSub').textContent = 'Informe seu e-mail para enviarmos sua senha';
};

document.getElementById('goLoginFromForgot').onclick = () => {
  document.getElementById('forgotBox').style.display = 'none';
  document.getElementById('loginBox').style.display = 'block';
};

document.getElementById('forgotStep1').onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();
  const btn = document.getElementById('btnSendPassword');

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch(window.location.origin + '/api/send-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (!data.success) {
      alert(data.error || 'Não encontramos nenhuma conta com esse e-mail ou falha no envio.');
      return;
    }

    alert('Sua senha foi enviada para o seu e-mail com sucesso!');
    document.getElementById('loginEmail').value = email;
    document.getElementById('forgotBox').style.display = 'none';
    document.getElementById('loginBox').style.display = 'block';
  } catch(err) {
    alert('Erro ao processar solicitação de e-mail. Verifique suas credenciais SMTP no Render.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar Senha por E-mail';
  }
};

// Login
document.getElementById('loginForm').onsubmit = async (e) => {
  e.preventDefault();
  await syncUsersWithServer();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();

  const user = registeredUsers.find(u => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
  if (user) {
    if (user.active === false) {
      showAccountDisabledPopup('Seu usuário foi desativado pelo administrador. Entre em contato para mais informações.');
      return;
    }
    currentUser = user;
    saveToStorage('nexus_session', { email: user.email });
    saveToStorage('nexus_cached_user', user);
    saveToStorage('nexus_token', 'token_' + Date.now());
    document.documentElement.classList.add('user-logged-in');
    await loadUserData();
    if (user.role === 'Administrador' && !isViewingOtherUser) {
      currentPage = 'usuarios';
    } else {
      currentPage = 'dashboard';
    }
    showLoginSuccessPopup('Redirecionando para o seu dashboard...');
    setTimeout(() => {
      document.getElementById('authPage').classList.remove('show');
      document.getElementById('appMain').classList.add('show');
      render();
    }, 3000);
  } else {
    alert('E-mail ou senha incorretos!');
  }
};

function showLoginSuccessPopup(msg){
  const overlay = document.getElementById('loginSuccessOverlay');
  if(!overlay) return;
  if(msg) {
    const msgEl = document.getElementById('loginSuccessMsg');
    if(msgEl) msgEl.textContent = msg;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight; // Forçar reflow síncrono do browser
  overlay.classList.add('in');
  setTimeout(()=>{
    overlay.classList.remove('in');
    setTimeout(()=>{
      overlay.classList.remove('show');
      overlay.style.display = 'none';
    }, 350);
  }, 3000);
}

function showAccountDisabledPopup(msg){
  const overlay = document.getElementById('accountDisabledOverlay');
  if(msg) document.getElementById('accountDisabledMsg').textContent = msg;
  overlay.classList.add('show');
  requestAnimationFrame(()=> overlay.classList.add('in'));
}
function hideAccountDisabledPopup(){
  const overlay = document.getElementById('accountDisabledOverlay');
  overlay.classList.remove('in');
  setTimeout(()=> overlay.classList.remove('show'), 250);
}

let logoutTimer = null;
function showLogoutPopup(msg){
  const overlay = document.getElementById('logoutSuccessOverlay');
  if(!overlay) return;
  if(msg) document.getElementById('logoutSuccessMsg').textContent = msg;
  overlay.classList.add('show');
  requestAnimationFrame(()=> overlay.classList.add('in'));

  // Foco imediato no campo de email para permitir digitar sem travar
  setTimeout(() => {
    const loginEmailInput = document.getElementById('loginEmail');
    if (loginEmailInput) loginEmailInput.focus();
  }, 50);

  // Auto-dismiss em 1.8 segundos para NUNCA prender a tela do próximo login
  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    hideLogoutPopup();
  }, 1800);
}

function hideLogoutPopup(){
  const overlay = document.getElementById('logoutSuccessOverlay');
  if(!overlay) return;
  overlay.classList.remove('in');
  setTimeout(()=> {
    overlay.classList.remove('show');
  }, 250);
}

// Cadastro absoluto com requisição direta para o Render
document.getElementById('registerForm').onsubmit = async (e) => {
  e.preventDefault();
  await syncUsersWithServer();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value.trim();

  if (registeredUsers.some(u => u.email.toLowerCase() === email.toLowerCase())) {
    alert('Este e-mail já está cadastrado!');
    return;
  }

  const newUser = { name, email, password, role: 'Usuário', active: true };
  registeredUsers.push(newUser);

  try {
    const response = await fetch(window.location.origin + '/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registeredUsers)
    });
    
    if (!response.ok) {
      throw new Error('Falha ao comunicar com o servidor');
    }

    saveToStorage('nexus_users', registeredUsers);
    alert('Conta criada com sucesso! Faça login para continuar.');

    document.getElementById('regName').value = '';
    document.getElementById('regEmail').value = '';
    document.getElementById('regPassword').value = '';
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = password;
    document.getElementById('goLogin').click();
  } catch (err) {
    registeredUsers.pop();
    alert('Erro ao registrar no servidor. Verifique sua conexão e tente novamente.');
  }
};

// Logout
document.getElementById('logoutBtn').onclick = async () => {
  try { await saveUserData(); } catch(e){}
  resetUserDataState();
  currentUser = null;
  isViewingOtherUser = false;
  adminOriginalUser = null;
  isDataLoading = false;
  localStorage.removeItem('nexus_session');
  localStorage.removeItem('nexus_cached_user');
  localStorage.removeItem('nexus_token');
  localStorage.removeItem('nexus_viewing_user');
  document.documentElement.classList.remove('user-logged-in');
  document.documentElement.classList.remove('is-admin');
  const appMain = document.getElementById('appMain');
  const authPage = document.getElementById('authPage');
  if (appMain) {
    appMain.classList.remove('show');
    appMain.style.display = 'none';
  }
  if (authPage) {
    authPage.classList.add('show');
    authPage.style.display = 'flex';
  }
  showLogoutPopup('Você saiu da sua conta com segurança. Suas informações estão salvas e protegidas.');
};

/* ==================== Isolamento de Dados por Usuário ==================== */
let categories = [];
let accounts = [];
let transactions = [];
let budgets = [];
let goals = [];
let recurringList = [];
let alerts = [];
let attachments = [];
let notifications = [];

let nextAccId = 1, nextTxId = 1, nextBudgetId = 1, nextGoalId = 1, nextRecId = 1, nextAlertId = 1, nextAttId = 1, nextNotifId = 1;

/* ==================== Migração: tipo de categoria ==================== */
const RECEITA_NAME_HINTS = ['salário','salario','renda','freela','freelance','bônus','bonus','valor extra','extra','13º','decimo terceiro','décimo terceiro','rendimento','dividendo','investimento','reembolso'];
const BASE_CATEGORIES = [
  {name:'Alimentação', color:'#e8974b', type:'despesa', icon:'🍔'},
  {name:'Supermercado', color:'#d8a34b', type:'despesa', icon:'🛒'},
  {name:'Moradia', color:'#c98a3f', type:'despesa', icon:'🏠'},
  {name:'Contas da Casa', color:'#f0a63a', type:'despesa', icon:'💡'},
  {name:'Transporte', color:'#ef5a5a', type:'despesa', icon:'🚗'},
  {name:'Saúde', color:'#5ac57e', type:'despesa', icon:'⚕️'},
  {name:'Educação', color:'#4a90e2', type:'despesa', icon:'📚'},
  {name:'Lazer', color:'#9b6bd8', type:'despesa', icon:'🎮'},
  {name:'Vestuário', color:'#d85bb0', type:'despesa', icon:'👕'},
  {name:'Assinaturas', color:'#6b7fd7', type:'despesa', icon:'📺'},
  {name:'Cartão de Crédito', color:'#e8b04b', type:'despesa', icon:'💳'},
  {name:'Pix Enviado', color:'#f0a63a', type:'despesa', icon:'📤'},
  {name:'Cuidados Pessoais', color:'#e07bb0', type:'despesa', icon:'💆'},
  {name:'Outros', color:'#8a93a3', type:'despesa', icon:'📦'},
  {name:'Salário', color:'#e8b04b', type:'receita', icon:'💼'},
  {name:'Freelance', color:'#4a90e2', type:'receita', icon:'💻'},
  {name:'Investimentos', color:'#5ac57e', type:'receita', icon:'📈'},
  {name:'Pix Recebido', color:'#3ec7c7', type:'receita', icon:'📥'},
  {name:'Reembolso', color:'#6bcf9e', type:'receita', icon:'💵'},
  {name:'Bônus / 13º', color:'#d8a34b', type:'receita', icon:'🎉'},
  {name:'Outras Receitas', color:'#8a93a3', type:'receita', icon:'💰'}
];

const DEFAULT_ACCOUNTS = [
  { id: 1, name: 'AMAZON', type: 'Cartão de Crédito', balance: '2000.00', limit: '2000.00', color: '#ff9900', isCard: true, isCreditCard: true },
  { id: 2, name: 'DIGIO', type: 'Cartão de Crédito', balance: '4100.00', limit: '4100.00', color: '#1b2d4f', isCard: true, isCreditCard: true },
  { id: 3, name: 'Nubank', type: 'Cartão de Crédito', balance: '2100.00', limit: '2100.00', color: '#820ad1', isCard: true, isCreditCard: true },
  { id: 4, name: 'Dinheiro em Espécie', type: 'Conta Corrente', balance: '3335.00', limit: '0', color: '#10b981', isCard: false, isCreditCard: false }
];

const DEFAULT_TRANSACTIONS = [
  { id: 1, desc: 'Salário', val: 3335.00, date: '2026-08-30', cat: 'Salário', status: 'Pendente', type: 'in', acc: 'Dinheiro em Espécie', accId: 4 },
  { id: 2, desc: 'Nubank', val: 1149.14, date: '2026-08-30', cat: 'Cartão de Crédito', status: 'Pendente', type: 'out', acc: 'Nubank', accId: 3 },
  { id: 3, desc: 'Digio', val: 1024.54, date: '2026-08-30', cat: 'Cartão de Crédito', status: 'Pendente', type: 'out', acc: 'DIGIO', accId: 2 },
  { id: 4, desc: 'Cartão Mãe', val: 300.00, date: '2026-08-30', cat: 'Boleto', status: 'Pendente', type: 'out', acc: 'Boleto / Pix / Outros', accId: null },
  { id: 5, desc: 'Internet', val: 65.00, date: '2026-08-30', cat: 'Boleto', status: 'Pendente', type: 'out', acc: 'Boleto / Pix / Outros', accId: null },
  { id: 6, desc: 'Digio', val: 141.64, date: '2026-09-13', cat: 'Cartão de Crédito', status: 'Pendente', type: 'out', acc: 'DIGIO', accId: 2 },
  { id: 7, desc: 'Digio', val: 141.64, date: '2026-10-30', cat: 'Cartão de Crédito', status: 'Pendente', type: 'out', acc: 'DIGIO', accId: 2 }
];

function isCurrentAdmin() {
  if (!currentUser) return false;
  if (currentUser.role === 'Administrador') return true;
  const e = (currentUser.email || '').toLowerCase().trim();
  return e.includes('admin') || e.includes('paulolp0101') || e.includes('paulodelima');
}

function resetUserDataState() {
  categories = BASE_CATEGORIES.map(c => ({ ...c, count: 0 }));
  if (isCurrentAdmin()) {
    accounts = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
    transactions = JSON.parse(JSON.stringify(DEFAULT_TRANSACTIONS));
    nextAccId = 10;
    nextTxId = 10;
  } else {
    accounts = [];
    transactions = [];
    nextAccId = 1;
    nextTxId = 1;
  }
  budgets = [];
  goals = [];
  recurringList = [];
  alerts = [];
  attachments = [];
  notifications = [];
  nextBudgetId = 1;
  nextGoalId = 1;
  nextRecId = 1;
  nextAlertId = 1;
  nextAttId = 1;
  nextNotifId = 1;
}

function migrateCategories(){
  let changed = false;
  categories.forEach(c=>{
    if(!c.type){
      const lower = c.name.toLowerCase();
      c.type = RECEITA_NAME_HINTS.some(h=>lower.includes(h)) ? 'receita' : 'despesa';
      changed = true;
    }
    if(!c.icon){
      c.icon = c.type==='receita' ? '💰' : '📁';
      changed = true;
    }
    if(typeof c.count !== 'number'){
      c.count = 0;
      changed = true;
    }
  });
  BASE_CATEGORIES.forEach(dc=>{
    if(!categories.some(c=>c.name.toLowerCase()===dc.name.toLowerCase())){
      categories.push({...dc, count:0});
      changed = true;
    }
  });
  if(changed) saveUserData();
}

function parseInputValue(valStr) {
  if (typeof valStr === 'number') return isNaN(valStr) ? 0 : Math.abs(valStr);
  if (!valStr) return 0;
  let cleaned = String(valStr).replace(/[^0-9.,-]/g, '').trim();
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const num = Math.abs(parseFloat(cleaned));
  return isNaN(num) ? 0 : num;
}

function autoMigrateTransactionsAndAccounts() {
  if (!accounts || accounts.length === 0) return;
  let changed = false;

  transactions.forEach(t => {
    // 0. Garante que t.val é um número float válido positivo
    const parsedVal = parseInputValue(t.val);
    if (t.val !== parsedVal) {
      t.val = parsedVal;
      changed = true;
    }

    // 1. Se t.accId aponta para um ID de conta que não existe mais, reseta para relinkar
    if (t.accId != null && !accounts.some(a => String(a.id) === String(t.accId))) {
      t.accId = null;
      changed = true;
    }

    // 2. Se a transação possui t.acc que corresponde ao nome exato de uma conta, vincula ao ID exato dessa conta
    if (t.acc) {
      const exactMatch = accounts.find(a => a.name.toLowerCase().trim() === String(t.acc).toLowerCase().trim());
      if (exactMatch && (String(t.accId) !== String(exactMatch.id) || t.acc !== exactMatch.name)) {
        t.accId = exactMatch.id;
        t.acc = exactMatch.name;
        changed = true;
      }
    }

    // 3. Se t.desc, t.cat ou t.card menciona o nome de um cartão específico, vincula ao ID desse cartão
    const descText = ((t.desc || '') + ' ' + (t.cat || '') + ' ' + (t.acc || '') + ' ' + (t.card || '')).toLowerCase().trim();
    if (descText) {
      const cardMatch = accounts.find(a => {
        if (!isAccountCreditCard(a)) return false;
        const aName = a.name.toLowerCase().trim();
        const normName = normalizeAccName(a.name);
        return (normName.length >= 3 && descText.includes(normName)) || (aName.length >= 3 && descText.includes(aName));
      });
      if (cardMatch && (String(t.accId) !== String(cardMatch.id) || (t.acc === 'Cartão de Crédito' || !t.acc))) {
        t.accId = cardMatch.id;
        t.acc = cardMatch.name;
        changed = true;
      }
    }

    // 4. Se a transação não tem accId válido, encontra a conta correspondente via isTxForAccount
    if (t.accId == null) {
      const match = accounts.find(a => isTxForAccount(t, a));
      if (match) {
        t.accId = match.id;
        t.acc = match.name;
        changed = true;
      }
    }
  });

  // 5. Atualiza ícones genéricos (📁) das categorias para ícones semânticos profissionais
  if (Array.isArray(categories)) {
    categories.forEach(c => {
      if (!c.icon || c.icon === '📁') {
        const smartIcon = getCategoryIcon(c.name);
        if (smartIcon !== '📁') {
          c.icon = smartIcon;
          changed = true;
        }
      }
    });
  }

  if (changed && typeof saveUserData === 'function') {
    saveUserData();
  }
}

function applyDataPayload(data) {
  resetUserDataState();
  if (!data || typeof data !== 'object') return;
  
  if (Array.isArray(data.categories) && data.categories.length > 0) {
    categories = data.categories;
  }
  if (Array.isArray(data.accounts)) {
    accounts = data.accounts;
  }
  if (Array.isArray(data.transactions)) {
    transactions = data.transactions;
  }
  if (Array.isArray(data.budgets)) budgets = data.budgets;
  if (Array.isArray(data.goals)) goals = data.goals;
  if (Array.isArray(data.recurringList)) recurringList = data.recurringList;
  if (Array.isArray(data.alerts)) alerts = data.alerts;
  if (Array.isArray(data.attachments)) attachments = data.attachments;
  if (Array.isArray(data.notifications)) notifications = data.notifications;

  if (data.nextAccId) nextAccId = Math.max(nextAccId, data.nextAccId);
  if (data.nextTxId) nextTxId = Math.max(nextTxId, data.nextTxId);
  if (data.nextBudgetId) nextBudgetId = Math.max(nextBudgetId, data.nextBudgetId);
  if (data.nextGoalId) nextGoalId = Math.max(nextGoalId, data.nextGoalId);
  if (data.nextRecId) nextRecId = Math.max(nextRecId, data.nextRecId);
  if (data.nextAlertId) nextAlertId = Math.max(nextAlertId, data.nextAlertId);
  if (data.nextAttId) nextAttId = Math.max(nextAttId, data.nextAttId);
  if (data.nextNotifId) nextNotifId = Math.max(nextNotifId, data.nextNotifId);

  migrateCategories();
  autoMigrateTransactionsAndAccounts();
}

let isDataLoading = false;

async function loadUserData() {
  if (!currentUser) {
    resetUserDataState();
    isDataLoading = false;
    return;
  }
  if (isDataLoading) return;
  const cleanEmail = (currentUser.email || '').toLowerCase().trim();
  const userKey = 'nexus_data_' + cleanEmail;
  
  // 1. Reset state e carrega dados do cache local do próprio usuário se existir
  let localData = loadFromStorage(userKey, null);
  if (localData) {
    applyDataPayload(localData);
    isDataLoading = false;
  } else {
    // Novos usuários ou cadastros récem-criados iniciam com seu próprio espaço limpo e isolado
    resetUserDataState();
    saveUserData();
    isDataLoading = false;
  }

  // 2. Sincroniza em segundo plano com o servidor PostgreSQL / API especificamente para este e-mail
  try {
    const res = await fetch(window.location.origin + '/api/data?email=' + encodeURIComponent(cleanEmail));
    if (res.ok) {
      const serverData = await res.json();
      if (serverData && typeof serverData === 'object' && Object.keys(serverData).length > 0) {
        applyDataPayload(serverData);
        saveToStorage(userKey, serverData);
      }
    }
  } catch(e) {
    console.warn('Aviso de conexão com o banco de dados:', e);
  } finally {
    isDataLoading = false;
  }
  if (typeof render === 'function' && document.getElementById('appMain') && document.getElementById('appMain').classList.contains('show')) {
    render();
  }
}

// Sincronização Automática entre Dispositivos ao alternar ou focar no app
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser && !isViewingOtherUser) {
      loadUserData();
    }
  });
  window.addEventListener('focus', () => {
    if (currentUser && !isViewingOtherUser) {
      loadUserData();
    }
  });
}

async function saveUserData() {
  if (!currentUser) return;
  if (isViewingOtherUser) return;
  if (isDataLoading) return;

  const cleanEmail = (currentUser.email || '').toLowerCase().trim();
  const userKey = 'nexus_data_' + cleanEmail;

  const payloadData = {
    categories, accounts, transactions, budgets, goals, recurringList, alerts, attachments, notifications,
    nextAccId, nextTxId, nextBudgetId, nextGoalId, nextRecId, nextAlertId, nextAttId, nextNotifId
  };
  
  saveToStorage(userKey, payloadData);

  try {
    await fetch(window.location.origin + '/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUser.email, data: payloadData })
    });
  } catch(e) {}
}

/* ==================== Admin: Visualizar dados de outro usuário ==================== */
async function viewUserData(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const target = registeredUsers.find(u => u.email.toLowerCase() === (email||'').toLowerCase());
  if(!target || target.email.toLowerCase() === currentUser.email.toLowerCase()) return;

  if(!isViewingOtherUser){
    await saveUserData();
    adminOriginalUser = currentUser;
  }
  currentUser = target;
  isViewingOtherUser = true;
  saveToStorage('nexus_viewing_user', target.email);
  await loadUserData();
  currentPage = 'dashboard';
  render();
  showToast('Visualizando dados de ' + target.name);
}

async function exitViewMode(){
  if(!isViewingOtherUser || !adminOriginalUser) return;
  currentUser = adminOriginalUser;
  adminOriginalUser = null;
  isViewingOtherUser = false;
  localStorage.removeItem('nexus_viewing_user');
  localStorage.setItem('nexus_current_page', 'usuarios');
  try {
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, null, '#usuarios');
    } else {
      window.location.hash = 'usuarios';
    }
  } catch(e){}
  saveToStorage('nexus_session', { email: currentUser.email });
  saveToStorage('nexus_cached_user', currentUser);
  await loadUserData();
  currentPage = 'usuarios';
  render();
  showToast('Você voltou para sua conta de Administrador.');
}

/* ==================== Admin: Ativar/Desativar usuário ==================== */
async function toggleUserActive(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const u = registeredUsers.find(x => x.email === email);
  if(!u || u.email === currentUser.email) return;

  const willDeactivate = u.active !== false;
  if(willDeactivate && u.role === 'Administrador' && registeredUsers.filter(x=>x.role==='Administrador' && x.active!==false).length <= 1){
    showToast('É necessário manter ao menos um administrador ativo');
    return;
  }

  u.active = willDeactivate ? false : true;
  await saveUsersToServer();
  showToast(willDeactivate ? 'Usuário desativado.' : 'Usuário ativado novamente.');
  logActivity('Edição', 'Usuário', 'Administrador ' + (willDeactivate ? 'desativou' : 'ativou') + ' o acesso do usuário ' + u.email + ' (' + u.name + ')');
  render();
}

/* ==================== Período ==================== */
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const YEARS = [2024,2025,2026,2027,2028,2029,2030];
const PERIOD_MIN = {year:2024, month:1};
const PERIOD_MAX = {year:2030, month:12};
const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function bindPasswordToggle(inputId, btnId){
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if(!inp || !btn) return;
  btn.innerHTML = EYE_ICON;
  btn.onclick = ()=>{
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  };
}
function getDefaultPeriod(){
  try {
    const saved = localStorage.getItem('fin_current_period');
    if (saved) {
      const p = JSON.parse(saved);
      if (p && typeof p.year === 'number' && typeof p.month === 'number') {
        if (p.year >= PERIOD_MIN.year && p.year <= PERIOD_MAX.year && p.month >= 1 && p.month <= 12) {
          return { year: p.year, month: p.month };
        }
      }
    }
  } catch(e) {}
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth()+1;
  if(y < PERIOD_MIN.year || (y===PERIOD_MIN.year && m < PERIOD_MIN.month)) return {year:PERIOD_MIN.year, month:PERIOD_MIN.month};
  if(y > PERIOD_MAX.year || (y===PERIOD_MAX.year && m > PERIOD_MAX.month)) return {year:PERIOD_MAX.year, month:PERIOD_MAX.month};
  return {year:y, month:m};
}
let currentPeriod = getDefaultPeriod();

function pdCustom(y,m,day){
  const lastDay = new Date(y, m, 0).getDate();
  const d = String(Math.min(day, lastDay)).padStart(2,'0');
  return y + '-' + String(m).padStart(2,'0') + '-' + d;
}
function pd(day){ return pdCustom(currentPeriod.year, currentPeriod.month, day); }

let editingId=null, editingAccId=null, editingCatName=null, editingBudgetId=null, editingGoalId=null, editingRecId=null, editingAlertId=null, editingUserEmail=null;
let catManageType = 'despesa';
let currentType='out', currentRecType='out';
let currentPage = (function getInitialPage() {
  try {
    const validPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'funcoes', 'usuarios', 'logs', 'config'];
    const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
    const savedPage = localStorage.getItem('nexus_current_page');
    if (hashPage && validPages.includes(hashPage)) return hashPage;
    if (savedPage && validPages.includes(savedPage)) return savedPage;
  } catch(e){}
  return 'dashboard';
})();
let charts = {};

function getCategoryIcon(name) {
  if (!name) return '🏷️';
  const c = Array.isArray(categories) ? categories.find(cat => cat.name && cat.name.toLowerCase().trim() === String(name).toLowerCase().trim()) : null;
  if (c && c.icon && c.icon !== '📁') return c.icon;
  
  const n = String(name).toLowerCase().trim();
  if (n.includes('cartão') || n.includes('cartao') || n.includes('crédito') || n.includes('credito')) return '💳';
  if (n.includes('boleto') || n.includes('fatura') || n.includes('carnê') || n.includes('carne') || n.includes('conta')) return '📄';
  if (n.includes('salário') || n.includes('salario') || n.includes('pagamento') || n.includes('pró-labore') || n.includes('pro-labore') || n.includes('renda')) return '💰';
  if (n.includes('alimentação') || n.includes('alimentacao') || n.includes('restaurante') || n.includes('lanche') || n.includes('ifood') || n.includes('refeição') || n.includes('comida')) return '🍔';
  if (n.includes('mercado') || n.includes('supermercado') || n.includes('compras') || n.includes('feira') || n.includes('açougue') || n.includes('padaria')) return '🛒';
  if (n.includes('moradia') || n.includes('casa') || n.includes('aluguel') || n.includes('condomínio') || n.includes('condominio')) return '🏠';
  if (n.includes('transporte') || n.includes('combustível') || n.includes('combustivel') || n.includes('gasolina') || n.includes('uber') || n.includes('carro') || n.includes('estacionamento')) return '🚗';
  if (n.includes('saúde') || n.includes('saude') || n.includes('farmácia') || n.includes('farmacia') || n.includes('médico') || n.includes('medico') || n.includes('hospital') || n.includes('dentista') || n.includes('exame')) return '💊';
  if (n.includes('educação') || n.includes('educacao') || n.includes('curso') || n.includes('faculdade') || n.includes('livro') || n.includes('escola') || n.includes('mensalidade')) return '📚';
  if (n.includes('lazer') || n.includes('viagem') || n.includes('festa') || n.includes('passeio') || n.includes('cinema') || n.includes('show') || n.includes('hotel')) return '🎉';
  if (n.includes('internet') || n.includes('telefone') || n.includes('celular') || n.includes('fibra') || n.includes('plano')) return '📶';
  if (n.includes('luz') || n.includes('energia') || n.includes('elétrica') || n.includes('eletrica') || n.includes('cemig') || n.includes('enel')) return '💡';
  if (n.includes('água') || n.includes('agua') || n.includes('saneamento') || n.includes('copasa') || n.includes('sabesp')) return '💧';
  if (n.includes('investimento') || n.includes('poupança') || n.includes('poupanca') || n.includes('ações') || n.includes('acoes') || n.includes('rendimento') || n.includes('cdb') || n.includes('cripto')) return '📈';
  if (n.includes('streaming') || n.includes('netflix') || n.includes('spotify') || n.includes('assinatura') || n.includes('tv') || n.includes('amazon prime') || n.includes('disney')) return '🎬';
  if (n.includes('vestuário') || n.includes('vestuario') || n.includes('roupa') || n.includes('calçado') || n.includes('calcado') || n.includes('moda') || n.includes('tênis')) return '👕';
  if (n.includes('pet') || n.includes('animal') || n.includes('veterinário') || n.includes('veterinario') || n.includes('ração') || n.includes('racao') || n.includes('gato') || n.includes('cachorro')) return '🐾';
  if (n.includes('imposto') || n.includes('tributo') || n.includes('taxa') || n.includes('iptu') || n.includes('ipva') || n.includes('irpf') || n.includes('darf')) return '🏛️';
  if (n.includes('presente') || n.includes('doação') || n.includes('doacao') || n.includes('aniversário') || n.includes('natal')) return '🎁';
  if (n.includes('serviço') || n.includes('servico') || n.includes('manutenção') || n.includes('manutencao') || n.includes('reforma') || n.includes('obra')) return '🔧';
  
  return '🏷️';
}

const fmt = v => 'R$ ' + (v||0).toLocaleString('pt-BR',{minimumFractionDigits:2, maximumFractionDigits:2});
const catColor = name => (categories.find(c=>c.name===name)||{}).color || '#888';
const catIcon = name => getCategoryIcon(name);

function catOptionsHTML(type, selected){
  let list = type ? categories.filter(c=>(c.type||'despesa')===type) : categories.slice();
  list = list.slice().sort((a,b)=> (b.count||0)-(a.count||0) || a.name.localeCompare(b.name,'pt-BR'));
  return list.map(c=>'<option value="'+c.name+'"'+(selected===c.name?' selected':'')+'>'+catIcon(c.name)+' '+c.name+'</option>').join('');
}
const periodLabel = () => currentPeriod.month === 0 ? 'Todas as Datas (Geral)' : ((MONTHS[currentPeriod.month-1] || 'Mês ' + currentPeriod.month) + ' / ' + currentPeriod.year);

function formatDateBR(dateVal) {
  if (!dateVal) return '—';
  try {
    const str = String(dateVal).trim();
    if (str.includes('T')) {
      const parts = str.split('T')[0].split('-');
      if (parts.length === 3) return parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    const parts = str.split('-');
    if (parts.length === 3) {
      return parts[2].padStart(2,'0') + '/' + parts[1].padStart(2,'0') + '/' + parts[0];
    }
    const d = new Date(dateVal);
    if (!isNaN(d.getTime())) return d.toLocaleDateString('pt-BR');
  } catch(e){}
  return String(dateVal);
}

const inPeriod = t => {
  if (!t || !t.date) return false;
  if (currentPeriod.month === 0) return true;
  
  const dParts = String(t.date).split('T')[0].split('-');
  if (dParts.length === 3) {
    const y = parseInt(dParts[0]);
    const m = parseInt(dParts[1]);
    return m === currentPeriod.month && y === currentPeriod.year;
  }
  const d = new Date(t.date);
  return (d.getMonth() + 1) === currentPeriod.month && d.getFullYear() === currentPeriod.year;
};

/* ==================== Cálculos de Cartões e Limites ==================== */
function isAccountCreditCard(account) {
  if (!account) return false;

  const accTypeLower = (account.type || '').toLowerCase().trim();
  const accNameLower = (account.name || '').toLowerCase().trim();

  // 0. Se contiver explicitamente débito/debito ou conta bancária, NUNCA é cartão de crédito
  if (
    accTypeLower.includes('débito') ||
    accTypeLower.includes('debito') ||
    accNameLower.includes('débito') ||
    accNameLower.includes('debito')
  ) {
    return false;
  }

  if (account.isCreditCard === true || account.isCard === true) return true;

  // 1. Se o tipo for de conta bancária de dinheiro/saldo corrente/investimento/pix, NUNCA é cartão de crédito
  const isExplicitBankOrCash = (
    accTypeLower.includes('corrente') ||
    accTypeLower.includes('poupança') ||
    accTypeLower.includes('poupanca') ||
    accTypeLower.includes('investimento') || 
    accTypeLower.includes('dinheiro') || 
    accTypeLower.includes('caixa') || 
    accTypeLower.includes('carteira') ||
    accTypeLower.includes('pix')
  );

  if (isExplicitBankOrCash) {
    return false;
  }

  // 2. Se o tipo contiver explicitamente Crédito / Fatura / Card
  if (
    accTypeLower.includes('crédito') ||
    accTypeLower.includes('credito') ||
    accTypeLower.includes('fatura') ||
    accTypeLower.includes('card')
  ) {
    return true;
  }

  // 3. Se o tipo não for especificado ou for 'Outros', verifica termos de cartão de crédito no nome
  const creditKeywords = [
    'crédito', 'credito', 'fatura', 'credicard', 'amex', 'hipercard',
    'mastercard', 'visa', 'roxinho', 'trigg', 'digio', 'bradescard', 'itaucard', 'ourocard'
  ];
  if (creditKeywords.some(k => accNameLower.includes(k))) {
    return true;
  }

  return false;
}

function normalizeAccName(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/cartão de crédito|cartao de credito|cartão de débito|cartao de debito|cartão|cartao|conta corrente|conta poupança|conta poupanca|conta|banco|crédito|credito|débito|debito/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .trim();
}

function isTxForAccount(t, account) {
  if (!t || !account) return false;

  const accNameLower = (account.name || '').toLowerCase().trim();
  const tAccLower = (t.acc || '').toLowerCase().trim();
  const tCardLower = (t.card || '').toLowerCase().trim();
  const descLower = (t.desc || '').toLowerCase().trim();
  const catLower = (t.cat || '').toLowerCase().trim();

  // 1. Prioridade Máxima: Se accId for especificado e coincidir com o ID da conta
  if (t.accId != null && account.id != null && String(t.accId) === String(account.id)) {
    return true;
  }

  // 2. Correspondência exata do nome da conta ou do cartão
  if (accNameLower && (tAccLower === accNameLower || tCardLower === accNameLower)) return true;

  // 3. Substring direta entre nomes (ex: "Digio" em "Cartão Digio" ou "Digio Crédito")
  if (accNameLower && tAccLower && (tAccLower.includes(accNameLower) || accNameLower.includes(tAccLower))) return true;
  if (accNameLower && tCardLower && (tCardLower.includes(accNameLower) || accNameLower.includes(tCardLower))) return true;

  // 4. Correspondência normalizada (removendo "cartão", "crédito", etc.)
  const normAccName = normalizeAccName(account.name);
  const normTAcc = normalizeAccName(t.acc);
  const normTCard = normalizeAccName(t.card);

  if (normAccName.length >= 2) {
    if (normTAcc === normAccName || normTCard === normAccName) return true;
    if (normTAcc && (normTAcc.includes(normAccName) || normAccName.includes(normTAcc))) return true;
    if (normTCard && (normTCard.includes(normAccName) || normAccName.includes(normTCard))) return true;
  }

  // 5. Se a descrição ou categoria contiver o nome da conta (ex: "Digio" em descrição ou categoria)
  if (normAccName.length >= 3 && (descLower.includes(normAccName) || catLower.includes(normAccName))) {
    return true;
  }
  if (accNameLower.length >= 3 && (descLower.includes(accNameLower) || catLower.includes(accNameLower))) {
    return true;
  }

  // 6. Transações com "Cartão de Crédito" genérico
  if (isAccountCreditCard(account)) {
    const allCreditCards = accounts.filter(a => isAccountCreditCard(a));
    if (tAccLower === 'cartão de crédito' || tAccLower === 'cartao de credito' || tAccLower === 'cartão' || tAccLower === 'cartao') {
      const specificMatch = allCreditCards.find(a => {
        const aNameLower = (a.name || '').toLowerCase().trim();
        const normName = normalizeAccName(a.name);
        return (normName.length >= 3 && descLower.includes(normName)) || (aNameLower.length >= 3 && descLower.includes(aNameLower));
      });
      if (specificMatch) {
        return String(specificMatch.id) === String(account.id);
      }
      if (allCreditCards.length === 1 && String(allCreditCards[0].id) === String(account.id)) return true;
    }
  }

  return false;
}

function isPgtoFaturaOrEstorno(t) {
  if (!t || t.type !== 'in') return false;
  const catLower = (t.cat || '').toLowerCase().trim();
  const descLower = (t.desc || '').toLowerCase().trim();
  
  if (catLower.includes('fatura') || catLower.includes('estorno') || catLower.includes('reembolso')) return true;
  if (descLower.includes('fatura') || descLower.includes('estorno') || descLower.includes('reembolso') || descLower.includes('pgto cartão') || descLower.includes('pgto cartao') || descLower.includes('pagamento de cartão') || descLower.includes('pagamento cartao')) return true;
  
  if (
    catLower.includes('salário') || catLower.includes('salario') || 
    catLower.includes('rendimento') || catLower.includes('investimento') || 
    catLower.includes('freelance') || catLower.includes('venda') || 
    catLower.includes('pró-labore') || catLower.includes('pro-labore') ||
    catLower.includes('bônus') || catLower.includes('bonus') ||
    catLower.includes('comissão') || catLower.includes('comissao')
  ) {
    return false;
  }
  
  if (catLower.includes('cartão') || catLower.includes('cartao') || catLower.includes('crédito') || catLower.includes('credito')) {
    return true;
  }
  
  return true;
}

function getCardStats(account) {
  if (!account) return { spentPeriod: 0, spentTotal: 0, totalLimit: 0, availableLimit: 0, usagePct: 0, currentBalance: 0, initialBalance: 0, isCreditCard: false, txCount: 0, periodIn: 0, periodOut: 0 };
  
  const isCreditCard = isAccountCreditCard(account);
  const cardTx = transactions.filter(t => isTxForAccount(t, account));

  const totalDespesas = cardTx.filter(t => t.type === 'out').reduce((s, t) => s + parseInputValue(t.val), 0);
  const totalPagamentos = cardTx.filter(t => t.type === 'in').reduce((s, t) => s + parseInputValue(t.val), 0);
  
  const periodCardTx = cardTx.filter(inPeriod);
  const periodDespesas = periodCardTx.filter(t => t.type === 'out').reduce((s, t) => s + parseInputValue(t.val), 0);
  const periodPagamentos = periodCardTx.filter(t => t.type === 'in').reduce((s, t) => s + parseInputValue(t.val), 0);

  const initialBalance = parseInputValue(account.balance) || parseInputValue(account.limit) || parseInputValue(account.initialBalance) || 0;

  if (isCreditCard) {
    // Para Cartões de Crédito: initialBalance representa o Limite Total Aprovado
    const totalLimit = Math.max(0, initialBalance);
    const spentTotal = Math.max(0, totalDespesas - totalPagamentos);
    const spentPeriod = Math.max(0, periodDespesas - periodPagamentos);
    const availableLimit = totalLimit - spentTotal;
    const usagePct = totalLimit > 0 ? Math.min(100, Math.max(0, Math.round((spentTotal / totalLimit) * 100))) : (spentTotal > 0 ? 100 : 0);
    const currentBalance = availableLimit;

    return {
      spentPeriod,
      spentTotal,
      totalLimit,
      availableLimit,
      usagePct,
      currentBalance,
      initialBalance,
      isCreditCard: true,
      txCount: cardTx.length,
      periodIn: periodPagamentos,
      periodOut: periodDespesas
    };
  } else {
    // Para Contas Bancárias (Conta Corrente, Poupança, Investimentos, etc.)
    const spentTotal = totalDespesas;
    const spentPeriod = periodDespesas;
    const currentBalance = initialBalance + totalPagamentos - totalDespesas;
    const availableLimit = currentBalance;
    const totalLimit = initialBalance;
    const usagePct = 0;

    return {
      spentPeriod,
      spentTotal,
      totalLimit,
      availableLimit,
      usagePct,
      currentBalance,
      initialBalance,
      isCreditCard: false,
      txCount: cardTx.length,
      periodIn: periodPagamentos,
      periodOut: periodDespesas
    };
  }
}

function computeCardSummary() {
  const creditCards = accounts.filter(a => isAccountCreditCard(a));

  let totalLimitGeral = 0;
  let spentTotalGeral = 0;
  let spentPeriodGeral = 0;
  let availableLimitGeral = 0;
  
  creditCards.forEach(card => {
    const stats = getCardStats(card);
    totalLimitGeral += stats.totalLimit;
    spentTotalGeral += stats.spentTotal;
    spentPeriodGeral += stats.spentPeriod;
    availableLimitGeral += stats.availableLimit;
  });
  
  const usagePctGeral = totalLimitGeral > 0 ? Math.min(100, Math.round((spentTotalGeral / totalLimitGeral) * 100)) : 0;
  return { creditCards, totalLimitGeral, spentTotalGeral, spentPeriodGeral, availableLimitGeral, usagePctGeral };
}

/* ==================== Cálculos ==================== */
function computeTotals(list=transactions){
  const receitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val),0);
  const despesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
  
  let saldoContasBancarias = 0;
  let faturasCartoesCredito = 0;

  accounts.forEach(a => {
    const stats = getCardStats(a);
    if (stats.isCreditCard) {
      faturasCartoesCredito += stats.spentTotal;
    } else {
      saldoContasBancarias += stats.currentBalance;
    }
  });

  const saldo = saldoContasBancarias - faturasCartoesCredito;
  return { receitas, despesas, saldo, saldoContasBancarias, faturasCartoesCredito };
}
function txStatsCardsHTML(list){
  const receitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val),0);
  const despesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
  const saldo = receitas - despesas;
  const saldoColor = saldo < 0 ? 'var(--red)' : 'var(--green)';
  let html = '';
  html += '<div class="kpi"><div class="row1">Receitas <span class="ic" style="background:var(--green-soft);color:var(--green)">↑</span></div><div class="val">' + fmt(receitas) + '</div><div class="sub">no filtro atual</div></div>';
  html += '<div class="kpi"><div class="row1">Despesas <span class="ic" style="background:var(--red-soft);color:var(--red)">↓</span></div><div class="val">' + fmt(despesas) + '</div><div class="sub">no filtro atual</div></div>';
  html += '<div class="kpi"><div class="row1">Saldo <span class="ic" style="background:rgba(74,144,226,.14);color:var(--blue)">⇄</span></div><div class="val" style="color:' + saldoColor + '">' + fmt(saldo) + '</div><div class="sub" style="color:' + saldoColor + '">receitas − despesas</div></div>';
  html += '<div class="kpi"><div class="row1">Transações <span class="ic" style="background:rgba(155,107,216,.14);color:var(--purple)">☰</span></div><div class="val">' + list.length + '</div><div class="sub">registros no filtro</div></div>';
  return html;
}
function despesasPorCategoria(list=transactions){
  const map = {};
  list.filter(t=>t.type==='out').forEach(t=>{ 
    const v = parseInputValue(t.val);
    map[t.cat]=(map[t.cat]||0)+v; 
  });
  return Object.entries(map).map(([name,val])=>({name,val,color:catColor(name)})).sort((a,b)=>b.val-a.val);
}
function budgetStatus(list=budgets){
  const periodTx = transactions.filter(inPeriod);
  return list.map(b=>{
    const spent = periodTx.filter(t=>t.cat===b.category && t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
    const pct = b.limit>0 ? Math.round(spent/b.limit*100) : 0;
    return {...b, spent, pct};
  });
}

let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  const msgEl = document.getElementById('toastMsg');
  if(msgEl) msgEl.textContent = msg;

  const isDanger = /remov|exclu|erro|inválid|atençã|⚠️|🗑/i.test(msg);
  if(isDanger) {
    t.classList.add('toast-danger');
  } else {
    t.classList.remove('toast-danger');
  }

  t.classList.add('show');
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove('show');
  }, 3200);
}

function timeAgo(ts){
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff/60000);
  if(min < 1) return 'agora mesmo';
  if(min < 60) return 'há ' + min + ' min';
  const hr = Math.floor(min/60);
  if(hr < 24) return 'há ' + hr + 'h';
  const day = Math.floor(hr/24);
  if(day < 7) return 'há ' + day + 'd';
  return new Date(ts).toLocaleDateString('pt-BR');
}
async function pushNotification(text, icon){
  notifications.unshift({id: nextNotifId++, text, icon: icon || '🔔', time: Date.now(), read:false});
  if(notifications.length > 40) notifications = notifications.slice(0,40);
  await saveUserData();
  renderNotifications();
}
function renderNotifications(){
  const dot = document.getElementById('notifDot');
  const list = document.getElementById('notifList');
  if(!dot || !list) return;
  const unread = notifications.filter(n=>!n.read).length;
  dot.style.display = unread > 0 ? 'block' : 'none';
  list.innerHTML = notifications.length ? notifications.map(n=>\`
    <div class="notif-item \${n.read?'':'unread'}">
      \${n.read? '' : '<span class="unread-dot"></span>'}
      <span class="ic">\${n.icon}</span>
      <div class="body"><div class="txt">\${n.text}</div><div class="time">\${timeAgo(n.time)}</div></div>
    </div>\`).join('') : \`<div class="notif-empty">Nenhuma notificação por aqui.</div>\`;
}

/* ==================== Atualização parcial da tabela de Transações (evita flicker) ==================== */
function refreshTxTable(){
  const search = document.getElementById('txSearch');
  const fTipo = document.getElementById('txFiltroTipo');
  const fCat = document.getElementById('txFiltroCat');
  const fStatus = document.getElementById('txFiltroStatus');
  const fConta = document.getElementById('txFiltroConta');
  const tableWrap = document.getElementById('txTableWrap');
  if(!tableWrap) return false;

  let list = transactions.filter(inPeriod);
  if (search && search.value) {
    const q = search.value.trim().toLowerCase();
    if(q) list = list.filter(t=>t.desc && t.desc.toLowerCase().includes(q));
  }
  if(fTipo && fTipo.value) list = list.filter(t=>t.type===fTipo.value);
  if(fCat && fCat.value) list = list.filter(t=>t.cat===fCat.value);
  if(fStatus && fStatus.value) list = list.filter(t=>t.status===fStatus.value);
  if(fConta && fConta.value) {
    const targetAcc = accounts.find(a => a.name === fConta.value);
    if (targetAcc) {
      list = list.filter(t => isTxForAccount(t, targetAcc));
    } else {
      const qAcc = fConta.value.toLowerCase().trim();
      list = list.filter(t => (t.acc || '').toLowerCase().trim().includes(qAcc));
    }
  }

  list.sort((a,b)=>b.date.localeCompare(a.date));
  tableWrap.innerHTML = transactionsTable(list, true);
  const statsRow = document.getElementById('txStatsRow'); if(statsRow) statsRow.innerHTML = txStatsCardsHTML(list);
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      openModal(parseInt(el.getAttribute('data-edit')));
    };
  });
  document.querySelectorAll('[data-del]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const id = parseInt(el.getAttribute('data-del'));
      if (!isNaN(id)) deleteTransaction(id);
    };
  });
  document.querySelectorAll('[data-togglestatus]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const id = parseInt(el.getAttribute('data-togglestatus'));
      if (!isNaN(id)) toggleTransactionStatus(id);
    };
  });
  return true;
}

/* ==================== Render Suave sem Flickering ==================== */
function render(){
  const el = document.getElementById('pageContent');
  if (!el) return;

  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;
  if (isAdminView && currentPage !== 'usuarios' && currentPage !== 'logs') {
    currentPage = 'usuarios';
  }

  let newHTML = '';
  if(currentPage==='usuarios') {
    newHTML = pageUsuarios();
    syncUsersWithServer().then(() => {
      const uEl = document.getElementById('pageContent');
      if (uEl && currentPage === 'usuarios') {
        const freshHTML = pageUsuarios();
        if (uEl.innerHTML !== freshHTML) uEl.innerHTML = freshHTML;
      }
    }).catch(() => {});
  }
  else if(currentPage==='logs') {
    newHTML = pageLogs();
    loadSystemLogs().then(() => {
      const lEl = document.getElementById('pageContent');
      if (lEl && currentPage === 'logs') {
        const freshHTML = pageLogs();
        if (lEl.innerHTML !== freshHTML) lEl.innerHTML = freshHTML;
      }
    }).catch(() => {});
  }
  else if(currentPage==='dashboard') newHTML = pageDashboard();
  else if(currentPage==='transacoes') newHTML = pageTransacoes();
  else if(currentPage==='cartoes') newHTML = pageContas();
  else if(currentPage==='orcamentos') newHTML = pageOrcamentos();
  else if(currentPage==='metas') newHTML = pageMetas();
  else if(currentPage==='relatorios') newHTML = pageRelatorios();
  else if(currentPage==='recorrentes') newHTML = pageRecorrentes();
  else if(currentPage==='importar') newHTML = pageImportar();
  else if(currentPage==='anexos') newHTML = pageAnexos();
  else if(currentPage==='alertas') newHTML = pageAlertas();
  else if(currentPage==='config') newHTML = pageConfig();
  else if(currentPage==='funcoes') newHTML = pageFuncoes();

  el.innerHTML = newHTML;
  attachPageEvents();
  updateHeaderUser();
  renderNotifications();
  updateViewModeBanner();
  updateAdminMenuVisibility();
  updateActiveMenu();
  if(currentPage==='dashboard') drawDashboardCharts();
}

function updateActiveMenu(){
  const validPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'funcoes', 'usuarios', 'logs', 'config'];
  const financialPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'config'];
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;

  if (isAdminView) {
    if (!currentPage || financialPages.includes(currentPage) || !['usuarios', 'logs', 'funcoes'].includes(currentPage)) {
      currentPage = 'usuarios';
      try {
        localStorage.setItem('nexus_current_page', 'usuarios');
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, null, '#usuarios');
        } else {
          window.location.hash = 'usuarios';
        }
      } catch(e){}
    }
  } else {
    if (!currentPage || !financialPages.includes(currentPage) || ['usuarios', 'logs', 'funcoes'].includes(currentPage)) {
      const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
      const savedPage = localStorage.getItem('nexus_current_page');
      if (hashPage && financialPages.includes(hashPage)) {
        currentPage = hashPage;
      } else if (savedPage && financialPages.includes(savedPage)) {
        currentPage = savedPage;
      } else {
        currentPage = 'dashboard';
      }
    }
  }

  const buttons = document.querySelectorAll('button[data-page]');
  buttons.forEach(b => {
    const isCurrent = (b.getAttribute('data-page') === currentPage);
    b.classList.toggle('active', isCurrent);
  });
}

function updateAdminMenuVisibility(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;

  if (isAdminView) {
    document.documentElement.classList.add('is-admin');
  } else {
    document.documentElement.classList.remove('is-admin');
  }

  const financialPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'config'];
  financialPages.forEach(function(pg) {
    document.querySelectorAll('button[data-page="' + pg + '"]').forEach(function(btn) {
      btn.style.display = isAdminView ? 'none' : 'flex';
    });
  });

  const adminPages = ['usuarios', 'logs'];
  adminPages.forEach(function(pg) {
    document.querySelectorAll('button[data-page="' + pg + '"]').forEach(function(btn) {
      btn.style.display = isAdminView ? 'flex' : 'none';
    });
  });
}

function updateViewModeBanner(){
  const banner = document.getElementById('viewModeBanner');
  if(!banner) return;
  if(isViewingOtherUser && currentUser){
    document.getElementById('viewModeUserName').textContent = currentUser.name;
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
  }
}

function updateHeaderUser(){
  if (!currentUser) return;
  const unameEl = document.getElementById('headerName');
  const avatarEl = document.getElementById('headerAvatar');
  const roleEl = document.getElementById('headerRole');

  if(unameEl) unameEl.textContent = currentUser.name;
  if(roleEl) roleEl.textContent = currentUser.role || 'Usuário';
  if(avatarEl) avatarEl.textContent = currentUser.name.trim().split(/\s+/).map(n=>n[0]).slice(0,2).join('').toUpperCase();
}

function periodPickerHTML(){
  const isAllDates = currentPeriod.month === 0;
  const labelText = isAllDates ? 'Todas as Datas (Geral)' : (MONTHS[currentPeriod.month-1] + ' / ' + currentPeriod.year);

  return \`
  <div class="period-wrap">
    <button type="button" class="period" id="periodBtn">
      <span class="period-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="3"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><circle cx="8" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="14" r="1.1" fill="currentColor" stroke="none"/></svg></span>
      <span class="period-text">\${labelText}</span>
      <svg class="period-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="period-panel" id="periodPanel">
      <button type="button" class="period-today-btn" id="periodTodayBtn" style="margin-bottom:6px;">📍 Ir para o mês atual</button>
      <button type="button" class="period-today-btn" id="periodAllDatesBtn" style="background:rgba(74,144,226,0.15); color:var(--blue); margin-bottom:12px;">🌐 Ver Todas as Datas (Visão Geral)</button>
      <div class="field"><label>Ano</label><select id="periodYearSel"></select></div>
      <div class="field"><label>Mês</label><select id="periodMonthSel"></select></div>
      <button class="btn-primary" id="periodApplyBtn" style="width:100%;justify-content:center">Aplicar</button>
    </div>
  </div>\`;
}

/* ==================== Dashboard ==================== */
function getPendingBillsSummary() {
  const today = new Date();
  today.setHours(0,0,0,0);

  const pendingTxs = transactions.filter(t => {
    if (t.type !== 'out' || t.status === 'Pago' || t.status === 'Recebido') return false;
    const dParts = t.date ? t.date.split('-') : [];
    const d = dParts.length === 3 ? new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2])) : new Date(t.date);
    d.setHours(0,0,0,0);
    const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
    // Mostrar apenas contas VENCIDAS (diffDays < 0) ou a vencer nos próximos 3 DIAS (diffDays <= 3)
    return diffDays <= 3;
  });

  const items = pendingTxs.map(t => {
    const dParts = t.date ? t.date.split('-') : [];
    const d = dParts.length === 3 ? new Date(parseInt(dParts[0]), parseInt(dParts[1]) - 1, parseInt(dParts[2])) : new Date(t.date);
    d.setHours(0,0,0,0);

    const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
    let statusType = 'soon';
    let statusText = '';
    let isUrgent = false;

    if (diffDays < 0) {
      statusType = 'overdue';
      statusText = \`VENCIDA (há \${Math.abs(diffDays)} dia\${Math.abs(diffDays) === 1 ? '' : 's'})\`;
      isUrgent = true;
    } else if (diffDays === 0) {
      statusType = 'today';
      statusText = 'VENCE HOJE';
      isUrgent = true;
    } else {
      statusType = 'soon';
      statusText = \`VENCE EM \${diffDays} DIA\${diffDays === 1 ? '' : 'S'}\`;
      isUrgent = true;
    }

    return {
      ...t,
      diffDays,
      statusType,
      statusText,
      isUrgent,
      formattedDate: dParts.length === 3 ? \`\${dParts[2]}/\${dParts[1]}/\${dParts[0]}\` : t.date
    };
  });

  items.sort((a,b) => a.diffDays - b.diffDays);

  const totalValue = items.reduce((acc, curr) => acc + (curr.val || 0), 0);
  const urgentCount = items.filter(i => i.isUrgent).length;
  const overdueCount = items.filter(i => i.statusType === 'overdue').length;

  return {
    items,
    totalValue,
    urgentCount,
    overdueCount
  };
}

async function markTransactionAsPaid(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  t.status = 'Pago';
  showToast(\`✅ Conta "\${t.desc}" marcada como PAGA!\`);
  logActivity('Pagamento', 'Transação', \`Baixa realizada no pagamento de "\${t.desc}" (\${fmt(t.val)}).\`);
  await pushNotification(\`Pagamento realizado: \${t.desc} — \${fmt(t.val)}\`, '✅');
  await saveUserData();
  render();
}

function pageDashboard(){
  const periodTx = transactions.filter(inPeriod);
  const {receitas,despesas,saldo} = computeTotals(periodTx);
  const cats = despesasPorCategoria(periodTx);
  const totalDesp = cats.reduce((s,c)=>s+c.val,0)||1;
  const recPct = Math.round(receitas/(receitas+despesas||1)*100) || 0;
  const despPct = 100-recPct;
  const resultado = receitas - despesas;
  const savingsPct = receitas > 0 ? Math.max(0, Math.round((resultado / receitas) * 100)) : 0;
  const commitPct = receitas > 0 ? Math.min(100, Math.round((despesas / receitas) * 100)) : (despesas > 0 ? 100 : 0);
  const now = new Date();
  const daysInPeriod = now.getDate() || 1;
  const dailyAvg = despesas > 0 ? (despesas / daysInPeriod) : 0;
  const lastTx = periodTx.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
  const cardSummary = computeCardSummary();
  const pendingSummary = getPendingBillsSummary();

  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Olá, \${currentUser ? currentUser.name.split(' ')[0] : 'Usuário'} <span style="font-size:22px;">👋</span>
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Aqui está o resumo da sua vida financeira
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:12px;">
      \${periodPickerHTML()}
      <button class="btn-primary" id="btnNovaTransacao" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Transação
      </button>
    </div>
  </div>

  <div class="kpis">
    <!-- 1. Saldo Total -->
    <div class="kpi kpi-balance">
      <div class="row1">
        <span>Saldo Total</span>
        <span class="ic" style="background:rgba(59,130,246,0.14); color:var(--blue); border-color:rgba(59,130,246,0.25);">💳</span>
      </div>
      <div class="val" style="color:\${saldo < 0 ? 'var(--red)' : 'var(--green)'};">\${fmt(saldo)}</div>
      <div class="sub">Saldo atual de todas as contas</div>
    </div>

    <!-- 2. Receitas -->
    <div class="kpi kpi-income">
      <div class="row1">
        <span>Receitas</span>
        <span class="ic" style="background:rgba(16,185,129,0.14); color:var(--green); border-color:rgba(16,185,129,0.25);">↑</span>
      </div>
      <div class="val" style="color:var(--green);">\${fmt(receitas)}</div>
      <div class="sub up">\${periodLabel()}</div>
    </div>

    <!-- 3. Despesas -->
    <div class="kpi kpi-expense">
      <div class="row1">
        <span>Despesas</span>
        <span class="ic" style="background:rgba(239,68,68,0.14); color:var(--red); border-color:rgba(239,68,68,0.25);">↓</span>
      </div>
      <div class="val" style="color:var(--red);">\${fmt(despesas)}</div>
      <div class="sub" style="color:var(--red);">\${periodLabel()}</div>
    </div>

    <!-- 4. Saldo do Mês -->
    <div class="kpi kpi-net">
      <div class="row1">
        <span>Saldo do Mês</span>
        <span class="ic" style="background:\${(receitas-despesas) < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)'}; color:\${(receitas-despesas) < 0 ? 'var(--red)' : 'var(--blue)'}; border-color:\${(receitas-despesas) < 0 ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.25)'};">⇄</span>
      </div>
      <div class="val" style="color:\${(receitas-despesas) < 0 ? 'var(--red)' : 'var(--green)'};">\${fmt(receitas-despesas)}</div>
      <div class="sub" style="color:\${(receitas-despesas) < 0 ? 'var(--red)' : 'var(--green)'}">\${periodLabel()}</div>
    </div>

    <!-- 5. Transações -->
    <div class="kpi kpi-tx">
      <div class="row1">
        <span>Transações</span>
        <span class="ic" style="background:rgba(155,107,216,0.14); color:var(--purple); border-color:rgba(155,107,216,0.25);">☰</span>
      </div>
      <div class="val">\${periodTx.length}</div>
      <div class="sub">Registros no período</div>
    </div>
  </div>

  \${cardSummary.creditCards.length > 0 ? \`
  <!-- Resumo de Limite de Cartões de Crédito no Dashboard -->
  <div class="panel cards-summary-panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25);">
    <div class="panel-head" style="margin-bottom:12px;">
      <h3 style="display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
        Cartões de Crédito — Limite & Faturas
      </h3>
      <span class="tag" data-nav="cartoes" style="cursor:pointer; background:var(--green-soft); color:var(--green);">Ver todos os cartões</span>
    </div>
    <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px;">
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Limite Disponível Total</div>
        <div class="val" style="font-size:20px; font-weight:800; color:var(--green); margin-top:2px;">\${fmt(cardSummary.availableLimitGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">Para novas compras</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Fatura do Mês</div>
        <div class="val" style="font-size:20px; font-weight:800; color:var(--orange); margin-top:2px;">\${fmt(cardSummary.spentPeriodGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">\${periodLabel()}</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Fatura Acumulada em Aberto</div>
        <div class="val" style="font-size:20px; font-weight:800; color:var(--red); margin-top:2px;">\${fmt(cardSummary.spentTotalGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">Compras minus pagamentos</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:12px 14px; border-radius:10px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Limite Aprovado Total</div>
        <div class="val" style="font-size:20px; font-weight:800; color:var(--blue); margin-top:2px;">\${fmt(cardSummary.totalLimitGeral)}</div>
        <div class="sub" style="font-size:10.5px; color:var(--text-faint); margin-top:2px;">Soma dos cartões</div>
      </div>
    </div>
    <div style="margin-top:10px;">
      <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-dim); margin-bottom:4px;">
        <span>Comprometimento Global dos Cartões</span>
        <span style="font-weight:700; color:\${cardSummary.usagePctGeral>=90?'var(--red)':cardSummary.usagePctGeral>=70?'var(--orange)':'var(--green)'};">\${cardSummary.usagePctGeral}% comprometido</span>
      </div>
      <div class="bar-split" style="height:6px; background:var(--card-border); border-radius:4px; overflow:hidden;">
        <div class="g" style="width:\${cardSummary.usagePctGeral}%; height:100%; background:\${cardSummary.usagePctGeral>=90?'var(--red)':cardSummary.usagePctGeral>=70?'var(--orange)':'var(--green)'}; border-radius:4px;"></div>
      </div>
    </div>
  </div>
  \` : ''}

  <div class="grid3">
    <!-- Painel 1: Resumo Financeiro (4K Executive Design) -->
    <div class="panel" style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-direction:column; gap:13px; width:100%;">
        
        <!-- Cabeçalho Alinhado -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:9px;">
            <div style="width:34px; height:34px; border-radius:10px; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; color:var(--blue); box-shadow:0 3px 10px rgba(59,130,246,0.15); flex-shrink:0;">
              📊
            </div>
            <div>
              <h3 style="font-size:14px; font-weight:800; color:var(--text); margin:0; letter-spacing:-0.01em;">
                Resumo Financeiro
              </h3>
              <span style="font-size:11px; color:var(--text-dim); margin-top:1px; display:block; opacity:0.85; font-weight:500;">
                Balanço e fluxo do período
              </span>
            </div>
          </div>
          <span class="tag" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); font-weight:700; font-size:11.5px; padding:4px 10px; border-radius:8px;">
            \${periodLabel()}
          </span>
        </div>

        <!-- 1. Grid de 3 Cards Principais (Receitas, Despesas, Resultado) -->
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
          <!-- Receitas -->
          <div style="background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.22); border-radius:12px; padding:9px 6px; text-align:center;">
            <div style="font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--green); display:flex; align-items:center; justify-content:center; gap:3px;">
              <span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--green);"></span> Receitas
            </div>
            <b style="color:var(--green); font-size:13px; font-weight:800; margin-top:4px; display:block; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              \${fmt(receitas)}
            </b>
          </div>

          <!-- Despesas -->
          <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.22); border-radius:12px; padding:9px 6px; text-align:center;">
            <div style="font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:var(--red); display:flex; align-items:center; justify-content:center; gap:3px;">
              <span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:var(--red);"></span> Despesas
            </div>
            <b style="color:var(--red); font-size:13px; font-weight:800; margin-top:4px; display:block; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              \${fmt(despesas)}
            </b>
          </div>

          <!-- Resultado -->
          <div style="background:\${resultado >= 0 ? 'rgba(59,130,246,0.06)' : 'rgba(239,68,68,0.08)'}; border:1px solid \${resultado >= 0 ? 'rgba(59,130,246,0.22)' : 'rgba(239,68,68,0.25)'}; border-radius:12px; padding:9px 6px; text-align:center;">
            <div style="font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:\${resultado >= 0 ? 'var(--blue)' : 'var(--red)'}; display:flex; align-items:center; justify-content:center; gap:3px;">
              <span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:\${resultado >= 0 ? 'var(--blue)' : 'var(--red)'};"></span> Resultado
            </div>
            <b style="color:\${resultado >= 0 ? 'var(--green)' : 'var(--red)'}; font-size:13px; font-weight:800; margin-top:4px; display:block; font-variant-numeric:tabular-nums; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
              \${fmt(resultado)}
            </b>
          </div>
        </div>

        <!-- 2. Medidor Visual de Economia (High-Definition SVG Dual-Ring Meter) -->
        <div style="display:flex; align-items:center; justify-content:center; position:relative; width:126px; height:126px; margin:2px auto;">
          <svg viewBox="0 0 100 100" style="width:100%; height:100%; transform:rotate(-90deg);">
            <!-- Background Track -->
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="8"/>
            <!-- Despesas Track -->
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(239,68,68,0.35)" stroke-width="8" stroke-dasharray="\${2 * Math.PI * 40}" stroke-dashoffset="0"/>
            <!-- Receitas / Economia Ring Progress -->
            <circle cx="50" cy="50" r="40" fill="none" stroke="\${savingsPct > 0 ? '#10B981' : '#64748B'}" stroke-width="8.5" stroke-linecap="round" stroke-dasharray="\${2 * Math.PI * 40}" stroke-dashoffset="\${2 * Math.PI * 40 * (1 - Math.min(Math.max(savingsPct, 0), 100) / 100)}" style="transition: stroke-dashoffset 0.6s ease; filter:drop-shadow(0 0 4px \${savingsPct > 0 ? 'rgba(16,185,129,0.5)' : 'transparent'});"/>
          </svg>
          <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; pointer-events:none;">
            <span style="font-size:9px; text-transform:uppercase; letter-spacing:0.08em; font-weight:700; color:var(--text-dim);">Economia</span>
            <b style="color:\${savingsPct > 0 ? 'var(--green)' : 'var(--text-dim)'}; font-size:16px; font-weight:800; margin-top:1px; line-height:1;">\${savingsPct}%</b>
            <span style="font-size:9px; color:var(--text-faint); margin-top:2px;">da receita</span>
          </div>
        </div>

        <!-- 3. Indicadores de Saúde Financeira -->
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
          <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:8px 10px; display:flex; align-items:center; gap:8px;">
            <span style="font-size:13px; background:rgba(229,169,60,0.12); color:var(--gold); border:1px solid rgba(229,169,60,0.25); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">📈</span>
            <div style="min-width:0;">
              <div style="font-size:10px; color:var(--text-dim); font-weight:600;">Comprometimento</div>
              <div style="font-size:11.5px; font-weight:800; color:\${commitPct > 80 ? 'var(--red)' : commitPct > 60 ? 'var(--orange)' : 'var(--green)'}; font-variant-numeric:tabular-nums;">\${commitPct}% da Renda</div>
            </div>
          </div>

          <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:8px 10px; display:flex; align-items:center; gap:8px;">
            <span style="font-size:13px; background:rgba(59,130,246,0.12); color:var(--blue); border:1px solid rgba(59,130,246,0.25); width:28px; height:28px; border-radius:8px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">📅</span>
            <div style="min-width:0;">
              <div style="font-size:10px; color:var(--text-dim); font-weight:600;">Média Diária</div>
              <div style="font-size:11.5px; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums;">\${fmt(dailyAvg)}/dia</div>
            </div>
          </div>
        </div>

        <!-- 4. Barra de Distribuição de Renda -->
        <div>
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px; font-size:10.5px; font-weight:700;">
            <span style="color:var(--green); display:flex; align-items:center; gap:4px;">
              <span style="width:6px; height:6px; border-radius:50%; background:var(--green); display:inline-block;"></span>
              Receitas \${recPct}%
            </span>
            <span style="color:var(--red); display:flex; align-items:center; gap:4px;">
              Despesas \${despPct}%
              <span style="width:6px; height:6px; border-radius:50%; background:var(--red); display:inline-block;"></span>
            </span>
          </div>
          <div class="bar-split" style="height:6.5px; border-radius:6px; overflow:hidden; background:rgba(239,68,68,0.3); box-shadow:inset 0 1px 2px rgba(0,0,0,0.3); display:flex;">
            <div class="g" style="width:\${recPct}%; border-radius:6px; background:linear-gradient(90deg, #10B981, #34D399); transition:width 0.4s ease;"></div>
          </div>
        </div>

      </div>

      <!-- Rodapé Alinhado com Link Interativo -->
      <div style="margin-top:14px; padding-top:12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim); border-top:1px solid rgba(255,255,255,0.06); width:100%;">
        <span style="display:flex; align-items:center; gap:5px;">
          <span style="width:6px; height:6px; border-radius:50%; background:var(--green);"></span>
          Poupança: <strong style="color:var(--green); font-weight:700;">\${savingsPct}%</strong>
        </span>
        <span style="cursor:pointer; color:var(--blue); font-weight:700; transition:all 0.2s ease; display:flex; align-items:center; gap:3px;" data-nav="relatorios" class="hover:underline">
          Ver relatórios completos →
        </span>
      </div>
    </div>

    <!-- Painel 2: Despesas por Categoria (Design Executivo 4K Alinhado) -->
    <div class="panel" style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-direction:column; gap:13px; width:100%;">
        
        <!-- Cabeçalho Executivo Alinhado -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:9px;">
            <div style="width:34px; height:34px; border-radius:10px; background:rgba(229,169,60,0.12); border:1px solid rgba(229,169,60,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; color:var(--gold); box-shadow:0 3px 10px rgba(229,169,60,0.15); flex-shrink:0;">
              🏷️
            </div>
            <div>
              <h3 style="font-size:14px; font-weight:800; color:var(--text); margin:0; letter-spacing:-0.01em;">
                Despesas por Categoria
              </h3>
              <span style="font-size:11px; color:var(--text-dim); margin-top:1px; display:block; opacity:0.85; font-weight:500;">
                Distribuição dos gastos no período
              </span>
            </div>
          </div>
          <span class="tag" style="background:rgba(239,68,68,0.12); color:var(--red); font-weight:800; font-size:12px; padding:4px 10px; border-radius:8px; border:1px solid rgba(239,68,68,0.25); font-variant-numeric: tabular-nums; box-shadow:0 2px 6px rgba(239,68,68,0.15);">
            \${fmt(totalDesp)}
          </span>
        </div>

        \${cats.length > 0 ? \`
        <!-- Barra de Composição Contínua Multi-Segmentos -->
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:8px 10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; color:var(--text-dim); margin-bottom:6px; font-weight:600;">
            <span style="display:flex; align-items:center; gap:4px;">
              <span style="width:5px; height:5px; border-radius:50%; background:var(--gold);"></span>
              Composição Visual
            </span>
            <span style="color:var(--text); font-weight:700;">\${cats.length} categoria\${cats.length === 1 ? '' : 's'}</span>
          </div>
          <div style="width:100%; height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden; display:flex; gap:1.5px; box-shadow:inset 0 1px 2px rgba(0,0,0,0.3);">
            \${cats.map(c => {
              const pct = Math.max(Math.round(c.val / totalDesp * 100), 2);
              return \`<div style="width:\${pct}%; height:100%; background:\${c.color}; border-radius:2px; transition:width 0.4s ease;" title="\${c.name}: \${fmt(c.val)} (\${pct}%)"></div>\`;
            }).join('')}
          </div>
        </div>

        <!-- Lista Executiva em Cards com Alinhamento Preciso e Micro-Barras -->
        <div style="display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box;">
          \${cats.map(c => {
            const pct = Math.round(c.val / totalDesp * 100);
            const icon = getCategoryIcon(c.name);
            const count = periodTx.filter(t => t.cat === c.name && t.type === 'out').length;
            return \`
            <div style="display:flex; flex-direction:column; gap:7px; padding:10px 12px; border-radius:12px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-left:3.5px solid \${c.color}; transition:transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;" class="cat-item-card">
              <div style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:10px;">
                
                <!-- Esquerda: Ícone Estilizado + Nome + Contagem -->
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  <span style="background:\${c.color}18; color:\${c.color}; border:1px solid \${c.color}35; width:34px; height:34px; border-radius:9px; display:flex; align-items:center; justify-content:center; font-size:15px; flex-shrink:0; box-shadow:0 2px 8px \${c.color}18;">
                    \${icon}
                  </span>
                  <div style="min-width:0;">
                    <div style="font-size:13px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${c.name}</div>
                    <div style="font-size:10.5px; color:var(--text-dim); font-weight:500; display:flex; align-items:center; gap:5px; margin-top:1px;">
                      <span>\${count} lançamento\${count === 1 ? '' : 's'}</span>
                      <span style="opacity:0.4;">•</span>
                      <span style="color:\${c.color}; font-weight:700;">\${pct}% do total</span>
                    </div>
                  </div>
                </div>

                <!-- Direita: Valor e Percentual em Badge Homogênea -->
                <div style="text-align:right; flex-shrink:0;">
                  <div style="font-size:13.5px; font-weight:800; color:var(--text); font-variant-numeric: tabular-nums; letter-spacing:-0.01em;">
                    \${fmt(c.val)}
                  </div>
                  <div style="display:inline-block; font-size:9.5px; font-weight:700; color:\${c.color}; background:\${c.color}15; border:1px solid \${c.color}30; padding:1.5px 7px; border-radius:6px; margin-top:2px;">
                    \${pct}%
                  </div>
                </div>
              </div>

              <!-- Micro-Barra de Progresso com Brilho Sutil -->
              <div style="width:100%; height:4.5px; background:rgba(255,255,255,0.06); border-radius:3px; overflow:hidden;">
                <div style="width:\${pct}%; height:100%; background:\${c.color}; border-radius:3px; box-shadow:0 0 8px \${c.color}40; transition:width .4s ease;"></div>
              </div>
            </div>\`;
          }).join('')}
        </div>

        <!-- Box de Insight / Destaque de Concentração -->
        \${cats.length > 0 ? \`
        <div style="background:rgba(255,255,255,0.02); border:1px solid rgba(255,255,255,0.06); border-radius:10px; padding:9px 12px; display:flex; align-items:center; gap:9px; margin-top:2px;">
          <span style="font-size:13px; background:rgba(229,169,60,0.12); color:var(--gold); border:1px solid rgba(229,169,60,0.25); width:26px; height:26px; border-radius:7px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">💡</span>
          <div style="font-size:11px; color:var(--text-dim); min-width:0; line-height:1.35;">
            Maior concentração em <strong style="color:var(--text); font-weight:700;">\${cats[0].name}</strong> (<span style="color:var(--gold); font-weight:700;">\${Math.round(cats[0].val / totalDesp * 100)}%</span> dos gastos).
          </div>
        </div>\` : ''}

        \` : \`
        <div style="text-align:center; padding:35px 10px; color:var(--text-dim);">
          <div style="font-size:28px; margin-bottom:8px;">📊</div>
          <p style="font-size:12px; font-weight:500;">Nenhuma despesa registrada neste período.</p>
        </div>
        \`}
      </div>

      <!-- Rodapé Alinhado com Contador e Link Interativo -->
      <div style="margin-top:14px; padding-top:12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim); border-top:1px solid rgba(255,255,255,0.06); width:100%;">
        <span style="display:flex; align-items:center; gap:5px;">
          <span style="width:6px; height:6px; border-radius:50%; background:var(--gold);"></span>
          Total: <strong style="color:var(--text); font-weight:700;">\${cats.length}</strong> categoria\${cats.length === 1 ? '' : 's'}
        </span>
        <span style="cursor:pointer; color:var(--gold); font-weight:700; transition:all 0.2s ease; display:flex; align-items:center; gap:3px;" data-nav="transacoes" class="hover:underline">
          Ver todas as despesas →
        </span>
      </div>
    </div>

    <!-- Painel 3: Contas e Cartões (Design Executivo 4K Alinhado) -->
    <div class="panel" style="display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;">
      <div style="display:flex; flex-direction:column; gap:13px; width:100%;">
        
        <!-- Cabeçalho Executivo Alinhado -->
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; align-items:center; gap:9px;">
            <div style="width:34px; height:34px; border-radius:10px; background:rgba(139,92,246,0.12); border:1px solid rgba(139,92,246,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; color:var(--purple); box-shadow:0 3px 10px rgba(139,92,246,0.15); flex-shrink:0;">
              💳
            </div>
            <div>
              <h3 style="font-size:14px; font-weight:800; color:var(--text); margin:0; letter-spacing:-0.01em;">
                Contas e Cartões
              </h3>
              <span style="font-size:11px; color:var(--text-dim); margin-top:1px; display:block; opacity:0.85; font-weight:500;">
                Limites, faturas e saldos
              </span>
            </div>
          </div>
          <button class="tag" data-nav="cartoes" style="font-size:11.5px; padding:4px 12px; font-weight:700; cursor:pointer; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.12); color:var(--text); border-radius:8px; transition:all 0.2s ease;">
            Editar
          </button>
        </div>

        <div class="accounts-list" style="display:flex; flex-direction:column; gap:8px; width:100%; box-sizing:border-box;">
          \${accounts.slice().sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map(a=>{
            const stats = getCardStats(a);
            return \`
            <div class="acc-row" style="display:flex; flex-direction:column; width:100%; box-sizing:border-box; padding:10px 12px; background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.07); border-left:3.5px solid \${a.color}; border-radius:12px; gap:8px; transition:transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;">
              
              <!-- Linha 1: Nome à Esquerda e Disponível/Saldo à Direita -->
              <div style="display:flex; align-items:center; justify-content:space-between; width:100%; box-sizing:border-box; gap:10px;">
                <div style="display:flex; align-items:center; gap:10px; min-width:0;">
                  <div class="acc-ic" style="background:\${a.color}; width:34px; height:34px; border-radius:9px; font-weight:800; font-size:12px; color:#fff; display:flex; align-items:center; justify-content:center; flex-shrink:0; box-shadow:0 3px 10px rgba(0,0,0,0.35); text-shadow:0 1px 2px rgba(0,0,0,0.4);">
                    \${a.name.slice(0,2).toUpperCase()}
                  </div>
                  <div style="min-width:0;">
                    <div style="font-weight:700; font-size:13px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${a.name}</div>
                    <div style="font-size:10.5px; color:var(--text-dim); margin-top:1px; opacity:0.85; font-weight:500;">\${a.type}</div>
                  </div>
                </div>

                <div style="text-align:right; flex-shrink:0;">
                  \${stats.isCreditCard ? \`
                    <div style="font-size:9.5px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em; opacity:0.85;">Disponível</div>
                    <div style="color:\${stats.availableLimit < 200 ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-size:13.5px; letter-spacing:-0.01em; font-variant-numeric: tabular-nums;">
                      \${fmt(stats.availableLimit)}
                    </div>
                  \` : \`
                    <div style="font-size:9.5px; font-weight:700; color:var(--text-dim); text-transform:uppercase; letter-spacing:0.04em; opacity:0.85;">Saldo</div>
                    <div style="color:\${stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-size:13.5px; font-variant-numeric: tabular-nums;">
                      \${fmt(stats.currentBalance)}
                    </div>
                  \`}
                </div>
              </div>

              \${stats.isCreditCard ? \`
              <!-- Linha 2: Barra de Progresso do Limite (com trilho padronizado mesmo se uso for 0%) -->
              <div style="width:100%; box-sizing:border-box; display:flex; flex-direction:column; gap:5px; padding-top:6px; border-top:1px solid rgba(255,255,255,0.06);">
                <div style="width:100%; height:4.5px; background:rgba(255,255,255,0.08); border-radius:2.5px; overflow:hidden;">
                  <div style="width:\${Math.max(stats.usagePct, 0)}%; height:100%; background:\${stats.usagePct >= 90 ? 'var(--red)' : stats.usagePct >= 70 ? 'var(--orange)' : 'var(--green)'}; border-radius:2.5px; transition:width .4s ease;"></div>
                </div>
                
                <!-- Linha 3: Fatura na Esquerda e Limite Total na Direita -->
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%; box-sizing:border-box; font-size:11px;">
                  <div style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.03); padding:2px 7px; border-radius:6px;">
                    <span style="color:var(--text-dim); font-size:10px; opacity:0.85;">Fatura:</span>
                    <strong style="color:\${stats.spentTotal > 0 ? 'var(--orange)' : 'var(--text-dim)'}; font-weight:700; font-variant-numeric: tabular-nums;">\${fmt(stats.spentTotal)}</strong>
                  </div>
                  <div style="display:flex; align-items:center; gap:4px; background:rgba(255,255,255,0.03); padding:2px 7px; border-radius:6px;">
                    <span style="color:var(--text-dim); font-size:10px; opacity:0.85;">Limite:</span>
                    <strong style="color:var(--text); font-weight:700; font-variant-numeric: tabular-nums;">\${fmt(stats.totalLimit)}</strong>
                  </div>
                </div>
              </div>
              \` : \`
              <!-- Conta Corrente / Poupança / Investimento -->
              <div style="width:100%; box-sizing:border-box; background:rgba(59,130,246,0.06); border:1px solid rgba(59,130,246,0.18); border-radius:8px; padding:6px 10px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-size:10.5px; font-weight:600; color:var(--text-dim);">Saldo em Conta:</span>
                <strong style="color:\${stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-size:13px; font-variant-numeric: tabular-nums;">\${fmt(stats.currentBalance)}</strong>
              </div>
              \`}
            </div>\`;
          }).join('')}
        </div>
      </div>

      <!-- Rodapé Alinhado com Contador e Link Interativo -->
      <div style="margin-top:14px; padding-top:12px; display:flex; justify-content:space-between; align-items:center; font-size:11.5px; color:var(--text-dim); border-top:1px solid rgba(255,255,255,0.06); width:100%;">
        <span style="display:flex; align-items:center; gap:5px;">
          <span style="width:6px; height:6px; border-radius:50%; background:var(--purple);"></span>
          Total: <strong style="color:var(--text); font-weight:700;">\${accounts.length}</strong> conta\${accounts.length === 1 ? '' : 's'}/cartões
        </span>
        <span style="cursor:pointer; color:var(--purple); font-weight:700; transition:all 0.2s ease; display:flex; align-items:center; gap:3px;" data-nav="cartoes" class="hover:underline">
          Ver todas as contas →
        </span>
      </div>
    </div>
  </div>

  \${pendingSummary.items.length > 0 ? \`
  <!-- Mini Card Quadrado Compacto & Discreto (Posicionado com Organização Perfeita) -->
  <div class="panel due-bills-panel" style="margin-bottom:22px; padding:14px 18px; border:1px solid \${pendingSummary.overdueCount > 0 ? 'rgba(239,90,90,0.5)' : 'rgba(240,166,58,0.45)'}; background:\${pendingSummary.overdueCount > 0 ? 'rgba(239,90,90,0.08)' : 'rgba(240,166,58,0.06)'}; border-radius:16px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);">
    
    <!-- Cabeçalho Discreto -->
    <div style="display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:10px; padding-bottom:8px; border-bottom:1px solid var(--card-border);">
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="font-size:15px;">\${pendingSummary.overdueCount > 0 ? '🚨' : '⚠️'}</span>
        <h4 style="margin:0; font-size:12.5px; font-weight:800; letter-spacing:0.02em; color:\${pendingSummary.overdueCount > 0 ? 'var(--red)' : 'var(--orange)'}; text-transform:uppercase;">
          CONTAS A VENCER (\${pendingSummary.items.length})
        </h4>
      </div>
      <span style="font-size:11px; font-weight:700; color:var(--text-dim);">
        Total: <strong style="color:var(--red);">\${fmt(pendingSummary.totalValue)}</strong>
      </span>
    </div>

    <!-- Lista Enxuta Sem Cortes -->
    <div class="due-bills-list" style="display:flex; flex-direction:column; gap:6px;">
      \${pendingSummary.items.map(item => \`
        <div class="due-bill-row" style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; padding:8px 12px; border-radius:8px; background:var(--card); border:1px solid \${item.statusType === 'overdue' ? 'rgba(239,90,90,0.4)' : item.statusType === 'today' ? 'rgba(240,166,58,0.4)' : 'var(--card-border)'}; font-size:12px;">
          
          <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:180px;">
            <!-- Sinal de Emergência -->
            <span style="font-size:13px; flex-shrink:0;" title="\${item.statusText}">
              \${item.statusType === 'overdue' ? '🚨' : item.statusType === 'today' ? '⚡' : '⚠️'}
            </span>

            <div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px 8px;">
              <span style="font-weight:700; color:var(--text);">\${item.desc}</span>
              <!-- Vencimento na Frente -->
              <span style="font-size:11px; font-weight:700; color:\${item.statusType === 'overdue' ? 'var(--red)' : 'var(--orange)'}; background:\${item.statusType === 'overdue' ? 'var(--red-soft)' : 'rgba(240,166,58,0.15)'}; padding:1px 6px; border-radius:4px;">
                Vence: \${item.formattedDate}
              </span>
            </div>
          </div>

          <!-- Valor & Botão Pagar -->
          <div style="display:flex; align-items:center; gap:10px; flex-shrink:0;">
            <span style="font-size:13px; font-weight:800; color:var(--red);">\${fmt(item.val)}</span>
            <button class="btn-primary" data-paytx="\${item.id}" title="Marcar como Pago" style="padding:3px 8px; font-size:10.5px; font-weight:700; background:linear-gradient(135deg, var(--green), #c9862a); border:none; border-radius:6px; cursor:pointer; color:#08130c; white-space:nowrap;">
              ✅ Pagar
            </button>
          </div>
        </div>
      \`).join('')}
    </div>

  </div>
  \` : ''}

  <div class="table-panel">
    <div class="panel-head"><h3>Últimas Transações</h3><span class="tag" data-nav="transacoes">Ver todas</span></div>
    \${transactionsTable(lastTx, false)}
  </div>
  \`;
}

function getAccountIcon(accName) {
  if (!accName) return '💳';
  const name = accName.toLowerCase();
  if (name.includes('banco') || name.includes('brasil') || name.includes('itau') || name.includes('bradesco') || name.includes('santander') || name.includes('caixa') || name.includes('nubank') || name.includes('inter') || name.includes('sifre')) return '🏦';
  if (name.includes('dinheiro') || name.includes('espécie') || name.includes('carteira')) return '💵';
  if (name.includes('boleto') || name.includes('pix') || name.includes('outros')) return '⚡';
  return '💳';
}

function transactionsTable(list, showActions){
  if (typeof isDataLoading !== 'undefined' && isDataLoading && list.length === 0) {
    return \`<div class="placeholder" style="padding:40px 20px;"><div class="big" style="font-size:30px;margin-bottom:12px;">⏳</div><h3>Carregando suas transações...</h3><p>Sincronizando seus dados financeiros com o servidor.</p></div>\`;
  }
  if(list.length===0) return \`<div class="placeholder"><div class="big">🗂️</div><h3>Nenhuma transação encontrada</h3><p>Nenhuma transação registrada no período selecionado.</p></div>\`;

  const totalDespesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val), 0);
  const totalReceitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val), 0);
  const saldoPeriodo = totalReceitas - totalDespesas;
  const countDespesas = list.filter(t=>t.type==='out').length;
  const countReceitas = list.filter(t=>t.type==='in').length;

  return \`
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Descrição</th>
        <th>Categoria</th>
        <th>Conta / Cartão</th>
        <th>Tipo</th>
        <th>Valor</th>
        <th>Status</th>
        \${showActions?'<th style="text-align:center;">Ações</th>':''}
      </tr>
    </thead>
    <tbody>
      \${list.map(t=>\`
        <tr class="trow">
          <td><span class="tx-date-badge">\${formatDateBR(t.date)}</span></td>
          <td class="tx-desc">\${t.desc}</td>
          <td><span class="pill cat-pill" style="background:\${catColor(t.cat)}18; color:\${catColor(t.cat)}; border:1px solid \${catColor(t.cat)}35">\${catIcon(t.cat)} \${t.cat}</span></td>
          <td><span class="pill acc-pill">\${getAccountIcon(t.acc)} \${t.acc || '—'}</span></td>
          <td><span class="type-pill \${t.type}">\${t.type==='in'?'↑ Receita':'↓ Despesa'}</span></td>
          <td class="\${t.type==='in'?'val-in':'val-out'}">\${t.type==='in'?'+':'-'}\${fmt(t.val)}</td>
          <td>
            <span class="pill status-\${t.status.toLowerCase()} status-toggle-btn" data-togglestatus="\${t.id}" title="Clique para alternar o status (Pendente / Pago)">
              \${t.status === 'Pendente' ? '⏳ Pendente' : (t.type === 'in' ? '✓ Recebido' : '✓ Pago')}
            </span>
          </td>
          \${showActions?\`<td><div class="row-actions" style="justify-content:center;"><button data-edit="\${t.id}" title="Editar Transação" class="btn-action-edit">✎</button><button data-del="\${t.id}" title="Excluir Transação" class="btn-action-del">🗑</button></div></td>\`:''}
        </tr>\`).join('')}
    </tbody>
    <tfoot>
      <tr class="tfoot-row">
        <td colspan="5" class="tfoot-label">TOTAL DE GASTOS (\${countDespesas} despesa\${countDespesas===1?'':'s'}):</td>
        <td class="tfoot-value">-\${fmt(totalDespesas)}</td>
        <td colspan="\${showActions?2:1}"></td>
      </tr>
    </tfoot>
  </table>

  <!-- Aba / Card com Cálculo Consolidado dos Gastos ao final -->
  <div class="tx-footer-summary">
    <div class="tx-summary-card expense">
      <div class="tx-summary-icon expense">↓</div>
      <div>
        <div class="tx-summary-label">Cálculo Total de Gastos</div>
        <div class="tx-summary-val expense">-\${fmt(totalDespesas)}</div>
        <div class="tx-summary-sub">\${countDespesas} lançamento(s) de despesa</div>
      </div>
    </div>

    <div class="tx-summary-card income">
      <div class="tx-summary-icon income">↑</div>
      <div>
        <div class="tx-summary-label">Total de Entradas (Receitas)</div>
        <div class="tx-summary-val income">+\${fmt(totalReceitas)}</div>
        <div class="tx-summary-sub">\${countReceitas} lançamento(s) de receita</div>
      </div>
    </div>

    <div class="tx-summary-card \${saldoPeriodo < 0 ? 'expense' : 'balance'}">
      <div class="tx-summary-icon \${saldoPeriodo < 0 ? 'expense' : 'balance'}">⇄</div>
      <div>
        <div class="tx-summary-label">Balanço do Período</div>
        <div class="tx-summary-val \${saldoPeriodo < 0 ? 'expense' : 'income'}">\${fmt(saldoPeriodo)}</div>
        <div class="tx-summary-sub">\${list.length} registro(s) no filtro</div>
      </div>
    </div>
  </div>\`;
}

function pageTransacoes(){
  const periodTx = transactions.filter(inPeriod);
  const accOptsHTML = accounts.slice().sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map(a => '<option value="' + a.name + '">' + a.name + ' (' + a.type + ')</option>').join('');
  return \`
  <div class="page-head">
    <div><h1>Transações — \${periodLabel()}</h1><p>Gerencie suas receitas e despesas do mês selecionado</p></div>
    <div class="head-actions">
      \${periodPickerHTML()}
      <button class="btn-ghost" id="btnGerenciarCategorias">🏷️ Categorias</button>
      <button class="btn-primary" id="btnNovaTransacao">+ Nova Transação</button>
    </div>
  </div>
  <div class="table-panel">
    <div class="filters">
      <select id="txFiltroConta"><option value="">Todas as Contas / Cartões</option>\${accOptsHTML}</select>
      <select id="txFiltroTipo"><option value="">Todos os tipos</option><option value="in">Receitas</option><option value="out">Despesas</option></select>
      <select id="txFiltroCat"><option value="">Todas categorias</option>\${catOptionsHTML(null)}</select>
      <select id="txFiltroStatus"><option value="">Todos status</option><option>Pago</option><option>Recebido</option><option>Pendente</option></select>
    </div>
    <div id="txTableWrap">\${transactionsTable(periodTx.slice().sort((a,b)=>b.date.localeCompare(a.date)), true)}</div>
  </div>\`;
}

function pageContas(){
  const list = accounts.slice().sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  const summary = computeCardSummary();
  
  return \`
  <div class="page-head">
    <div>
      <h1>Cartões e Contas</h1>
      <p>Acompanhe o limite disponível dos seus cartões de crédito e o saldo das suas contas</p>
    </div>
    <div class="head-actions">
      \${periodPickerHTML()}
      <button class="btn-primary" id="btnNovaConta">+ Novo Cartão/Conta</button>
    </div>
  </div>

  \${summary.creditCards.length > 0 ? \`
  <!-- Resumo Consolidado de Limite de Cartões -->
  <div class="panel cards-summary-panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25);">
    <div class="panel-head" style="margin-bottom:14px;">
      <h3 style="display:flex;align-items:center;gap:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
        Visão Geral dos Cartões de Crédito
      </h3>
      <span class="tag" style="cursor:default; background:var(--green-soft); color:var(--green);">\${summary.creditCards.length} cartão(ões)</span>
    </div>
    <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px;">
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:12px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Limite Disponível Total</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--green); margin-top:4px;">\${fmt(summary.availableLimitGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Disponível para compras</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:12px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Fatura do Mês (\${periodLabel()})</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--orange); margin-top:4px;">\${fmt(summary.spentPeriodGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Gastos no mês selecionado</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:12px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Fatura Acumulada em Aberto</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--red); margin-top:4px;">\${fmt(summary.spentTotalGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Compras minus pagamentos</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:12px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px;">Limite Total Aprovado</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--blue); margin-top:4px;">\${fmt(summary.totalLimitGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Soma de todos os cartões</div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:6px;">
        <span>Uso global do limite de crédito</span>
        <span style="font-weight:700; color:\${summary.usagePctGeral>=90?'var(--red)':summary.usagePctGeral>=70?'var(--orange)':'var(--green)'};">\${summary.usagePctGeral}% comprometido</span>
      </div>
      <div class="bar-split" style="height:8px; background:var(--card-border); border-radius:6px; overflow:hidden;">
        <div class="g" style="width:\${summary.usagePctGeral}%; height:100%; background:\${summary.usagePctGeral>=90?'var(--red)':summary.usagePctGeral>=70?'var(--orange)':'var(--green)'}; border-radius:6px; transition:width .3s ease;"></div>
      </div>
    </div>
  </div>
  \` : ''}

  <div class="grid3" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(310px, 1fr)); gap:16px; align-items:stretch;">
    \${list.length ? list.map(a => {
      const stats = getCardStats(a);
      return \`
      <div class="acc-card" style="position:relative; background:var(--card); border:1px solid var(--card-border); border-radius:14px; padding:18px; display:flex; flex-direction:column; justify-content:space-between; min-height:260px; box-sizing:border-box;">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
            <div class="id-group" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span class="acc-ic" style="background:\${a.color}; width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-weight:800; color:#fff; font-size:14px; flex-shrink:0;">\${a.name.slice(0,2).toUpperCase()}</span>
              <div style="min-width:0;">
                <h3 style="font-size:15px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:2px; color:var(--text);">\${a.name}</h3>
                <span class="pill" style="font-size:10.5px; padding:2px 8px; border-radius:6px; background:\${stats.isCreditCard ? 'rgba(155,107,216,0.15)' : 'var(--green-soft)'}; color:\${stats.isCreditCard ? 'var(--purple)' : 'var(--green)'}; font-weight:600;">\${a.type}</span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;"><button data-editacc="\${a.id}" title="Editar">✎</button><button data-delacc="\${a.id}" title="Excluir">🗑</button></div>
          </div>

          \${stats.isCreditCard ? \`
            <div style="background:rgba(255,255,255,0.02); border:1px solid var(--card-border); border-radius:10px; padding:12px; margin-top:4px;">
              <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:2px;">Limite Disponível</div>
              <div class="val" style="font-size:22px; font-weight:800; color:\${stats.availableLimit < 200 ? 'var(--red)' : 'var(--green)'}">
                \${fmt(stats.availableLimit)}
              </div>
              <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-dim); margin-top:8px; padding-top:8px; border-top:1px dashed var(--card-border);">
                <span>Fatura: <strong style="color:var(--orange);">\${fmt(stats.spentTotal)}</strong></span>
                <span>Limite Total: <strong style="color:var(--text);">\${fmt(stats.totalLimit)}</strong></span>
              </div>
              <div style="margin-top:8px;">
                <div class="bar-split" style="height:6px; background:var(--card-border); border-radius:4px; overflow:hidden;">
                  <div class="g" style="width:\${stats.usagePct}%; height:100%; background:\${stats.usagePct >= 90 ? 'var(--red)' : stats.usagePct >= 70 ? 'var(--orange)' : 'var(--green)'}; border-radius:4px;"></div>
                </div>
                <div style="text-align:right; font-size:10.5px; color:var(--text-faint); margin-top:4px;">\${stats.usagePct}% utilizado</div>
              </div>
            </div>
          \` : \`
            <div style="background:rgba(255,255,255,0.02); border:1px solid var(--card-border); border-radius:10px; padding:12px; margin-top:4px;">
              <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:2px;">Saldo Atual da Conta</div>
              <div class="val" style="font-size:22px; font-weight:800; color:\${stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)'}">
                \${fmt(stats.currentBalance)}
              </div>
              <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-dim); margin-top:8px; padding-top:8px; border-top:1px dashed var(--card-border);">
                <span>Entradas: <strong style="color:var(--green);">\${fmt(stats.periodIn)}</strong></span>
                <span>Saídas: <strong style="color:var(--red);">\${fmt(stats.spentTotal)}</strong></span>
              </div>
              <div style="margin-top:8px; min-height:22px; display:flex; align-items:center; justify-content:flex-end;">
                <span style="font-size:10.5px; color:var(--text-faint);">Saldo inicial: \${fmt(stats.initialBalance)}</span>
              </div>
            </div>
          \`}
        </div>
        <button class="btn-ghost" data-viewcardtx="\${a.name}" style="padding:6px 12px; font-size:11.5px; margin-top:12px; width:100%; border-radius:8px; border:1px solid var(--card-border); background:rgba(255,255,255,0.03); color:var(--text-dim); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          🔍 Ver lançamentos desta conta (\${stats.txCount})
        </button>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">🏦</div><h3>Nenhuma conta cadastrada</h3></div>\`}
  </div>\`;
}

function pageOrcamentos(){
  const list = budgetStatus();
  return \`
  <div class="page-head">
    <div><h1>Orçamentos</h1><p>Limites de gastos por categoria — \${periodLabel()}</p></div>
    <div class="head-actions">\${periodPickerHTML()}<button class="btn-primary" id="btnNovoOrcamento">+ Novo Orçamento</button></div>
  </div>
  <div class="cat-cards">
    \${list.length? list.map(b=>{
      const color = b.pct>=100?'var(--red)': b.pct>=80?'var(--orange)':'var(--green)';
      return \`<div class="cat-card">
        <div class="top">
          <div class="id-group"><span class="dot" style="background:\${catColor(b.category)}"></span><h4>\${b.category}</h4></div>
          <div class="row-actions"><button data-editorc="\${b.id}" title="Editar">✎</button><button data-delorc="\${b.id}" title="Excluir">🗑</button></div>
        </div>
        <span style="color:\${color};font-size:11.5px;font-weight:600">\${b.pct}% usado</span>
        <div class="amt" style="margin-top:6px">\${fmt(b.spent)} <span style="color:var(--text-faint);font-size:12px;font-weight:400"> / \${fmt(b.limit)}</span></div>
        <div class="bar-split" style="background:var(--card-border)"><div class="g" style="width:\${Math.min(b.pct,100)}%; background:\${color}"></div></div>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">◔</div><h3>Nenhum orçamento definido</h3><p>Crie limites de gastos por categoria para acompanhar seu mês.</p></div>\`}
  </div>\`;
}

function pageMetas(){
  return \`
  <div class="page-head">
    <div><h1>Metas</h1><p>Acompanhe seus objetivos financeiros</p></div>
    <div class="head-actions"><button class="btn-primary" id="btnNovaMeta">+ Nova Meta</button></div>
  </div>
  <div class="cat-cards">
    \${goals.length? goals.map(g=>{
      const pct = Math.min(100, Math.round(g.current/g.target*100));
      return \`<div class="acc-card">
        <div class="top">
          <h3 style="font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${g.name}</h3>
          <div class="row-actions"><button data-editmeta="\${g.id}" title="Editar">✎</button><button data-delmeta="\${g.id}" title="Excluir">🗑</button></div>
        </div>
        <p style="color:var(--text-faint);font-size:11.5px;margin-bottom:10px;">Prazo: \${formatDateBR(g.deadline)}</p>
        <div class="val" style="font-size:18px;">\${fmt(g.current)} <span style="color:var(--text-faint);font-size:12px;font-weight:400"> / \${fmt(g.target)}</span></div>
        <div class="bar-split" style="background:var(--card-border);margin-top:10px"><div class="g" style="width:\${pct}%"></div></div>
        <div class="split-labels" style="margin-top:6px"><span>\${pct}% concluído</span></div>
        <button class="btn-ghost" style="width:100%;margin-top:12px" data-addcontrib="\${g.id}">+ Adicionar valor</button>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">◎</div><h3>Nenhuma meta cadastrada</h3></div>\`}
  </div>\`;
}

function pageRelatorios(){
  const list = transactions.filter(inPeriod);
  const allCats = despesasPorCategoria(list);
  const totalReceitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const totalDespesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const resultado = totalReceitas - totalDespesas;

  const totalReceitasGeral = transactions.filter(t=>t.type==='in').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const totalDespesasGeral = transactions.filter(t=>t.type==='out').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const resultadoGeral = totalReceitasGeral - totalDespesasGeral;

  const isAllDates = currentPeriod.month === 0;

  return \`
  <div class="page-head">
    <div>
      <h1>Relatórios Financeiros</h1>
      <p>Análise consolidada das suas transações — <strong>\${periodLabel()}</strong></p>
    </div>
    <div class="head-actions">
      \${periodPickerHTML()}
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:20px;">
    <div class="kpi">
      <div class="row1">Total de Receitas <span class="ic" style="background:var(--green-soft);color:var(--green)">↑</span></div>
      <div class="val" style="color:var(--green)">\${fmt(totalReceitas)}</div>
      <div class="sub">\${isAllDates ? 'Consolidado histórico geral' : periodLabel()}</div>
    </div>
    <div class="kpi">
      <div class="row1">Total de Despesas <span class="ic" style="background:var(--red-soft);color:var(--red)">↓</span></div>
      <div class="val" style="color:var(--red)">\${fmt(totalDespesas)}</div>
      <div class="sub">\${isAllDates ? 'Consolidado histórico geral' : periodLabel()}</div>
    </div>
    <div class="kpi">
      <div class="row1">Balanço do Período <span class="ic" style="background:rgba(74,144,226,.14);color:var(--blue)">⇄</span></div>
      <div class="val" style="color:\${resultado<0?'var(--red)':'var(--green)'}">\${fmt(resultado)}</div>
      <div class="sub">\${isAllDates ? 'Resultado acumulado geral' : 'Receitas menos Despesas do mês'}</div>
    </div>
  </div>

  \${!isAllDates ? \`
  <div class="panel" style="margin-bottom:20px; padding:14px 18px; background:rgba(255,255,255,0.02); border:1px solid var(--card-border); border-radius:12px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
    <div style="font-size:12.5px; color:var(--text-dim);">
      💡 <strong>Comparativo Geral Histórico (Todas as Datas):</strong> Receitas <strong>\${fmt(totalReceitasGeral)}</strong> | Despesas <strong>\${fmt(totalDespesasGeral)}</strong> | Saldo Acumulado <strong style="color:\${resultadoGeral<0?'var(--red)':'var(--green)'}">\${fmt(resultadoGeral)}</strong>
    </div>
    <button class="btn-ghost" onclick="currentPeriod={year:new Date().getFullYear(), month:0}; try{localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod));}catch(e){} render();" style="font-size:11.5px; padding:4px 10px; border-radius:6px; cursor:pointer;">
      🌐 Ver Relatório Geral (Histórico Completo)
    </button>
  </div>
  \` : ''}

  <div class="table-panel">
    <div class="panel-head">
      <h3>Despesas por Categoria — \${periodLabel()}</h3>
      <span class="tag">\${list.filter(t=>t.type==='out').length} despesa(s) no período</span>
    </div>
    \${allCats.length ? \`
    <table>
      <thead>
        <tr>
          <th>Categoria</th>
          <th>Total Gasto</th>
          <th>% do Total de Despesas</th>
        </tr>
      </thead>
      <tbody>
        \${allCats.map(c=>\`
          <tr class="trow">
            <td><span class="pill" style="background:\${c.color}22;color:\${c.color}">\${catIcon(c.name)} \${c.name}</span></td>
            <td class="val-out">\${fmt(c.val)}</td>
            <td>
              <div style="display:flex; align-items:center; gap:10px;">
                <div class="bar-split" style="flex:1; max-width:120px; height:6px; background:var(--card-border); border-radius:4px; overflow:hidden;">
                  <div class="g" style="width:\${Math.round(c.val/(totalDespesas||1)*100)}%; height:100%; background:\${c.color}; border-radius:4px;"></div>
                </div>
                <span style="font-weight:700; font-size:12px; color:var(--text-dim);">\${Math.round(c.val/(totalDespesas||1)*100)}%</span>
              </div>
            </td>
          </tr>
        \`).join('')}
      </tbody>
      <tfoot>
        <tr style="background:var(--hover); font-weight:700; border-top:2px solid var(--card-border);">
          <td style="font-size:12.5px; color:var(--text-dim);">TOTAL DAS DESPESAS DO PERÍODO:</td>
          <td style="color:var(--red); font-size:14.5px; font-weight:800;">\${fmt(totalDespesas)}</td>
          <td>100%</td>
        </tr>
      </tfoot>
    </table>
    \` : \`
    <div class="placeholder"><div class="big">▥</div><h3>Nenhuma despesa no período</h3><p>Não foram encontradas despesas cadastradas para \${periodLabel()}.</p></div>
    \`}
  </div>\`;
}

function pageRecorrentes(){
  return \`
  <div class="page-head">
    <div><h1>Lançamentos Recorrentes</h1><p>Transações que se repetem automaticamente</p></div>
    <div class="head-actions"><button class="btn-primary" id="btnNovoRecorrente">+ Novo Recorrente</button></div>
  </div>
  <div class="table-panel">
    \${recurringList.length? \`<table><thead><tr><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Frequência</th><th>Dia</th><th>Tipo</th><th>Valor</th><th></th></tr></thead>
    <tbody>\${recurringList.map(r=>\`<tr class="trow">
      <td>\${r.desc}</td>
          <td><span class="pill" style="background:\${catColor(r.cat)}22;color:\${catColor(r.cat)}">\${r.cat}</span></td>
      <td>\${r.acc}</td><td>\${r.freq}</td><td>Dia \${r.day}</td>
      <td><span class="type-ic \${r.type}">\${r.type==='in'?'↑':'↓'}</span></td>
      <td class="\${r.type==='in'?'val-in':'val-out'}">\${r.type==='in'?'+':'-'}\${fmt(r.val)}</td>
      <td><div class="row-actions"><button data-lancar="\${r.id}" title="Lançar agora">▶</button><button data-editrec="\${r.id}">✎</button><button data-delrec="\${r.id}">🗑</button></div></td>
    </tr>\`).join('')}</tbody></table>\` : \`<div class="placeholder"><div class="big">↻</div><h3>Nenhum lançamento recorrente</h3></div>\`}
  </div>\`;
}

function pageImportar(){
  return \`
  <div class="page-head"><div><h1>Importar OFX / CSV</h1><p>Importe extratos bancários em lote</p></div></div>
  <div class="panel">
    <p style="color:var(--text-dim);font-size:12.5px;margin-bottom:14px;">
      Formato CSV esperado: <code>data,descricao,valor</code>. Arquivos <b>.ofx</b> também são aceitos.
    </p>
    <div class="field-row">
      <div class="field"><label>Conta de destino</label><select id="impConta">\${accounts.map(a=>\`<option>\${a.name} — \${a.type}</option>\`).join('')}</select></div>
      <div class="field"><label>Categoria padrão</label><select id="impCategoria">\${categories.map(c=>\`<option>\${c.name}</option>\`).join('')}</select></div>
    </div>
    <div class="field"><label>Arquivo</label><input type="file" id="importFile" accept=".csv,.ofx,.txt"></div>
    <div id="importPreview"></div>
  </div>\`;
}

function getAttachmentCoverHtml(a, t){
  const isImage = (a.type && a.type.startsWith('image/')) || (a.dataUrl && a.dataUrl.startsWith('data:image/'));
  if (isImage && a.dataUrl) {
    return \`<img src="\${a.dataUrl}" style="width:100%; height:150px; object-fit:cover; border-radius:12px; border:1px solid var(--card-border); transition:transform 0.2s ease;">\`;
  }

  const nameSearch = ((a.name || '') + ' ' + (t ? t.desc : '')).toLowerCase();
  
  let bName = 'Fatura / Comprovante';
  let bSub = 'Documento Digital';
  let bBg = 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
  let accentColor = '#38bdf8';
  let logoBadge = \`<div style="width:40px; height:40px; border-radius:10px; background:rgba(56,189,248,0.18); border:1px solid rgba(56,189,248,0.35); display:flex; align-items:center; justify-content:center; font-size:20px;">📄</div>\`;

  if (nameSearch.includes('tim')) {
    bName = 'TIM Brasil';
    bSub = 'Fatura Telefonia / GSM';
    bBg = 'linear-gradient(135deg, #021b3b 0%, #004691 100%)';
    accentColor = '#60a5fa';
    logoBadge = \`<div style="width:44px; height:40px; border-radius:10px; background:#0056b3; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:900; color:#fff; font-family:sans-serif; letter-spacing:1px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">TIM</div>\`;
  } else if (nameSearch.includes('claro')) {
    bName = 'Claro Telecom';
    bSub = 'Fatura Fixo / Móvel';
    bBg = 'linear-gradient(135deg, #3f0415 0%, #be123c 100%)';
    accentColor = '#fecdd3';
    logoBadge = \`<div style="width:48px; height:40px; border-radius:10px; background:#e11d48; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">claro_</div>\`;
  } else if (nameSearch.includes('vivo')) {
    bName = 'Vivo Telefonia';
    bSub = 'Fatura Móvel / Fibra';
    bBg = 'linear-gradient(135deg, #2e0854 0%, #6d28d9 100%)';
    accentColor = '#ddd6fe';
    logoBadge = \`<div style="width:44px; height:40px; border-radius:10px; background:#7c3aed; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">vivo</div>\`;
  } else if (nameSearch.includes('nu') || nameSearch.includes('nubank')) {
    bName = 'Nubank';
    bSub = 'Fatura Cartão de Crédito';
    bBg = 'linear-gradient(135deg, #2a0346 0%, #7609bc 100%)';
    accentColor = '#e9d5ff';
    logoBadge = \`<div style="width:40px; height:40px; border-radius:10px; background:#820ad1; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:17px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">Nu</div>\`;
  } else if (nameSearch.includes('inter')) {
    bName = 'Banco Inter';
    bSub = 'Fatura / Extrato Conta';
    bBg = 'linear-gradient(135deg, #381005 0%, #ea580c 100%)';
    accentColor = '#ffedd5';
    logoBadge = \`<div style="width:44px; height:40px; border-radius:10px; background:#f97316; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">inter</div>\`;
  } else if (nameSearch.includes('itau') || nameSearch.includes('itaú')) {
    bName = 'Itaú Unibanco';
    bSub = 'Fatura Cartão / Comprovante';
    bBg = 'linear-gradient(135deg, #381005 0%, #c2410c 100%)';
    accentColor = '#fed7aa';
    logoBadge = \`<div style="width:42px; height:40px; border-radius:10px; background:#ec5c00; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">Itaú</div>\`;
  } else if (nameSearch.includes('bradesco')) {
    bName = 'Bradesco';
    bSub = 'Fatura Cartão / Extrato';
    bBg = 'linear-gradient(135deg, #3f0415 0%, #cc092f 100%)';
    accentColor = '#fecdd3';
    logoBadge = \`<div style="width:46px; height:40px; border-radius:10px; background:#dc2626; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">Brad</div>\`;
  } else if (nameSearch.includes('santander')) {
    bName = 'Santander';
    bSub = 'Fatura Cartão / Extrato';
    bBg = 'linear-gradient(135deg, #380707 0%, #dc2626 100%)';
    accentColor = '#fecdd3';
    logoBadge = \`<div style="width:42px; height:40px; border-radius:10px; background:#ec0000; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">S</div>\`;
  } else if (nameSearch.includes('bb') || nameSearch.includes('banco do brasil')) {
    bName = 'Banco do Brasil';
    bSub = 'Comprovante / Extrato';
    bBg = 'linear-gradient(135deg, #101c42 0%, #1d4ed8 100%)';
    accentColor = '#fef08a';
    logoBadge = \`<div style="width:40px; height:40px; border-radius:10px; background:#1e3a8a; border:1px solid #facc15; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:900; color:#facc15; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">BB</div>\`;
  } else if (nameSearch.includes('caixa') || nameSearch.includes('cef')) {
    bName = 'CAIXA Econômica';
    bSub = 'Comprovante de Pagamento';
    bBg = 'linear-gradient(135deg, #093752 0%, #0284c7 100%)';
    accentColor = '#bae6fd';
    logoBadge = \`<div style="width:44px; height:40px; border-radius:10px; background:#005ca9; border:1px solid rgba(255,255,255,0.3); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:900; color:#fff; font-family:sans-serif; box-shadow:0 4px 10px rgba(0,0,0,0.3);">CAIXA</div>\`;
  } else if (nameSearch.includes('enel') || nameSearch.includes('cemig') || nameSearch.includes('copel') || nameSearch.includes('cpfl') || nameSearch.includes('light') || nameSearch.includes('luz') || nameSearch.includes('energia')) {
    bName = 'Energia Elétrica';
    bSub = 'Conta de Luz';
    bBg = 'linear-gradient(135deg, #361502 0%, #ca8a04 100%)';
    accentColor = '#fef08a';
    logoBadge = \`<div style="width:40px; height:40px; border-radius:10px; background:rgba(234,179,8,0.25); border:1px solid rgba(234,179,8,0.5); display:flex; align-items:center; justify-content:center; font-size:20px; color:#fef08a;">⚡</div>\`;
  } else if (nameSearch.includes('sabesp') || nameSearch.includes('sanepar') || nameSearch.includes('copasa') || nameSearch.includes('agua') || nameSearch.includes('água')) {
    bName = 'Água / Saneamento';
    bSub = 'Conta de Água';
    bBg = 'linear-gradient(135deg, #062337 0%, #0284c7 100%)';
    accentColor = '#bae6fd';
    logoBadge = \`<div style="width:40px; height:40px; border-radius:10px; background:rgba(2,132,199,0.25); border:1px solid rgba(2,132,199,0.5); display:flex; align-items:center; justify-content:center; font-size:20px; color:#bae6fd;">💧</div>\`;
  } else if (nameSearch.includes('internet') || nameSearch.includes('fibra') || nameSearch.includes('wifi')) {
    bName = 'Internet & Fibra';
    bSub = 'Fatura Conectividade';
    bBg = 'linear-gradient(135deg, #052733 0%, #0891b2 100%)';
    accentColor = '#cffaff';
    logoBadge = \`<div style="width:40px; height:40px; border-radius:10px; background:rgba(8,145,178,0.25); border:1px solid rgba(8,145,178,0.5); display:flex; align-items:center; justify-content:center; font-size:20px; color:#cffaff;">🌐</div>\`;
  }

  return \`
  <div style="width:100%; height:150px; background:\${bBg}; border-radius:14px; border:1px solid rgba(255,255,255,0.14); padding:14px 16px; position:relative; overflow:hidden; display:flex; flex-direction:column; justify-content:space-between; box-shadow:0 8px 24px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.2); transition:all 0.3s ease;">
    <div style="position:absolute; top:0; left:0; right:0; height:3px; background:linear-gradient(90deg, transparent, \${accentColor}, transparent);"></div>
    <div style="position:absolute; right:-15px; bottom:-15px; font-size:80px; opacity:0.06; user-select:none; pointer-events:none; font-weight:900;">📄</div>

    <div style="display:flex; align-items:center; justify-content:space-between; z-index:2;">
      <div style="display:flex; align-items:center; gap:12px; max-width:80%;">
        \${logoBadge}
        <div style="text-align:left;">
          <div style="font-size:15px; font-weight:900; color:#ffffff; line-height:1.2; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            \${bName}
          </div>
          <div style="font-size:11.5px; font-weight:600; color:rgba(255,255,255,0.75); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            \${bSub}
          </div>
        </div>
      </div>
      <div style="background:rgba(0,0,0,0.4); backdrop-filter:blur(6px); border:1px solid rgba(255,255,255,0.18); padding:3px 8px; border-radius:6px; font-size:10.5px; font-weight:800; color:#ffffff; display:flex; align-items:center; gap:4px;">
        <span style="color:#ef4444; font-size:12px;">📄</span> PDF
      </div>
    </div>

    <div style="background:rgba(0,0,0,0.22); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px 12px; z-index:2; backdrop-filter:blur(4px);">
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;">
        <span style="font-size:11px; color:rgba(255,255,255,0.8); font-weight:700; display:flex; align-items:center; gap:4px;">
          <span>🧾</span> Recibo / Fatura Digital
        </span>
        <span style="font-size:10px; color:#4ade80; font-weight:800; background:rgba(74,222,128,0.15); padding:2px 6px; border-radius:4px;">VERIFICADO</span>
      </div>
      <div style="height:3px; background:rgba(255,255,255,0.2); border-radius:2px; width:65%; margin-bottom:4px;"></div>
      <div style="height:3px; background:rgba(255,255,255,0.12); border-radius:2px; width:40%;"></div>
    </div>
  </div>\`;
}

function pageAnexos(){
  const sortedTx = transactions.slice().sort((a,b)=>b.date.localeCompare(a.date));
  return \`
  <div class="page-head">
    <div>
      <h1>Anexos & Comprovantes</h1>
      <p>Cadastre novos comprovantes, vincule a transações e faça downloads dos arquivos</p>
    </div>
  </div>

  <div class="panel" style="margin-bottom:22px;">
    <div style="margin-bottom:16px;">
      <h3 style="font-size:18px; font-weight:800; display:flex; align-items:center; gap:8px; margin:0;">
        <span>📎</span> Cadastrar / Incluir Novos Anexos
      </h3>
      <p style="font-size:13.5px; color:var(--text-faint); margin-top:4px;">
        Vincule a uma transação opcional e selecione os arquivos para salvar automaticamente.
      </p>
    </div>

    <div style="margin-bottom:16px;">
      <label style="font-size:13.5px; font-weight:700; margin-bottom:6px; display:block; color:var(--text);">Vincular a uma Transação (Opcional)</label>
      <select id="attTx" style="width:100%; font-size:14px; padding:10px 14px; height:44px; border-radius:8px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
        <option value="0">Nenhuma (Anexo Avulso / Recibo Padrão)</option>
        \${sortedTx.map(t=>\`<option value="\${t.id}">\${formatDateBR(t.date)} — \${t.desc} (\${fmt(t.val)})</option>\`).join('')}
      </select>
    </div>

    <div id="attDropZone" style="border: 2px dashed var(--green); border-radius: 16px; padding: 32px 20px; text-align: center; cursor: pointer; background: rgba(34, 197, 94, 0.04); transition: all 0.2s ease; position: relative;">
      <input type="file" id="attFile" multiple accept="image/*,.pdf,.doc,.docx,.txt" style="display:none;">
      <span style="font-size: 38px; display: block; margin-bottom: 10px; filter: drop-shadow(0 2px 8px rgba(0,0,0,0.3));">☁️</span>
      <p style="margin:0; font-weight:800; font-size:16px; color:var(--text);">Arraste seus arquivos para cá ou <span style="color:var(--green); text-decoration:underline;">clique para selecionar e anexar</span></p>
      <p style="margin-top:6px; font-size:13px; color:var(--text-faint); margin-bottom:0;">Suporta imagens (PNG, JPG, WebP), recibos em PDF e documentos</p>
    </div>
  </div>

  <div style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between;">
    <h3 style="font-size:17px; font-weight:800;">Anexos Cadastrados (\${attachments.length})</h3>
  </div>

  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:20px;">
    \${attachments.length? attachments.map(a=>{
      const t = transactions.find(x=>x.id===a.txId);
      const isImage = (a.type && a.type.startsWith('image/')) || (a.dataUrl && a.dataUrl.startsWith('data:image/'));
      const isPdf = (a.type && a.type.includes('pdf')) || (a.dataUrl && a.dataUrl.startsWith('data:application/pdf')) || (a.name && a.name.toLowerCase().endsWith('.pdf'));

      return \`
      <div class="cat-card" style="display:flex; flex-direction:column; justify-content:space-between; padding:18px; border-radius:16px; border:1px solid var(--card-border); background:var(--card); box-shadow: 0 4px 16px rgba(0,0,0,0.15);">
        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <span style="font-size:12.5px; font-weight:700; color:var(--text-dim); display:flex; align-items:center; gap:6px;">
              \${isPdf ? '📄 Fatura PDF' : isImage ? '🖼️ Imagem Anexa' : '📎 Documento'}
            </span>
            <button data-delatt="\${a.id}" title="Excluir Anexo" style="width:auto; height:32px; padding:0 10px; border-radius:8px; background:rgba(239, 68, 68, 0.15); color:#ef4444; border:1px solid rgba(239, 68, 68, 0.3); font-size:12.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:4px; white-space:nowrap;">🗑 Excluir</button>
          </div>

          <div style="cursor:pointer; text-align:center; margin-bottom:12px;" data-previewatt="\${a.id}" title="Clique para Visualizar">
            \${getAttachmentCoverHtml(a, t)}
          </div>

          <h4 style="font-size:15px; font-weight:700; margin-bottom:8px; word-break:break-word; color:var(--text); line-height:1.3;">\${a.name}</h4>
          
          <div style="margin-top:12px;">
            <label style="display:block; font-size:12.5px; color:var(--text-faint); margin-bottom:5px; font-weight:700;">Transação Vinculada:</label>
            <select data-relinkatt="\${a.id}" style="width:100%; font-size:13px; padding:8px 12px; border-radius:8px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600; min-height:38px;">
              <option value="0" \${!a.txId ? 'selected' : ''}>Sem vincular (Anexo Avulso)</option>
              \${sortedTx.map(tx => \`<option value="\${tx.id}" \${tx.id === a.txId ? 'selected' : ''}>\${formatDateBR(tx.date)} — \${tx.desc}</option>\`).join('')}
            </select>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:10px; margin-top:16px; padding-top:14px; border-top:1px solid var(--card-border);">
          \${a.dataUrl ? \`
            <a href="\${a.dataUrl}" download="\${a.name || 'comprovante'}" class="btn-primary" style="flex:1.2; padding:10px 14px; font-size:13.5px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:8px; min-height:42px;" title="Baixar Arquivo">
              📥 Baixar
            </a>
            <button data-previewatt="\${a.id}" class="btn-ghost" style="flex:1; padding:10px 14px; font-size:13.5px; font-weight:700; border-radius:8px; min-height:42px; background:rgba(255,255,255,0.08); border:1px solid var(--card-border); color:var(--text); display:inline-flex; align-items:center; justify-content:center; gap:6px;" title="Visualizar">
              👁️ Ver
            </button>
          \` : \`
            <span style="font-size:12px; color:var(--text-faint);">Sem arquivo salvo</span>
          \`}
        </div>
      </div>
      \`;
    }).join('') : \`
      <div class="placeholder" style="grid-column:1/-1; padding:40px 20px;">
        <div class="big">📎</div>
        <h3>Nenhum anexo cadastrado</h3>
        <p>Utilize o formulário acima para enviar comprovantes ou recibos das suas transações.</p>
      </div>
    \`}
  </div>\`;
}

function pageAlertas(){
  const bstat = budgetStatus();
  return \`
  <div class="page-head">
    <div><h1>Alertas</h1><p>Avisos automáticos de orçamento — \${periodLabel()}</p></div>
    <div class="head-actions"><button class="btn-primary" id="btnNovoAlerta">+ Novo Alerta</button></div>
  </div>
  <div class="cat-cards">
    \${alerts.length? alerts.map(al=>{
      const b = bstat.find(x=>x.category===al.category);
      const pct = b? b.pct : null;
      const triggered = pct!==null && pct>=al.threshold;
      return \`<div class="cat-card">
        <div class="top">
          <div class="id-group"><span class="dot" style="background:\${triggered?'var(--red)':'var(--green)'}"></span><h4>\${al.category}</h4></div>
          <div class="row-actions"><button data-editalert="\${al.id}" title="Editar">✎</button><button data-delalert="\${al.id}" title="Excluir">🗑</button></div>
        </div>
        <span class="pill" style="background:\${triggered?'var(--red-soft)':'var(--green-soft)'};color:\${triggered?'var(--red)':'var(--green)'}">\${triggered?'⚠ Alerta ativo':'OK'}</span>
        <p style="color:var(--text-faint);font-size:11.5px;margin-top:8px;">Aciona em \${al.threshold}% do orçamento</p>
        <div class="amt" style="font-size:14px;margin-top:4px;">\${b? \`\${pct}% usado (\${fmt(b.spent)} / \${fmt(b.limit)})\` : 'Sem orçamento definido para esta categoria'}</div>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">🔔</div><h3>Nenhum alerta configurado</h3><p>Crie alertas para ser avisado quando o gasto de uma categoria se aproximar do limite.</p></div>\`}
  </div>\`;
}

function pageConfig(){
  return \`
  <div class="page-head"><div><h1>Configurações</h1><p>Preferências da conta, aparência e tamanho de visualização por dispositivo</p></div></div>
  \${isViewingOtherUser ? \`
  <div class="panel" style="margin-bottom:18px;">
    <p class="cfg-hint" style="margin:0;">Você está em modo de visualização (somente leitura) dos dados de <strong style="color:var(--green);">\${currentUser ? currentUser.name : ''}</strong>. Edições de conta ficam disponíveis apenas na sua própria conta.</p>
  </div>\` : \`
  <div class="cfg-grid">
    <div class="panel">
      <div class="panel-head"><h3>Minha Conta</h3></div>
      <div class="field"><label>Nome</label><input id="cfgName" value="\${currentUser ? currentUser.name : ''}" placeholder="Seu nome completo" autocomplete="name"></div>
      <div class="field" style="margin-bottom:0;"><label>E-mail</label><input id="cfgEmail" type="text" value="\${currentUser ? currentUser.email : ''}" placeholder="seu.email@exemplo.com" autocomplete="email"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Aparência & Escala da Tela</h3></div>
      <div class="field"><label>Tema do Sistema</label>
        <select id="cfgTheme"><option value="dark">Escuro 🌙</option><option value="light">Claro ☀️</option></select>
      </div>
      <div class="field" style="margin-bottom:10px;"><label>Tamanho de Visualização</label>
        <select id="cfgScale">
          <option value="auto">⚡ Auto (Adequar ao Dispositivo Logado)</option>
          <option value="80%">🔍 80% (Compacto)</option>
          <option value="90%">🔍 90% (Reduzido)</option>
          <option value="100%">🔍 100% (Padrão 1:1)</option>
          <option value="110%">🔍 110% (Ampliado)</option>
          <option value="125%">🔍 125% (Grande)</option>
          <option value="150%">🔍 150% (Extra Grande)</option>
        </select>
      </div>
      <div id="cfgDeviceInfo"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h3>Alterar Senha</h3></div>
      <p class="cfg-hint">Preencha apenas se quiser alterar sua senha de acesso</p>
      <div class="field">
        <label>Nova Senha <span style="color:var(--text-faint); font-size:11px;">(opcional)</span></label>
        <div class="pass-field">
          <input id="cfgPassword" type="password" placeholder="••••••••" minlength="6" autocomplete="new-password">
          <button type="button" class="pass-toggle" id="cfgPasswordToggle" tabindex="-1" aria-label="Mostrar senha">\${EYE_ICON}</button>
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>Confirmar Nova Senha <span style="color:var(--text-faint); font-size:11px;">(opcional)</span></label>
        <div class="pass-field">
          <input id="cfgPasswordConfirm" type="password" placeholder="••••••••" minlength="6" autocomplete="new-password">
          <button type="button" class="pass-toggle" id="cfgPasswordConfirmToggle" tabindex="-1" aria-label="Mostrar senha">\${EYE_ICON}</button>
        </div>
      </div>
    </div>
  </div>
  <div class="cfg-save-bar"><button class="btn-primary" id="btnSalvarConfig">Salvar Alterações</button></div>\`}\`;
}

/* ==================== Aba 4K: Central de Funções & Permissões ==================== */
function pageFuncoes(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return \`<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área de Gestão de Funções é exclusiva para administradores.</p></div>\`;
  }
  const userRole = (currentUser && currentUser.role) || 'Usuário';
  const totalUsers = registeredUsers ? registeredUsers.length : 1;
  const adminCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Administrador').length : 1;
  const standardCount = totalUsers - adminCount;

  return \`
  <div class="page-head">
    <div>
      <h1 style="display:flex; align-items:center; gap:10px;">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg, rgba(232,176,75,0.25), rgba(201,134,42,0.15)); border:1px solid rgba(232,176,75,0.4); color:#fbbf24; font-size:18px;">🛡️</span>
        Central de Funções & Permissões
      </h1>
      <p>Gerencie papéis de usuários, matriz de controle de acessos, privilégios e rotinas funcionais do sistema em 4K</p>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <span class="tag" style="background:rgba(232,176,75,0.15); color:#fbbf24; border:1px solid rgba(232,176,75,0.3); font-weight:700; padding:6px 12px; border-radius:20px; font-size:12px;">
        ⚡ Modo \${userRole}
      </span>
    </div>
  </div>

  <!-- Cards de Resumo Executivo das Funções 4K -->
  <div class="kpis" style="margin-bottom:20px;">
    <div class="kpi" style="border:1px solid rgba(232,176,75,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95)); shadow:0 10px 30px rgba(0,0,0,0.5);">
      <div class="kpi-head"><span class="lbl">Sua Função Atual</span><span class="ic" style="background:rgba(232,176,75,0.2); color:#fbbf24;">👑</span></div>
      <div class="val" style="color:#fbbf24; font-size:22px;">\${userRole}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">Nível de Privilégio: \${isAdmin ? 'Acesso Total (Nível 1)' : 'Acesso Padrão (Nível 2)'}</div>
    </div>
    <div class="kpi" style="border:1px solid rgba(16,185,129,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95));">
      <div class="kpi-head"><span class="lbl">Usuários & Administradores</span><span class="ic" style="background:rgba(16,185,129,0.2); color:#10b981;">👥</span></div>
      <div class="val" style="color:#10b981; font-size:22px;">\${totalUsers} Cadastrado\${totalUsers===1?'':'s'}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">\${adminCount} Admins · \${standardCount} Operadores</div>
    </div>
    <div class="kpi" style="border:1px solid rgba(59,130,246,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95));">
      <div class="kpi-head"><span class="lbl">Módulos & Capacidades</span><span class="ic" style="background:rgba(59,130,246,0.2); color:#3b82f6;">⚙️</span></div>
      <div class="val" style="color:#3b82f6; font-size:22px;">12 Módulos Ativos</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">Proteção Criptografada SSL / JWT</div>
    </div>
  </div>

  <!-- Matriz de Funções & Controle de Acessos 4K -->
  <div class="panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25); background:var(--card);">
    <div class="panel-head">
      <h3>Matriz de Permissões por Função do Sistema</h3>
      <span class="tag" style="cursor:default; background:rgba(232,176,75,0.12); color:#fbbf24; border-color:rgba(232,176,75,0.3);">Visão 4K HD</span>
    </div>
    <p class="cfg-hint" style="margin-bottom:16px;">Tabela detalhada de acessos, privilégios de edição e permissões ativas para cada nível de usuário.</p>
    
    <div class="table-panel" style="padding:0; border:none; background:transparent;">
      <table style="width:100%; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--card-border); background:rgba(0,0,0,0.25);">
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">Módulo do Sistema</th>
            <th style="padding:14px 16px; color:#fbbf24; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">👑 Administrador</th>
            <th style="padding:14px 16px; color:#34d399; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">💼 Gerente Financeiro</th>
            <th style="padding:14px 16px; color:#60a5fa; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">👤 Usuário / Operador</th>
            <th style="padding:14px 16px; color:#c084fc; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">🔍 Auditor (Leitura)</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">📊</span> Dashboard Executivo</td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total (Criar/Editar/Excluir)</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Somente Leitura</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">💳</span> Gestão de Transações & Cartões</td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total (Qualquer Usuário)</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Somente Leitura</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">🎯</span> Orçamentos, Metas & Relatórios</td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total + Exportação 4K</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total + Exportação</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Exportação CSV/PDF</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">👥</span> Gerenciamento de Usuários & Contas</td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Controle Total + Modo Espelho 👁️</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Lista de Contas</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">📜</span> Logs de Auditoria & Segurança</td>
            <td style="padding:14px 16px;"><span class="funcoes-badge full">✅ Auditoria Geral + Filtro IP/Email</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Logs Próprios</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Leitura de Eventos</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Central de Rotinas & Automação Funcional 4K -->
  <div class="cfg-grid" style="margin-bottom:20px;">
    <div class="panel" style="border:1px solid rgba(232,176,75,0.2); background:var(--card);">
      <div class="panel-head"><h3>⚡ Status das Rotinas Funcionais</h3></div>
      <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#10b981; box-shadow:0 0 10px #10b981;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Persistência PostgreSQL</strong><div style="font-size:11px; color:var(--text-faint);">Sincronização em tempo real</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:6px;">Online</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#3b82f6; box-shadow:0 0 10px #3b82f6;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Engine de Cálculos 4K</strong><div style="font-size:11px; color:var(--text-faint);">Saldos, faturas & projeções</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#3b82f6; background:rgba(59,130,246,0.15); padding:3px 8px; border-radius:6px;">Ativo</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#f59e0b; box-shadow:0 0 10px #f59e0b;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Auditoria beacon & API Logs</strong><div style="font-size:11px; color:var(--text-faint);">Rastreamento de ações do sistema</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.15); padding:3px 8px; border-radius:6px;">Gravando</span>
        </div>
      </div>
    </div>

    <div class="panel" style="border:1px solid rgba(232,176,75,0.2); background:var(--card);">
      <div class="panel-head"><h3>🛠️ Ferramentas & Teste de Função</h3></div>
      <p class="cfg-hint" style="margin-bottom:14px;">Utilize as ferramentas abaixo para validar o estado e o recálculo imediato de todas as funções ativas.</p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button class="btn-primary" onclick="if(typeof recalculateAllBalances==='function') recalculateAllBalances(); showLoginSuccessPopup('Saldos e funções reprocessados com sucesso!');" style="display:flex; align-items:center; justify-content:center; gap:8px;">
          <span>🔄</span> Recalcular Saldos & Projeções
        </button>
        <button class="btn-ghost" onclick="syncUsersWithServer().then(()=>showLoginSuccessPopup('Funções de usuários atualizadas!'));" style="display:flex; align-items:center; justify-content:center; gap:8px; border-color:rgba(232,176,75,0.3); color:#fbbf24;">
          <span>⚡</span> Sincronizar Tabela de Funções & Usuários
        </button>
      </div>
    </div>
  </div>
  \`;
}

/* ==================== Admin: Usuários Cadastrados ==================== */
function getUserActivitySummary(email){
  const data = loadFromStorage('nexus_data_' + email, null);
  if(!data) return { hasData:false, txCount:0, accCount:0, budCount:0, goalCount:0, lastDate:null };
  const txs = data.transactions || [];
  let lastDate = null;
  txs.forEach(t=>{ if(t.date && (!lastDate || t.date > lastDate)) lastDate = t.date; });
  return {
    hasData:true,
    txCount: txs.length,
    accCount: (data.accounts||[]).length,
    budCount: (data.budgets||[]).length,
    goalCount: (data.goals||[]).length,
    lastDate
  };
}

function pageUsuarios(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return \`<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área é exclusiva para administradores.</p></div>\`;
  }
  return \`
  <div class="page-head"><div><h1>Usuários Cadastrados</h1><p>Administre as contas do sistema e acompanhe a atividade de cada usuário</p></div></div>
  <div class="panel" style="margin-bottom:0;">
    <div class="panel-head"><h3>Todos os usuários</h3><span class="tag" style="cursor:default;">\${registeredUsers.length} usuário\${registeredUsers.length===1?'':'s'}</span></div>
    <p class="cfg-hint" style="margin-bottom:14px;">Clique no ícone 👁 para entrar na conta de um usuário em modo de visualização e ver tudo que ele cadastrou (transações, cartões, orçamentos, metas, relatórios, anexos etc.).</p>
    <div class="user-admin-list">
      \${registeredUsers.map(u=>{
        const stats = getUserActivitySummary(u.email);
        return \`
        <div class="user-row \${u.active===false?'inactive':''}">
          <div class="user-ic">\${u.name.slice(0,2).toUpperCase()}</div>
          <div class="user-info">
            <div class="n">\${u.name}</div>
            <div class="e">\${u.email}</div>
            <div class="stats">\${stats.hasData ? \`\${stats.txCount} transaç\${stats.txCount===1?'ão':'ões'} · \${stats.accCount} conta\${stats.accCount===1?'':'s'} · \${stats.budCount} orçamento\${stats.budCount===1?'':'s'} · \${stats.goalCount} meta\${stats.goalCount===1?'':'s'}\${stats.lastDate ? \` · última mov. em \${formatDateBR(stats.lastDate)}\` : ''}\` : 'Ainda sem atividade registrada'}</div>
          </div>
          <span class="role-badge \${u.role==='Administrador'?'admin':'user'}">\${u.role}</span>
          \${u.active===false ? '<span class="role-badge inactive">Desativado</span>' : ''}
          \${u.email!==currentUser.email ? \`<button class="row-view" data-viewuser="\${u.email}" title="Visualizar tudo que este usuário fez">👁</button>\` : ''}
          \${u.email!==currentUser.email ? \`<button class="row-toggle" data-toggleuser="\${u.email}" title="\${u.active===false?'Ativar usuário':'Desativar usuário'}">\${u.active===false?'✅':'🚫'}</button>\` : ''}
          <button class="row-edit" data-edituser="\${u.email}" title="Editar usuário">✎</button>
        </div>\`;
      }).join('')}
    </div>
  </div>\`;
}

/* ==================== Logs de Auditoria do Sistema ==================== */
let systemLogs = [];

async function logActivity(action, entity, details) {
  if (!currentUser) return;
  const logEntry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    user_name: currentUser.name || 'Usuário',
    user_email: currentUser.email || '',
    action: action,
    entity: entity,
    details: details
  };

  systemLogs.unshift(logEntry);
  try {
    saveToStorage('nexus_system_logs', systemLogs.slice(0, 500));
  } catch(e){}

  try {
    const payload = JSON.stringify({
      userName: currentUser.name,
      userEmail: currentUser.email,
      action: action,
      entity: entity,
      details: details
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(window.location.origin + '/api/logs', blob);
    } else {
      fetch(window.location.origin + '/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      }).catch(() => {});
    }
  } catch(e) {}
}

async function loadSystemLogs() {
  try {
    const res = await fetch(window.location.origin + '/api/logs');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        systemLogs = data.filter(l => !l.details || !l.details.includes('salvou e sincronizou suas alterações'));
        saveToStorage('nexus_system_logs', systemLogs.slice(0, 500));
        return systemLogs;
      }
    }
  } catch(e) {}

  const cached = loadFromStorage('nexus_system_logs', null);
  if (Array.isArray(cached) && cached.length > 0) {
    systemLogs = cached.filter(l => !l.details || !l.details.includes('salvou e sincronizou suas alterações'));
  }
  return systemLogs;
}

function renderLogsTable(list) {
  if (!list || list.length === 0) {
    return '<div class="placeholder"><div class="big">📜</div><h3>Nenhum registro de log encontrado</h3><p>As ações e alterações dos usuários serão registradas aqui em tempo real.</p></div>';
  }

  let rowsHtml = list.map(function(l) {
    const dateStr = l.timestamp ? new Date(l.timestamp).toLocaleString('pt-BR') : '—';
    let actionBadgeClass = 'var(--purple)';
    let actionBg = 'rgba(155,107,216,0.15)';
    const actLower = (l.action || '').toLowerCase();
    if (actLower.includes('cria') || actLower.includes('novo') || actLower.includes('adiç')) {
      actionBadgeClass = 'var(--green)';
      actionBg = 'var(--green-soft)';
    } else if (actLower.includes('ediç') || actLower.includes('alter')) {
      actionBadgeClass = 'var(--orange)';
      actionBg = 'rgba(232,176,75,0.15)';
    } else if (actLower.includes('excl') || actLower.includes('remov') || actLower.includes('desativ')) {
      actionBadgeClass = 'var(--red)';
      actionBg = 'var(--red-soft)';
    } else if (actLower.includes('login') || actLower.includes('acesso')) {
      actionBadgeClass = 'var(--blue)';
      actionBg = 'rgba(74,144,226,0.15)';
    }

    let formattedDetails = (l.details || '');
    if (formattedDetails.includes('➔')) {
      const parts = formattedDetails.split(' | ');
      formattedDetails = parts.map(function(part) {
        if (part.includes('➔')) {
          const colonIdx = part.indexOf(': ');
          let fieldName = '';
          let valsStr = part;
          if (colonIdx !== -1) {
            fieldName = part.substring(0, colonIdx);
            valsStr = part.substring(colonIdx + 2);
          }
          const arrowIdx = valsStr.indexOf('➔');
          const oldV = arrowIdx !== -1 ? valsStr.substring(0, arrowIdx).trim() : '';
          const newV = arrowIdx !== -1 ? valsStr.substring(arrowIdx + 1).trim() : '';

          return '<span style="display:inline-flex; align-items:center; margin:2px 4px 2px 0; padding:4px 9px; background:rgba(255,255,255,0.04); border-radius:8px; border:1px solid rgba(255,255,255,0.08); font-size:12px;">'
            + (fieldName ? '<strong style="color:var(--text-dim); margin-right:5px;">' + fieldName + ':</strong> ' : '')
            + '<span style="color:#ef5a5a; text-decoration:line-through; margin-right:4px; opacity:0.85;">' + oldV + '</span>'
            + '<span style="color:#e8b04b; font-weight:bold; margin:0 5px;">➔</span>'
            + '<span style="color:#3ec7c7; font-weight:700;">' + newV + '</span>'
            + '</span>';
        }
        return '<span style="display:inline-block; margin:2px 0;">' + part + '</span>';
      }).join(' ');
    }

    return '<tr class="trow">'
      + '<td style="font-size:12px; color:var(--text-dim); white-space:nowrap;">' + dateStr + '</td>'
      + '<td><div style="display:flex; flex-direction:column;"><strong style="font-size:12.5px;">' + (l.user_name || 'Usuário') + '</strong><span style="font-size:11px; color:var(--text-faint);">' + (l.user_email || '—') + '</span></div></td>'
      + '<td><span class="pill" style="background:' + actionBg + '; color:' + actionBadgeClass + '; font-weight:700;">' + l.action + '</span></td>'
      + '<td><span class="pill" style="background:rgba(255,255,255,0.05); color:var(--text-dim); font-weight:600;">' + l.entity + '</span></td>'
      + '<td style="font-size:12.5px; line-height:1.5;">' + formattedDetails + '</td>'
      + '</tr>';
  }).join('');

  return '<table id="logsTable"><thead><tr><th style="width:160px;">Data e Hora</th><th style="width:200px;">Usuário (Login)</th><th style="width:130px;">Ação</th><th style="width:150px;">Módulo / Entidade</th><th>Informações Alteradas / Detalhes</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>';
}

function filterLogsTable() {
  const query = (document.getElementById('logSearch') ? document.getElementById('logSearch').value : '').toLowerCase().trim();
  const actSel = (document.getElementById('logFilterAction') ? document.getElementById('logFilterAction').value : '').toLowerCase().trim();
  const entSel = (document.getElementById('logFilterEntity') ? document.getElementById('logFilterEntity').value : '').toLowerCase().trim();

  const filtered = systemLogs.filter(l => {
    const textStr = ((l.user_name||'') + ' ' + (l.user_email||'') + ' ' + (l.action||'') + ' ' + (l.entity||'') + ' ' + (l.details||'')).toLowerCase();
    const matchSearch = !query || textStr.includes(query);
    const matchAct = !actSel || (l.action || '').toLowerCase().includes(actSel);
    const matchEnt = !entSel || (l.entity || '').toLowerCase().includes(entSel);
    return matchSearch && matchAct && matchEnt;
  });

  const wrap = document.getElementById('logTableWrap');
  if (wrap) wrap.innerHTML = renderLogsTable(filtered);
}

function pageLogs(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return \`<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área de logs é exclusiva para administradores.</p></div>\`;
  }

  const logs = systemLogs;
  const countTotal = logs.length;
  const countCriacao = logs.filter(l => (l.action||'').toLowerCase().includes('cria') || (l.action||'').toLowerCase().includes('novo')).length;
  const countEdicao = logs.filter(l => (l.action||'').toLowerCase().includes('ediç') || (l.action||'').toLowerCase().includes('altera')).length;
  const countExclusao = logs.filter(l => (l.action||'').toLowerCase().includes('excl') || (l.action||'').toLowerCase().includes('remov')).length;

  return \`
  <div class="page-head">
    <div>
      <h1>Logs do Sistema</h1>
      <p>Histórico completo de auditoria com dados de login e alterações de dados em tempo real</p>
    </div>
    <div class="head-actions">
      <button class="btn-ghost" onclick="loadSystemLogs().then(render)">🔄 Atualizar Logs</button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); margin-bottom:20px;">
    <div class="kpi">
      <div class="row1">Total de Registros <span class="ic" style="background:rgba(74,144,226,.14);color:var(--blue)">📋</span></div>
      <div class="val">\${countTotal}</div>
      <div class="sub">eventos de auditoria</div>
    </div>
    <div class="kpi">
      <div class="row1">Criações <span class="ic" style="background:var(--green-soft);color:var(--green)">➕</span></div>
      <div class="val" style="color:var(--green)">\${countCriacao}</div>
      <div class="sub">novos dados cadastrados</div>
    </div>
    <div class="kpi">
      <div class="row1">Edições <span class="ic" style="background:rgba(232,176,75,0.15);color:var(--orange)">✎</span></div>
      <div class="val" style="color:var(--orange)">\${countEdicao}</div>
      <div class="sub">registros alterados</div>
    </div>
    <div class="kpi">
      <div class="row1">Exclusões <span class="ic" style="background:var(--red-soft);color:var(--red)">🗑</span></div>
      <div class="val" style="color:var(--red)">\${countExclusao}</div>
      <div class="sub">registros removidos</div>
    </div>
  </div>

  <div class="panel">
    <div class="panel-head" style="margin-bottom:14px;">
      <h3>Filtros de Log</h3>
    </div>
    <div class="filters" style="margin-bottom:16px;">
      <input id="logSearch" placeholder="Buscar por usuário, e-mail, ação ou detalhe..." onkeyup="filterLogsTable()">
      <select id="logFilterAction" onchange="filterLogsTable()">
        <option value="">Todas as ações</option>
        <option value="cria">Criação</option>
        <option value="ediç">Edição</option>
        <option value="excl">Exclusão</option>
        <option value="login">Login / Acesso</option>
      </select>
      <select id="logFilterEntity" onchange="filterLogsTable()">
        <option value="">Todas as entidades</option>
        <option value="transa">Transação</option>
        <option value="conta">Conta / Cartão</option>
        <option value="categor">Categoria</option>
        <option value="orçament">Orçamento</option>
        <option value="meta">Meta</option>
        <option value="usuár">Usuário</option>
      </select>
    </div>

    <div id="logTableWrap">
      \${renderLogsTable(logs)}
    </div>
  </div>
  \`;
}

/* ==================== Charts ==================== */
function drawDashboardCharts(){
  const periodTx = transactions.filter(inPeriod);
  const {receitas,despesas} = computeTotals(periodTx);
  Object.values(charts).forEach(c=>c && c.destroy && c.destroy());
  const ctx1 = document.getElementById('chartResumo');
  if(ctx1) charts.resumo = new Chart(ctx1, {
    type:'doughnut',
    data:{ 
      labels: ['Receitas', 'Despesas'],
      datasets:[{
        data:[receitas||0.0001,despesas||0.0001], 
        backgroundColor:['#10B981','#EF4444'],
        hoverBackgroundColor:['#34D399','#F87171'],
        borderWidth:2,
        borderColor:'rgba(11,15,24,0.6)'
      }] 
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      cutout:'75%',
      plugins:{
        legend:{display:false},
        tooltip:{
          callbacks:{
            label: function(context) {
              return ' ' + context.label + ': ' + fmt(context.raw);
            }
          }
        }
      }
    }
  });
  const cats = despesasPorCategoria(periodTx);
  const ctx2 = document.getElementById('chartCategorias');
  if(ctx2) charts.categorias = new Chart(ctx2, {
    type:'doughnut',
    data:{ labels:cats.map(c=>c.name), datasets:[{data: cats.length?cats.map(c=>c.val):[1], backgroundColor: cats.length?cats.map(c=>c.color):['#2a2f3a'], borderWidth:0}] },
    options:{cutout:'62%', plugins:{legend:{display:false}}}
  });
}

function populateAccountOptions(selectedAcc) {
  const fConta = document.getElementById('fConta');
  if(!fConta) return;

  const isReceita = (currentType === 'in');
  
  // Na aba de Receita, filtrar para NÃO mostrar Cartões de Crédito!
  let availableAccounts = accounts.slice();
  if (isReceita) {
    availableAccounts = availableAccounts.filter(a => !isAccountCreditCard(a));
  }

  // 1. Mapeia as contas válidas para o tipo atual (ordenadas de A a Z)
  let htmlOptions = availableAccounts.sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' })).map(a => {
    const stats = getCardStats(a);
    const label = stats.isCreditCard 
      ? (a.name + ' (Disp: ' + fmt(stats.availableLimit) + ')') 
      : (a.name + ' (Saldo: ' + fmt(stats.currentBalance) + ')');
    return '<option value="' + a.name + '"' + (selectedAcc === a.name ? ' selected' : '') + '>' + label + '</option>';
  }).join('');

  // 2. Opções adicionais de pagamento / recebimento padrão
  let extraOptions = [
    { value: 'Dinheiro em Espécie', label: '💵 Dinheiro em Espécie' },
    { value: 'Boleto / Pix / Outros', label: '📄 Boleto / Pix / Outros' }
  ];

  if (!isReceita) {
    extraOptions.unshift({ value: 'Cartão de Crédito', label: '💳 Cartão de Crédito' });
  }

  extraOptions.forEach(opt => {
    const existsInAccounts = availableAccounts.some(a => {
      const aName = (a.name || '').toLowerCase().trim();
      const oVal = opt.value.toLowerCase().trim();
      return aName === oVal;
    });

    if (!existsInAccounts) {
      htmlOptions += '<option value="' + opt.value + '"' + (selectedAcc === opt.value ? ' selected' : '') + '>' + opt.label + '</option>';
    }
  });

  if(!htmlOptions) {
    htmlOptions = isReceita
      ? '<option value="Dinheiro em Espécie">💵 Dinheiro em Espécie</option><option value="Boleto / Pix / Outros">📄 Boleto / Pix / Outros</option>'
      : '<option value="Cartão de Crédito">💳 Cartão de Crédito</option><option value="Dinheiro em Espécie">💵 Dinheiro em Espécie</option><option value="Boleto / Pix / Outros">📄 Boleto / Pix / Outros</option>';
    fConta.innerHTML = htmlOptions;
    updateCardLimitHint();
    return;
  }

  fConta.innerHTML = htmlOptions;

  // Se for despesa e categoria contiver 'cartão', seleciona o primeiro cartão de crédito se nenhum foi selecionado
  if(!isReceita) {
    const fCat = document.getElementById('fCategoria');
    if(fCat && (fCat.value || '').toLowerCase().includes('cartão') && !selectedAcc) {
      const firstCard = accounts.find(a => isAccountCreditCard(a));
      if(firstCard) {
        fConta.value = firstCard.name;
      } else {
        fConta.value = 'Cartão de Crédito';
      }
    }
  } else {
    // Na receita, se selectedAcc era um cartão de crédito, reseta para a primeira conta de débito/bancária válida
    if (selectedAcc && accounts.some(a => a.name === selectedAcc && isAccountCreditCard(a))) {
      if (availableAccounts.length > 0) {
        fConta.value = availableAccounts[0].name;
      } else {
        fConta.value = 'Dinheiro em Espécie';
      }
    }
  }

  updateCardLimitHint();
}

function updateCardLimitHint() {
  const fConta = document.getElementById('fConta');
  const hintEl = document.getElementById('cardLimitHint');
  const valorEl = document.getElementById('fValor');
  if(!fConta || !hintEl) return;

  if (currentType === 'in') {
    hintEl.style.display = 'none';
    return;
  }

  const accName = fConta.value;
  const acc = accounts.find(a => a.name === accName || (a.id != null && String(a.id) === String(accName)));

  if(!acc) {
    if ((accName || '').toLowerCase().includes('cartão') || (accName || '').toLowerCase().includes('cartao')) {
      hintEl.style.display = 'flex';
      hintEl.style.background = 'rgba(232,176,75,0.15)';
      hintEl.style.color = 'var(--orange)';
      hintEl.innerHTML = '💳 <span><strong>Cartão de Crédito:</strong> Lançamento como despesa de cartão de crédito</span>';
    } else {
      hintEl.style.display = 'none';
    }
    return;
  }

  const stats = getCardStats(acc);
  const currentVal = parseInputValue(valorEl ? valorEl.value : 0);

  if(stats.isCreditCard) {
    if(currentType === 'in') {
      const newAvailable = stats.availableLimit + currentVal;
      const newSpent = Math.max(0, stats.spentTotal - currentVal);
      hintEl.style.display = 'flex';
      hintEl.style.background = 'var(--green-soft)';
      hintEl.style.color = 'var(--green)';
      hintEl.innerHTML = '💳 <span><strong>Pagamento de Fatura / Estorno:</strong> Limite disp. atual: <strong>' + fmt(stats.availableLimit) + '</strong>' +
        (currentVal > 0 ? (' ➔ <strong>Novo limite disponível:</strong> <strong style="color:var(--green);">' + fmt(newAvailable) + '</strong> (Fatura restante: ' + fmt(newSpent) + ')') : (' (Fatura em aberto: ' + fmt(stats.spentTotal) + ')')) + '</span>';
    } else {
      const newAvailable = stats.availableLimit - currentVal;
      const newSpent = stats.spentTotal + currentVal;
      const isExceeded = newAvailable < 0;
      hintEl.style.display = 'flex';
      hintEl.style.background = (isExceeded || newAvailable < 200) ? 'var(--red-soft)' : 'var(--green-soft)';
      hintEl.style.color = (isExceeded || newAvailable < 200) ? 'var(--red)' : 'var(--green)';
      
      let msg = '💳 <span><strong>Limite Disponível:</strong> <strong>' + fmt(stats.availableLimit) + '</strong> (Limite Total: ' + fmt(stats.totalLimit) + ', Fatura: ' + fmt(stats.spentTotal) + ')';
      if (currentVal > 0) {
        msg += '<br>📉 <strong>Após esta despesa:</strong> Limite disponível ficará em <strong style="font-size:13px; color:' + (isExceeded ? 'var(--red)' : 'var(--green)') + '">' + fmt(newAvailable) + '</strong> (Nova Fatura: ' + fmt(newSpent) + ')';
        if (isExceeded) {
          msg += ' <span style="color:var(--red); font-weight:800;">⚠️ Atenção: Esta despesa ultrapassa o limite disponível!</span>';
        }
      }
      msg += '</span>';
      hintEl.innerHTML = msg;
    }
  } else {
    const newBalance = currentType === 'in' ? (stats.currentBalance + currentVal) : (stats.currentBalance - currentVal);
    hintEl.style.display = 'flex';
    hintEl.style.background = (newBalance < 0) ? 'var(--red-soft)' : 'rgba(74,144,226,0.15)';
    hintEl.style.color = (newBalance < 0) ? 'var(--red)' : 'var(--blue)';
    let msg = '🏦 <span><strong>Saldo Atual:</strong> <strong>' + fmt(stats.currentBalance) + '</strong>';
    if (currentVal > 0) {
      msg += ' ➔ <strong>Após transação:</strong> <strong style="color:' + (newBalance < 0 ? 'var(--red)' : 'var(--green)') + '">' + fmt(newBalance) + '</strong>';
    }
    msg += '</span>';
    hintEl.innerHTML = msg;
  }
}

function updateAccBalanceLabel() {
  const typeEl = document.getElementById('accType');
  const lbl = document.getElementById('accBalanceLabel');
  const inp = document.getElementById('accBalance');
  if(!typeEl || !lbl || !inp) return;
  if(typeEl.value === 'Cartão de Crédito') {
    lbl.textContent = 'Limite Total Aprovado do Cartão (R$)';
    inp.placeholder = 'Ex: 5000,00';
  } else {
    lbl.textContent = 'Saldo Atual da Conta (R$)';
    inp.placeholder = '0,00';
  }
}

/* ==================== Modais e Ações de Dados ==================== */
function openModal(id){
  if(categories.length===0){ showToast('Cadastre uma categoria antes de lançar uma transação'); return; }
  editingId = id || null;
  document.getElementById('overlay').classList.add('show');
  let selectedAcc = accounts[0] ? accounts[0].name : '';
  if(id){
    const t = transactions.find(x=>x.id===id);
    document.getElementById('modalTitle').textContent = 'Editar Transação';
    document.getElementById('fDesc').value = t.desc;
    document.getElementById('fValor').value = t.val;
    document.getElementById('fData').value = t.date;
    setType(t.type);
    document.getElementById('fCategoria').value = t.cat;
    document.getElementById('fStatus').value = t.status;
    if(t.acc) selectedAcc = t.acc;
  } else {
    document.getElementById('modalTitle').textContent = 'Nova Transação';
    document.getElementById('fDesc').value = '';
    document.getElementById('fValor').value = '';
    
    const now = new Date();
    let defaultDate = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
    if (currentPeriod.year !== now.getFullYear() || currentPeriod.month !== (now.getMonth() + 1)) {
      const targetDay = Math.min(now.getDate(), new Date(currentPeriod.year, currentPeriod.month, 0).getDate());
      defaultDate = pd(targetDay);
    }
    document.getElementById('fData').value = defaultDate;
    document.getElementById('fStatus').value = 'Pago';
    setType('out');
  }
  populateAccountOptions(selectedAcc);
  const fContaEl = document.getElementById('fConta');
  if(fContaEl) fContaEl.onchange = updateCardLimitHint;
  const fValorEl = document.getElementById('fValor');
  if(fValorEl) fValorEl.oninput = updateCardLimitHint;
  const fCatEl = document.getElementById('fCategoria');
  if(fCatEl) {
    fCatEl.onchange = () => {
      const fc = document.getElementById('fConta');
      if((fCatEl.value || '').toLowerCase().includes('cartão') || (fCatEl.value || '').toLowerCase().includes('cartao')) {
        const firstCard = accounts.find(a => isAccountCreditCard(a));
        populateAccountOptions(firstCard ? firstCard.name : 'Cartão de Crédito');
      }
    };
  }
  updateCardLimitHint();
}
function closeModal(){ document.getElementById('overlay').classList.remove('show'); }
function parseInputValue(valStr) {
  if (typeof valStr === 'number') return isNaN(valStr) ? 0 : valStr;
  if (!valStr) return 0;
  let cleaned = String(valStr).replace(/[^0-9.,-]/g, '').trim();
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.indexOf('.') < cleaned.indexOf(',')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function populateCategoriaOptions(type){
  const fCat = document.getElementById('fCategoria');
  if(!fCat) return;
  const wantType = type==='in' ? 'receita' : 'despesa';
  const hasOfType = categories.some(c => (c.type||'despesa') === wantType);
  const prev = fCat.value;
  fCat.innerHTML = hasOfType ? catOptionsHTML(wantType) : catOptionsHTML(null);
  const list = hasOfType ? categories.filter(c => (c.type||'despesa') === wantType) : categories;
  if(list.some(c=>c.name===prev)) fCat.value = prev;
}

function setType(t){
  currentType = t;
  const inBtn = document.getElementById('typeInBtn');
  const outBtn = document.getElementById('typeOutBtn');
  if(inBtn) inBtn.className = t==='in' ? 'sel-in' : '';
  if(outBtn) outBtn.className = t==='out' ? 'sel-out' : '';
  populateCategoriaOptions(t);
  const fStatusEl = document.getElementById('fStatus');
  if(fStatusEl && !editingId) {
    fStatusEl.value = t==='in' ? 'Recebido' : 'Pago';
  }
  const fContaLabel = document.getElementById('fContaLabel');
  if(fContaLabel) {
    fContaLabel.textContent = t==='in' ? 'Conta / Cartão de Débito' : 'Conta / Cartão';
  }
  const fContaEl = document.getElementById('fConta');
  if(fContaEl) {
    populateAccountOptions(fContaEl.value);
  }
}

async function saveTransaction(){
  const descEl = document.getElementById('fDesc');
  const valorEl = document.getElementById('fValor');
  const dateEl = document.getElementById('fData');
  const catEl = document.getElementById('fCategoria');
  const statusEl = document.getElementById('fStatus');
  const accEl = document.getElementById('fConta');

  const desc = descEl ? descEl.value.trim() : '';
  const val = parseInputValue(valorEl ? valorEl.value : '');
  const date = dateEl ? dateEl.value : '';
  const cat = catEl ? catEl.value : '';
  const status = statusEl ? statusEl.value : 'Pago';
  const accSel = accEl ? accEl.value : '';

  if(!desc) {
    showToast('⚠️ Por favor, informe a descrição da transação.');
    if(descEl) descEl.focus();
    return;
  }
  if(isNaN(val) || val <= 0) {
    showToast('⚠️ Por favor, informe um valor válido maior que zero (Ex: 100,50).');
    if(valorEl) valorEl.focus();
    return;
  }
  if(!date) {
    showToast('⚠️ Por favor, selecione a data da transação.');
    if(dateEl) dateEl.focus();
    return;
  }
  if(!cat) {
    showToast('⚠️ Por favor, selecione uma categoria.');
    if(catEl) catEl.focus();
    return;
  }

  let targetAcc = accounts.find(a => a.name === accSel);
  if (!targetAcc && (accSel.toLowerCase().includes('cartão') || accSel.toLowerCase().includes('cartao'))) {
    if (desc) {
      const descLower = desc.toLowerCase().trim();
      targetAcc = accounts.find(a => {
        if (!isAccountCreditCard(a)) return false;
        const aName = a.name.toLowerCase().trim();
        const normName = normalizeAccName(a.name);
        return (normName.length >= 3 && descLower.includes(normName)) || (aName.length >= 3 && descLower.includes(aName));
      });
    }
    if (!targetAcc) {
      const creditCards = accounts.filter(a => isAccountCreditCard(a));
      if (creditCards.length > 0) {
        targetAcc = creditCards[0];
      }
    }
  }
  const accId = targetAcc ? targetAcc.id : null;
  const finalAccName = targetAcc ? targetAcc.name : accSel;

  if(editingId){
    const t = transactions.find(x=>x.id===editingId);
    const oldDesc = t.desc;
    const oldVal = t.val;
    const oldCat = t.cat;
    const oldAcc = t.acc;
    const oldDate = t.date;
    const oldStatus = t.status;
    const oldType = t.type;

    if(t.cat !== cat){
      const newCatObj = categories.find(c=>c.name===cat);
      if(newCatObj) newCatObj.count = (newCatObj.count||0)+1;
    }
    Object.assign(t, {desc, val, date, cat, status, type:currentType, acc:finalAccName, accId});
    showToast('Transação atualizada!');

    const changes = [];
    if (oldDesc !== desc) changes.push('Descrição: "' + oldDesc + '" ➔ "' + desc + '"');
    if (oldVal !== val) changes.push('Valor: ' + fmt(oldVal) + ' ➔ ' + fmt(val));
    if (oldCat !== cat) changes.push('Categoria: "' + oldCat + '" ➔ "' + cat + '"');
    if (oldAcc !== finalAccName) changes.push('Conta: "' + (oldAcc||'Sem conta') + '" ➔ "' + (finalAccName||'Sem conta') + '"');
    if (oldDate !== date) changes.push('Data: ' + oldDate + ' ➔ ' + date);
    if (oldStatus !== status) changes.push('Status: ' + oldStatus + ' ➔ ' + status);
    if (oldType !== currentType) changes.push('Tipo: ' + (oldType==='in'?'Receita':'Despesa') + ' ➔ ' + (currentType==='in'?'Receita':'Despesa'));

    const diffText = changes.length > 0 ? changes.join(' | ') : ('Editou transação "' + desc + '" (' + fmt(val) + ')');
    logActivity('Edição', 'Transação', diffText);
  } else {
    transactions.unshift({id: nextTxId++, desc, val, date, cat, status, type: currentType, acc:finalAccName, accId});
    const catObj = categories.find(c=>c.name===cat);
    if(catObj) catObj.count = (catObj.count||0)+1;
    showToast('Transação adicionada!');
    await pushNotification(\`Nova transação cadastrada: \${desc} — \${fmt(val)}\`, currentType==='in' ? '💰' : '💸');
  }
  await saveUserData();
  closeModal();
  render();
}
async function deleteTransaction(id){
  const target = transactions.find(t => t.id === id);
  const desc = target ? target.desc : '';
  transactions = transactions.filter(t => t.id !== id);
  await saveUserData();
  showToast('🗑 Transação ' + (desc ? ('"' + desc + '" ') : '') + 'excluída!');
  logActivity('Exclusão', 'Transação', 'Excluiu transação "' + (desc || id) + '"');
  render();
}

/* ==================== Mapeamento Inteligente de Cores de Bancos e Cartões ==================== */
const BANK_COLOR_MAP = [
  { keywords: ['nubank', 'nu ', 'nu', 'roxinho'], color: '#820ad1', type: 'Cartão de Crédito' },
  { keywords: ['inter', 'banco inter'], color: '#ff7a00', type: 'Conta Corrente' },
  { keywords: ['itau', 'itaú', 'iti'], color: '#ec7000', type: 'Conta Corrente' },
  { keywords: ['bradesco', 'next'], color: '#cc092f', type: 'Conta Corrente' },
  { keywords: ['c6', 'c6bank', 'c6 bank'], color: '#242424', type: 'Conta Corrente' },
  { keywords: ['santander'], color: '#ea1d2c', type: 'Conta Corrente' },
  { keywords: ['caixa', 'caixa economica', 'cef'], color: '#005ca9', type: 'Conta Poupança' },
  { keywords: ['bb', 'banco do brasil'], color: '#fcf800', type: 'Conta Corrente' },
  { keywords: ['xp', 'xp investimentos'], color: '#111111', type: 'Investimento' },
  { keywords: ['btg', 'btg pactual'], color: '#001e62', type: 'Investimento' },
  { keywords: ['picpay', 'pic pay'], color: '#11c76f', type: 'Conta Corrente' },
  { keywords: ['neon'], color: '#00e5ff', type: 'Conta Corrente' },
  { keywords: ['pagbank', 'pagseguro', 'pag bank'], color: '#00b140', type: 'Conta Corrente' },
  { keywords: ['mercadopago', 'mercado pago'], color: '#009ee3', type: 'Conta Corrente' },
  { keywords: ['original', 'banco original'], color: '#00a859', type: 'Conta Corrente' },
  { keywords: ['nomad'], color: '#ffda00', type: 'Conta Corrente' },
  { keywords: ['wise'], color: '#2570eb', type: 'Conta Corrente' },
  { keywords: ['rico'], color: '#ff4500', type: 'Investimento' },
  { keywords: ['nuinvest', 'easynvest'], color: '#7b1fa2', type: 'Investimento' },
  { keywords: ['sicoob'], color: '#003641', type: 'Conta Corrente' },
  { keywords: ['sicredi'], color: '#315f26', type: 'Conta Corrente' },
  { keywords: ['banrisul'], color: '#005695', type: 'Conta Corrente' },
  { keywords: ['stone'], color: '#00a86b', type: 'Conta Corrente' },
  { keywords: ['pan', 'banco pan'], color: '#00a5f0', type: 'Cartão de Crédito' },
  { keywords: ['porto', 'porto seguro'], color: '#0070c0', type: 'Cartão de Crédito' },
  { keywords: ['credicard'], color: '#0a1f44', type: 'Cartão de Crédito' },
  { keywords: ['digio'], color: '#1b2d4f', type: 'Cartão de Crédito' },
  { keywords: ['will', 'will bank'], color: '#ffff00', type: 'Cartão de Crédito' }
];

function autoDetectBankColor(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();
  for (const b of BANK_COLOR_MAP) {
    if (b.keywords.some(k => lower.includes(k))) {
      return b;
    }
  }
  return null;
}

function openAccountModal(id){
  editingAccId = id || null;
  document.getElementById('overlayAccount').classList.add('show');
  if(id){
    const a = accounts.find(x=>x.id===id);
    document.getElementById('accModalTitle').textContent = 'Editar Conta';
    document.getElementById('accName').value = a.name;
    document.getElementById('accType').value = a.type;
    document.getElementById('accBalance').value = a.balance;
    document.getElementById('accColor').value = a.color;
  } else {
    document.getElementById('accModalTitle').textContent = 'Nova Conta';
    document.getElementById('accName').value = '';
    document.getElementById('accType').value = 'Conta Corrente';
    document.getElementById('accBalance').value = '';
    document.getElementById('accColor').value = '#e8b04b';
  }
  updateAccBalanceLabel();
  const accTypeEl = document.getElementById('accType');
  if(accTypeEl) accTypeEl.onchange = updateAccBalanceLabel;
}
function closeAccountModal(){ document.getElementById('overlayAccount').classList.remove('show'); }
async function saveAccount(){
  const name = document.getElementById('accName').value.trim();
  const type = document.getElementById('accType').value;
  const balance = parseInputValue(document.getElementById('accBalance').value);
  const color = document.getElementById('accColor').value;
  if(!name || isNaN(balance)){ showToast('Preencha nome e saldo/limite corretamente'); return; }
  if(editingAccId){
    const a = accounts.find(x=>x.id===editingAccId);
    const oldName = a.name;
    Object.assign(a, {name, type, balance, color});
    if(oldName!==name) transactions.forEach(t=>{ if(t.acc===oldName) t.acc = name; });
    showToast('Conta/Cartão atualizado!');
    logActivity('Edição', 'Conta / Cartão', 'Editou conta/cartão "' + name + '" (' + type + ') com limite/saldo inicial ' + fmt(balance));
  } else {
    accounts.push({id: nextAccId++, name, type, balance, color});
    showToast('Conta/Cartão adicionado!');
    await pushNotification('Nova conta/cartão cadastrado: ' + name + ' (' + type + ')', '🏦');
    logActivity('Criação', 'Conta / Cartão', 'Cadastrou nova conta/cartão "' + name + '" (' + type + ') com limite/saldo inicial ' + fmt(balance));
  }
  await saveUserData();
  closeAccountModal();
  const txOverlay = document.getElementById('overlay');
  if(txOverlay && txOverlay.classList.contains('show')){
    populateAccountOptions(name);
  }
  render();
}
async function deleteAccount(id){
  if(!confirm('Excluir esta conta/cartão?')) return;
  accounts = accounts.filter(a=>a.id!==id);
  await saveUserData();
  showToast('Conta removida');
  render();
}

const ICON_SUGGESTIONS = ['🍔','🛒','🏠','💡','🚗','⚕️','📚','🎮','👕','📺','💳','📤','💆','📦','💼','💻','📈','📥','💵','🎉','💰','🐾','🎁','🏛️','✈️','☕','🍕','⛽','🧾','📱','🎵','🏋️','📁'];
function renderCatIconPicker(selected){
  const wrap = document.getElementById('catIconPicker');
  if(!wrap) return;
  wrap.innerHTML = ICON_SUGGESTIONS.map(ic=>'<button type="button" data-icon="'+ic+'" class="'+(ic===selected?'sel':'')+'">'+ic+'</button>').join('');
  wrap.querySelectorAll('button').forEach(btn=>{
    btn.onclick = ()=>{
      document.getElementById('catIconInput').value = btn.getAttribute('data-icon');
      wrap.querySelectorAll('button').forEach(b=>b.classList.remove('sel'));
      btn.classList.add('sel');
    };
  });
}
function openCategoryModal(name, defaultType){
  editingCatName = name || null;
  document.getElementById('overlayCategory').classList.add('show');
  if(name){
    const c = categories.find(x=>x.name===name);
    document.getElementById('catModalTitle').textContent = 'Editar Categoria';
    document.getElementById('catName').value = c.name;
    document.getElementById('catTipo').value = c.type || 'despesa';
    document.getElementById('catColor').value = c.color;
    document.getElementById('catIconInput').value = c.icon || '📁';
    renderCatIconPicker(c.icon || '📁');
  } else {
    document.getElementById('catModalTitle').textContent = 'Nova Categoria';
    document.getElementById('catName').value = '';
    document.getElementById('catTipo').value = defaultType==='in' ? 'receita' : 'despesa';
    document.getElementById('catColor').value = '#e8b04b';
    const defaultIcon = defaultType==='in' ? '💰' : '📁';
    document.getElementById('catIconInput').value = defaultIcon;
    renderCatIconPicker(defaultIcon);
  }
  setTimeout(() => {
    const input = document.getElementById('catName');
    if(input) input.focus();
  }, 50);
}
function closeCategoryModal(){ document.getElementById('overlayCategory').classList.remove('show'); }
async function saveCategory(){
  const name = document.getElementById('catName').value.trim();
  const type = document.getElementById('catTipo').value;
  const color = document.getElementById('catColor').value;
  const icon = document.getElementById('catIconInput').value.trim() || (type==='receita' ? '💰' : '📁');
  if(!name){ showToast('Informe um nome para a categoria'); return; }
  let isNew = false;
  if(editingCatName){
    const c = categories.find(x=>x.name===editingCatName);
    const oldName = c.name;
    if(oldName!==name && categories.some(x=>x.name===name)){ showToast('Já existe uma categoria com esse nome'); return; }
    c.name = name; c.color = color; c.type = type; c.icon = icon;
    if(oldName!==name){
      transactions.forEach(t=>{ if(t.cat===oldName) t.cat = name; });
      budgets.forEach(b=>{ if(b.category===oldName) b.category = name; });
      alerts.forEach(a=>{ if(a.category===oldName) a.category = name; });
      recurringList.forEach(r=>{ if(r.cat===oldName) r.cat = name; });
    }
    showToast('Categoria atualizada!');
    logActivity('Edição', 'Categoria', 'Editou categoria "' + name + '" (' + type + ')');
  } else {
    if(categories.some(x=>x.name===name)){ showToast('Já existe uma categoria com esse nome'); return; }
    categories.push({name, color, type, icon, count:0});
    showToast('Categoria adicionada!');
    logActivity('Criação', 'Categoria', 'Cadastrou nova categoria "' + name + '" (' + type + ')');
    isNew = true;
  }
  await saveUserData();
  closeCategoryModal();
  const txOverlay = document.getElementById('overlay');
  if(txOverlay && txOverlay.classList.contains('show')){
    populateCategoriaOptions(currentType);
    if(isNew) document.getElementById('fCategoria').value = name;
  }
  const catManageOverlay = document.getElementById('overlayCatManage');
  if(catManageOverlay && catManageOverlay.classList.contains('show')) renderCatManageList(catManageType);
  render();
}
async function deleteCategory(name){
  if(!confirm('Excluir esta categoria? Transações vinculadas serão movidas para a categoria padrão.')) return;
  const removed = categories.find(c=>c.name===name);
  const isReceita = removed && removed.type==='receita';
  const fallbackName = isReceita ? 'Outras Receitas' : 'Outros';
  categories = categories.filter(c=>c.name!==name);
  if(!categories.some(c=>c.name===fallbackName)){
    categories.push(isReceita ? {name:'Outras Receitas', color:'#3ec7c7', type:'receita', icon:'💰', count:0} : {name:'Outros', color:'#3ec7c7', type:'despesa', icon:'📦', count:0});
  }
  transactions.forEach(t=>{ if(t.cat===name) t.cat = fallbackName; });
  budgets = budgets.filter(b=>b.category!==name);
  alerts = alerts.filter(a=>a.category!==name);
  await saveUserData();
  showToast('Categoria removida');
  logActivity('Exclusão', 'Categoria', 'Excluiu categoria "' + name + '"');
  const catManageOverlay = document.getElementById('overlayCatManage');
  if(catManageOverlay && catManageOverlay.classList.contains('show')) renderCatManageList(catManageType);
  render();
}

function renderCatManageList(type){
  catManageType = type;
  document.querySelectorAll('.cat-manage-tabs .cat-tab').forEach(b=>b.classList.toggle('active', b.getAttribute('data-cattab')===type));
  const list = categories.filter(c=>(c.type||'despesa')===type).slice().sort((a,b)=>(b.count||0)-(a.count||0) || a.name.localeCompare(b.name,'pt-BR'));
  const wrap = document.getElementById('catManageList');
  if(!wrap) return;
  let html = list.map(c=>
    '<div class="cat-card"><div class="cat-manage-row">'
    + '<span class="cat-badge" style="background:'+c.color+'22;color:'+c.color+'">'+(c.icon||'📁')+'</span>'
    + '<div class="info"><div class="n">'+c.name+'</div><div class="u">'+(c.count||0)+' uso'+((c.count||0)===1?'':'s')+'</div></div>'
    + '<div class="row-actions"><button data-mgedit="'+c.name+'" title="Editar">✎</button><button data-mgdel="'+c.name+'" title="Excluir">🗑</button></div>'
    + '</div></div>'
  ).join('');
  html += '<button type="button" class="cat-card cat-card-add" id="catManageAddInline"><span class="plus">+</span>Nova categoria</button>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('[data-mgedit]').forEach(el=>el.onclick = ()=>openCategoryModal(el.getAttribute('data-mgedit')));
  wrap.querySelectorAll('[data-mgdel]').forEach(el=>el.onclick = ()=>deleteCategory(el.getAttribute('data-mgdel')));
  const addInline = document.getElementById('catManageAddInline');
  if(addInline) addInline.onclick = ()=>openCategoryModal(null, type==='receita' ? 'in' : 'out');
}
function openCatManageModal(){
  document.getElementById('overlayCatManage').classList.add('show');
  renderCatManageList(catManageType || 'despesa');
}
function closeCatManageModal(){ document.getElementById('overlayCatManage').classList.remove('show'); }

function openBudgetModal(id){
  if(categories.length===0){ showToast('Cadastre uma categoria antes de criar um orçamento'); return; }
  editingBudgetId = id || null;
  document.getElementById('overlayBudget').classList.add('show');
  const sel = document.getElementById('orcCategoria');
  const used = budgets.filter(b=>b.id!==id).map(b=>b.category);
  const opts = categories.filter(c=>!used.includes(c.name));
  sel.innerHTML = (opts.length?opts:categories).map(c=>'<option>'+c.name+'</option>').join('');
  if(id){
    const b = budgets.find(x=>x.id===id);
    document.getElementById('orcModalTitle').textContent = 'Editar Orçamento';
    sel.value = b.category;
    document.getElementById('orcLimite').value = b.limit;
  } else {
    document.getElementById('orcModalTitle').textContent = 'Novo Orçamento';
    document.getElementById('orcLimite').value = '';
  }
}
function closeBudgetModal(){ document.getElementById('overlayBudget').classList.remove('show'); }
async function saveBudget(){
  const category = document.getElementById('orcCategoria').value;
  const limit = parseInputValue(document.getElementById('orcLimite').value);
  if(!category || isNaN(limit) || limit<=0){ showToast('Informe categoria e limite válidos'); return; }
  if(editingBudgetId){
    Object.assign(budgets.find(b=>b.id===editingBudgetId), {category, limit});
    showToast('Orçamento atualizado!');
    logActivity('Edição', 'Orçamento', 'Atualizou orçamento para a categoria "' + category + '" (Limite: ' + fmt(limit) + ')');
  } else {
    budgets.push({id: nextBudgetId++, category, limit});
    showToast('Orçamento criado!');
    logActivity('Criação', 'Orçamento', 'Criou orçamento para a categoria "' + category + '" (Limite: ' + fmt(limit) + ')');
  }
  await saveUserData();
  closeBudgetModal();
  render();
}
async function deleteBudget(id){
  if(!confirm('Excluir este orçamento?')) return;
  const targetBudget = budgets.find(b=>b.id===id);
  if(targetBudget){
    logActivity('Exclusão', 'Orçamento', 'Excluiu orçamento da categoria "' + targetBudget.category + '"');
  }
  budgets = budgets.filter(b=>b.id!==id);
  await saveUserData();
  showToast('Orçamento removido');
  render();
}

function openGoalModal(id){
  editingGoalId = id || null;
  document.getElementById('overlayGoal').classList.add('show');
  if(id){
    const g = goals.find(x=>x.id===id);
    document.getElementById('goalModalTitle').textContent = 'Editar Meta';
    document.getElementById('goalName').value = g.name;
    document.getElementById('goalTarget').value = g.target;
    document.getElementById('goalCurrent').value = g.current;
    document.getElementById('goalDeadline').value = g.deadline;
  } else {
    document.getElementById('goalModalTitle').textContent = 'Nova Meta';
    document.getElementById('goalName').value = '';
    document.getElementById('goalTarget').value = '';
    document.getElementById('goalCurrent').value = '0';
    document.getElementById('goalDeadline').value = '2026-12-31';
  }
}
function closeGoalModal(){ document.getElementById('overlayGoal').classList.remove('show'); }
async function saveGoal(){
  const name = document.getElementById('goalName').value.trim();
  const target = parseInputValue(document.getElementById('goalTarget').value);
  const current = parseInputValue(document.getElementById('goalCurrent').value) || 0;
  const deadline = document.getElementById('goalDeadline').value;
  if(!name || isNaN(target) || target<=0 || !deadline){ showToast('Preencha os campos da meta corretamente'); return; }
  if(editingGoalId){
    Object.assign(goals.find(g=>g.id===editingGoalId), {name,target,current,deadline});
    showToast('Meta atualizada!');
    logActivity('Edição', 'Meta', 'Atualizou meta "' + name + '" (Objetivo: ' + fmt(target) + ')');
  } else {
    goals.push({id: nextGoalId++, name,target,current,deadline});
    showToast('Meta criada!');
    logActivity('Criação', 'Meta', 'Criou nova meta "' + name + '" (Objetivo: ' + fmt(target) + ')');
  }
  await saveUserData();
  closeGoalModal();
  render();
}
async function deleteGoal(id){
  if(!confirm('Excluir esta meta?')) return;
  const targetGoal = goals.find(g=>g.id===id);
  if(targetGoal){
    logActivity('Exclusão', 'Meta', 'Excluiu meta "' + targetGoal.name + '"');
  }
  goals = goals.filter(g=>g.id!==id);
  await saveUserData();
  showToast('Meta removida');
  render();
}
async function addContribution(id){
  const g = goals.find(x=>x.id===id);
  const v = prompt('Adicionar quanto à meta "' + g.name + '"? (R$)');
  if(v===null) return;
  const val = parseFloat(v.replace(',','.'));
  if(isNaN(val) || val<=0){ showToast('Valor inválido'); return; }
  g.current += val;
  await saveUserData();
  showToast('Valor adicionado à meta!');
  logActivity('Edição', 'Meta', 'Adicionou contribuição de ' + fmt(val) + ' à meta "' + g.name + '" (Atual: ' + fmt(g.current) + ')');
  render();
}

function populateRecAccountOptions(selectedAcc) {
  const aSel = document.getElementById('recConta');
  if(!aSel) return;

  const filteredAccounts = currentRecType === 'in' 
    ? accounts.filter(a => a.type !== 'Cartão de Crédito')
    : accounts;

  let optionsArr = filteredAccounts.map(a => ({
    value: a.name,
    label: a.name + ' — ' + a.type
  }));

  const extraOptions = [
    { value: 'Boleto / Outros', label: '📄 Boleto / Pix / Outros' },
    { value: 'Dinheiro', label: '💵 Dinheiro em Espécie' }
  ];

  extraOptions.forEach(opt => {
    if (!accounts.some(a => a.name.toLowerCase().trim() === opt.value.toLowerCase().trim())) {
      optionsArr.push(opt);
    }
  });

  aSel.innerHTML = optionsArr.map(opt => {
    return '<option value="' + opt.value + '"' + (selectedAcc === opt.value ? ' selected' : '') + '>' + opt.label + '</option>';
  }).join('');
}

function openRecurringModal(id){
  if(categories.length===0){ showToast('Cadastre uma categoria antes de criar um recorrente'); return; }
  editingRecId = id || null;
  document.getElementById('overlayRecurring').classList.add('show');
  
  let selectedAcc = accounts[0] ? accounts[0].name : 'Boleto / Outros';

  if(id){
    const r = recurringList.find(x=>x.id===id);
    document.getElementById('recModalTitle').textContent = 'Editar Recorrente';
    document.getElementById('recDesc').value = r.desc;
    document.getElementById('recVal').value = r.val;
    document.getElementById('recDay').value = r.day;
    document.getElementById('recFreq').value = r.freq;
    if(r.acc) selectedAcc = r.acc;
    setRecType(r.type);
    const cSel = document.getElementById('recCategoria');
    if(cSel) cSel.value = r.cat;
  } else {
    document.getElementById('recModalTitle').textContent = 'Novo Lançamento Recorrente';
    document.getElementById('recDesc').value = '';
    document.getElementById('recVal').value = '';
    document.getElementById('recDay').value = '5';
    document.getElementById('recFreq').value = 'Mensal';
    setRecType('out');
  }
  populateRecAccountOptions(selectedAcc);
}

function closeRecurringModal(){ document.getElementById('overlayRecurring').classList.remove('show'); }

function populateRecCategoriaOptions(type){
  const fCat = document.getElementById('recCategoria');
  if(!fCat) return;
  const wantType = type==='in' ? 'receita' : 'despesa';
  const hasOfType = categories.some(c => (c.type||'despesa') === wantType);
  const prev = fCat.value;
  fCat.innerHTML = hasOfType ? catOptionsHTML(wantType) : catOptionsHTML(null);
  const list = hasOfType ? categories.filter(c => (c.type||'despesa') === wantType) : categories;
  if(list.some(c=>c.name===prev)) fCat.value = prev;
}

function setRecType(t){
  currentRecType = t;
  document.getElementById('recTypeInBtn').className = t==='in' ? 'sel-in' : '';
  document.getElementById('recTypeOutBtn').className = t==='out' ? 'sel-out' : '';
  populateRecCategoriaOptions(t);
  const aSel = document.getElementById('recConta');
  if(aSel) {
    populateRecAccountOptions(aSel.value);
  }
}

async function saveRecurring(){
  const desc = document.getElementById('recDesc').value.trim();
  const val = parseInputValue(document.getElementById('recVal').value);
  const day = parseInt(document.getElementById('recDay').value);
  const cat = document.getElementById('recCategoria').value;
  const accSel = document.getElementById('recConta') ? document.getElementById('recConta').value : '';
  const freq = document.getElementById('recFreq').value;
  if(!desc || isNaN(val) || val<=0 || isNaN(day) || day<1 || day>31){ showToast('Preencha os campos corretamente'); return; }
  if(editingRecId){
    Object.assign(recurringList.find(r=>r.id===editingRecId), {desc,val,day,cat,acc:accSel,freq,type:currentRecType});
    showToast('Recorrente atualizado!');
    logActivity('Edição', 'Recorrente', 'Editou lançamento recorrente "' + desc + '" (' + fmt(val) + ')');
  } else {
    recurringList.push({id: nextRecId++, desc,val,day,cat,acc:accSel,freq,type:currentRecType});
    showToast('Recorrente criado!');
    logActivity('Criação', 'Recorrente', 'Cadastrou lançamento recorrente "' + desc + '" (' + fmt(val) + ')');
  }
  await saveUserData();
  closeRecurringModal();
  render();
}
async function deleteRecurring(id){
  if(!confirm('Excluir este lançamento recorrente?')) return;
  recurringList = recurringList.filter(r=>r.id!==id);
  await saveUserData();
  showToast('Recorrente removido');
  render();
}
async function lancarRecorrente(id){
  const r = recurringList.find(x=>x.id===id);
  const date = pdCustom(currentPeriod.year, currentPeriod.month, r.day);
  const targetAcc = accounts.find(a => a.name === r.acc);
  const accId = targetAcc ? targetAcc.id : null;
  const finalAccName = targetAcc ? targetAcc.name : r.acc;
  transactions.unshift({id: nextTxId++, desc:r.desc, val:r.val, date, cat:r.cat, acc:finalAccName, accId, status: r.type==='in'?'Recebido':'Pago', type:r.type});
  await saveUserData();
  showToast(\`Lançamento gerado em \${periodLabel()}!\`);
  render();
}

function openAlertModal(id){
  if(categories.length===0){ showToast('Cadastre uma categoria antes de criar um alerta'); return; }
  editingAlertId = id || null;
  document.getElementById('overlayAlert').classList.add('show');
  const sel = document.getElementById('alertCategoria');
  sel.innerHTML = categories.map(c=>\`<option>\${c.name}</option>\`).join('');
  if(id){
    const al = alerts.find(x=>x.id===id);
    document.getElementById('alertModalTitle').textContent = 'Editar Alerta';
    sel.value = al.category;
    document.getElementById('alertThreshold').value = al.threshold;
  } else {
    document.getElementById('alertModalTitle').textContent = 'Novo Alerta';
    document.getElementById('alertThreshold').value = '90';
  }
}
function closeAlertModal(){ document.getElementById('overlayAlert').classList.remove('show'); }
async function saveAlert(){
  const category = document.getElementById('alertCategoria').value;
  const threshold = parseInt(document.getElementById('alertThreshold').value);
  if(!category || isNaN(threshold) || threshold<=0){ showToast('Preencha os campos corretamente'); return; }
  if(editingAlertId){
    Object.assign(alerts.find(a=>a.id===editingAlertId), {category, threshold});
    showToast('Alerta atualizado!');
  } else {
    alerts.push({id: nextAlertId++, category, threshold});
    showToast('Alerta criado!');
  }
  await saveUserData();
  closeAlertModal();
  render();
}
async function deleteAlert(id){
  if(!confirm('Excluir este alerta?')) return;
  alerts = alerts.filter(a=>a.id!==id);
  await saveUserData();
  showToast('Alerta removido');
  render();
}

async function openUserAdminModal(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const u = registeredUsers.find(x=>x.email===email);
  if(!u) return;
  editingUserEmail = email;
  document.getElementById('userAdminName').value = u.name;
  document.getElementById('userAdminEmail').value = u.email;
  document.getElementById('userAdminRole').value = u.role;
  document.getElementById('userAdminPassword').value = '';
  document.getElementById('userAdminPassword').type = 'password';
  bindPasswordToggle('userAdminPassword', 'userAdminPasswordToggle');
  document.getElementById('overlayUserAdmin').classList.add('show');
}
function closeUserAdminModal(){ document.getElementById('overlayUserAdmin').classList.remove('show'); editingUserEmail = null; }
async function saveUserAdmin(){
  if(!editingUserEmail) return;
  await syncUsersWithServer();
  const u = registeredUsers.find(x=>x.email===editingUserEmail);
  if(!u) return;
  const name = document.getElementById('userAdminName').value.trim();
  const role = document.getElementById('userAdminRole').value;
  const newPass = document.getElementById('userAdminPassword').value.trim();
  if(!name){ showToast('Informe um nome para o usuário'); return; }
  if(u.role === 'Administrador' && role !== 'Administrador' && registeredUsers.filter(x=>x.role==='Administrador').length <= 1){
    showToast('É necessário manter ao menos um administrador');
    return;
  }
  u.name = name;
  u.role = role;
  if(newPass) u.password = newPass;
  await saveUsersToServer();
  if(currentUser && currentUser.email === u.email){
    currentUser.name = u.name;
    currentUser.role = u.role;
  }
  showToast('Usuário atualizado!');
  logActivity('Edição', 'Usuário', 'Administrador alterou dados do usuário ' + u.email + ' (Nome: ' + name + ', Função: ' + role + (newPass ? ', Senha alterada' : '') + ')');
  closeUserAdminModal();
  render();
}

function handleImportFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    const text = reader.result;
    let rows = [];
    if(/\\.ofx$/i.test(file.name)){
      const re = /<STMTTRN>([\\s\\S]*?)<\\/STMTTRN>/gi;
      let m;
      while((m = re.exec(text))){
        const block = m[1];
        const amt = (block.match(/<TRNAMT>([-\\d.,]+)/i)||[])[1];
        const dtRaw = (block.match(/<DTPOSTED>(\\d{8})/i)||[])[1];
        const memo = ((block.match(/<MEMO>([^\\n<]*)/i)||[])[1] || (block.match(/<NAME>([^\\n<]*)/i)||[])[1] || 'Importado').trim();
        if(amt && dtRaw){
          const date = \`\${dtRaw.slice(0,4)}-\${dtRaw.slice(4,6)}-\${dtRaw.slice(6,8)}\`;
          rows.push({date, desc:memo, val:parseFloat(amt.replace(',','.'))});
        }
      }
    } else {
      const lines = text.split(/\\r?\\n/).filter(l=>l.trim());
      lines.forEach(line=>{
        const parts = line.split(',');
        if(parts.length<3) return;
        const [d,desc,val] = parts;
        const dt = (d||'').trim();
        const v = parseFloat((val||'').replace(',','.'));
        if(!dt || isNaN(v) || /data/i.test(dt)) return;
        rows.push({date:dt, desc:(desc||'').trim(), val:v});
      });
    }
    pendingImport = rows;
    renderImportPreview();
  };
  reader.readAsText(file);
}
function renderImportPreview(){
  const el = document.getElementById('importPreview');
  if(!el) return;
  if(pendingImport.length===0){ el.innerHTML = '<p style="color:var(--text-faint);font-size:12.5px;margin-top:12px;">Nenhuma transação reconhecida no arquivo.</p>'; return; }
  el.innerHTML = \`
    <p style="font-size:12.5px;color:var(--text-dim);margin:14px 0 8px;">\${pendingImport.length} transações encontradas:</p>
    <table><thead><tr><th>Data</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>
    \${pendingImport.slice(0,50).map(r=>\`<tr class="trow"><td>\${r.date}</td><td>\${r.desc}</td><td class="\${r.val>=0?'val-in':'val-out'}">\${fmt(Math.abs(r.val))}</td></tr>\`).join('')}
    </tbody></table>
    <button class="btn-primary" id="btnConfirmarImport" style="margin-top:14px">Confirmar Importação (\${pendingImport.length})</button>\`;
  document.getElementById('btnConfirmarImport').onclick = confirmImport;
}
async function confirmImport(){
  const rawAcc = (document.getElementById('impConta').value || '').split(' — ')[0].trim();
  let targetAcc = accounts.find(a => a.name === rawAcc || a.name.toLowerCase().trim() === rawAcc.toLowerCase());
  if (!targetAcc && (rawAcc.toLowerCase().includes('cartão') || rawAcc.toLowerCase().includes('cartao'))) {
    const creditCards = accounts.filter(a => isAccountCreditCard(a));
    if (creditCards.length > 0) targetAcc = creditCards[0];
  }
  const accId = targetAcc ? targetAcc.id : null;
  const finalAcc = targetAcc ? targetAcc.name : rawAcc;

  const cat = document.getElementById('impCategoria').value;
  let added = 0;
  pendingImport.forEach(r=>{
    let date = r.date;
    transactions.push({ id: nextTxId++, date, desc:r.desc||'Importado', cat, acc:finalAcc, accId, type: r.val>=0?'in':'out', val: Math.abs(r.val), status: r.val>=0?'Recebido':'Pago' });
    added++;
  });
  pendingImport = [];
  autoMigrateTransactionsAndAccounts();
  await saveUserData();
  showToast(added + ' transações importadas!');
  navigate('transacoes');
}

async function compressImageIfNeeded(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return null;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 1280;
        let width = img.width;
        let height = img.height;

        if (width > MAX_WIDTH || height > MAX_HEIGHT) {
          if (width > height) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          } else {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
        resolve(compressedDataUrl);
      };
      img.onerror = () => resolve(e.target.result);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function addAttachment(filesToProcess = null){
  const attTxEl = document.getElementById('attTx');
  const txId = attTxEl ? (parseInt(attTxEl.value) || null) : null;
  const fileInput = document.getElementById('attFile');
  const files = filesToProcess || Array.from(fileInput ? fileInput.files : []);
  
  if(files.length === 0){
    if(fileInput) fileInput.click();
    return;
  }

  isDataLoading = true;

  try {
    let addedCount = 0;
    showToast('Processando anexo(s)...');

    for (const file of files) {
      try {
        let dataUrl = null;
        if (file.type && file.type.startsWith('image/')) {
          dataUrl = await compressImageIfNeeded(file);
        }
        if (!dataUrl) {
          dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
          });
        }

        if (dataUrl) {
          attachments.push({
            id: nextAttId++,
            txId: txId,
            name: file.name,
            type: file.type || 'application/octet-stream',
            dataUrl: dataUrl,
            createdAt: new Date().toISOString()
          });
          addedCount++;
        }
      } catch(e) {
        console.error('Erro ao processar anexo:', e);
      }
    }

    if (fileInput) fileInput.value = '';

    if (addedCount > 0) {
      if (currentUser) {
        const cleanEmail = (currentUser.email || '').toLowerCase().trim();
        const userKey = 'nexus_data_' + cleanEmail;
        const payloadData = {
          categories, accounts, transactions, budgets, goals, recurringList, alerts, attachments, notifications,
          nextAccId, nextTxId, nextBudgetId, nextGoalId, nextRecId, nextAlertId, nextAttId, nextNotifId
        };
        saveToStorage(userKey, payloadData);
      }

      render();
      showToast(addedCount + ' anexo(s) incluído(s) com sucesso!');
      await saveUserData();
    } else {
      showToast('Erro ao ler os arquivos selecionados');
    }
  } finally {
    isDataLoading = false;
  }
}

async function relinkAttachment(id, newTxId){
  const att = attachments.find(a => a.id === id);
  if (!att) return;
  att.txId = newTxId ? parseInt(newTxId) : null;
  render();
  showToast('Vínculo da transação atualizado!');
  await saveUserData();
}

function previewAttachment(id){
  const att = attachments.find(a => a.id === id);
  if (!att || !att.dataUrl) { showToast('Não foi possível carregar a visualização'); return; }
  const isImage = (att.type && att.type.startsWith('image/')) || (att.dataUrl && att.dataUrl.startsWith('data:image/'));
  const isPdf = (att.type && att.type.includes('pdf')) || (att.dataUrl && att.dataUrl.startsWith('data:application/pdf')) || (att.name && att.name.toLowerCase().endsWith('.pdf'));

  let contentHtml = '';
  if (isImage) {
    contentHtml = '<div style="text-align:center; max-height:78vh; overflow:auto; padding:10px;"><img src="' + att.dataUrl + '" style="max-width:100%; max-height:72vh; object-fit:contain; border-radius:12px; display:block; margin:0 auto; box-shadow:0 8px 28px rgba(0,0,0,0.4);"></div>';
  } else if (isPdf) {
    contentHtml = '<iframe src="' + att.dataUrl + '" style="width:100%; height:78vh; border:none; border-radius:12px;"></iframe>';
  } else {
    contentHtml = '<div style="text-align:center; padding:50px 24px;"><div style="font-size:56px; margin-bottom:14px;">📄</div><h4 style="font-size:18px; font-weight:700;">' + att.name + '</h4><p style="color:var(--text-dim); margin-top:8px; font-size:14px;">Arquivo disponível para visualização e download</p><a href="' + att.dataUrl + '" download="' + (att.name || 'comprovante') + '" class="btn-primary" style="display:inline-flex; align-items:center; gap:8px; margin-top:20px; text-decoration:none; padding:12px 24px; font-size:15px; font-weight:700; border-radius:10px;">📥 Baixar Arquivo Agora</a></div>';
  }

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'overlay show';
  modalOverlay.style.zIndex = '3000';
  modalOverlay.innerHTML = '<div class="modal" style="max-width:920px; width:94vw; padding:20px; border-radius:16px;">' +
    '<div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px; margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid var(--card-border);">' +
      '<h3 style="font-size:18px; font-weight:800; margin:0; display:flex; align-items:center; gap:10px; color:var(--text); word-break:break-word;"><span>📎</span> ' + (att.name || 'Anexo') + '</h3>' +
      '<div style="display:flex; gap:10px; align-items:center;">' +
        '<a href="' + att.dataUrl + '" download="' + (att.name || 'comprovante') + '" class="btn-primary" style="padding:10px 20px; font-size:14px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; gap:8px; border-radius:8px; height:40px;">📥 Baixar</a>' +
        '<button class="btn-ghost btn-close-modal" style="padding:10px 20px; font-size:14px; font-weight:700; border-radius:8px; height:40px; background:rgba(255,255,255,0.08); border:1px solid var(--card-border); color:var(--text); cursor:pointer; display:inline-flex; align-items:center; gap:6px;">✕ Fechar</button>' +
      '</div>' +
    '</div>' +
    '<div style="background:var(--bg); padding:16px; border-radius:14px; border:1px solid var(--card-border);">' + contentHtml + '</div>' +
  '</div>';
  modalOverlay.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.onclick = () => modalOverlay.remove();
  });
  document.body.appendChild(modalOverlay);
}

function showConfirmModal(opts) {
  const title = opts.title || 'Confirmar Ação';
  const message = opts.message || 'Tem certeza que deseja prosseguir?';
  const confirmText = opts.confirmText || 'Confirmar';
  const cancelText = opts.cancelText || 'Cancelar';
  const confirmDanger = opts.confirmDanger !== false;
  const onConfirm = opts.onConfirm;

  const overlay = document.createElement('div');
  overlay.className = 'overlay show';
  overlay.style.zIndex = '4000';
  overlay.style.backdropFilter = 'blur(6px)';

  const btnBg = confirmDanger ? '#ef4444' : 'var(--green)';

  overlay.innerHTML = '<div class="modal" style="max-width:440px; width:90vw; padding:26px 24px; border-radius:20px; text-align:center; box-shadow:0 20px 40px rgba(0,0,0,0.5); border:1px solid var(--card-border); transform:scale(0.92); transition:transform 0.2s ease;">' +
    '<div style="width:58px; height:58px; border-radius:50%; background:' + (confirmDanger ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)') + '; color:' + (confirmDanger ? '#ef4444' : 'var(--green)') + '; display:flex; align-items:center; justify-content:center; font-size:28px; margin:0 auto 16px auto; border:1px solid ' + (confirmDanger ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)') + ';">' +
      (confirmDanger ? '🗑️' : '❓') +
    '</div>' +
    '<h3 style="font-size:20px; font-weight:800; margin:0 0 8px 0; color:var(--text);">' + title + '</h3>' +
    '<p style="font-size:14px; color:var(--text-dim); margin:0 0 24px 0; line-height:1.5;">' + message + '</p>' +
    '<div style="display:flex; gap:12px; justify-content:center;">' +
      '<button class="btn-cancel-modal" style="flex:1; height:44px; font-size:14px; font-weight:700; border-radius:10px; background:rgba(255,255,255,0.08); border:1px solid var(--card-border); color:var(--text); cursor:pointer;">' + cancelText + '</button>' +
      '<button class="btn-confirm-modal" style="flex:1; height:44px; font-size:14px; font-weight:700; border-radius:10px; background:' + btnBg + '; border:none; color:#ffffff; cursor:pointer; box-shadow:0 4px 12px ' + (confirmDanger ? 'rgba(239,68,68,0.3)' : 'rgba(34,197,94,0.3)') + ';">' + confirmText + '</button>' +
    '</div>' +
  '</div>';

  document.body.appendChild(overlay);

  setTimeout(() => {
    const modalEl = overlay.querySelector('.modal');
    if (modalEl) modalEl.style.transform = 'scale(1)';
  }, 10);

  overlay.querySelector('.btn-cancel-modal').onclick = () => overlay.remove();
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  overlay.querySelector('.btn-confirm-modal').onclick = async () => {
    overlay.remove();
    if (onConfirm) await onConfirm();
  };
}

async function deleteAttachment(id){
  const att = attachments.find(a => a.id === id);
  const nameLabel = att ? ('"' + att.name + '"') : 'este anexo';

  showConfirmModal({
    title: 'Excluir Anexo?',
    message: 'Tem certeza que deseja remover ' + nameLabel + '? Esta ação não poderá ser desfeita.',
    confirmText: '🗑 Sim, Excluir',
    cancelText: 'Cancelar',
    confirmDanger: true,
    onConfirm: async () => {
      attachments = attachments.filter(a => a.id !== id);
      render();
      showToast('Anexo removido com sucesso');
      await saveUserData();
    }
  });
}

/* ==================== Eventos de página ==================== */
function attachPageEvents(){
  document.querySelectorAll('[data-nav]').forEach(el=>el.onclick = ()=>{ navigate(el.getAttribute('data-nav')); });

  const nova = document.getElementById('btnNovaTransacao'); if(nova) nova.onclick = ()=>openModal(null);
  const gerCat = document.getElementById('btnGerenciarCategorias'); if(gerCat) gerCat.onclick = openCatManageModal;
  document.querySelectorAll('[data-edit]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      openModal(parseInt(el.getAttribute('data-edit')));
    };
  });
  document.querySelectorAll('[data-del]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      const id = parseInt(el.getAttribute('data-del'));
      if (!isNaN(id)) deleteTransaction(id);
    };
  });
  document.querySelectorAll('[data-paytx]').forEach(el => {
    el.onclick = (e) => {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      markTransactionAsPaid(parseInt(el.getAttribute('data-paytx')));
    };
  });

  const novaConta = document.getElementById('btnNovaConta'); if(novaConta) novaConta.onclick = ()=>openAccountModal(null);
  document.querySelectorAll('[data-editacc]').forEach(el=>el.onclick = ()=>openAccountModal(parseInt(el.getAttribute('data-editacc'))));
  document.querySelectorAll('[data-delacc]').forEach(el=>el.onclick = ()=>deleteAccount(parseInt(el.getAttribute('data-delacc'))));

  const novaCat = document.getElementById('btnNovaCategoria'); if(novaCat) novaCat.onclick = ()=>openCategoryModal(null);
  document.querySelectorAll('[data-editcat]').forEach(el=>el.onclick = ()=>openCategoryModal(el.getAttribute('data-editcat')));
  document.querySelectorAll('[data-delcat]').forEach(el=>el.onclick = ()=>deleteCategory(el.getAttribute('data-delcat')));

  const novoOrc = document.getElementById('btnNovoOrcamento'); if(novoOrc) novoOrc.onclick = ()=>openBudgetModal(null);
  document.querySelectorAll('[data-editorc]').forEach(el=>el.onclick = ()=>openBudgetModal(parseInt(el.getAttribute('data-editorc'))));
  document.querySelectorAll('[data-delorc]').forEach(el=>el.onclick = ()=>deleteBudget(parseInt(el.getAttribute('data-delorc'))));

  const novaMeta = document.getElementById('btnNovaMeta'); if(novaMeta) novaMeta.onclick = ()=>openGoalModal(null);
  document.querySelectorAll('[data-editmeta]').forEach(el=>el.onclick = ()=>openGoalModal(parseInt(el.getAttribute('data-editmeta'))));
  document.querySelectorAll('[data-delmeta]').forEach(el=>el.onclick = ()=>deleteGoal(parseInt(el.getAttribute('data-delmeta'))));
  document.querySelectorAll('[data-addcontrib]').forEach(el=>el.onclick = ()=>addContribution(parseInt(el.getAttribute('data-addcontrib'))));

  const novoRec = document.getElementById('btnNovoRecorrente'); if(novoRec) novoRec.onclick = ()=>openRecurringModal(null);
  document.querySelectorAll('[data-editrec]').forEach(el=>el.onclick = ()=>openRecurringModal(parseInt(el.getAttribute('data-editrec'))));
  document.querySelectorAll('[data-delrec]').forEach(el=>el.onclick = ()=>deleteRecurring(parseInt(el.getAttribute('data-delrec'))));
  document.querySelectorAll('[data-lancar]').forEach(el=>el.onclick = ()=>lancarRecorrente(parseInt(el.getAttribute('data-lancar'))));

  const novoAlerta = document.getElementById('btnNovoAlerta'); if(novoAlerta) novoAlerta.onclick = ()=>openAlertModal(null);
  document.querySelectorAll('[data-editalert]').forEach(el=>el.onclick = ()=>openAlertModal(parseInt(el.getAttribute('data-editalert'))));
  document.querySelectorAll('[data-delalert]').forEach(el=>el.onclick = ()=>deleteAlert(parseInt(el.getAttribute('data-delalert'))));

  document.querySelectorAll('[data-edituser]').forEach(el=>el.onclick = ()=>openUserAdminModal(el.getAttribute('data-edituser')));
  document.querySelectorAll('[data-viewuser]').forEach(el=>el.onclick = ()=>viewUserData(el.getAttribute('data-viewuser')));
  document.querySelectorAll('[data-toggleuser]').forEach(el=>el.onclick = ()=>toggleUserActive(el.getAttribute('data-toggleuser')));

  const importFile = document.getElementById('importFile'); if(importFile) importFile.onchange = handleImportFile;

  const addAtt = document.getElementById('btnAddAnexo');
  if(addAtt) addAtt.onclick = () => addAttachment();

  const attFile = document.getElementById('attFile');
  if(attFile) {
    attFile.onchange = () => {
      if(attFile.files && attFile.files.length > 0) {
        addAttachment();
      }
    };
  }

  const dropZone = document.getElementById('attDropZone');
  if(dropZone) {
    dropZone.onclick = (e) => {
      if(e.target !== attFile && attFile) attFile.click();
    };
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--green)'; };
    dropZone.ondragleave = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--card-border)'; };
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--card-border)';
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addAttachment(Array.from(e.dataTransfer.files));
      }
    };
  }

  document.querySelectorAll('[data-delatt]').forEach(el=>el.onclick = ()=>deleteAttachment(parseInt(el.getAttribute('data-delatt'))));
  document.querySelectorAll('[data-relinkatt]').forEach(el=>el.onchange = (e)=>relinkAttachment(parseInt(el.getAttribute('data-relinkatt')), e.target.value));
  document.querySelectorAll('[data-previewatt]').forEach(el=>el.onclick = ()=>previewAttachment(parseInt(el.getAttribute('data-previewatt'))));

  const saveCfg = document.getElementById('btnSalvarConfig');
  if(saveCfg){
    bindPasswordToggle('cfgPassword', 'cfgPasswordToggle');
    bindPasswordToggle('cfgPasswordConfirm', 'cfgPasswordConfirmToggle');
    const cfgThemeEl = document.getElementById('cfgTheme');
    if(cfgThemeEl) cfgThemeEl.value = document.body.classList.contains('light') ? 'light' : 'dark';
    const cfgScaleEl = document.getElementById('cfgScale');
    if(cfgScaleEl) {
      cfgScaleEl.value = localStorage.getItem('nexus_display_scale') || 'auto';
      cfgScaleEl.onchange = (e) => applyDisplayScale(e.target.value);
    }
    applyDisplayScale(localStorage.getItem('nexus_display_scale') || 'auto');

    saveCfg.onclick = async ()=>{
      if (currentUser) {
        await syncUsersWithServer();
        const newName = document.getElementById('cfgName').value.trim();
        const newEmail = document.getElementById('cfgEmail').value.trim();
        const newPass = document.getElementById('cfgPassword').value.trim();
        const newPassConfirm = document.getElementById('cfgPasswordConfirm').value.trim();

        if(!newName){ showToast('Informe um nome válido'); return; }
        if(!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)){ showToast('Informe um e-mail válido'); return; }
        const emailTaken = registeredUsers.some(u => u.email.toLowerCase()===newEmail.toLowerCase() && u.email.toLowerCase()!==currentUser.email.toLowerCase());
        if(emailTaken){ showToast('Este e-mail já está em uso por outro usuário'); return; }
        
        // Atualiza a senha SOMENTE se AMBOS os campos de senha foram preenchidos propositalmente
        let passwordChanged = false;
        if(newPass && newPassConfirm){
          if(newPass.length < 6){ showToast('A nova senha deve ter ao menos 6 caracteres'); return; }
          if(newPass !== newPassConfirm){ showToast('As senhas de confirmação não coincidem'); return; }
          passwordChanged = true;
        }

        const oldEmail = currentUser.email;
        const u = registeredUsers.find(x => x.email.toLowerCase() === oldEmail.toLowerCase());
        if (u) {
          u.name = newName;
          u.email = newEmail;
          if(passwordChanged) u.password = newPass;
        }
        await saveUsersToServer();

        if(newEmail.toLowerCase() !== oldEmail.toLowerCase()){
          const oldKey = 'nexus_data_' + oldEmail;
          const dataBackup = loadFromStorage(oldKey, null);
          currentUser.email = newEmail;
          if(dataBackup) saveToStorage('nexus_data_' + newEmail, dataBackup);
          localStorage.removeItem(oldKey);
        }
        currentUser.name = newName;
        await saveUserData();

        document.getElementById('cfgPassword').value = '';
        document.getElementById('cfgPasswordConfirm').value = '';
      }
      const wantLight = document.getElementById('cfgTheme').value === 'light';
      const isLight = document.body.classList.contains('light');
      if(wantLight !== isLight) toggleTheme();

      const scaleEl = document.getElementById('cfgScale');
      if(scaleEl) applyDisplayScale(scaleEl.value);

      showToast('Configurações salvas!');
      render();
    };
  }

  const periodBtn = document.getElementById('periodBtn');
  if(periodBtn){
    periodBtn.onclick = (e)=>{
      e.stopPropagation();
      const willShow = !document.getElementById('periodPanel').classList.contains('show');
      document.getElementById('periodPanel').classList.toggle('show', willShow);
      periodBtn.classList.toggle('open', willShow);
    };
    const yearSel = document.getElementById('periodYearSel');
    yearSel.innerHTML = YEARS.map(y=>\`<option value="\${y}">\${y}</option>\`).join('');
    yearSel.value = currentPeriod.year;
    const buildMonths = ()=>{
      const y = parseInt(yearSel.value);
      let start=1, end=12;
      if(y===PERIOD_MIN.year) start = PERIOD_MIN.month;
      if(y===PERIOD_MAX.year) end = PERIOD_MAX.month;
      const monthSel = document.getElementById('periodMonthSel');
      const opts = [];
      for(let m=start; m<=end; m++) opts.push(m);
      monthSel.innerHTML = opts.map(m=>\`<option value="\${m}">\${MONTHS[m-1]}</option>\`).join('');
      monthSel.value = (opts.includes(currentPeriod.month) && y===currentPeriod.year) ? currentPeriod.month : opts[0];
    };
    buildMonths();
    yearSel.onchange = buildMonths;
    document.getElementById('periodApplyBtn').onclick = ()=>{
      currentPeriod = { year: parseInt(yearSel.value), month: parseInt(document.getElementById('periodMonthSel').value) };
      try { localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod)); } catch(e){}
      document.getElementById('periodPanel').classList.remove('show');
      periodBtn.classList.remove('open');
      render();
    };
    document.getElementById('periodTodayBtn').onclick = ()=>{
      const now = new Date();
      currentPeriod = { year: now.getFullYear(), month: now.getMonth() + 1 };
      try { localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod)); } catch(e){}
      document.getElementById('periodPanel').classList.remove('show');
      periodBtn.classList.remove('open');
      render();
    };
    const allDatesBtn = document.getElementById('periodAllDatesBtn');
    if (allDatesBtn) {
      allDatesBtn.onclick = () => {
        const now = new Date();
        currentPeriod = { year: now.getFullYear(), month: 0 };
        try { localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod)); } catch(e){}
        document.getElementById('periodPanel').classList.remove('show');
        periodBtn.classList.remove('open');
        render();
      };
    }
  }

  const search = document.getElementById('txSearch');
  const fTipo = document.getElementById('txFiltroTipo');
  const fCat = document.getElementById('txFiltroCat');
  const fStatus = document.getElementById('txFiltroStatus');
  const fConta = document.getElementById('txFiltroConta');
  if(fTipo || fCat || fStatus || fConta || search){
    [search,fTipo,fCat,fStatus,fConta].forEach(el=>{
      if(el) {
        el.addEventListener('input', refreshTxTable);
        el.addEventListener('change', refreshTxTable);
      }
    });
    refreshTxTable();
  }

  document.querySelectorAll('[data-viewcardtx]').forEach(btn => {
    btn.onclick = () => {
      const cardName = btn.getAttribute('data-viewcardtx');
      currentPage = 'transacoes';
      render();
      setTimeout(() => {
        const fc = document.getElementById('txFiltroConta');
        if (fc) {
          fc.value = cardName;
          refreshTxTable();
        }
      }, 50);
    };
  });
}

function navigate(page){
  if(!page) page = 'dashboard';
  currentPage = page;
  try {
    localStorage.setItem('nexus_current_page', page);
    if(window.history && window.history.replaceState){
      window.history.replaceState(null, null, '#' + page);
    } else {
      window.location.hash = page;
    }
  } catch(e){}

  document.querySelectorAll('.menu button').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  render();
}

window.addEventListener('hashchange', ()=>{
  const validPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'funcoes', 'usuarios', 'logs', 'config'];
  const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
  if(hashPage && validPages.includes(hashPage) && hashPage !== currentPage){
    navigate(hashPage);
  }
});

/* ==================== Eventos Globais ==================== */
function toggleMobileDrawer(open){
  const drawer = document.getElementById('mobileDrawer');
  const overlay = document.getElementById('mobileDrawerOverlay');
  if(!drawer || !overlay) return;
  if(open === undefined) open = !drawer.classList.contains('open');
  if(open){
    overlay.classList.add('show');
    drawer.classList.add('open');
  } else {
    overlay.classList.remove('show');
    drawer.classList.remove('open');
  }
}
const mobileToggle = document.getElementById('mobileMenuToggle');
if(mobileToggle) mobileToggle.onclick = ()=> toggleMobileDrawer(true);
const closeDrawer = document.getElementById('closeMobileDrawer');
if(closeDrawer) closeDrawer.onclick = ()=> toggleMobileDrawer(false);
const overlayDrawer = document.getElementById('mobileDrawerOverlay');
if(overlayDrawer) overlayDrawer.onclick = ()=> toggleMobileDrawer(false);

const mobileDrawerMenu = document.getElementById('mobileDrawerMenu');
if(mobileDrawerMenu){
  mobileDrawerMenu.addEventListener('click', e=>{
    const targetEl = e.target.nodeType === 3 ? e.target.parentElement : e.target;
    const btn = targetEl ? targetEl.closest('button[data-page]') : null;
    if(btn && btn.dataset.page){
      navigate(btn.dataset.page);
      toggleMobileDrawer(false);
    }
  });
}

document.getElementById('menu').addEventListener('click', e=>{
  const targetEl = e.target.nodeType === 3 ? e.target.parentElement : e.target;
  const btn = targetEl ? targetEl.closest('button[data-page]') : null;
  if(btn && btn.dataset.page) navigate(btn.dataset.page);
});
document.addEventListener('click', e=>{
  const targetEl = e.target.nodeType === 3 ? e.target.parentElement : e.target;
  const panel = document.getElementById('periodPanel');
  if(panel && panel.classList.contains('show') && targetEl && !targetEl.closest('.period-wrap')){
    panel.classList.remove('show');
    const pBtn = document.getElementById('periodBtn'); if(pBtn) pBtn.classList.remove('open');
  }
  const notifPanel = document.getElementById('notifPanel');
  if(notifPanel && notifPanel.classList.contains('show') && targetEl && !targetEl.closest('.notif-wrap')) notifPanel.classList.remove('show');
});

document.getElementById('notifBtn').onclick = async (e)=>{
  e.stopPropagation();
  const panel = document.getElementById('notifPanel');
  panel.classList.toggle('show');
  if(panel.classList.contains('show') && notifications.some(n=>!n.read)){
    notifications.forEach(n=>n.read=true);
    await saveUserData();
    renderNotifications();
  }
};
document.getElementById('notifMarkAllBtn').onclick = async (e)=>{
  e.stopPropagation();
  notifications.forEach(n=>n.read=true);
  await saveUserData();
  renderNotifications();
};

document.getElementById('closeAccModal').onclick = closeAccountModal;
document.getElementById('accCancelBtn').onclick = closeAccountModal;
document.getElementById('accSaveBtn').onclick = saveAccount;
document.getElementById('overlayAccount').addEventListener('click', e=>{ if(e.target.id==='overlayAccount') closeAccountModal(); });

const accNameInput = document.getElementById('accName');
if (accNameInput) {
  accNameInput.addEventListener('input', (e) => {
    const detected = autoDetectBankColor(e.target.value);
    if (detected) {
      document.getElementById('accColor').value = detected.color;
      if (detected.type && !editingAccId) {
        document.getElementById('accType').value = detected.type;
      }
    }
  });
}

document.getElementById('closeModal').onclick = closeModal;
document.getElementById('cancelBtn').onclick = closeModal;
document.getElementById('saveBtn').onclick = saveTransaction;
document.getElementById('overlay').addEventListener('click', e=>{ if(e.target.id==='overlay') closeModal(); });
document.getElementById('typeInBtn').onclick = ()=>setType('in');
document.getElementById('typeOutBtn').onclick = ()=>setType('out');
document.getElementById('fCategoriaAddBtn').onclick = ()=>openCategoryModal(null, currentType);
const fContaAddBtn = document.getElementById('fContaAddBtn');
if (fContaAddBtn) {
  fContaAddBtn.onclick = () => {
    openAccountModal(null);
    if (currentType === 'in') {
      const accTypeEl = document.getElementById('accType');
      if (accTypeEl) accTypeEl.value = 'Conta Corrente';
    }
  };
}

document.getElementById('closeAccModal').onclick = closeAccountModal;
document.getElementById('accCancelBtn').onclick = closeAccountModal;
document.getElementById('accSaveBtn').onclick = saveAccount;
document.getElementById('overlayAccount').addEventListener('click', e=>{ if(e.target.id==='overlayAccount') closeAccountModal(); });

document.getElementById('closeCatModal').onclick = closeCategoryModal;
document.getElementById('catCancelBtn').onclick = closeCategoryModal;
document.getElementById('catSaveBtn').onclick = saveCategory;
document.getElementById('overlayCategory').addEventListener('click', e=>{ if(e.target.id==='overlayCategory') closeCategoryModal(); });

document.getElementById('closeCatManageModal').onclick = closeCatManageModal;
document.getElementById('catManageCloseBtn').onclick = closeCatManageModal;
document.getElementById('catManageAddBtn').onclick = ()=>openCategoryModal(null, catManageType==='receita' ? 'in' : 'out');
document.getElementById('overlayCatManage').addEventListener('click', e=>{ if(e.target.id==='overlayCatManage') closeCatManageModal(); });
document.querySelectorAll('.cat-manage-tabs .cat-tab').forEach(btn=>{
  btn.onclick = ()=>{ catManageType = btn.getAttribute('data-cattab'); renderCatManageList(catManageType); };
});


document.getElementById('closeOrcModal').onclick = closeBudgetModal;
document.getElementById('orcCancelBtn').onclick = closeBudgetModal;
document.getElementById('orcSaveBtn').onclick = saveBudget;
document.getElementById('overlayBudget').addEventListener('click', e=>{ if(e.target.id==='overlayBudget') closeBudgetModal(); });

document.getElementById('closeGoalModal').onclick = closeGoalModal;
document.getElementById('goalCancelBtn').onclick = closeGoalModal;
document.getElementById('goalSaveBtn').onclick = saveGoal;
document.getElementById('overlayGoal').addEventListener('click', e=>{ if(e.target.id==='overlayGoal') closeGoalModal(); });

document.getElementById('closeRecModal').onclick = closeRecurringModal;
document.getElementById('recCancelBtn').onclick = closeRecurringModal;
document.getElementById('recSaveBtn').onclick = saveRecurring;
document.getElementById('overlayRecurring').addEventListener('click', e=>{ if(e.target.id==='overlayRecurring') closeRecurringModal(); });
document.getElementById('recTypeInBtn').onclick = ()=>setRecType('in');
document.getElementById('recTypeOutBtn').onclick = ()=>setRecType('out');

function toggleTheme(){
  const isCurrentlyLight = document.body.classList.contains('light') || document.documentElement.classList.contains('light');
  const nextIsLight = !isCurrentlyLight;

  document.body.classList.toggle('light', nextIsLight);
  document.documentElement.classList.toggle('light', nextIsLight);
  localStorage.setItem('nexus_theme', nextIsLight ? 'light' : 'dark');

  const btn = document.getElementById('miniThemeBtn');
  const moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/></svg>';
  const sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>';
  if(btn) btn.innerHTML = nextIsLight ? sunSvg : moonSvg;
  if(currentPage==='dashboard') drawDashboardCharts();
}
document.getElementById('miniThemeBtn').onclick = toggleTheme;

(function initThemeState() {
  try {
    const savedTheme = localStorage.getItem('nexus_theme');
    const isLight = savedTheme === 'light';
    document.body.classList.toggle('light', isLight);
    document.documentElement.classList.toggle('light', isLight);
    const btn = document.getElementById('miniThemeBtn');
    const moonSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
    const sunSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>';
    if (btn) btn.innerHTML = isLight ? sunSvg : moonSvg;
  } catch(e){}
})();

document.getElementById('closeAlertModal').onclick = closeAlertModal;
document.getElementById('alertCancelBtn').onclick = closeAlertModal;
document.getElementById('alertSaveBtn').onclick = saveAlert;
document.getElementById('overlayAlert').addEventListener('click', e=>{ if(e.target.id==='overlayAlert') closeAlertModal(); });

document.getElementById('closeUserAdminModal').onclick = closeUserAdminModal;
document.getElementById('userAdminCancelBtn').onclick = closeUserAdminModal;
document.getElementById('userAdminSaveBtn').onclick = saveUserAdmin;
document.getElementById('overlayUserAdmin').addEventListener('click', e=>{ if(e.target.id==='overlayUserAdmin') closeUserAdminModal(); });
document.getElementById('viewModeExitBtn').onclick = exitViewMode;
document.getElementById('accountDisabledCloseBtn').onclick = hideAccountDisabledPopup;
bindPasswordToggle('loginPassword', 'loginPasswordToggle');

/* ==================== Controle de Escala & Dispositivo Logado ==================== */
function detectDeviceType() {
  var w = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth;
  var ua = navigator.userAgent || '';
  var isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || w <= 640;
  var isTablet = !isMobile && (/iPad|Tablet/i.test(ua) || (w > 640 && w <= 1024));
  var isUltrawide = w >= 1700;
  if (isMobile) return 'mobile';
  if (isTablet) return 'tablet';
  if (isUltrawide) return 'ultrawide';
  return 'desktop';
}

function getDeviceName(devType) {
  switch (devType) {
    case 'mobile': return 'Smartphone 📱';
    case 'tablet': return 'Tablet 📱↔️';
    case 'ultrawide': return 'Ultra-Wide / 4K 🖥️✨';
    case 'desktop': default: return 'Desktop / Computador 🖥️';
  }
}

function applyDisplayScale(scaleVal) {
  if (!scaleVal) scaleVal = localStorage.getItem('nexus_display_scale') || 'auto';
  localStorage.setItem('nexus_display_scale', scaleVal);

  var devType = detectDeviceType();
  document.documentElement.setAttribute('data-device-type', devType);

  var effectiveScale = scaleVal;
  if (scaleVal === 'auto') {
    if (devType === 'mobile') effectiveScale = '100%';
    else if (devType === 'tablet') effectiveScale = '95%';
    else if (devType === 'ultrawide') effectiveScale = '110%';
    else effectiveScale = '100%';
  }

  var scaleNum = parseFloat(effectiveScale) / 100 || 1;
  document.documentElement.style.setProperty('--app-zoom', scaleNum);

  var lbl = document.getElementById('currentScaleLabel');
  if (lbl) {
    lbl.textContent = scaleVal === 'auto' ? 'Auto (' + effectiveScale + ')' : scaleVal;
  }

  document.querySelectorAll('.scale-opt-btn').forEach(btn => {
    var isSel = btn.getAttribute('data-scale') === scaleVal;
    btn.style.fontWeight = isSel ? '700' : '400';
    btn.style.color = isSel ? 'var(--green, #06D6A0)' : 'var(--text)';
  });

  var cfgScaleEl = document.getElementById('cfgScale');
  if (cfgScaleEl) cfgScaleEl.value = scaleVal;

  var devInfoEl = document.getElementById('cfgDeviceInfo');
  if (devInfoEl) {
    var w = window.innerWidth;
    var h = window.innerHeight;
    devInfoEl.innerHTML = \`
      <div style="display:flex; align-items:center; gap:10px; padding:12px; border-radius:12px; background:rgba(91,148,217,0.1); border:1px solid rgba(91,148,217,0.25); font-size:13px;">
        <span style="font-size:22px;">\${devType === 'mobile' ? '📱' : devType === 'tablet' ? '📱↔️' : devType === 'ultrawide' ? '🖥️✨' : '🖥️'}</span>
        <div>
          <strong>Dispositivo Detectado:</strong> \${getDeviceName(devType)}<br>
          <span style="color:var(--text-muted); font-size:12px;">Resolução Atual: \${w}px x \${h}px | Escala Ativa: <strong>\${effectiveScale}</strong> \${scaleVal === 'auto' ? '(Ajuste Automático)' : '(Manual)'}</span>
        </div>
      </div>
    \`;
  }
}

(function initScaleState() {
  try {
    var savedScale = localStorage.getItem('nexus_display_scale') || 'auto';
    applyDisplayScale(savedScale);
    window.addEventListener('resize', function() {
      if ((localStorage.getItem('nexus_display_scale') || 'auto') === 'auto') {
        applyDisplayScale('auto');
      }
    });
  } catch(e){}
})();

// Intercepta Ctrl + S / Cmd + S para gerar impressão limpa em vez de abrir modal do navegador que esconde elementos
window.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.keyCode === 83)) {
    e.preventDefault();
    e.stopPropagation();
    window.print();
  }
});

const scaleMenuBtn = document.getElementById('scaleMenuBtn');
const scaleDropdown = document.getElementById('scaleDropdown');
if (scaleMenuBtn && scaleDropdown) {
  scaleMenuBtn.onclick = (e) => {
    e.stopPropagation();
    scaleDropdown.style.display = scaleDropdown.style.display === 'none' ? 'block' : 'none';
  };
  document.querySelectorAll('.scale-opt-btn').forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const scaleVal = btn.getAttribute('data-scale');
      applyDisplayScale(scaleVal);
      scaleDropdown.style.display = 'none';
    };
  });
  document.addEventListener('click', () => {
    if (scaleDropdown) scaleDropdown.style.display = 'none';
  });
}

/* ==================== Restaurar sessão ao atualizar a página sem flicker ==================== */
(function initSessionStateImmediate() {
  try {
    const session = loadFromStorage('nexus_session', null);
    const cachedUser = loadFromStorage('nexus_cached_user', null);
    if ((session && session.email) || (cachedUser && cachedUser.email)) {
      document.documentElement.classList.add('user-logged-in');
      document.getElementById('authPage').classList.remove('show');
      document.getElementById('appMain').classList.add('show');
      if (cachedUser) {
        currentUser = cachedUser;
        if (currentUser.role === 'Administrador') {
          document.documentElement.classList.add('is-admin');
          const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
          const savedPage = localStorage.getItem('nexus_current_page');
          const pageTarget = hashPage || savedPage;
          if (pageTarget === 'logs') {
            currentPage = 'logs';
          } else {
            currentPage = 'usuarios';
          }
        } else {
          document.documentElement.classList.remove('is-admin');
        }
        if (typeof updateHeaderUser === 'function') updateHeaderUser();
        if (typeof updateAdminMenuVisibility === 'function') updateAdminMenuVisibility();
      }
    }
  } catch(e){}
})();

(async function restoreSession(){
  const session = loadFromStorage('nexus_session', null);
  const cachedUser = loadFromStorage('nexus_cached_user', null);
  const viewingEmail = loadFromStorage('nexus_viewing_user', null);
  const sessionEmail = session ? session.email : (cachedUser ? cachedUser.email : null);

  if (!sessionEmail && !cachedUser) {
    document.documentElement.classList.remove('user-logged-in');
    document.getElementById('appMain').classList.remove('show');
    document.getElementById('authPage').classList.add('show');
    return;
  }

  // Tenta sincronizar a lista de usuários do servidor antes de desenhar a tela
  try {
    await syncUsersWithServer();
  } catch(e) {}

  const serverUser = registeredUsers.find(u => u.email.toLowerCase() === (sessionEmail || '').toLowerCase());
  const realUser = serverUser || cachedUser || { email: sessionEmail, name: sessionEmail.split('@')[0], role: 'Usuário' };

  if (realUser && realUser.active === false) {
    localStorage.removeItem('nexus_session');
    localStorage.removeItem('nexus_cached_user');
    localStorage.removeItem('nexus_token');
    localStorage.removeItem('nexus_viewing_user');
    document.documentElement.classList.remove('user-logged-in');
    document.getElementById('appMain').classList.remove('show');
    document.getElementById('authPage').classList.add('show');
    showAccountDisabledPopup('Seu usuário foi desativado pelo administrador. Entre em contato para mais informações.');
    return;
  }

  // Mantém os dados da conta autenticada real
  saveToStorage('nexus_session', { email: realUser.email });
  saveToStorage('nexus_cached_user', realUser);

  document.documentElement.classList.add('user-logged-in');
  document.getElementById('authPage').classList.remove('show');
  document.getElementById('appMain').classList.add('show');

  // Se o Administrador estava inspecionando outro usuário antes do F5
  if (realUser.role === 'Administrador' && viewingEmail) {
    const target = registeredUsers.find(u => u.email.toLowerCase() === viewingEmail.toLowerCase());
    if (target && target.email.toLowerCase() !== realUser.email.toLowerCase()) {
      adminOriginalUser = realUser;
      currentUser = target;
      isViewingOtherUser = true;
      currentPage = 'dashboard';
      await loadUserData();
      if (typeof render === 'function') render();
      return;
    }
  }

  // Restaura a conta real sem alterar para a conta de outro usuário
  currentUser = realUser;
  adminOriginalUser = null;
  isViewingOtherUser = false;
  localStorage.removeItem('nexus_viewing_user');

  if (currentUser.role === 'Administrador') {
    const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
    const savedPage = localStorage.getItem('nexus_current_page');
    const pageTarget = hashPage || savedPage || currentPage;
    if (pageTarget === 'logs') {
      currentPage = 'logs';
    } else {
      currentPage = 'usuarios';
    }
  }

  await loadUserData();
  if (typeof render === 'function') render();

  function checkAndShowJustLoggedInPopup() {
    try {
      const justLoggedIn = localStorage.getItem('nexus_just_logged_in') || sessionStorage.getItem('nexus_just_logged_in');
      if (justLoggedIn) {
        localStorage.removeItem('nexus_just_logged_in');
        sessionStorage.removeItem('nexus_just_logged_in');
        setTimeout(() => {
          showLoginSuccessPopup('Login efetuado com sucesso!');
        }, 200);
      }
    } catch(e){}
  }
  checkAndShowJustLoggedInPopup();
  document.addEventListener('DOMContentLoaded', checkAndShowJustLoggedInPopup);
})();

// Animação de Fundo de Linhas Orbitais 4K (Mesmo visual da tela de login)
(function initAppBgOrbital() {
  const canvas = document.getElementById('appBgOrbitalCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  let angle = 0;
  function renderOrbital() {
    ctx.clearRect(0, 0, width, height);
    angle += 0.0018;

    const cx = width / 2;
    const cy = height / 2;

    for (let i = 1; i <= 7; i++) {
      const rx = (width * 0.38) + (i * 45);
      const ry = (height * 0.42) + (i * 35);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle * (i % 2 === 0 ? 1 : -1) + (i * 0.2));

      ctx.beginPath();
      ctx.ellipse(0, 0, rx, ry, Math.PI / 6, 0, Math.PI * 2);
      ctx.lineWidth = 1;

      if (i % 2 === 0) {
        ctx.strokeStyle = 'rgba(200, 155, 60, ' + (0.14 - (i * 0.015)) + ')';
      } else {
        ctx.strokeStyle = 'rgba(91, 148, 217, ' + (0.14 - (i * 0.015)) + ')';
      }
      ctx.stroke();
      ctx.restore();
    }

    requestAnimationFrame(renderOrbital);
  }
  renderOrbital();
})();
</script>
</body>
</html>`;

// Persistência resiliente de Logs em Arquivo Local + Banco de Dados
const LOGS_FILE_PATH = path.join(__dirname, 'system_logs.json');
const LOCAL_DATA_PATH = path.join(__dirname, 'local_database_data.json');
const LOCAL_USERS_PATH = path.join(__dirname, 'local_users.json');

function getFileLogs() {
  try {
    if (fs.existsSync(LOGS_FILE_PATH)) {
      const data = fs.readFileSync(LOGS_FILE_PATH, 'utf8');
      return JSON.parse(data) || [];
    }
  } catch (e) {
    console.error('Erro ao ler system_logs.json:', e);
  }
  return [];
}

function saveFileLogEntry(entry) {
  try {
    const list = getFileLogs();
    list.unshift(entry);
    if (list.length > 1000) list.pop();
    fs.writeFileSync(LOGS_FILE_PATH, JSON.stringify(list, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro ao escrever system_logs.json:', e);
  }
}

function recordSystemLog(userName, userEmail, action, entity, details) {
  const logObj = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    user_name: userName || 'Sistema',
    user_email: userEmail || 'sistema@nexus.com',
    action: action || 'Ação',
    entity: entity || 'Sistema',
    details: details || 'Alteração registrada no sistema'
  };

  saveFileLogEntry(logObj);

  if (pool) {
    pool.query(
      `INSERT INTO system_logs (timestamp, user_name, user_email, action, entity, details)
       VALUES (now(), $1, $2, $3, $4, $5)`,
      [logObj.user_name, logObj.user_email, logObj.action, logObj.entity, logObj.details]
    ).catch(err => {
      // Gravado no arquivo system_logs.json caso o banco falhe
    });
  }
}

function getLocalUsers() {
  try {
    if (fs.existsSync(LOCAL_USERS_PATH)) {
      const content = fs.readFileSync(LOCAL_USERS_PATH, 'utf8');
      const users = JSON.parse(content) || [];
      if (users.length > 0) return users;
    }
  } catch (e) {}
  return [
    DEFAULT_ADMIN,
    { name: 'Paulo Lima', email: 'paulolp0101@gmail.com', password: '86266049', role: 'Administrador', active: true },
    { name: 'Usuário Padrão', email: 'user@nexusfinanceiro.com', password: '123456', role: 'Usuário', active: true }
  ];
}

function saveLocalUsers(users) {
  try {
    fs.writeFileSync(LOCAL_USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {}
}

function getLocalData(email) {
  try {
    if (fs.existsSync(LOCAL_DATA_PATH)) {
      const allData = JSON.parse(fs.readFileSync(LOCAL_DATA_PATH, 'utf8')) || {};
      return allData[email.toLowerCase().trim()] || null;
    }
  } catch (e) {}
  return null;
}

function saveLocalData(email, data) {
  try {
    let allData = {};
    if (fs.existsSync(LOCAL_DATA_PATH)) {
      allData = JSON.parse(fs.readFileSync(LOCAL_DATA_PATH, 'utf8')) || {};
    }
    allData[email.toLowerCase().trim()] = data;
    fs.writeFileSync(LOCAL_DATA_PATH, JSON.stringify(allData, null, 2), 'utf8');
  } catch (e) {}
}

// Servidor HTTP de Alta Performance e Resiliência
const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // Cabeçalhos globais de CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // Rota POST para Login de Usuário
  if (req.method === 'POST' && parsedUrl.pathname === '/api/login') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { email, password } = JSON.parse(body);
        if (!email || !password) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail e senha são obrigatórios' }));
        }

        let user = null;
        if (pool) {
          try {
            const result = await pool.query(
              'SELECT id, name, email, password, role, active FROM usuarios WHERE LOWER(email) = LOWER($1)',
              [email]
            );
            if (result.rows.length > 0) user = result.rows[0];
          } catch (dbErr) {
            console.warn('[AVISO BD] Falha ao consultar PostgreSQL. Usando banco local.');
          }
        }
        if (!user) {
          const localUsers = getLocalUsers();
          user = localUsers.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
        }

        if (!user || user.password !== password) {
          res.writeHead(401, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail ou senha incorretos!' }));
        }

        if (user.active === false) {
          res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Seu usuário foi desativado pelo administrador.' }));
        }

        recordSystemLog(user.name, user.email, 'Login', 'Autenticação', 'Usuário realizou login com sucesso no sistema');

        const token = 'token_' + Date.now() + '_' + Math.random().toString(36).substring(2);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          token: token,
          user: { id: user.id || Date.now(), name: user.name, email: user.email, role: user.role }
        }));
      } catch (err) {
        console.error('Erro no endpoint de login:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Falha no servidor durante a autenticação.' }));
      }
    });
    return;
  }

  // Rota POST para Cadastro de Usuário
  if (req.method === 'POST' && parsedUrl.pathname === '/api/register') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { name, email, password } = JSON.parse(body);
        if (!name || !email || !password) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Todos os campos são obrigatórios' }));
        }

        const cleanEmail = email.toLowerCase().trim();
        let isExisting = false;
        if (pool) {
          try {
            const existing = await pool.query(
              'SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)',
              [cleanEmail]
            );
            if (existing.rows.length > 0) isExisting = true;
          } catch (dbErr) {}
        }
        if (!isExisting) {
          const localUsers = getLocalUsers();
          if (localUsers.some(u => u.email.toLowerCase() === cleanEmail)) isExisting = true;
        }

        if (isExisting) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Este e-mail já está cadastrado!' }));
        }

        if (pool) {
          try {
            await pool.query(
              'INSERT INTO usuarios (name, email, password, role, active) VALUES ($1, $2, $3, $4, $5)',
              [name, cleanEmail, password, 'Usuário', true]
            );
          } catch (e) {}
        }

        const localUsers = getLocalUsers();
        localUsers.push({ id: Date.now(), name, email: cleanEmail, password, role: 'Usuário', active: true });
        saveLocalUsers(localUsers);

        recordSystemLog(name, cleanEmail, 'Cadastro', 'Autenticação', 'Novo usuário cadastrou-se no sistema');

        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Conta criada com sucesso!' }));
      } catch (err) {
        console.error('Erro no endpoint de cadastro:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Falha no servidor durante o cadastro.' }));
      }
    });
    return;
  }

  // Rota POST para Enviar a Senha por E-mail
  if (req.method === 'POST' && parsedUrl.pathname === '/api/send-password') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);
        if (!email) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail é obrigatório' }));
        }

        let user = null;
        if (pool) {
          try {
            const result = await pool.query(
              'SELECT id, name, email, password FROM usuarios WHERE LOWER(email) = LOWER($1)',
              [email]
            );
            if (result.rows.length > 0) user = result.rows[0];
          } catch(e) {}
        }
        if (!user) {
          const localUsers = getLocalUsers();
          user = localUsers.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
        }

        if (!user) {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail não cadastrado.' }));
        }

        let sendPassword = user.password;
        if (!sendPassword || sendPassword.length > 30 || sendPassword.includes(':')) {
          sendPassword = Math.floor(100000 + Math.random() * 900000).toString();
          if (pool) {
            pool.query('UPDATE usuarios SET password = $1 WHERE email = $2', [sendPassword, user.email]).catch(()=>{});
          }
          const localUsers = getLocalUsers();
          const lu = localUsers.find(u => u.email.toLowerCase() === user.email.toLowerCase());
          if (lu) { lu.password = sendPassword; saveLocalUsers(localUsers); }
        }

        recordSystemLog(user.name, user.email, 'Recuperação', 'Autenticação', 'Solicitou recuperação de senha');

        const emailSent = await sendPasswordEmail(user.email, user.name, sendPassword);

        if (emailSent) {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: true, mode: 'email' }));
        } else {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ 
            success: true, 
            mode: 'direct', 
            tempPassword: sendPassword 
          }));
        }
      } catch (err) {
        console.error('Erro ao processar recuperação de senha:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Falha ao processar solicitação de senha.' }));
      }
    });
    return;
  }

  // Rota GET de Usuários
  if (req.method === 'GET' && parsedUrl.pathname === '/api/users') {
    if (pool) {
      initDatabase()
        .then(() => pool.query('SELECT name, email, password, role, active FROM usuarios ORDER BY id ASC'))
        .then(result => {
          saveLocalUsers(result.rows);
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.rows));
        })
        .catch(err => {
          console.warn('Usando lista de usuários do backup local:', err.message);
          const localUsers = getLocalUsers();
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(localUsers));
        });
    } else {
      const localUsers = getLocalUsers();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(localUsers));
    }
    return;
  }

  // Rota POST de Usuários (Sincronização Segura sem Deleção Involuntária)
  if (req.method === 'POST' && parsedUrl.pathname === '/api/users') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const users = Array.isArray(parsed) ? parsed : [parsed];
        if (!users.length) throw new Error('Formato inválido');

        // Mescla localmente com cadastros existentes no servidor
        const existingLocal = getLocalUsers();
        const userMap = new Map();
        existingLocal.forEach(u => userMap.set(u.email.toLowerCase(), u));
        users.forEach(u => {
          if (u && u.email) userMap.set(u.email.toLowerCase(), u);
        });
        const finalUsers = Array.from(userMap.values());
        saveLocalUsers(finalUsers);

        recordSystemLog('Sistema', 'cadastro@nexusfinanceiro.com', 'Sincronização', 'Usuários', 'Sincronização de usuários salva com sucesso');

        if (pool) {
          try {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              for (const u of users) {
                if (u && u.email && u.name) {
                  await client.query(
                    `INSERT INTO usuarios (name, email, password, role, active)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (email) DO UPDATE
                     SET name = EXCLUDED.name,
                         password = EXCLUDED.password,
                         role = EXCLUDED.role,
                         active = EXCLUDED.active;`,
                    [u.name, u.email, u.password || '123456', u.role || 'Usuário', u.active !== false]
                  );
                }
              }
              await client.query('COMMIT');
            } catch(e) {
              await client.query('ROLLBACK');
            } finally {
              client.release();
            }
          } catch(dbErr) {}
        }

        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        console.error('Erro ao salvar usuários:', e);
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false }));
      }
    });
    return;
  }

  // Rota GET de Logs de Auditoria
  if (req.method === 'GET' && parsedUrl.pathname === '/api/logs') {
    if (pool) {
      pool.query('SELECT id, timestamp, user_name, user_email, action, entity, details FROM system_logs ORDER BY id DESC LIMIT 500')
        .then(result => {
          const dbLogs = result.rows || [];
          const fileLogs = getFileLogs();
          const combinedMap = new Map();
          [...fileLogs, ...dbLogs].forEach(l => {
            const key = (l.user_email || '') + '_' + (l.action || '') + '_' + (l.entity || '') + '_' + (l.details || '');
            if (!combinedMap.has(key)) combinedMap.set(key, l);
          });
          const finalLogs = Array.from(combinedMap.values());
          finalLogs.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(finalLogs));
        })
        .catch(err => {
          const fileLogs = getFileLogs();
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(fileLogs));
        });
    } else {
      const fileLogs = getFileLogs();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fileLogs));
    }
    return;
  }

  // Rota POST de Logs de Auditoria
  if (req.method === 'POST' && parsedUrl.pathname === '/api/logs') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      try {
        let parsed = {};
        try {
          parsed = JSON.parse(body);
        } catch(e) {
          try {
            parsed = url.parse('?' + body, true).query;
          } catch(e2){}
        }

        const action = parsed.action || parsed.act || 'Edição';
        const entity = parsed.entity || parsed.ent || 'Sistema';
        const details = parsed.details || parsed.desc || parsed.msg || body || 'Alteração efetuada no sistema';
        const userName = parsed.userName || parsed.user_name || parsed.name || 'Usuário';
        const userEmail = parsed.userEmail || parsed.user_email || parsed.email || '';

        recordSystemLog(userName, userEmail, action, entity, details);

        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }
    });
    return;
  }

  // Rota GET para buscar dados financeiros do Usuário no banco
  if (req.method === 'GET' && parsedUrl.pathname === '/api/data') {
    const email = (parsedUrl.query.email || '').toLowerCase().trim();
    if (pool) {
      pool.query('SELECT dados FROM dados_financeiros WHERE LOWER(email) = LOWER($1)', [email])
        .then(result => {
          const serverData = result.rows[0] ? result.rows[0].dados : null;
          if (serverData) saveLocalData(email, serverData);
          const finalData = serverData || getLocalData(email);
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(finalData));
        })
        .catch(err => {
          const localData = getLocalData(email);
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(localData));
        });
    } else {
      const localData = getLocalData(email);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(localData));
    }
    return;
  }

  // Rota POST para salvar dados financeiros do Usuário no banco
  if (req.method === 'POST' && parsedUrl.pathname === '/api/data') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (e) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false }));
      }
      if (!payload.email || !payload.data) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false }));
      }
      const cleanEmail = (payload.email || '').toLowerCase().trim();

      saveLocalData(cleanEmail, payload.data);
      recordSystemLog(cleanEmail, cleanEmail, 'Salvamento', 'Dados Financeiros', 'Atualizou dados financeiros no sistema');

      if (pool) {
        pool.query(
          `INSERT INTO dados_financeiros (email, dados, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (email) DO UPDATE
           SET dados = EXCLUDED.dados, updated_at = now();`,
          [cleanEmail, payload.data]
        ).catch(err => {
          console.warn('[AVISO BD] Falha ao salvar no PostgreSQL. Dados salvos com resiliência local.', err.message);
        });
      }

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // Suporte a arquivos estáticos (Imagens, Favicon, CSS, JS)
  const pathname = parsedUrl.pathname;
  if (pathname === '/favicon.ico') {
    const faviconPath = path.join(__dirname, 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'image/x-icon' });
      return fs.createReadStream(faviconPath).pipe(res);
    }
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  if (pathname === '/login' || pathname === '/login.html') {
    const loginPath = path.join(__dirname, 'login.html');
    if (fs.existsSync(loginPath)) {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(loginPath).pipe(res);
    }
  }

  if (pathname.startsWith('/images/') || pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|json|html)$/i)) {
    const safePath = path.normalize(path.join(__dirname, pathname)).replace(/^(\.\.[\/\\])+/, '');
    if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
      const ext = path.extname(safePath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
        '.html': 'text/html; charset=utf-8'
      };
      res.writeHead(200, { ...corsHeaders, 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      return fs.createReadStream(safePath).pipe(res);
    }
  }

  res.writeHead(200, {
    ...corsHeaders,
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.end(htmlContent);
});

initDatabase()
  .then(() => {
    if (pool) {
      console.log(`[BANCO] Conectado com sucesso ao PostgreSQL (banco: ${process.env.DB_NAME || 'AMBIENTE DE HOMOLOGAÇÃO SF'})`);
    } else {
      console.log(`[BANCO LOCAL] Operando com alta resiliência e persistência em arquivos JSON locais.`);
    }
  })
  .catch(err => {
    console.warn(`[BANCO AVISO] PostgreSQL indisponível. O sistema funcionará com alta resiliência e fallback JSON local: ${err.message}`);
  })
  .finally(() => {
    server.listen(PORT, () => {
      console.log(`==================================================`);
      console.log(`🚀 Servidor Nexus Financeiro Hub rodando na porta ${PORT}`);
      console.log(`📋 Logs do banco disponíveis em tempo real no VS Code: system_logs.json`);
      console.log(`==================================================`);
    });
  });

