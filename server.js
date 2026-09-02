try {
  require('dotenv').config();
} catch (e) {}

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const tls = require('tls');
const crypto = require('crypto');

let Pool;
try {
  Pool = require('pg').Pool;
} catch (e) {
  // pg não instalado no ambiente
}

const PORT = process.env.PORT || 3000;
const SERVER_START_TIME = Date.now();
const JWT_SECRET = process.env.JWT_SECRET || 'nexus_financeiro_secret_key_2026_4k_secure';

// ==================== Camada de Segurança Criptográfica ====================
function hashPassword(password) {
  if (!password) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}

function verifyPassword(password, storedPassword) {
  if (!password || !storedPassword) return false;
  if (!storedPassword.startsWith('scrypt:')) {
    // Retrocompatibilidade transparente com senhas legadas em texto puro
    return password === storedPassword;
  }
  try {
    const [, salt, key] = storedPassword.split(':');
    const keyBuffer = Buffer.from(key, 'hex');
    const derivedKey = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(keyBuffer, derivedKey);
  } catch (e) {
    return false;
  }
}

function generateSecureToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role || 'Usuário',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60)
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
}

// ==================== Gerenciador de Eventos em Tempo Real (SSE) ====================
const sseClients = new Set();

function broadcastEvent(eventType, eventData) {
  const message = `event: ${eventType}\ndata: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

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
  name: 'Administrador',
  email: 'admin@nexusfinanceiro.com',
  password: hashPassword('86266049'),
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

// Cria as tabelas (se não existirem) e garante migrações automáticas e o admin padrão
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
      created_at TIMESTAMP NOT NULL DEFAULT now(),
      last_login TIMESTAMP WITH TIME ZONE
    );
  `);

  // Auto-migração de colunas na tabela usuarios
  try {
    await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;');
    await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;');
    await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT \'Usuário\';');
    await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT now();');
  } catch(e) {}

  await pool.query(`
    CREATE TABLE IF NOT EXISTS dados_financeiros (
      id SERIAL PRIMARY KEY,
      email VARCHAR(150) UNIQUE NOT NULL REFERENCES usuarios(email) ON DELETE CASCADE ON UPDATE CASCADE,
      dados JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMP NOT NULL DEFAULT now()
    );
  `);

  try {
    await pool.query('ALTER TABLE dados_financeiros ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();');
  } catch(e) {}

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ordens_servico (
      id SERIAL PRIMARY KEY,
      protocol VARCHAR(50) UNIQUE NOT NULL,
      client_name VARCHAR(150) NOT NULL,
      client_email VARCHAR(150) NOT NULL,
      service_type VARCHAR(100) NOT NULL,
      priority VARCHAR(50) NOT NULL DEFAULT 'Normal',
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Pendente',
      admin_notes TEXT DEFAULT '',
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    );
  `);

  // Auto-migração de colunas na tabela ordens_servico
  // Auto-migração de colunas nas tabelas ordens_servico e usuarios
  try {
    await pool.query('ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS admin_notes TEXT DEFAULT \'\';');
    await pool.query('ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS service_type VARCHAR(100) DEFAULT \'Melhoria no Sistema\';');
    await pool.query('ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT \'Normal\';');
    await pool.query('ALTER TABLE ordens_servico ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();');
    await pool.query('ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login TIMESTAMP WITH TIME ZONE;');
  } catch(e) {}

  await pool.query(
    `INSERT INTO usuarios (name, email, password, role, active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (email) DO NOTHING;`,
    [DEFAULT_ADMIN.name, DEFAULT_ADMIN.email, DEFAULT_ADMIN.password, DEFAULT_ADMIN.role, DEFAULT_ADMIN.active]
  );

  try {
    const localUsers = getLocalUsers();
    for (const u of localUsers) {
      if (!u || !u.email) continue;
      const cleanEmail = u.email.toLowerCase().trim();
      const existing = await pool.query('SELECT id FROM usuarios WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
      if (existing.rows.length === 0) {
        await pool.query(
          'INSERT INTO usuarios (name, email, password, role, active) VALUES ($1, $2, $3, $4, $5)',
          [u.name || 'Usuário', cleanEmail, u.password || hashPassword('123456'), u.role || 'Usuário', u.active !== false]
        );
      }
    }

    const res = await pool.query('SELECT id, name, email, password, role, active, created_at, last_login FROM usuarios ORDER BY id ASC');
    if (res.rows && res.rows.length > 0) {
      saveLocalUsers(res.rows);
      console.log(`[BANCO] ${res.rows.length} usuário(s) sincronizado(s) e consolidados entre PostgreSQL e persistência local.`);
    }
  } catch(syncErr) {
    console.warn('[BANCO AVISO] Erro ao sincronizar cache local de usuários:', syncErr.message);
  }
}

// Conteúdo HTML/JS/CSS da aplicação centralizada com isolamento por usuário
const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>
(function() {
  try {
    var t = localStorage.getItem('nexus_theme');
    if (t) t = t.replace(/"/g, '').trim();
    if (t === 'light') {
      document.documentElement.classList.add('light');
    }
  } catch(e){}
})();
</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#060913" id="metaThemeColor">
<script>
(function() {
  try {
    var t = localStorage.getItem('nexus_theme');
    if (t) t = t.replace(/"/g, '').trim();
    var isLight = (t === 'light');
    if (isLight) {
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

    function computeOptimalScale() {
      var w = window.innerWidth || screen.width || 1366;
      var h = window.innerHeight || screen.height || 768;
      if (w <= 640) return 1.0;
      if (w <= 1024) return 0.88;
      if (w < 1280 || h < 720) return 0.80;
      if (w < 1440 || h < 820) return 0.85;
      if (w < 1680 || h < 950) return 0.92;
      if (w <= 1920 && h <= 1080) return 1.0;
      if (w < 2560) return 1.10;
      return 1.20;
    }

    var scale = localStorage.getItem('nexus_display_scale') || 'auto';
    var scaleNum = (scale === 'auto') ? computeOptimalScale() : (parseFloat(scale) / 100 || 1);
    document.documentElement.style.setProperty('--app-zoom', scaleNum);

    document.addEventListener('DOMContentLoaded', function() {
      if (document.body) document.body.style.zoom = scaleNum;
      var saved = localStorage.getItem('nexus_theme');
      if (saved) saved = saved.replace(/"/g, '').trim();
      var lightMode = (saved === 'light');
      if (lightMode) {
        document.body.classList.add('light');
        document.documentElement.classList.add('light');
      } else {
        document.body.classList.remove('light');
        document.documentElement.classList.remove('light');
      }
      var authThemeIcon = document.getElementById('authThemeIcon');
      if (authThemeIcon) {
        authThemeIcon.innerHTML = lightMode ?
          '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/>' :
          '<path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/>';
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
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
html:not(.app-ready) .icon-btn,
html:not(.app-ready) .topheader,
html:not(.app-ready) .user,
html:not(.app-ready) .btn-ghost {
  transition: none !important;
  animation: none !important;
}
html.user-logged-in #authPage { display: none !important; }
html.user-logged-in #appMain { display: flex !important; flex-direction: column !important; min-height: 100vh !important; width: 100% !important; }

html:not(.user-logged-in) #appMain,
html:not(.user-logged-in) .topheader {
  display: none !important;
}
html:not(.user-logged-in) #authPage {
  display: flex !important;
}

/* ==================== TEMA PÓS-LOGIN (IDÊNTICO À TELA DE LOGIN - 4K SMOKED EMERALD GLASS & LIVING WALL BG) ==================== */
html.user-logged-in,
body.user-logged-in {
  --bg: #07100B;
  --sidebar: rgba(14, 24, 20, 0.85);
  --card: rgba(16, 28, 22, 0.72);
  --card-border: rgba(255, 255, 255, 0.16);
  --text: #F8FAFC;
  --text-dim: #94A3B8;
  --text-faint: #64748B;
  --green: #1DB954;
  --green-soft: rgba(29, 185, 84, 0.16);
  --emerald: #10B981;
  --emerald-soft: rgba(16, 185, 129, 0.16);
  --primary: #1DB954;
  --primary-hover: #1ED760;
  --red: #F43F5E;
  --red-soft: rgba(244, 63, 94, 0.14);
  --blue: #38BDF8;
  --purple: #A855F7;
  --orange: #F59E0B;
  --teal: #14B8A6;
  --pink: #EC4899;
  --hover: rgba(255, 255, 255, 0.08);
  --radius: 20px;
  --shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.80), 0 0 35px -5px rgba(29, 185, 84, 0.14), inset 0 1px 1.5px rgba(255, 255, 255, 0.35);
}

html,
html body,
html.user-logged-in body,
body.user-logged-in,
body {
  background-color: #030612 !important;
  background-image: 
    radial-gradient(at 12% 15%, rgba(56, 189, 248, 0.16) 0px, transparent 50%),
    radial-gradient(at 88% 15%, rgba(99, 102, 241, 0.18) 0px, transparent 55%),
    radial-gradient(at 50% 48%, rgba(245, 158, 11, 0.12) 0px, transparent 52%),
    radial-gradient(at 18% 85%, rgba(16, 185, 129, 0.14) 0px, transparent 50%),
    radial-gradient(at 82% 85%, rgba(59, 130, 246, 0.16) 0px, transparent 55%),
    linear-gradient(180deg, #030612 0%, #060C1C 50%, #02040C 100%) !important;
  background-size: cover !important;
  background-position: center center !important;
  background-attachment: fixed !important;
  background-repeat: no-repeat !important;
  color: #F8FAFC !important;
}

html.light,
html.light body,
html.user-logged-in.light body,
html.user-logged-in body.light,
body.user-logged-in.light,
body.light {
  background-color: #F8FAFC !important;
  background-image: 
    radial-gradient(at 12% 15%, rgba(56, 189, 248, 0.10) 0px, transparent 50%),
    radial-gradient(at 88% 15%, rgba(99, 102, 241, 0.08) 0px, transparent 55%),
    radial-gradient(at 50% 48%, rgba(245, 158, 11, 0.06) 0px, transparent 52%),
    radial-gradient(at 18% 85%, rgba(16, 185, 129, 0.08) 0px, transparent 50%),
    radial-gradient(at 82% 85%, rgba(59, 130, 246, 0.08) 0px, transparent 55%),
    linear-gradient(180deg, #F8FAFC 0%, #EDF2F7 50%, #F1F5F9 100%) !important;
  background-size: cover !important;
  background-position: center center !important;
  background-attachment: fixed !important;
  background-repeat: no-repeat !important;
  color: #0F172A !important;
}

html.user-logged-in .app-bg-scene {
  display: none !important;
}

.app,
#appMain,
html.user-logged-in #appMain,
.auth-container,
#authPage {
  background: transparent !important;
  background-color: transparent !important;
}

/* Header Superior Pós-Login no padrão Liquid Glass 4K */
html.user-logged-in .topheader {
  background: rgba(12, 22, 18, 0.82) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16) !important;
  box-shadow: 0 10px 35px rgba(0, 0, 0, 0.70) !important;
  backdrop-filter: blur(35px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(35px) saturate(190%) !important;
}
html.user-logged-in .brand .logo {
  background: linear-gradient(135deg, #ECFDF5 0%, #6EE7B7 25%, #10B981 60%, #064E3B 100%) !important;
  color: #022C22 !important;
  border: 1.5px solid rgba(255, 255, 255, 0.90) !important;
  box-shadow: 0 10px 24px -4px rgba(16, 185, 129, 0.50), inset 0 2px 3px #FFFFFF !important;
}
html.user-logged-in .brand .name {
  color: #FFFFFF !important;
}
html.user-logged-in .brand .name span {
  color: #1DB954 !important;
}
html.user-logged-in .header-live-time {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: #94A3B8 !important;
  backdrop-filter: blur(16px) !important;
}
html.user-logged-in .header-live-time .time-dot {
  background: #1DB954 !important;
  box-shadow: 0 0 10px #1DB954 !important;
}
html.user-logged-in .icon-btn {
  background: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: #94A3B8 !important;
  backdrop-filter: blur(16px) saturate(180%) !important;
}
html.user-logged-in .icon-btn:hover {
  background: rgba(29, 185, 84, 0.18) !important;
  color: #A7F3D0 !important;
  border-color: rgba(29, 185, 84, 0.40) !important;
}

/* ==================== SIDEBAR LATERAL EXECUTIVA 4K (FUNCIONALIDADES DO LADO) ==================== */
.sidebar-executive {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: 270px;
  background: linear-gradient(180deg, rgba(12, 22, 18, 0.94) 0%, rgba(6, 14, 10, 0.98) 100%) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.12) !important;
  backdrop-filter: blur(40px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(40px) saturate(190%) !important;
  box-shadow: 10px 0 40px rgba(0, 0, 0, 0.70) !important;
  display: flex;
  flex-direction: column;
  z-index: 60;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

body.light .sidebar-executive {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(240, 246, 242, 0.98) 100%) !important;
  border-right: 1px solid rgba(203, 213, 225, 0.85) !important;
  box-shadow: 5px 0 25px rgba(15, 23, 42, 0.08) !important;
}

.sidebar-header {
  padding: 22px 20px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  gap: 12px;
}
body.light .sidebar-header {
  border-bottom-color: rgba(203, 213, 225, 0.6);
}

.sidebar-nav-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.15) transparent;
}

.sidebar-nav-caption {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748B;
  padding: 8px 12px 6px;
}
body.light .sidebar-nav-caption {
  color: #94A3B8;
}

/* Itens de Menu Vertical da Sidebar */
.sidebar-executive nav.menu {
  display: flex !important;
  flex-direction: column !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  padding: 0 !important;
  gap: 4px !important;
  width: 100% !important;
}

.sidebar-executive nav.menu button {
  width: 100% !important;
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  padding: 10px 14px !important;
  border-radius: 14px !important;
  font-size: 13.5px !important;
  font-weight: 600 !important;
  color: #94A3B8 !important;
  background: transparent !important;
  border: 1px solid transparent !important;
  box-shadow: none !important;
  text-align: left !important;
  justify-content: flex-start !important;
  cursor: pointer !important;
  position: relative !important;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.sidebar-executive nav.menu button:hover {
  background: rgba(255, 255, 255, 0.06) !important;
  color: #FFFFFF !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  transform: translateX(3px) !important;
}
body.light .sidebar-executive nav.menu button:hover {
  background: rgba(15, 23, 42, 0.05) !important;
  color: #0F172A !important;
  border-color: rgba(203, 213, 225, 0.8) !important;
}

.sidebar-executive nav.menu button.active {
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.25) 0%, rgba(16, 185, 129, 0.16) 100%) !important;
  color: #A7F3D0 !important;
  border: 1px solid rgba(29, 185, 84, 0.50) !important;
  font-weight: 800 !important;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.40), inset 0 1px 1px rgba(255, 255, 255, 0.25) !important;
}
body.light .sidebar-executive nav.menu button.active {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.18) 0%, rgba(5, 150, 105, 0.12) 100%) !important;
  color: #047857 !important;
  border-color: rgba(16, 185, 129, 0.50) !important;
}

.sidebar-executive nav.menu button.active::after {
  content: '';
  position: absolute;
  left: 0;
  top: 18%;
  bottom: 18%;
  width: 3.5px;
  background: linear-gradient(180deg, #34D399, #1DB954);
  border-radius: 999px;
  box-shadow: 0 0 12px #34D399, 0 0 4px #1DB954;
}

.sidebar-executive nav.menu button .ic {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94A3B8;
  transition: all 0.22s ease;
}

.sidebar-executive nav.menu button.active .ic {
  background: rgba(29, 185, 84, 0.28) !important;
  color: #6EE7B7 !important;
  border-color: rgba(110, 231, 183, 0.5) !important;
}

/* ==================== RODAPÉ DA SIDEBAR: MINHA CONTA E CONFIGURAÇÕES ==================== */
.sidebar-footer {
  padding: 14px 14px 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.25);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
body.light .sidebar-footer {
  border-top-color: rgba(203, 213, 225, 0.6);
  background: rgba(241, 245, 249, 0.6);
}

.sidebar-account-card {
  width: 100% !important;
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  padding: 10px 12px !important;
  border-radius: 16px !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.40) !important;
  cursor: pointer !important;
  text-align: left !important;
  color: #FFFFFF !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.sidebar-account-card:hover,
.sidebar-account-card.active {
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.22) 0%, rgba(16, 185, 129, 0.12) 100%) !important;
  border-color: rgba(29, 185, 84, 0.50) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 24px rgba(29, 185, 84, 0.25) !important;
}
body.light .sidebar-account-card {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  color: #0F172A !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

.sidebar-account-card .avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, #10B981, #047857);
  color: #FFFFFF;
  font-weight: 800;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1.5px solid rgba(255, 255, 255, 0.4);
}

.sidebar-account-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}
.sidebar-account-info .uname {
  font-size: 13.5px;
  font-weight: 700;
  color: #FFFFFF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
body.light .sidebar-account-info .uname {
  color: #0F172A;
}

.sidebar-account-info .urole {
  font-size: 11px;
  font-weight: 600;
  color: #10B981;
}

.sidebar-account-arrow {
  color: #94A3B8;
  transition: transform 0.2s ease;
}
.sidebar-account-card:hover .sidebar-account-arrow {
  transform: translateX(3px);
  color: #10B981;
}

.sidebar-footer-actions {
  display: flex;
  gap: 8px;
}

.sidebar-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.10);
  color: #94A3B8;
  cursor: pointer;
  transition: all 0.2s ease;
}
.sidebar-action-btn:hover {
  background: rgba(255, 255, 255, 0.10);
  color: #FFFFFF;
  border-color: rgba(255, 255, 255, 0.20);
}
.sidebar-action-btn.logout-btn:hover {
  background: rgba(244, 63, 94, 0.18);
  color: #FDA4AF;
  border-color: rgba(244, 63, 94, 0.40);
}
body.light .sidebar-action-btn {
  background: rgba(15, 23, 42, 0.04);
  border-color: #CBD5E1;
  color: #475569;
}

/* ==================== ÁREA DE CONTEÚDO PRINCIPAL (COM SIDEBAR) ==================== */
.app-content-wrapper {
  margin-left: 270px;
  width: calc(100% - 270px);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

.app-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  background: rgba(12, 22, 18, 0.70) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.10) !important;
  backdrop-filter: blur(35px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(35px) saturate(190%) !important;
  position: sticky;
  top: 0;
  z-index: 40;
}
body.light .app-topbar {
  background: rgba(255, 255, 255, 0.85) !important;
  border-bottom-color: rgba(203, 213, 225, 0.8) !important;
}

.app-content-wrapper .main {
  margin-top: 0 !important;
  padding: 24px 28px 40px !important;
  max-width: 1600px !important;
}

/* Responsividade Mobile / Tablet */
@media (max-width: 1024px) {
  .sidebar-executive {
    transform: translateX(-100%);
  }
  .sidebar-executive.mobile-open {
    transform: translateX(0);
  }
  .app-content-wrapper {
    margin-left: 0 !important;
    width: 100% !important;
  }
  .mobile-menu-btn {
    display: flex !important;
  }
}

/* Cards KPIs no padrão Liquid Glass 4K */
html.user-logged-in .kpi {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 30, 24, 0.78) 35%, rgba(8, 16, 12, 0.92) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  border-top: 1.5px solid rgba(255, 255, 255, 0.45) !important;
  border-left: 1px solid rgba(255, 255, 255, 0.25) !important;
  border-radius: 20px !important;
  box-shadow: 
    0 25px 60px -15px rgba(0, 0, 0, 0.80),
    0 0 35px -5px rgba(29, 185, 84, 0.14),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.35),
    inset 0 -1px 2px rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(40px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(40px) saturate(190%) !important;
  transition: all 0.28s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
html.user-logged-in .kpi:hover {
  border-color: rgba(52, 211, 153, 0.40) !important;
  box-shadow: 
    0 30px 70px -10px rgba(0, 0, 0, 0.85),
    0 0 45px -5px rgba(29, 185, 84, 0.22),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.45) !important;
  transform: translateY(-3px) !important;
}
html.user-logged-in .kpi .row1 {
  color: #94A3B8 !important;
  font-weight: 700 !important;
  text-transform: uppercase !important;
  font-size: 11.5px !important;
  letter-spacing: 0.05em !important;
}
html.user-logged-in .kpi .val {
  color: #FFFFFF !important;
  font-weight: 800 !important;
  letter-spacing: -0.02em !important;
}
html.user-logged-in .kpi .ic {
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.18), rgba(16, 185, 129, 0.08)) !important;
  border: 1px solid rgba(52, 211, 153, 0.25) !important;
  color: #A7F3D0 !important;
}
html.user-logged-in .kpi.kpi-balance::before {
  background: linear-gradient(90deg, #1DB954, #34D399) !important;
}
html.user-logged-in .kpi.kpi-income::before {
  background: linear-gradient(90deg, #10B981, #6EE7B7) !important;
}
html.user-logged-in .kpi.kpi-expense::before {
  background: linear-gradient(90deg, #EF4444, #F87171) !important;
}
html.user-logged-in .kpi.kpi-net::before {
  background: linear-gradient(90deg, #1DB954, #10B981) !important;
}
html.user-logged-in .kpi.kpi-tx::before {
  background: linear-gradient(90deg, #8B5CF6, #C084FC) !important;
}
html.user-logged-in .kpi .sub.up {
  color: #1DB954 !important;
  font-weight: 700 !important;
}

/* Painéis de Gráficos e Tabelas */
html.user-logged-in .panel,
html.user-logged-in .table-panel,
html.user-logged-in .cards-summary-panel,
html.user-logged-in .tx-footer-summary {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 30, 24, 0.78) 35%, rgba(8, 16, 12, 0.92) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  border-top: 1.5px solid rgba(255, 255, 255, 0.45) !important;
  border-left: 1px solid rgba(255, 255, 255, 0.25) !important;
  border-radius: 24px !important;
  box-shadow: 
    0 25px 60px -15px rgba(0, 0, 0, 0.80),
    0 0 35px -5px rgba(29, 185, 84, 0.14),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.35) !important;
  backdrop-filter: blur(40px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(40px) saturate(190%) !important;
}
html.user-logged-in .panel:hover {
  border-color: rgba(52, 211, 153, 0.40) !important;
  box-shadow: 
    0 30px 70px -10px rgba(0, 0, 0, 0.85),
    0 0 45px -5px rgba(29, 185, 84, 0.22),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.45) !important;
}
html.user-logged-in .panel-head h3,
html.user-logged-in .table-panel-head h3 {
  color: #FFFFFF !important;
  font-weight: 800 !important;
}
html.user-logged-in .panel-head .tag,
html.user-logged-in .table-panel-head .tag {
  background: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  color: #94A3B8 !important;
  border-radius: 10px !important;
}
html.user-logged-in .panel-head .tag:hover,
html.user-logged-in .table-panel-head .tag:hover {
  background: rgba(29, 185, 84, 0.18) !important;
  color: #A7F3D0 !important;
  border-color: rgba(52, 211, 153, 0.40) !important;
}

/* Tabelas */
html.user-logged-in table thead th {
  background: rgba(12, 22, 18, 0.85) !important;
  color: #94A3B8 !important;
  font-weight: 700 !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12) !important;
  font-size: 11.5px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.04em !important;
}
html.user-logged-in table tbody td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
  color: #F8FAFC !important;
}
html.user-logged-in table tbody tr:hover td {
  background: rgba(29, 185, 84, 0.08) !important;
}

/* Botões de Ação no padrão Liquid Emerald */
html.user-logged-in .btn-primary,
html.user-logged-in button.btn-primary {
  background: linear-gradient(135deg, #4ADE80 0%, #22C55E 25%, #1DB954 60%, #15803D 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.85) !important;
  border-top: 1.5px solid #FFFFFF !important;
  color: #031409 !important;
  border-radius: 14px !important;
  font-weight: 900 !important;
  letter-spacing: 0.02em !important;
  box-shadow: 
    0 10px 24px -4px rgba(29, 185, 84, 0.50),
    0 2px 6px rgba(0, 0, 0, 0.30),
    inset 0 1.5px 2px #FFFFFF,
    inset 0 -1.5px 2px rgba(21, 128, 61, 0.40) !important;
}
html.user-logged-in .btn-primary:hover,
html.user-logged-in button.btn-primary:hover {
  filter: brightness(1.06) !important;
  transform: translateY(-2px) !important;
  box-shadow: 
    0 14px 30px -4px rgba(29, 185, 84, 0.65),
    0 4px 10px rgba(0, 0, 0, 0.35),
    inset 0 1.5px 2px #FFFFFF !important;
}

/* Badges */
html.user-logged-in .badge-income,
html.user-logged-in .badge-receita {
  background: rgba(16, 185, 129, 0.16) !important;
  border: 1px solid rgba(16, 185, 129, 0.35) !important;
  color: #34D399 !important;
}
html.user-logged-in .badge-expense,
html.user-logged-in .badge-despesa {
  background: rgba(244, 63, 94, 0.16) !important;
  border: 1px solid rgba(244, 63, 94, 0.35) !important;
  color: #FB7185 !important;
}

/* Modais Pós-Login no padrão Liquid Glass 4K */
html.user-logged-in .modal {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 30, 24, 0.88) 35%, rgba(8, 16, 12, 0.96) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  border-top: 1.5px solid rgba(255, 255, 255, 0.45) !important;
  border-left: 1px solid rgba(255, 255, 255, 0.25) !important;
  backdrop-filter: blur(40px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(40px) saturate(190%) !important;
  box-shadow: 
    0 30px 80px -15px rgba(0, 0, 0, 0.85),
    0 0 50px -10px rgba(29, 185, 84, 0.16),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.35) !important;
  border-radius: 24px !important;
}
html.user-logged-in input,
html.user-logged-in select,
html.user-logged-in textarea,
html.user-logged-in .modal input,
html.user-logged-in .modal select,
html.user-logged-in .modal textarea {
  background: rgba(10, 18, 14, 0.65) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  color: #FFFFFF !important;
  border-radius: 12px !important;
}
html.user-logged-in input:focus,
html.user-logged-in select:focus,
html.user-logged-in textarea:focus,
html.user-logged-in .modal input:focus,
html.user-logged-in .modal select:focus,
html.user-logged-in .modal textarea:focus {
  border-color: #1DB954 !important;
  box-shadow: 0 0 12px rgba(29, 185, 84, 0.35) !important;
  outline: none !important;
}

/* Gaveta Mobile */
html.user-logged-in .mobile-drawer {
  background: rgba(12, 22, 18, 0.94) !important;
  border-right: 1px solid rgba(255, 255, 255, 0.14) !important;
  backdrop-filter: blur(35px) !important;
}
html.user-logged-in .mobile-drawer-nav button {
  background: rgba(255, 255, 255, 0.04) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  color: #94A3B8 !important;
}
html.user-logged-in .mobile-drawer-nav button:hover {
  background: rgba(29, 185, 84, 0.14) !important;
  color: #FFFFFF !important;
  border-color: rgba(29, 185, 84, 0.30) !important;
}
html.user-logged-in .mobile-drawer-nav button.active {
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.25) 0%, rgba(16, 185, 129, 0.14) 100%) !important;
  color: #FFFFFF !important;
  border: 1px solid rgba(52, 211, 153, 0.48) !important;
  box-shadow: 0 4px 18px rgba(29, 185, 84, 0.25) !important;
}

html.is-admin nav.menu button:not(#menuUsuariosBtn):not(#menuLogsBtn):not(#menuFuncoesBtn):not(#menuOrdensBtn),
html.is-admin nav.mobile-drawer-nav button:not(#mobileDrawerUsuariosBtn):not(#mobileDrawerLogsBtn):not(#mobileDrawerFuncoesBtn):not(#mobileDrawerOrdensBtn) {
  display: none !important;
}

html.is-admin #menuUsuariosBtn,
html.is-admin #menuLogsBtn,
html.is-admin #menuFuncoesBtn,
html.is-admin #menuOrdensBtn,
html.is-admin #mobileDrawerUsuariosBtn,
html.is-admin #mobileDrawerLogsBtn,
html.is-admin #mobileDrawerFuncoesBtn,
html.is-admin #mobileDrawerOrdensBtn {
  display: flex !important;
}

:root{
  --bg:#07100B;
  --sidebar:rgba(14, 24, 20, 0.85);
  --card:rgba(16, 28, 22, 0.72);
  --card-border:rgba(255, 255, 255, 0.14);
  --text:#F8FAFC;
  --text-dim:#94A3B8;
  --text-faint:#64748B;
  --green:#1DB954;
  --green-soft:rgba(29, 185, 84, 0.16);
  --emerald:#10B981;
  --emerald-soft:rgba(16, 185, 129, 0.16);
  --primary:#1DB954;
  --primary-hover:#1ED760;
  --red:#F43F5E;
  --red-soft:rgba(244, 63, 94, 0.14);
  --blue:#38BDF8;
  --purple:#A855F7;
  --orange:#F59E0B;
  --teal:#14B8A6;
  --pink:#EC4899;
  --hover:rgba(255, 255, 255, 0.08);
  --radius:20px;
  --shadow:0 25px 60px -15px rgba(0, 0, 0, 0.80), 0 0 35px -5px rgba(29, 185, 84, 0.14), inset 0 1px 1px rgba(255, 255, 255, 0.22);
}
body.light, html.light body, html.light {
  --bg:#F2F7F4;
  --sidebar:rgba(255, 255, 255, 0.90);
  --card:rgba(255, 255, 255, 0.88);
  --card-border:rgba(203, 213, 225, 0.85);
  --text:#0F172A;
  --text-dim:#334155;
  --text-faint:#64748B;
  --hover:#E2E8F0;
  --shadow:0 15px 35px rgba(15, 23, 42, 0.08);
}
*{box-sizing:border-box; margin:0; padding:0; -webkit-tap-highlight-color:transparent;}
html, body{overflow-x:clip !important; width:100%;}
body{
  font-family:'Plus Jakarta Sans','Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Arial,sans-serif;
  background-color:#030612 !important;
  background-image:
    radial-gradient(at 12% 15%, rgba(56, 189, 248, 0.16) 0px, transparent 50%),
    radial-gradient(at 88% 15%, rgba(99, 102, 241, 0.18) 0px, transparent 55%),
    radial-gradient(at 50% 48%, rgba(245, 158, 11, 0.12) 0px, transparent 52%),
    radial-gradient(at 18% 85%, rgba(16, 185, 129, 0.14) 0px, transparent 50%),
    radial-gradient(at 82% 85%, rgba(59, 130, 246, 0.16) 0px, transparent 55%),
    linear-gradient(180deg, #030612 0%, #060C1C 50%, #02040C 100%) !important;
  background-size: cover !important;
  background-position: center center !important;
  background-attachment: fixed !important;
  background-repeat: no-repeat !important;
  color:var(--text); min-height:100vh; transition:background .25s,color .25s;
  zoom:var(--app-zoom, 1);
}
body.light {
  background-color:#F8FAFC !important;
  background-image:
    radial-gradient(at 12% 15%, rgba(56, 189, 248, 0.10) 0px, transparent 50%),
    radial-gradient(at 88% 15%, rgba(99, 102, 241, 0.08) 0px, transparent 55%),
    radial-gradient(at 50% 48%, rgba(245, 158, 11, 0.06) 0px, transparent 52%),
    radial-gradient(at 18% 85%, rgba(16, 185, 129, 0.08) 0px, transparent 50%),
    radial-gradient(at 82% 85%, rgba(59, 130, 246, 0.08) 0px, transparent 55%),
    linear-gradient(180deg, #F8FAFC 0%, #EDF2F7 50%, #F1F5F9 100%) !important;
  background-size: cover !important;
  background-position: center center !important;
  background-attachment: fixed !important;
  background-repeat: no-repeat !important;
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
  body, html {
    background: var(--bg) !important;
    color: var(--text) !important;
    zoom: 1 !important;
  }
  .app-bg-scene, .app-bg-grid, .app-bg-chart, .app-blob, .mobile-drawer-overlay, .mobile-drawer, .scale-dropdown, .notif-panel {
    display: none !important;
  }
  #appMain, #pageContent, .main, .topheader, .topheader-row, nav.menu, .kpis, .kpi, .panel, .table-panel, .tx-footer-summary, .app-dev-credit {
    overflow: visible !important;
    opacity: 1 !important;
    visibility: visible !important;
  }
  .panel, .table-panel {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}

/* ==================== Tela de Auth Ultra Moderna (Visual Liquid Glass 4K) ==================== */
.auth-container {
  --auth-gold: #1DB954;
  --auth-gold-dark: #15803D;
  --auth-blue: #38BDF8;
  --auth-emerald: #10B981;
  --auth-cyan: #34D399;
  --auth-card: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 30, 24, 0.78) 40%, rgba(8, 16, 12, 0.92) 100%);
  --auth-border: rgba(255, 255, 255, 0.16);
  --auth-input-bg: rgba(10, 18, 14, 0.65);
  --auth-text: #FFFFFF;
  --auth-text-dim: #94A3B8;
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  min-height: 100vh;
  padding: 0 0 clamp(8px, 1.5vh, 18px) 0;
  background: transparent !important;
}
.auth-container.show { display: flex; }

.auth-container::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 750px;
  height: 750px;
  background: radial-gradient(circle, rgba(29, 185, 84, 0.18) 0%, rgba(16, 185, 129, 0.12) 40%, transparent 70%);
  filter: blur(90px);
  pointer-events: none;
  z-index: 1;
  border-radius: 50%;
  animation: authAuraPulse 6s ease-in-out infinite alternate;
}
@keyframes authAuraPulse {
  0% { transform: translate(-50%, -50%) scale(0.92); opacity: 0.75; }
  100% { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
}

body.light .auth-container {
  --auth-gold: #059669;
  --auth-gold-dark: #047857;
  --auth-card: #FFFFFF;
  --auth-border: #CBD5E1;
  --auth-input-bg: #FFFFFF;
  --auth-text: #0F172A;
  --auth-text-dim: #475569;
  background: transparent !important;
}

.auth-top-bar {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
  z-index: 20;
}

.auth-theme-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.45);
  color: var(--auth-gold);
  width: 48px;
  height: 48px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  backdrop-filter: blur(14px);
  box-shadow: 0 4px 18px rgba(245, 158, 11, 0.25);
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.auth-theme-btn svg {
  width: 24px !important;
  height: 24px !important;
  stroke-width: 2.2px;
}
.auth-theme-btn:hover {
  transform: scale(1.08);
  background: rgba(255, 255, 255, 0.14);
  border-color: rgba(245, 158, 11, 0.70);
  box-shadow: 0 6px 24px rgba(245, 158, 11, 0.40);
}
body.light .auth-theme-btn {
  background: #FFFFFF;
  border-color: #CBD5E1;
  box-shadow: 0 4px 16px rgba(0,0,0,0.08);
}

.auth-grid {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(245, 158, 11, 0.06) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 75%);
  mask-image: radial-gradient(circle at 50% 45%, #000 0%, transparent 75%);
}

.auth-blob {
  position: fixed;
  border-radius: 50%;
  filter: blur(85px);
  opacity: 0.32;
  pointer-events: none;
  will-change: transform;
  z-index: 0;
}
.auth-blob.b1 {
  width: 460px;
  height: 460px;
  background: #10B981;
  top: -110px;
  left: -110px;
  animation: blobFloat 22s ease-in-out infinite;
}
.auth-blob.b2 {
  width: 440px;
  height: 440px;
  background: #3B82F6;
  bottom: -130px;
  right: -90px;
  animation: blobFloat 26s ease-in-out infinite;
  animation-delay: -9s;
}
.auth-blob.b3 {
  width: 420px;
  height: 420px;
  background: #F59E0B;
  top: 28%;
  right: 12%;
  opacity: 0.24;
  animation: blobFloat 28s ease-in-out infinite;
  animation-delay: -14s;
}
body.light .auth-blob { opacity: 0.14; }

@keyframes blobFloat {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(40px, -45px) scale(1.08); }
  66% { transform: translate(-35px, 30px) scale(0.94); }
}

@keyframes authCardEntrance {
  from { opacity: 0; transform: translateY(28px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* ==================== EFEITO TELA DE VIDRO PANORÂMICA (4K LIQUID GLASS SCREEN) ==================== */
.glass-viewport-screen {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 1;
  overflow: hidden;
}

/* Placas de Vidro Líquido Flutuantes em Profundidade 4K */
.glass-shard {
  position: absolute;
  border-radius: 40px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.02) 50%, rgba(56, 189, 248, 0.10) 100%);
  border: 1.5px solid rgba(255, 255, 255, 0.26);
  border-top: 2.5px solid rgba(255, 255, 255, 0.75);
  border-left: 2px solid rgba(255, 255, 255, 0.50);
  backdrop-filter: blur(35px) saturate(240%);
  -webkit-backdrop-filter: blur(35px) saturate(240%);
  box-shadow: 
    0 30px 70px rgba(0, 0, 0, 0.65),
    inset 0 2px 5px rgba(255, 255, 255, 0.55),
    inset 0 -2px 4px rgba(0, 0, 0, 0.40);
  pointer-events: none;
  will-change: transform;
}

.glass-shard-1 {
  top: 2%;
  left: -4%;
  width: 420px;
  height: 420px;
  transform: rotate(-14deg);
  box-shadow: 0 35px 90px rgba(0,0,0,0.75), 0 0 60px rgba(56, 189, 248, 0.28), inset 0 2px 5px rgba(255,255,255,0.7);
  animation: glassFloat1 18s ease-in-out infinite alternate;
}

.glass-shard-2 {
  bottom: -6%;
  right: -3%;
  width: 480px;
  height: 480px;
  transform: rotate(18deg);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.16) 0%, rgba(245, 158, 11, 0.10) 50%, rgba(16, 185, 129, 0.08) 100%);
  box-shadow: 0 40px 100px rgba(0,0,0,0.8), 0 0 70px rgba(245, 158, 11, 0.25), inset 0 2px 5px rgba(255,255,255,0.7);
  animation: glassFloat2 22s ease-in-out infinite alternate;
}

.glass-shard-3 {
  top: 22%;
  right: 6%;
  width: 250px;
  height: 250px;
  border-radius: 32px;
  transform: rotate(25deg);
  box-shadow: 0 25px 60px rgba(0,0,0,0.55), 0 0 50px rgba(99, 102, 241, 0.30), inset 0 2px 4px rgba(255,255,255,0.6);
  animation: glassFloat3 15s ease-in-out infinite alternate;
}

.glass-shard-4 {
  bottom: 16%;
  left: 5%;
  width: 230px;
  height: 230px;
  border-radius: 32px;
  transform: rotate(-20deg);
  box-shadow: 0 25px 60px rgba(0,0,0,0.55), 0 0 50px rgba(16, 185, 129, 0.26), inset 0 2px 4px rgba(255,255,255,0.6);
  animation: glassFloat4 16s ease-in-out infinite alternate;
}

.glass-shard-5 {
  top: 60%;
  right: 28%;
  width: 140px;
  height: 140px;
  border-radius: 26px;
  transform: rotate(12deg);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(236, 72, 153, 0.08) 100%);
  box-shadow: 0 20px 45px rgba(0,0,0,0.45), 0 0 35px rgba(236, 72, 153, 0.20), inset 0 2px 4px rgba(255,255,255,0.5);
  animation: glassFloat3 19s ease-in-out infinite alternate;
}

@keyframes glassFloat1 {
  0% { transform: translateY(0) rotate(-14deg) scale(1); }
  100% { transform: translateY(32px) rotate(-6deg) scale(1.06); }
}

@keyframes glassFloat2 {
  0% { transform: translateY(0) rotate(18deg) scale(1); }
  100% { transform: translateY(-36px) rotate(10deg) scale(1.05); }
}

@keyframes glassFloat3 {
  0% { transform: translateY(0) rotate(25deg) scale(1); }
  100% { transform: translateY(-26px) rotate(34deg) scale(1.04); }
}

@keyframes glassFloat4 {
  0% { transform: translateY(0) rotate(-20deg) scale(1); }
  100% { transform: translateY(28px) rotate(-12deg) scale(1.05); }
}

/* Feixe de Luz Prismática e Refrativo de Vidro 4K */
.glass-screen-reflection {
  position: fixed;
  inset: 0;
  background: linear-gradient(115deg, transparent 15%, rgba(255, 255, 255, 0.03) 38%, rgba(255, 255, 255, 0.12) 46%, rgba(253, 230, 138, 0.08) 50%, rgba(255, 255, 255, 0.03) 54%, transparent 75%);
  background-size: 250% 250%;
  pointer-events: none;
  z-index: 2;
  animation: glassLightSweep 14s ease-in-out infinite;
}

@keyframes glassLightSweep {
  0% { background-position: -140% -140%; }
  50% { background-position: 140% 140%; }
  100% { background-position: -140% -140%; }
}

body.light .glass-shard {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.90) 0%, rgba(255, 255, 255, 0.55) 60%, rgba(219, 234, 254, 0.60) 100%) !important;
  border-color: rgba(255, 255, 255, 0.98) !important;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.10), inset 0 2px 5px #FFFFFF !important;
}

/* Card de Autenticação Ultra 4K Liquid Glass (Smoked Emerald Glassmorphism) */
.auth-card-nexus {
  position: relative;
  z-index: 10;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 30, 24, 0.78) 35%, rgba(8, 16, 12, 0.92) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  border-top: 1.5px solid rgba(255, 255, 255, 0.45) !important;
  border-left: 1px solid rgba(255, 255, 255, 0.25) !important;
  border-radius: 28px;
  padding: clamp(18px, 2.4vh, 26px) clamp(18px, 2.2vw, 28px);
  width: 100%;
  max-width: 440px;
  box-shadow: 
    0 30px 80px -15px rgba(0, 0, 0, 0.85),
    0 0 50px -10px rgba(29, 185, 84, 0.16),
    inset 0 1px 1.5px rgba(255, 255, 255, 0.35),
    inset 0 -1px 2px rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(40px) saturate(190%);
  -webkit-backdrop-filter: blur(40px) saturate(190%);
  animation: authCardEntrance 0.55s cubic-bezier(0.16, 1, 0.3, 1);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease;
  overflow: hidden;
  transform-style: preserve-3d;
}

.auth-card-nexus::before {
  content: '';
  position: absolute;
  top: 0;
  left: 8%;
  right: 8%;
  height: 1.5px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), #FFFFFF 50%, rgba(110, 231, 183, 0.85) 65%, transparent);
  pointer-events: none;
  z-index: 3;
}

.auth-card-glare {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(circle 380px at var(--card-mouse-x, 50%) var(--card-mouse-y, 50%), rgba(255, 255, 255, 0.12), transparent 70%);
  opacity: var(--card-glare-opacity, 0);
  transition: opacity 0.35s ease;
  z-index: 4;
}

body.light .auth-card-nexus {
  background: rgba(255, 255, 255, 0.90) !important;
  border: 1px solid rgba(255, 255, 255, 0.95) !important;
  border-top: 1.5px solid #FFFFFF !important;
  box-shadow: 0 25px 60px -10px rgba(15, 23, 42, 0.10), 0 0 30px -5px rgba(16, 185, 129, 0.08), inset 0 1px 1.5px #FFFFFF !important;
  backdrop-filter: blur(40px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(40px) saturate(180%) !important;
}

body.light .auth-card-glare {
  background: radial-gradient(circle 380px at var(--card-mouse-x, 50%) var(--card-mouse-y, 50%), rgba(16, 185, 129, 0.10), transparent 70%) !important;
}

/* Layout Executivo 2 Colunas para o Login no server.js (Split Harmonizado) */
.auth-exec-layout {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 1180px;
  margin: auto;
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: clamp(20px, 3vw, 44px);
  align-items: center;
  justify-content: center;
  padding: clamp(6px, 1.2vh, 16px) 12px;
  flex: 1;
}

.auth-global-footer {
  position: relative;
  z-index: 10;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 6px 14px 10px;
}

@media (max-width: 1024px) {
  .auth-exec-layout {
    grid-template-columns: 1fr;
    max-width: 440px;
    gap: 20px;
    padding: 12px 10px;
  }
  .auth-showcase-panel {
    display: none;
  }
}

.auth-showcase-panel {
  display: flex;
  flex-direction: column;
  gap: clamp(12px, 1.8vh, 20px);
  text-align: left;
  justify-content: center;
}

.auth-showcase-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(59, 130, 246, 0.12));
  border: 1px solid rgba(245, 158, 11, 0.35);
  color: #FCD34D;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  width: fit-content;
  backdrop-filter: blur(12px);
}

.auth-showcase-title {
  font-size: clamp(26px, 2.8vw, 36px);
  font-weight: 900;
  line-height: 1.15;
  color: #FFFFFF;
  letter-spacing: -0.02em;
}

.auth-showcase-title span {
  background: linear-gradient(90deg, #FCD34D 0%, #F59E0B 50%, #FBBF24 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.auth-showcase-desc {
  font-size: clamp(13px, 1.3vw, 14.5px);
  color: #CBD5E1;
  line-height: 1.55;
  max-width: 500px;
}

.auth-showcase-metrics {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin-top: 2px;
}

.auth-metric-card {
  padding: clamp(10px, 1.4vh, 14px) 12px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(20px);
  transition: all 0.25s ease;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.auth-metric-card:hover {
  transform: translateY(-3px);
  border-color: rgba(245, 158, 11, 0.45);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.6);
}

.metric-card-label {
  font-size: 11px;
  font-weight: 800;
  color: var(--text-dim, #94A3B8);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.metric-val {
  font-size: 18px;
  font-weight: 900;
  color: var(--text, #FFFFFF);
}
.metric-sub-green {
  font-size: 11px;
  font-weight: 700;
  color: #10B981;
  margin-top: 2px;
}
.metric-sub-amber {
  font-size: 11px;
  font-weight: 700;
  color: #F59E0B;
  margin-top: 2px;
}
.metric-sub-blue {
  font-size: 11px;
  font-weight: 700;
  color: #38BDF8;
  margin-top: 2px;
}
.auth-showcase-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  font-weight: 600;
  color: #94A3B8;
  margin-top: 4px;
}

body.light .auth-showcase-badge {
  background: rgba(245, 158, 11, 0.12) !important;
  border: 1.5px solid rgba(180, 83, 9, 0.35) !important;
  color: #92400E !important;
  font-weight: 800 !important;
}
body.light .auth-showcase-badge span:first-child {
  background: #D97706 !important;
}
body.light .auth-showcase-title {
  color: #0F172A !important;
}
body.light .auth-showcase-title span {
  background: linear-gradient(90deg, #D97706 0%, #B45309 60%, #92400E 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  filter: drop-shadow(0 1px 1px rgba(180, 83, 9, 0.20)) !important;
}
body.light .auth-showcase-desc {
  color: #334155 !important;
  font-weight: 600 !important;
}
body.light .auth-metric-card {
  background: #FFFFFF !important;
  border: 1.5px solid #CBD5E1 !important;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08) !important;
}
body.light .auth-metric-card .metric-card-label {
  color: #475569 !important;
}
body.light .auth-metric-card .metric-val {
  color: #0F172A !important;
}
body.light .metric-sub-green {
  color: #047857 !important;
  font-weight: 800 !important;
}
body.light .metric-sub-amber {
  color: #B45309 !important;
  font-weight: 800 !important;
}
body.light .metric-sub-blue {
  color: #0284C7 !important;
  font-weight: 800 !important;
}
body.light .auth-showcase-footer,
body.light .auth-showcase-footer span {
  color: #334155 !important;
  font-weight: 700 !important;
}

.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: 16px;
}

.auth-logo-badge {
  width: 58px;
  height: 58px;
  border-radius: 18px;
  background: linear-gradient(135deg, #ECFDF5 0%, #6EE7B7 25%, #10B981 60%, #064E3B 100%) !important;
  color: #022C22 !important;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 25px;
  font-family: 'Outfit', sans-serif;
  border: 1.5px solid rgba(255, 255, 255, 0.90) !important;
  box-shadow: 
    0 10px 24px -4px rgba(16, 185, 129, 0.50),
    0 2px 6px rgba(0, 0, 0, 0.35),
    inset 0 2px 3px #FFFFFF,
    inset 0 -2px 3px rgba(6, 78, 59, 0.45) !important;
  margin-bottom: 12px;
  position: relative;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s ease;
}
.auth-logo-badge:hover {
  transform: scale(1.06) translateY(-2px);
  box-shadow: 
    0 14px 30px -4px rgba(16, 185, 129, 0.65),
    0 4px 10px rgba(0, 0, 0, 0.40),
    inset 0 2px 3px #FFFFFF !important;
}
.auth-logo-badge::after {
  content: '';
  position: absolute;
  inset: -4px;
  border-radius: 22px;
  background: radial-gradient(circle, rgba(29, 185, 84, 0.25) 0%, transparent 70%);
  z-index: -1;
  pointer-events: none;
}

.auth-title {
  font-family: 'Outfit', 'Plus Jakarta Sans', sans-serif;
  font-size: 22px;
  font-weight: 900;
  color: #FFFFFF;
  letter-spacing: 0.02em;
  display: flex;
  align-items: center;
  gap: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}
.auth-title span {
  background: linear-gradient(135deg, #ECFDF5 0%, #6EE7B7 35%, #10B981 75%, #059669 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  font-size: 13.5px;
  font-weight: 900;
  letter-spacing: 0.12em;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4));
}

.auth-subtitle {
  font-size: 12.5px;
  color: #94A3B8;
  margin-top: 5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

body.light .auth-title {
  color: #0F172A !important;
  text-shadow: none !important;
}
body.light .auth-title span {
  color: #059669 !important;
  text-shadow: none !important;
  font-weight: 900 !important;
}
body.light .auth-subtitle {
  color: #475569 !important;
  text-shadow: none !important;
  font-weight: 700 !important;
}

/* Abas de Navegação Segmentada (Entrar / Criar Conta) */
.auth-tabs-nav {
  display: flex;
  background: rgba(10, 18, 14, 0.60) !important;
  border: 1px solid rgba(255, 255, 255, 0.10) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.20) !important;
  border-radius: 14px !important;
  padding: 4px !important;
  margin-bottom: 18px;
  gap: 4px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.40) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
}

body.light .auth-tabs-nav {
  background: #E2E8F0 !important;
  border-color: #CBD5E1 !important;
}

.auth-tab-btn {
  flex: 1;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: #94A3B8;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
.auth-tab-btn:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.06);
}
.auth-tab-btn.active {
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.25) 0%, rgba(16, 185, 129, 0.18) 100%) !important;
  color: #A7F3D0 !important;
  border: 1px solid rgba(29, 185, 84, 0.55) !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.25) !important;
  font-weight: 800;
}
body.light .auth-tab-btn {
  color: #64748B !important;
}
body.light .auth-tab-btn:hover {
  color: #0F172A !important;
}
body.light .auth-tab-btn.active {
  background: #FFFFFF !important;
  color: #047857 !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 2px 8px rgba(15,23,42,0.08) !important;
}

/* Campos de Formulário Modernos com Ícones */
.auth-field {
  margin-bottom: 16px;
}
.auth-field label {
  display: block;
  font-size: 11px;
  font-weight: 800;
  color: #94A3B8;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
body.light .auth-field label {
  color: #334155 !important;
}

.auth-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  background: rgba(15, 23, 42, 0.50) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.22) !important;
  border-radius: 14px !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.06) !important;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}
body.light .auth-input-wrapper {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.05) !important;
}

.auth-input-wrapper:focus-within {
  border-color: rgba(245, 158, 11, 0.80) !important;
  background: rgba(15, 23, 42, 0.75) !important;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.16), 0 8px 20px -4px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
  transform: translateY(-1px);
}
body.light .auth-input-wrapper:focus-within {
  background: #FFFFFF !important;
  border-color: #D97706 !important;
  box-shadow: 0 0 0 3px rgba(217, 119, 6, 0.15), 0 6px 16px -2px rgba(15, 23, 42, 0.08) !important;
}

.auth-input-wrapper.highlight-glow {
  border-color: var(--auth-gold) !important;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.35) !important;
}

@keyframes authShake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-6px); }
  40%, 80% { transform: translateX(6px); }
}

.auth-input-wrapper.input-error {
  border-color: #EF4444 !important;
  box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.20), 0 6px 16px rgba(0, 0, 0, 0.4) !important;
  animation: authShake 0.35s ease;
}

.auth-feedback-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin: 14px 0;
  padding: 12px 14px;
  border-radius: 14px;
  font-size: 13px;
  line-height: 1.45;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  animation: authShake 0.35s ease;
  transition: all 0.25s ease;
}
.auth-feedback-banner.error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.12) 0%, rgba(153, 27, 27, 0.06) 100%) !important;
  border: 1px solid rgba(248, 113, 113, 0.35) !important;
  border-left: 3.5px solid #EF4444 !important;
  color: #FEE2E2 !important;
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
}
.auth-feedback-banner.warning {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.12) 0%, rgba(180, 83, 9, 0.06) 100%) !important;
  border: 1px solid rgba(251, 191, 36, 0.35) !important;
  border-left: 3.5px solid #F59E0B !important;
  color: #FEF3C7 !important;
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
}
.auth-feedback-banner.success {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12) 0%, rgba(5, 150, 105, 0.06) 100%) !important;
  border: 1px solid rgba(52, 211, 153, 0.35) !important;
  border-left: 3.5px solid #10B981 !important;
  color: #D1FAE5 !important;
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
}

.auth-input-icon {
  width: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94A3B8;
  flex-shrink: 0;
}
body.light .auth-input-icon {
  color: #64748B !important;
}
body.light .auth-input-wrapper:focus-within .auth-input-icon {
  color: #D97706 !important;
}

.auth-input-wrapper input {
  flex: 1;
  min-width: 0;
  background: transparent !important;
  border: none;
  padding: 14px 12px 14px 0;
  color: #FFFFFF;
  font-size: 14px;
  font-weight: 600;
  outline: none;
  width: 100%;
}
.auth-input-wrapper input::placeholder {
  color: #64748B;
}

/* Override Nativo de Autofill do Navegador (Elimina Caixas Brancas/Azuis) */
.auth-input-wrapper input:-webkit-autofill,
.auth-input-wrapper input:-webkit-autofill:hover,
.auth-input-wrapper input:-webkit-autofill:focus,
.auth-input-wrapper input:-webkit-autofill:active {
  -webkit-text-fill-color: #FFFFFF !important;
  -webkit-box-shadow: 0 0 0px 1000px #050811 inset !important;
  box-shadow: 0 0 0px 1000px #050811 inset !important;
  transition: background-color 5000s ease-in-out 0s !important;
  border-radius: 0 14px 14px 0 !important;
}

body.light .auth-input-wrapper input:-webkit-autofill,
body.light .auth-input-wrapper input:-webkit-autofill:hover,
body.light .auth-input-wrapper input:-webkit-autofill:focus,
body.light .auth-input-wrapper input:-webkit-autofill:active {
  -webkit-text-fill-color: #0F172A !important;
  -webkit-box-shadow: 0 0 0px 1000px #F8FAFC inset !important;
  box-shadow: 0 0 0px 1000px #F8FAFC inset !important;
}

/* Botão de Olho para Visualizar/Ocultar Senha (Sem caixas brancas, 100% integrado) */
input[type="password"]::-ms-reveal,
input[type="password"]::-ms-clear,
input[type="text"]::-ms-reveal,
input[type="text"]::-ms-clear {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
}

.auth-pass-toggle,
.auth-pass-toggle-btn {
  background: transparent !important;
  background-color: transparent !important;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  color: #94A3B8 !important;
  width: 38px !important;
  height: 38px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  cursor: pointer !important;
  flex-shrink: 0 !important;
  padding: 0 !important;
  margin: 0 4px 0 0 !important;
  border-radius: 10px !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
  -webkit-appearance: none !important;
  appearance: none !important;
}
.auth-pass-toggle:hover,
.auth-pass-toggle-btn:hover {
  color: #F59E0B !important;
  background: rgba(245, 158, 11, 0.15) !important;
  transform: scale(1.08);
}
.auth-pass-toggle svg,
.auth-pass-toggle-btn svg {
  width: 18px !important;
  height: 18px !important;
  stroke: currentColor !important;
  stroke-width: 2.2px !important;
  fill: none !important;
  pointer-events: none !important;
  display: block !important;
}
body.light .auth-pass-toggle,
body.light .auth-pass-toggle-btn {
  color: #64748B !important;
}
body.light .auth-pass-toggle:hover,
body.light .auth-pass-toggle-btn:hover {
  color: #D97706 !important;
  background: rgba(217, 119, 6, 0.10) !important;
}

/* Botão Primário 4K Liquid Emerald / Spotify Green */
.btn-auth-primary {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 46px;
  padding: 0 20px;
  background: linear-gradient(135deg, #4ADE80 0%, #22C55E 25%, #1DB954 60%, #15803D 100%) !important;
  color: #031409 !important;
  border: 1px solid rgba(255, 255, 255, 0.85) !important;
  border-top: 1.5px solid #FFFFFF !important;
  border-radius: 14px !important;
  font-weight: 900 !important;
  font-size: 14.5px !important;
  letter-spacing: 0.02em;
  cursor: pointer;
  margin-top: 8px;
  box-shadow: 
    0 10px 24px -4px rgba(29, 185, 84, 0.50),
    0 2px 6px rgba(0, 0, 0, 0.30),
    inset 0 1.5px 2px #FFFFFF,
    inset 0 -1.5px 2px rgba(21, 128, 61, 0.40) !important;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.btn-auth-primary::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.40), transparent);
  transition: left 0.5s ease;
}
.btn-auth-primary:hover {
  filter: brightness(1.06);
  transform: translateY(-2px);
  box-shadow: 
    0 14px 30px -4px rgba(29, 185, 84, 0.65),
    0 4px 10px rgba(0, 0, 0, 0.35),
    inset 0 1.5px 2px #FFFFFF !important;
}
.btn-auth-primary:hover::before {
  left: 100%;
}
.btn-auth-primary:active {
  transform: translateY(0) scale(0.98);
}
.btn-auth-primary:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.auth-forgot-link {
  font-size: 12.5px;
  color: var(--auth-gold);
  font-weight: 700;
  cursor: pointer;
  transition: color 0.15s;
  text-decoration: none;
}
.auth-forgot-link:hover {
  text-decoration: underline;
  color: #6EE7B7;
}

body.light .btn-auth-primary {
  background: linear-gradient(135deg, #6EE7B7 0%, #10B981 35%, #059669 70%, #047857 100%) !important;
  color: #FFFFFF !important;
  border: 1.5px solid rgba(4, 120, 87, 0.5) !important;
  box-shadow: 0 10px 24px -4px rgba(16, 185, 129, 0.45), inset 0 1.5px 2px #FFFFFF !important;
}
body.light .btn-auth-primary:hover {
  filter: brightness(1.06) !important;
  box-shadow: 0 14px 32px -4px rgba(16, 185, 129, 0.60), inset 0 1.5px 2px #FFFFFF !important;
}

body.light .auth-forgot-link {
  color: #B45309 !important;
  font-weight: 800 !important;
}
body.light .auth-forgot-link:hover {
  color: #92400E !important;
}

body.light .auth-bottom-text {
  color: #475569 !important;
}
body.light .auth-bottom-text a {
  color: #B45309 !important;
  font-weight: 800 !important;
}
body.light .auth-bottom-text a:hover {
  color: #92400E !important;
}

/* Botão 4K Glass para Abertura e Consulta de Ordem de Serviço */
.btn-open-os {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 0 14px;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.18) 0%, rgba(15, 23, 42, 0.65) 100%) !important;
  border: 1px solid rgba(96, 165, 250, 0.30) !important;
  border-top: 1px solid rgba(191, 219, 254, 0.45) !important;
  border-radius: 12px !important;
  color: #BFDBFE !important;
  font-size: 12px !important;
  font-weight: 800 !important;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 4px 14px -2px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.12) !important;
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
  margin-top: 10px;
}
.btn-open-os:hover {
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.30) 0%, rgba(15, 23, 42, 0.80) 100%) !important;
  border-color: rgba(147, 197, 253, 0.55) !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px);
  box-shadow: 0 8px 20px -2px rgba(37, 99, 235, 0.30), inset 0 1px 1px rgba(255, 255, 255, 0.25) !important;
}
.btn-open-os svg {
  transition: transform 0.2s ease;
}
.btn-open-os:hover svg {
  transform: scale(1.12);
}



/* Botão 4K Glass para Consultar / Acompanhar O.S. */
.btn-consult-os {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.05);
  border: 1.5px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  color: #E2E8F0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  transition: all 0.2s ease;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.btn-consult-os:hover {
  background: rgba(59, 130, 246, 0.16);
  border-color: rgba(96, 165, 250, 0.6);
  color: #93C5FD;
  transform: translateY(-1px);
}
.btn-consult-os svg {
  transition: transform 0.2s ease;
}
.btn-consult-os:hover svg {
  transform: scale(1.12);
}

/* Abas do Modal de O.S. */
.os-tabs-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 12px;
  padding-right: 42px;
}
.os-tab-btn {
  flex: 1;
  padding: 9px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: #94A3B8;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  font-family: inherit;
}
.os-tab-btn:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.08);
}
.os-tab-btn.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(37, 99, 235, 0.15));
  border-color: rgba(96, 165, 250, 0.55);
  color: #FFFFFF;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.25);
}

/* Cards de O.S. Consultada */
.os-consult-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  padding: 16px;
  margin-bottom: 14px;
  transition: all 0.2s ease;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  text-align: left;
}
.os-consult-card:hover {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(255, 255, 255, 0.06);
  transform: translateY(-2px);
}

/* Suporte a Tema Claro - Botões e Modais de O.S. */
body.light .btn-open-os,
html.light .btn-open-os {
  background: linear-gradient(135deg, #F0F7FF 0%, #E0EEFE 50%, #CFE2FE 100%) !important;
  border: 1.5px solid #93C5FD !important;
  border-top: 1.5px solid #BFDBFE !important;
  color: #1D4ED8 !important;
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.12), inset 0 1px 1px #FFFFFF !important;
}
body.light .btn-open-os:hover,
html.light .btn-open-os:hover {
  background: linear-gradient(135deg, #E0EEFE 0%, #CFE2FE 50%, #BFDBFE 100%) !important;
  border-color: #3B82F6 !important;
  color: #1E3A8A !important;
  box-shadow: 0 6px 18px rgba(37, 99, 235, 0.22), inset 0 1px 1px #FFFFFF !important;
}

body.light .btn-consult-os,
html.light .btn-consult-os {
  background: #F1F5F9 !important;
  border-color: #CBD5E1 !important;
  color: #334155 !important;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05) !important;
}
body.light .btn-consult-os:hover,
html.light .btn-consult-os:hover {
  background: #E2E8F0 !important;
  border-color: #94A3B8 !important;
  color: #0F172A !important;
}

body.light .os-tabs-nav,
html.light .os-tabs-nav {
  border-bottom-color: #E2E8F0 !important;
}
body.light .os-tab-btn,
html.light .os-tab-btn {
  background: #F1F5F9 !important;
  border-color: #CBD5E1 !important;
  color: #64748B !important;
}
body.light .os-tab-btn:hover,
html.light .os-tab-btn:hover {
  background: #E2E8F0 !important;
  color: #0F172A !important;
}
body.light .os-tab-btn.active,
html.light .os-tab-btn.active {
  background: #EFF6FF !important;
  border-color: #3B82F6 !important;
  color: #1D4ED8 !important;
  box-shadow: 0 2px 8px rgba(37, 99, 235, 0.15) !important;
}

body.light .os-consult-card,
html.light .os-consult-card {
  background: #FFFFFF !important;
  border-color: #E2E8F0 !important;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06) !important;
  color: #0F172A !important;
}
body.light .os-consult-card:hover,
html.light .os-consult-card:hover {
  border-color: #93C5FD !important;
  background: #F8FAFC !important;
}

body.light #overlayNovaOrdem .modal,
html.light #overlayNovaOrdem .modal {
  background: #FFFFFF !important;
  border: 1.5px solid #CBD5E1 !important;
  box-shadow: 0 25px 60px rgba(15, 23, 42, 0.15), 0 0 35px rgba(59, 130, 246, 0.08) !important;
  color: #0F172A !important;
}
body.light #overlayNovaOrdem h2,
html.light #overlayNovaOrdem h2 {
  color: #0F172A !important;
}
body.light #overlayNovaOrdem p,
html.light #overlayNovaOrdem p {
  color: #475569 !important;
}
body.light #overlayNovaOrdem label,
html.light #overlayNovaOrdem label {
  color: #334155 !important;
}
body.light #overlayNovaOrdem input,
body.light #overlayNovaOrdem textarea,
body.light #overlayNovaOrdem select,
html.light #overlayNovaOrdem input,
html.light #overlayNovaOrdem textarea,
html.light #overlayNovaOrdem select {
  background: #F8FAFC !important;
  border-color: #CBD5E1 !important;
  color: #0F172A !important;
}
body.light #overlayNovaOrdem input:focus,
body.light #overlayNovaOrdem textarea:focus,
body.light #overlayNovaOrdem select:focus,
html.light #overlayNovaOrdem input:focus,
html.light #overlayNovaOrdem textarea:focus,
html.light #overlayNovaOrdem select:focus {
  background: #FFFFFF !important;
  border-color: #3B82F6 !important;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15) !important;
}
body.light #overlayNovaOrdem .close-x,
html.light #overlayNovaOrdem .close-x {
  color: #64748B !important;
}
body.light #overlayNovaOrdem .close-x:hover,
html.light #overlayNovaOrdem .close-x:hover {
  color: #0F172A !important;
}

/* ==================== App principal Centralizado ==================== */

/* ==================== App principal Centralizado ==================== */
.app{
  display:none; min-height:100vh; position:relative; flex-direction:column;
  background: transparent !important;
}
.app.show{display:flex;}
body.light .app{
  background: transparent !important;
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
  background:rgba(12, 22, 18, 0.82) !important;
  border-bottom:1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow:0 10px 30px rgba(0,0,0,0.65) !important;
  backdrop-filter:blur(30px) saturate(190%) !important;
  -webkit-backdrop-filter:blur(30px) saturate(190%) !important;
  padding-top:env(safe-area-inset-top);
}
.topheader-row{
  display:flex; align-items:center; gap:16px; padding:12px 28px; max-width:1440px; margin:0 auto;
}
.header-live-time {
  display:inline-flex; align-items:center; gap:7px; padding:5px 12px;
  border-radius:999px; background:rgba(255,255,255,0.04);
  border:1px solid rgba(255,255,255,0.08); color:#94A3B8;
  font-size:12px; font-weight:600; letter-spacing:0.02em;
  backdrop-filter:blur(12px); user-select:none;
}
.header-live-time .time-dot {
  width:7px; height:7px; border-radius:50%; background:#1DB954;
  box-shadow:0 0 8px #1DB954; animation:pulseDot 2s infinite ease-in-out;
}
body.light .header-live-time {
  background:#F1F5F9 !important; border-color:#CBD5E1 !important; color:#475569 !important;
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
  background:rgba(12, 22, 18, 0.94) !important; border-right:1px solid var(--card-border);
  z-index:995; display:flex; flex-direction:column; padding:20px 16px;
  transform:translateX(-100%); transition:transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow:10px 0 30px rgba(0,0,0,0.5); overflow-y:auto;
  backdrop-filter:blur(25px) !important;
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
  background:rgba(29,185,84,0.14); color:#F8FAFC; border-color:rgba(29,185,84,0.30);
  transform:translateX(4px);
}
.mobile-drawer-nav button.active {
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.25) 0%, rgba(16, 185, 129, 0.14) 100%) !important;
  backdrop-filter: blur(16px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
  color: #FFFFFF !important; font-weight: 700;
  border: 1px solid rgba(52, 211, 153, 0.48) !important;
  box-shadow: 0 6px 24px rgba(29, 185, 84, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.35) !important;
}
.mobile-drawer-nav button .ic {
  width:28px; height:28px; border-radius:9px; background:rgba(255,255,255,0.06);
  border:1px solid rgba(255,255,255,0.08); color:#94A3B8;
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s ease;
}
.mobile-drawer-nav button.active .ic {
  background: rgba(29, 185, 84, 0.28) !important; color: #6EE7B7 !important; border: 1px solid rgba(110, 231, 183, 0.5) !important; box-shadow: 0 0 10px rgba(29, 185, 84, 0.3);
}
.mobile-drawer-nav button .ic svg { width:18px; height:18px; display:block; stroke-width:2.2px; }
.brand{display:flex; align-items:center; gap:12px; flex-shrink:0;}
.brand .logo{
  width:40px; height:40px; border-radius:12px;
  background:linear-gradient(135deg, #34D399 0%, #1DB954 50%, #059669 100%);
  display:flex; align-items:center; justify-content:center;
  font-weight:900; color:#031308; font-size:18px; flex-shrink:0;
  box-shadow:0 4px 18px rgba(29,185,84,0.45), inset 0 1px 1px rgba(255,255,255,0.6);
}
.brand .name{font-weight:800; font-size:15px; line-height:1.2; white-space:nowrap; letter-spacing:-0.01em;}
.brand .name span{display:block; color:#1DB954; font-size:10px; letter-spacing:.08em; font-weight:800; text-transform:uppercase;}

.icon-btn,
.scale-selector-wrap #scaleMenuBtn,
#miniThemeBtn,
#notifBtn {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(255, 255, 255, 0.02) 100%) !important;
  backdrop-filter: blur(16px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 12px !important;
  color: #CBD5E1 !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.25), 0 4px 16px rgba(0, 0, 0, 0.35) !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.icon-btn:hover,
.scale-selector-wrap #scaleMenuBtn:hover,
#miniThemeBtn:hover,
#notifBtn:hover {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.06) 100%) !important;
  border-color: rgba(96, 165, 250, 0.45) !important;
  color: #FFFFFF !important;
  transform: translateY(-1px) !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.4), 0 6px 20px rgba(59, 130, 246, 0.3) !important;
}

.user {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 5px 14px 5px 6px !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.02) 100%) !important;
  backdrop-filter: blur(20px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  border-radius: 16px !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.28), 0 8px 24px rgba(0, 0, 0, 0.45) !important;
  cursor: pointer !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

.user:hover {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.05) 100%) !important;
  border-color: rgba(96, 165, 250, 0.45) !important;
  transform: translateY(-1.5px) !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.45), 0 10px 28px rgba(59, 130, 246, 0.35) !important;
}

.user .avatar {
  width: 34px !important;
  height: 34px !important;
  border-radius: 50% !important;
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-weight: 800 !important;
  font-size: 13px !important;
  color: #FFFFFF !important;
  flex-shrink: 0 !important;
  border: 2px solid rgba(253, 230, 138, 0.6) !important;
  box-shadow: 0 0 16px rgba(245, 158, 11, 0.45), inset 0 1px 2px rgba(255, 255, 255, 0.6) !important;
}

.user .uname {
  font-size: 13px !important;
  font-weight: 800 !important;
  color: #F8FAFC !important;
  white-space: nowrap !important;
  letter-spacing: -0.01em !important;
}

.user .urole {
  display: inline-block !important;
  padding: 2px 8px !important;
  border-radius: 999px !important;
  background: rgba(59, 130, 246, 0.18) !important;
  border: 1px solid rgba(147, 197, 253, 0.35) !important;
  color: #93C5FD !important;
  font-weight: 800 !important;
  font-size: 9.5px !important;
  text-transform: uppercase !important;
  letter-spacing: 0.06em !important;
  backdrop-filter: blur(8px) !important;
}

#logoutBtn,
.topheader-row #logoutBtn {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.16) 0%, rgba(185, 28, 28, 0.08) 100%) !important;
  backdrop-filter: blur(16px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
  border: 1px solid rgba(248, 113, 113, 0.38) !important;
  color: #FCA5A5 !important;
  font-weight: 800 !important;
  font-size: 12.5px !important;
  border-radius: 12px !important;
  padding: 7px 16px !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.25), 0 4px 16px rgba(239, 68, 68, 0.22) !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
}

#logoutBtn:hover,
.topheader-row #logoutBtn:hover {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.35) 0%, rgba(220, 38, 38, 0.22) 100%) !important;
  border-color: rgba(248, 113, 113, 0.65) !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px) !important;
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.45), 0 8px 24px rgba(239, 68, 68, 0.45) !important;
}

nav.menu{
  display:flex; align-items:center; flex-wrap:nowrap; gap:6px; width:100%;
  padding:6px 8px; max-width:1440px; margin:4px auto 14px;
  overflow-x:auto; scrollbar-width:none;
  background:rgba(14, 24, 20, 0.72) !important;
  backdrop-filter:blur(28px) saturate(190%) !important;
  -webkit-backdrop-filter:blur(28px) saturate(190%) !important;
  border:1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius:18px !important;
  box-shadow:0 12px 32px -8px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.18) !important;
}
/* Scrollbars Globais Slim & Elegantes */
*::-webkit-scrollbar{width:5px; height:5px;}
*::-webkit-scrollbar-track{background:transparent;}
*::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12); border-radius:10px;}
*::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.25);}
*{scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.12) transparent;}
nav.menu::-webkit-scrollbar{height:3px;}
nav.menu::-webkit-scrollbar-track{background:transparent;}
nav.menu::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.15); border-radius:10px;}

.menu button{
  position:relative; display:flex; align-items:center; gap:8px; text-align:left;
  background:transparent; border:1px solid transparent;
  color:#94A3B8 !important; padding:8px 15px; border-radius:12px; font-size:13px; font-weight:600; letter-spacing:0.01em; cursor:pointer;
  white-space:nowrap; flex-shrink:0; transition:all 0.2s cubic-bezier(0.16, 1, 0.3, 1); user-select:none;
}
.menu button:hover{
  background:rgba(255,255,255,0.06); color:#F8FAFC !important; border-color:rgba(255,255,255,0.12);
  transform:translateY(-1px);
}
.menu button.active{
  background: linear-gradient(135deg, rgba(29, 185, 84, 0.25) 0%, rgba(16, 185, 129, 0.14) 100%) !important;
  backdrop-filter: blur(16px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(16px) saturate(180%) !important;
  color:#FFFFFF !important; font-weight:700 !important;
  border:1px solid rgba(52, 211, 153, 0.48) !important;
  box-shadow:0 6px 24px rgba(29,185,84,0.25), inset 0 1px 1px rgba(255,255,255,0.45) !important; transform:translateY(-1px);
  text-shadow:0 0 10px rgba(52,211,153,0.4);
}
.menu button.active::after{
  content:''; position:absolute; bottom:-2px; left:18%; right:18%; height:2.5px;
  background:linear-gradient(90deg, transparent, #34D399, #1DB954, transparent); border-radius:999px; box-shadow:0 0 12px #34D399, 0 0 4px #1DB954;
}
.menu button .ic{
  width:26px; height:26px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.06); color:#94A3B8;
  display:inline-flex; align-items:center; justify-content:center; flex-shrink:0; transition:all 0.2s ease;
}
.menu button:hover .ic{background:rgba(255,255,255,0.14); color:#FFFFFF; border-color:rgba(255,255,255,0.2);}
.menu button.active .ic{
  background:rgba(29, 185, 84, 0.28) !important; color:#6EE7B7 !important; border:1px solid rgba(110, 231, 183, 0.5) !important; box-shadow:0 0 10px rgba(29,185,84,0.3), inset 0 1px 0 rgba(255,255,255,0.35);
}
.menu button .ic svg, .icon-btn svg{width:16px; height:16px; display:block; stroke-width:2.2px;}

body.light nav.menu{background:rgba(255, 255, 255, 0.88) !important; border-color:#cbd5e1 !important; box-shadow:0 10px 30px rgba(15,23,42,0.08) !important;}
body.light .menu button{color:#475569 !important; background:transparent; border-color:transparent;}
body.light .menu button .ic{background:rgba(15,23,42,0.04); border-color:rgba(15,23,42,0.08); color:#64748B;}
body.light .menu button:hover{background:rgba(15,23,42,0.06); color:#0F172A !important;}
body.light .menu button:hover .ic{background:rgba(15,23,42,0.1); color:#0F172A;}
body.light .menu button.active{background:linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(5, 150, 105, 0.08) 100%) !important; color:#047857 !important; border-color:rgba(16, 185, 129, 0.35) !important; box-shadow:0 6px 20px rgba(16,185,129,0.15), inset 0 1px 1px rgba(255,255,255,0.8) !important;}
body.light .menu button.active .ic{background:rgba(16, 185, 129, 0.15) !important; color:#047857 !important; border-color:rgba(16, 185, 129, 0.3) !important;}
body.light .menu button.active::after{background:linear-gradient(90deg, transparent, #10B981, transparent) !important; box-shadow:0 0 10px #10B981 !important;}

/* ==================== Correção Completa de Contraste do Modo Claro (Light Mode Contrast Fix) ==================== */
body.light h1, body.light h2, body.light h3, body.light h4, body.light h5, body.light h6,
html.light h1, html.light h2, html.light h3, html.light h4, html.light h5, html.light h6 {
  color: #0F172A !important;
}

body.light p, html.light p {
  color: #334155 !important;
}

body.light label, html.light label,
body.light .form-label, html.light .form-label,
body.light .field label, html.light .field label {
  color: #334155 !important;
  font-weight: 700 !important;
}

body.light .topheader,
html.light .topheader {
  background: #ffffff !important;
  border-bottom: 1px solid #cbd5e1 !important;
  box-shadow: 0 4px 20px rgba(15, 23, 42, 0.08) !important;
}

body.light .topheader .brand .name,
html.light .topheader .brand .name {
  color: #0f172a !important;
}

body.light .topheader .brand .name span,
html.light .topheader .brand .name span {
  color: #2563eb !important;
}

body.light .topheader .icon-btn,
html.light .topheader .icon-btn {
  background: #f1f5f9 !important;
  border: 1px solid #cbd5e1 !important;
  color: #0f172a !important;
}

body.light .topheader .icon-btn:hover,
html.light .topheader .icon-btn:hover {
  background: #e2e8f0 !important;
  color: #2563eb !important;
}

body.light .topheader .user,
html.light .topheader .user {
  background: #f8fafc !important;
  border: 1px solid #cbd5e1 !important;
}

body.light .topheader .uname,
html.light .topheader .uname {
  color: #0f172a !important;
  font-weight: 700 !important;
}

body.light .topheader .urole,
html.light .topheader .urole {
  color: #64748b !important;
}

body.light .topheader #logoutBtn,
html.light .topheader #logoutBtn {
  color: #dc2626 !important;
  border: 1px solid #fca5a5 !important;
  background: #fef2f2 !important;
}

body.light .topheader #logoutBtn:hover,
html.light .topheader #logoutBtn:hover {
  background: #fee2e2 !important;
  color: #b91c1c !important;
}

body.light .page-head h1,
html.light .page-head h1 {
  color: #0f172a !important;
}

body.light .page-head p,
html.light .page-head p {
  color: #475569 !important;
}

body.light code,
html.light code {
  background: #e2e8f0 !important;
  color: #0f172a !important;
  border: 1px solid #cbd5e1 !important;
}

/* Modais e Formulários em Modo Claro */
body.light .modal,
html.light .modal {
  background: #FFFFFF !important;
  border: 1.5px solid #CBD5E1 !important;
  box-shadow: 0 25px 65px rgba(15, 23, 42, 0.16) !important;
  color: #0F172A !important;
}

body.light .modal h2, body.light .modal h3,
html.light .modal h2, html.light .modal h3 {
  color: #0F172A !important;
}

body.light .modal .field label,
html.light .modal .field label {
  color: #334155 !important;
}

body.light .modal-actions,
html.light .modal-actions {
  background: #FFFFFF !important;
  border-top: 1px solid #E2E8F0 !important;
}

body.light .modal-actions button:not(.save),
html.light .modal-actions button:not(.save) {
  background: #F8FAFC !important;
  border: 1px solid #CBD5E1 !important;
  color: #334155 !important;
}

body.light .modal-actions button:not(.save):hover,
html.light .modal-actions button:not(.save):hover {
  background: #E2E8F0 !important;
  color: #0F172A !important;
}

body.light .toggle-type button,
html.light .toggle-type button {
  background: #F8FAFC !important;
  border: 1px solid #CBD5E1 !important;
  color: #475569 !important;
}

body.light .toggle-type button:hover,
html.light .toggle-type button:hover {
  background: #E2E8F0 !important;
  color: #0F172A !important;
}

body.light .toggle-type button.sel-in,
html.light .toggle-type button.sel-in {
  background: rgba(16, 185, 129, 0.14) !important;
  color: #059669 !important;
  border-color: #10B981 !important;
}

body.light .toggle-type button.sel-out,
html.light .toggle-type button.sel-out {
  background: rgba(244, 63, 94, 0.14) !important;
  color: #DC2626 !important;
  border-color: #F43F5E !important;
}

body.light .close-x, body.light .modal-close,
html.light .close-x, html.light .modal-close {
  color: #64748B !important;
}

body.light .close-x:hover, body.light .modal-close:hover,
html.light .close-x:hover, html.light .modal-close:hover {
  color: #0F172A !important;
}

/* Inputs, Selects e Textareas Universais em Modo Claro */
body.light input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not(.btn-hero-primary),
body.light select,
body.light textarea,
html.light input:not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not(.btn-hero-primary),
html.light select,
html.light textarea {
  background: #FFFFFF !important;
  border: 1.5px solid #CBD5E1 !important;
  color: #0F172A !important;
}

body.light input:focus,
body.light select:focus,
body.light textarea:focus,
html.light input:focus,
html.light select:focus,
html.light textarea:focus {
  background: #FFFFFF !important;
  border-color: #2563EB !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15) !important;
  color: #0F172A !important;
}

body.light input::placeholder,
body.light textarea::placeholder,
html.light input::placeholder,
html.light textarea::placeholder {
  color: #94A3B8 !important;
  opacity: 1 !important;
}

body.light select option,
html.light select option {
  background: #FFFFFF !important;
  color: #0F172A !important;
}

/* Tabelas e Registros em Modo Claro */
body.light .table-panel,
html.light .table-panel {
  background: #FFFFFF !important;
  border: 1px solid #CBD5E1 !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

body.light th,
html.light th {
  color: #334155 !important;
  font-weight: 800 !important;
}

body.light td,
html.light td {
  color: #0F172A !important;
  border-top-color: #E2E8F0 !important;
}

body.light tr.trow:hover td,
html.light tr.trow:hover td {
  background: #F1F5F9 !important;
}

body.light .tx-date-badge,
body.light .tx-desc,
html.light .tx-date-badge,
html.light .tx-desc {
  color: #0F172A !important;
}

body.light .tfoot-row,
html.light .tfoot-row {
  background: #F8FAFC !important;
  border-top: 2px solid #CBD5E1 !important;
}

body.light .tfoot-label,
html.light .tfoot-label {
  color: #334155 !important;
}

body.light .acc-pill,
html.light .acc-pill {
  background: #F1F5F9 !important;
  color: #334155 !important;
  border-color: #CBD5E1 !important;
}

body.light .acc-val,
html.light .acc-val {
  color: #D97706 !important;
}

/* Cards & Painéis em Modo Claro */
body.light .panel,
html.light .panel {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

body.light .panel-head h3,
html.light .panel-head h3 {
  color: #0F172A !important;
}

body.light .cfg-hint,
html.light .cfg-hint {
  color: #64748B !important;
}

body.light .kpi,
html.light .kpi {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

body.light .kpi .val,
html.light .kpi .val {
  color: #0F172A !important;
  text-shadow: none !important;
}

body.light .kpi .lbl,
html.light .kpi .lbl {
  color: #475569 !important;
}

body.light .kpi .sub,
html.light .kpi .sub {
  color: #64748B !important;
}

body.light .acc-card, body.light .cat-card, body.light .goal-card, body.light .budget-card, body.light .recurring-card, body.light .rec-card,
html.light .acc-card, html.light .cat-card, html.light .goal-card, html.light .budget-card, html.light .recurring-card, html.light .rec-card {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

body.light .acc-card .top strong, body.light .cat-card h4, body.light .goal-card h3, body.light .budget-card h4,
html.light .acc-card .top strong, html.light .cat-card h4, html.light .goal-card h3, html.light .budget-card h4 {
  color: #0F172A !important;
}

body.light .tx-summary-card,
html.light .tx-summary-card {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

body.light .tx-summary-label,
html.light .tx-summary-label {
  color: #475569 !important;
  font-weight: 800 !important;
}

body.light .tx-summary-sub,
html.light .tx-summary-sub {
  color: #64748B !important;
}

/* Painéis de Administração, Usuários, Funções e Ordens em Modo Claro */
body.light #usuariosPage h1, body.light #usuariosPage h3, body.light #usuariosPage .val, body.light #usuariosPage strong,
html.light #usuariosPage h1, html.light #usuariosPage h3, html.light #usuariosPage .val, html.light #usuariosPage strong,
body.light #funcoesPage h1, body.light #funcoesPage h3, body.light #funcoesPage strong, body.light #funcoesPage td,
html.light #funcoesPage h1, html.light #funcoesPage h3, html.light #funcoesPage strong, html.light #funcoesPage td,
body.light #ordensPage h1, body.light #ordensPage h3, body.light #ordensPage .val, body.light #ordensPage strong, body.light #ordensPage h4,
html.light #ordensPage h1, html.light #ordensPage h3, html.light #ordensPage .val, html.light #ordensPage strong, html.light #ordensPage h4,
body.light #logsPage h1, body.light #logsPage h3, body.light #logsPage strong,
html.light #logsPage h1, html.light #logsPage h3, html.light #logsPage strong {
  color: #0F172A !important;
}

body.light .admin-toolbar-panel,
html.light .admin-toolbar-panel {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.06) !important;
}

body.light .admin-filter-btn,
html.light .admin-filter-btn {
  background: #F1F5F9 !important;
  border-color: #CBD5E1 !important;
  color: #475569 !important;
}

body.light .admin-filter-btn:hover,
html.light .admin-filter-btn:hover {
  background: #E2E8F0 !important;
  color: #0F172A !important;
}

body.light .admin-filter-btn.active,
html.light .admin-filter-btn.active {
  background: #2563EB !important;
  color: #FFFFFF !important;
  border-color: #1D4ED8 !important;
}

body.light .funcoes-filter-btn,
html.light .funcoes-filter-btn {
  background: #F1F5F9 !important;
  border-color: #CBD5E1 !important;
  color: #475569 !important;
}

body.light .funcoes-filter-btn.active,
html.light .funcoes-filter-btn.active {
  background: #2563EB !important;
  color: #FFFFFF !important;
  border-color: #1D4ED8 !important;
}

/* Gaveta Mobile e Notificações em Modo Claro */
body.light .mobile-drawer,
html.light .mobile-drawer {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  color: #0F172A !important;
}

body.light .mobile-drawer-nav button,
html.light .mobile-drawer-nav button {
  background: #F8FAFC !important;
  border-color: #E2E8F0 !important;
  color: #334155 !important;
}

body.light .mobile-drawer-nav button:hover,
html.light .mobile-drawer-nav button:hover {
  background: #E2E8F0 !important;
  color: #0F172A !important;
}

body.light .mobile-drawer-nav button.active,
html.light .mobile-drawer-nav button.active {
  background: #EFF6FF !important;
  color: #1D4ED8 !important;
  border-color: #93C5FD !important;
}

body.light .mobile-drawer-nav button .ic,
html.light .mobile-drawer-nav button .ic {
  background: #E2E8F0 !important;
  border-color: #CBD5E1 !important;
  color: #334155 !important;
}

body.light .notif-panel,
html.light .notif-panel {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12) !important;
  color: #0F172A !important;
}

body.light .notif-item,
html.light .notif-item {
  background: #F8FAFC !important;
  border-color: #E2E8F0 !important;
  color: #0F172A !important;
}

body.light .notif-title,
html.light .notif-title {
  color: #0F172A !important;
}

body.light .notif-desc,
html.light .notif-desc {
  color: #475569 !important;
}

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
/* ==================== Assinatura Executiva Ultra 4K Glass Estável (Paulo Lima) ==================== */
.dev-signature {
  position: relative !important;
  overflow: hidden !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 10px !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 28, 52, 0.85) 45%, rgba(10, 16, 32, 0.95) 100%) !important;
  border: 1.5px solid rgba(255, 255, 255, 0.20) !important;
  border-top: 1.5px solid rgba(255, 255, 255, 0.50) !important;
  border-radius: 999px !important;
  padding: 7px 22px 7px 8px !important;
  backdrop-filter: blur(25px) saturate(210%) !important;
  -webkit-backdrop-filter: blur(25px) saturate(210%) !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.50), inset 0 1.5px 2px rgba(255, 255, 255, 0.25) !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  text-decoration: none !important;
  cursor: pointer !important;
  user-select: none !important;
  animation: none !important;
}

.dev-signature::before {
  content: '' !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 100% !important;
  height: 100% !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), transparent) !important;
  pointer-events: none !important;
  z-index: 1 !important;
}

.dev-signature:hover {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(30, 48, 80, 0.90) 45%, rgba(15, 25, 48, 0.98) 100%) !important;
  border-color: rgba(255, 255, 255, 0.40) !important;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.65), 0 0 20px rgba(239, 68, 68, 0.3), inset 0 1.5px 2px rgba(255, 255, 255, 0.35) !important;
  transform: translateY(-2px) !important;
}

/* Ícone 3D Rubi / Vidro Estável */
.dev-signature-icon {
  width: 30px !important;
  height: 30px !important;
  border-radius: 50% !important;
  flex-shrink: 0 !important;
  background: radial-gradient(circle at 35% 28%, #FFA4A4 0%, #EF4444 42%, #DC2626 70%, #7F1D1D 100%) !important;
  color: #FFFFFF !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border: 1.5px solid rgba(255, 255, 255, 0.70) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45), inset 0 1.5px 2px rgba(255, 255, 255, 0.65) !important;
  position: relative !important;
  z-index: 2 !important;
  transition: transform 0.25s ease !important;
  animation: none !important;
}

.dev-signature:hover .dev-signature-icon {
  transform: scale(1.08) !important;
}

.dev-signature-icon svg {
  width: 14px !important;
  height: 14px !important;
  stroke-width: 2.8px !important;
  display: block !important;
  stroke: #FFFFFF !important;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6)) !important;
}

.dev-signature-text {
  display: flex !important;
  align-items: baseline !important;
  gap: 7px !important;
  position: relative !important;
  z-index: 2 !important;
}

.dev-signature-label {
  font-size: 11px !important;
  font-weight: 800 !important;
  color: #94A3B8 !important;
  letter-spacing: 0.08em !important;
  text-transform: uppercase !important;
}

/* Nome Executivo Estável sem piscar */
.dev-signature-name {
  font-size: 14px !important;
  font-weight: 900 !important;
  color: #FFFFFF !important;
  letter-spacing: 0.04em !important;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6) !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
  animation: none !important;
}

.dev-sparkle {
  display: inline-block !important;
  font-size: 12px !important;
  color: #F87171 !important;
  animation: none !important;
}

/* Suporte Refinado para Tema Claro */
body.light .dev-signature {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.08) !important;
}
body.light .dev-signature:hover {
  background: #F8FAFC !important;
  border-color: #94A3B8 !important;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12) !important;
}
body.light .dev-signature-label {
  color: #64748B !important;
}
body.light .dev-signature-name {
  color: #0F172A !important;
  text-shadow: none !important;
}
body.light .dev-signature-label {
  color: #475569 !important;
  text-shadow: none !important;
}
body.light .dev-signature-name {
  background: linear-gradient(90deg, #991B1B 0%, #DC2626 25%, #EF4444 50%, #DC2626 75%, #991B1B 100%) !important;
  background-size: 200% auto !important;
  animation: devTextShine 3.2s linear infinite !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  filter: drop-shadow(0 1px 4px rgba(239, 68, 68, 0.35)) !important;
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
.right{display:flex; align-items:center; gap:10px; flex-shrink:0;}
.icon-btn{
  width:38px; height:38px; border-radius:12px;
  background:rgba(255, 255, 255, 0.05) !important;
  backdrop-filter:blur(16px) saturate(180%) !important;
  -webkit-backdrop-filter:blur(16px) saturate(180%) !important;
  border:1px solid rgba(255, 255, 255, 0.12) !important;
  box-shadow:0 4px 16px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.22) !important;
  color:#E2E8F0 !important; display:flex; align-items:center; justify-content:center;
  cursor:pointer; position:relative; font-size:16px; flex-shrink:0;
  transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.icon-btn:hover{
  background:rgba(255, 255, 255, 0.12) !important;
  border-color:rgba(255, 255, 255, 0.28) !important;
  transform:translateY(-1.5px) !important;
  box-shadow:0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.4) !important;
  color:#FFFFFF !important;
}
.icon-btn .dot{position:absolute; top:7px; right:7px; width:7px; height:7px; border-radius:50%; background:#10B981; box-shadow:0 0 8px #10B981;}
.user{
  display:inline-flex !important; align-items:center !important; gap:10px !important;
  padding:4px 14px 4px 6px !important; border-radius:999px !important;
  background:linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%) !important;
  backdrop-filter:blur(20px) saturate(190%) !important;
  -webkit-backdrop-filter:blur(20px) saturate(190%) !important;
  border:1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow:0 8px 24px -4px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.3) !important;
  cursor:pointer !important; min-width:unset; min-height:unset;
  transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.user:hover{
  background:linear-gradient(135deg, rgba(255, 255, 255, 0.14) 0%, rgba(255, 255, 255, 0.06) 100%) !important;
  border-color:rgba(255, 255, 255, 0.3) !important;
  transform:translateY(-1.5px) !important;
  box-shadow:0 12px 32px -4px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.45) !important;
}
.avatar{
  width:32px !important; height:32px !important; min-width:32px !important; min-height:32px !important;
  border-radius:50% !important;
  background:linear-gradient(135deg, #F59E0B 0%, #D97706 50%, #B45309 100%) !important;
  display:flex !important; align-items:center !important; justify-content:center !important;
  font-weight:800 !important; font-size:12px !important; color:#FFFFFF !important;
  border:1.5px solid rgba(255, 255, 255, 0.5) !important;
  box-shadow:0 0 14px rgba(245, 158, 11, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.6) !important;
  flex-shrink:0 !important;
}
.user .uname{font-size:13px !important; font-weight:700 !important; color:#F8FAFC !important; white-space:nowrap !important; letter-spacing:-0.01em !important;}
.user .urole{
  display:inline-block !important; padding:2px 8px !important; border-radius:999px !important;
  background:rgba(59, 130, 246, 0.16) !important; border:1px solid rgba(96, 165, 250, 0.35) !important;
  color:#93C5FD !important; font-weight:700 !important; font-size:9.5px !important;
  letter-spacing:0.06em !important; text-transform:uppercase !important;
  backdrop-filter:blur(8px) !important; min-height:unset;
}
.topheader-row .btn-ghost,
.topheader-row #logoutBtn{
  height:36px !important; border-radius:12px !important; padding:0 16px !important;
  background:linear-gradient(135deg, rgba(239, 68, 68, 0.14) 0%, rgba(185, 28, 28, 0.06) 100%) !important;
  backdrop-filter:blur(16px) saturate(180%) !important;
  -webkit-backdrop-filter:blur(16px) saturate(180%) !important;
  border:1px solid rgba(248, 113, 113, 0.35) !important;
  color:#FCA5A5 !important; font-weight:700 !important; font-size:12.5px !important;
  box-shadow:inset 0 1px 0 rgba(255, 255, 255, 0.2), 0 4px 14px rgba(239, 68, 68, 0.15) !important;
  display:inline-flex !important; align-items:center !important; justify-content:center !important;
  cursor:pointer !important; flex-shrink:0 !important;
  transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.topheader-row .btn-ghost:hover,
.topheader-row #logoutBtn:hover{
  background:linear-gradient(135deg, rgba(239, 68, 68, 0.3) 0%, rgba(220, 38, 38, 0.2) 100%) !important;
  border-color:rgba(248, 113, 113, 0.6) !important; color:#FFFFFF !important;
  transform:translateY(-1.5px) !important;
  box-shadow:inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 8px 24px rgba(239, 68, 68, 0.4) !important;
}

/* ==================== Estilo Universal para Botões de Ação (Editar, Excluir, Ações) ==================== */
.row-actions {
  display: inline-flex !important;
  align-items: center !important;
  gap: 6px !important;
}

.btn-action-edit,
.btn-action-del,
.row-edit,
[data-edit], [data-del],
[data-editacc], [data-delacc],
[data-editcat], [data-delcat],
[data-editorc], [data-delorc],
[data-editmeta], [data-delmeta],
[data-editrec], [data-delrec],
[data-editalert], [data-delalert],
[data-mgedit], [data-mgdel] {
  width: 32px !important;
  height: 32px !important;
  border-radius: 9999px !important;
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
[data-edit], [data-editacc], [data-editcat], [data-editorc], [data-editmeta], [data-editrec], [data-editalert], [data-mgedit] {
  background: rgba(59, 130, 246, 0.18) !important;
  color: #60A5FA !important;
  border: 1px solid rgba(59, 130, 246, 0.35) !important;
}
.btn-action-edit:hover,
.row-edit:hover,
[data-edit]:hover, [data-editacc]:hover, [data-editcat]:hover, [data-editorc]:hover, [data-editmeta]:hover, [data-editrec]:hover, [data-editalert]:hover, [data-mgedit]:hover {
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

/* Botão de Lançar / Concluído (Pílula com Texto Nítido) */
[data-lancar] {
  width: auto !important;
  min-width: 32px !important;
  height: 32px !important;
  padding: 0 12px !important;
  border-radius: 9999px !important;
  font-size: 11.5px !important;
  font-weight: 700 !important;
  white-space: nowrap !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 5px !important;
  background: rgba(16, 185, 129, 0.18) !important;
  color: #34D399 !important;
  border: 1px solid rgba(16, 185, 129, 0.38) !important;
  box-shadow: 0 2px 6px rgba(0,0,0,0.25) !important;
  outline: none !important;
  cursor: pointer !important;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
  flex-shrink: 0 !important;
}
[data-lancar]:hover {
  background: rgba(16, 185, 129, 0.35) !important;
  color: #FFFFFF !important;
  border-color: rgba(52, 211, 153, 0.75) !important;
  transform: translateY(-1px) scale(1.03) !important;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.40) !important;
}

/* Botões da Lista de Usuários (User Card Actions) */
.user-card-right {
  display: flex !important;
  align-items: center !important;
  justify-content: flex-end !important;
  gap: 10px !important;
  flex-shrink: 0 !important;
}
.user-card-btn {
  height: 38px !important;
  padding: 0 16px !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  border-radius: 10px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
  cursor: pointer !important;
  transition: all 0.2s ease-in-out !important;
  white-space: nowrap !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25) !important;
  width: auto !important;
  outline: none !important;
}
.user-card-btn.btn-espelho {
  background: rgba(59, 130, 246, 0.15) !important;
  border: 1px solid rgba(59, 130, 246, 0.4) !important;
  color: #60A5FA !important;
}
.user-card-btn.btn-espelho:hover {
  background: rgba(59, 130, 246, 0.3) !important;
  border-color: #60A5FA !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px) !important;
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.35) !important;
}
.user-card-btn.btn-desativar {
  background: rgba(239, 68, 68, 0.15) !important;
  border: 1px solid rgba(239, 68, 68, 0.4) !important;
  color: #F87171 !important;
}
.user-card-btn.btn-desativar:hover {
  background: rgba(239, 68, 68, 0.3) !important;
  border-color: #F87171 !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px) !important;
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35) !important;
}
.user-card-btn.btn-ativar {
  background: rgba(16, 185, 129, 0.15) !important;
  border: 1px solid rgba(16, 185, 129, 0.4) !important;
  color: #34D399 !important;
}
.user-card-btn.btn-ativar:hover {
  background: rgba(16, 185, 129, 0.3) !important;
  border-color: #34D399 !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px) !important;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35) !important;
}
.user-card-btn.btn-editar {
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: #F8FAFC !important;
}
.user-card-btn.btn-editar:hover {
  background: rgba(255, 255, 255, 0.18) !important;
  border-color: rgba(255, 255, 255, 0.4) !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px) !important;
  box-shadow: 0 4px 14px rgba(255, 255, 255, 0.15) !important;
}
.user-card-btn.btn-excluir {
  background: rgba(239, 68, 68, 0.14) !important;
  border: 1px solid rgba(239, 68, 68, 0.4) !important;
  color: #F87171 !important;
}
.user-card-btn.btn-excluir:hover {
  background: rgba(239, 68, 68, 0.3) !important;
  border-color: #EF4444 !important;
  color: #FFFFFF !important;
  transform: translateY(-1.5px) !important;
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35) !important;
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
body.light [data-mgedit], body.light [data-mgdel] {
  box-shadow: 0 2px 4px rgba(15,23,42,0.08) !important;
}
body.light .btn-action-edit, body.light .row-edit, body.light [data-edit], body.light [data-editacc], body.light [data-editcat], body.light [data-editorc], body.light [data-editmeta], body.light [data-editrec], body.light [data-editalert], body.light [data-mgedit] {
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

/* ==================== Modal Dialog 4K Executivo Centralizado ==================== */
.executive-4k-modal-overlay {
  position: fixed !important;
  inset: 0 !important;
  z-index: 999999 !important;
  background: rgba(4, 7, 15, 0.75) !important;
  backdrop-filter: blur(28px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
  display: none;
  align-items: center !important;
  justify-content: center !important;
  padding: 20px !important;
  animation: fadeInModal 0.25s ease forwards;
}

.executive-4k-card {
  position: relative !important;
  overflow: hidden !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(15, 23, 42, 0.78) 45%, rgba(6, 11, 22, 0.88) 100%) !important;
  backdrop-filter: blur(36px) saturate(200%) !important;
  -webkit-backdrop-filter: blur(36px) saturate(200%) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  box-shadow: 0 35px 90px -10px rgba(0, 0, 0, 0.88), 0 0 50px rgba(16, 185, 129, 0.16), inset 0 1px 1px rgba(255, 255, 255, 0.35), inset 0 -1px 0 rgba(0, 0, 0, 0.5) !important;
  border-radius: 28px !important;
  padding: 40px 34px 34px !important;
  width: 100% !important;
  max-width: 440px !important;
  text-align: center !important;
  transform: scale(0.92);
  animation: popIn4k 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}

.executive-4k-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 20%;
  right: 20%;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(52, 211, 153, 0.8), transparent);
  filter: blur(0.5px);
  pointer-events: none;
}

@keyframes popIn4k {
  to { transform: scale(1); }
}

@keyframes fadeInModal {
  from { opacity: 0; }
  to { opacity: 1; }
}

.executive-4k-badge {
  width: 76px !important;
  height: 76px !important;
  border-radius: 50% !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  font-size: 34px !important;
  margin: 0 auto 22px !important;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(5, 150, 105, 0.12) 60%, rgba(0, 0, 0, 0.4) 100%) !important;
  border: 1.5px solid rgba(52, 211, 153, 0.45) !important;
  box-shadow: 0 0 30px rgba(16, 185, 129, 0.4), inset 0 1px 2px rgba(255, 255, 255, 0.6) !important;
  backdrop-filter: blur(16px) !important;
  -webkit-backdrop-filter: blur(16px) !important;
}

.executive-4k-title {
  font-size: 23px !important;
  font-weight: 900 !important;
  color: #FFFFFF !important;
  margin-bottom: 10px !important;
  letter-spacing: -0.02em !important;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.5) !important;
}

.executive-4k-message {
  font-size: 14.5px !important;
  color: #CBD5E1 !important;
  line-height: 1.6 !important;
  margin-bottom: 28px !important;
  font-weight: 500 !important;
}

.executive-4k-btn {
  width: 100% !important;
  padding: 15px 24px !important;
  border-radius: 16px !important;
  font-size: 15px !important;
  font-weight: 800 !important;
  color: #FFFFFF !important;
  border: 1px solid rgba(255, 255, 255, 0.25) !important;
  background: linear-gradient(135deg, #10B981 0%, #059669 60%, #047857 100%) !important;
  box-shadow: 0 12px 28px -4px rgba(16, 185, 129, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.45) !important;
  cursor: pointer !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  letter-spacing: 0.03em !important;
}

.executive-4k-btn:hover {
  transform: translateY(-2px) scale(1.01) !important;
  filter: brightness(1.06) !important;
  box-shadow: 0 16px 36px -2px rgba(16, 185, 129, 0.65), inset 0 1px 1px rgba(255, 255, 255, 0.6) !important;
}

body.light .executive-4k-card {
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.95) 100%) !important;
  border: 1px solid #CBD5E1 !important;
  box-shadow: 0 25px 70px rgba(15, 23, 42, 0.25) !important;
}

body.light .executive-4k-title {
  color: #0F172A !important;
}

body.light .executive-4k-message {
  color: #475569 !important;
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
.period-wrap{position:relative; z-index:100;}
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
  border-radius:14px; padding:16px; z-index:99999 !important; width:236px; box-shadow:0 16px 40px rgba(0,0,0,0.75); transform-origin:top right;
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
  background:linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(18, 30, 24, 0.75) 45%, rgba(10, 18, 14, 0.88) 100%) !important;
  border:1px solid rgba(255,255,255,0.13) !important; border-radius:20px !important; padding:20px 18px;
  box-shadow:0 16px 36px -8px rgba(0,0,0,0.75), 0 0 25px -5px rgba(29, 185, 84, 0.10), inset 0 1px 0 rgba(255,255,255,0.18) !important;
  backdrop-filter:blur(24px) saturate(190%) !important; -webkit-backdrop-filter:blur(24px) saturate(190%) !important;
  transition:all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}
.kpi::before{
  content:''; position:absolute; top:0; left:0; right:0; height:3px;
  background:linear-gradient(90deg, #1DB954, #34D399, #10B981);
  opacity:0.9; transition:opacity 0.3s ease;
}
.kpi:hover{
  transform:translateY(-3px);
  border-color:rgba(52, 211, 153, 0.5) !important;
  box-shadow:0 20px 42px -5px rgba(0,0,0,0.9), 0 0 25px rgba(29, 185, 84, 0.22), inset 0 1px 0 rgba(255,255,255,0.25) !important;
}
.kpi .row1{display:flex; align-items:center; justify-content:space-between; color:var(--text-dim); font-size:12.5px; font-weight:600; margin-bottom:12px; letter-spacing:0.01em;}
.kpi .ic{
  width:40px; height:40px; border-radius:11px; display:flex; align-items:center; justify-content:center; font-size:18px; flex-shrink:0;
  background:linear-gradient(135deg, rgba(29,185,84,0.18), rgba(16,185,129,0.08));
  border:1px solid rgba(52,211,153,0.25);
  box-shadow:0 4px 14px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15);
  transition:transform 0.25s ease, box-shadow 0.25s ease;
}
.kpi:hover .ic{
  transform:scale(1.06);
  box-shadow:0 6px 18px rgba(29,185,84,0.35);
}
.kpi .val{font-size:24px; font-weight:800; margin-bottom:6px; color:#FFFFFF; letter-spacing:-0.02em; font-variant-numeric:tabular-nums;}
.kpi .sub{font-size:11.5px; color:var(--text-faint); font-weight:500;}
.kpi .sub.up{color:#1DB954; font-weight:700;}

.kpi.kpi-balance::before { background: linear-gradient(90deg, #1DB954, #34D399); }
.kpi.kpi-income::before { background: linear-gradient(90deg, #10B981, #6EE7B7); }
.kpi.kpi-expense::before { background: linear-gradient(90deg, #EF4444, #F87171); }
.kpi.kpi-net::before { background: linear-gradient(90deg, #1DB954, #10B981); }
.kpi.kpi-tx::before { background: linear-gradient(90deg, #8B5CF6, #C084FC); }

body.light .kpi {
  background:#ffffff !important;
  border-color:#cbd5e1 !important;
  box-shadow:0 8px 24px rgba(15,23,42,0.06) !important;
}
body.light .kpi.kpi-balance::before { background: linear-gradient(90deg, #059669, #10B981); }
body.light .kpi.kpi-income::before { background: linear-gradient(90deg, #059669, #10B981); }
body.light .kpi.kpi-expense::before { background: linear-gradient(90deg, #DC2626, #EF4444); }
body.light .kpi.kpi-net::before { background: linear-gradient(90deg, #059669, #10B981); }
body.light .kpi.kpi-tx::before { background: linear-gradient(90deg, #7C3AED, #8B5CF6); }
body.light .kpi:hover {
  border-color:#10B981 !important;
  box-shadow:0 14px 32px rgba(15,23,42,0.12) !important;
}
body.light .kpi .val { color:#0f172a !important; text-shadow:none; }

.grid3{display:grid; grid-template-columns:repeat(3, 1fr); gap:16px; margin-bottom:20px; align-items:stretch;}
.panel{
  position:relative; overflow:hidden;
  background:linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0%, rgba(18, 30, 24, 0.75) 45%, rgba(10, 18, 14, 0.88) 100%) !important;
  border:1px solid rgba(255, 255, 255, 0.14) !important; border-radius:24px !important; padding:22px 26px;
  box-shadow:0 20px 50px -10px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255, 255, 255, 0.22) !important;
  backdrop-filter:blur(28px) saturate(190%) !important;
  -webkit-backdrop-filter:blur(28px) saturate(190%) !important;
  transition:all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  display:flex; flex-direction:column; justify-content:space-between; height:100%; box-sizing:border-box;
}
.panel:hover{
  border-color:rgba(52, 211, 153, 0.40) !important;
  box-shadow:0 24px 60px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
}
.panel-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; gap:10px; flex-wrap:wrap;}
.panel-head h3{font-size:15px; font-weight:800; color:#ffffff; letter-spacing:-0.01em; display:flex; align-items:center; gap:8px;}
.panel-head .tag{font-size:12px; font-weight:600; color:var(--text-dim); background:rgba(255,255,255,0.06); padding:6px 12px; border-radius:10px; cursor:pointer; border:1px solid rgba(255,255,255,0.10); transition:all 0.2s ease;}
.panel-head .tag:hover{background:rgba(29,185,84,0.18); color:#ffffff; border-color:rgba(52,211,153,0.4);}

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

.cat-cards .placeholder,
.placeholder {
  grid-column: 1 / -1 !important;
  width: 100% !important;
  max-width: 860px !important;
  margin: 20px auto !important;
  padding: 48px 24px !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(15, 23, 42, 0.68) 50%, rgba(10, 15, 29, 0.78) 100%) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 24px !important;
  box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.22) !important;
  backdrop-filter: blur(24px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
  justify-content: center !important;
  text-align: center !important;
}

.placeholder .big {
  font-size: 36px !important;
  width: 72px !important;
  height: 72px !important;
  border-radius: 50% !important;
  background: rgba(59, 130, 246, 0.15) !important;
  border: 1.5px solid rgba(59, 130, 246, 0.35) !important;
  color: #60A5FA !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  margin: 0 auto 16px !important;
  box-shadow: 0 0 24px rgba(59, 130, 246, 0.25) !important;
}

.placeholder h3 {
  color: var(--text) !important;
  font-size: 21px !important;
  font-weight: 800 !important;
  margin-bottom: 8px !important;
  letter-spacing: -0.01em !important;
}

.placeholder p {
  color: var(--text-dim) !important;
  font-size: 14px !important;
  max-width: 520px !important;
  margin: 0 auto !important;
  line-height: 1.6 !important;
}

/* ==================== Estilo Executivo da Tela de Importação OFX / CSV ==================== */
#importFile {
  width: 100% !important;
  padding: 24px 20px !important;
  border-radius: 16px !important;
  background: linear-gradient(145deg, rgba(15,23,42,0.85) 0%, rgba(10,15,29,0.95) 100%) !important;
  border: 2px dashed rgba(59,130,246,0.45) !important;
  color: var(--text) !important;
  cursor: pointer !important;
  transition: all 0.25s ease !important;
  font-size: 14px !important;
  box-shadow: 0 8px 25px rgba(0,0,0,0.3) !important;
}

#importFile:hover {
  border-color: #3B82F6 !important;
  background: rgba(59,130,246,0.12) !important;
  box-shadow: 0 0 25px rgba(59,130,246,0.3) !important;
  transform: translateY(-1px) !important;
}

#impConta, #impCategoria {
  font-size: 14px !important;
  padding: 12px 14px !important;
  border-radius: 12px !important;
  background: var(--bg) !important;
  border: 1px solid var(--card-border) !important;
  color: var(--text) !important;
  width: 100% !important;
  cursor: pointer !important;
  transition: border-color 0.2s ease !important;
}

#impConta:focus, #impCategoria:focus {
  border-color: #3B82F6 !important;
  box-shadow: 0 0 14px rgba(59,130,246,0.3) !important;
}

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
.cat-card-add .plus{font-size:24px; line-height:1; font-weight:400;}

/* Enhanced Budget, Goal, & Bank Card Styles */
.budget-card, .goal-card, .recurring-card {
  position:relative; overflow:hidden;
  background:linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(15, 23, 42, 0.65) 50%, rgba(10, 15, 29, 0.78) 100%) !important;
  border:1px solid rgba(255,255,255,0.12) !important; border-radius:20px !important; padding:22px;
  box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22) !important;
  backdrop-filter:blur(24px) saturate(190%) !important; -webkit-backdrop-filter:blur(24px) saturate(190%) !important;
  transition:all 0.28s cubic-bezier(0.16, 1, 0.3, 1);
  display:flex; flex-direction:column; justify-content:space-between;
}
.budget-card:hover, .goal-card:hover, .recurring-card:hover {
  transform:translateY(-3px);
  border-color:rgba(96,165,250,0.45) !important;
  box-shadow:0 22px 50px -6px rgba(0,0,0,0.85), 0 0 25px rgba(59,130,246,0.25), inset 0 1px 0 rgba(255,255,255,0.35) !important;
}
body.light .budget-card, body.light .goal-card, body.light .recurring-card, body.light .cat-card {
  background:#ffffff !important; border-color:#cbd5e1 !important;
  box-shadow:0 6px 20px rgba(15,23,42,0.06) !important;
}
body.light .cat-card h4, body.light .budget-card h4, body.light .goal-card h3 {
  color:#0f172a !important;
}

/* Recorrentes & Duração Styles */
.rec-progress-bar {
  width: 100%;
  height: 6px;
  background: rgba(255,255,255,0.08);
  border-radius: 999px;
  overflow: hidden;
  position: relative;
}
body.light .rec-progress-bar {
  background: rgba(0,0,0,0.08);
}
.rec-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}
.rec-chip-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.2s ease;
}
.rec-chip-btn:hover {
  background: rgba(59,130,246,0.15);
  border-color: var(--blue);
  color: #fff;
}
.rec-chip-btn.active {
  background: var(--blue);
  border-color: var(--blue);
  color: #fff;
}

/* ==================== Dashboard Welcome Hero Banner (4K Executive) ==================== */
.dashboard-welcome-hero {
  position: relative;
  overflow: visible !important;
  z-index: 50;
  background: linear-gradient(135deg, rgba(17, 24, 39, 0.94) 0%, rgba(10, 15, 29, 0.98) 100%);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 22px;
  padding: 24px 28px;
  margin-bottom: 22px;
  box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.8), inset 0 1px 1px rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.dashboard-welcome-hero::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #3B82F6 0%, #E5A93C 50%, #10B981 100%);
  border-radius: 22px 22px 0 0;
}
.hero-backdrop-glow {
  position: absolute;
  top: -40px;
  right: -40px;
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.20) 0%, transparent 70%);
  pointer-events: none;
  filter: blur(40px);
}
.hero-backdrop-glow.admin-glow {
  background: radial-gradient(circle, rgba(229, 169, 60, 0.24) 0%, transparent 70%);
}
.hero-content {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
}
.hero-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 280px;
  flex: 1;
}
.hero-badge-strip {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.65);
  border: 1px solid rgba(59, 130, 246, 0.28);
  color: #CBD5E1;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.03em;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.hero-badge.live-dot {
  background: rgba(16, 185, 129, 0.14);
  border-color: rgba(16, 185, 129, 0.35);
  color: #34D399;
}
.hero-badge.admin-badge {
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.4);
  color: #FBBF24;
}
.pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #10B981;
  box-shadow: 0 0 10px #10B981;
  animation: pulseDot 2s infinite ease-in-out;
}
@keyframes pulseDot {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.35); opacity: 0.65; }
}
.hero-greeting {
  font-family: 'Outfit', 'Plus Jakarta Sans', sans-serif;
  font-size: 28px;
  font-weight: 800;
  color: #F8FAFC;
  margin: 0;
  letter-spacing: -0.025em;
  display: flex;
  align-items: center;
  gap: 12px;
  line-height: 1.2;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
.hero-name-gradient {
  background: linear-gradient(135deg, #60A5FA 0%, #3B82F6 45%, #F59E0B 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 2px 8px rgba(59, 130, 246, 0.35));
  font-weight: 900;
  letter-spacing: 0.01em;
}
.hero-sub {
  font-size: 13.5px;
  color: #94A3B8;
  margin: 0;
  font-weight: 500;
  letter-spacing: 0.01em;
}
.hero-period-highlight {
  color: #E5A93C;
  font-weight: 700;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.btn-hero-primary {
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #FCD34D 0%, #F59E0B 50%, #B45309 100%);
  color: #0A0F1A;
  border: none;
  border-radius: 12px;
  padding: 10px 18px;
  font-weight: 800;
  font-size: 13.5px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 6px 20px rgba(245, 158, 11, 0.35), inset 0 1px 1px rgba(255,255,255,0.4);
  transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  white-space: nowrap;
}
.btn-hero-primary:hover {
  filter: brightness(1.08);
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(245, 158, 11, 0.5);
}
.btn-hero-ghost {
  background: rgba(255, 255, 255, 0.05);
  color: #F8FAFC;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 10px 16px;
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  transition: all 0.2s ease;
  white-space: nowrap;
}
.btn-hero-ghost:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(96, 165, 250, 0.4);
  color: #FFFFFF;
  transform: translateY(-1.5px);
}

/* Light Mode Overrides for Hero */
body.light .dashboard-welcome-hero {
  background: linear-gradient(135deg, #FFFFFF 0%, #F8FAFC 100%) !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 12px 35px rgba(15, 23, 42, 0.08) !important;
}
body.light .hero-greeting { color: #0F172A !important; text-shadow: none !important; }
body.light .hero-name-gradient {
  background: linear-gradient(135deg, #1E40AF 0%, #2563EB 50%, #D97706 100%) !important;
  -webkit-background-clip: text !important;
  -webkit-text-fill-color: transparent !important;
  filter: drop-shadow(0 2px 6px rgba(37, 99, 235, 0.25)) !important;
}
body.light .hero-sub { color: #475569 !important; }
body.light .hero-badge {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  color: #334155 !important;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.06) !important;
}
body.light .btn-hero-ghost {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  color: #0F172A !important;
}
body.light .btn-hero-ghost:hover {
  background: #F1F5F9 !important;
  border-color: #2563EB !important;
  color: #2563EB !important;
}

/* ==================== Executive Welcome Toast (Non-blocking) ==================== */
.executive-welcome-toast {
  position: fixed;
  top: 24px;
  right: 24px;
  z-index: 999999;
  max-width: 430px;
  width: calc(100vw - 48px);
  background: linear-gradient(145deg, rgba(17, 24, 39, 0.97) 0%, rgba(10, 15, 29, 0.99) 100%);
  border: 1px solid rgba(59, 130, 246, 0.35);
  border-radius: 20px;
  padding: 16px 18px;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.85), 0 0 35px rgba(59, 130, 246, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  transform: translateX(120%) scale(0.95);
  opacity: 0;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
  pointer-events: auto;
}
.executive-welcome-toast.show {
  transform: translateX(0) scale(1);
  opacity: 1;
}
.toast-content-box {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}
.toast-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.22) 0%, rgba(37, 99, 235, 0.16) 100%);
  border: 1.5px solid rgba(16, 185, 129, 0.5);
  color: #10B981;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
}
.toast-icon-wrap svg {
  width: 22px;
  height: 22px;
}
.toast-body {
  flex: 1;
  min-width: 0;
}
.toast-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}
.toast-badge {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(59, 130, 246, 0.18);
  border: 1px solid rgba(59, 130, 246, 0.35);
  color: #60A5FA;
}
.toast-time {
  font-size: 10.5px;
  color: #64748B;
  font-weight: 600;
}
.toast-title {
  font-size: 14.5px;
  font-weight: 800;
  color: #FFFFFF;
  margin: 0 0 3px 0;
  letter-spacing: -0.01em;
}
.toast-desc {
  font-size: 12px;
  color: #94A3B8;
  margin: 0;
  line-height: 1.4;
}
.toast-desc strong {
  color: #E2E8F0;
}
.toast-close-btn {
  background: transparent;
  border: none;
  color: #64748B;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  transition: all 0.15s ease;
  line-height: 1;
}
.toast-close-btn:hover {
  color: #FFFFFF;
  background: rgba(255, 255, 255, 0.1);
}
.toast-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #3B82F6, #10B981, #E5A93C);
  border-radius: 0 0 20px 20px;
  animation: toastBarFill 4.5s linear forwards;
}
@keyframes toastBarFill {
  from { width: 100%; }
  to { width: 0%; }
}
body.light .executive-welcome-toast {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.15) !important;
}
body.light .toast-title { color: #0F172A !important; }
body.light .toast-desc { color: #475569 !important; }
body.light .toast-desc strong { color: #0F172A !important; }

/* ==================== Admin Center: Usuários Cadastrados ==================== */
.env-badge-homolog {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(245, 158, 11, 0.35);
  color: #FBBF24;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  backdrop-filter: blur(8px);
}
/* ==================== Admin Center: Usuários Cadastrados ==================== */
.env-badge-homolog {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 9999px;
  background: rgba(245, 158, 11, 0.16);
  border: 1px solid rgba(245, 158, 11, 0.35);
  color: #FBBF24;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  backdrop-filter: blur(8px);
}
.admin-toolbar-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.admin-search-wrap {
  position: relative;
  flex: 1;
  min-width: 280px;
}
.admin-search-wrap svg {
  position: absolute;
  left: 14px;
  top: 50%;
  transform: translateY(-50%);
  width: 17px;
  height: 17px;
  color: #94A3B8;
  pointer-events: none;
}
.admin-search-input {
  width: 100%;
  height: 40px;
  background: var(--card);
  border: 1px solid var(--card-border);
  border-radius: 10px;
  padding: 0 16px 0 42px;
  color: #FFFFFF;
  font-size: 13.5px;
  font-weight: 500;
  outline: none;
  transition: all 0.2s ease;
}
.admin-search-input::placeholder {
  color: #94A3B8;
}
.admin-search-input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 15px rgba(59, 130, 246, 0.3);
}
.admin-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.admin-filter-btn {
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid var(--card-border);
  background: rgba(255, 255, 255, 0.04);
  color: #94A3B8;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.admin-filter-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  color: #FFFFFF;
}
.admin-filter-btn.active {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(37, 99, 235, 0.15));
  border-color: rgba(59, 130, 246, 0.5);
  color: #60A5FA;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
}
body.light .admin-filter-btn.active {
  background: #EFF6FF;
  border-color: #3B82F6;
  color: #1D4ED8;
}

.user-admin-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.user-card-4k {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 80px;
  padding: 16px 22px;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 18px !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(15, 23, 42, 0.65) 50%, rgba(10, 15, 29, 0.78) 100%) !important;
  backdrop-filter: blur(24px) saturate(190%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(190%) !important;
  box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.20) !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.user-card-4k:hover {
  border-color: rgba(96, 165, 250, 0.45) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 18px 45px -4px rgba(0, 0, 0, 0.8), 0 0 24px rgba(59, 130, 246, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
}
.user-card-4k.inactive {
  opacity: 0.75;
  border-color: rgba(239, 68, 68, 0.35) !important;
}
.user-card-left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  flex: 1;
}
.user-card-avatar {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 900;
  font-size: 15.5px;
  color: #FFFFFF;
  position: relative;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255,255,255,0.4);
}
.user-card-avatar.admin-av {
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 60%, #B45309 100%);
  border: 1.5px solid rgba(251, 191, 36, 0.5);
  box-shadow: 0 0 18px rgba(245, 158, 11, 0.35), inset 0 1px 1px rgba(255,255,255,0.5);
}
.user-card-avatar.user-av {
  background: linear-gradient(135deg, #3B82F6 0%, #2563EB 60%, #1D4ED8 100%);
  border: 1.5px solid rgba(96, 165, 250, 0.5);
  box-shadow: 0 0 18px rgba(59, 130, 246, 0.35), inset 0 1px 1px rgba(255,255,255,0.5);
}
.user-status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--bg);
}
.user-status-dot.online { background: #10B981; box-shadow: 0 0 6px #10B981; }
.user-status-dot.offline { background: #EF4444; }

.user-card-info {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.user-card-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.user-card-name {
  font-size: 15px;
  font-weight: 700;
  color: #FFFFFF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}
.user-card-email {
  font-size: 13px;
  color: #94A3B8;
  font-weight: 500;
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-card-stats-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
  flex-wrap: wrap;
}
.user-stat-chip {
  font-size: 11.5px;
  font-weight: 600;
  padding: 2.5px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #94A3B8;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.user-stat-chip strong {
  color: #FFFFFF;
  font-weight: 700;
}

.user-card-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  min-width: 290px;
}
.role-badge {
  font-size: 11.5px;
  font-weight: 800;
  padding: 3.5px 11px;
  border-radius: 20px;
  flex-shrink: 0;
  white-space: nowrap;
  letter-spacing: 0.02em;
  display: inline-flex;
  align-items: center;
}
.role-badge.admin {
  background: rgba(245, 158, 11, 0.18);
  border: 1px solid rgba(245, 158, 11, 0.4);
  color: #FBBF24;
}
.role-badge.user {
  background: rgba(59, 130, 246, 0.18);
  border: 1px solid rgba(59, 130, 246, 0.4);
  color: #60A5FA;
}
.role-badge.inactive {
  background: rgba(239, 68, 68, 0.18);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #F87171;
}

body.light .user-card-4k {
  background: #FFFFFF !important;
  border-color: #CBD5E1 !important;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06) !important;
}
body.light .user-card-name { color: #0F172A !important; }
body.light .user-card-email { color: #475569 !important; }
body.light .user-stat-chip {
  background: #F1F5F9 !important;
  border-color: #CBD5E1 !important;
  color: #475569 !important;
}
body.light .user-stat-chip strong { color: #0F172A !important; }

/* ==================== Banner: Modo Visualização (Admin) ==================== */
.view-mode-banner {
  position: fixed !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  z-index: 1000000 !important;
  display: none;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 24px !important;
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.96) 0%, rgba(217, 119, 6, 0.98) 100%) !important;
  border-bottom: 2px solid #FDE68A !important;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 25px rgba(245, 158, 11, 0.4) !important;
  color: #060B18 !important;
  font-size: 13.5px !important;
  font-weight: 700 !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  transition: all 0.3s ease !important;
}
.view-mode-banner.show {
  display: flex !important;
}
.view-mode-content {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #060B18 !important;
}
.view-mode-icon {
  font-size: 18px;
}
.view-mode-banner strong {
  color: #000000 !important;
  background: rgba(255, 255, 255, 0.35);
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 900 !important;
}
.view-mode-banner button,
.view-mode-exit-btn {
  background: #0F172A !important;
  color: #FFFFFF !important;
  border: 1.5px solid #FDE68A !important;
  font-weight: 800 !important;
  font-size: 13px !important;
  padding: 8px 18px !important;
  border-radius: 10px !important;
  cursor: pointer !important;
  flex-shrink: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
  transition: all 0.2s ease !important;
}
.view-mode-banner button:hover,
.view-mode-exit-btn:hover {
  background: #1E293B !important;
  transform: translateY(-1.5px) !important;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5) !important;
}

body.has-view-mode-banner .topheader {
  top: 50px !important;
}
body.has-view-mode-banner .main {
  padding-top: 140px !important;
}
body.has-view-mode-banner .sidebar {
  top: 125px !important;
}

/* Floating FAB Button para Sair do Espelho */
.floating-mirror-exit-fab {
  position: fixed !important;
  bottom: 28px !important;
  right: 28px !important;
  z-index: 1000001 !important;
  display: none;
  align-items: center;
  gap: 10px;
  padding: 14px 24px !important;
  border-radius: 999px !important;
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%) !important;
  color: #060B18 !important;
  font-size: 14px !important;
  font-weight: 900 !important;
  border: 2px solid #FEF08A !important;
  box-shadow: 0 12px 35px -5px rgba(245, 158, 11, 0.7), 0 0 25px rgba(245, 158, 11, 0.4) !important;
  cursor: pointer !important;
  animation: pulseFab 2.2s infinite;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
}
.floating-mirror-exit-fab:hover {
  transform: translateY(-3px) scale(1.05) !important;
  filter: brightness(1.1) !important;
  box-shadow: 0 16px 45px -2px rgba(245, 158, 11, 0.9) !important;
}
@keyframes pulseFab {
  0%, 100% { box-shadow: 0 12px 35px -5px rgba(245, 158, 11, 0.7), 0 0 25px rgba(245, 158, 11, 0.4); }
  50% { box-shadow: 0 14px 45px 2px rgba(245, 158, 11, 1), 0 0 35px rgba(245, 158, 11, 0.75); }
}

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

/* ==================== Popups de Autenticação 4K Glass (Entrada & Saída) ==================== */
.login-success-overlay {
  position: fixed; inset: 0;
  background: radial-gradient(circle at 50% 45%, rgba(6, 12, 28, 0.75) 0%, rgba(2, 5, 12, 0.88) 100%) !important;
  backdrop-filter: blur(36px) saturate(210%) !important;
  -webkit-backdrop-filter: blur(36px) saturate(210%) !important;
  display: none; align-items: center; justify-content: center;
  z-index: 99999 !important; padding: 24px; opacity: 0;
  transition: opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), backdrop-filter 0.35s ease;
}
.login-success-overlay.show { display: flex; }
.login-success-overlay.in { opacity: 1; }

.login-success-box {
  position: relative !important;
  overflow: hidden !important;
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.08) 0%, rgba(18, 26, 48, 0.76) 40%, rgba(7, 12, 24, 0.94) 100%) !important;
  backdrop-filter: blur(48px) saturate(220%) !important;
  -webkit-backdrop-filter: blur(48px) saturate(220%) !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  border-top: 1px solid rgba(255, 255, 255, 0.35) !important;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 28px !important;
  padding: 42px 34px 34px !important;
  width: 100% !important; max-width: 440px !important;
  text-align: center !important;
  box-shadow: 0 35px 95px -12px rgba(0, 0, 0, 0.88), 0 0 0 1px rgba(255, 255, 255, 0.06), inset 0 1px 1px 0 rgba(255, 255, 255, 0.45), inset 0 -1px 2px rgba(0, 0, 0, 0.5) !important;
  transform: translateY(22px) scale(0.92); opacity: 0;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.4s ease !important;
}

.login-success-box::before {
  content: '';
  position: absolute;
  top: 0;
  left: 10%;
  right: 10%;
  height: 1.5px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.9), rgba(52, 211, 153, 0.85), rgba(96, 165, 250, 0.75), transparent);
  filter: blur(0.5px);
  pointer-events: none;
}

.login-success-overlay.in .login-success-box {
  transform: translateY(0) scale(1) !important;
  opacity: 1 !important;
}

/* Brilho atmosférico de fundo */
.auth-ambient-glow {
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  width: 260px;
  height: 160px;
  filter: blur(44px);
  pointer-events: none;
  border-radius: 50%;
  opacity: 0.75;
}
.auth-ambient-glow.glow-blue {
  background: radial-gradient(circle, rgba(59, 130, 246, 0.35) 0%, rgba(14, 165, 233, 0.15) 55%, transparent 75%);
}
.auth-ambient-glow.glow-emerald {
  background: radial-gradient(circle, rgba(16, 185, 129, 0.35) 0%, rgba(6, 182, 212, 0.18) 55%, transparent 75%);
}
.auth-ambient-glow.glow-red {
  background: radial-gradient(circle, rgba(239, 68, 68, 0.35) 0%, rgba(220, 38, 38, 0.15) 55%, transparent 75%);
}

/* Badge de status em vidro */
.auth-modal-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 12px;
  backdrop-filter: blur(12px);
  position: relative;
  z-index: 2;
}
.auth-badge-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.auth-badge-logout {
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(52, 211, 153, 0.35);
  color: #34D399;
  box-shadow: 0 0 16px rgba(16, 185, 129, 0.15);
}
.auth-badge-logout .auth-badge-dot {
  background: #10B981;
  box-shadow: 0 0 8px #10B981;
}
.auth-badge-success {
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(96, 165, 250, 0.35);
  color: #60A5FA;
  box-shadow: 0 0 16px rgba(59, 130, 246, 0.15);
}
.auth-badge-success .auth-badge-dot {
  background: #3B82F6;
  box-shadow: 0 0 8px #3B82F6;
}
.auth-badge-error {
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.35);
  color: #F87171;
  box-shadow: 0 0 16px rgba(239, 68, 68, 0.15);
}
.auth-badge-error .auth-badge-dot {
  background: #EF4444;
  box-shadow: 0 0 8px #EF4444;
}

/* Ícone de Entrada (Checkmark 4K) */
.login-success-check {
  width: 80px !important;
  height: 80px !important;
  margin: 0 auto 18px !important;
  border-radius: 50% !important;
  background: radial-gradient(circle at 35% 30%, rgba(16, 185, 129, 0.28) 0%, rgba(59, 130, 246, 0.15) 50%, rgba(8, 14, 28, 0.8) 100%) !important;
  border: 1.5px solid rgba(52, 211, 153, 0.55) !important;
  box-shadow: 0 0 35px rgba(16, 185, 129, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.6), inset 0 -2px 4px rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  position: relative;
  z-index: 2;
}
.login-success-check svg { width: 38px; height: 38px; }
.login-success-check circle { stroke: rgba(16, 185, 129, 0.35); stroke-width: 2.5; }
.login-success-check path {
  stroke: #10B981; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 40; stroke-dashoffset: 40; animation: loginCheckDraw .45s ease .15s forwards;
  filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.85));
}
@keyframes loginCheckDraw{to{stroke-dashoffset:0;}}

/* Ícone de Saída (Logout 4K Glass Orb) */
.logout-success-icon {
  width: 80px !important;
  height: 80px !important;
  margin: 0 auto 18px !important;
  border-radius: 50% !important;
  background: radial-gradient(circle at 35% 30%, rgba(16, 185, 129, 0.28) 0%, rgba(6, 182, 212, 0.15) 50%, rgba(8, 14, 28, 0.8) 100%) !important;
  border: 1.5px solid rgba(52, 211, 153, 0.55) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-shadow: 0 0 35px rgba(16, 185, 129, 0.38), inset 0 2px 4px rgba(255, 255, 255, 0.6), inset 0 -2px 4px rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  position: relative;
  z-index: 2;
  transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.logout-box:hover .logout-success-icon {
  transform: scale(1.04);
}
.logout-success-icon svg {
  width: 36px;
  height: 36px;
  stroke: #34D399;
  filter: drop-shadow(0 0 10px rgba(52, 211, 153, 0.85));
}

/* Tipografia Refinada 4K */
.login-success-box h3 {
  font-size: 22px !important;
  font-weight: 900 !important;
  color: #FFFFFF !important;
  margin-bottom: 9px !important;
  letter-spacing: -0.02em !important;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.6);
  position: relative;
  z-index: 2;
}
.login-success-box p {
  color: #94A3B8 !important;
  font-size: 13.8px !important;
  line-height: 1.6 !important;
  font-weight: 500 !important;
  margin: 0 auto 24px !important;
  max-width: 370px !important;
  position: relative;
  z-index: 2;
}

/* Botão de Ação de Saída 4K ("Fazer Login Novamente →") */
.logout-btn-action {
  width: 100% !important;
  padding: 15px 24px !important;
  border-radius: 16px !important;
  font-weight: 800 !important;
  font-size: 14.5px !important;
  letter-spacing: 0.01em !important;
  background: linear-gradient(135deg, #10B981 0%, #059669 50%, #047857 100%) !important;
  color: #FFFFFF !important;
  border: 1px solid rgba(255, 255, 255, 0.28) !important;
  cursor: pointer !important;
  box-shadow: 0 14px 30px -4px rgba(16, 185, 129, 0.45), inset 0 1px 2px rgba(255, 255, 255, 0.6), inset 0 -1px 2px rgba(0, 0, 0, 0.3) !important;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 9px !important;
  position: relative;
  z-index: 2;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}
.logout-btn-action:hover {
  transform: translateY(-2px) scale(1.015) !important;
  background: linear-gradient(135deg, #34D399 0%, #10B981 50%, #059669 100%) !important;
  box-shadow: 0 18px 36px -4px rgba(16, 185, 129, 0.6), inset 0 1px 2px rgba(255, 255, 255, 0.8) !important;
  filter: brightness(1.04);
}
.logout-btn-action:active {
  transform: translateY(1px) scale(0.985) !important;
}
.logout-btn-arrow {
  width: 18px;
  height: 18px;
  transition: transform 0.25s ease;
}
.logout-btn-action:hover .logout-btn-arrow {
  transform: translateX(4px);
}

/* Barra de Tempo do Logout (Progresso Inteligente) */
.logout-timer-bar {
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  margin-top: 18px;
  overflow: hidden;
  position: relative;
  z-index: 2;
}
.logout-timer-progress {
  height: 100%;
  width: 100%;
  background: linear-gradient(90deg, #10B981 0%, #06B6D4 100%);
  border-radius: 999px;
  box-shadow: 0 0 10px rgba(16, 185, 129, 0.7);
}

/* Barra de Progresso do Login */
.login-success-progress-bar {
  width: 100% !important;
  height: 5px !important;
  background: rgba(255, 255, 255, 0.08) !important;
  border-radius: 999px !important;
  overflow: hidden !important;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5) !important;
  position: relative;
  z-index: 2;
}
.login-success-progress-fill {
  height: 100% !important;
  width: 0;
  background: linear-gradient(90deg, #3B82F6 0%, #06B6D4 50%, #10B981 100%) !important;
  border-radius: 999px !important;
  box-shadow: 0 0 14px rgba(16, 185, 129, 0.85) !important;
  animation: loginProgressFill 2.4s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes loginProgressFill{
  from{width:0%;}
  to{width:100%;}
}

/* Popup de Conta Desativada */
.account-disabled-icon {
  width: 80px !important;
  height: 80px !important;
  margin: 0 auto 18px !important;
  border-radius: 50% !important;
  background: radial-gradient(circle at 35% 30%, rgba(239, 68, 68, 0.28) 0%, rgba(185, 28, 28, 0.15) 50%, rgba(8, 14, 28, 0.8) 100%) !important;
  border: 1.5px solid rgba(248, 113, 113, 0.55) !important;
  box-shadow: 0 0 35px rgba(239, 68, 68, 0.4), inset 0 2px 4px rgba(255, 255, 255, 0.6), inset 0 -2px 4px rgba(0, 0, 0, 0.5) !important;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  position: relative;
  z-index: 2;
}
.account-disabled-icon svg { width: 36px; height: 36px; }
.account-disabled-icon path, .account-disabled-icon circle {
  stroke: #EF4444; stroke-width: 2.5; fill: none; stroke-linecap: round; stroke-linejoin: round;
  filter: drop-shadow(0 0 8px rgba(239, 68, 68, 0.8));
}
.login-success-box .account-disabled-btn {
  margin-top: 6px;
  width: 100%;
  background: linear-gradient(135deg, #EF4444 0%, #DC2626 60%, #991B1B 100%) !important;
  box-shadow: 0 12px 28px -4px rgba(239, 68, 68, 0.5), inset 0 1px 1.5px rgba(255, 255, 255, 0.5) !important;
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.25) !important;
  font-weight: 800;
  font-size: 14.5px;
  padding: 14px;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  position: relative;
  z-index: 2;
}
.login-success-box .account-disabled-btn:hover {
  transform: translateY(-2px) scale(1.015);
  filter: brightness(1.08);
  box-shadow: 0 16px 32px -4px rgba(239, 68, 68, 0.65) !important;
}

/* Suporte Refinado para Tema Claro */
body.light .login-success-box {
  background: linear-gradient(165deg, rgba(255, 255, 255, 0.94) 0%, rgba(241, 245, 249, 0.97) 100%) !important;
  border: 1px solid rgba(203, 213, 225, 0.85) !important;
  border-top: 1px solid rgba(255, 255, 255, 1) !important;
  box-shadow: 0 30px 80px -10px rgba(15, 23, 42, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.9), inset 0 1px 2px rgba(255, 255, 255, 1) !important;
}
body.light .login-success-box h3 {
  color: #0F172A !important;
  text-shadow: none !important;
}
body.light .login-success-box p {
  color: #475569 !important;
}
body.light .auth-ambient-glow {
  opacity: 0.35;
}
body.light .logout-timer-bar {
  background: rgba(0, 0, 0, 0.08);
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
<script>(function(){if(document.documentElement.classList.contains('light')){document.body.classList.add('light');}})();</script>

<!-- ==================== CENÁRIO 4K GLOBAL (CANVAS DINÂMICO, PLACAS DE VIDRO LÍQUIDO, REFLEXO & GRID) ==================== -->
<canvas id="authBgCanvas" style="position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:0; opacity:0.85;"></canvas>
<div class="glass-viewport-screen pointer-events-none">
  <div class="glass-shard glass-shard-1"></div>
  <div class="glass-shard glass-shard-2"></div>
  <div class="glass-shard glass-shard-3"></div>
  <div class="glass-shard glass-shard-4"></div>
  <div class="glass-shard glass-shard-5"></div>
</div>
<div class="glass-screen-reflection pointer-events-none"></div>
<div class="auth-grid" aria-hidden="true"></div>
<div class="auth-blob b1"></div>
<div class="auth-blob b2"></div>
<div class="auth-blob b3"></div>

<!-- TELA DE LOGIN / CADASTRO ULTRA MODERNA 4K -->
<div class="auth-container show" id="authPage">
  <div class="auth-top-bar" style="width:100%; max-width:1200px; padding:0 24px; display:flex; justify-content:space-between; align-items:center; position:absolute; top:20px; z-index:20;">
    <div style="display:flex; align-items:center; gap:8px;"></div>
    <div style="display:flex; align-items:center; gap:12px;">
      <button type="button" class="auth-theme-btn" id="authThemeToggleBtn" title="Alternar Tema Claro / Escuro">
        <svg id="authThemeIcon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/>
        </svg>
  </div>

  <div class="auth-exec-layout">
    <!-- Showcase Institucional Executivo -->
    <div class="auth-showcase-panel">
      <div class="auth-showcase-badge">
        <span style="width:7px; height:7px; border-radius:50%; background:#F59E0B; display:inline-block;"></span>
        <span>CONTROLE FINANCEIRO PESSOAL • PRIVACIDADE TOTAL</span>
      </div>

      <div class="auth-showcase-title">
        Controle Total do seu Dinheiro & <span>Planejamento Inteligente</span>
      </div>

      <div class="auth-showcase-desc">
        Organize suas contas, acompanhe despesas e receitas, gerencie seus cartões e conquiste suas metas de economia com facilidade e clareza no dia a dia.
      </div>

      <div class="auth-showcase-metrics">
        <div class="auth-metric-card">
          <div class="metric-card-label">Economia do Mês</div>
          <div class="metric-val">R$ 3.850</div>
          <div class="metric-sub-green">+18% guardado 🎯</div>
        </div>

        <div class="auth-metric-card">
          <div class="metric-card-label">Orçamento & Gastos</div>
          <div class="metric-val">Sob Controle</div>
          <div class="metric-sub-amber">Sem sustos no fim do mês 💡</div>
        </div>

        <div class="auth-metric-card">
          <div class="metric-card-label">Metas & Sonhos</div>
          <div class="metric-val">84% Concluído</div>
          <div class="metric-sub-blue">Rumo à sua conquista 🚀</div>
        </div>
      </div>

      <div class="auth-showcase-footer">
        <span style="display:flex; align-items:center; gap:6px;">
          <span style="width:6px; height:6px; border-radius:50%; background:#10B981; display:inline-block;"></span>
          Seus dados 100% seguros e confidenciais
        </span>
        <span>•</span>
        <span>Acesso Rápido e Descomplicado</span>
      </div>
    </div>

    <!-- Card Principal de Autenticação -->
    <div class="auth-card-nexus" id="serverAuthNexusCard">
      <div class="auth-card-glare" id="serverAuthCardGlare"></div>
      <!-- Brand Header -->
      <div class="auth-brand">
        <div class="auth-logo-badge">N</div>
        <div class="auth-title">NEXUS <span>FINANCEIRO HUB</span></div>
        <div class="auth-subtitle" id="authBoxSubtitle">Sua Gestão Financeira Pessoal Inteligente</div>
      </div>

      <!-- Navegação por Abas Segmentadas -->
      <div class="auth-tabs-nav" id="authTabsNav">
        <button type="button" class="auth-tab-btn active" id="tabBtnLogin" onclick="window.switchAuthTab('login')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          Entrar na Conta
        </button>
        <button type="button" class="auth-tab-btn" id="tabBtnRegister" onclick="window.switchAuthTab('register')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></svg>
          Criar Conta
        </button>
      </div>

      <!-- Box 1: Formulário de Login -->
      <div id="loginBox">
        <form id="loginForm" onsubmit="window.handleLoginSubmit(event); return false;">
          <div class="auth-field">
            <label>E-mail Corporativo ou Pessoal</label>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              </span>
              <input type="email" id="loginEmail" placeholder="seu.email@exemplo.com" required autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="none">
            </div>
          </div>

          <div class="auth-field">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <label style="margin-bottom:0;">Senha</label>
              <a class="auth-forgot-link" id="goForgotFromLogin">Esqueceu a senha?</a>
            </div>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input type="password" id="loginPassword" placeholder="••••••••" required autocomplete="current-password" spellcheck="false">
              <button type="button" class="auth-pass-toggle-btn" id="toggleLoginPassBtn" onclick="window.togglePasswordVisibility('loginPassword', 'toggleLoginPassBtn')" title="Visualizar Senha" aria-label="Visualizar Senha">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>

          <div id="loginFeedbackBanner" class="auth-feedback-banner error" style="display:none;"></div>

          <button type="submit" class="btn-auth-primary" id="loginSubmitBtn">
            Entrar na Conta →
          </button>
        </form>

        <p class="auth-bottom-text" style="margin-top:16px; text-align:center; font-size:12.5px; color:var(--auth-text-dim);">
          Não possui uma conta? <a onclick="window.switchAuthTab('register')" style="color:var(--auth-gold); font-weight:700; cursor:pointer; text-decoration:underline;">Cadastre-se gratuitamente</a>
        </p>
      </div>

      <!-- Box 2: Formulário de Registro -->
      <div id="registerBox" style="display:none;">
        <form id="registerForm" onsubmit="window.handleRegisterSubmit(event); return false;">
          <div class="auth-field">
            <label>Nome Completo</label>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              </span>
              <input type="text" id="regName" placeholder="Ex: Paulo Lima" required autocomplete="name" spellcheck="false">
            </div>
          </div>

          <div class="auth-field">
            <label>E-mail</label>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              </span>
              <input type="email" id="regEmail" placeholder="seu.email@exemplo.com" required autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="none">
            </div>
          </div>

          <div class="auth-field">
            <label>Criar Senha</label>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input type="password" id="regPassword" placeholder="Mínimo 6 caracteres" required minlength="6" autocomplete="new-password" spellcheck="false" oninput="window.checkServerRegPasswordMatch()">
              <button type="button" class="auth-pass-toggle-btn" id="toggleRegPassBtn" onclick="window.toggleRegisterBothPasswords('toggleRegPassBtn')" title="Visualizar Senhas" aria-label="Visualizar Senhas">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            </div>
          </div>

          <div class="auth-field">
            <label>Confirmar Senha</label>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>
              </span>
              <input type="password" id="regConfirmPassword" placeholder="Repita sua senha" required minlength="6" autocomplete="new-password" spellcheck="false" oninput="window.checkServerRegPasswordMatch()">
            </div>
            <div id="regPwdMatchMsg" style="display:none; font-size:11px; font-weight:600; margin-top:4px; align-items:center; gap:4px;"></div>
          </div>

          <div id="registerFeedbackBanner" class="auth-feedback-banner error" style="display:none;"></div>

          <button type="submit" class="btn-auth-primary" id="regSubmitBtn">
            Criar Minha Conta →
          </button>
        </form>

        <p style="margin-top:16px; text-align:center; font-size:12.5px; color:var(--auth-text-dim);">
          Já possui cadastro? <a onclick="window.switchAuthTab('login')" style="color:#f59e0b; font-weight:700; cursor:pointer; text-decoration:underline;">Fazer Logon</a>
        </p>
      </div>

      <!-- Box 3: Recuperação de Senha -->
      <div id="forgotBox" style="display:none;">
        <p style="font-size:13.5px; color:var(--auth-text-dim); margin-bottom:20px; line-height:1.5;">
          Informe seu e-mail cadastrado para enviarmos sua senha ou gerar uma credencial de acesso imediato.
        </p>

        <form id="forgotStep1">
          <div class="auth-field">
            <label>E-mail Corporativo ou Pessoal</label>
            <div class="auth-input-wrapper">
              <span class="auth-input-icon">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              </span>
              <input type="email" id="forgotEmail" placeholder="seu.email@exemplo.com" required autocomplete="email" spellcheck="false" autocorrect="off" autocapitalize="none">
            </div>
          </div>

          <div id="forgotFeedbackBanner" class="auth-feedback-banner error" style="display:none;"></div>

          <button type="submit" class="btn-auth-primary" id="btnSendPassword">
            Recuperar Minha Senha →
          </button>
        </form>

        <div style="text-align:center; margin-top:18px;">
          <a class="auth-forgot-link" id="goLoginFromForgot">← Voltar para o Login</a>
        </div>
      </div>

      <!-- Ação de Ordem de Serviço (O.S. / Consulta) -->
      <div style="margin-top:14px; width:100%;">
        <button type="button" class="btn-open-os" onclick="openNovaOrdemModal()">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><path d="m9 14 2 2 4-4"/></svg>
          <span>Abrir Ordem de Serviço OS / Consulta de OS</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Assinatura do Desenvolvedor no Rodapé Global da Autenticação -->
  <footer class="auth-global-footer">
    <div class="dev-signature" style="justify-content:center;">
      <div class="dev-signature-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      </div>
      <div class="dev-signature-text">
        <span class="dev-signature-label">Desenvolvido por</span>
        <strong class="dev-signature-name">PAULO LIMA <span class="dev-sparkle">✦</span></strong>
      </div>
    </div>
  </footer>
</div>

<!-- APLICAÇÃO PRINCIPAL -->
<div class="app" id="appMain">
  <div class="view-mode-banner" id="viewModeBanner">
    <div class="view-mode-content">
      <span class="view-mode-icon">👁️</span>
      <span>MODO ESPELHO ATIVO: Visualizando conta de <strong id="viewModeUserName"></strong> (Somente Leitura)</span>
    </div>
    <button type="button" id="viewModeExitBtn" class="view-mode-exit-btn" onclick="exitViewMode()">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
      <span>Voltar para Modo Administrador</span>
    </button>
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
  <!-- SIDEBAR LATERAL EXECUTIVA 4K (FUNCIONALIDADES DO LADO & MINHA CONTA NO RODAPÉ) -->
  <aside class="sidebar-executive" id="sidebarExecutive">
    <div class="sidebar-header">
      <div class="brand">
        <div class="logo">N</div>
        <div class="name">NEXUS<span>FINANCEIRO HUB</span></div>
      </div>
    </div>

    <!-- NAVEGAÇÃO VERTICAL DAS FUNCIONALIDADES -->
    <div class="sidebar-nav-container">
      <div class="sidebar-nav-caption">FUNCIONALIDADES</div>
      <nav class="menu" id="menu">
        <button data-page="dashboard"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></svg></span> <span>Dashboard</span></button>
        <button data-page="transacoes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></svg></span> <span>Transações</span></button>
        <button data-page="cartoes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg></span> <span>Cartões</span></button>
        <button data-page="orcamentos"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></span> <span>Orçamentos</span></button>
        <button data-page="metas"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span> <span>Metas</span></button>
        <button data-page="relatorios"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8" rx="1"/><rect x="12" y="5" width="3" height="13" rx="1"/><rect x="17" y="13" width="3" height="5" rx="1"/></svg></span> <span>Relatórios</span></button>
        <button data-page="recorrentes"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg></span> <span>Recorrentes</span></button>
        <button data-page="importar"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/></svg></span> <span>Importar</span></button>
        <button data-page="anexos"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57a4 4 0 1 1 5.66 5.66l-8.59 8.58a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span> <span>Anexos</span></button>
        <button data-page="config" id="menuConfigBtn"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></span> <span>Configurações</span></button>

        <!-- Admin Links -->
        <button data-page="funcoes" id="menuFuncoesBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg></span> <span>Funções & Permissões</span></button>
        <button data-page="usuarios" id="menuUsuariosBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span> <span>Usuários</span></button>
        <button data-page="logs" id="menuLogsBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span> <span>Logs do Sistema</span></button>
        <button data-page="ordens" id="menuOrdensBtn" style="display:none;"><span class="ic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><path d="m9 14 2 2 4-4"/></svg></span> <span>Ordens de Serviço</span> <span id="osBadgeCount" style="margin-left:auto; padding:2px 7px; border-radius:999px; font-size:10px; font-weight:800; background:rgba(239,68,68,0.25); color:#FCA5A5; border:1px solid rgba(239,68,68,0.4); display:none;"></span></button>
      </nav>
    </div>

    <!-- RODAPÉ DA SIDEBAR: NO FINAL MINHA CONTA E APRESENTAR CONFIGURAÇÕES -->
    <div class="sidebar-footer">
      <div class="sidebar-nav-caption">MINHA CONTA</div>
      <!-- Card Clicável Minha Conta -> Leva Direto a Configurações -->
      <button data-page="config" class="sidebar-account-card" id="sidebarAccountCard" title="Acessar Minha Conta e Configurações">
        <div class="avatar" id="sidebarAvatar">PL</div>
        <div class="sidebar-account-info">
          <div class="uname" id="sidebarName">Paulo Lima</div>
          <div class="urole" id="sidebarRole">Configurações ⚙️</div>
        </div>
        <svg class="sidebar-account-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>

      <div class="sidebar-footer-actions">
        <button type="button" class="sidebar-action-btn" id="sidebarThemeBtn" title="Alternar Tema">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/></svg>
          <span>Tema</span>
        </button>
        <button type="button" class="sidebar-action-btn logout-btn" id="sidebarLogoutBtn" title="Encerrar Sessão">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          <span>Sair</span>
        </button>
      </div>
    </div>
  </aside>

  <!-- ÁREA DE CONTEÚDO PRINCIPAL (COM TOPBAR COMPACTA À DIREITA DA SIDEBAR) -->
  <div class="app-content-wrapper">
    <header class="app-topbar">
      <div style="display:flex; align-items:center; gap:12px;">
        <button class="mobile-menu-btn" id="mobileMenuToggle" title="Abrir Menu">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
        <div class="header-live-time" id="headerClock" style="display:flex; align-items:center; gap:8px; padding:6px 12px; border-radius:12px; font-size:12px; font-weight:700;">
          <span class="time-dot" style="width:7px; height:7px; border-radius:50%; background:#10B981; display:inline-block;"></span>
          <span id="liveClockText">Nexus Executive</span>
        </div>
      </div>

      <div class="right" style="margin-left:auto; display:flex; align-items:center; gap:10px;">
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
        <div class="user" id="userMenu" data-nav="config" style="display:none;">
          <div class="avatar" id="headerAvatar"></div>
          <div><div class="uname" id="headerName"></div><div class="urole" id="headerRole"></div></div>
        </div>
        <script>
        (function(){
          try {
            var savedTheme = localStorage.getItem('nexus_theme');
            if (savedTheme) savedTheme = savedTheme.replace(/"/g, '').trim();
            var isLight = (savedTheme === 'light');
            var miniBtn = document.getElementById('miniThemeBtn');
            if (miniBtn) {
              miniBtn.innerHTML = isLight ?
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/></svg>' :
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/></svg>';
            }
            var savedScale = localStorage.getItem('nexus_display_scale') || 'auto';
            var scaleLabel = document.getElementById('currentScaleLabel');
            if (scaleLabel) {
              scaleLabel.textContent = (savedScale === 'auto') ? 'Auto' : savedScale;
            }

            var cu = localStorage.getItem('nexus_cached_user');
            if (cu) {
              var u = JSON.parse(cu);
              if (u && u.name) {
                var n = document.getElementById('headerName');
                var r = document.getElementById('headerRole');
                var a = document.getElementById('headerAvatar');
                var sn = document.getElementById('sidebarName');
                var sr = document.getElementById('sidebarRole');
                var sa = document.getElementById('sidebarAvatar');
                if (n) n.textContent = u.name;
                if (sn) sn.textContent = u.name;
                if (r) r.textContent = u.role || 'Usuário';
                if (sr) sr.textContent = (u.role || 'Usuário') + ' • Configurações ⚙️';
                var p = u.name.trim().split(/\s+/);
                var inits = (p.length >= 2 ? (p[0][0] + p[1][0]) : p[0].slice(0,2)).toUpperCase();
                if (a) a.textContent = inits;
                if (sa) sa.textContent = inits;
              }
            }
            setTimeout(function(){
              document.documentElement.classList.add('app-ready');
            }, 50);
          } catch(e){}
        })();
        </script>
        <button type="button" class="btn-primary" id="headerMirrorExitBtn" onclick="exitViewMode()" style="display:none; background:linear-gradient(135deg, #F59E0B 0%, #D97706 100%) !important; color:#060B18 !important; font-weight:800 !important; font-size:12px !important; padding:6px 14px !important; border-radius:10px !important; border:1.5px solid #FDE68A !important; box-shadow:0 0 16px rgba(245,158,11,0.5) !important; cursor:pointer !important; align-items:center; gap:6px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
          <span>Voltar ao Admin</span>
        </button>
        <button class="btn-ghost" id="logoutBtn" style="display:none;">Sair</button>
      </div>
    </header>

    <main class="main">
      <div id="pageContent"></div>
    </main>
  </div>

  <!-- Floating Action Button: Voltar do Modo Espelho -->
  <button type="button" id="floatingExitMirrorBtn" class="floating-mirror-exit-fab" onclick="exitViewMode()" title="Sair do Modo Espelho e voltar para Administrador" style="display:none;">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>
    <span>Voltar para Admin</span>
  </button>
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
        <strong class="dev-signature-name">PAULO LIMA <span class="dev-sparkle">✦</span></strong>
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
  <div class="modal" style="max-width: 490px;">
    <button class="close-x" id="closeRecModal">✕</button>
    <h2 id="recModalTitle">Novo Lançamento Recorrente</h2>
    <div class="toggle-type">
      <button type="button" id="recTypeInBtn">↓ Receita</button>
      <button type="button" id="recTypeOutBtn">↑ Despesa</button>
    </div>
    <div class="field"><label>Descrição</label><input id="recDesc" placeholder="Ex: Internet Claro, Aluguel, Seguro Auto"></div>
    <div class="field-row">
      <div class="field"><label>Valor (R$)</label><input id="recVal" type="number" step="0.01" placeholder="0,00"></div>
      <div class="field"><label>Dia do mês (Vencimento)</label><input id="recDay" type="number" min="1" max="31" value="5"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Categoria</label><select id="recCategoria"></select></div>
      <div class="field"><label>Conta / Cartão</label><select id="recConta"></select></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Frequência</label><select id="recFreq"><option>Mensal</option><option>Semanal</option><option>Bimestral</option><option>Trimestral</option><option>Semestral</option><option>Anual</option></select></div>
      <div class="field">
        <label>Tipo de Duração</label>
        <select id="recDurationMode">
          <option value="custom">📅 Definir Quantidade de Meses</option>
          <option value="infinite">♾️ Contínuo (Sem limite / Indeterminado)</option>
        </select>
      </div>
    </div>

    <div id="recCustomMonthsBox" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.09); border-radius:12px; padding:13px; margin-bottom:14px;">
      <div class="field" style="margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label style="margin:0; font-weight:700; color:var(--text);">Para quantos meses cadastrar?</label>
          <span id="recMonthsCountPreview" style="font-size:11.5px; color:var(--green); font-weight:700;">12 meses</span>
        </div>
        <input id="recTotalMonths" type="number" min="1" max="360" value="12" placeholder="Digite quantos meses for necessário (ex: 12)">
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
        <button type="button" class="rec-chip-btn" data-months="3">3 meses</button>
        <button type="button" class="rec-chip-btn" data-months="6">6 meses</button>
        <button type="button" class="rec-chip-btn active" data-months="12">12 meses (1 ano)</button>
        <button type="button" class="rec-chip-btn" data-months="24">24 meses (2 anos)</button>
        <button type="button" class="rec-chip-btn" data-months="36">36 meses (3 anos)</button>
        <button type="button" class="rec-chip-btn" data-months="48">48 meses (4 anos)</button>
        <button type="button" class="rec-chip-btn" data-months="60">60 meses (5 anos)</button>
      </div>
      <div class="field-row" style="margin-bottom:0;">
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:11.5px;">Mês Inicial</label>
          <select id="recStartMonth" style="font-size:12.5px; padding:8px 10px;"></select>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label style="font-size:11.5px;">Ano Inicial</label>
          <input id="recStartYear" type="number" min="2020" max="2050" style="font-size:12.5px; padding:8px 10px;">
        </div>
        <div class="field" id="recAppliedField" style="margin-bottom:0; display:none;">
          <label style="font-size:11.5px;">Meses já Lançados</label>
          <input id="recAppliedMonths" type="number" min="0" max="360" value="0" style="font-size:12.5px; padding:8px 10px;">
        </div>
      </div>
    </div>

    <div class="modal-actions">
      <button id="recCancelBtn">Cancelar</button>
      <button class="save" id="recSaveBtn">Salvar Recorrente</button>
    </div>
  </div>
</div>

<!-- Modal Aplicar Recorrente -->
<div class="overlay" id="overlayLaunchRecurring">
  <div class="modal" style="max-width: 480px;">
    <button class="close-x" id="closeLaunchRecModal">✕</button>
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
      <span style="font-size:22px; background:rgba(34,197,94,0.15); width:42px; height:42px; display:flex; align-items:center; justify-content:center; border-radius:12px; color:var(--green); flex-shrink:0;">⚡</span>
      <div>
        <h2 style="margin:0; font-size:17px; font-weight:800; color:var(--text);">Aplicar Lançamento Recorrente</h2>
        <p style="margin:2px 0 0 0; font-size:12px; color:var(--text-dim);" id="launchRecSubtitle">Selecione como deseja lançar esta conta no sistema</p>
      </div>
    </div>

    <div id="launchRecSummaryCard" style="background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:16px; margin-bottom:18px;">
      <!-- Preenchido via JS com detalhes da conta, total de meses, já lançados, restantes, valor total, etc. -->
    </div>

    <div style="display:flex; flex-direction:column; gap:10px;">
      <button class="btn-primary" id="btnLaunchNextMonth" style="padding:12px 16px; font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:space-between; width:100%; border-radius:10px;">
        <span style="display:flex; align-items:center; gap:8px;">▶ <span id="btnLaunchNextMonthLabel">Lançar Próximo Mês</span></span>
        <span class="pill" id="launchNextMonthPill" style="background:rgba(0,0,0,0.25); color:#fff; font-size:11px;">Mês 1 de 12</span>
      </button>

      <button class="btn-ghost" id="btnLaunchAllMonths" style="padding:12px 16px; font-size:13px; font-weight:700; display:flex; align-items:center; justify-content:space-between; width:100%; border-radius:10px; border:1px solid rgba(59,130,246,0.35); background:rgba(59,130,246,0.08); color:var(--blue);">
        <span style="display:flex; align-items:center; gap:8px;">⚡ <span id="btnLaunchAllMonthsLabel">Lançar Todos os Meses Restantes em Lote</span></span>
        <span class="pill" id="launchAllMonthsPill" style="background:rgba(59,130,246,0.2); color:var(--blue); font-size:11px;">Restam 11 meses</span>
      </button>

      <button class="btn-ghost" id="btnLaunchSelectedPeriod" style="padding:10px 14px; font-size:12px; display:flex; align-items:center; justify-content:center; gap:6px; width:100%; border-radius:10px;">
        📅 Lançar no Período Selecionado (<span id="launchSelectedPeriodLabel">Mês Atual</span>)
      </button>

      <button class="btn-ghost" id="btnResetRecCount" style="padding:8px 12px; font-size:11.5px; color:var(--text-dim); display:none; align-items:center; justify-content:center; gap:6px; width:100%;">
        🔄 Reiniciar Contagem de Meses Lançados
      </button>
    </div>

    <div class="modal-actions" style="margin-top:14px;">
      <button id="launchRecCancelBtn" style="width:100%;">Fechar</button>
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
    <div class="field"><label>Nome Completo</label><input id="userAdminName" placeholder="Ex: Paulo Lima"></div>
    <div class="field"><label>E-mail de Acesso</label><input id="userAdminEmail" disabled style="opacity:0.6;" placeholder="email@exemplo.com"></div>
    <div class="field"><label>Perfil de Acesso</label>
      <select id="userAdminRole"><option value="Usuário">Usuário</option><option value="Administrador">Administrador</option></select>
    </div>
    <div class="field">
      <label>Senha de Acesso</label>
      <p class="cfg-hint" id="userAdminPasswordHint" style="margin:-2px 0 8px;">Deixe em branco para manter a senha atual</p>
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

<!-- Modal Abrir Nova Ordem de Serviço (Público / Tela de Login) -->
<div class="overlay" id="overlayNovaOrdem" onclick="if(event.target===this) closeNovaOrdemModal()">
  <div class="modal" style="max-width:560px; border-radius:28px; border:1.5px solid rgba(255,255,255,0.16); border-top:1.5px solid rgba(255,255,255,0.42); border-left:1.5px solid rgba(255,255,255,0.22); background:linear-gradient(145deg, rgba(30,41,65,0.68) 0%, rgba(15,23,42,0.86) 45%, rgba(8,12,26,0.96) 100%); backdrop-filter:blur(40px) saturate(210%); -webkit-backdrop-filter:blur(40px) saturate(210%); box-shadow:0 35px 90px rgba(0,0,0,0.95), 0 0 55px rgba(59,130,246,0.22), inset 0 1.5px 2px rgba(255,255,255,0.38); position:relative; overflow:hidden;">
    <button class="close-x" type="button" onclick="closeNovaOrdemModal()">✕</button>

    <!-- Abas de Navegação: Abrir Ordem de Serviço OS vs Consulta de OS -->
    <div class="os-tabs-nav">
      <button type="button" id="tabBtnNovaOrdem" class="os-tab-btn active" onclick="switchOsModalTab('abrir')">
        ⚡ Abrir Ordem de Serviço OS
      </button>
      <button type="button" id="tabBtnConsultarOrdem" class="os-tab-btn" onclick="switchOsModalTab('consultar')">
        🔍 Consulta de OS
      </button>
    </div>

    <div id="boxNovaOrdemForm">
      <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:999px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#93C5FD; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">
        <span style="width:6px; height:6px; border-radius:50%; background:#3B82F6; box-shadow:0 0 8px #3B82F6;"></span>
        <span>Suporte Técnico & Chamados</span>
      </div>
      <h2 style="font-size:20px; font-weight:900; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
        Abrir Ordem de Serviço (O.S.)
      </h2>
      <p style="font-size:13px; color:var(--text-dim); margin:0 0 18px 0; line-height:1.45;">
        Envie sua solicitação para a equipe técnica. Você receberá um protocolo único para acompanhamento.
      </p>

      <form id="formNovaOrdem" onsubmit="enviarNovaOrdem(event)">
        <div class="field-row" style="display:flex; gap:12px;">
          <div class="field" style="flex:1;">
            <label>Seu Nome Completo *</label>
            <input id="osClientName" required placeholder="Ex: Paulo Lima">
          </div>
          <div class="field" style="flex:1;">
            <label>Seu E-mail de Contato *</label>
            <input id="osClientEmail" type="email" required placeholder="seu.email@exemplo.com">
          </div>
        </div>

        <div class="field-row" style="display:flex; gap:12px;">
          <div class="field" style="flex:1;">
            <label>Tipo de Serviço *</label>
            <select id="osServiceType" required>
              <option value="Melhoria no Sistema">⚡ Sugestão de Melhoria no Sistema</option>
              <option value="Reset de Senha">🔑 Reset / Recuperação de Senha</option>
              <option value="Correção de Dados">🛠️ Correção de Dados Cadastrais/Financeiros</option>
              <option value="Relato de Bug">🐛 Relato de Bug ou Erro</option>
              <option value="Outro Suporte">💬 Outro Chamado Técnico</option>
            </select>
          </div>
          <div class="field" style="flex:1;">
            <label>Nível de Prioridade</label>
            <select id="osPriority">
              <option value="Normal">🟢 Normal</option>
              <option value="Alta">🟡 Alta</option>
              <option value="Urgente">🔴 Urgente</option>
            </select>
          </div>
        </div>

        <div class="field">
          <label>Assunto Resumido *</label>
          <input id="osTitle" required placeholder="Ex: Solicito ajuste no cálculo do gráfico ou reset de senha">
        </div>

        <div class="field">
          <label>Descrição Detalhada do Pedido *</label>
          <textarea id="osDescription" rows="4" required style="width:100%; border-radius:12px; padding:10px 12px; background:var(--input-bg, rgba(0,0,0,0.3)); border:1px solid var(--card-border); color:var(--text); font-family:inherit; font-size:13px; resize:vertical;" placeholder="Explique com detalhes o que precisa ser feito ou corrigido..."></textarea>
        </div>

        <div id="osFormFeedback" style="display:none; padding:10px 14px; border-radius:10px; font-size:12px; font-weight:700; margin-bottom:14px;"></div>

        <div class="modal-actions" style="margin-top:16px;">
          <button type="button" onclick="closeNovaOrdemModal()">Cancelar</button>
          <button type="submit" class="save" id="btnSubmitOs" style="background:linear-gradient(135deg, #3B82F6, #1D4ED8); font-weight:800; border:1px solid rgba(255,255,255,0.25);">
            Enviar Ordem de Serviço 🚀
          </button>
        </div>
      </form>
    </div>

    <!-- Tela de Sucesso após Abertura -->
    <div id="boxNovaOrdemSuccess" style="display:none; text-align:center; padding:12px 6px;">
      <div style="width:56px; height:56px; border-radius:50%; background:linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.35)); border:2px solid #10B981; color:#34D399; font-size:26px; display:inline-flex; align-items:center; justify-content:center; margin-bottom:14px; box-shadow:0 0 24px rgba(16,185,129,0.4);">
        ✓
      </div>
      <h3 style="font-size:20px; font-weight:900; margin-bottom:6px;">Ordem de Serviço Aberta!</h3>
      <p style="font-size:13px; color:var(--text-dim); margin-bottom:18px;">
        Sua solicitação foi registrada no sistema e já está disponível para análise da equipe de administração.
      </p>

      <div style="background:rgba(255,255,255,0.05); border:1px solid rgba(59,130,246,0.35); border-radius:16px; padding:16px; margin-bottom:20px;">
        <span style="font-size:11px; font-weight:800; text-transform:uppercase; color:#94A3B8; letter-spacing:0.06em; display:block; margin-bottom:4px;">Número do Protocolo</span>
        <div style="font-size:22px; font-weight:900; color:#60A5FA; letter-spacing:0.04em;" id="osSuccessProtocol">OS-000000</div>
        <div style="display:flex; justify-content:center; gap:8px; margin-top:10px; flex-wrap:wrap;">
          <button type="button" onclick="copyOsProtocol()" style="background:rgba(59,130,246,0.2); border:1px solid rgba(96,165,250,0.4); color:#BFDBFE; font-size:12px; font-weight:700; border-radius:8px; padding:6px 14px; cursor:pointer;">📋 Copiar Protocolo</button>
          <button type="button" onclick="consultarProtocoloRecente()" style="background:rgba(16,185,129,0.2); border:1px solid rgba(52,211,153,0.4); color:#A7F3D0; font-size:12px; font-weight:700; border-radius:8px; padding:6px 14px; cursor:pointer;">🔍 Visualizar Chamado</button>
        </div>
      </div>

      <button type="button" class="btn-auth-primary" onclick="closeNovaOrdemModal()" style="width:100%; height:42px;">
        Concluir e Voltar
      </button>
    </div>

    <!-- Aba de Consulta de O.S. Aberta por Nome ou E-mail -->
    <div id="boxConsultarOrdem" style="display:none;">
      <div style="display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:999px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#93C5FD; font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.06em; margin-bottom:12px;">
        <span style="width:6px; height:6px; border-radius:50%; background:#3B82F6; box-shadow:0 0 8px #3B82F6;"></span>
        <span>Acompanhamento de Chamados</span>
      </div>
      <h2 style="font-size:20px; font-weight:900; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
        Consulta de OS
      </h2>
      <p style="font-size:13px; color:var(--text-dim); margin:0 0 16px 0; line-height:1.45;">
        Consulte suas solicitações informando seu <strong>Nome Completo</strong> ou seu <strong>E-mail</strong> cadastrado.
      </p>

      <form id="formConsultarOrdem" onsubmit="executarConsultaOrdens(event)" style="margin-bottom:16px;">
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <div style="flex:1; min-width:240px; position:relative;">
            <input id="osConsultarQuery" required placeholder="Digite seu Nome ou E-mail cadastrado..." style="width:100%; height:44px; border-radius:12px; padding:0 14px; background:var(--input-bg, rgba(0,0,0,0.3)); border:1px solid var(--card-border); color:var(--text); font-size:13px; font-weight:600;">
          </div>
          <button type="submit" id="btnExecutarConsultaOs" style="height:44px; padding:0 18px; border-radius:12px; background:linear-gradient(135deg, #3B82F6, #1D4ED8); color:#FFFFFF; font-size:13px; font-weight:800; border:1px solid rgba(255,255,255,0.2); cursor:pointer; display:flex; align-items:center; gap:6px; box-shadow:0 4px 14px rgba(59,130,246,0.35);">
            🔍 Buscar O.S.
          </button>
        </div>
      </form>

      <div id="osConsultarFeedback" style="display:none; padding:12px 14px; border-radius:12px; font-size:12.5px; font-weight:700; margin-bottom:14px;"></div>

      <div id="osConsultarResultados" style="max-height:360px; overflow-y:auto; padding-right:4px;">
        <div style="text-align:center; padding:30px 14px; color:var(--text-dim); font-size:12.5px;">
          <div style="font-size:32px; margin-bottom:8px;">🔎</div>
          Digite seu Nome ou E-mail acima para consultar o status de suas solicitações em tempo real.
        </div>
      </div>
    </div>

  </div>
</div>

<!-- Modal Visualizar e Atender Ordem de Serviço (Administrador) -->
<div class="overlay" id="overlayOrdemAdmin" onclick="if(event.target===this) closeOrdemAdminModal()">
  <div class="modal" style="max-width:600px; border-radius:24px; border:1px solid rgba(59, 130, 246, 0.35); box-shadow:0 24px 60px rgba(0,0,0,0.85);">
    <button class="close-x" type="button" onclick="closeOrdemAdminModal()">✕</button>
    
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; gap:12px; flex-wrap:wrap;">
      <div>
        <div style="display:inline-flex; align-items:center; gap:6px; padding:3px 10px; border-radius:999px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#93C5FD; font-size:11px; font-weight:800; margin-bottom:6px;">
          <span id="osAdminProtocolBadge">#OS-000000</span>
        </div>
        <h2 style="font-size:19px; font-weight:900; margin:0;" id="osAdminTitle">Título da Solicitação</h2>
        <span style="font-size:12px; color:var(--text-dim);" id="osAdminDate">Aberta em: --/--/----</span>
      </div>
      <div id="osAdminPriorityBadge" style="padding:5px 12px; border-radius:999px; font-size:11.5px; font-weight:800;">Normal</div>
    </div>

    <!-- Informações do Solicitante -->
    <div style="background:rgba(255,255,255,0.03); border:1px solid var(--card-border); border-radius:14px; padding:14px; margin-bottom:14px; display:grid; grid-template-columns:1fr 1fr; gap:10px;">
      <div>
        <span style="font-size:11px; color:var(--text-dim); display:block; text-transform:uppercase; font-weight:700;">Solicitante</span>
        <strong style="font-size:13.5px; color:var(--text);" id="osAdminClientName">Nome</strong>
      </div>
      <div>
        <span style="font-size:11px; color:var(--text-dim); display:block; text-transform:uppercase; font-weight:700;">E-mail</span>
        <a href="#" id="osAdminClientEmail" style="font-size:13px; color:#60A5FA; text-decoration:none;">email@exemplo.com</a>
      </div>
      <div style="grid-column:1 / -1;">
        <span style="font-size:11px; color:var(--text-dim); display:block; text-transform:uppercase; font-weight:700;">Tipo de Serviço</span>
        <span style="font-size:13px; color:#E2E8F0; font-weight:600;" id="osAdminServiceType">Melhoria</span>
      </div>
    </div>

    <!-- Descrição Completa -->
    <div class="field" style="margin-bottom:16px;">
      <label style="font-weight:700; color:var(--text-dim);">Descrição do Chamado:</label>
      <div id="osAdminDescription" style="background:rgba(0,0,0,0.25); border:1px solid var(--card-border); border-radius:12px; padding:12px; font-size:13px; line-height:1.5; color:#F8FAFC; white-space:pre-wrap; max-height:160px; overflow-y:auto;"></div>
    </div>

    <!-- Área de Resolução e Status (Admin) -->
    <div style="border-top:1px solid var(--card-border); padding-top:14px; margin-top:14px;">
      <h3 style="font-size:14px; font-weight:800; margin-bottom:12px; color:#93C5FD;">⚙️ Atendimento do Administrador</h3>
      
      <div class="field">
        <label>Status do Chamado:</label>
        <select id="osAdminStatusSelect" style="font-weight:700;">
          <option value="Pendente">⏳ Pendente (Aguardando Análise)</option>
          <option value="Em Andamento">⚙️ Em Andamento (Em Atendimento)</option>
          <option value="Concluído">✅ Concluído (Finalizado)</option>
          <option value="Cancelado">❌ Cancelado / Recusado</option>
        </select>
      </div>

      <div class="field">
        <label>Parecer / Observações do Administrador:</label>
        <textarea id="osAdminNotes" rows="3" placeholder="Ex: Senha resetada para o padrão inicial e enviada ao e-mail, ou melhoria implantada..." style="width:100%; border-radius:12px; padding:10px 12px; background:var(--input-bg, rgba(0,0,0,0.3)); border:1px solid var(--card-border); color:var(--text); font-family:inherit; font-size:13px; resize:vertical;"></textarea>
      </div>
    </div>

    <input type="hidden" id="osAdminCurrentId">

    <div class="modal-actions" style="display:flex; justify-content:space-between; align-items:center; margin-top:16px;">
      <button type="button" class="btn-ghost" onclick="excluirOrdemAdmin()" style="color:#F87171; border-color:rgba(239,68,68,0.3);">🗑️ Excluir O.S.</button>
      <div style="display:flex; gap:10px;">
        <button type="button" onclick="closeOrdemAdminModal()">Fechar</button>
        <button type="button" class="save" onclick="salvarOrdemAdmin()" style="background:linear-gradient(135deg, #10B981, #059669); font-weight:800;">Salvar Atualização ✓</button>
      </div>
    </div>
  </div>
</div>

<div class="toast" id="toast"><span class="d"></span><span id="toastMsg">Salvo com sucesso!</span></div>

<div class="login-success-overlay" id="loginSuccessOverlay" role="dialog" aria-modal="true">
  <div class="login-success-box">
    <div class="auth-ambient-glow glow-blue"></div>
    <div class="login-success-check">
      <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" fill="none"/><path fill="none" d="M14 27l7 7 17-17"/></svg>
    </div>
    <div class="auth-modal-badge auth-badge-success">
      <span class="auth-badge-dot"></span>
      <span>Acesso Autorizado</span>
    </div>
    <h3 id="loginSuccessTitle">Login efetuado com sucesso!</h3>
    <p id="loginSuccessMsg">Redirecionando para o seu painel financeiro...</p>
    <div class="login-success-progress-bar">
      <div class="login-success-progress-fill"></div>
    </div>
  </div>
</div>

<div class="login-success-overlay" id="accountDisabledOverlay" role="dialog" aria-modal="true">
  <div class="login-success-box">
    <div class="auth-ambient-glow glow-red"></div>
    <div class="account-disabled-icon">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M8 8l8 8M16 8l-8 8"/></svg>
    </div>
    <div class="auth-modal-badge auth-badge-error">
      <span class="auth-badge-dot"></span>
      <span>Acesso Restrito</span>
    </div>
    <h3>Usuário desativado</h3>
    <p id="accountDisabledMsg">Seu usuário foi desativado pelo administrador. Entre em contato para mais informações.</p>
    <button type="button" class="account-disabled-btn" id="accountDisabledCloseBtn" onclick="hideAccountDisabledPopup()">Entendi</button>
  </div>
</div>

<div class="login-success-overlay" id="logoutSuccessOverlay" role="dialog" aria-modal="true" onclick="if(event.target===this) hideLogoutPopup()">
  <div class="login-success-box logout-box">
    <div class="auth-ambient-glow glow-emerald"></div>
    <div class="logout-success-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
        <polyline points="16 17 21 12 16 7"></polyline>
        <line x1="21" y1="12" x2="9" y2="12"></line>
      </svg>
    </div>
    <div class="auth-modal-badge auth-badge-logout">
      <span class="auth-badge-dot"></span>
      <span>Sessão Finalizada com Sucesso</span>
    </div>
    <h3>Sessão Encerrada</h3>
    <p id="logoutSuccessMsg">Você saiu da sua conta com segurança. Suas informações estão salvas e protegidas no banco de dados.</p>
    <button type="button" class="logout-btn-action" id="logoutSuccessCloseBtn" onclick="hideLogoutPopup()">
      <span>Fazer Login Novamente</span>
      <svg class="logout-btn-arrow" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clip-rule="evenodd"/>
      </svg>
    </button>
    <div class="logout-timer-bar" title="Fechamento automático">
      <div class="logout-timer-progress" id="logoutTimerProgress"></div>
    </div>
  </div>
</div>

<script>
/* ==================== Gerenciamento de LocalStorage e Servidor ==================== */
function getApiBaseUrl() {
  try {
    if (typeof window !== 'undefined' && window.location) {
      const orig = window.location.origin;
      if (orig && orig.startsWith('http') && !orig.includes(':5500') && !orig.includes(':5501')) {
        return orig;
      }
    }
  } catch(e){}
  return 'http://localhost:3000';
}

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

let registeredUsers = loadFromStorage('nexus_users', []);

// Alternador de Abas de Autenticação (Entrar / Criar Conta / Acessos & Logon)
window.switchAuthTab = function(tab) {
  if (window.clearAuthFeedback) {
    window.clearAuthFeedback('login');
    window.clearAuthFeedback('register');
    window.clearAuthFeedback('forgot');
  }
  const loginBox = document.getElementById('loginBox');
  const regBox = document.getElementById('registerBox');
  const forgotBox = document.getElementById('forgotBox');
  const usersBox = document.getElementById('usersBox');
  const tabsNav = document.getElementById('authTabsNav');
  const tabLogin = document.getElementById('tabBtnLogin');
  const tabReg = document.getElementById('tabBtnRegister');
  const tabUsers = document.getElementById('tabBtnUsers');
  const subTitle = document.getElementById('authBoxSubtitle');

  if (tabLogin) tabLogin.classList.remove('active');
  if (tabReg) tabReg.classList.remove('active');
  if (tabUsers) tabUsers.classList.remove('active');

  if (tab === 'register') {
    if (loginBox) loginBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'none';
    if (regBox) regBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'flex';
    if (tabReg) tabReg.classList.add('active');
    if (subTitle) subTitle.textContent = 'Crie sua conta para começar a gerenciar suas finanças';
  } else if (tab === 'users') {
    if (loginBox) loginBox.style.display = 'none';
    if (regBox) regBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'flex';
    if (tabUsers) tabUsers.classList.add('active');
    if (subTitle) subTitle.textContent = 'Selecione um usuário cadastrado para logon imediato';
    carregarUsuariosLogonServer();
  } else if (tab === 'forgot') {
    if (loginBox) loginBox.style.display = 'none';
    if (regBox) regBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'none';
    if (subTitle) subTitle.textContent = 'Recuperação segura de acesso';
  } else {
    if (regBox) regBox.style.display = 'none';
    if (forgotBox) forgotBox.style.display = 'none';
    if (usersBox) usersBox.style.display = 'none';
    if (loginBox) loginBox.style.display = 'block';
    if (tabsNav) tabsNav.style.display = 'flex';
    if (tabLogin) tabLogin.classList.add('active');
    if (subTitle) subTitle.textContent = 'Plataforma Inteligente de Gestão Financeira';
  }
};

let listaUsuariosCadastradosServer = [];

window.carregarUsuariosLogonServer = async function() {
  const container = document.getElementById('usersListLogonContainerServer');
  const badgeCount = document.getElementById('registeredUsersBadgeCountServer');
  if (container) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--auth-text-dim); font-size:12px;">Carregando usuários cadastrados...</div>';
  }

  try {
    const res = await fetch(window.location.origin + '/api/users');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        listaUsuariosCadastradosServer = data;
      }
    }
  } catch(e) {}

  if (!listaUsuariosCadastradosServer || listaUsuariosCadastradosServer.length === 0) {
    listaUsuariosCadastradosServer = registeredUsers || [
      { name: 'Paulo Lima', email: 'admin@nexusfinanceiro.com', role: 'Administrador', active: true }
    ];
  }

  if (badgeCount) {
    badgeCount.textContent = listaUsuariosCadastradosServer.length;
  }

  renderUsuariosLogonServer(listaUsuariosCadastradosServer);
};

window.renderUsuariosLogonServer = function(users) {
  const container = document.getElementById('usersListLogonContainerServer');
  if (!container) return;

  if (!users || users.length === 0) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--auth-text-dim); font-size:12px;">Nenhum usuário cadastrado encontrado.</div>';
    return;
  }

  let html = '';
  users.forEach((u) => {
    const name = u.name || 'Usuário';
    const email = u.email || '';
    const role = u.role || 'Usuário';
    const isAdmin = role === 'Administrador';
    const initials = name.trim().split(/\\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
    const passSafe = u.password ? u.password.replace(/'/g, "\\\\'") : '';

    html += \`
      <div style="padding:10px 12px; border-radius:12px; background:var(--card-bg, rgba(255,255,255,0.04)); border:1px solid var(--auth-border); display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="display:flex; align-items:center; gap:10px; min-width:0;">
          <div style="width:34px; height:34px; border-radius:50%; background:\${isAdmin ? 'linear-gradient(135deg, #F59E0B, #B45309)' : 'linear-gradient(135deg, #3B82F6, #1D4ED8)'}; color:#fff; font-weight:800; font-size:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
            \${initials}
          </div>
          <div style="min-width:0;">
            <div style="display:flex; align-items:center; gap:6px;">
              <strong style="font-size:13px; color:var(--auth-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${name}</strong>
              <span style="font-size:9.5px; font-weight:800; padding:1px 5px; border-radius:4px; text-transform:uppercase; background:\${isAdmin ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'}; color:\${isAdmin ? '#FBBF24' : '#60A5FA'};">\${role}</span>
            </div>
            <div style="font-size:11.5px; color:var(--auth-text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${email}</div>
          </div>
        </div>
        <button type="button" onclick="selecionarUsuarioParaLogonServer('\${email}', '\${passSafe}', '\${name.replace(/'/g, "\\\\'")}')" style="padding:6px 10px; border-radius:8px; font-size:11px; font-weight:800; background:rgba(245,158,11,0.15); color:var(--auth-gold); border:1px solid rgba(245,158,11,0.4); cursor:pointer; flex-shrink:0;">
          ⚡ Logon
        </button>
      </div>
    \`;
  });

  container.innerHTML = html;
};

window.filtrarUsuariosLogonServer = function(query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    renderUsuariosLogonServer(listaUsuariosCadastradosServer);
    return;
  }
  const filtrados = listaUsuariosCadastradosServer.filter(u => 
    (u.name && u.name.toLowerCase().includes(q)) || 
    (u.email && u.email.toLowerCase().includes(q)) ||
    (u.role && u.role.toLowerCase().includes(q))
  );
  renderUsuariosLogonServer(filtrados);
};

window.selecionarUsuarioParaLogonServer = function(email, pass, name) {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  if (emailInput) emailInput.value = email;
  if (passInput && pass) passInput.value = pass;

  window.switchAuthTab('login');

  const submitBtn = document.getElementById('loginSubmitBtn');
  if (submitBtn) submitBtn.focus();
};

window.showAuthFeedback = function(box, type, title, message, actionHtml) {
  const banner = document.getElementById(box + 'FeedbackBanner');
  if (!banner) return;

  banner.className = 'auth-feedback-banner ' + (type || 'error');
  const icon = type === 'success' ? '✅' : (type === 'warning' ? '⚠️' : '❌');

  banner.innerHTML = \`
    <span style="font-size:18px; line-height:1; flex-shrink:0; margin-top:2px;">\${icon}</span>
    <div style="flex:1;">
      <strong style="display:block; font-size:13.5px; font-weight:800; margin-bottom:2px; letter-spacing:-0.01em;">\${title}</strong>
      <span style="font-size:12.5px; opacity:0.95; line-height:1.4;">\${message}</span>
      \${actionHtml ? \`<div style="margin-top:8px;">\${actionHtml}</div>\` : ''}
    </div>
  \`;
  banner.style.display = 'flex';
};

window.clearAuthFeedback = function(box) {
  const banner = document.getElementById(box + 'FeedbackBanner');
  if (banner) banner.style.display = 'none';
  const emailWrap = document.getElementById('wrapLoginEmail');
  const passWrap = document.getElementById('wrapLoginPass');
  if (emailWrap) emailWrap.classList.remove('input-error');
  if (passWrap) passWrap.classList.remove('input-error');
};

window.switchToRegisterWithEmail = function(email) {
  window.switchAuthTab('register');
  const em = email || (document.getElementById('loginEmail') ? document.getElementById('loginEmail').value.trim() : '');
  const regEmailInput = document.getElementById('regEmail');
  if (regEmailInput) {
    if (em) regEmailInput.value = em;
    regEmailInput.focus();
  }
};

window.switchToForgotTab = function() {
  window.switchAuthTab('forgot');
};

// Alternador de Tema na Tela de Login
window.toggleAuthTheme = function() {
  const isLight = document.body.classList.contains('light') || document.documentElement.classList.contains('light');
  const nextLight = !isLight;
  document.body.classList.toggle('light', nextLight);
  document.documentElement.classList.toggle('light', nextLight);
  localStorage.setItem('nexus_theme', nextLight ? 'light' : 'dark');

  const icon = document.getElementById('authThemeIcon');
  if (icon) {
    if (nextLight) {
      icon.innerHTML = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M22 12h-2"/><path d="m4.93 19.07 1.41-1.41"/><path d="m17.66 6.34 1.41-1.41"/>';
    } else {
      icon.innerHTML = '<path d="M12 3a6 6 0 0 0 9 9 9 0 1 1-9-9Z"/>';
    }
  }
};

// Mostrar/Ocultar Senha do Login (Visualização Clara do Olho)
window.togglePasswordVisibility = function(inputId, btnId) {
  const input = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!input || !btn) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    btn.title = 'Ocultar Senha';
    btn.setAttribute('aria-label', 'Ocultar Senha');
  } else {
    input.type = 'password';
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    btn.title = 'Visualizar Senha';
    btn.setAttribute('aria-label', 'Visualizar Senha');
  }
};

// Alternância de Visibilidade Unificada das Senhas no Cadastro (Olho Único que Revela Ambos os Campos)
window.toggleRegisterBothPasswords = function(btnId) {
  const p1 = document.getElementById('regPassword');
  const p2 = document.getElementById('regConfirmPassword');
  const btn = document.getElementById(btnId || 'toggleRegPassBtn');
  if (!p1) return;
  const isPassword = (p1.type === 'password');
  const nextType = isPassword ? 'text' : 'password';
  p1.type = nextType;
  if (p2) p2.type = nextType;
  if (btn) {
    if (isPassword) {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      btn.title = 'Ocultar Senhas';
      btn.setAttribute('aria-label', 'Ocultar Senhas');
    } else {
      btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
      btn.title = 'Visualizar Senhas';
      btn.setAttribute('aria-label', 'Visualizar Senhas');
    }
  }
};
window.toggleRegistrationPasswords = window.toggleRegisterBothPasswords;

// Detecção de Caps Lock no Login
document.addEventListener('keydown', function(e) {
  const capsWarn = document.getElementById('capsLockWarningLogin');
  if (capsWarn && e.getModifierState) {
    capsWarn.style.display = e.getModifierState('CapsLock') ? 'flex' : 'none';
  }
});
document.addEventListener('keyup', function(e) {
  const capsWarn = document.getElementById('capsLockWarningLogin');
  if (capsWarn && e.getModifierState) {
    capsWarn.style.display = e.getModifierState('CapsLock') ? 'flex' : 'none';
  }
});

async function syncUsersWithServer() {
  const apiBase = getApiBaseUrl();
  try {
    let res = await fetch(apiBase + '/api/users');
    if (!res.ok && apiBase !== 'http://localhost:3000') {
      try { res = await fetch('http://localhost:3000/api/users'); } catch(e){}
    }
    if (res && res.ok) {
      const usersData = await res.json();
      if (Array.isArray(usersData) && usersData.length > 0) {
        registeredUsers = usersData;
        saveToStorage('nexus_users', registeredUsers);
        if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();
        return;
      }
    }
  } catch(e) {
    if (apiBase !== 'http://localhost:3000') {
      try {
        const fallbackRes = await fetch('http://localhost:3000/api/users');
        if (fallbackRes.ok) {
          const usersData = await fallbackRes.json();
          if (Array.isArray(usersData) && usersData.length > 0) {
            registeredUsers = usersData;
            saveToStorage('nexus_users', registeredUsers);
            if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();
            return;
          }
        }
      } catch(retryErr){}
    }
    console.warn('Aviso: operando em modo offline ao sincronizar usuários:', e);
  }
  const cached = loadFromStorage('nexus_users', null);
  if (Array.isArray(cached) && cached.length > 0) {
    registeredUsers = cached;
  } else {
    registeredUsers = [
      { id: 1, name: 'Paulo Lima', email: 'admin@nexusfinanceiro.com', password: '86266049', role: 'Administrador', active: true },
      { id: 20, name: 'PAULO DE LIMA PEREIRA', email: 'paulolp0101@gmail.com', password: '86266049', role: 'Usuário', active: true }
    ];
    saveToStorage('nexus_users', registeredUsers);
  }
  if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();
}

// Disparo imediato de sincronização de usuários no carregamento
syncUsersWithServer().catch(() => {});

async function saveUsersToServer() {
  saveToStorage('nexus_users', registeredUsers);
  const apiBase = getApiBaseUrl();
  try {
    await fetch(apiBase + '/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registeredUsers)
    });
  } catch(e){}
}

let currentUser = null;
let isViewingOtherUser = false;
let adminOriginalUser = null;

// Event Listeners das Abas e Tema de Autenticação
const tabLoginBtn = document.getElementById('tabBtnLogin');
if (tabLoginBtn) tabLoginBtn.onclick = () => window.switchAuthTab('login');

const tabRegBtn = document.getElementById('tabBtnRegister');
if (tabRegBtn) tabRegBtn.onclick = () => window.switchAuthTab('register');

const authThemeBtn = document.getElementById('authThemeToggleBtn');
if (authThemeBtn) authThemeBtn.onclick = () => window.toggleAuthTheme();

const loginPassToggle = document.getElementById('loginPasswordToggle') || document.getElementById('toggleLoginPassBtn');
if (loginPassToggle) loginPassToggle.onclick = () => window.togglePasswordVisibility('loginPassword', loginPassToggle.id);

const goForgot = document.getElementById('goForgot');
if (goForgot) goForgot.onclick = (e) => { e.preventDefault(); window.switchAuthTab('forgot'); };

const goLoginFromForgot = document.getElementById('goLoginFromForgot');
if (goLoginFromForgot) goLoginFromForgot.onclick = (e) => { e.preventDefault(); window.switchAuthTab('login'); };

const forgotFormElement = document.getElementById('forgotStep1') || document.getElementById('forgotForm');
if (forgotFormElement) {
  forgotFormElement.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgotEmail') ? document.getElementById('forgotEmail').value.trim() : '';
    const btn = document.getElementById('btnSendPassword');

    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
    }

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

      if (data.mode === 'direct' && data.tempPassword) {
        alert('Sua senha temporária de acesso é: ' + data.tempPassword);
        const passInp = document.getElementById('loginPassword');
        if (passInp) passInp.value = data.tempPassword;
      } else {
        alert('Sua senha foi enviada para o seu e-mail com sucesso!');
      }

      const emailInp = document.getElementById('loginEmail');
      if (emailInp) emailInp.value = email;
      window.switchAuthTab('login');
    } catch(err) {
      alert('Erro ao processar solicitação de e-mail. Verifique suas credenciais SMTP no servidor.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Recuperar Minha Senha →';
      }
    }
  };
}

// Limpa erros em tempo real conforme o usuário digita
const loginEmailEl = document.getElementById('loginEmail');
if (loginEmailEl) {
  loginEmailEl.addEventListener('input', () => {
    const wrap = document.getElementById('wrapLoginEmail');
    if (wrap) wrap.classList.remove('input-error');
    const banner = document.getElementById('loginFeedbackBanner');
    if (banner && banner.style.display !== 'none') banner.style.display = 'none';
  });
}
const loginPasswordEl = document.getElementById('loginPassword');
if (loginPasswordEl) {
  loginPasswordEl.addEventListener('input', () => {
    const wrap = document.getElementById('wrapLoginPass');
    if (wrap) wrap.classList.remove('input-error');
    const banner = document.getElementById('loginFeedbackBanner');
    if (banner && banner.style.display !== 'none') banner.style.display = 'none';
  });
}

// Login direto contra o PostgreSQL / API com Validação Precisa em Tela e Fallback Offline
window.handleLoginSubmit = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (window.clearAuthFeedback) window.clearAuthFeedback('login');

  const emailInput = document.getElementById('loginEmail');
  const passwordInput = document.getElementById('loginPassword');
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const submitBtn = document.getElementById('loginSubmitBtn') || document.querySelector('#loginForm button[type="submit"]') || document.querySelector('#authLoginForm button[type="submit"]');
  const emailWrap = document.getElementById('wrapLoginEmail');
  const passWrap = document.getElementById('wrapLoginPass');

  if (!email) {
    if (emailWrap) emailWrap.classList.add('input-error');
    if (emailInput) emailInput.focus();
    window.showAuthFeedback('login', 'error', 'E-mail não informado', 'Por favor, digite o seu endereço de e-mail para acessar sua conta.');
    return;
  }

  // Validação do formato do e-mail
  const isValidEmail = (str) => {
    if (!str || typeof str !== 'string') return false;
    const at = str.indexOf('@');
    const dot = str.lastIndexOf('.');
    return at > 0 && dot > at + 1 && dot < str.length - 1 && !str.includes(' ');
  };
  if (!isValidEmail(email)) {
    if (emailWrap) emailWrap.classList.add('input-error');
    if (emailInput) emailInput.focus();
    window.showAuthFeedback('login', 'error', 'E-mail em formato inválido', 'O e-mail digitado parece incompleto ou inválido. Exemplo: <strong>seu.nome@gmail.com</strong>');
    return;
  }
  
  const cleanEmail = email.toLowerCase().trim();
  const apiBase = getApiBaseUrl();
  let res = null;
  let data = null;

  try {
    res = await fetch(apiBase + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password })
    });
    data = await res.json();
  } catch (fetchErr) {
    if (apiBase !== 'http://localhost:3000') {
      try {
        res = await fetch('http://localhost:3000/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail, password })
        });
        data = await res.json();
      } catch (retryErr) {}
    }
  }

  if (res && data) {
    if (!res.ok || !data.success) {
      if (data.errorType === 'user_not_found') {
        if (emailWrap) emailWrap.classList.add('input-error');
        if (emailInput) emailInput.focus();
        window.showAuthFeedback(
          'login',
          'warning',
          'Usuário não cadastrado',
          'Não encontramos nenhuma conta cadastrada para o e-mail <strong>' + cleanEmail + '</strong>.',
          '<button type="button" onclick="window.switchToRegisterWithEmail()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:12px; font-weight:800; background:linear-gradient(135deg, rgba(245,158,11,0.22) 0%, rgba(217,119,6,0.32) 100%); border:1px solid rgba(245,158,11,0.55); color:#FEF3C7; border-radius:9px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25);">Criar Conta com este E-mail →</button>'
        );
      } else if (data.errorType === 'invalid_password') {
        if (passWrap) passWrap.classList.add('input-error');
        if (passwordInput) {
          passwordInput.select();
          passwordInput.focus();
        }
        window.showAuthFeedback(
          'login',
          'error',
          'Senha incorreta',
          'A senha digitada está incorreta para este e-mail. Verifique se o Caps Lock está ativado ou recupere o acesso.',
          '<button type="button" onclick="window.switchToForgotTab()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:12px; font-weight:800; background:rgba(255,255,255,0.12); border:1px solid rgba(255,255,255,0.30); color:#FFFFFF; border-radius:9px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25);">Esqueci Minha Senha →</button>'
        );
      } else if (data.errorType === 'user_inactive') {
        window.showAuthFeedback('login', 'error', 'Conta desativada', data.error || 'Seu usuário foi desativado pelo administrador.');
      } else {
        window.showAuthFeedback('login', 'error', 'Falha na autenticação', data.error || 'E-mail ou senha incorretos.');
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Entrar na Conta →';
      }
      return;
    }

    currentUser = data.user;
    saveToStorage('nexus_session', { email: currentUser.email });
    saveToStorage('nexus_cached_user', currentUser);
    saveToStorage('nexus_token', data.token || ('token_' + Date.now()));
    
    document.documentElement.classList.add('user-logged-in');
    if (currentUser.role === 'Administrador') {
      document.documentElement.classList.add('is-admin');
      currentPage = 'usuarios';
    } else {
      document.documentElement.classList.remove('is-admin');
      currentPage = 'dashboard';
    }

    await loadUserData();
    showLoginSuccessPopup('Redirecionando para o seu sistema...');
    setTimeout(() => {
      document.getElementById('authPage').classList.remove('show');
      document.getElementById('authPage').style.display = 'none';
      document.getElementById('appMain').classList.add('show');
      document.getElementById('appMain').style.display = 'flex';
      render();
    }, 1200);
    return;
  }

  // Fallback offline caso API esteja totalmente inacessível
  await syncUsersWithServer();
  const existingUser = registeredUsers.find(u => u && u.email && u.email.toLowerCase() === cleanEmail);
  if (!existingUser) {
    if (emailWrap) emailWrap.classList.add('input-error');
    if (emailInput) emailInput.focus();
    window.showAuthFeedback(
      'login',
      'warning',
      'Usuário não cadastrado',
      'Não encontramos nenhuma conta cadastrada para o e-mail <strong>' + cleanEmail + '</strong>.',
      '<button type="button" onclick="window.switchToRegisterWithEmail()" style="display:inline-flex; align-items:center; gap:6px; padding:7px 14px; font-size:12px; font-weight:800; background:linear-gradient(135deg, rgba(245,158,11,0.22) 0%, rgba(217,119,6,0.32) 100%); border:1px solid rgba(245,158,11,0.55); color:#FEF3C7; border-radius:9px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25);">Criar Conta com este E-mail →</button>'
    );
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Entrar na Conta →'; }
    return;
  }

  currentUser = { id: existingUser.id || Date.now(), name: existingUser.name || cleanEmail.split('@')[0], email: cleanEmail, role: existingUser.role || 'Usuário' };
  saveToStorage('nexus_session', { email: currentUser.email });
  saveToStorage('nexus_cached_user', currentUser);
  saveToStorage('nexus_token', 'offline_token_' + Date.now());

  document.documentElement.classList.add('user-logged-in');
  currentPage = (currentUser.role === 'Administrador') ? 'usuarios' : 'dashboard';
  await loadUserData();
  showLoginSuccessPopup('Acesso offline autenticado!');
  setTimeout(() => {
    document.getElementById('authPage').classList.remove('show');
    document.getElementById('authPage').style.display = 'none';
    document.getElementById('appMain').classList.add('show');
    document.getElementById('appMain').style.display = 'flex';
    render();
  }, 1200);

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar na Conta →';
  }
};

const loginFormElement = document.getElementById('loginForm') || document.getElementById('authLoginForm');
if (loginFormElement) {
  loginFormElement.onsubmit = window.handleLoginSubmit;
}

function getGreetingTime() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return { text: 'Bom dia', icon: '☀️' };
  if (h >= 12 && h < 18) return { text: 'Boa tarde', icon: '🌤️' };
  return { text: 'Boa noite', icon: '🌙' };
}

function getFormattedToday() {
  const d = new Date();
  const weekDays = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return weekDays[d.getDay()] + ', ' + d.getDate() + ' de ' + months[d.getMonth()] + ' de ' + d.getFullYear();
}

function showExecutiveWelcomeToast(msg, subMsg) {
  let toastEl = document.getElementById('executiveWelcomeToast');
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'executiveWelcomeToast';
    toastEl.className = 'executive-welcome-toast';
    document.body.appendChild(toastEl);
  }
  const userName = currentUser ? currentUser.name : 'Usuário';
  const userRole = currentUser ? (currentUser.role || 'Usuário') : 'Usuário';
  const roleBadge = userRole === 'Administrador' ? '👑 Administrador Master' : '👤 Usuário';
  
  toastEl.innerHTML = \`
    <div class="toast-content-box">
      <div class="toast-icon-wrap">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="m9 12 2 2 4-4"/>
        </svg>
      </div>
      <div class="toast-body">
        <div class="toast-top-row">
          <span class="toast-badge">\${roleBadge}</span>
          <span class="toast-time">Sessão Ativa</span>
        </div>
        <h4 class="toast-title">\${msg || 'Sessão Autenticada com Sucesso'}</h4>
        <p class="toast-desc">\${subMsg || ('Ambiente financeiro sincronizado e protegido para <strong>' + userName + '</strong>.')}</p>
      </div>
      <button type="button" class="toast-close-btn" onclick="document.getElementById('executiveWelcomeToast').classList.remove('show')" title="Fechar">✕</button>
    </div>
    <div class="toast-progress-bar"></div>
  \`;

  requestAnimationFrame(() => {
    toastEl.classList.add('show');
  });

  if (toastEl._timeout) clearTimeout(toastEl._timeout);
  toastEl._timeout = setTimeout(() => {
    if (toastEl) toastEl.classList.remove('show');
  }, 4500);
}

function showLoginSuccessPopup(msg){
  const overlay = document.getElementById('loginSuccessOverlay');
  if(!overlay) return;
  if(msg) {
    const msgEl = document.getElementById('loginSuccessMsg');
    if(msgEl) msgEl.textContent = msg;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight;
  overlay.classList.add('in');
  setTimeout(()=>{
    overlay.classList.remove('in');
    setTimeout(()=>{
      overlay.classList.remove('show');
      overlay.style.display = 'none';
    }, 350);
  }, 2500);
}

function showAccountDisabledPopup(msg){
  const overlay = document.getElementById('accountDisabledOverlay');
  if(!overlay) return;
  if(msg) document.getElementById('accountDisabledMsg').textContent = msg;
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight;
  overlay.classList.add('in');
}
function hideAccountDisabledPopup(){
  const overlay = document.getElementById('accountDisabledOverlay');
  if(!overlay) return;
  overlay.classList.remove('in');
  setTimeout(()=> {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
  }, 300);
}

let logoutTimer = null;
function showLogoutPopup(msg){
  const overlay = document.getElementById('logoutSuccessOverlay');
  if(!overlay) return;
  if(msg) {
    const msgEl = document.getElementById('logoutSuccessMsg');
    if(msgEl) msgEl.textContent = msg;
  }
  overlay.style.display = 'flex';
  overlay.classList.add('show');
  void overlay.offsetHeight;
  overlay.classList.add('in');

  const prog = document.getElementById('logoutTimerProgress');
  if (prog) {
    prog.style.transition = 'none';
    prog.style.width = '100%';
    void prog.offsetHeight;
    prog.style.transition = 'width 4.5s linear';
    prog.style.width = '0%';
  }

  setTimeout(() => {
    const loginEmailInput = document.getElementById('loginEmail');
    if (loginEmailInput) loginEmailInput.focus();
  }, 80);

  if (logoutTimer) clearTimeout(logoutTimer);
  logoutTimer = setTimeout(() => {
    hideLogoutPopup();
  }, 4500);

  const box = overlay.querySelector('.logout-box');
  if (box) {
    box.onmouseenter = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      if (prog) {
        const computedWidth = window.getComputedStyle(prog).width;
        prog.style.transition = 'none';
        prog.style.width = computedWidth;
      }
    };
    box.onmouseleave = () => {
      if (logoutTimer) clearTimeout(logoutTimer);
      logoutTimer = setTimeout(() => hideLogoutPopup(), 2500);
    };
  }
}

function hideLogoutPopup(){
  const overlay = document.getElementById('logoutSuccessOverlay');
  if(!overlay) return;
  if (logoutTimer) {
    clearTimeout(logoutTimer);
    logoutTimer = null;
  }
  overlay.classList.remove('in');
  setTimeout(()=> {
    overlay.classList.remove('show');
    overlay.style.display = 'none';
    const loginEmailInput = document.getElementById('loginEmail');
    if (loginEmailInput) loginEmailInput.focus();
  }, 320);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const logoutOverlay = document.getElementById('logoutSuccessOverlay');
    if (logoutOverlay && logoutOverlay.classList.contains('show')) {
      hideLogoutPopup();
    }
  }
});

window.checkServerRegPasswordMatch = function() {
  const p1 = document.getElementById('regPassword') ? document.getElementById('regPassword').value : '';
  const p2 = document.getElementById('regConfirmPassword') ? document.getElementById('regConfirmPassword').value : '';
  const msg = document.getElementById('regPwdMatchMsg');
  if (!msg) return;

  if (!p2) {
    msg.style.display = 'none';
    return;
  }

  msg.style.display = 'flex';
  if (p1 === p2) {
    msg.textContent = '✓ As senhas conferem';
    msg.style.color = '#34d399';
  } else {
    msg.textContent = '✕ As senhas não conferem';
    msg.style.color = '#f87171';
  }
};

// Cadastro com inserção direta no PostgreSQL e fallback resiliente
window.handleRegisterSubmit = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const nameInput = document.getElementById('regName');
  const emailInput = document.getElementById('regEmail');
  const passwordInput = document.getElementById('regPassword');
  const confirmPasswordInput = document.getElementById('regConfirmPassword');

  const name = nameInput ? nameInput.value.trim() : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value.trim() : '';
  const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value.trim() : '';
  const submitBtn = document.getElementById('regSubmitBtn') || document.querySelector('#registerForm button[type="submit"]') || document.querySelector('#authRegisterForm button[type="submit"]');

  const cleanEmail = email.toLowerCase().trim();

  if (!name || !cleanEmail || !password || !confirmPassword) {
    showCustomAlert('Atenção', 'Por favor, preencha todos os campos do formulário, incluindo a confirmação de senha.', 'error');
    return false;
  }

  if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    showCustomAlert('Atenção', 'Por favor, informe um endereço de e-mail válido (ex: seu.email@exemplo.com).', 'error');
    return false;
  }

  if (password.length < 6) {
    showCustomAlert('Atenção', 'A senha deve ter no mínimo 6 caracteres.', 'error');
    return false;
  }

  if (password !== confirmPassword) {
    showCustomAlert('Atenção', 'As senhas não conferem. Por favor, digite a mesma senha nos dois campos.', 'error');
    return false;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Salvando conta...';
  }

  let registerSuccess = false;
  let serverMessage = '';

  const apiBase = getApiBaseUrl();
  let response = null;
  let data = null;

  try {
    try {
      response = await fetch(apiBase + '/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email: cleanEmail, password })
      });
      data = await response.json();
    } catch (e) {
      if (apiBase !== 'http://localhost:3000') {
        try {
          response = await fetch('http://localhost:3000/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email: cleanEmail, password })
          });
          data = await response.json();
        } catch (retryErr) {}
      }
    }

    if (response && response.ok && data && data.success) {
      registerSuccess = true;
      serverMessage = data.message || 'Conta criada e salva no banco de dados com sucesso!';
      await syncUsersWithServer();
    } else if (data && data.error) {
      showCustomAlert('Atenção', data.error, 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Criar Minha Conta →';
      }
      return false;
    } else {
      throw new Error('Falha de comunicação com a API');
    }
  } catch (err) {
    console.warn('[CADASTRO RESILIENTE] Falha na API de registro, salvando localmente:', err.message);
    const existingIndex = registeredUsers.findIndex(u => u.email && u.email.toLowerCase() === cleanEmail);
    if (existingIndex >= 0) {
      registeredUsers[existingIndex].name = name;
      registeredUsers[existingIndex].password = password;
      registeredUsers[existingIndex].active = true;
    } else {
      registeredUsers.push({ id: Date.now(), name, email: cleanEmail, password, role: 'Usuário', active: true });
    }
    saveUsersToServer();
    registerSuccess = true;
    serverMessage = 'Conta salva com sucesso! Faça login para continuar.';
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Criar Minha Conta →';
    }
  }

  if (registerSuccess) {
    if (nameInput) nameInput.value = '';
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';
    const regMsg = document.getElementById('regPwdMatchMsg');
    if (regMsg) regMsg.style.display = 'none';

    const loginEmail = document.getElementById('loginEmail');
    const loginPass = document.getElementById('loginPassword');
    if (loginEmail) loginEmail.value = cleanEmail;
    if (loginPass) loginPass.value = password;

    if (window.carregarUsuariosLogonServer) window.carregarUsuariosLogonServer();

    window.switchAuthTab('login');
    const loginBtn = document.getElementById('loginSubmitBtn');
    if (loginBtn) loginBtn.focus();

    showCustomAlert('Cadastro Realizado com Sucesso! 🎉', 'Conta criada com sucesso! Suas credenciais foram sincronizadas. Clique em OK para entrar agora.', 'success', () => {
      if (typeof window.handleLoginSubmit === 'function') window.handleLoginSubmit();
    });

    setTimeout(() => {
      const modal = document.getElementById('executive4kModal');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
        if (typeof window.handleLoginSubmit === 'function') window.handleLoginSubmit();
      }
    }, 1200);
  }
  return false;
};

const registerFormElem = document.getElementById('registerForm') || document.getElementById('authRegisterForm');
if (registerFormElem) {
  registerFormElem.onsubmit = window.handleRegisterSubmit;
}

// Logout seguro sem deletar as credenciais persistidas
const logoutButton = document.getElementById('logoutBtn');
if (logoutButton) {
  logoutButton.onclick = async () => {
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
    showLogoutPopup('Você saiu da sua conta com segurança. Suas informações estão salvas e protegidas no banco de dados.');
  };
}

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
  return e === 'admin@nexusfinanceiro.com';
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
  document.body.classList.add('has-view-mode-banner');
  saveToStorage('nexus_viewing_user', target.email);
  await loadUserData();
  currentPage = 'dashboard';
  render();
  updateViewModeBanner();
  showToast('Modo Espelho ativado: visualizando conta de ' + target.name);
}

async function exitViewMode(){
  if(!isViewingOtherUser || !adminOriginalUser) return;
  currentUser = adminOriginalUser;
  adminOriginalUser = null;
  isViewingOtherUser = false;
  document.body.classList.remove('has-view-mode-banner');
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
  updateViewModeBanner();
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

async function deleteUserAdmin(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const cleanEmail = (email || '').toLowerCase().trim();
  const u = registeredUsers.find(x => (x.email || '').toLowerCase() === cleanEmail);
  if(!u) return;
  if(cleanEmail === (currentUser.email || '').toLowerCase()){
    showCustomAlert('Ação não permitida', 'Você não pode excluir sua própria conta enquanto estiver conectado nela.', 'error');
    return;
  }
  if(u.role === 'Administrador' && registeredUsers.filter(x => x.role === 'Administrador').length <= 1){
    showCustomAlert('Ação não permitida', 'É necessário manter ao menos um administrador ativo no sistema.', 'error');
    return;
  }

  showCustomAlert(
    'Excluir Usuário?',
    'Tem certeza que deseja excluir permanentemente o usuário "' + u.name + '" (' + u.email + ')? Esta ação não pode ser desfeita.',
    'error',
    async () => {
      registeredUsers = registeredUsers.filter(x => (x.email || '').toLowerCase() !== cleanEmail);
      await saveUsersToServer();
      try {
        await fetch(window.location.origin + '/api/users?email=' + encodeURIComponent(cleanEmail), { method: 'DELETE' });
      } catch(e){}
      logActivity('Exclusão', 'Usuário', 'Administrador excluiu o usuário ' + u.email + ' (' + u.name + ')');
      showCustomAlert('Sucesso!', 'Usuário excluído com sucesso do banco de dados.', 'success');
      render();
    }
  );
}

/* ==================== Período ==================== */
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const PERIOD_MIN = {year:2000, month:1};
const PERIOD_MAX = {year:2100, month:12};

function parseDateParts(dateVal) {
  if (!dateVal) return null;
  const str = String(dateVal).trim().split('T')[0];
  if (str.includes('-')) {
    const p = str.split('-');
    if (p.length === 3) {
      if (p[0].length === 4) return { year: parseInt(p[0]), month: parseInt(p[1]), day: parseInt(p[2]) };
      return { year: parseInt(p[2]), month: parseInt(p[1]), day: parseInt(p[0]) };
    }
  }
  if (str.includes('/')) {
    const p = str.split('/');
    if (p.length === 3) {
      if (p[2].length === 4) return { year: parseInt(p[2]), month: parseInt(p[1]), day: parseInt(p[0]) };
      return { year: parseInt(p[0]), month: parseInt(p[1]), day: parseInt(p[2]) };
    }
  }
  const d = new Date(dateVal);
  if (!isNaN(d.getTime())) {
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  return null;
}

function getAvailableYears() {
  const yearSet = new Set();
  const now = new Date().getFullYear();
  yearSet.add(now);
  yearSet.add(now - 1);
  yearSet.add(now + 1);
  if (typeof currentPeriod !== 'undefined' && currentPeriod && currentPeriod.year) {
    yearSet.add(currentPeriod.year);
  }
  
  const addDateStr = (dateStr) => {
    if (!dateStr) return;
    const p = parseDateParts(dateStr);
    if (p && p.year && p.year >= 2000 && p.year <= 2100) yearSet.add(p.year);
  };
  
  if (typeof transactions !== 'undefined' && Array.isArray(transactions)) {
    transactions.forEach(t => addDateStr(t.date));
  }
  if (typeof cardTx !== 'undefined' && Array.isArray(cardTx)) {
    cardTx.forEach(t => addDateStr(t.date));
  }
  if (typeof recurrentes !== 'undefined' && Array.isArray(recurrentes)) {
    recurrentes.forEach(r => addDateStr(r.startDate || r.date));
  }
  
  const minYr = Math.min(...yearSet);
  const maxYr = Math.max(...yearSet);
  const startYr = Math.min(2020, minYr);
  const endYr = Math.max(now + 5, maxYr);
  
  for (let y = startYr; y <= endYr; y++) {
    yearSet.add(y);
  }
  
  return Array.from(yearSet).sort((a, b) => a - b);
}
const EYE_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a21.8 21.8 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.8 21.8 0 0 1-3.22 4.44M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

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
function bindDualPasswordToggle(primaryInputId, secondaryInputId, btnId){
  const inp1 = document.getElementById(primaryInputId);
  const inp2 = document.getElementById(secondaryInputId);
  const btn = document.getElementById(btnId);
  if(!inp1 || !btn) return;
  btn.innerHTML = EYE_ICON;
  btn.onclick = ()=>{
    const show = inp1.type === 'password';
    inp1.type = show ? 'text' : 'password';
    if(inp2) inp2.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF_ICON : EYE_ICON;
    btn.setAttribute('aria-label', show ? 'Ocultar senhas' : 'Mostrar senhas');
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
    const validPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'funcoes', 'usuarios', 'logs', 'ordens', 'config'];
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

function formatDateTimeWithSeconds(dateVal) {
  if (!dateVal) return 'Primeiro acesso pendente';
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return 'Primeiro acesso pendente';
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return day + '/' + month + '/' + year + ' às ' + hours + ':' + minutes + ':' + seconds;
  } catch(e){
    return 'Primeiro acesso pendente';
  }
}

const inPeriod = t => {
  if (!t || !t.date) return false;
  if (currentPeriod.month === 0) return true;
  
  const parsed = parseDateParts(t.date);
  if (!parsed) return false;
  return parsed.month === currentPeriod.month && parsed.year === currentPeriod.year;
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

function showCustomAlert(title, message, type = 'success', onConfirm = null) {
  let modal = document.getElementById('executive4kModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'executive4kModal';
    modal.className = 'executive-4k-modal-overlay';
    document.body.appendChild(modal);
  }

  let iconHtml = \`
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 8px rgba(59,130,246,0.7));">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  \`;
  let badgeStyle = 'background:linear-gradient(135deg, rgba(59,130,246,0.22) 0%, rgba(37,99,235,0.12) 60%, rgba(0,0,0,0.35) 100%) !important; border:1.5px solid rgba(96,165,250,0.5) !important; box-shadow:0 0 30px rgba(59,130,246,0.4), inset 0 1px 2px rgba(255,255,255,0.6) !important;';
  let btnStyle = 'background:linear-gradient(135deg, #3B82F6 0%, #2563EB 60%, #1D4ED8 100%) !important; box-shadow:0 12px 28px -4px rgba(59,130,246,0.5), inset 0 1px 1px rgba(255,255,255,0.45) !important;';

  if (type === 'success') {
    iconHtml = \`
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="#34D399" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 10px rgba(52,211,153,0.8));">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    \`;
    badgeStyle = 'background:linear-gradient(135deg, rgba(16,185,129,0.22) 0%, rgba(5,150,105,0.12) 60%, rgba(0,0,0,0.35) 100%) !important; border:1.5px solid rgba(52,211,153,0.5) !important; box-shadow:0 0 30px rgba(16,185,129,0.4), inset 0 1px 2px rgba(255,255,255,0.6) !important;';
    btnStyle = 'background:linear-gradient(135deg, #10B981 0%, #059669 60%, #047857 100%) !important; box-shadow:0 12px 28px -4px rgba(16,185,129,0.5), inset 0 1px 1px rgba(255,255,255,0.45) !important;';
  } else if (type === 'error') {
    iconHtml = \`
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F87171" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 10px rgba(239,68,68,0.8));">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
        <line x1="12" y1="9" x2="12" y2="13"/>
        <line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    \`;
    badgeStyle = 'background:linear-gradient(135deg, rgba(239,68,68,0.22) 0%, rgba(185,28,28,0.12) 60%, rgba(0,0,0,0.35) 100%) !important; border:1.5px solid rgba(248,113,113,0.5) !important; box-shadow:0 0 30px rgba(239,68,68,0.4), inset 0 1px 2px rgba(255,255,255,0.6) !important;';
    btnStyle = 'background:linear-gradient(135deg, #EF4444 0%, #DC2626 60%, #991B1B 100%) !important; box-shadow:0 12px 28px -4px rgba(239,68,68,0.5), inset 0 1px 1px rgba(255,255,255,0.45) !important;';
  }

  modal.innerHTML = \`
    <div class="executive-4k-card">
      <div class="executive-4k-badge" style="\${badgeStyle}">
        \${iconHtml}
      </div>
      <h3 class="executive-4k-title">\${title}</h3>
      <p class="executive-4k-message">\${message}</p>
      <button type="button" class="executive-4k-btn" style="\${btnStyle}" id="exec4kOkBtn">
        Entendido
      </button>
    </div>
  \`;

  modal.style.display = 'flex';

  const closeAlert = () => {
    modal.style.display = 'none';
    if (typeof onConfirm === 'function') onConfirm();
  };

  const okBtn = document.getElementById('exec4kOkBtn');
  if (okBtn) okBtn.onclick = closeAlert;
  modal.onclick = (e) => {
    if (e.target === modal) closeAlert();
  };
}

window.alert = function(msg) {
  let type = 'info';
  let title = 'Notificação do Sistema';
  if (typeof msg === 'string') {
    if (msg.toLowerCase().includes('sucesso') || msg.toLowerCase().includes('criada') || msg.toLowerCase().includes('salv')) {
      type = 'success';
      title = 'Sucesso! 🎉';
    } else if (msg.toLowerCase().includes('erro') || msg.toLowerCase().includes('falha') || msg.toLowerCase().includes('incorreto') || msg.toLowerCase().includes('verifique')) {
      type = 'error';
      title = 'Atenção';
    }
  }
  showCustomAlert(title, msg, type);
};

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

  if (isAdminView) {
    if (!['usuarios', 'logs', 'funcoes', 'ordens'].includes(currentPage)) {
      currentPage = 'usuarios';
    }
  } else {
    if (!['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'config'].includes(currentPage)) {
      currentPage = 'dashboard';
    }
  }

  let newHTML = '';
  try {
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
    else if(currentPage==='ordens') {
      newHTML = pageOrdens();
      syncOrdensWithServer().then(() => {
        const oEl = document.getElementById('pageContent');
        if (oEl && currentPage === 'ordens') {
          const freshHTML = pageOrdens();
          if (oEl.innerHTML !== freshHTML) oEl.innerHTML = freshHTML;
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
    else newHTML = pageDashboard();

    if (el.innerHTML !== newHTML) {
      el.innerHTML = newHTML;
    }
  } catch(err) {
    console.error("Erro ao renderizar tela " + currentPage + ":", err);
    try {
      el.innerHTML = '<div class="placeholder"><div class="big">⚠️</div><h3>Erro ao carregar módulo</h3><p>Tente recarregar ou voltar para a aba de Usuários.</p></div>';
    } catch(e2){}
  }

  try {
    attachPageEvents();
    updateHeaderUser();
    renderNotifications();
    updateViewModeBanner();
    updateAdminMenuVisibility();
    updateActiveMenu();
    if(currentPage==='dashboard') drawDashboardCharts();
  } catch(err) {
    console.error("Erro no pós-render:", err);
    updateActiveMenu();
  }
}

function updateActiveMenu(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  const isAdminView = isAdmin && !isViewingOtherUser;

  if (isAdminView) {
    if (!['usuarios', 'logs', 'funcoes', 'ordens'].includes(currentPage)) {
      currentPage = 'usuarios';
    }
  } else {
    if (['usuarios', 'logs', 'funcoes', 'ordens'].includes(currentPage)) {
      currentPage = 'dashboard';
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

  const adminPages = ['usuarios', 'logs', 'funcoes', 'ordens'];
  adminPages.forEach(function(pg) {
    document.querySelectorAll('button[data-page="' + pg + '"]').forEach(function(btn) {
      btn.style.display = isAdminView ? 'flex' : 'none';
    });
  });
}

function updateViewModeBanner(){
  const banner = document.getElementById('viewModeBanner');
  const floatingBtn = document.getElementById('floatingExitMirrorBtn');
  const headerMirrorExitBtn = document.getElementById('headerMirrorExitBtn');
  const exitBtn = document.getElementById('viewModeExitBtn');

  if (exitBtn) exitBtn.onclick = exitViewMode;
  if (floatingBtn) floatingBtn.onclick = exitViewMode;
  if (headerMirrorExitBtn) headerMirrorExitBtn.onclick = exitViewMode;

  if(isViewingOtherUser && currentUser){
    const nameEl = document.getElementById('viewModeUserName');
    if(nameEl) nameEl.textContent = currentUser.name;
    if(banner) banner.classList.add('show');
    if(floatingBtn) floatingBtn.style.display = 'inline-flex';
    if(headerMirrorExitBtn) headerMirrorExitBtn.style.display = 'inline-flex';
    document.body.classList.add('has-view-mode-banner');
  } else {
    if(banner) banner.classList.remove('show');
    if(floatingBtn) floatingBtn.style.display = 'none';
    if(headerMirrorExitBtn) headerMirrorExitBtn.style.display = 'none';
    document.body.classList.remove('has-view-mode-banner');
  }
}

function updateHeaderUser(){
  if (!currentUser) return;
  const unameEl = document.getElementById('headerName');
  const avatarEl = document.getElementById('headerAvatar');
  const roleEl = document.getElementById('headerRole');
  const sNameEl = document.getElementById('sidebarName');
  const sAvatarEl = document.getElementById('sidebarAvatar');
  const sRoleEl = document.getElementById('sidebarRole');

  if(unameEl) unameEl.textContent = currentUser.name;
  if(sNameEl) sNameEl.textContent = currentUser.name;
  if(roleEl) {
    if (isViewingOtherUser) {
      roleEl.innerHTML = '<span style="color:#FBBF24; font-weight:800;">👁️ Modo Espelho</span>';
    } else {
      roleEl.textContent = currentUser.role || 'Usuário';
    }
  }
  if(sRoleEl) {
    if (isViewingOtherUser) {
      sRoleEl.innerHTML = '<span style="color:#FBBF24; font-weight:800;">👁️ Modo Espelho</span>';
    } else {
      sRoleEl.textContent = (currentUser.role || 'Usuário') + ' • Configurações ⚙️';
    }
  }
  if(avatarEl || sAvatarEl) {
    const rawParts = currentUser.name.trim().split(/\s+/);
    let inits = 'PL';
    if (rawParts.length >= 2) {
      inits = (rawParts[0][0] + rawParts[1][0]).toUpperCase();
    } else if (rawParts.length === 1) {
      inits = rawParts[0].slice(0, 2).toUpperCase();
    }
    if(avatarEl) avatarEl.textContent = inits;
    if(sAvatarEl) sAvatarEl.textContent = inits;
  }
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

  const greeting = getGreetingTime();
  const formattedToday = getFormattedToday();
  const firstName = currentUser ? currentUser.name.split(' ')[0] : 'Usuário';

  return \`
  <!-- 4K EXECUTIVE DASHBOARD WELCOME HERO -->
  <div class="dashboard-welcome-hero">
    <div class="hero-backdrop-glow"></div>
    <div class="hero-content">
      <div class="hero-left">
        <div class="hero-badge-strip">
          <span class="hero-badge hide-mobile">
            📅 \${formattedToday}
          </span>
        </div>
        <h1 class="hero-greeting">
          \${greeting.icon} \${greeting.text}, <span class="hero-name-gradient">\${firstName}</span>
        </h1>
        <p class="hero-sub">
          Visão Consolidada & Gestão Financeira Pessoal
        </p>
      </div>

      <div class="hero-actions">
        \${periodPickerHTML()}
        <button class="btn-hero-primary" id="btnNovaTransacao" title="Lançar Nova Receita ou Despesa">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>Nova Transação</span>
        </button>
      </div>
    </div>
  </div>

  <div class="kpis">
    <!-- 1. Saldo Total -->
    <div class="kpi kpi-balance">
      <div class="row1">
        <span>Saldo Total</span>
        <span class="ic" style="background:rgba(59,130,246,0.14); color:var(--blue); border-color:rgba(59,130,246,0.25);">💳</span>
      </div>
      <div class="val" style="color:\${saldo < 0 ? 'var(--red)' : 'var(--green)'}; font-variant-numeric:tabular-nums;">\${fmt(saldo)}</div>
      <div class="sub" style="display:flex; align-items:center; gap:5px;">
        <span style="display:inline-block; width:5px; height:5px; border-radius:50%; background:\${saldo < 0 ? 'var(--red)' : 'var(--green)'};"></span>
        <span>\${saldo < 0 ? 'Atenção ao Saldo' : 'Patrimônio Consolidado'}</span>
      </div>
    </div>

    <!-- 2. Receitas -->
    <div class="kpi kpi-income">
      <div class="row1">
        <span>Receitas</span>
        <span class="ic" style="background:rgba(16,185,129,0.14); color:var(--green); border-color:rgba(16,185,129,0.25);">↑</span>
      </div>
      <div class="val" style="color:var(--green); font-variant-numeric:tabular-nums;">+\${fmt(receitas)}</div>
      <div class="sub up">↑ Entradas em \${periodLabel()}</div>
    </div>

    <!-- 3. Despesas -->
    <div class="kpi kpi-expense">
      <div class="row1">
        <span>Despesas</span>
        <span class="ic" style="background:rgba(239,68,68,0.14); color:var(--red); border-color:rgba(239,68,68,0.25);">↓</span>
      </div>
      <div class="val" style="color:var(--red); font-variant-numeric:tabular-nums;">-\${fmt(despesas)}</div>
      <div class="sub" style="color:var(--red);">↓ Saídas em \${periodLabel()}</div>
    </div>

    <!-- 4. Saldo do Mês -->
    <div class="kpi kpi-net">
      <div class="row1">
        <span>Saldo do Mês</span>
        <span class="ic" style="background:\${(receitas-despesas) < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)'}; color:\${(receitas-despesas) < 0 ? 'var(--red)' : 'var(--blue)'}; border-color:\${(receitas-despesas) < 0 ? 'rgba(239,68,68,0.25)' : 'rgba(59,130,246,0.25)'};">⇄</span>
      </div>
      <div class="val" style="color:\${(receitas-despesas) < 0 ? 'var(--red)' : 'var(--green)'}; font-variant-numeric:tabular-nums;">\${fmt(receitas-despesas)}</div>
      <div class="sub" style="color:\${(receitas-despesas) < 0 ? 'var(--red)' : 'var(--green)'}">
        \${(receitas-despesas) >= 0 ? '✓ Superávit Operacional' : '⚠ Déficit no Período'}
      </div>
    </div>

    <!-- 5. Transações -->
    <div class="kpi kpi-tx">
      <div class="row1">
        <span>Lançamentos</span>
        <span class="ic" style="background:rgba(155,107,216,0.14); color:var(--purple); border-color:rgba(155,107,216,0.25);">☰</span>
      </div>
      <div class="val" style="font-variant-numeric:tabular-nums;">\${periodTx.length}</div>
      <div class="sub">Registros em \${periodLabel()}</div>
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
  const totalDesp = periodTx.filter(t=>t.type==='out').reduce((s,t)=>s+parseInputValue(t.val),0);
  const totalRec = periodTx.filter(t=>t.type==='in').reduce((s,t)=>s+parseInputValue(t.val),0);
  const saldoPer = totalRec - totalDesp;

  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Transações — <span style="color:var(--green);">\${periodLabel()}</span>
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Gerencie e filtre todas as suas receitas e despesas com atualização em tempo real
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      \${periodPickerHTML()}
      <button class="btn-ghost" id="btnGerenciarCategorias" style="display:flex; align-items:center; gap:6px;">🏷️ Categorias</button>
      <button class="btn-primary" id="btnNovaTransacao" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Transação
      </button>
    </div>
  </div>

  <div class="kpis" id="txStatsRow" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:18px;">
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Receitas</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green);">↑</span></div>
      <div class="val" style="font-size:20px; color:var(--green); margin-bottom:2px;">\${fmt(totalRec)}</div>
      <div class="sub" style="font-size:11px;">Entradas no período</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Despesas</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red);">↓</span></div>
      <div class="val" style="font-size:20px; color:var(--red); margin-bottom:2px;">\${fmt(totalDesp)}</div>
      <div class="sub" style="font-size:11px;">Saídas no período</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Balanço Líquido</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:\${saldoPer < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)'}; color:\${saldoPer < 0 ? 'var(--red)' : 'var(--blue)'};">⇄</span></div>
      <div class="val" style="font-size:20px; color:\${saldoPer < 0 ? 'var(--red)' : 'var(--green)'}; margin-bottom:2px;">\${fmt(saldoPer)}</div>
      <div class="sub" style="font-size:11px;">Receitas − Despesas</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Registros</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(168,85,247,0.14); color:var(--purple);">📋</span></div>
      <div class="val" style="font-size:20px; margin-bottom:2px;">\${periodTx.length}</div>
      <div class="sub" style="font-size:11px;">Lançamentos no período</div>
    </div>
  </div>

  <div class="table-panel">
    <div class="filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
      <div style="position:relative; flex:1.5; min-width:200px;">
        <input id="txSearch" type="text" placeholder="🔍 Buscar por descrição ou valor..." style="width:100%; font-size:13px;">
      </div>
      <select id="txFiltroConta" style="flex:1; min-width:160px;"><option value="">Todas as Contas / Cartões</option>\${accOptsHTML}</select>
      <select id="txFiltroTipo" style="flex:0.8; min-width:120px;"><option value="">Todos os tipos</option><option value="in">Receitas</option><option value="out">Despesas</option></select>
      <select id="txFiltroCat" style="flex:1; min-width:140px;"><option value="">Todas categorias</option>\${catOptionsHTML(null)}</select>
      <select id="txFiltroStatus" style="flex:0.8; min-width:120px;"><option value="">Todos status</option><option>Pago</option><option>Recebido</option><option>Pendente</option></select>
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
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Cartões e Contas Bancárias
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Acompanhe o limite disponível dos cartões de crédito e os saldos consolidados de suas contas
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      \${periodPickerHTML()}
      <button class="btn-primary" id="btnNovaConta" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Cartão / Conta
      </button>
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
      <span class="tag" style="cursor:default; background:var(--green-soft); color:var(--green); font-weight:700;">\${summary.creditCards.length} cartão(ões)</span>
    </div>
    <div class="kpi-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px;">
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Limite Disponível Total</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--green); margin-top:4px;">\${fmt(summary.availableLimitGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Disponível para compras</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Fatura do Mês (\${periodLabel()})</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--orange); margin-top:4px;">\${fmt(summary.spentPeriodGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Gastos no mês selecionado</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Fatura Acumulada em Aberto</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--red); margin-top:4px;">\${fmt(summary.spentTotalGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Compras menos pagamentos</div>
      </div>
      <div class="kpi" style="background:rgba(255,255,255,0.03); padding:14px; border-radius:14px; border:1px solid var(--card-border);">
        <div class="row1" style="color:var(--text-dim); font-size:12px; font-weight:600;">Limite Total Aprovado</div>
        <div class="val" style="font-size:22px; font-weight:800; color:var(--blue); margin-top:4px;">\${fmt(summary.totalLimitGeral)}</div>
        <div class="sub" style="font-size:11px; color:var(--text-faint); margin-top:2px;">Soma de todos os cartões</div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-bottom:6px;">
        <span>Comprometimento global do limite de crédito</span>
        <span style="font-weight:700; color:\${summary.usagePctGeral>=90?'var(--red)':summary.usagePctGeral>=70?'var(--orange)':'var(--green)'};">\${summary.usagePctGeral}% comprometido</span>
      </div>
      <div class="bar-split" style="height:8px; background:var(--card-border); border-radius:6px; overflow:hidden;">
        <div class="g" style="width:\${summary.usagePctGeral}%; height:100%; background:\${summary.usagePctGeral>=90?'var(--red)':summary.usagePctGeral>=70?'var(--orange)':'var(--green)'}; border-radius:6px; transition:width .3s ease;"></div>
      </div>
    </div>
  </div>
  \` : ''}

  <div class="grid3" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(310px, 1fr)); gap:18px; align-items:stretch;">
    \${list.length ? list.map(a => {
      const stats = getCardStats(a);
      return \`
      <div class="acc-card" style="position:relative; background:linear-gradient(145deg, rgba(18,24,36,0.92) 0%, rgba(12,16,26,0.96) 100%); border:1px solid rgba(255,255,255,0.10); border-left:4px solid \${a.color}; border-radius:18px; padding:20px; display:flex; flex-direction:column; justify-content:space-between; min-height:270px; box-sizing:border-box; box-shadow:0 12px 30px -6px rgba(0,0,0,0.6);">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px;">
            <div class="id-group" style="display:flex; align-items:center; gap:12px; min-width:0;">
              <span class="acc-ic" style="background:\${a.color}; width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-weight:800; color:#fff; font-size:15px; flex-shrink:0; box-shadow:0 4px 14px rgba(0,0,0,0.4); text-shadow:0 1px 2px rgba(0,0,0,0.5);">
                \${a.name.slice(0,2).toUpperCase()}
              </span>
              <div style="min-width:0;">
                <h3 style="font-size:16px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-bottom:3px; color:var(--text); letter-spacing:-0.01em;">\${a.name}</h3>
                <span class="pill" style="font-size:11px; padding:3px 9px; border-radius:8px; background:\${stats.isCreditCard ? 'rgba(168,85,247,0.16)' : 'var(--green-soft)'}; color:\${stats.isCreditCard ? 'var(--purple)' : 'var(--green)'}; font-weight:700; border:1px solid \${stats.isCreditCard ? 'rgba(168,85,247,0.3)' : 'rgba(16,185,129,0.3)'};">
                  \${stats.isCreditCard ? '💳 ' : '🏦 '}\${a.type}
                </span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editacc="\${a.id}" title="Editar Conta" class="btn-action-edit">✎</button>
              <button data-delacc="\${a.id}" title="Excluir Conta" class="btn-action-del">🗑</button>
            </div>
          </div>

          \${stats.isCreditCard ? \`
            <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px; margin-top:4px;">
              <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:2px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em;">Limite Disponível</div>
              <div class="val" style="font-size:24px; font-weight:800; color:\${stats.availableLimit < 200 ? 'var(--red)' : 'var(--green)'}; font-variant-numeric:tabular-nums; letter-spacing:-0.02em;">
                \${fmt(stats.availableLimit)}
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.08);">
                <span>Fatura do Mês: <strong style="color:var(--orange); font-variant-numeric:tabular-nums;">\${fmt(stats.spentTotal)}</strong></span>
                <span>Limite Total: <strong style="color:var(--text); font-variant-numeric:tabular-nums;">\${fmt(stats.totalLimit)}</strong></span>
              </div>
              <div style="margin-top:10px;">
                <div class="bar-split" style="height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
                  <div class="g" style="width:\${stats.usagePct}%; height:100%; background:\${stats.usagePct >= 90 ? 'var(--red)' : stats.usagePct >= 70 ? 'var(--orange)' : 'var(--green)'}; border-radius:4px; transition:width .4s ease;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-faint); margin-top:4px;">
                  <span>Uso do Cartão</span>
                  <span style="font-weight:700; color:\${stats.usagePct >= 90 ? 'var(--red)' : stats.usagePct >= 70 ? 'var(--orange)' : 'var(--green)'};">\${stats.usagePct}% utilizado</span>
                </div>
              </div>
            </div>
          \` : \`
            <div style="background:rgba(255,255,255,0.025); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px; margin-top:4px;">
              <div style="font-size:11.5px; color:var(--text-faint); margin-bottom:2px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em;">Saldo Atual em Conta</div>
              <div class="val" style="font-size:24px; font-weight:800; color:\${stats.currentBalance < 0 ? 'var(--red)' : 'var(--green)'}; font-variant-numeric:tabular-nums; letter-spacing:-0.02em;">
                \${fmt(stats.currentBalance)}
              </div>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim); margin-top:10px; padding-top:10px; border-top:1px dashed rgba(255,255,255,0.08);">
                <span>Entradas: <strong style="color:var(--green); font-variant-numeric:tabular-nums;">+\${fmt(stats.periodIn)}</strong></span>
                <span>Saídas: <strong style="color:var(--red); font-variant-numeric:tabular-nums;">-\${fmt(stats.spentTotal)}</strong></span>
              </div>
              <div style="margin-top:8px; display:flex; align-items:center; justify-content:flex-end;">
                <span style="font-size:11px; color:var(--text-faint);">Saldo inicial cadastrado: <strong>\${fmt(stats.initialBalance)}</strong></span>
              </div>
            </div>
          \`}
        </div>
        <button class="btn-ghost" data-viewcardtx="\${a.name}" style="padding:8px 14px; font-size:12px; font-weight:700; margin-top:14px; width:100%; border-radius:10px; border:1px solid var(--card-border); background:rgba(255,255,255,0.03); color:var(--text); display:flex; align-items:center; justify-content:center; gap:6px; cursor:pointer;">
          🔍 Ver lançamentos desta conta (\${stats.txCount})
        </button>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">🏦</div><h3>Nenhuma conta cadastrada</h3><p>Cadastre suas contas bancárias e cartões de crédito para gerenciar seus saldos.</p></div>\`}
  </div>\`;
}

function pageOrcamentos(){
  const list = budgetStatus();
  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Orçamentos por Categoria
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Defina e acompanhe limites de gastos para manter seu planejamento sob controle — <strong style="color:var(--green);">\${periodLabel()}</strong>
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      \${periodPickerHTML()}
      <button class="btn-primary" id="btnNovoOrcamento" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Orçamento
      </button>
    </div>
  </div>
  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:18px;">
    \${list.length ? list.map(b => {
      const color = b.pct >= 100 ? 'var(--red)' : b.pct >= 80 ? 'var(--orange)' : 'var(--green)';
      const remaining = b.limit - b.spent;
      const isOver = remaining < 0;
      return \`
      <div class="budget-card">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;">
            <div class="id-group" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span class="dot" style="background:\${catColor(b.category)}; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px; box-shadow:0 2px 8px \${catColor(b.category)}35;">
                \${catIcon(b.category)}
              </span>
              <div style="min-width:0;">
                <h4 style="font-size:15px; font-weight:800; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${b.category}</h4>
                <span class="pill" style="font-size:10.5px; padding:2px 8px; border-radius:6px; background:\${b.pct>=100?'rgba(239,68,68,0.14)':b.pct>=80?'rgba(245,158,11,0.14)':'rgba(16,185,129,0.14)'}; color:\${color}; font-weight:700; border:1px solid \${b.pct>=100?'rgba(239,68,68,0.3)':b.pct>=80?'rgba(245,158,11,0.3)':'rgba(16,185,129,0.3)'};">
                  \${b.pct>=100 ? '🚨 Excedido' : b.pct>=80 ? '⚠️ Alerta' : '✓ Normal'} (\${b.pct}%)
                </span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editorc="\${b.id}" title="Editar Orçamento" class="btn-action-edit">✎</button>
              <button data-delorc="\${b.id}" title="Excluir Orçamento" class="btn-action-del">🗑</button>
            </div>
          </div>
          
          <div style="margin:14px 0 10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:22px; font-weight:800; color:\${color}; font-variant-numeric:tabular-nums;">\${fmt(b.spent)}</span>
              <span style="font-size:13px; color:var(--text-faint); font-weight:600;">Limite: \${fmt(b.limit)}</span>
            </div>
            <div class="bar-split" style="height:7px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:hidden; margin-top:8px;">
              <div class="g" style="width:\${Math.min(b.pct, 100)}%; background:\${color}; border-radius:5px; transition:width .4s ease;"></div>
            </div>
          </div>
        </div>

        <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.06); display:flex; justify-content:space-between; align-items:center; font-size:11.5px;">
          <span style="color:var(--text-dim); font-weight:500;">
            \${isOver ? 'Excedido em:' : 'Restante disponível:'}
          </span>
          <strong style="color:\${isOver ? 'var(--red)' : 'var(--green)'}; font-weight:800; font-variant-numeric:tabular-nums;">
            \${isOver ? '-' + fmt(Math.abs(remaining)) : fmt(remaining)}
          </strong>
        </div>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">◔</div><h3>Nenhum orçamento definido</h3><p>Crie limites mensais por categoria para controlar suas despesas e poupar mais.</p></div>\`}
  </div>\`;
}

function pageMetas(){
  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Metas e Objetivos Financeiros
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Planeje e alcance seus sonhos com metas estruturadas e controle de progresso
      </p>
    </div>
    <div class="head-actions">
      <button class="btn-primary" id="btnNovaMeta" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nova Meta
      </button>
    </div>
  </div>
  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:18px;">
    \${goals.length ? goals.map(g => {
      const pct = Math.min(100, Math.round(g.current / g.target * 100));
      const remaining = Math.max(0, g.target - g.current);
      const isCompleted = pct >= 100;
      return \`
      <div class="goal-card">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;">
            <div style="min-width:0;">
              <h3 style="font-size:16px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--text); letter-spacing:-0.01em;">
                🎯 \${g.name}
              </h3>
              <div style="font-size:11.5px; color:var(--text-faint); margin-top:2px; font-weight:600;">
                📅 Prazo: \${formatDateBR(g.deadline)}
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editmeta="\${g.id}" title="Editar Meta" class="btn-action-edit">✎</button>
              <button data-delmeta="\${g.id}" title="Excluir Meta" class="btn-action-del">🗑</button>
            </div>
          </div>

          <div style="margin:14px 0 10px;">
            <div style="display:flex; justify-content:space-between; align-items:baseline;">
              <span style="font-size:22px; font-weight:800; color:var(--green); font-variant-numeric:tabular-nums;">\${fmt(g.current)}</span>
              <span style="font-size:13px; color:var(--text-faint); font-weight:600;">Alvo: \${fmt(g.target)}</span>
            </div>
            <div class="bar-split" style="height:7px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:hidden; margin-top:8px;">
              <div class="g" style="width:\${pct}%; background:\${isCompleted ? 'linear-gradient(90deg, #10B981, #34D399)' : 'linear-gradient(90deg, #3B82F6, #60A5FA)'}; border-radius:5px; transition:width .4s ease;"></div>
            </div>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; margin-bottom:12px;">
            <span class="pill" style="font-size:11px; padding:2px 8px; border-radius:6px; background:\${isCompleted ? 'rgba(16,185,129,0.16)' : 'rgba(59,130,246,0.16)'}; color:\${isCompleted ? 'var(--green)' : 'var(--blue)'}; font-weight:700;">
              \${isCompleted ? '🎉 Concluída (100%)' : pct + '% concluído'}
            </span>
            <span style="color:var(--text-faint); font-weight:600;">
              \${isCompleted ? 'Meta atingida!' : 'Faltam ' + fmt(remaining)}
            </span>
          </div>
        </div>

        <button class="btn-ghost" style="width:100%; padding:10px; font-weight:700; border-radius:10px; font-size:13px; display:flex; align-items:center; justify-content:center; gap:6px;" data-addcontrib="\${g.id}">
          💰 Adicionar valor à meta
        </button>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">🎯</div><h3>Nenhuma meta cadastrada</h3><p>Defina objetivos de economia (ex: Reserva de Emergência, Viagem, Carro Novo) e acompanhe seu avanço.</p></div>\`}
  </div>\`;
}

function pageRelatorios(){
  const list = transactions.filter(inPeriod);
  const allCats = despesasPorCategoria(list);
  const totalReceitas = list.filter(t=>t.type==='in').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const totalDespesas = list.filter(t=>t.type==='out').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const resultado = totalReceitas - totalDespesas;
  const savingsPct = totalReceitas > 0 ? Math.max(0, Math.round((resultado / totalReceitas) * 100)) : 0;

  const totalReceitasGeral = transactions.filter(t=>t.type==='in').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const totalDespesasGeral = transactions.filter(t=>t.type==='out').reduce((s,t)=>s+(parseFloat(t.val)||0),0);
  const resultadoGeral = totalReceitasGeral - totalDespesasGeral;

  const isAllDates = currentPeriod.month === 0;

  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Relatórios e Análises Financeiras
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Análise consolidada de receitas, despesas e distribuição percentual — <strong style="color:var(--green);">\${periodLabel()}</strong>
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      \${periodPickerHTML()}
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:20px;">
    <div class="kpi kpi-income">
      <div class="row1"><span>Total de Receitas</span><span class="ic" style="background:rgba(16,185,129,0.14); color:var(--green);">↑</span></div>
      <div class="val" style="color:var(--green);">\${fmt(totalReceitas)}</div>
      <div class="sub">\${isAllDates ? 'Consolidado histórico geral' : periodLabel()}</div>
    </div>
    <div class="kpi kpi-expense">
      <div class="row1"><span>Total de Despesas</span><span class="ic" style="background:rgba(239,68,68,0.14); color:var(--red);">↓</span></div>
      <div class="val" style="color:var(--red);">\${fmt(totalDespesas)}</div>
      <div class="sub">\${isAllDates ? 'Consolidado histórico geral' : periodLabel()}</div>
    </div>
    <div class="kpi kpi-net">
      <div class="row1"><span>Balanço do Período</span><span class="ic" style="background:\${resultado < 0 ? 'rgba(239,68,68,0.14)' : 'rgba(59,130,246,0.14)'}; color:\${resultado < 0 ? 'var(--red)' : 'var(--blue)'};">⇄</span></div>
      <div class="val" style="color:\${resultado < 0 ? 'var(--red)' : 'var(--green)'};">\${fmt(resultado)}</div>
      <div class="sub">\${isAllDates ? 'Resultado acumulado geral' : 'Receitas menos Despesas do mês'}</div>
    </div>
    <div class="kpi kpi-balance">
      <div class="row1"><span>Taxa de Poupança</span><span class="ic" style="background:rgba(168,85,247,0.14); color:var(--purple);">📈</span></div>
      <div class="val" style="color:var(--purple);">\${savingsPct}%</div>
      <div class="sub">da receita economizada</div>
    </div>
  </div>

  \${!isAllDates ? \`
  <div class="panel" style="margin-bottom:20px; padding:16px 20px; background:rgba(255,255,255,0.025); border:1px solid var(--card-border); border-radius:14px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:14px;">
    <div style="font-size:13px; color:var(--text-dim); line-height:1.5;">
      💡 <strong>Comparativo Geral Histórico (Todas as Datas):</strong> Receitas: <strong style="color:var(--green);">\${fmt(totalReceitasGeral)}</strong> | Despesas: <strong style="color:var(--red);">\${fmt(totalDespesasGeral)}</strong> | Saldo Acumulado: <strong style="color:\${resultadoGeral<0?'var(--red)':'var(--green)'};">\${fmt(resultadoGeral)}</strong>
    </div>
    <button class="btn-ghost" onclick="currentPeriod={year:new Date().getFullYear(), month:0}; try{localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod));}catch(e){} render();" style="font-size:12px; font-weight:700; padding:6px 14px; border-radius:8px; cursor:pointer;">
      🌐 Ver Histórico Completo
    </button>
  </div>
  \` : ''}

  <div class="table-panel">
    <div class="panel-head">
      <h3>Despesas por Categoria — \${periodLabel()}</h3>
      <span class="tag" style="font-weight:700;">\${list.filter(t=>t.type==='out').length} despesa(s) no período</span>
    </div>
    \${allCats.length ? \`
    <table>
      <thead>
        <tr>
          <th>Categoria</th>
          <th>Total Gasto</th>
          <th>Distribuição Percentual</th>
        </tr>
      </thead>
      <tbody>
        \${allCats.map(c=>\`
          <tr class="trow">
            <td>
              <span class="pill cat-pill" style="background:\${c.color}18; color:\${c.color}; border:1px solid \${c.color}35">
                \${catIcon(c.name)} \${c.name}
              </span>
            </td>
            <td class="val-out">\${fmt(c.val)}</td>
            <td>
              <div style="display:flex; align-items:center; gap:12px;">
                <div class="bar-split" style="flex:1; max-width:180px; height:8px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
                  <div class="g" style="width:\${Math.round(c.val/(totalDespesas||1)*100)}%; height:100%; background:\${c.color}; border-radius:4px;"></div>
                </div>
                <span style="font-weight:800; font-size:12.5px; color:var(--text); min-width:40px;">\${Math.round(c.val/(totalDespesas||1)*100)}%</span>
              </div>
            </td>
          </tr>
        \`).join('')}
      </tbody>
      <tfoot>
        <tr class="tfoot-row">
          <td class="tfoot-label">TOTAL DAS DESPESAS DO PERÍODO:</td>
          <td class="tfoot-value">-\${fmt(totalDespesas)}</td>
          <td style="padding:14px 12px; font-weight:800; color:var(--text);">100%</td>
        </tr>
      </tfoot>
    </table>
    \` : \`
    <div class="placeholder"><div class="big">📊</div><h3>Nenhuma despesa no período</h3><p>Não foram encontradas despesas cadastradas para \${periodLabel()}.</p></div>
    \`}
  </div>\`;
}

function pageRecorrentes(){
  const totalDespRec = recurringList.filter(r=>r.type==='out').reduce((s,r)=>s+parseInputValue(r.val),0);
  const totalRecRec = recurringList.filter(r=>r.type==='in').reduce((s,r)=>s+parseInputValue(r.val),0);
  const totalLctos = recurringList.length;
  const totalComPrazo = recurringList.filter(r => (r.totalMonths && parseInt(r.totalMonths) > 0)).length;
  const totalContinuos = totalLctos - totalComPrazo;
  const totalConcluidos = recurringList.filter(r => {
    const tm = parseInt(r.totalMonths) || 0;
    const am = parseInt(r.appliedMonths) || 0;
    return tm > 0 && am >= tm;
  }).length;

  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Lançamentos Recorrentes & Assinaturas
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Automatize contas fixas, parcelamentos e rendimentos com controle exato de meses e aplicação em 1 clique
      </p>
    </div>
    <div class="head-actions" style="display:flex; align-items:center; gap:10px;">
      \${periodPickerHTML()}
      <button class="btn-primary" id="btnNovoRecorrente" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Recorrente
      </button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:14px; margin-bottom:18px;">
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Despesas Fixas / Mês</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red);">↓</span></div>
      <div class="val" style="font-size:20px; color:var(--red); margin-bottom:2px;">\${fmt(totalDespRec)}</div>
      <div class="sub" style="font-size:11px;">Total de saídas programadas</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Receitas Fixas / Mês</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green);">↑</span></div>
      <div class="val" style="font-size:20px; color:var(--green); margin-bottom:2px;">\${fmt(totalRecRec)}</div>
      <div class="sub" style="font-size:11px;">Total de entradas programadas</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total Recorrentes</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(168,85,247,0.14); color:var(--purple);">🔄</span></div>
      <div class="val" style="font-size:20px; margin-bottom:2px;">\${totalLctos}</div>
      <div class="sub" style="font-size:11px;">\${totalComPrazo} com prazo · \${totalContinuos} contínuos</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Status de Conclusão</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(59,130,246,0.14); color:var(--blue);">📊</span></div>
      <div class="val" style="font-size:20px; color:var(--blue); margin-bottom:2px;">\${totalConcluidos} / \${totalComPrazo || totalLctos}</div>
      <div class="sub" style="font-size:11px;">\${totalConcluidos} contratos 100% aplicados</div>
    </div>
  </div>

  <div class="table-panel">
    \${recurringList.length ? \`
    <table>
      <thead>
        <tr>
          <th>Descrição</th>
          <th>Categoria</th>
          <th>Conta de Cobrança</th>
          <th>Frequência</th>
          <th>Vencimento</th>
          <th>Duração Cadastrada</th>
          <th>Progresso / Meses</th>
          <th>Tipo</th>
          <th>Valor</th>
          <th style="text-align:center;">Ações Rápidas</th>
        </tr>
      </thead>
      <tbody>
        \${recurringList.map(r=>{
          const totalM = r.totalMonths ? parseInt(r.totalMonths) : 0;
          const appliedM = r.appliedMonths ? parseInt(r.appliedMonths) : 0;
          const isFixed = totalM > 0;
          const isCompleted = isFixed && appliedM >= totalM;
          const pct = isFixed ? Math.min(100, Math.round((appliedM / totalM) * 100)) : 0;
          const remainingM = isFixed ? Math.max(0, totalM - appliedM) : 0;
          const nextInstallmentNum = appliedM + 1;

          return \`
          <tr class="trow">
            <td class="tx-desc">
              <div style="display:flex; flex-direction:column; gap:4px;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-weight:700;">\${r.desc}</span>
                  \${isFixed ? \`<span class="pill" style="padding:2px 7px; font-size:10px; background:rgba(59,130,246,0.14); color:var(--blue); border:1px solid rgba(59,130,246,0.25);">\${appliedM}/\${totalM}m</span>\` : ''}
                </div>
                \${isFixed ? \`
                  <details style="font-size:10.5px; margin-top:2px;">
                    <summary style="cursor:pointer; color:var(--blue); font-weight:600; user-select:none;">
                      🗓️ Cronograma mês a mês (1 a \${totalM})
                    </summary>
                    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(135px, 1fr)); gap:4px; margin-top:6px; padding:6px; background:rgba(0,0,0,0.25); border-radius:8px; border:1px solid var(--card-border); max-height:160px; overflow-y:auto;">
                      \${(function(){
                        const items = [];
                        const sM = r.startMonth || 1;
                        const sY = r.startYear || new Date().getFullYear();
                        for(let k=1; k<=totalM; k++){
                          const mZero = (sM - 1) + (k - 1);
                          const y = sY + Math.floor(mZero / 12);
                          const m = (mZero % 12) + 1;
                          const isApplied = k <= appliedM;
                          const mName = MONTHS[m-1] ? MONTHS[m-1].substring(0,3) : m;
                          items.push(
                            \`<div style="padding:3px 6px; border-radius:5px; background:\${isApplied ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.03)'}; border:1px solid \${isApplied ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.06)'}; display:flex; justify-content:space-between; align-items:center;">\` +
                              \`<span>Mês \${k}: <strong style="color:var(--text);">\${mName}/\${y}</strong></span>\` +
                              \`<span style="font-weight:700; font-size:9.5px; color:\${isApplied ? 'var(--green)' : 'var(--text-dim)'}">\${isApplied ? '✓ Gerado' : 'Pendente'}</span>\` +
                            \`</div>\`
                          );
                        }
                        return items.join('');
                      })()}
                    </div>
                  </details>
                \` : ''}
              </div>
            </td>
            <td><span class="pill cat-pill" style="background:\${catColor(r.cat)}18; color:\${catColor(r.cat)}; border:1px solid \${catColor(r.cat)}35;">\${catIcon(r.cat)} \${r.cat}</span></td>
            <td><span class="pill acc-pill">\${getAccountIcon(r.acc)} \${r.acc}</span></td>
            <td><span class="pill" style="background:rgba(255,255,255,0.06); color:var(--text); font-weight:600;">\${r.freq || 'Mensal'}</span></td>
            <td><span class="pill" style="background:rgba(245,158,11,0.14); color:var(--orange); font-weight:700;">Dia \${r.day}</span></td>
            <td>
              \${isFixed ? \`
                <div style="display:flex; flex-direction:column; gap:2px;">
                  <span class="pill" style="background:rgba(59,130,246,0.12); color:var(--blue); font-weight:700; font-size:11px;">
                    📅 \${totalM} \${totalM === 1 ? 'mês' : 'meses'}
                  </span>
                  \${r.startMonth && r.startYear ? \`<span style="font-size:10px; color:var(--text-dim);">Início: \${MONTHS[r.startMonth-1] ? MONTHS[r.startMonth-1].substring(0,3) : r.startMonth}/\${r.startYear}</span>\` : ''}
                </div>
              \` : \`
                <span class="pill" style="background:rgba(255,255,255,0.06); color:var(--text-dim); font-weight:600; font-size:11px;">
                  ♾️ Contínuo
                </span>
              \`}
            </td>
            <td>
              \${isFixed ? \`
                <div style="min-width:130px; display:flex; flex-direction:column; gap:4px;">
                  <div style="display:flex; justify-content:space-between; font-size:11px; font-weight:700;">
                    <span style="color:\${isCompleted ? 'var(--green)' : 'var(--text)'};">\${isCompleted ? '✓ Concluído' : \`\${appliedM}/\${totalM} aplicados\`}</span>
                    <span style="color:var(--text-dim);">\${pct}%</span>
                  </div>
                  <div class="rec-progress-bar">
                    <div class="rec-progress-fill" style="width:\${pct}%; background:\${isCompleted ? 'var(--green)' : (pct > 50 ? 'var(--blue)' : 'var(--orange)')};"></div>
                  </div>
                  <div style="font-size:10px; color:var(--text-dim);">
                    \${isCompleted ? \`Total de \${totalM} meses gerados\` : \`\${remainingM} \${remainingM === 1 ? 'mês restante' : 'meses restantes'}\`}
                  </div>
                </div>
              \` : \`
                <div style="display:flex; align-items:center; gap:5px;">
                  <span class="pill" style="background:rgba(16,185,129,0.12); color:var(--green); font-size:11px;">
                    ✓ \${appliedM} \${appliedM === 1 ? 'lançamento' : 'lançamentos'}
                  </span>
                </div>
              \`}
            </td>
            <td><span class="type-pill \${r.type}">\${r.type==='in'?'↑ Receita':'↓ Despesa'}</span></td>
            <td class="\${r.type==='in'?'val-in':'val-out'}">\${r.type==='in'?'+':'-'}\${fmt(r.val)}</td>
            <td>
              <div class="row-actions" style="justify-content:center; gap:6px;">
                \${isFixed && isCompleted ? '' : isFixed ? \`
                  <button data-lancar="\${r.id}" title="Aplicar / Lançar parcela no sistema" class="btn-primary" style="padding:4px 10px; font-size:11px; border-radius:8px; height:32px; width:auto; font-weight:700; white-space:nowrap;">▶ Lançar (\${nextInstallmentNum}/\${totalM})</button>
                \` : \`
                  <button data-lancar="\${r.id}" title="Lançar agora na conta" class="btn-primary" style="padding:4px 10px; font-size:11.5px; border-radius:8px; height:32px; width:auto;">▶ Lançar</button>
                \`}
                <button data-editrec="\${r.id}" title="Editar Recorrente" class="btn-action-edit">✎</button>
                <button data-delrec="\${r.id}" title="Excluir Recorrente" class="btn-action-del">🗑</button>
              </div>
            </td>
          </tr>\`;
        }).join('')}
      </tbody>
    </table>\` : \`
    <div class="placeholder"><div class="big">🔄</div><h3>Nenhum lançamento recorrente</h3><p>Cadastre despesas e receitas fixas com prazo determinado ou contínuo (ex: Aluguel 12 meses, Seguro 10 meses, Internet, Salário) para lançar rapidamente a cada mês.</p></div>
    \`}
  </div>\`;
}

function pageImportar(){
  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Importar Extratos (OFX / CSV)
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Importe extratos do seu banco de forma rápida e segura para conciliação automática
      </p>
    </div>
  </div>

  <div class="panel" style="margin-bottom:22px; padding:22px;">
    <div style="display:flex; align-items:center; gap:10px; margin-bottom:18px; padding:12px 16px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.2); border-radius:12px;">
      <span style="font-size:20px;">💡</span>
      <div style="font-size:12.5px; color:var(--text); line-height:1.4;">
        Formato CSV esperado: <code style="background:rgba(255,255,255,0.08); padding:3px 8px; border-radius:6px; font-size:12px; font-weight:700; color:var(--green);">data,descricao,valor</code>. Arquivos padrão bancário <strong>.OFX</strong> e <strong>.TXT</strong> também são aceitos automaticamente.
      </div>
    </div>

    <div class="field-row" style="margin-bottom:18px; display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px;">
      <div class="field" style="margin:0;">
        <label style="font-size:13px; font-weight:700; margin-bottom:8px; display:block; color:var(--text);">Conta / Cartão de Destino</label>
        <select id="impConta" style="width:100%; font-size:13.5px; padding:10px 14px; height:46px; border-radius:10px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
          \${accounts.map(a=>\`<option>\${a.name} — \${a.type}</option>\`).join('')}
        </select>
      </div>
      <div class="field" style="margin:0;">
        <label style="font-size:13px; font-weight:700; margin-bottom:8px; display:block; color:var(--text);">Categoria Padrão</label>
        <select id="impCategoria" style="width:100%; font-size:13.5px; padding:10px 14px; height:46px; border-radius:10px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
          \${categories.map(c=>\`<option>\${c.name}</option>\`).join('')}
        </select>
      </div>
    </div>

    <div id="importDropZone" onclick="document.getElementById('importFile').click()" style="border: 2px dashed rgba(34, 197, 94, 0.4); border-radius: 18px; padding: 36px 20px; text-align: center; cursor: pointer; background: rgba(34, 197, 94, 0.03); transition: all 0.25s ease; position: relative;">
      <input type="file" id="importFile" accept=".csv,.ofx,.txt" style="display:none;">
      <span style="font-size: 42px; display: block; margin-bottom: 12px; filter: drop-shadow(0 4px 12px rgba(34,197,94,0.3));">☁️</span>
      <p style="margin:0; font-weight:800; font-size:16px; color:var(--text);">Arraste seus arquivos bancários para cá ou <span style="color:var(--green); text-decoration:underline;">clique para navegar</span></p>
      <div style="display:flex; justify-content:center; gap:8px; margin-top:10px;">
        <span class="pill" style="background:rgba(255,255,255,0.06); font-size:11px; font-weight:700;">.OFX</span>
        <span class="pill" style="background:rgba(255,255,255,0.06); font-size:11px; font-weight:700;">.CSV</span>
        <span class="pill" style="background:rgba(255,255,255,0.06); font-size:11px; font-weight:700;">.TXT</span>
      </div>
    </div>

    <div id="importPreview" style="margin-top:20px;"></div>
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
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Anexos & Comprovantes Digitais
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Cadastre comprovantes, faturas em PDF e recibos vinculados aos seus lançamentos
      </p>
    </div>
  </div>

  <div class="panel" style="margin-bottom:22px; padding:26px;">
    <div style="margin-bottom:18px;">
      <h3 style="font-size:16.5px; font-weight:800; display:flex; align-items:center; gap:8px; margin:0; color:#FFFFFF;">
        <span>📎</span> Vincular & Enviar Novo Comprovante
      </h3>
      <p style="font-size:12.5px; color:var(--text-dim); margin-top:4px;">
        Selecione uma transação existente ou envie um anexo avulso para guarda segura.
      </p>
    </div>

    <div style="margin-bottom:18px;">
      <label style="font-size:13px; font-weight:700; margin-bottom:8px; display:block; color:var(--text);">Vincular a uma Transação (Opcional)</label>
      <select id="attTx" style="width:100%; font-size:13.5px; padding:11px 16px; height:48px; border-radius:14px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:var(--text); font-weight:600; backdrop-filter:blur(16px); box-shadow:inset 0 1px 1px rgba(255,255,255,0.15);">
        <option value="0">Nenhuma (Anexo Avulso / Recibo Padrão)</option>
        \${sortedTx.map(t=>\`<option value="\${t.id}">\${formatDateBR(t.date)} — \${t.desc} (\${fmt(t.val)})</option>\`).join('')}
      </select>
    </div>

    <div id="attDropZone" style="border: 2px dashed rgba(96, 165, 250, 0.4); border-radius: 22px; padding: 42px 20px; text-align: center; cursor: pointer; background: linear-gradient(135deg, rgba(255, 255, 255, 0.04) 0%, rgba(59, 130, 246, 0.06) 50%, rgba(16, 185, 129, 0.04) 100%); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.22), 0 10px 30px rgba(0,0,0,0.3); transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); position: relative;">
      <input type="file" id="attFile" multiple accept="image/*,.pdf,.doc,.docx,.txt" style="display:none;">
      <div style="display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:50%; background:linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(59,130,246,0.25) 100%); border:1px solid rgba(255,255,255,0.35); box-shadow:0 8px 24px rgba(59,130,246,0.35); margin-bottom:14px;">
        <span style="font-size: 32px; display: block; filter: drop-shadow(0 2px 8px rgba(255,255,255,0.5));">☁️</span>
      </div>
      <p style="margin:0; font-weight:800; font-size:16px; color:#FFFFFF; letter-spacing:-0.01em;">Arraste comprovantes para cá ou <span style="color:#60A5FA; text-decoration:underline;">clique para anexar</span></p>
      <div style="display:flex; justify-content:center; gap:8px; margin-top:12px;">
        <span class="pill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; backdrop-filter:blur(10px);">PNG / JPG / WEBP</span>
        <span class="pill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; backdrop-filter:blur(10px);">PDF</span>
        <span class="pill" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#E2E8F0; padding:4px 12px; border-radius:999px; font-size:11px; font-weight:700; backdrop-filter:blur(10px);">DOCX / TXT</span>
      </div>
    </div>
  </div>

  <div style="margin-bottom:14px; display:flex; align-items:center; justify-content:space-between;">
    <h3 style="font-size:17px; font-weight:800;">Comprovantes Armazenados (\${attachments.length})</h3>
  </div>

  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(290px, 1fr)); gap:18px;">
    \${attachments.length? attachments.map(a=>{
      const t = transactions.find(x=>x.id===a.txId);
      const isImage = (a.type && a.type.startsWith('image/')) || (a.dataUrl && a.dataUrl.startsWith('data:image/'));
      const isPdf = (a.type && a.type.includes('pdf')) || (a.dataUrl && a.dataUrl.startsWith('data:application/pdf')) || (a.name && a.name.toLowerCase().endsWith('.pdf'));

      return \`
      <div class="budget-card" style="min-height:260px;">
        <div>
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
            <span class="pill" style="font-size:11px; padding:3px 9px; border-radius:8px; background:\${isPdf ? 'rgba(239,68,68,0.14)' : isImage ? 'rgba(59,130,246,0.14)' : 'rgba(168,85,247,0.14)'}; color:\${isPdf ? 'var(--red)' : isImage ? 'var(--blue)' : 'var(--purple)'}; font-weight:700;">
              \${isPdf ? '📄 Fatura PDF' : isImage ? '🖼️ Imagem Anexa' : '📎 Documento'}
            </span>
            <button data-delatt="\${a.id}" title="Excluir Anexo" class="btn-action-del">🗑</button>
          </div>

          <div style="cursor:pointer; text-align:center; margin-bottom:12px;" data-previewatt="\${a.id}" title="Clique para Visualizar">
            \${getAttachmentCoverHtml(a, t)}
          </div>

          <h4 style="font-size:14.5px; font-weight:800; margin-bottom:8px; word-break:break-word; color:var(--text); line-height:1.3;">\${a.name}</h4>
          
          <div style="margin-top:10px;">
            <label style="display:block; font-size:11.5px; color:var(--text-faint); margin-bottom:4px; font-weight:700;">Transação Vinculada:</label>
            <select data-relinkatt="\${a.id}" style="width:100%; font-size:12.5px; padding:6px 10px; border-radius:8px; background:var(--bg); border:1px solid var(--card-border); color:var(--text); font-weight:600;">
              <option value="0" \${!a.txId ? 'selected' : ''}>Sem vincular (Anexo Avulso)</option>
              \${sortedTx.map(tx => \`<option value="\${tx.id}" \${tx.id === a.txId ? 'selected' : ''}>\${formatDateBR(tx.date)} — \${tx.desc}</option>\`).join('')}
            </select>
          </div>
        </div>

        <div style="display:flex; align-items:center; gap:8px; margin-top:14px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">
          \${a.dataUrl ? \`
            <a href="\${a.dataUrl}" download="\${a.name || 'comprovante'}" class="btn-primary" style="flex:1.2; padding:8px 12px; font-size:12.5px; font-weight:700; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:6px; border-radius:8px;" title="Baixar Arquivo">
              📥 Baixar
            </a>
            <button data-previewatt="\${a.id}" class="btn-ghost" style="flex:1; padding:8px 12px; font-size:12.5px; font-weight:700; border-radius:8px; display:inline-flex; align-items:center; justify-content:center; gap:6px;" title="Visualizar">
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
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Alertas de Orçamento
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Avisos inteligentes acionados automaticamente quando o gasto se aproxima do limite — <strong style="color:var(--green);">\${periodLabel()}</strong>
      </p>
    </div>
    <div class="head-actions">
      <button class="btn-primary" id="btnNovoAlerta" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Novo Alerta
      </button>
    </div>
  </div>
  <div class="cat-cards" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:18px;">
    \${alerts.length ? alerts.map(al => {
      const b = bstat.find(x => x.category === al.category);
      const pct = b ? b.pct : null;
      const triggered = pct !== null && pct >= al.threshold;
      return \`
      <div class="budget-card" style="border-color:\${triggered ? 'rgba(239,68,68,0.45)' : 'rgba(255,255,255,0.09)'};">
        <div>
          <div class="top" style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px; gap:10px;">
            <div class="id-group" style="display:flex; align-items:center; gap:10px; min-width:0;">
              <span class="dot" style="background:\${triggered ? 'var(--red)' : 'var(--green)'}; width:34px; height:34px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:16px;">
                \${triggered ? '⚠️' : '🔔'}
              </span>
              <div style="min-width:0;">
                <h4 style="font-size:15px; font-weight:800; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">\${al.category}</h4>
                <span class="pill" style="font-size:10.5px; padding:2px 8px; border-radius:6px; background:\${triggered ? 'rgba(239,68,68,0.16)' : 'rgba(16,185,129,0.16)'}; color:\${triggered ? 'var(--red)' : 'var(--green)'}; font-weight:700; border:1px solid \${triggered ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'};">
                  \${triggered ? '🚨 Gatilho Acionado' : '✓ Monitoramento OK'}
                </span>
              </div>
            </div>
            <div class="row-actions" style="display:flex; gap:6px;">
              <button data-editalert="\${al.id}" title="Editar Alerta" class="btn-action-edit">✎</button>
              <button data-delalert="\${al.id}" title="Excluir Alerta" class="btn-action-del">🗑</button>
            </div>
          </div>

          <div style="margin:14px 0 10px;">
            <div style="font-size:12px; color:var(--text-dim); margin-bottom:4px;">
              Gatilho: Dispara ao atingir <strong style="color:var(--text);">\${al.threshold}%</strong> do orçamento
            </div>
            \${b ? \`
              <div style="display:flex; justify-content:space-between; align-items:baseline; margin-top:8px;">
                <span style="font-size:20px; font-weight:800; color:\${triggered ? 'var(--red)' : 'var(--green)'}; font-variant-numeric:tabular-nums;">\${fmt(b.spent)}</span>
                <span style="font-size:12.5px; color:var(--text-faint); font-weight:600;">Limite: \${fmt(b.limit)}</span>
              </div>
              <div class="bar-split" style="height:7px; background:rgba(255,255,255,0.08); border-radius:5px; overflow:hidden; margin-top:8px;">
                <div class="g" style="width:\${Math.min(pct, 100)}%; background:\${triggered ? 'var(--red)' : 'var(--green)'}; border-radius:5px; transition:width .4s ease;"></div>
              </div>
              <div style="text-align:right; font-size:11px; color:\${triggered ? 'var(--red)' : 'var(--text-faint)'}; font-weight:700; margin-top:4px;">
                \${pct}% consumido
              </div>
            \` : \`
              <div style="font-size:12px; color:var(--text-faint); margin-top:10px; padding:8px 10px; background:rgba(255,255,255,0.03); border-radius:8px;">
                Sem orçamento ativo cadastrado para esta categoria
              </div>
            \`}
          </div>
        </div>
      </div>\`;
    }).join('') : \`<div class="placeholder"><div class="big">🔔</div><h3>Nenhum alerta configurado</h3><p>Crie alertas para ser avisado automaticamente quando os gastos de qualquer categoria atingirem percentuais críticos.</p></div>\`}
  </div>\`;
}

function pageConfig(){
  return \`
  <div class="page-head">
    <div>
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Configurações do Sistema
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Preferências da conta, segurança, tema visual e proporção de exibição por dispositivo
      </p>
    </div>
  </div>

  \${isViewingOtherUser ? \`
  <div class="panel" style="margin-bottom:18px; padding:16px 20px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25);">
    <p class="cfg-hint" style="margin:0; font-size:13px; color:var(--text);">
      👁️ Você está em modo de visualização dos dados de <strong style="color:var(--green);">\${currentUser ? currentUser.name : ''}</strong>. As configurações da conta só podem ser editadas pelo próprio titular.
    </p>
  </div>\` : \`
  <div class="cfg-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:20px;">
    <!-- 1. Minha Conta -->
    <div class="panel" style="padding:22px;">
      <div class="panel-head" style="margin-bottom:16px;">
        <h3 style="display:flex; align-items:center; gap:8px; font-size:16px; font-weight:800;">
          <span>👤</span> Minha Conta
        </h3>
      </div>
      <div class="field" style="margin-bottom:14px;">
        <label style="font-size:12.5px; font-weight:700; margin-bottom:6px; display:block;">Nome Completo</label>
        <input id="cfgName" value="\${currentUser ? currentUser.name : ''}" placeholder="Seu nome completo" autocomplete="name" style="width:100%; height:44px; font-size:13.5px;">
      </div>
      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12.5px; font-weight:700; margin-bottom:6px; display:block;">E-mail de Acesso</label>
        <input id="cfgEmail" type="text" value="\${currentUser ? currentUser.email : ''}" placeholder="seu.email@exemplo.com" autocomplete="email" style="width:100%; height:44px; font-size:13.5px;">
      </div>
    </div>

    <!-- 2. Aparência & Escala -->
    <div class="panel" style="padding:22px;">
      <div class="panel-head" style="margin-bottom:16px;">
        <h3 style="display:flex; align-items:center; gap:8px; font-size:16px; font-weight:800;">
          <span>🎨</span> Aparência & Escala da Tela
        </h3>
      </div>
      <div class="field" style="margin-bottom:14px;">
        <label style="font-size:12.5px; font-weight:700; margin-bottom:6px; display:block;">Tema Visual</label>
        <select id="cfgTheme" style="width:100%; height:44px; font-size:13.5px;">
          <option value="dark">🌙 Escuro (Alta Performance)</option>
          <option value="light">☀️ Claro (Executivo Clean)</option>
        </select>
      </div>
      <div class="field" style="margin-bottom:10px;">
        <label style="font-size:12.5px; font-weight:700; margin-bottom:6px; display:block;">Tamanho de Visualização</label>
        <select id="cfgScale" style="width:100%; height:44px; font-size:13.5px;">
          <option value="auto">⚡ Auto (Adequar ao Dispositivo Logado)</option>
          <option value="80%">🔍 80% (Compacto)</option>
          <option value="90%">🔍 90% (Reduzido)</option>
          <option value="100%">🔍 100% (Padrão 1:1)</option>
          <option value="110%">🔍 110% (Ampliado)</option>
          <option value="125%">🔍 125% (Grande)</option>
          <option value="150%">🔍 150% (Extra Grande)</option>
        </select>
      </div>
      <div id="cfgDeviceInfo" style="margin-top:12px;"></div>
    </div>

    <!-- 3. Alterar Senha -->
    <div class="panel" style="padding:22px;">
      <div class="panel-head" style="margin-bottom:16px;">
        <h3 style="display:flex; align-items:center; gap:8px; font-size:16px; font-weight:800;">
          <span>🔒</span> Segurança & Senha
        </h3>
      </div>
      <p class="cfg-hint" style="font-size:12px; margin-bottom:14px;">Preencha apenas se desejar trocar sua senha de acesso</p>
      <div class="field" style="margin-bottom:14px;">
        <label style="font-size:12.5px; font-weight:700; margin-bottom:6px; display:block;">Nova Senha <span style="color:var(--text-faint); font-weight:400;">(mínimo 6 dígitos)</span></label>
        <div class="pass-field">
          <input id="cfgPassword" type="password" placeholder="••••••••" minlength="6" autocomplete="new-password" style="width:100%; height:44px; font-size:13.5px;">
          <button type="button" class="pass-toggle" id="cfgPasswordToggle" tabindex="-1" aria-label="Mostrar senha">\${EYE_ICON}</button>
        </div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label style="font-size:12.5px; font-weight:700; margin-bottom:6px; display:block;">Confirmar Nova Senha</label>
        <div class="pass-field">
          <input id="cfgPasswordConfirm" type="password" placeholder="••••••••" minlength="6" autocomplete="new-password" style="width:100%; height:44px; font-size:13.5px;">
          <button type="button" class="pass-toggle" id="cfgPasswordConfirmToggle" tabindex="-1" aria-label="Mostrar senha">\${EYE_ICON}</button>
        </div>
      </div>
    </div>
  </div>

  <div class="cfg-save-bar" style="margin-top:24px; display:flex; justify-content:flex-end;">
    <button class="btn-primary" id="btnSalvarConfig" style="padding:12px 28px; font-size:14px; font-weight:800; border-radius:12px; display:flex; align-items:center; gap:8px;">
      <span>💾</span> Salvar Todas as Configurações
    </button>
  </div>\`}
  \`;
}

/* ==================== Aba 4K: Central de Funções & Permissões ==================== */
let currentFuncoesRoleFilter = 'all';

function setFuncoesRoleFilter(roleFilter, btnEl) {
  currentFuncoesRoleFilter = roleFilter;
  document.querySelectorAll('.funcoes-filter-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  
  const cols = document.querySelectorAll('.perm-matrix-th, .perm-matrix-td');
  cols.forEach(col => {
    const roleAttr = col.getAttribute('data-perm-role');
    if (!roleAttr || currentFuncoesRoleFilter === 'all') {
      col.style.display = '';
      col.style.opacity = '1';
      col.style.background = '';
    } else if (roleAttr === currentFuncoesRoleFilter) {
      col.style.display = '';
      col.style.opacity = '1';
      col.style.background = 'rgba(232,176,75,0.08)';
    } else {
      col.style.display = 'none';
    }
  });
}

async function changeUserRoleFromFuncoes(email, newRole) {
  await syncUsersWithServer();
  const u = registeredUsers.find(x => x.email.toLowerCase() === (email || '').toLowerCase());
  if (!u) {
    if (typeof showToast === 'function') showToast('Usuário não encontrado');
    return;
  }
  const oldRole = u.role;
  u.role = newRole;
  await saveUsersToServer();
  if (typeof logActivity === 'function') {
    logActivity('Alteração de Função', 'Usuário / Permissões', 'Administrador alterou a função do usuário ' + u.email + ' (' + u.name + ') de ' + oldRole + ' para ' + newRole);
  }
  if (typeof showLoginSuccessPopup === 'function') {
    showLoginSuccessPopup('Função do usuário ' + u.name + ' alterada para ' + newRole + '!');
  } else if (typeof showToast === 'function') {
    showToast('Função de ' + u.name + ' alterada para ' + newRole + '!');
  }
  render();
}

function exportPermissionsMatrixCSV() {
  const rows = [
    ['Modulo', 'Administrador', 'Gerente Financeiro', 'Usuario / Operador', 'Auditor'],
    ['Dashboard Executivo', 'Total (Criar/Editar/Excluir)', 'Total', 'Total Próprio', 'Somente Leitura'],
    ['Gestão de Transações & Cartões', 'Total (Qualquer Usuário)', 'Total Próprio', 'Total Próprio', 'Somente Leitura'],
    ['Orçamentos, Metas & Relatórios', 'Total + Exportação 4K', 'Total + Exportação', 'Total Próprio', 'Exportação CSV/PDF'],
    ['Gerenciamento de Usuários & Contas', 'Controle Total + Modo Espelho', 'Sem Acesso', 'Sem Acesso', 'Lista de Contas'],
    ['Central de Funções & Permissões', 'Controle Total (Nível 1)', 'Sem Acesso', 'Sem Acesso', 'Sem Acesso'],
    ['Logs de Auditoria & Segurança', 'Auditoria Geral + Filtro IP/Email', 'Logs Próprios', 'Sem Acesso', 'Leitura de Eventos']
  ];
  let csvContent = 'data:text/csv;charset=utf-8,' + rows.map(function(e){ return e.map(function(x){ return '"' + x + '"'; }).join(','); }).join('\\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', 'matriz_de_permissoes_' + new Date().toISOString().slice(0,10) + '.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  if (typeof showToast === 'function') showToast('Matriz de Permissões exportada em CSV com sucesso!');
}

function pageFuncoes(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return \`<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área de Gestão de Funções é exclusiva para administradores.</p></div>\`;
  }
  const userRole = (currentUser && currentUser.role) || 'Usuário';
  const totalUsers = registeredUsers ? registeredUsers.length : 1;
  const adminCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Administrador').length : 1;
  const managerCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Gerente Financeiro').length : 0;
  const auditorCount = registeredUsers ? registeredUsers.filter(u => u.role === 'Auditor').length : 0;
  const standardCount = totalUsers - adminCount - managerCount - auditorCount;

  return \`
  <div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px; margin-bottom:20px;">
    <div>
      <h1 style="display:flex; align-items:center; gap:10px; font-size:22px; font-weight:800; color:var(--text);">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg, rgba(232,176,75,0.25), rgba(201,134,42,0.15)); border:1px solid rgba(232,176,75,0.4); color:#fbbf24; font-size:18px;">🛡️</span>
        Central de Funções & Permissões
      </h1>
      <p style="font-size:13.5px; color:var(--text-dim); margin:4px 0 0 0;">Gerencie papéis de usuários, atribuição rápida de funções, matriz de controle de acessos e permissões do sistema em tempo real.</p>
    </div>
    <div style="display:flex; gap:10px; align-items:center;">
      <span class="tag" style="background:rgba(232,176,75,0.15); color:#fbbf24; border:1px solid rgba(232,176,75,0.3); font-weight:700; padding:6px 14px; border-radius:20px; font-size:12px;">
        👑 Modo Administrador (Acesso Irrestrito)
      </span>
      <button onclick="exportPermissionsMatrixCSV()" class="btn-ghost" style="height:36px; padding:0 14px; border-radius:10px; border-color:rgba(232,176,75,0.3); color:#fbbf24; font-size:12.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; gap:6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span>Exportar CSV</span>
      </button>
    </div>
  </div>

  <!-- Cards de Resumo Executivo das Funções 4K -->
  <div class="kpis" style="margin-bottom:20px;">
    <div class="kpi" style="border:1px solid rgba(232,176,75,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95)); shadow:0 10px 30px rgba(0,0,0,0.5);">
      <div class="kpi-head"><span class="lbl">Sua Função Atual</span><span class="ic" style="background:rgba(232,176,75,0.2); color:#fbbf24;">👑</span></div>
      <div class="val" style="color:#fbbf24; font-size:22px;">\${userRole}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">Nível de Privilégio: Acesso Total (Nível 1)</div>
    </div>
    <div class="kpi" style="border:1px solid rgba(16,185,129,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95));">
      <div class="kpi-head"><span class="lbl">Administradores</span><span class="ic" style="background:rgba(16,185,129,0.2); color:#10b981;">👥</span></div>
      <div class="val" style="color:#10b981; font-size:22px;">\${adminCount} Admin\${adminCount===1?'':'s'}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">Gestores com Acesso Irrestrito</div>
    </div>
    <div class="kpi" style="border:1px solid rgba(59,130,246,0.25); background:linear-gradient(135deg, rgba(20,24,33,0.9), rgba(12,16,24,0.95));">
      <div class="kpi-head"><span class="lbl">Operadores & Outras Funções</span><span class="ic" style="background:rgba(59,130,246,0.2); color:#3b82f6;">👤</span></div>
      <div class="val" style="color:#3b82f6; font-size:22px;">\${totalUsers - adminCount} Usuário\${(totalUsers - adminCount)===1?'':'s'}</div>
      <div class="sub" style="color:var(--text-dim); margin-top:4px;">\${standardCount} Operadores · \${managerCount} Gerentes · \${auditorCount} Auditores</div>
    </div>
  </div>

  <!-- Atribuição Direta de Funções aos Usuários -->
  <div class="panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25); background:var(--card);">
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <h3 style="font-size:16px; font-weight:700; color:var(--text);">⚡ Atribuição Direta de Funções aos Usuários</h3>
        <p class="cfg-hint" style="margin-top:4px;">Altere o perfil e nível de acesso de qualquer usuário cadastrado instantaneamente.</p>
      </div>
      <span class="tag" style="background:rgba(16,185,129,0.15); color:#34D399; border-color:rgba(16,185,129,0.3); font-weight:700;">\${totalUsers} Conta(s) no Sistema</span>
    </div>
    
    <div class="table-panel" style="padding:0; border:none; background:transparent; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--card-border); background:rgba(0,0,0,0.3);">
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase;">Usuário</th>
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase;">E-mail</th>
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase;">Função Atual</th>
            <th style="padding:14px 16px; color:#fbbf24; font-size:12px; text-transform:uppercase;">Alterar Função do Usuário</th>
          </tr>
        </thead>
        <tbody>
          \${(registeredUsers || []).map(u => {
            const isMe = currentUser && u.email.toLowerCase() === currentUser.email.toLowerCase();
            return \`
            <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
              <td style="padding:14px 16px; font-weight:600; color:var(--text);">
                <div style="display:flex; align-items:center; gap:10px;">
                  <div style="width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, #3b82f6, #1d4ed8); display:flex; align-items:center; justify-content:center; color:#fff; font-weight:800; font-size:12px;">
                    \${u.name.slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <span>\${u.name}</span>
                    \${isMe ? ' <span style="font-size:10px; color:#fbbf24; background:rgba(232,176,75,0.15); padding:1px 6px; border-radius:6px; font-weight:700;">Você</span>' : ''}
                  </div>
                </div>
              </td>
              <td style="padding:14px 16px; color:var(--text-dim); font-size:13px;">\${u.email}</td>
              <td style="padding:14px 16px;">
                <span class="role-badge \${u.role==='Administrador'?'admin':'user'}" style="font-size:12px; padding:4px 10px;">\${u.role}</span>
              </td>
              <td style="padding:14px 16px;">
                <select onchange="changeUserRoleFromFuncoes('\${u.email}', this.value)" style="height:36px; padding:0 12px; border-radius:10px; background:var(--input-bg, rgba(0,0,0,0.4)); border:1px solid rgba(232,176,75,0.3); color:#fbbf24; font-weight:700; font-size:13px; cursor:pointer;">
                  <option value="Administrador" \${u.role==='Administrador'?'selected':''}>👑 Administrador (Acesso Irrestrito)</option>
                  <option value="Gerente Financeiro" \${u.role==='Gerente Financeiro'?'selected':''}>💼 Gerente Financeiro</option>
                  <option value="Usuário" \${u.role==='Usuário'?'selected':''}>👤 Usuário / Operador Padrão</option>
                  <option value="Auditor" \${u.role==='Auditor'?'selected':''}>🔍 Auditor (Somente Leitura)</option>
                </select>
              </td>
            </tr>\`;
          }).join('')}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Matriz de Permissões por Função do Sistema -->
  <div class="panel" style="margin-bottom:20px; border:1px solid rgba(232,176,75,0.25); background:var(--card);">
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
      <div>
        <h3 style="font-size:16px; font-weight:700; color:var(--text);">Matriz de Permissões e Capacidades do Sistema</h3>
        <p class="cfg-hint" style="margin-top:4px;">Tabela detalhada de acessos, privilégios de edição e permissões ativas para cada nível de usuário.</p>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">
        <button onclick="setFuncoesRoleFilter('all', this)" class="funcoes-filter-btn active" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#fff; cursor:pointer;">Todas</button>
        <button onclick="setFuncoesRoleFilter('admin', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(232,176,75,0.12); border:1px solid rgba(232,176,75,0.3); color:#fbbf24; cursor:pointer;">👑 Administrador</button>
        <button onclick="setFuncoesRoleFilter('gerente', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); color:#34d399; cursor:pointer;">💼 Gerente</button>
        <button onclick="setFuncoesRoleFilter('usuario', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); color:#60a5fa; cursor:pointer;">👤 Usuário</button>
        <button onclick="setFuncoesRoleFilter('auditor', this)" class="funcoes-filter-btn" style="padding:4px 10px; border-radius:8px; font-size:11.5px; font-weight:700; background:rgba(192,132,252,0.12); border:1px solid rgba(192,132,252,0.3); color:#c084fc; cursor:pointer;">🔍 Auditor</button>
      </div>
    </div>
    
    <div class="table-panel" style="padding:0; border:none; background:transparent; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse; text-align:left;">
        <thead>
          <tr style="border-bottom:1px solid var(--card-border); background:rgba(0,0,0,0.25);">
            <th style="padding:14px 16px; color:var(--text-dim); font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">Módulo do Sistema</th>
            <th class="perm-matrix-th" data-perm-role="admin" style="padding:14px 16px; color:#fbbf24; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">👑 Administrador</th>
            <th class="perm-matrix-th" data-perm-role="gerente" style="padding:14px 16px; color:#34d399; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">💼 Gerente Financeiro</th>
            <th class="perm-matrix-th" data-perm-role="usuario" style="padding:14px 16px; color:#60a5fa; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">👤 Usuário / Operador</th>
            <th class="perm-matrix-th" data-perm-role="auditor" style="padding:14px 16px; color:#c084fc; font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">🔍 Auditor (Leitura)</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">📊</span> Dashboard Executivo</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total (Criar/Editar/Excluir)</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Somente Leitura</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">💳</span> Gestão de Transações & Cartões</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total (Qualquer Usuário)</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Somente Leitura</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">🎯</span> Orçamentos, Metas & Relatórios</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total + Exportação 4K</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total + Exportação</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Total Próprio</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Exportação CSV/PDF</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">👥</span> Gerenciamento de Usuários & Contas</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Controle Total + Modo Espelho 👁️</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Lista de Contas</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">🛡️</span> Central de Funções & Permissões</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Controle Total (Nível 1)</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
          </tr>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.04);">
            <td style="padding:14px 16px; font-weight:600; color:var(--text);"><span style="margin-right:8px;">📜</span> Logs de Auditoria & Segurança</td>
            <td class="perm-matrix-td" data-perm-role="admin" style="padding:14px 16px;"><span class="funcoes-badge full">✅ Auditoria Geral + Filtro IP/Email</span></td>
            <td class="perm-matrix-td" data-perm-role="gerente" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Logs Próprios</span></td>
            <td class="perm-matrix-td" data-perm-role="usuario" style="padding:14px 16px;"><span class="funcoes-badge lock">🔒 Sem Acesso</span></td>
            <td class="perm-matrix-td" data-perm-role="auditor" style="padding:14px 16px;"><span class="funcoes-badge read">👁️ Leitura de Eventos</span></td>
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
            <div><strong style="font-size:13.5px; color:var(--text);">Persistência PostgreSQL / JSON</strong><div style="font-size:11px; color:var(--text-faint);">Sincronização em tempo real</div></div>
          </div>
          <span style="font-size:11px; font-weight:700; color:#10b981; background:rgba(16,185,129,0.15); padding:3px 8px; border-radius:6px;">Online</span>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:rgba(0,0,0,0.25); border-radius:10px; border:1px solid var(--card-border);">
          <div style="display:flex; align-items:center; gap:10px;">
            <span style="width:10px; height:10px; border-radius:50%; background:#3b82f6; box-shadow:0 0 10px #3b82f6;"></span>
            <div><strong style="font-size:13.5px; color:var(--text);">Engine de Funções & Permissões</strong><div style="font-size:11px; color:var(--text-faint);">Validação de Acesso JWT / Sessão</div></div>
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
        <button class="btn-ghost" onclick="syncUsersWithServer().then(()=>showLoginSuccessPopup('Funções de usuários atualizadas com o servidor!'));" style="display:flex; align-items:center; justify-content:center; gap:8px; border-color:rgba(232,176,75,0.3); color:#fbbf24;">
          <span>⚡</span> Sincronizar Tabela de Funções & Usuários
        </button>
      </div>
    </div>
  </div>\`;
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

let currentAdminUserFilter = 'all';
let currentAdminUserSearch = '';

function setAdminUserFilter(filterType, btnEl) {
  currentAdminUserFilter = filterType;
  document.querySelectorAll('.admin-filter-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  applyAdminUserFiltering();
}

function handleAdminUserSearch(query) {
  currentAdminUserSearch = (query || '').toLowerCase().trim();
  applyAdminUserFiltering();
}

function applyAdminUserFiltering() {
  const cards = document.querySelectorAll('.user-card-4k');
  cards.forEach(card => {
    const email = (card.getAttribute('data-user-email') || '').toLowerCase();
    const name = (card.querySelector('.user-card-name') ? card.querySelector('.user-card-name').textContent : '').toLowerCase();
    const role = card.getAttribute('data-user-role') || '';
    const status = card.getAttribute('data-user-status') || '';

    let matchesFilter = true;
    if (currentAdminUserFilter === 'admin') matchesFilter = (role === 'admin');
    else if (currentAdminUserFilter === 'user') matchesFilter = (role === 'user');
    else if (currentAdminUserFilter === 'active') matchesFilter = (status === 'active');
    else if (currentAdminUserFilter === 'inactive') matchesFilter = (status === 'inactive');

    let matchesSearch = true;
    if (currentAdminUserSearch) {
      matchesSearch = email.includes(currentAdminUserSearch) || name.includes(currentAdminUserSearch);
    }

    card.style.display = (matchesFilter && matchesSearch) ? 'flex' : 'none';
  });
}

function pageUsuarios(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return \`<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área é exclusiva para administradores.</p></div>\`;
  }

  // Deduplica e garante lista limpa com dados do PostgreSQL
  const userMap = new Map();
  (registeredUsers || []).forEach(u => {
    if (u && u.email) userMap.set(u.email.toLowerCase(), u);
  });
  const users = Array.from(userMap.values());

  const totalUsers = users.length;
  const adminCount = users.filter(u => u.role === 'Administrador').length;
  const activeCount = users.filter(u => u.active !== false).length;
  const inactiveCount = totalUsers - activeCount;

  return \`
  <div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:22px;">
    <div>
      <h1 style="font-size:23px; font-weight:900; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:10px; color:var(--text);">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.12)); border:1px solid rgba(96,165,250,0.35);">👥</span>
        Usuários & Contas de Acesso
      </h1>
      <p style="font-size:13.5px; color:var(--text-dim); margin:5px 0 0 0; font-weight:500;">
        Gerenciamento de contas, permissões, modo espelhado e sincronização segura com o banco de dados.
      </p>
    </div>
    <button id="btnNovoUsuarioAdmin" onclick="openAdminCreateUserModal()" style="display:inline-flex; align-items:center; gap:9px; height:42px; padding:0 22px; border-radius:14px; background:linear-gradient(135deg, #3B82F6 0%, #2563EB 50%, #1D4ED8 100%); color:#ffffff; font-size:13.5px; font-weight:800; border:1px solid rgba(255,255,255,0.25); cursor:pointer; box-shadow:0 8px 24px -4px rgba(59,130,246,0.5), inset 0 1px 1px rgba(255,255,255,0.4); transition:all 0.25s cubic-bezier(0.16, 1, 0.3, 1);">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>Cadastrar Novo Usuário</span>
    </button>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:16px; margin-bottom:22px;">
    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Total de Usuários</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.15)); border:1.5px solid rgba(96,165,250,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(59,130,246,0.3); font-size:16px;">👥</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:var(--text); margin-bottom:2px; letter-spacing:-0.02em;">\${totalUsers}</div>
      <div class="sub" style="font-size:12px; color:#60A5FA; font-weight:600; margin-top:4px;">Contas sincronizadas</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Administradores</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.15)); border:1.5px solid rgba(251,191,36,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(245,158,11,0.3); font-size:16px;">👑</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#FBBF24; margin-bottom:2px; letter-spacing:-0.02em;">\${adminCount}</div>
      <div class="sub" style="font-size:12px; color:#FDE68A; font-weight:600; margin-top:4px;">Controle irrestrito</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Usuários Ativos</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15)); border:1.5px solid rgba(52,211,153,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(16,185,129,0.3); font-size:16px;">✅</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#34D399; margin-bottom:2px; letter-spacing:-0.02em;">\${activeCount}</div>
      <div class="sub" style="font-size:12px; color:#A7F3D0; font-weight:600; margin-top:4px;">Acesso liberado</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Desativados</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(239,68,68,0.25), rgba(185,28,28,0.15)); border:1.5px solid rgba(248,113,113,0.4); display:flex; align-items:center; justify-content:center; box-shadow:0 0 16px rgba(239,68,68,0.3); font-size:16px;">🚫</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#F87171; margin-bottom:2px; letter-spacing:-0.02em;">\${inactiveCount}</div>
      <div class="sub" style="font-size:12px; color:#FECACA; font-weight:600; margin-top:4px;">Acesso bloqueado</div>
    </div>
  </div>

  <div class="admin-toolbar-panel" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.12); border-radius:18px; padding:12px 16px; backdrop-filter:blur(20px); -webkit-backdrop-filter:blur(20px); box-shadow:0 8px 30px rgba(0,0,0,0.35); margin-bottom:20px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;">
    <div class="admin-search-wrap" style="position:relative; flex:1; min-width:240px;">
      <svg style="position:absolute; left:14px; top:50%; transform:translateY(-50%); width:16px; height:16px; color:#94A3B8; pointer-events:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" id="adminUserSearchInput" class="admin-search-input" placeholder="Buscar por nome ou e-mail..." oninput="handleAdminUserSearch(this.value)" autocomplete="off" spellcheck="false" value="\${currentAdminUserSearch}" style="width:100%; height:42px; padding:0 14px 0 40px; border-radius:12px; background:var(--input-bg, rgba(255,255,255,0.05)); border:1px solid rgba(255,255,255,0.14); color:var(--text); font-size:13.5px; font-weight:600; outline:none; transition:all 0.2s ease;">
    </div>
    <div class="admin-filter-bar" style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
      <button class="admin-filter-btn \${currentAdminUserFilter==='all'?'active':''}" onclick="setAdminUserFilter('all', this)">Todos (\${totalUsers})</button>
      <button class="admin-filter-btn \${currentAdminUserFilter==='admin'?'active':''}" onclick="setAdminUserFilter('admin', this)">Admins (\${adminCount})</button>
      <button class="admin-filter-btn \${currentAdminUserFilter==='user'?'active':''}" onclick="setAdminUserFilter('user', this)">Usuários (\${totalUsers - adminCount})</button>
      <button class="admin-filter-btn \${currentAdminUserFilter==='active'?'active':''}" onclick="setAdminUserFilter('active', this)">Ativos (\${activeCount})</button>
      <button class="admin-filter-btn \${currentAdminUserFilter==='inactive'?'active':''}" onclick="setAdminUserFilter('inactive', this)">Desativados (\${inactiveCount})</button>
    </div>
  </div>

  <div class="panel" style="margin-bottom:0; padding:24px 26px;">
    <div class="panel-head" style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
      <h3 style="font-size:16.5px; font-weight:800; color:var(--text); display:flex; align-items:center; gap:8px;">
        <span>📋</span> Lista Geral de Usuários
      </h3>
      <span class="tag" style="cursor:default; font-weight:800; font-size:12px; padding:5px 14px; border-radius:20px; background:rgba(59,130,246,0.15); border:1px solid rgba(59,130,246,0.35); color:#60A5FA;">\${totalUsers} cadastrado(s)</span>
    </div>
    <p class="cfg-hint" style="margin-bottom:18px; font-size:13px; color:var(--text-dim); line-height:1.5;">
      💡 Clique em <strong>👁 Espelho</strong> para inspecionar a conta do usuário em modo somente-leitura ou <strong>✏️ Editar</strong> para atualizar credenciais e papéis de acesso.
    </p>
    <div class="user-admin-list">
      \${users.map(u=>{
        const stats = getUserActivitySummary(u.email);
        const isAdminUser = u.role === 'Administrador';
        const isInactive = u.active === false;
        const isSelf = currentUser && currentUser.email && u.email && (currentUser.email.toLowerCase() === u.email.toLowerCase());
        const initials = (u.name || 'U').trim().split(/\\s+/).map(w => w[0]).filter(Boolean).slice(0,2).join('').toUpperCase() || 'US';

        return \`
        <div class="user-card-4k \${isInactive ? 'inactive' : ''}" data-user-email="\${(u.email||'').toLowerCase()}" data-user-role="\${isAdminUser ? 'admin' : 'user'}" data-user-status="\${isInactive ? 'inactive' : 'active'}">
          <div class="user-card-left">
            <div class="user-card-avatar \${isAdminUser ? 'admin-av' : 'user-av'}">
              \${initials}
              <span class="user-status-dot \${isInactive ? 'offline' : 'online'}"></span>
            </div>
            <div class="user-card-info">
              <div class="user-card-name-row">
                <span class="user-card-name">\${u.name}</span>
                <span class="role-badge \${isAdminUser ? 'admin' : 'user'}">\${u.role}</span>
                \${isInactive ? '<span class="role-badge inactive">Desativado</span>' : ''}
              </div>
              <div class="user-card-email">\${u.email}</div>
              <div class="user-card-stats-strip">
                \${stats.hasData ? \`
                  <span class="user-stat-chip">Transações: <strong>\${stats.txCount}</strong></span>
                  <span class="user-stat-chip">Contas: <strong>\${stats.accCount}</strong></span>
                  <span class="user-stat-chip">Orçamentos: <strong>\${stats.budCount}</strong></span>
                  <span class="user-stat-chip">Metas: <strong>\${stats.goalCount}</strong></span>
                  \${stats.lastDate ? \`<span class="user-stat-chip">Última mov: <strong>\${formatDateBR(stats.lastDate)}</strong></span>\` : ''}
                \` : '<span class="user-stat-chip">Ainda sem movimentações</span>'}
                <span class="user-stat-chip user-last-login-chip" style="background:rgba(59,130,246,0.14); border:1px solid rgba(96,165,250,0.35); color:#93C5FD; display:inline-flex; align-items:center; gap:5px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  Último login: <strong style="color:#FFFFFF;">\${formatDateTimeWithSeconds(u.last_login)}</strong>
                </span>
              </div>
            </div>
          </div>
          <div class="user-card-right">
            \${!isSelf ? \`
              <button type="button" class="user-card-btn btn-espelho" data-viewuser="\${u.email}" onclick="viewUserData('\${u.email}')" title="Visualizar conta em Modo Espelho">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <span>Espelho</span>
              </button>
              <button type="button" class="user-card-btn \${isInactive ? 'btn-ativar' : 'btn-desativar'}" data-toggleuser="\${u.email}" onclick="toggleUserActive('\${u.email}')" title="\${isInactive ? 'Ativar usuário' : 'Desativar usuário'}">
                \${isInactive ? \`
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  <span>Ativar</span>
                \` : \`
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                  <span>Desativar</span>
                \`}
              </button>
              <button type="button" class="user-card-btn btn-excluir" data-deluser="\${u.email}" onclick="deleteUserAdmin('\${u.email}')" title="Excluir usuário permanentemente">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                <span>Excluir</span>
              </button>
            \` : \`
              <span class="user-stat-chip" style="background:rgba(245,158,11,0.15); color:#FBBF24; border:1px solid rgba(245,158,11,0.3); font-weight:800; font-size:12px; padding:6px 14px; border-radius:12px; height:38px;">⭐ Sua Conta (Atual)</span>
            \`}
            <button type="button" class="user-card-btn btn-editar" data-edituser="\${u.email}" onclick="openUserAdminModal('\${u.email}')" title="Editar informações do usuário">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              <span>Editar</span>
            </button>
          </div>
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
      <h1 style="font-size:22px; font-weight:800; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:8px;">
        Logs & Auditoria do Sistema
      </h1>
      <p style="font-size:12.5px; color:var(--text-dim); margin:4px 0 0 0; font-weight:500;">
        Histórico completo de auditoria com rastreabilidade de acessos, logins e alterações de dados
      </p>
    </div>
    <div class="head-actions">
      <button class="btn-ghost" onclick="loadSystemLogs().then(render)" style="display:flex; align-items:center; gap:6px; font-weight:700;">🔄 Atualizar Logs</button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:14px; margin-bottom:20px;">
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Total de Registros</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(74,144,226,.14); color:var(--blue);">📋</span></div>
      <div class="val" style="font-size:22px; color:var(--blue); margin-bottom:2px;">\${countTotal}</div>
      <div class="sub" style="font-size:11px;">Eventos registrados</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Criações</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(16,185,129,0.14); color:var(--green);">➕</span></div>
      <div class="val" style="font-size:22px; color:var(--green); margin-bottom:2px;">\${countCriacao}</div>
      <div class="sub" style="font-size:11px;">Novos dados</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Edições</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(232,176,75,0.14); color:var(--orange);">✎</span></div>
      <div class="val" style="font-size:22px; color:var(--orange); margin-bottom:2px;">\${countEdicao}</div>
      <div class="sub" style="font-size:11px;">Registros alterados</div>
    </div>
    <div class="kpi" style="padding:14px 16px;">
      <div class="row1" style="margin-bottom:6px;"><span>Exclusões</span><span class="ic" style="width:32px; height:32px; font-size:14px; background:rgba(239,68,68,0.14); color:var(--red);">🗑</span></div>
      <div class="val" style="font-size:22px; color:var(--red); margin-bottom:2px;">\${countExclusao}</div>
      <div class="sub" style="font-size:11px;">Registros removidos</div>
    </div>
  </div>

  <div class="table-panel">
    <div class="panel-head" style="margin-bottom:14px;">
      <h3>Trilha de Auditoria Detalhada</h3>
      <span class="tag" style="font-weight:700;">\${logs.length} evento(s)</span>
    </div>
    <div class="filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
      <div style="position:relative; flex:1.5; min-width:200px;">
        <input id="logSearch" placeholder="🔍 Buscar por usuário, e-mail, ação ou detalhe..." onkeyup="filterLogsTable()" style="width:100%; font-size:13px;">
      </div>
      <select id="logFilterAction" onchange="filterLogsTable()" style="flex:1; min-width:140px;">
        <option value="">Todas as ações</option>
        <option value="cria">Criação</option>
        <option value="ediç">Edição</option>
        <option value="excl">Exclusão</option>
        <option value="login">Login / Acesso</option>
      </select>
      <select id="logFilterEntity" onchange="filterLogsTable()" style="flex:1; min-width:140px;">
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

/* ==================== Módulo de Ordens de Serviço (O.S.) & Suporte ==================== */
let systemOrdens = [];

async function syncOrdensWithServer() {
  return loadSystemOrdens();
}

async function loadSystemOrdens() {
  try {
    const res = await fetch(window.location.origin + '/api/ordens');
    if (res.ok) {
      const data = await res.json();
      if (data && Array.isArray(data.ordens)) {
        systemOrdens = data.ordens;
        saveToStorage('nexus_ordens_servico', systemOrdens);
        updateOrdensBadge();
        return systemOrdens;
      }
    }
  } catch(e) {}

  const cached = loadFromStorage('nexus_ordens_servico', null);
  if (Array.isArray(cached) && cached.length > 0) {
    systemOrdens = cached;
    updateOrdensBadge();
  }
  return systemOrdens;
}

function updateOrdensBadge() {
  const badge = document.getElementById('osBadgeCount');
  if (!badge) return;
  const pendingCount = (systemOrdens || []).filter(o => (o.status || '').toLowerCase() === 'pendente').length;
  if (pendingCount > 0) {
    badge.textContent = pendingCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// Helper para sanitização no cliente
function escapeOsHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

window.switchOsModalTab = function(tab) {
  const btnAbrir = document.getElementById('tabBtnNovaOrdem');
  const btnConsultar = document.getElementById('tabBtnConsultarOrdem');
  const boxForm = document.getElementById('boxNovaOrdemForm');
  const boxSuccess = document.getElementById('boxNovaOrdemSuccess');
  const boxConsultar = document.getElementById('boxConsultarOrdem');
  const feedback = document.getElementById('osFormFeedback');

  if (boxSuccess) boxSuccess.style.display = 'none';
  if (feedback) feedback.style.display = 'none';

  if (tab === 'consultar') {
    if (btnAbrir) btnAbrir.classList.remove('active');
    if (btnConsultar) btnConsultar.classList.add('active');
    if (boxForm) boxForm.style.display = 'none';
    if (boxConsultar) boxConsultar.style.display = 'block';
    const queryInput = document.getElementById('osConsultarQuery');
    if (queryInput) setTimeout(() => queryInput.focus(), 60);
  } else {
    if (btnAbrir) btnAbrir.classList.add('active');
    if (btnConsultar) btnConsultar.classList.remove('active');
    if (boxForm) boxForm.style.display = 'block';
    if (boxConsultar) boxConsultar.style.display = 'none';
    const nameInput = document.getElementById('osClientName');
    if (nameInput) setTimeout(() => nameInput.focus(), 60);
  }
};

window.consultarProtocoloRecente = function() {
  const protoEl = document.getElementById('osSuccessProtocol');
  const proto = protoEl ? protoEl.textContent.trim().replace('#', '') : '';
  switchOsModalTab('consultar');
  const queryInput = document.getElementById('osConsultarQuery');
  if (queryInput && proto) {
    queryInput.value = proto;
    executarConsultaOrdens();
  }
};

// Abertura e Consulta de O.S. (Público na Tela de Login)
window.openNovaOrdemModal = function(preselectedTypeOrTab) {
  const overlay = document.getElementById('overlayNovaOrdem');
  if (!overlay) return;
  
  const formBox = document.getElementById('boxNovaOrdemForm');
  const successBox = document.getElementById('boxNovaOrdemSuccess');
  const feedback = document.getElementById('osFormFeedback');
  const form = document.getElementById('formNovaOrdem');
  
  if (formBox) formBox.style.display = 'block';
  if (successBox) successBox.style.display = 'none';
  if (feedback) feedback.style.display = 'none';
  if (form) form.reset();

  overlay.classList.add('show');
  overlay.style.display = 'flex';

  if (preselectedTypeOrTab === 'consultar') {
    switchOsModalTab('consultar');
  } else {
    switchOsModalTab('abrir');
    if (preselectedTypeOrTab && preselectedTypeOrTab !== 'abrir') {
      const typeSelect = document.getElementById('osServiceType');
      if (typeSelect) {
        for (let i = 0; i < typeSelect.options.length; i++) {
          if (typeSelect.options[i].value.toLowerCase().includes(preselectedTypeOrTab.toLowerCase())) {
            typeSelect.selectedIndex = i;
            break;
          }
        }
      }
    }
  }
};

window.executarConsultaOrdens = async function(e) {
  if (e && e.preventDefault) e.preventDefault();

  const queryInput = document.getElementById('osConsultarQuery');
  const btn = document.getElementById('btnExecutarConsultaOs');
  const feedback = document.getElementById('osConsultarFeedback');
  const resultsWrap = document.getElementById('osConsultarResultados');

  const query = (queryInput?.value || '').trim();
  if (!query) {
    if (feedback) {
      feedback.style.background = 'rgba(239,68,68,0.18)';
      feedback.style.color = '#FCA5A5';
      feedback.style.border = '1px solid rgba(239,68,68,0.4)';
      feedback.textContent = 'Por favor, digite seu Nome Completo ou E-mail cadastrado.';
      feedback.style.display = 'block';
    }
    return;
  }

  if (feedback) feedback.style.display = 'none';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Buscando...';
  }
  if (resultsWrap) {
    resultsWrap.innerHTML = '<div style="text-align:center; padding:30px 14px; color:#94A3B8;"><div style="font-size:26px; margin-bottom:8px;">⏳</div>Localizando suas ordens de serviço...</div>';
  }

  try {
    const res = await fetch(window.location.origin + '/api/ordens/consultar?query=' + encodeURIComponent(query));
    const data = await res.json();

    if (res.ok && data.success) {
      const list = data.ordens || [];
      if (list.length === 0) {
        resultsWrap.innerHTML = \`
          <div style="text-align:center; padding:30px 14px; color:#94A3B8; background:rgba(255,255,255,0.02); border-radius:14px; border:1px dashed rgba(255,255,255,0.12);">
            <div style="font-size:32px; margin-bottom:6px;">📭</div>
            <h4 style="font-size:15px; color:var(--text); margin:0 0 4px 0; font-weight:800;">Nenhum chamado encontrado</h4>
            <p style="font-size:12px; margin:0; line-height:1.4;">Não encontramos nenhuma O.S. aberta para "<strong>\${escapeOsHtml(query)}</strong>". Verifique se digitou o mesmo nome ou e-mail cadastrado.</p>
          </div>
        \`;
      } else {
        let cardsHtml = \`
          <div style="font-size:12px; font-weight:800; color:#93C5FD; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
            <span>\${list.length} chamado(s) encontrado(s):</span>
            <span style="font-size:11px; color:#94A3B8;">Atualizado em tempo real</span>
          </div>
        \`;

        list.forEach(o => {
          let statusBg = 'rgba(234,179,8,0.15)', statusColor = '#FBBF24', statusBorder = 'rgba(234,179,8,0.35)', statusLabel = '⏳ Pendente';
          const st = (o.status || '').toLowerCase();
          if (st.includes('anda')) {
            statusBg = 'rgba(59,130,246,0.18)'; statusColor = '#60A5FA'; statusBorder = 'rgba(59,130,246,0.4)'; statusLabel = '⚙️ Em Andamento';
          } else if (st.includes('concl') || st.includes('final')) {
            statusBg = 'rgba(16,185,129,0.18)'; statusColor = '#34D399'; statusBorder = 'rgba(16,185,129,0.4)'; statusLabel = '✅ Concluído';
          } else if (st.includes('canc') || st.includes('recus')) {
            statusBg = 'rgba(239,68,68,0.15)'; statusColor = '#F87171'; statusBorder = 'rgba(239,68,68,0.35)'; statusLabel = '❌ Cancelado';
          }

          let dateFormatted = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Data não informada';

          cardsHtml += \`
            <div class="os-consult-card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; gap:8px; flex-wrap:wrap;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-weight:900; font-family:monospace; font-size:12.5px; padding:3px 9px; border-radius:6px; background:rgba(59,130,246,0.18); color:#93C5FD; border:1px solid rgba(59,130,246,0.35);">
                    #\${o.protocol || o.id}
                  </span>
                  <span style="font-size:11.5px; color:#94A3B8;">\${dateFormatted}</span>
                </div>
                <span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; font-size:11.5px; font-weight:800; background:\${statusBg}; color:\${statusColor}; border:1px solid \${statusBorder};">
                  \${statusLabel}
                </span>
              </div>

              <h4 style="font-size:14.5px; font-weight:800; color:#FFFFFF; margin:0 0 6px 0;">
                \${escapeOsHtml(o.title || 'Solicitação sem assunto')}
              </h4>

              <div style="display:flex; gap:12px; font-size:12px; color:#CBD5E1; margin-bottom:10px; flex-wrap:wrap;">
                <span><strong>Solicitante:</strong> \${escapeOsHtml(o.client_name || 'Anônimo')}</span>
                <span><strong>Tipo:</strong> \${escapeOsHtml(o.service_type || 'Geral')}</span>
                <span><strong>Prioridade:</strong> \${escapeOsHtml(o.priority || 'Normal')}</span>
              </div>

              <div style="background:rgba(0,0,0,0.25); border-radius:10px; padding:10px 12px; font-size:12px; color:#E2E8F0; margin-bottom:10px; line-height:1.45; border:1px solid rgba(255,255,255,0.06);">
                <span style="display:block; font-size:10.5px; font-weight:800; color:#94A3B8; text-transform:uppercase; margin-bottom:3px;">Descrição do seu pedido:</span>
                \${escapeOsHtml(o.description || 'Sem descrição informada.')}
              </div>

              \${o.admin_notes ? \`
                <div style="background:linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.08)); border:1.5px solid rgba(52,211,153,0.35); border-radius:12px; padding:12px; margin-top:10px;">
                  <div style="display:flex; align-items:center; gap:6px; font-size:11.5px; font-weight:800; color:#34D399; margin-bottom:4px; text-transform:uppercase;">
                    <span>💬 Parecer / Resposta da Equipe Técnica:</span>
                  </div>
                  <div style="font-size:12.5px; color:#F1F5F9; font-weight:600; line-height:1.45;">
                    \${escapeOsHtml(o.admin_notes)}
                  </div>
                </div>
              \` : \`
                <div style="font-size:11.5px; color:#94A3B8; font-style:italic; margin-top:6px;">
                  ℹ️ Chamado em triagem. Aguarde o retorno técnico nesta mesma tela.
                </div>
              \`}
            </div>
          \`;
        });

        resultsWrap.innerHTML = cardsHtml;
      }
    } else {
      resultsWrap.innerHTML = '<div style="color:#F87171; text-align:center; padding:20px;">' + (data.message || 'Erro ao consultar ordens.') + '</div>';
    }
  } catch(err) {
    resultsWrap.innerHTML = '<div style="color:#F87171; text-align:center; padding:20px;">Falha de comunicação com o servidor. Verifique sua conexão.</div>';
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🔍 Buscar O.S.';
    }
  }
};

window.closeNovaOrdemModal = function() {
  const overlay = document.getElementById('overlayNovaOrdem');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.style.display = 'none', 200);
};

window.enviarNovaOrdem = async function(e) {
  if (e && e.preventDefault) e.preventDefault();
  const btn = document.getElementById('btnSubmitOs');
  const feedback = document.getElementById('osFormFeedback');

  const clientName = (document.getElementById('osClientName')?.value || '').trim();
  const clientEmail = (document.getElementById('osClientEmail')?.value || '').trim();
  const serviceType = document.getElementById('osServiceType')?.value || 'Melhoria no Sistema';
  const priority = document.getElementById('osPriority')?.value || 'Normal';
  const title = (document.getElementById('osTitle')?.value || '').trim();
  const description = (document.getElementById('osDescription')?.value || '').trim();

  if (!clientName || !clientEmail || !title || !description) {
    if (feedback) {
      feedback.className = 'auth-feedback-banner error';
      feedback.textContent = 'Por favor, preencha todos os campos obrigatórios (*).';
      feedback.style.display = 'block';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Enviando Ordem de Serviço...';
  }

  try {
    const res = await fetch(window.location.origin + '/api/ordens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: clientName,
        client_email: clientEmail,
        service_type: serviceType,
        priority: priority,
        title: title,
        description: description
      })
    });

    const result = await res.json();
    if (res.ok && result.success) {
      const formBox = document.getElementById('boxNovaOrdemForm');
      const successBox = document.getElementById('boxNovaOrdemSuccess');
      const protocolEl = document.getElementById('osSuccessProtocol');

      if (protocolEl) protocolEl.textContent = result.protocol || '#OS-CONFIRMADO';
      if (formBox) formBox.style.display = 'none';
      if (successBox) successBox.style.display = 'block';

      if (typeof syncOrdensWithServer === 'function') {
        syncOrdensWithServer();
      }
    } else {
      if (feedback) {
        feedback.className = 'auth-feedback-banner error';
        feedback.textContent = result.message || 'Erro ao registrar ordem de serviço. Tente novamente.';
        feedback.style.display = 'block';
      }
    }
  } catch(err) {
    if (feedback) {
      feedback.className = 'auth-feedback-banner error';
      feedback.textContent = 'Falha de comunicação com o servidor. Verifique sua conexão.';
      feedback.style.display = 'block';
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Enviar Ordem de Serviço 🚀';
    }
  }
};

window.copyOsProtocol = function() {
  const protocolEl = document.getElementById('osSuccessProtocol');
  if (!protocolEl) return;
  const proto = protocolEl.textContent.trim();
  navigator.clipboard.writeText(proto).then(() => {
    showToast('Protocolo ' + proto + ' copiado para a área de transferência!');
  }).catch(() => {
    showToast('Protocolo: ' + proto);
  });
};

// Admin: Tabela e Gestão de O.S.
function renderOrdensTable(list) {
  if (!list || list.length === 0) {
    return \`<div class="placeholder" style="padding:40px 20px;"><div class="big">📋</div><h3>Nenhuma Ordem de Serviço encontrada</h3><p>Quando usuários abrirem chamados na tela de login ou suporte, eles aparecerão aqui em tempo real.</p></div>\`;
  }

  let html = \`
  <div style="overflow-x:auto;">
    <table class="table" style="width:100%; border-collapse:collapse; min-width:850px;">
      <thead>
        <tr style="border-bottom:1px solid var(--card-border); text-align:left;">
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Protocolo</th>
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Data/Hora</th>
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Solicitante</th>
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Tipo de Serviço</th>
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Prioridade</th>
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800;">Status</th>
          <th style="padding:12px 14px; font-size:11.5px; text-transform:uppercase; color:var(--text-dim); font-weight:800; text-align:right;">Ações</th>
        </tr>
      </thead>
      <tbody>
  \`;

  list.forEach(o => {
    let statusBg = 'rgba(234,179,8,0.15)', statusColor = '#FBBF24', statusBorder = 'rgba(234,179,8,0.35)', statusLabel = '⏳ Pendente';
    const st = (o.status || '').toLowerCase();
    if (st.includes('anda')) {
      statusBg = 'rgba(59,130,246,0.18)'; statusColor = '#60A5FA'; statusBorder = 'rgba(59,130,246,0.4)'; statusLabel = '⚙️ Em Andamento';
    } else if (st.includes('concl') || st.includes('final')) {
      statusBg = 'rgba(16,185,129,0.18)'; statusColor = '#34D399'; statusBorder = 'rgba(16,185,129,0.4)'; statusLabel = '✅ Concluído';
    } else if (st.includes('canc') || st.includes('recus')) {
      statusBg = 'rgba(239,68,68,0.15)'; statusColor = '#F87171'; statusBorder = 'rgba(239,68,68,0.35)'; statusLabel = '❌ Cancelado';
    }

    let prioBg = 'rgba(16,185,129,0.12)', prioColor = '#34D399', prioBorder = 'rgba(16,185,129,0.3)';
    const prio = (o.priority || '').toLowerCase();
    if (prio.includes('urg')) {
      prioBg = 'rgba(239,68,68,0.18)'; prioColor = '#F87171'; prioBorder = 'rgba(239,68,68,0.4)';
    } else if (prio.includes('alt')) {
      prioBg = 'rgba(245,158,11,0.18)'; prioColor = '#FBBF24'; prioBorder = 'rgba(245,158,11,0.4)';
    }

    let dateFormatted = o.created_at ? new Date(o.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Hoje';

    html += \`
      <tr style="border-bottom:1px solid rgba(255,255,255,0.05); transition:background 0.15s ease;" onmouseover="this.style.background='rgba(255,255,255,0.03)'" onmouseout="this.style.background='transparent'">
        <td style="padding:13px 14px; white-space:nowrap;">
          <span style="display:inline-block; font-weight:800; font-family:monospace; font-size:12px; padding:3px 8px; border-radius:6px; background:rgba(59,130,246,0.12); color:#93C5FD; border:1px solid rgba(59,130,246,0.3);">
            #\${o.protocol || o.id}
          </span>
        </td>
        <td style="padding:13px 14px; font-size:12px; color:var(--text-dim); white-space:nowrap;">
          \${dateFormatted}
        </td>
        <td style="padding:13px 14px;">
          <div style="font-weight:700; color:var(--text); font-size:13px;">\${o.client_name || 'Anônimo'}</div>
          <div style="font-size:11.5px; color:var(--text-dim);">\${o.client_email || ''}</div>
        </td>
        <td style="padding:13px 14px; font-size:12.5px; color:var(--text); font-weight:600; white-space:nowrap;">
          \${o.service_type || 'Melhoria'}
        </td>
        <td style="padding:13px 14px; white-space:nowrap;">
          <span style="display:inline-block; padding:3px 9px; border-radius:999px; font-size:11px; font-weight:800; background:\${prioBg}; color:\${prioColor}; border:1px solid \${prioBorder};">
            \${o.priority || 'Normal'}
          </span>
        </td>
        <td style="padding:13px 14px; white-space:nowrap;">
          <span style="display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border-radius:999px; font-size:11.5px; font-weight:800; background:\${statusBg}; color:\${statusColor}; border:1px solid \${statusBorder};">
            \${statusLabel}
          </span>
        </td>
        <td style="padding:13px 14px; text-align:right; white-space:nowrap;">
          <button type="button" onclick="openOrdemAdminModal(\${o.id})" style="padding:6px 12px; border-radius:8px; background:linear-gradient(135deg, #3B82F6, #1D4ED8); color:#ffffff; font-size:12px; font-weight:800; border:none; cursor:pointer; margin-right:6px; box-shadow:0 2px 8px rgba(59,130,246,0.3);">
            👁️ Visualizar & Atender
          </button>
          <button type="button" onclick="excluirOrdemAdmin(\${o.id})" style="padding:6px 10px; border-radius:8px; background:rgba(239,68,68,0.12); color:#F87171; border:1px solid rgba(239,68,68,0.25); font-size:12px; cursor:pointer;" title="Excluir O.S.">
            🗑️
          </button>
        </td>
      </tr>
    \`;
  });

  html += \`
      </tbody>
    </table>
  </div>
  \`;
  return html;
}

function filterOrdensTable() {
  const query = (document.getElementById('osSearchInput')?.value || '').toLowerCase().trim();
  const statusFilter = (document.getElementById('osFilterStatus')?.value || '').toLowerCase().trim();
  const typeFilter = (document.getElementById('osFilterType')?.value || '').toLowerCase().trim();

  const filtered = (systemOrdens || []).filter(o => {
    const text = ((o.protocol||'') + ' ' + (o.client_name||'') + ' ' + (o.client_email||'') + ' ' + (o.title||'') + ' ' + (o.description||'')).toLowerCase();
    const matchQuery = !query || text.includes(query);
    const matchStatus = !statusFilter || (o.status || '').toLowerCase().includes(statusFilter);
    const matchType = !typeFilter || (o.service_type || '').toLowerCase().includes(typeFilter);
    return matchQuery && matchStatus && matchType;
  });

  const wrap = document.getElementById('osTableWrap');
  if (wrap) wrap.innerHTML = renderOrdensTable(filtered);
}

function pageOrdens(){
  const isAdmin = currentUser && currentUser.role === 'Administrador';
  if(!isAdmin || isViewingOtherUser){
    return \`<div class="placeholder"><div class="big">🔒</div><h3>Acesso restrito</h3><p>Esta área de Ordens de Serviço é exclusiva para administradores.</p></div>\`;
  }

  const ordens = systemOrdens || [];
  const countTotal = ordens.length;
  const countPendentes = ordens.filter(o => (o.status||'').toLowerCase() === 'pendente').length;
  const countAndamento = ordens.filter(o => (o.status||'').toLowerCase().includes('anda')).length;
  const countConcluidas = ordens.filter(o => (o.status||'').toLowerCase().includes('concl') || (o.status||'').toLowerCase().includes('final')).length;

  return \`
  <div class="page-head" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px; margin-bottom:22px;">
    <div>
      <h1 style="font-size:23px; font-weight:900; letter-spacing:-0.02em; margin:0; display:flex; align-items:center; gap:10px; color:var(--text);">
        <span style="display:inline-flex; align-items:center; justify-content:center; width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.12)); border:1px solid rgba(96,165,250,0.35);">📋</span>
        Central de Ordens de Serviço & Suporte
      </h1>
      <p style="font-size:13.5px; color:var(--text-dim); margin:5px 0 0 0; font-weight:500;">
        Gerenciamento de solicitações de melhorias, resets de senha e correções abertas pelos usuários.
      </p>
    </div>
    <div class="head-actions" style="display:flex; gap:10px;">
      <button class="btn-ghost" onclick="syncOrdensWithServer().then(render)" style="display:flex; align-items:center; gap:6px; font-weight:700;">
        🔄 Atualizar Chamados
      </button>
    </div>
  </div>

  <div class="kpis" style="grid-template-columns:repeat(auto-fit, minmax(200px, 1fr)); gap:16px; margin-bottom:22px;">
    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:var(--text-dim); letter-spacing:0.02em;">Total de Chamados</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.15)); border:1.5px solid rgba(96,165,250,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">📋</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:var(--text); margin-bottom:2px;">\${countTotal}</div>
      <div class="sub" style="font-size:12px; color:#60A5FA; font-weight:600; margin-top:4px;">Todas as solicitações</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:#94A3B8; letter-spacing:0.02em;">Pendentes</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(245,158,11,0.25), rgba(217,119,6,0.15)); border:1.5px solid rgba(251,191,36,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">⏳</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#FBBF24; margin-bottom:2px;">\${countPendentes}</div>
      <div class="sub" style="font-size:12px; color:#FDE68A; font-weight:600; margin-top:4px;">Aguardando atendimento</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:#94A3B8; letter-spacing:0.02em;">Em Andamento</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(59,130,246,0.25), rgba(37,99,235,0.15)); border:1.5px solid rgba(96,165,250,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">⚙️</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#60A5FA; margin-bottom:2px;">\${countAndamento}</div>
      <div class="sub" style="font-size:12px; color:#BFDBFE; font-weight:600; margin-top:4px;">Sendo atendidos</div>
    </div>

    <div class="kpi" style="position:relative; overflow:hidden; padding:20px 22px; border-radius:20px; background:linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(15,23,42,0.68) 50%, rgba(10,15,29,0.80) 100%); backdrop-filter:blur(24px); -webkit-backdrop-filter:blur(24px); border:1px solid rgba(255,255,255,0.13); box-shadow:0 16px 40px -10px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.22);">
      <div class="row1" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:700; color:#94A3B8; letter-spacing:0.02em;">Concluídos</span>
        <div style="width:38px; height:38px; border-radius:50%; background:linear-gradient(135deg, rgba(16,185,129,0.25), rgba(5,150,105,0.15)); border:1.5px solid rgba(52,211,153,0.4); display:flex; align-items:center; justify-content:center; font-size:16px;">✅</div>
      </div>
      <div class="val" style="font-size:28px; font-weight:900; color:#10B981; margin-bottom:2px;">\${countConcluidas}</div>
      <div class="sub" style="font-size:12px; color:#A7F3D0; font-weight:600; margin-top:4px;">Finalizados com sucesso</div>
    </div>
  </div>

  <div class="table-panel" style="background:var(--card); border:1px solid var(--card-border); border-radius:20px; padding:22px; box-shadow:0 20px 50px rgba(0,0,0,0.5);">
    <div class="panel-head" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <h3 style="font-size:16px; font-weight:800; margin:0;">Fila de Solicitações</h3>
      <span class="tag" style="font-weight:700;">\${ordens.length} O.S. registradas</span>
    </div>

    <div class="filters" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px; align-items:center;">
      <div style="position:relative; flex:1.5; min-width:220px;">
        <input id="osSearchInput" placeholder="🔍 Buscar por protocolo, solicitante, e-mail ou assunto..." onkeyup="filterOrdensTable()" style="width:100%; font-size:13px; padding:9px 12px; border-radius:10px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text);">
      </div>
      <select id="osFilterStatus" onchange="filterOrdensTable()" style="flex:1; min-width:140px; padding:9px 12px; border-radius:10px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text);">
        <option value="">Todos os Status</option>
        <option value="pendente">⏳ Pendentes</option>
        <option value="andamento">⚙️ Em Andamento</option>
        <option value="concl">✅ Concluídos</option>
        <option value="canc">❌ Cancelados</option>
      </select>
      <select id="osFilterType" onchange="filterOrdensTable()" style="flex:1; min-width:160px; padding:9px 12px; border-radius:10px; background:var(--input-bg); border:1px solid var(--card-border); color:var(--text);">
        <option value="">Todos os Tipos</option>
        <option value="melhoria">Melhoria no Sistema</option>
        <option value="senha">Reset de Senha</option>
        <option value="correção">Correção de Dados</option>
        <option value="bug">Relato de Bug</option>
      </select>
    </div>

    <div id="osTableWrap">
      \${renderOrdensTable(ordens)}
    </div>
  </div>
  \`;
}

window.openOrdemAdminModal = function(id) {
  const ordem = (systemOrdens || []).find(o => String(o.id) === String(id));
  if (!ordem) return;

  const overlay = document.getElementById('overlayOrdemAdmin');
  if (!overlay) return;

  document.getElementById('osAdminCurrentId').value = ordem.id;
  document.getElementById('osAdminProtocolBadge').textContent = '#' + (ordem.protocol || ordem.id);
  document.getElementById('osAdminTitle').textContent = ordem.title || 'Solicitação sem assunto';
  document.getElementById('osAdminDate').textContent = 'Aberta em: ' + (ordem.created_at ? new Date(ordem.created_at).toLocaleString('pt-BR') : 'Data não informada');
  document.getElementById('osAdminClientName').textContent = ordem.client_name || 'Não informado';
  
  const emailEl = document.getElementById('osAdminClientEmail');
  if (emailEl) {
    emailEl.textContent = ordem.client_email || '';
    emailEl.href = 'mailto:' + (ordem.client_email || '');
  }

  document.getElementById('osAdminServiceType').textContent = ordem.service_type || 'Melhoria no Sistema';
  document.getElementById('osAdminDescription').textContent = ordem.description || 'Sem descrição detalhada.';
  
  const statusSel = document.getElementById('osAdminStatusSelect');
  if (statusSel) statusSel.value = ordem.status || 'Pendente';

  const notesEl = document.getElementById('osAdminNotes');
  if (notesEl) notesEl.value = ordem.admin_notes || '';

  const prioBadge = document.getElementById('osAdminPriorityBadge');
  if (prioBadge) {
    prioBadge.textContent = ordem.priority || 'Normal';
    const prio = (ordem.priority || '').toLowerCase();
    if (prio.includes('urg')) {
      prioBadge.style.background = 'rgba(239,68,68,0.2)';
      prioBadge.style.color = '#F87171';
      prioBadge.style.border = '1px solid rgba(239,68,68,0.4)';
    } else if (prio.includes('alt')) {
      prioBadge.style.background = 'rgba(245,158,11,0.2)';
      prioBadge.style.color = '#FBBF24';
      prioBadge.style.border = '1px solid rgba(245,158,11,0.4)';
    } else {
      prioBadge.style.background = 'rgba(16,185,129,0.2)';
      prioBadge.style.color = '#34D399';
      prioBadge.style.border = '1px solid rgba(16,185,129,0.4)';
    }
  }

  overlay.classList.add('show');
  overlay.style.display = 'flex';
};

window.closeOrdemAdminModal = function() {
  const overlay = document.getElementById('overlayOrdemAdmin');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(() => overlay.style.display = 'none', 200);
};

window.salvarOrdemAdmin = async function() {
  const id = document.getElementById('osAdminCurrentId')?.value;
  const status = document.getElementById('osAdminStatusSelect')?.value || 'Pendente';
  const notes = (document.getElementById('osAdminNotes')?.value || '').trim();

  if (!id) return;

  try {
    const res = await fetch(window.location.origin + '/api/ordens/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id, status: status, admin_notes: notes })
    });

    if (res.ok) {
      showToast('Ordem de Serviço atualizada com sucesso!');
      closeOrdemAdminModal();
      await syncOrdensWithServer();
      render();
    } else {
      showToast('Erro ao atualizar Ordem de Serviço.');
    }
  } catch(e) {
    showToast('Falha na comunicação com o servidor.');
  }
};

window.excluirOrdemAdmin = async function(paramId) {
  const id = paramId || document.getElementById('osAdminCurrentId')?.value;
  if (!id) return;

  if (!confirm('Deseja realmente excluir esta Ordem de Serviço?')) return;

  try {
    const res = await fetch(window.location.origin + '/api/ordens?id=' + id, {
      method: 'DELETE'
    });

    if (res.ok) {
      showToast('Ordem de Serviço removida com sucesso!');
      closeOrdemAdminModal();
      await syncOrdensWithServer();
      render();
    } else {
      showToast('Erro ao excluir Ordem de Serviço.');
    }
  } catch(e) {
    showToast('Falha na comunicação com o servidor.');
  }
};

/* ==================== Charts ==================== */
function drawDashboardCharts(){
  if (typeof Chart === 'undefined') return;
  try {
    const isLightMode = document.body.classList.contains('light') || document.documentElement.classList.contains('light');
    const periodTx = Array.isArray(transactions) ? transactions.filter(inPeriod) : [];
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
          borderColor: isLightMode ? '#FFFFFF' : 'rgba(16, 28, 22, 0.85)'
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
      data:{ labels:cats.map(c=>c.name), datasets:[{data: cats.length?cats.map(c=>c.val):[1], backgroundColor: cats.length?cats.map(c=>c.color):[isLightMode ? '#E2E8F0' : '#2a2f3a'], borderWidth:0}] },
      options:{cutout:'62%', plugins:{legend:{display:false}}}
    });
  } catch(e) {
    console.warn("Aviso ao gerar gráficos:", e);
  }
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
    const defaultDate = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
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
  const nameEl = document.getElementById('accName');
  const typeEl = document.getElementById('accType');
  const balanceEl = document.getElementById('accBalance');
  const colorEl = document.getElementById('accColor');

  const name = nameEl ? nameEl.value.trim() : '';
  const type = typeEl ? typeEl.value : 'Conta Corrente';
  const balanceRaw = balanceEl ? balanceEl.value : '';
  const balance = parseInputValue(balanceRaw);
  const color = colorEl ? colorEl.value : '#e8b04b';

  if(!name){
    showToast('⚠️ Por favor, informe o nome da conta ou cartão');
    if (nameEl) nameEl.focus();
    return;
  }

  const numBalance = isNaN(balance) ? 0 : balance;
  const isCredit = (type === 'Cartão de Crédito');

  if(editingAccId){
    const a = accounts.find(x=>x.id===editingAccId);
    if (a) {
      const oldName = a.name;
      Object.assign(a, {
        name,
        type,
        balance: numBalance,
        limit: isCredit ? numBalance : (a.limit || 0),
        color,
        isCard: isCredit,
        isCreditCard: isCredit
      });
      if(oldName!==name) transactions.forEach(t=>{ if(t.acc===oldName) t.acc = name; });
      showToast('Conta/Cartão atualizado com sucesso!');
      logActivity('Edição', 'Conta / Cartão', 'Editou conta/cartão "' + name + '" (' + type + ') com limite/saldo ' + fmt(numBalance));
    }
  } else {
    if (!nextAccId || isNaN(nextAccId)) {
      nextAccId = (accounts.reduce((max, acc) => Math.max(max, acc.id || 0), 0) || 0) + 1;
    }
    const newAcc = {
      id: nextAccId++,
      name,
      type,
      balance: numBalance,
      limit: isCredit ? numBalance : 0,
      color,
      isCard: isCredit,
      isCreditCard: isCredit
    };
    accounts.push(newAcc);
    showToast('Conta/Cartão cadastrado com sucesso!');
    await pushNotification('Nova conta/cartão cadastrado: ' + name + ' (' + type + ')', '🏦');
    logActivity('Criação', 'Conta / Cartão', 'Cadastrou nova conta/cartão "' + name + '" (' + type + ') com limite/saldo ' + fmt(numBalance));
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

let launchingRecId = null;

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

function populateRecStartMonthOptions() {
  const mSel = document.getElementById('recStartMonth');
  if(!mSel) return;
  mSel.innerHTML = MONTHS.map((m, idx) => '<option value="' + (idx+1) + '">' + m + '</option>').join('');
}

function toggleRecDurationMode() {
  const mode = document.getElementById('recDurationMode') ? document.getElementById('recDurationMode').value : 'custom';
  const box = document.getElementById('recCustomMonthsBox');
  if(box) box.style.display = mode === 'custom' ? 'block' : 'none';
}

function setRecQuickMonths(num) {
  const totalInput = document.getElementById('recTotalMonths');
  if(totalInput) {
    totalInput.value = num;
    updateRecMonthsPreview();
  }
}

function updateRecMonthsPreview() {
  const totalInput = document.getElementById('recTotalMonths');
  const preview = document.getElementById('recMonthsCountPreview');
  if(!totalInput) return;
  const num = parseInt(totalInput.value) || 0;
  if(preview) {
    preview.textContent = num > 0 ? (num + (num === 1 ? ' mês selecionado' : ' meses selecionados')) : 'Indeterminado';
  }
  document.querySelectorAll('.rec-chip-btn').forEach(btn => {
    const m = parseInt(btn.getAttribute('data-months'));
    btn.classList.toggle('active', m === num);
  });
}

function openRecurringModal(id){
  if(categories.length===0){ showToast('Cadastre uma categoria antes de criar um recorrente'); return; }
  editingRecId = id || null;
  populateRecStartMonthOptions();
  document.getElementById('overlayRecurring').classList.add('show');
  
  let selectedAcc = accounts[0] ? accounts[0].name : 'Boleto / Outros';

  if(id){
    const r = recurringList.find(x=>x.id===id);
    document.getElementById('recModalTitle').textContent = 'Editar Recorrente';
    document.getElementById('recDesc').value = r.desc;
    document.getElementById('recVal').value = r.val;
    document.getElementById('recDay').value = r.day;
    document.getElementById('recFreq').value = r.freq || 'Mensal';
    if(r.acc) selectedAcc = r.acc;
    setRecType(r.type);
    const cSel = document.getElementById('recCategoria');
    if(cSel) cSel.value = r.cat;
    
    const isFixed = (r.totalMonths && parseInt(r.totalMonths) > 0);
    document.getElementById('recDurationMode').value = isFixed ? 'custom' : 'infinite';
    document.getElementById('recTotalMonths').value = isFixed ? r.totalMonths : 12;
    document.getElementById('recStartMonth').value = r.startMonth || (currentPeriod.month === 0 ? (new Date().getMonth() + 1) : currentPeriod.month);
    document.getElementById('recStartYear').value = r.startYear || currentPeriod.year || (new Date().getFullYear());
    document.getElementById('recAppliedMonths').value = r.appliedMonths || 0;
    document.getElementById('recAppliedField').style.display = 'block';
  } else {
    const now = new Date();
    document.getElementById('recModalTitle').textContent = 'Novo Lançamento Recorrente';
    document.getElementById('recDesc').value = '';
    document.getElementById('recVal').value = '';
    document.getElementById('recDay').value = '5';
    document.getElementById('recFreq').value = 'Mensal';
    document.getElementById('recDurationMode').value = 'custom';
    document.getElementById('recTotalMonths').value = '12';
    document.getElementById('recStartMonth').value = now.getMonth() + 1;
    document.getElementById('recStartYear').value = now.getFullYear();
    document.getElementById('recAppliedMonths').value = '0';
    document.getElementById('recAppliedField').style.display = 'none';
    setRecType('out');
  }
  toggleRecDurationMode();
  updateRecMonthsPreview();
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
  const durMode = document.getElementById('recDurationMode').value;
  
  const nowRec = new Date();
  let totalMonths = 0;
  let startMonth = nowRec.getMonth() + 1;
  let startYear = nowRec.getFullYear();
  let appliedMonths = 0;

  if (durMode === 'custom') {
    totalMonths = parseInt(document.getElementById('recTotalMonths').value) || 12;
    startMonth = parseInt(document.getElementById('recStartMonth').value) || startMonth;
    startYear = parseInt(document.getElementById('recStartYear').value) || startYear;
    if (editingRecId) {
      appliedMonths = parseInt(document.getElementById('recAppliedMonths').value) || 0;
    }
  } else {
    if (editingRecId) {
      const existing = recurringList.find(r=>r.id===editingRecId);
      if (existing) appliedMonths = existing.appliedMonths || 0;
    }
  }

  if(!desc || isNaN(val) || val<=0 || isNaN(day) || day<1 || day>31){ showToast('Preencha os campos corretamente'); return; }
  
  if(editingRecId){
    Object.assign(recurringList.find(r=>r.id===editingRecId), {desc,val,day,cat,acc:accSel,freq,type:currentRecType,totalMonths,startMonth,startYear,appliedMonths});
    showToast('Recorrente atualizado!');
    logActivity('Edição', 'Recorrente', 'Editou lançamento recorrente "' + desc + '" (' + fmt(val) + (totalMonths > 0 ? ', ' + totalMonths + ' meses' : '') + ')');
  } else {
    const newRec = {id: nextRecId++, desc,val,day,cat,acc:accSel,freq,type:currentRecType,totalMonths,startMonth,startYear,appliedMonths:0,appliedPeriods:[]};
    
    // Gera mês a mês no extrato até finalizar a duração cadastrada
    const targetAcc = accounts.find(a => a.name === accSel);
    const accId = targetAcc ? targetAcc.id : null;
    const finalAccName = targetAcc ? targetAcc.name : accSel;
    const genCount = totalMonths > 0 ? totalMonths : 1;

    for (let k = 1; k <= genCount; k++) {
      const monthZero = (startMonth - 1) + (k - 1);
      const y = startYear + Math.floor(monthZero / 12);
      const m = (monthZero % 12) + 1;
      const date = pdCustom(y, m, day);
      const itemDesc = totalMonths > 0 ? (desc + ' (' + k + '/' + totalMonths + ')') : desc;

      transactions.unshift({
        id: nextTxId++,
        desc: itemDesc,
        val: val,
        date: date,
        cat: cat,
        acc: finalAccName,
        accId: accId,
        status: currentRecType === 'in' ? 'Recebido' : 'Pago',
        type: currentRecType,
        installment: totalMonths > 0 ? (k + '/' + totalMonths) : null,
        recurringId: newRec.id
      });

      newRec.appliedPeriods.push(y + '-' + String(m).padStart(2, '0'));
    }

    newRec.appliedMonths = genCount;
    recurringList.push(newRec);

    showToast(totalMonths > 0 ? ('Recorrente cadastrado! ' + totalMonths + ' meses gerados mês a mês no extrato até finalizar.') : 'Recorrente contínuo cadastrado!');
    logActivity('Criação', 'Recorrente', 'Cadastrou lançamento recorrente "' + desc + '" (' + fmt(val) + (totalMonths > 0 ? ', ' + totalMonths + ' meses gerados mês a mês' : '') + ')');
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

function openLaunchRecurringModal(id){
  const r = recurringList.find(x=>x.id===id);
  if(!r) return;
  launchingRecId = id;

  const totalM = r.totalMonths ? parseInt(r.totalMonths) : 0;
  const appliedM = r.appliedMonths ? parseInt(r.appliedMonths) : 0;
  const remainingM = Math.max(0, totalM - appliedM);
  const nextInstallmentNum = appliedM + 1;
  const isCompleted = totalM > 0 && appliedM >= totalM;
  const pct = totalM > 0 ? Math.min(100, Math.round((appliedM / totalM) * 100)) : 0;

  const startM = r.startMonth || (currentPeriod.month === 0 ? (new Date().getMonth() + 1) : currentPeriod.month);
  const startY = r.startYear || currentPeriod.year || (new Date().getFullYear());
  const monthZero = (startM - 1) + (nextInstallmentNum - 1);
  const nextTargetYear = startY + Math.floor(monthZero / 12);
  const nextTargetMonth = (monthZero % 12) + 1;
  const nextMonthName = (MONTHS[nextTargetMonth - 1] || ('Mês ' + nextTargetMonth)) + ' / ' + nextTargetYear;

  const totalValContratado = totalM > 0 ? (r.val * totalM) : r.val;

  const summaryEl = document.getElementById('launchRecSummaryCard');
  if (summaryEl) {
    summaryEl.innerHTML = 
      '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">' +
        '<div>' +
          '<h3 style="margin:0 0 4px 0; font-size:15px; font-weight:800; color:var(--text);">' + r.desc + '</h3>' +
          '<div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">' +
            '<span class="pill cat-pill" style="background:' + catColor(r.cat) + '18; color:' + catColor(r.cat) + '; border:1px solid ' + catColor(r.cat) + '35; font-size:10.5px; padding:2px 8px;">' + catIcon(r.cat) + ' ' + r.cat + '</span>' +
            '<span class="pill acc-pill" style="font-size:10.5px; padding:2px 8px;">' + getAccountIcon(r.acc) + ' ' + r.acc + '</span>' +
            '<span class="pill" style="background:rgba(245,158,11,0.14); color:var(--orange); font-size:10.5px; padding:2px 8px; font-weight:700;">Dia ' + r.day + '</span>' +
          '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:16px; font-weight:800; color:' + (r.type==='in'?'var(--green)':'var(--red)') + ';">' + (r.type==='in'?'+':'-') + fmt(r.val) + '/mês</div>' +
          (totalM > 0 ? ('<div style="font-size:11px; color:var(--text-dim);">Total: ' + fmt(totalValContratado) + '</div>') : '') +
        '</div>' +
      '</div>' +
      '<div style="margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.06);">' +
        '<div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:5px;">' +
          '<span style="color:var(--text); font-weight:700;">Duração Cadastrada: <strong style="color:var(--blue);">' + totalM + ' meses</strong></span>' +
          '<span style="font-weight:800; color:' + (isCompleted ? 'var(--green)' : 'var(--text-dim)') + ';">' + appliedM + '/' + totalM + ' lançados (' + pct + '%)</span>' +
        '</div>' +
        '<div class="rec-progress-bar" style="height:7px;">' +
          '<div class="rec-progress-fill" style="width:' + pct + '%; background:' + (isCompleted ? 'var(--green)' : (pct > 50 ? 'var(--blue)' : 'var(--orange)')) + ';"></div>' +
        '</div>' +
        '<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-dim); margin-top:5px;">' +
          '<span>Início: ' + (MONTHS[startM-1] || startM) + '/' + startY + '</span>' +
          '<span>' + (isCompleted ? '✓ 100% aplicado' : ('Próximo: ' + nextMonthName)) + '</span>' +
        '</div>' +
      '</div>';
  }

  const btnNext = document.getElementById('btnLaunchNextMonth');
  const btnNextLabel = document.getElementById('btnLaunchNextMonthLabel');
  const btnNextPill = document.getElementById('launchNextMonthPill');
  if (btnNext) {
    if (isCompleted) {
      if (btnNextLabel) btnNextLabel.textContent = 'Lançar Mês Extra (' + nextInstallmentNum + '/' + totalM + ')';
      if (btnNextPill) btnNextPill.textContent = 'Mês ' + nextInstallmentNum + ' (Adicional)';
    } else {
      if (btnNextLabel) btnNextLabel.textContent = 'Lançar Próximo Mês (' + nextMonthName + ')';
      if (btnNextPill) btnNextPill.textContent = 'Mês ' + nextInstallmentNum + ' de ' + totalM;
    }
    btnNext.onclick = () => executeLaunchRecurring(id, 'single');
  }

  const btnAll = document.getElementById('btnLaunchAllMonths');
  const btnAllLabel = document.getElementById('btnLaunchAllMonthsLabel');
  const btnAllPill = document.getElementById('launchAllMonthsPill');
  if (btnAll) {
    if (isCompleted || remainingM <= 1) {
      btnAll.style.display = 'none';
    } else {
      btnAll.style.display = 'flex';
      if (btnAllLabel) btnAllLabel.textContent = 'Lançar Todos os ' + remainingM + ' Meses Restantes em Lote';
      if (btnAllPill) btnAllPill.textContent = 'Gera ' + remainingM + ' meses';
      btnAll.onclick = () => executeLaunchRecurring(id, 'all');
    }
  }

  const btnSelected = document.getElementById('btnLaunchSelectedPeriod');
  const selectedLabel = document.getElementById('launchSelectedPeriodLabel');
  if (btnSelected) {
    if (selectedLabel) selectedLabel.textContent = periodLabel();
    btnSelected.onclick = () => executeLaunchRecurring(id, 'current_period');
  }

  const btnReset = document.getElementById('btnResetRecCount');
  if (btnReset) {
    btnReset.style.display = appliedM > 0 ? 'flex' : 'none';
    btnReset.onclick = () => resetRecurringProgress(id);
  }

  document.getElementById('overlayLaunchRecurring').classList.add('show');
}

function closeLaunchRecurringModal(){
  document.getElementById('overlayLaunchRecurring').classList.remove('show');
  launchingRecId = null;
}

async function resetRecurringProgress(id){
  const r = recurringList.find(x=>x.id===id);
  if(!r) return;
  if(!confirm('Deseja reiniciar a contagem de meses lançados de "' + r.desc + '" para 0? (As transações já geradas permanecerão intactas no extrato)')) return;
  r.appliedMonths = 0;
  r.appliedPeriods = [];
  await saveUserData();
  showToast('Contagem de meses reiniciada com sucesso!');
  closeLaunchRecurringModal();
  render();
}

async function executeLaunchRecurring(id, mode){
  const r = recurringList.find(x=>x.id===id);
  if(!r) return;

  const totalM = r.totalMonths ? parseInt(r.totalMonths) : 0;
  const targetAcc = accounts.find(a => a.name === r.acc);
  const accId = targetAcc ? targetAcc.id : null;
  const finalAccName = targetAcc ? targetAcc.name : r.acc;

  if (!Array.isArray(r.appliedPeriods)) r.appliedPeriods = [];

  const startM = r.startMonth || (currentPeriod.month === 0 ? (new Date().getMonth() + 1) : currentPeriod.month);
  const startY = r.startYear || currentPeriod.year || (new Date().getFullYear());

  if (mode === 'single') {
    const k = (parseInt(r.appliedMonths) || 0) + 1;
    const monthZero = (startM - 1) + (k - 1);
    const y = startY + Math.floor(monthZero / 12);
    const m = (monthZero % 12) + 1;
    const date = pdCustom(y, m, r.day);
    const desc = totalM > 0 ? (r.desc + ' (' + k + '/' + totalM + ')') : r.desc;

    transactions.unshift({
      id: nextTxId++,
      desc,
      val: r.val,
      date,
      cat: r.cat,
      acc: finalAccName,
      accId,
      status: r.type==='in'?'Recebido':'Pago',
      type: r.type,
      installment: totalM > 0 ? (k + '/' + totalM) : null,
      recurringId: r.id
    });

    r.appliedMonths = k;
    r.appliedPeriods.push(y + '-' + String(m).padStart(2,'0'));
    await saveUserData();
    closeLaunchRecurringModal();
    showToast(totalM > 0 ? ('Lançado mês ' + k + ' de ' + totalM + ' ("' + r.desc + '") com sucesso em ' + (MONTHS[m-1] || m) + '/' + y + '!') : ('Lançamento gerado em ' + (MONTHS[m-1] || m) + '/' + y + '!'));
    logActivity('Lançamento', 'Recorrente', 'Aplicou mês ' + k + '/' + (totalM || '∞') + ' do recorrente "' + r.desc + '" (' + fmt(r.val) + ')');
    render();
  }
  else if (mode === 'all') {
    const startK = (parseInt(r.appliedMonths) || 0) + 1;
    const endK = totalM;
    if (startK > endK) {
      showToast('Todos os meses já foram lançados!');
      return;
    }

    let addedCount = 0;
    for (let k = startK; k <= endK; k++) {
      const monthZero = (startM - 1) + (k - 1);
      const y = startY + Math.floor(monthZero / 12);
      const m = (monthZero % 12) + 1;
      const date = pdCustom(y, m, r.day);
      const desc = r.desc + ' (' + k + '/' + totalM + ')';

      transactions.unshift({
        id: nextTxId++,
        desc,
        val: r.val,
        date,
        cat: r.cat,
        acc: finalAccName,
        accId,
        status: r.type==='in'?'Recebido':'Pago',
        type: r.type,
        installment: k + '/' + totalM,
        recurringId: r.id
      });
      r.appliedPeriods.push(y + '-' + String(m).padStart(2,'0'));
      addedCount++;
    }

    r.appliedMonths = endK;
    await saveUserData();
    closeLaunchRecurringModal();
    showToast('Todos os ' + addedCount + ' meses restantes de "' + r.desc + '" foram gerados com sucesso!');
    logActivity('Lançamento', 'Recorrente', 'Gerou em lote ' + addedCount + ' meses do recorrente "' + r.desc + '" (total de ' + totalM + ' meses)');
    render();
  }
  else if (mode === 'current_period') {
    const k = (parseInt(r.appliedMonths) || 0) + 1;
    const y = currentPeriod.year;
    const m = currentPeriod.month === 0 ? (new Date().getMonth() + 1) : currentPeriod.month;
    const date = pdCustom(y, m, r.day);
    const desc = totalM > 0 ? (r.desc + ' (' + k + '/' + totalM + ')') : r.desc;

    transactions.unshift({
      id: nextTxId++,
      desc,
      val: r.val,
      date,
      cat: r.cat,
      acc: finalAccName,
      accId,
      status: r.type==='in'?'Recebido':'Pago',
      type: r.type,
      installment: totalM > 0 ? (k + '/' + totalM) : null,
      recurringId: r.id
    });

    r.appliedMonths = k;
    r.appliedPeriods.push(y + '-' + String(m).padStart(2,'0'));
    await saveUserData();
    closeLaunchRecurringModal();
    showToast('Lançamento gerado em ' + periodLabel() + '!');
    logActivity('Lançamento', 'Recorrente', 'Lançou recorrente "' + r.desc + '" em ' + periodLabel());
    render();
  }
}

async function lancarRecorrente(id){
  const r = recurringList.find(x=>x.id===id);
  if (!r) return;

  const totalM = r.totalMonths ? parseInt(r.totalMonths) : 0;
  if (totalM > 0) {
    openLaunchRecurringModal(id);
  } else {
    // Contínuo
    const y = currentPeriod.year;
    const m = currentPeriod.month === 0 ? (new Date().getMonth() + 1) : currentPeriod.month;
    const date = pdCustom(y, m, r.day);
    const targetAcc = accounts.find(a => a.name === r.acc);
    const accId = targetAcc ? targetAcc.id : null;
    const finalAccName = targetAcc ? targetAcc.name : r.acc;

    transactions.unshift({
      id: nextTxId++,
      desc: r.desc,
      val: r.val,
      date,
      cat: r.cat,
      acc: finalAccName,
      accId,
      status: r.type==='in'?'Recebido':'Pago',
      type: r.type,
      recurringId: r.id
    });

    r.appliedMonths = (parseInt(r.appliedMonths) || 0) + 1;
    await saveUserData();
    showToast('Lançamento gerado em ' + periodLabel() + '!');
    logActivity('Lançamento', 'Recorrente', 'Lançou recorrente contínuo "' + r.desc + '" em ' + periodLabel());
    render();
  }
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

let isCreatingNewUserAdmin = false;

async function openAdminCreateUserModal(){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  isCreatingNewUserAdmin = true;
  editingUserEmail = null;
  const modalTitle = document.querySelector('#overlayUserAdmin h2');
  if(modalTitle) modalTitle.textContent = 'Cadastrar Novo Usuário';
  const passHint = document.getElementById('userAdminPasswordHint');
  if(passHint) passHint.textContent = 'Informe a senha inicial do novo usuário (mínimo 6 caracteres)';
  const emailInput = document.getElementById('userAdminEmail');
  if(emailInput) {
    emailInput.disabled = false;
    emailInput.style.opacity = '1';
    emailInput.value = '';
    emailInput.placeholder = 'email.usuario@exemplo.com';
  }
  document.getElementById('userAdminName').value = '';
  document.getElementById('userAdminRole').value = 'Usuário';
  document.getElementById('userAdminPassword').value = '';
  document.getElementById('userAdminPassword').type = 'password';
  bindPasswordToggle('userAdminPassword', 'userAdminPasswordToggle');
  document.getElementById('overlayUserAdmin').classList.add('show');
}

async function openUserAdminModal(email){
  await syncUsersWithServer();
  if(!currentUser || currentUser.role !== 'Administrador') return;
  const u = registeredUsers.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(!u) return;
  isCreatingNewUserAdmin = false;
  editingUserEmail = email;
  const modalTitle = document.querySelector('#overlayUserAdmin h2');
  if(modalTitle) modalTitle.textContent = 'Editar Usuário';
  const passHint = document.getElementById('userAdminPasswordHint');
  if(passHint) passHint.textContent = 'Deixe em branco para manter a senha atual';
  const emailInput = document.getElementById('userAdminEmail');
  if(emailInput) {
    emailInput.disabled = true;
    emailInput.style.opacity = '0.6';
    emailInput.value = u.email;
  }
  document.getElementById('userAdminName').value = u.name;
  document.getElementById('userAdminRole').value = u.role;
  document.getElementById('userAdminPassword').value = '';
  document.getElementById('userAdminPassword').type = 'password';
  bindPasswordToggle('userAdminPassword', 'userAdminPasswordToggle');
  document.getElementById('overlayUserAdmin').classList.add('show');
}

function closeUserAdminModal(){
  document.getElementById('overlayUserAdmin').classList.remove('show');
  editingUserEmail = null;
  isCreatingNewUserAdmin = false;
}

async function saveUserAdmin(){
  await syncUsersWithServer();
  const name = document.getElementById('userAdminName').value.trim();
  const role = document.getElementById('userAdminRole').value;
  const newPass = document.getElementById('userAdminPassword').value.trim();

  if(!name){ showToast('Informe um nome para o usuário'); return; }

  if (isCreatingNewUserAdmin) {
    const email = document.getElementById('userAdminEmail').value.trim().toLowerCase();
    if(!email || !email.includes('@')){ showToast('Informe um e-mail válido'); return; }
    if(registeredUsers.some(x => x.email.toLowerCase() === email)){
      showToast('Este e-mail já está cadastrado no sistema');
      return;
    }
    if(!newPass || newPass.length < 6){
      showToast('A senha inicial deve ter no mínimo 6 caracteres');
      return;
    }
    const newUser = {
      name,
      email,
      password: newPass,
      role,
      active: true,
      created_at: new Date().toISOString()
    };
    registeredUsers.push(newUser);
    await saveUsersToServer();
    showToast('Usuário cadastrado com sucesso!');
    logActivity('Criação', 'Usuário', 'Administrador cadastrou novo usuário: ' + email + ' (' + name + ', ' + role + ')');
    closeUserAdminModal();
    render();
    return;
  }

  if(!editingUserEmail) return;
  const u = registeredUsers.find(x=>x.email.toLowerCase()===editingUserEmail.toLowerCase());
  if(!u) return;
  if(u.role === 'Administrador' && role !== 'Administrador' && registeredUsers.filter(x=>x.role==='Administrador').length <= 1){
    showToast('É necessário manter ao menos um administrador');
    return;
  }
  u.name = name;
  u.role = role;
  if(newPass) u.password = newPass;
  await saveUsersToServer();
  if(currentUser && currentUser.email.toLowerCase() === u.email.toLowerCase()){
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
  document.querySelectorAll('[data-deluser]').forEach(el=>el.onclick = ()=>deleteUserAdmin(el.getAttribute('data-deluser')));

  if (!window._adminUserEventsDelegated) {
    window._adminUserEventsDelegated = true;
    document.addEventListener('click', (e) => {
      const editBtn = e.target.closest('[data-edituser]');
      if (editBtn) {
        e.preventDefault();
        openUserAdminModal(editBtn.getAttribute('data-edituser'));
        return;
      }
      const viewBtn = e.target.closest('[data-viewuser]');
      if (viewBtn) {
        e.preventDefault();
        viewUserData(viewBtn.getAttribute('data-viewuser'));
        return;
      }
      const toggleBtn = e.target.closest('[data-toggleuser]');
      if (toggleBtn) {
        e.preventDefault();
        toggleUserActive(toggleBtn.getAttribute('data-toggleuser'));
        return;
      }
      const delBtn = e.target.closest('[data-deluser]');
      if (delBtn) {
        e.preventDefault();
        deleteUserAdmin(delBtn.getAttribute('data-deluser'));
        return;
      }
    });
  }

  const importFile = document.getElementById('importFile'); if(importFile) importFile.onchange = handleImportFile;
  const importDropZone = document.getElementById('importDropZone');
  if(importDropZone) {
    importDropZone.ondragover = (e) => { e.preventDefault(); importDropZone.style.borderColor = 'var(--green)'; importDropZone.style.background = 'rgba(34,197,94,0.1)'; };
    importDropZone.ondragleave = () => { importDropZone.style.borderColor = 'var(--green)'; importDropZone.style.background = 'rgba(34,197,94,0.04)'; };
    importDropZone.ondrop = (e) => {
      e.preventDefault();
      importDropZone.style.borderColor = 'var(--green)';
      importDropZone.style.background = 'rgba(34,197,94,0.04)';
      if(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleImportFile({ target: { files: e.dataTransfer.files } });
      }
    };
  }

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

        const isValidEmail = (str) => {
          if (!str || typeof str !== 'string') return false;
          const at = str.indexOf('@');
          const dot = str.lastIndexOf('.');
          return at > 0 && dot > at + 1 && dot < str.length - 1 && !str.includes(' ');
        };
        if(!newEmail || !isValidEmail(newEmail)){ showToast('Informe um e-mail válido'); return; }
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
    const yearSel = document.getElementById('periodYearSel');
    const monthSel = document.getElementById('periodMonthSel');
    const availableYears = getAvailableYears();

    const buildMonths = (keepSelectedMonth = false)=>{
      if(!yearSel || !monthSel) return;
      const currentSelectedMonth = keepSelectedMonth ? parseInt(monthSel.value) : NaN;
      const y = parseInt(yearSel.value) || new Date().getFullYear();
      let start=1, end=12;
      if(y===PERIOD_MIN.year) start = PERIOD_MIN.month;
      if(y===PERIOD_MAX.year) end = PERIOD_MAX.month;
      const opts = [];
      for(let m=start; m<=end; m++) opts.push(m);
      monthSel.innerHTML = opts.map(m=>\`<option value="\${m}">\${MONTHS[m-1]}</option>\`).join('');

      let targetMonth;
      if (!isNaN(currentSelectedMonth) && currentSelectedMonth >= 1 && currentSelectedMonth <= 12) {
        targetMonth = currentSelectedMonth;
      } else if (currentPeriod.month > 0) {
        targetMonth = currentPeriod.month;
      } else {
        targetMonth = new Date().getMonth() + 1;
      }
      monthSel.value = opts.includes(targetMonth) ? targetMonth : opts[0];
    };

    const syncPeriodSelectors = ()=>{
      if(yearSel){
        yearSel.innerHTML = availableYears.map(y=>\`<option value="\${y}">\${y}</option>\`).join('');
        yearSel.value = currentPeriod.year || new Date().getFullYear();
      }
      buildMonths(false);
    };

    syncPeriodSelectors();

    periodBtn.onclick = (e)=>{
      e.stopPropagation();
      const panel = document.getElementById('periodPanel');
      if(panel){
        const willShow = !panel.classList.contains('show');
        if(willShow){
          syncPeriodSelectors();
        }
        panel.classList.toggle('show', willShow);
        periodBtn.classList.toggle('open', willShow);
      }
    };

    const periodPanelEl = document.getElementById('periodPanel');
    if(periodPanelEl){
      periodPanelEl.onclick = (e) => e.stopPropagation();
    }

    if(yearSel){
      yearSel.onchange = () => buildMonths(true);
    }

    const applyBtn = document.getElementById('periodApplyBtn');
    if(applyBtn){
      applyBtn.onclick = ()=>{
        currentPeriod = { year: parseInt(yearSel.value), month: parseInt(document.getElementById('periodMonthSel').value) };
        try { localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod)); } catch(e){}
        document.getElementById('periodPanel').classList.remove('show');
        periodBtn.classList.remove('open');
        render();
      };
    }

    const todayBtn = document.getElementById('periodTodayBtn');
    if(todayBtn){
      todayBtn.onclick = ()=>{
        const now = new Date();
        currentPeriod = { year: now.getFullYear(), month: now.getMonth() + 1 };
        try { localStorage.setItem('fin_current_period', JSON.stringify(currentPeriod)); } catch(e){}
        document.getElementById('periodPanel').classList.remove('show');
        periodBtn.classList.remove('open');
        render();
      };
    }

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
  const validPages = ['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'funcoes', 'usuarios', 'logs', 'ordens', 'config'];
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

const sidebarAccountCard = document.getElementById('sidebarAccountCard');
if(sidebarAccountCard){
  sidebarAccountCard.addEventListener('click', ()=>{
    navigate('config');
  });
}

const sidebarThemeBtn = document.getElementById('sidebarThemeBtn');
if(sidebarThemeBtn){
  sidebarThemeBtn.addEventListener('click', ()=>{
    const miniBtn = document.getElementById('miniThemeBtn');
    if(miniBtn) miniBtn.click();
  });
}

const sidebarLogoutBtn = document.getElementById('sidebarLogoutBtn');
if(sidebarLogoutBtn){
  sidebarLogoutBtn.addEventListener('click', ()=>{
    const lBtn = document.getElementById('logoutBtn');
    if(lBtn) lBtn.click();
  });
}
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
  accNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveAccount();
    }
  });
}

const accBalanceInput = document.getElementById('accBalance');
if (accBalanceInput) {
  accBalanceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveAccount();
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

const recDurModeEl = document.getElementById('recDurationMode');
if(recDurModeEl) recDurModeEl.onchange = toggleRecDurationMode;

const recTotalMonthsEl = document.getElementById('recTotalMonths');
if(recTotalMonthsEl) {
  recTotalMonthsEl.oninput = updateRecMonthsPreview;
  recTotalMonthsEl.onchange = updateRecMonthsPreview;
}

document.querySelectorAll('.rec-chip-btn').forEach(btn => {
  btn.onclick = () => {
    const m = parseInt(btn.getAttribute('data-months'));
    if (!isNaN(m)) setRecQuickMonths(m);
  };
});

const closeLaunchRecBtn = document.getElementById('closeLaunchRecModal');
if(closeLaunchRecBtn) closeLaunchRecBtn.onclick = closeLaunchRecurringModal;

const launchRecCancelBtn = document.getElementById('launchRecCancelBtn');
if(launchRecCancelBtn) launchRecCancelBtn.onclick = closeLaunchRecurringModal;

const overlayLaunchRecEl = document.getElementById('overlayLaunchRecurring');
if(overlayLaunchRecEl) {
  overlayLaunchRecEl.addEventListener('click', e => {
    if(e.target.id === 'overlayLaunchRecurring') closeLaunchRecurringModal();
  });
}

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
bindDualPasswordToggle('regPassword', 'regConfirmPassword', 'regPasswordToggle');

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
  var scaleNum = 1;

  if (scaleVal === 'auto') {
    var w = window.innerWidth || screen.width || 1366;
    var h = window.innerHeight || screen.height || 768;

    if (w <= 640) {
      scaleNum = 1.0;
      effectiveScale = '100%';
    } else if (w <= 1024) {
      scaleNum = 0.88;
      effectiveScale = '88%';
    } else if (w < 1280 || h < 720) {
      scaleNum = 0.80;
      effectiveScale = '80%';
    } else if (w < 1440 || h < 820) {
      scaleNum = 0.85;
      effectiveScale = '85%';
    } else if (w < 1680 || h < 950) {
      scaleNum = 0.92;
      effectiveScale = '92%';
    } else if (w <= 1920 && h <= 1080) {
      scaleNum = 1.0;
      effectiveScale = '100%';
    } else if (w < 2560) {
      scaleNum = 1.10;
      effectiveScale = '110%';
    } else {
      scaleNum = 1.20;
      effectiveScale = '120%';
    }
  } else {
    scaleNum = parseFloat(scaleVal) / 100 || 1;
    effectiveScale = scaleVal;
  }

  document.documentElement.style.setProperty('--app-zoom', scaleNum);
  if (document.body) {
    document.body.style.zoom = scaleNum;
  }

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
      
      const em = (cachedUser && cachedUser.email) || (session && session.email);
      currentUser = cachedUser || { email: em, name: em.split('@')[0], role: 'Usuário' };

      const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
      const savedPage = localStorage.getItem('nexus_current_page');
      const pageTarget = hashPage || savedPage;

      if (currentUser.role === 'Administrador') {
        document.documentElement.classList.add('is-admin');
        if (['logs', 'funcoes', 'usuarios', 'ordens'].includes(pageTarget)) {
          currentPage = pageTarget;
        } else {
          currentPage = 'usuarios';
        }
      } else {
        document.documentElement.classList.remove('is-admin');
        if (['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'config'].includes(pageTarget)) {
          currentPage = pageTarget;
        } else {
          currentPage = 'dashboard';
        }
      }
      if (typeof updateHeaderUser === 'function') updateHeaderUser();
      if (typeof updateAdminMenuVisibility === 'function') updateAdminMenuVisibility();

      const cleanEmail = (currentUser.email || '').toLowerCase().trim();
      const userKey = 'nexus_data_' + cleanEmail;
      const localData = loadFromStorage(userKey, null);
      if (localData) {
        applyDataPayload(localData);
      }
      if (typeof render === 'function') render();
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

  const hashPage = window.location.hash ? window.location.hash.replace('#', '') : null;
  const savedPage = localStorage.getItem('nexus_current_page');
  const pageTarget = hashPage || savedPage || currentPage;

  if (currentUser.role === 'Administrador') {
    if (['logs', 'funcoes', 'usuarios', 'ordens'].includes(pageTarget)) {
      currentPage = pageTarget;
    } else {
      currentPage = 'usuarios';
    }
  } else {
    if (['dashboard', 'transacoes', 'cartoes', 'orcamentos', 'metas', 'relatorios', 'recorrentes', 'importar', 'anexos', 'alertas', 'config'].includes(pageTarget)) {
      currentPage = pageTarget;
    } else {
      currentPage = 'dashboard';
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
          const uName = currentUser ? currentUser.name : 'Usuário';
          showExecutiveWelcomeToast('Sessão Autenticada com Sucesso', 'Bem-vindo de volta, <strong>' + uName + '</strong>! Ambiente financeiro sincronizado e protegido.');
        }, 350);
      }
    } catch(e){}
  }
  checkAndShowJustLoggedInPopup();
  document.addEventListener('DOMContentLoaded', checkAndShowJustLoggedInPopup);
})();

// Relógio e Data em Tempo Real no Topo
(function initHeaderClock() {
  function updateClock() {
    const el = document.getElementById('headerLiveTimeText');
    if (!el) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
    el.textContent = dateStr + ' • ' + timeStr;
  }
  updateClock();
  setInterval(updateClock, 1000);
})();

// Engine de Simulação Financeira 4K Ultra-HD (Candlesticks Reais de Mercado, Fitas EMA, Moedas & Física de Cursor)
(function initFinancialCanvasEngine() {
  function setupCanvas(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let dpr = 1;
    let width = 0;
    let height = 0;
    let mouse = { x: -1000, y: -1000, targetX: -1000, targetY: -1000, active: false };

    window.addEventListener('mousemove', (e) => {
      mouse.targetX = e.clientX;
      mouse.targetY = e.clientY;
      mouse.active = true;
    });
    window.addEventListener('mouseleave', () => {
      mouse.active = false;
      mouse.targetX = -1000;
      mouse.targetY = -1000;
    });

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 3);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      ctx.scale(dpr, dpr);
    }
    resize();
    window.addEventListener('resize', resize);

    // 1. Simulação de Evolução Patrimonial Pessoal ao Longo do Ano
    const monthMilestones = [
      { month: 'Jan', val: 12500 },
      { month: 'Fev', val: 14800 },
      { month: 'Mar', val: 16900 },
      { month: 'Abr', val: 19400 },
      { month: 'Mai', val: 22100 },
      { month: 'Jun', val: 24700 },
      { month: 'Jul', val: 27900 },
      { month: 'Ago', val: 30800 },
      { month: 'Set', val: 33400 },
      { month: 'Out', val: 36200 },
      { month: 'Nov', val: 39500 },
      { month: 'Dez', val: 43800 }
    ];

    const badgeTexts = [
      'Economia: +18% 🎯',
      'Reserva: 100% 🛡️',
      'Contas em Dia ✓',
      'Orçamento: 85% 📊',
      'Meta Concluída: 84% 🚀',
      'Poupança: +R$ 1.500',
      'Renda Sob Controle',
      'Planejamento 2026',
      'Saldo Positivo ↗',
      'Sonhos em Andamento ✨'
    ];
    const currencyCoins = ['R$', '$', '€', '£'];
    const colors = ['#38BDF8', '#F59E0B', '#10B981', '#818CF8', '#FBBF24', '#60A5FA', '#34D399'];

    // 2. Elementos Financeiros Flutuantes com Profundidade
    const items = [];
    const itemCount = 38;
    for (let i = 0; i < itemCount; i++) {
      const kind = i % 2;
      items.push({
        kind: kind,
        x: Math.random() * width,
        y: Math.random() * height,
        text: kind === 0 ? badgeTexts[Math.floor(Math.random() * badgeTexts.length)] : currencyCoins[Math.floor(Math.random() * currencyCoins.length)],
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.floor(Math.random() * 6) + 12,
        vy: -(Math.random() * 0.45 + 0.18),
        vx: (Math.random() - 0.5) * 0.35,
        baseAlpha: Math.random() * 0.45 + 0.35,
        pulseSpeed: Math.random() * 0.02 + 0.008,
        pulse: Math.random() * Math.PI * 2
      });
    }

    // 3. Partículas de Poeira Luminosa (Bokeh 4K)
    const dustParticles = [];
    const dustCount = 45;
    for (let d = 0; d < dustCount; d++) {
      dustParticles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.8 + 0.6,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.5 + 0.2,
        vy: -(Math.random() * 0.25 + 0.05),
        vx: (Math.random() - 0.5) * 0.2,
        pulse: Math.random() * Math.PI * 2,
        pulseSpeed: Math.random() * 0.03 + 0.01
      });
    }

    let waveOffset = 0;
    let tickCounter = 0;

    function render() {
      ctx.clearRect(0, 0, width, height);
      const isLight = document.body.classList.contains('light') || document.documentElement.classList.contains('light');

      // Inércia suave do cursor
      mouse.x += (mouse.targetX - mouse.x) * 0.08;
      mouse.y += (mouse.targetY - mouse.y) * 0.08;

      // A. Grid Terminal Financeiro com Pontos de Mira (+)
      const step = 65;
      ctx.save();
      ctx.strokeStyle = isLight ? 'rgba(15, 23, 42, 0.035)' : 'rgba(255, 255, 255, 0.035)';
      ctx.lineWidth = 1;
      for (let gx = step; gx < width; gx += step) {
        for (let gy = step; gy < height; gy += step) {
          ctx.beginPath();
          ctx.moveTo(gx - 3.5, gy); ctx.lineTo(gx + 3.5, gy);
          ctx.moveTo(gx, gy - 3.5); ctx.lineTo(gx + 3.5, gy);
          ctx.stroke();
        }
      }
      ctx.restore();

      // B. Curva Suave de Evolução Patrimonial Pessoal & Poupança Acumulada
      const chartBaseY = height * 0.78;
      const pointSpacing = width / (monthMilestones.length + 1);
      const minVal = 10000;
      const maxVal = 48000;
      const range = maxVal - minVal;

      // Área preenchida sob a curva
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pointSpacing, height);
      monthMilestones.forEach(function(m, idx) {
        const cx = (idx + 1) * pointSpacing;
        const cy = chartBaseY - ((m.val - minVal) / range) * 95;
        if (idx === 0) ctx.lineTo(cx, cy);
        else {
          const prevX = idx * pointSpacing;
          const prevY = chartBaseY - ((monthMilestones[idx - 1].val - minVal) / range) * 95;
          const cpx = (prevX + cx) / 2;
          ctx.bezierCurveTo(cpx, prevY, cpx, cy, cx, cy);
        }
      });
      ctx.lineTo(monthMilestones.length * pointSpacing, height);
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(0, chartBaseY - 100, 0, height);
      if (isLight) {
        areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.12)');
        areaGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.05)');
        areaGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      } else {
        areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.18)');
        areaGrad.addColorStop(0.5, 'rgba(56, 189, 248, 0.06)');
        areaGrad.addColorStop(1, 'rgba(3, 7, 18, 0)');
      }
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // Linha Principal de Crescimento Financeiro (Verde Esmeralda e Dourado)
      ctx.beginPath();
      monthMilestones.forEach(function(m, idx) {
        const cx = (idx + 1) * pointSpacing;
        const cy = chartBaseY - ((m.val - minVal) / range) * 95;
        if (idx === 0) ctx.moveTo(cx, cy);
        else {
          const prevX = idx * pointSpacing;
          const prevY = chartBaseY - ((monthMilestones[idx - 1].val - minVal) / range) * 95;
          const cpx = (prevX + cx) / 2;
          ctx.bezierCurveTo(cpx, prevY, cpx, cy, cx, cy);
        }
      });
      ctx.strokeStyle = isLight ? 'rgba(5, 150, 105, 0.75)' : 'rgba(16, 185, 129, 0.85)';
      ctx.lineWidth = 2.4;
      if (!isLight) {
        ctx.shadowColor = '#10B981';
        ctx.shadowBlur = 10;
      }
      ctx.stroke();

      // Marcadores Mensais com Nomes dos Meses
      monthMilestones.forEach(function(m, idx) {
        const cx = (idx + 1) * pointSpacing;
        const cy = chartBaseY - ((m.val - minVal) / range) * 95;

        // Ponto
        ctx.beginPath();
        ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = isLight ? '#047857' : '#34D399';
        ctx.fill();

        // Linha guia vertical sutil
        ctx.beginPath();
        ctx.moveTo(cx, cy + 4);
        ctx.lineTo(cx, cy + 16);
        ctx.strokeStyle = isLight ? 'rgba(100, 116, 139, 0.25)' : 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Rótulo do Mês
        ctx.font = '700 9.5px "Outfit", sans-serif';
        ctx.fillStyle = isLight ? '#475569' : '#94A3B8';
        ctx.textAlign = 'center';
        ctx.fillText(m.month, cx, cy + 28);
      });
      ctx.restore();

      // C. Micro-Partículas de Poeira Luminosa
      dustParticles.forEach(function(dp) {
        dp.y += dp.vy;
        dp.x += dp.vx + Math.sin(dp.y * 0.005) * 0.15;
        dp.pulse += dp.pulseSpeed;
        if (dp.y < -10) { dp.y = height + 10; dp.x = Math.random() * width; }
        if (dp.x < -10) dp.x = width + 10;
        if (dp.x > width + 10) dp.x = -10;

        const curAlpha = dp.alpha * (0.6 + 0.4 * Math.sin(dp.pulse));
        ctx.save();
        ctx.beginPath();
        ctx.arc(dp.x, dp.y, dp.radius, 0, Math.PI * 2);
        ctx.fillStyle = dp.color;
        ctx.globalAlpha = isLight ? curAlpha * 0.5 : curAlpha;
        if (!isLight && dp.radius > 1.2) {
          ctx.shadowColor = dp.color;
          ctx.shadowBlur = 8;
        }
        ctx.fill();
        ctx.restore();
      });

      // D. Onda Financeira Principal (Ciano Elétrico & Safira Lucro Mercado)
      waveOffset += 0.009;
      const waveY = height * 0.78;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, waveY);
      const wavePoints = [];
      for (let x = 0; x <= width; x += 20) {
        const y = waveY + Math.sin(x * 0.004 + waveOffset) * 32 + Math.cos(x * 0.008 - waveOffset * 0.5) * 18;
        ctx.lineTo(x, y);
        if (x % 160 === 0) wavePoints.push({ x: x, y: y });
      }
      ctx.lineTo(width, height);
      ctx.closePath();

      const waveGrad = ctx.createLinearGradient(0, waveY - 40, 0, height);
      if (isLight) {
        waveGrad.addColorStop(0, 'rgba(56, 189, 248, 0.14)');
        waveGrad.addColorStop(0.5, 'rgba(99, 102, 241, 0.05)');
        waveGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      } else {
        waveGrad.addColorStop(0, 'rgba(56, 189, 248, 0.22)');
        waveGrad.addColorStop(0.45, 'rgba(59, 130, 246, 0.10)');
        waveGrad.addColorStop(1, 'rgba(2, 4, 10, 0)');
      }
      ctx.fillStyle = waveGrad;
      ctx.fill();

      // Linha de Contorno Ciano
      ctx.beginPath();
      for (let x = 0; x <= width; x += 20) {
        const y = waveY + Math.sin(x * 0.004 + waveOffset) * 32 + Math.cos(x * 0.008 - waveOffset * 0.5) * 18;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.75)' : 'rgba(56, 189, 248, 0.85)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();

      // Nódulos de Pico com Indicadores ▲
      wavePoints.forEach(function(pt) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#38BDF8';
        ctx.shadowColor = '#38BDF8';
        ctx.shadowBlur = 12;
        ctx.fill();

        ctx.font = '800 10px "Outfit", sans-serif';
        ctx.fillStyle = '#7DD3FC';
        ctx.fillText('▲', pt.x - 3.5, pt.y - 7);
        ctx.restore();
      });

      // E. Conexões de Rede Interativa entre Nós e Interação com Cursor
      for (let i = 0; i < items.length; i++) {
        if (mouse.active && mouse.x > 0) {
          const mdx = items[i].x - mouse.x;
          const mdy = items[i].y - mouse.y;
          const mdist = Math.sqrt(mdx * mdx + mdy * mdy);
          if (mdist < 160) {
            const force = (1 - mdist / 160) * 1.5;
            items[i].x += (mdx / mdist) * force;
            items[i].y += (mdy / mdist) * force;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(items[i].x, items[i].y);
            ctx.lineTo(mouse.x, mouse.y);
            const mouseConnAlpha = (1 - mdist / 160) * (isLight ? 0.25 : 0.45);
            ctx.strokeStyle = isLight ? 'rgba(217, 119, 6, ' + mouseConnAlpha + ')' : 'rgba(245, 158, 11, ' + mouseConnAlpha + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
          }
        }
        for (let j = i + 1; j < items.length; j++) {
          const dx = items[i].x - items[j].x;
          const dy = items[i].y - items[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < 130) {
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(items[i].x, items[i].y);
            ctx.lineTo(items[j].x, items[j].y);
            const connAlpha = (1 - dist / 130) * 0.20;
            ctx.strokeStyle = isLight 
              ? 'rgba(14, 165, 233, ' + connAlpha + ')' 
              : 'rgba(56, 189, 248, ' + (connAlpha * 1.25) + ')';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // F. Renderização de Elementos Financeiros Flutuantes (Badges de Lucro & Moedas)
      items.forEach(function(it) {
        it.y += it.vy;
        it.x += it.vx + Math.sin(it.y * 0.008) * 0.25;
        it.pulse += it.pulseSpeed;
        const currentAlpha = Math.max(0.25, Math.min(0.95, it.baseAlpha + Math.sin(it.pulse) * 0.25));

        if (it.y < -40) { it.y = height + 40; it.x = Math.random() * width; }
        if (it.x < -40) it.x = width + 40;
        if (it.x > width + 40) it.x = -40;

        ctx.save();
        ctx.translate(it.x, it.y);

        if (it.kind === 0) {
          ctx.font = '700 11px "Outfit", "Plus Jakarta Sans", sans-serif';
          const textWidth = ctx.measureText(it.text).width;
          const padX = 9, padY = 4, rw = textWidth + padX * 2, rh = 21;
          ctx.beginPath();
          ctx.roundRect(-rw/2, -rh/2, rw, rh, 10);
          ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.90)' : 'rgba(13, 18, 32, 0.80)';
          ctx.globalAlpha = currentAlpha;
          ctx.fill();
          ctx.strokeStyle = it.color;
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.fillStyle = it.color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(it.text, 0, 1);
        } else {
          const radius = 13.5;
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.90)' : 'rgba(15, 23, 42, 0.80)';
          ctx.globalAlpha = currentAlpha;
          ctx.fill();
          ctx.strokeStyle = it.color;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          ctx.font = '800 11px "Outfit", sans-serif';
          ctx.fillStyle = it.color;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(it.text, 0, 1);
        }
        ctx.restore();
      });
      requestAnimationFrame(render);
    }
    render();
  }

  setupCanvas('authBgCanvas');
  setupCanvas('appBgOrbitalCanvas');
})();

  (function initServer3DCardTilt() {
    const card = document.getElementById('serverAuthNexusCard');
    const glare = document.getElementById('serverAuthCardGlare');
    if (!card) return;

    let bounds = null;
    function updateBounds() { bounds = card.getBoundingClientRect(); }
    window.addEventListener('resize', updateBounds);
    window.addEventListener('scroll', updateBounds);

    card.addEventListener('mouseenter', function() {
      updateBounds();
      if (glare) glare.style.setProperty('--card-glare-opacity', '1');
    });

    card.addEventListener('mousemove', function(e) {
      if (!bounds) updateBounds();
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      const centerX = bounds.width / 2;
      const centerY = bounds.height / 2;

      const rotateX = ((y - centerY) / centerY) * -5.5;
      const rotateY = ((x - centerX) / centerX) * 5.5;

      card.style.transform = 'perspective(1200px) rotateX(' + rotateX.toFixed(2) + 'deg) rotateY(' + rotateY.toFixed(2) + 'deg) translateY(-2px)';
      if (glare) {
        glare.style.setProperty('--card-mouse-x', x + 'px');
        glare.style.setProperty('--card-mouse-y', y + 'px');
      }
    });

    card.addEventListener('mouseleave', function() {
      card.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) translateY(0px)';
      if (glare) glare.style.setProperty('--card-glare-opacity', '0');
    });
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
    DEFAULT_ADMIN
  ];
}

function saveLocalUsers(users) {
  try {
    fs.writeFileSync(LOCAL_USERS_PATH, JSON.stringify(users, null, 2), 'utf8');
  } catch (e) {}
}

const LOCAL_ORDENS_PATH = path.join(__dirname, 'local_ordens_servico.json');

function getLocalOrdens() {
  try {
    if (fs.existsSync(LOCAL_ORDENS_PATH)) {
      const content = fs.readFileSync(LOCAL_ORDENS_PATH, 'utf8');
      return JSON.parse(content) || [];
    }
  } catch (e) {
    console.error('Erro ao ler local_ordens_servico.json:', e);
  }
  return [];
}

function saveLocalOrdens(ordens) {
  try {
    fs.writeFileSync(LOCAL_ORDENS_PATH, JSON.stringify(ordens, null, 2), 'utf8');
  } catch (e) {
    console.error('Erro ao salvar local_ordens_servico.json:', e);
  }
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
  let parsedUrl;
  try {
    const fullUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost:3000'));
    parsedUrl = {
      pathname: fullUrl.pathname,
      query: Object.fromEntries(fullUrl.searchParams),
      search: fullUrl.search
    };
  } catch (e) {
    parsedUrl = { pathname: req.url.split('?')[0] || '/', query: {} };
  }

  // Cabeçalhos globais de CORS e Segurança HTTP
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    return res.end();
  }

  // Rota GET de Health Check & Diagnóstico do Sistema
  if (req.method === 'GET' && parsedUrl.pathname === '/api/health') {
    const uptimeSeconds = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    const mem = process.memoryUsage();
    const localUsers = getLocalUsers();

    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'healthy',
      system: 'Nexus Financeiro Hub',
      version: '1.0.0',
      uptime: uptimeStr,
      uptime_seconds: uptimeSeconds,
      timestamp: new Date().toISOString(),
      database: pool ? 'connected_postgresql' : 'resilient_local_json',
      active_users_count: localUsers.length,
      memory: {
        rss_mb: (mem.rss / 1024 / 1024).toFixed(2),
        heap_used_mb: (mem.heapUsed / 1024 / 1024).toFixed(2),
        heap_total_mb: (mem.heapTotal / 1024 / 1024).toFixed(2)
      }
    }));
  }

  // Rota GET para Server-Sent Events (SSE) em Tempo Real
  if (req.method === 'GET' && parsedUrl.pathname === '/api/events') {
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive'
    });

    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Canal de eventos em tempo real conectado com sucesso', time: new Date().toISOString() })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Rota GET de Backup Geral do Sistema (Admin)
  if (req.method === 'GET' && parsedUrl.pathname === '/api/backup') {
    const localUsers = getLocalUsers().map(sanitizeUser);
    const localLogs = getFileLogs();
    const localOrdens = getLocalOrdens();
    
    let allFinancialData = {};
    try {
      if (fs.existsSync(LOCAL_DATA_PATH)) {
        allFinancialData = JSON.parse(fs.readFileSync(LOCAL_DATA_PATH, 'utf8')) || {};
      }
    } catch(e){}

    const backupPayload = {
      backup_version: '1.0',
      generated_at: new Date().toISOString(),
      environment: 'Homologação SF',
      users: localUsers,
      system_logs: localLogs,
      ordens_servico: localOrdens,
      financial_data: allFinancialData
    };

    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="backup_nexus_${Date.now()}.json"`
    });
    return res.end(JSON.stringify(backupPayload, null, 2));
  }

  // Rota POST para Login de Usuário (com Verificação Criptográfica e Upgrade Seguro de Hash)
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

        const cleanEmail = email.toLowerCase().trim();
        let user = null;
        if (pool) {
          try {
            const result = await pool.query(
              'SELECT id, name, email, password, role, active, last_login FROM usuarios WHERE LOWER(email) = LOWER($1)',
              [cleanEmail]
            );
            if (result.rows.length > 0) user = result.rows[0];
          } catch (dbErr) {
            console.warn('[AVISO BD] Falha ao consultar PostgreSQL no login. Usando cache local:', dbErr.message);
          }
        }
        if (!user) {
          const localUsers = getLocalUsers();
          user = localUsers.find(u => u.email.toLowerCase() === cleanEmail) || null;
        }

        if (!user) {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            errorType: 'user_not_found',
            error: 'Este e-mail não possui cadastro no sistema. Clique em "Criar Conta" para se cadastrar.'
          }));
        }

        if (!verifyPassword(password, user.password)) {
          res.writeHead(401, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            errorType: 'invalid_password',
            error: 'Senha incorreta para este e-mail. Verifique a senha digitada ou clique em "Esqueceu a senha?".'
          }));
        }

        // Migração transparente de senha legada para scrypt hash seguro
        if (!user.password || !user.password.startsWith('scrypt:')) {
          const secureHash = hashPassword(password);
          user.password = secureHash;
          if (pool) {
            pool.query('UPDATE usuarios SET password = $1 WHERE LOWER(email) = LOWER($2)', [secureHash, cleanEmail]).catch(()=>{});
          }
        }

        if (user.active === false) {
          res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            success: false,
            errorType: 'user_inactive',
            error: 'Seu usuário foi desativado pelo administrador.'
          }));
        }

        const nowTimestamp = new Date().toISOString();
        user.last_login = nowTimestamp;

        if (pool) {
          try {
            await pool.query('UPDATE usuarios SET last_login = NOW() WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
          } catch(e) {}
        }

        recordSystemLog(user.name, user.email, 'Login', 'Autenticação', 'Usuário realizou login com sucesso no sistema');

        // Notificação em tempo real via SSE
        broadcastEvent('user_login', {
          name: user.name,
          email: user.email,
          role: user.role,
          timestamp: nowTimestamp
        });

        // Exibição em destaque no terminal do VS Code
        console.log('\n' + '='.repeat(70));
        console.log('🔐 [VS CODE - LOGON REALIZADO COM SUCESSO]');
        console.log(`👤 Usuário:      ${user.name} (${user.email})`);
        console.log(`👑 Perfil:       ${user.role || 'Usuário'}`);
        console.log(`🕒 Data/Hora:    ${new Date().toLocaleString('pt-BR')}`);
        console.log('🚀 Sessão:       Ambiente de Homologação Ativo (Token Criptografado)');
        console.log('='.repeat(70) + '\n');

        try {
          const localUsers = getLocalUsers();
          const idx = localUsers.findIndex(u => u.email.toLowerCase() === user.email.toLowerCase());
          if (idx >= 0) {
            localUsers[idx] = { ...localUsers[idx], ...user, last_login: nowTimestamp };
          } else {
            localUsers.push({ ...user, last_login: nowTimestamp });
          }
          saveLocalUsers(localUsers);
        } catch(e){}

        const token = generateSecureToken(user);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          success: true,
          token: token,
          user: sanitizeUser(user)
        }));
      } catch (err) {
        console.error('Erro no endpoint de login:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Falha no servidor durante a autenticação.' }));
      }
    });
    return;
  }

  // Rota POST para Cadastro de Usuário (com Hashing Seguro de Senha e Apresentação no VS Code)
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
        if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'Por favor, informe um e-mail válido (ex: seu.email@exemplo.com).' }));
        }

        if (password.length < 6) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'A senha deve ter no mínimo 6 caracteres.' }));
        }

        const secureHashedPassword = hashPassword(password);
        let newUserId = Date.now();
        if (pool) {
          try {
            const existingUserRes = await pool.query('SELECT id, email FROM usuarios WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
            if (existingUserRes.rows && existingUserRes.rows.length > 0) {
              newUserId = existingUserRes.rows[0].id;
              await pool.query(
                'UPDATE usuarios SET name = $1, password = $2, active = true WHERE id = $3',
                [name.trim(), secureHashedPassword, newUserId]
              );
            } else {
              const insertRes = await pool.query(
                `INSERT INTO usuarios (name, email, password, role, active)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id;`,
                [name.trim(), cleanEmail, secureHashedPassword, 'Usuário', true]
              );
              if (insertRes.rows && insertRes.rows[0]) newUserId = insertRes.rows[0].id;
            }

            try {
              const existingDados = await pool.query('SELECT id FROM dados_financeiros WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
              if (!existingDados.rows || existingDados.rows.length === 0) {
                await pool.query(
                  'INSERT INTO dados_financeiros (email, dados) VALUES ($1, $2)',
                  [cleanEmail, '{}']
                );
              }
            } catch(dadosErr){}
          } catch (dbInsertErr) {
            console.warn('[AVISO BD] Erro ao cadastrar/atualizar no PostgreSQL:', dbInsertErr.message);
          }
        }

        const localUsers = getLocalUsers().filter(u => u && u.email && u.email.toLowerCase() !== cleanEmail);
        const newUserObj = { id: newUserId, name: name.trim(), email: cleanEmail, password: secureHashedPassword, role: 'Usuário', active: true };
        localUsers.push(newUserObj);
        saveLocalUsers(localUsers);

        recordSystemLog(name.trim(), cleanEmail, 'Cadastro', 'Autenticação', 'Usuário cadastrado/atualizado com senha criptografada com sucesso');

        // Notificação em tempo real via SSE
        broadcastEvent('new_user_registered', {
          id: newUserId,
          name: name.trim(),
          email: cleanEmail,
          role: 'Usuário',
          timestamp: new Date().toISOString()
        });

        // Exibição em destaque no terminal do VS Code
        console.log('\n' + '='.repeat(70));
        console.log('👤 [VS CODE - NOVO CADASTRO REALIZADO COM SUCESSO]');
        console.log(`📌 Nome:         ${name.trim()}`);
        console.log(`📧 E-mail:       ${cleanEmail}`);
        console.log(`🛡️ Perfil:       Usuário (Hash scrypt Protegido)`);
        console.log(`🕒 Data/Hora:    ${new Date().toLocaleString('pt-BR')}`);
        console.log('💻 Apresentação: Credenciais sincronizadas e prontas para Logon no VS Code');
        console.log('📂 Persistência: local_users.json e PostgreSQL');
        console.log('='.repeat(70) + '\n');

        const token = generateSecureToken(newUserObj);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          success: true, 
          message: 'Conta criada e sincronizada com sucesso no banco de dados!',
          token: token,
          user: sanitizeUser(newUserObj)
        }));
      } catch (err) {
        console.error('Erro no endpoint de cadastro:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Falha no servidor durante o cadastro: ' + err.message }));
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
          return res.end(JSON.stringify({ success: false, error: 'E-mail obrigatório' }));
        }

        const cleanEmail = email.toLowerCase().trim();
        let user = null;
        if (pool) {
          try {
            const result = await pool.query('SELECT id, name, email, password, role FROM usuarios WHERE LOWER(email) = LOWER($1)', [cleanEmail]);
            if (result.rows.length > 0) user = result.rows[0];
          } catch(e){}
        }
        if (!user) {
          const localUsers = getLocalUsers();
          user = localUsers.find(u => u.email.toLowerCase() === cleanEmail) || null;
        }

        if (!user) {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ success: false, error: 'E-mail não encontrado no sistema.' }));
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

  // Rota GET de Usuários (Sanitizada sem Exposição de Senhas)
  if (req.method === 'GET' && parsedUrl.pathname === '/api/users') {
    if (pool) {
      pool.query('SELECT id, name, email, role, active, created_at, last_login FROM usuarios ORDER BY id ASC')
        .then(result => {
          if (result.rows && result.rows.length > 0) {
            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result.rows));
          } else {
            const localUsers = getLocalUsers().map(sanitizeUser);
            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(localUsers));
          }
        })
        .catch(err => {
          console.warn('Usando lista de usuários do backup local:', err.message);
          const localUsers = getLocalUsers().map(sanitizeUser);
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify(localUsers));
        });
    } else {
      const localUsers = getLocalUsers().map(sanitizeUser);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify(localUsers));
    }
    return;
  }

  // Rota POST de Usuários (Sincronização Segura sem Deleção Involuntária e com Preservação de Senhas)
  if (req.method === 'POST' && parsedUrl.pathname === '/api/users') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const users = Array.isArray(parsed) ? parsed : [parsed];
        if (!users.length) throw new Error('Formato inválido');

        // Mescla localmente com cadastros existentes no servidor preservando credenciais
        const existingLocal = getLocalUsers();
        const userMap = new Map();
        existingLocal.forEach(u => {
          if (u && u.email) userMap.set(u.email.toLowerCase().trim(), u);
        });

        users.forEach(u => {
          if (u && u.email) {
            const emailKey = u.email.toLowerCase().trim();
            const existing = userMap.get(emailKey);
            let finalPassword = existing ? existing.password : '';
            if (u.password && typeof u.password === 'string' && u.password.trim() !== '') {
              finalPassword = u.password.startsWith('scrypt:') ? u.password : hashPassword(u.password);
            }
            if (!finalPassword) {
              finalPassword = hashPassword('123456');
            }

            userMap.set(emailKey, {
              id: u.id || (existing ? existing.id : Date.now()),
              name: (u.name || (existing ? existing.name : 'Usuário')).trim(),
              email: emailKey,
              password: finalPassword,
              role: u.role || (existing ? existing.role : 'Usuário'),
              active: u.active !== false,
              created_at: u.created_at || (existing ? existing.created_at : new Date().toISOString()),
              last_login: u.last_login || (existing ? existing.last_login : null)
            });
          }
        });
        const finalUsers = Array.from(userMap.values());
        saveLocalUsers(finalUsers);

        recordSystemLog('Sistema', 'cadastro@nexusfinanceiro.com', 'Sincronização', 'Usuários', 'Sincronização de usuários salva com sucesso');

        if (pool) {
          try {
            const client = await pool.connect();
            try {
              await client.query('BEGIN');
              for (const u of finalUsers) {
                if (u && u.email && u.name) {
                  await client.query(
                    `INSERT INTO usuarios (name, email, password, role, active, last_login)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (email) DO UPDATE
                     SET name = EXCLUDED.name,
                         password = CASE WHEN EXCLUDED.password IS NOT NULL AND EXCLUDED.password != '' THEN EXCLUDED.password ELSE usuarios.password END,
                         role = EXCLUDED.role,
                         active = EXCLUDED.active,
                         last_login = COALESCE(EXCLUDED.last_login, usuarios.last_login);`,
                    [u.name, u.email, u.password, u.role || 'Usuário', u.active !== false, u.last_login || null]
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
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  if (req.method === 'DELETE' && parsedUrl.pathname === '/api/users') {
    const emailToDelete = (parsedUrl.query.email || '').toLowerCase().trim();
    if (!emailToDelete) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'E-mail obrigatório' }));
    }
    const localUsers = getLocalUsers().filter(u => (u.email || '').toLowerCase() !== emailToDelete);
    saveLocalUsers(localUsers);
    if (pool) {
      pool.query('DELETE FROM usuarios WHERE LOWER(email) = LOWER($1)', [emailToDelete])
        .then(() => {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        })
        .catch(err => {
          console.warn('Erro ao deletar usuário no PostgreSQL:', err.message);
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, warning: err.message }));
        });
    } else {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
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

  // ==================== ROTAS DE ORDENS DE SERVIÇO (O.S.) ====================

  // Rota GET/POST para Consultar Ordens de Serviço por Nome, E-mail ou Protocolo (Público)
  if ((req.method === 'GET' && parsedUrl.pathname === '/api/ordens/consultar') || (req.method === 'POST' && parsedUrl.pathname === '/api/ordens/consultar')) {
    const handleConsultQuery = (qStr) => {
      const q = (qStr || '').toLowerCase().trim();
      if (!q) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Informe o Nome, E-mail ou Protocolo para consulta.', ordens: [] }));
      }

      if (pool) {
        pool.query(
          `SELECT id, protocol, client_name, client_email, service_type, priority, title, description, status, admin_notes, created_at, updated_at
           FROM ordens_servico
           WHERE LOWER(client_email) = $1
              OR LOWER(client_name) LIKE $2
              OR LOWER(protocol) = $1
              OR LOWER(title) LIKE $2
           ORDER BY id DESC LIMIT 50`,
          [q, '%' + q + '%']
        ).then(result => {
          let rows = result.rows || [];
          if (rows.length === 0) {
            // Fallback para arquivo local caso não retorne no banco
            const localList = getLocalOrdens();
            rows = localList.filter(o =>
              (o.client_email && o.client_email.toLowerCase().includes(q)) ||
              (o.client_name && o.client_name.toLowerCase().includes(q)) ||
              (o.protocol && o.protocol.toLowerCase().includes(q))
            );
          }
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, count: rows.length, ordens: rows }));
        }).catch(err => {
          const localList = getLocalOrdens();
          const rows = localList.filter(o =>
            (o.client_email && o.client_email.toLowerCase().includes(q)) ||
            (o.client_name && o.client_name.toLowerCase().includes(q)) ||
            (o.protocol && o.protocol.toLowerCase().includes(q))
          );
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, count: rows.length, ordens: rows }));
        });
      } else {
        const localList = getLocalOrdens();
        const rows = localList.filter(o =>
          (o.client_email && o.client_email.toLowerCase().includes(q)) ||
          (o.client_name && o.client_name.toLowerCase().includes(q)) ||
          (o.protocol && o.protocol.toLowerCase().includes(q))
        );
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, count: rows.length, ordens: rows }));
      }
    };

    if (req.method === 'GET') {
      const q = parsedUrl.query.query || parsedUrl.query.q || parsedUrl.query.email || parsedUrl.query.nome || '';
      return handleConsultQuery(q);
    } else {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        let q = '';
        try {
          const p = JSON.parse(body);
          q = p.query || p.q || p.email || p.name || p.nome || '';
        } catch(e) {}
        handleConsultQuery(q);
      });
      return;
    }
  }

  // Rota GET para Listar Ordens de Serviço
  if (req.method === 'GET' && parsedUrl.pathname === '/api/ordens') {
    if (pool) {
      pool.query('SELECT id, protocol, client_name, client_email, service_type, priority, title, description, status, admin_notes, created_at, updated_at FROM ordens_servico ORDER BY id DESC LIMIT 500')
        .then(result => {
          if (result.rows && result.rows.length > 0) {
            saveLocalOrdens(result.rows);
          }
          const ordens = (result.rows && result.rows.length > 0) ? result.rows : getLocalOrdens();
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ordens: ordens }));
        })
        .catch(err => {
          const ordens = getLocalOrdens();
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, ordens: ordens }));
        });
    } else {
      const ordens = getLocalOrdens();
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ordens: ordens }));
    }
    return;
  }

  // Rota POST para Abertura de Nova Ordem de Serviço (Público na Tela de Login)
  if (req.method === 'POST' && parsedUrl.pathname === '/api/ordens') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch(e) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'JSON inválido' }));
      }

      const clientName = (payload.client_name || '').trim();
      const clientEmail = (payload.client_email || '').toLowerCase().trim();
      const serviceType = payload.service_type || 'Melhoria no Sistema';
      const priority = payload.priority || 'Normal';
      const title = (payload.title || '').trim();
      const description = (payload.description || '').trim();

      if (!clientName || !clientEmail || !title || !description) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'Preencha todos os campos obrigatórios.' }));
      }

      const nowIso = new Date().toISOString();
      const protocol = 'OS-' + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

      const newOrder = {
        id: Date.now(),
        protocol: protocol,
        client_name: clientName,
        client_email: clientEmail,
        service_type: serviceType,
        priority: priority,
        title: title,
        description: description,
        status: 'Pendente',
        admin_notes: '',
        created_at: nowIso,
        updated_at: nowIso
      };

      const localList = getLocalOrdens();
      localList.unshift(newOrder);
      saveLocalOrdens(localList);

      recordSystemLog(clientName, clientEmail, 'Abertura de O.S.', 'Ordem de Serviço', 'Nova solicitação #' + protocol + ': ' + title);

      // Notificação em tempo real via SSE
      broadcastEvent('new_order', {
        id: newOrder.id,
        protocol: newOrder.protocol,
        client_name: newOrder.client_name,
        service_type: newOrder.service_type,
        priority: newOrder.priority,
        title: newOrder.title,
        timestamp: newOrder.created_at
      });

      if (pool) {
        pool.query(
          `INSERT INTO ordens_servico (protocol, client_name, client_email, service_type, priority, title, description, status, admin_notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
          [newOrder.protocol, newOrder.client_name, newOrder.client_email, newOrder.service_type, newOrder.priority, newOrder.title, newOrder.description, newOrder.status, newOrder.admin_notes, newOrder.created_at, newOrder.updated_at]
        ).then(resDb => {
          if (resDb.rows && resDb.rows[0]) {
            newOrder.id = resDb.rows[0].id;
          }
        }).catch(err => {
          console.warn('[AVISO BD O.S.] Erro ao gravar no PostgreSQL, mantido localmente:', err.message);
        });
      }

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, protocol: protocol, ordem: newOrder }));
    });
    return;
  }

  // Rota POST/PUT para Atualizar Status / Parecer de Ordem de Serviço (Admin)
  if ((req.method === 'POST' && parsedUrl.pathname === '/api/ordens/update') || (req.method === 'PUT' && parsedUrl.pathname === '/api/ordens')) {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch(e) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, message: 'JSON inválido' }));
      }

      const id = payload.id;
      const status = payload.status || 'Pendente';
      const adminNotes = payload.admin_notes || '';
      const nowIso = new Date().toISOString();

      const localList = getLocalOrdens();
      const target = localList.find(o => String(o.id) === String(id) || String(o.protocol) === String(id));
      if (target) {
        target.status = status;
        target.admin_notes = adminNotes;
        target.updated_at = nowIso;
        saveLocalOrdens(localList);
      }

      recordSystemLog('Administrador', 'admin@nexusfinanceiro.com', 'Atualização de O.S.', 'Ordem de Serviço', 'Atualizou O.S. #' + (target ? target.protocol : id) + ' para status: ' + status);

      // Notificação em tempo real via SSE
      broadcastEvent('order_updated', {
        id: id,
        protocol: target ? target.protocol : id,
        status: status,
        updated_at: nowIso
      });

      if (pool) {
        try {
          await pool.query(
            `UPDATE ordens_servico SET status = $1, admin_notes = $2, updated_at = $3 WHERE id = $4 OR protocol = $5`,
            [status, adminNotes, nowIso, isNaN(id) ? -1 : parseInt(id), String(id)]
          );
        } catch(err) {
          console.warn('[AVISO BD O.S.] Erro ao atualizar no PostgreSQL:', err.message);
        }
      }

      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // Rota DELETE para Excluir Ordem de Serviço (Admin)
  if (req.method === 'DELETE' && parsedUrl.pathname === '/api/ordens') {
    const idToDelete = parsedUrl.query.id || '';
    if (!idToDelete) {
      res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, message: 'ID ausente' }));
    }

    const localList = getLocalOrdens();
    const updatedList = localList.filter(o => String(o.id) !== String(idToDelete) && String(o.protocol) !== String(idToDelete));
    saveLocalOrdens(updatedList);

    recordSystemLog('Administrador', 'admin@nexusfinanceiro.com', 'Exclusão de O.S.', 'Ordem de Serviço', 'Excluiu O.S. id/protocolo: ' + idToDelete);

    if (pool) {
      pool.query(
        'DELETE FROM ordens_servico WHERE id = $1 OR protocol = $2',
        [isNaN(idToDelete) ? -1 : parseInt(idToDelete), String(idToDelete)]
      ).then(() => {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      }).catch(err => {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
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
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      return fs.createReadStream(loginPath).pipe(res);
    }
  }

  if (pathname.startsWith('/images/') || pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|css|js|json|html)$/i)) {
    const rawClean = pathname.replace(/^\/+/, '');
    let cleanPath = rawClean;
    try { cleanPath = decodeURIComponent(rawClean); } catch (e) {}
    
    const candidatePaths = [
      path.normalize(path.join(__dirname, cleanPath)).replace(/^(\.\.[\/\\])+/, ''),
      path.normalize(path.join(__dirname, 'images', path.basename(cleanPath))).replace(/^(\.\.[\/\\])+/, ''),
      path.normalize(path.join(__dirname, path.basename(cleanPath))).replace(/^(\.\.[\/\\])+/, '')
    ];
    
    let resolvedPath = null;
    for (const cand of candidatePaths) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
        resolvedPath = cand;
        break;
      }
    }

    if (resolvedPath) {
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json',
        '.html': 'text/html; charset=utf-8'
      };
      res.writeHead(200, {
        ...corsHeaders,
        'Content-Type': mimeTypes[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache, no-store, must-revalidate, max-age=0' : 'public, max-age=86400, stale-while-revalidate=604800'
      });
      return fs.createReadStream(resolvedPath).pipe(res);
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

// Proteção Global de Processo contra Exceções Não Tratadas
process.on('uncaughtException', (err) => {
  console.error('[PROCESSO] Erro não capturado tratado com segurança:', err.message);
});

process.on('unhandledRejection', (reason, promise) => {
  console.warn('[PROCESSO] Rejeição de Promise tratada com segurança:', reason);
});

// Encerramento Gracioso em Ambientes de Nuvem / Contêineres (Graceful Shutdown)
function gracefulShutdown(signal) {
  console.log(`[PROCESSO] Recebido sinal ${signal}. Encerrando conexões com segurança...`);
  server.close(() => {
    console.log('[PROCESSO] Servidor HTTP finalizado.');
    if (pool) {
      pool.end(() => {
        console.log('[BANCO] Pool de conexões PostgreSQL encerrado.');
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  });

  setTimeout(() => {
    console.error('[PROCESSO] Encerramento forçado após timeout de 10s.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`==================================================`);
      console.log(`🚀 Servidor Nexus Financeiro Hub rodando em 0.0.0.0:${PORT}`);
      console.log(`📋 Logs do banco disponíveis em tempo real: system_logs.json`);
      console.log(`⚡ Endpoint de Diagnóstico / Healthcheck: GET /api/health`);
      console.log(`==================================================`);
    });
  });

