const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

const isCRLF = code.includes('\r\n');
console.log('File CRLF mode:', isCRLF);

function norm(str) {
  if (isCRLF) {
    return str.replace(/(?<!\r)\n/g, '\r\n');
  }
  return str.replace(/\r\n/g, '\n');
}

function doReplace(target, replacement, stepName) {
  const nTarget = norm(target);
  const nReplacement = norm(replacement);
  if (!code.includes(nTarget)) {
    console.error(`ERRO no passo [${stepName}]: alvo não encontrado!`);
    process.exit(1);
  }
  code = code.replace(nTarget, nReplacement);
  console.log(`✓ ${stepName}`);
}

// 1. DATABASE MIGRATIONS
const migrationAnchor = `    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')
    BEGIN
      ALTER TABLE usuarios ADD last_ip NVARCHAR(50) NULL;
    END;`;

const migrationReplacement = `    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')
    BEGIN
      ALTER TABLE usuarios ADD last_ip NVARCHAR(50) NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'trial_started_at')
    BEGIN
      ALTER TABLE usuarios ADD trial_started_at DATETIME2 NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_plan')
    BEGIN
      ALTER TABLE usuarios ADD subscription_plan NVARCHAR(50) NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_status')
    BEGIN
      ALTER TABLE usuarios ADD subscription_status NVARCHAR(50) DEFAULT 'trial';
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_expires_at')
    BEGIN
      ALTER TABLE usuarios ADD subscription_expires_at DATETIME2 NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_method')
    BEGIN
      ALTER TABLE usuarios ADD subscription_method NVARCHAR(50) NULL;
    END;

    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'subscription_payment_id')
    BEGIN
      ALTER TABLE usuarios ADD subscription_payment_id NVARCHAR(100) NULL;
    END;`;

doReplace(migrationAnchor, migrationReplacement, '1. Migrações de banco adicionadas');

// 2. INACTIVITY TIMEOUT
const timeoutAnchor = 'const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos (300.000 ms)';
const timeoutReplacement = 'const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutos (checkout seguro)';
doReplace(timeoutAnchor, timeoutReplacement, '2. Timeout de inatividade estendido para 30 minutos');

// 3. CSS DO WIDGET DE TESTE E MODAL DE ASSINATURA
const cssAnchor = '/* Alinhamento Multidispositivo de Painéis e Cards */';
const cssContent = fs.readFileSync(path.join(__dirname, 'chunk_css.txt'), 'utf8');
doReplace(cssAnchor, cssContent + '\n\n' + cssAnchor, '3. Estilos CSS Cyber Glass & Modo Claro injetados');

// 4. OVERLAYS HTML: DOCK FLUTUANTE E MODAL DE ASSINATURA
const overlaysAnchor = '<!-- OVERLAY 4K: EXIBIÇÃO DA SENHA TEMPORÁRIA EM TELA -->';
const htmlContentChunk = fs.readFileSync(path.join(__dirname, 'chunk_html.txt'), 'utf8');
doReplace(overlaysAnchor, htmlContentChunk + '\n\n' + overlaysAnchor, '4. Overlays HTML do Dock e Modal injetados');

// 5. CLIENT-SIDE JAVASCRIPT ENGINE
const clientEngineAnchor = 'window.checkServerRegPasswordMatch = function() {';
const jsContentChunk = fs.readFileSync(path.join(__dirname, 'chunk_js.txt'), 'utf8');
doReplace(clientEngineAnchor, jsContentChunk + '\n\n' + clientEngineAnchor, '5. Motor de Período Gratuito e Checkout injetado no JavaScript cliente');

// 6. INVOCAR initTrialAndSubscription() AO RESTAURAR SESSÃO
const restoreAnchor = "sessionStorage.setItem('nexus_session_active', 'true');\n  if (!sessionStorage.getItem('nexus_last_activity')) {";
const restoreCall = `if (typeof window.initTrialAndSubscription === 'function') {
    window.initTrialAndSubscription();
  }
  sessionStorage.setItem('nexus_session_active', 'true');
  if (!sessionStorage.getItem('nexus_last_activity')) {`;
doReplace(restoreAnchor, restoreCall, '6. initTrialAndSubscription() acoplado ao restoreSession');

// 7. ROTAS DE API BACKEND
const apiRoutesAnchor = '// ==================== ROTAS DE ORDENS DE SERVIÇO (O.S.) ====================';
const routesContentChunk = fs.readFileSync(path.join(__dirname, 'chunk_routes.txt'), 'utf8');
doReplace(apiRoutesAnchor, routesContentChunk + '\n\n  ' + apiRoutesAnchor, '7. Rotas de API backend de assinatura inseridas');

// 8. ATUALIZAR SELECT DO LOGIN
const loginSelectOld = 'SELECT id, name, email, password, role, active, last_login, cpf, phone, birth_date, terms_accepted, created_at, device_type, must_change_password FROM usuarios WHERE LOWER(email) = LOWER($1)';
const loginSelectNew = 'SELECT id, name, email, password, role, active, last_login, cpf, phone, birth_date, terms_accepted, created_at, device_type, must_change_password, trial_started_at, subscription_plan, subscription_status, subscription_expires_at, subscription_method, subscription_payment_id FROM usuarios WHERE LOWER(email) = LOWER($1)';
doReplace(loginSelectOld, loginSelectNew, '8. SELECT do login atualizado com campos de assinatura');

// 9. ATUALIZAR SELECT DO GET /api/users
const usersSelectOld = "SELECT id, name, email, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted, device_type, must_change_password FROM usuarios ORDER BY id ASC";
const usersSelectNew = "SELECT id, name, email, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted, device_type, must_change_password, trial_started_at, subscription_plan, subscription_status, subscription_expires_at, subscription_method, subscription_payment_id FROM usuarios ORDER BY id ASC";
doReplace(usersSelectOld, usersSelectNew, '9. SELECT de usuários atualizado com campos de assinatura');

// 10. ATUALIZAR pageConfig COM CARD DE ASSINATURA
const pageConfigAnchor = '<div class="cfg-proportional-container" style="display:grid; grid-template-columns:minmax(0, 1.35fr) minmax(0, 1fr); gap:20px; align-items:start;">';
const configContentChunk = fs.readFileSync(path.join(__dirname, 'chunk_config.txt'), 'utf8');
doReplace(pageConfigAnchor, configContentChunk + '\n\n  ' + pageConfigAnchor, '10. Card de Assinatura integrado no pageConfig');

// 11. ATUALIZAR pageUsuarios COM BADGES DE ASSINATURA NA LISTA DE USUÁRIOS
const pageUsuariosBadgeAnchor = fs.readFileSync(path.join(__dirname, 'chunk_usuarios.txt'), 'utf8').split('\n')[0].trim();
const usuariosContentChunk = fs.readFileSync(path.join(__dirname, 'chunk_usuarios.txt'), 'utf8');
doReplace(pageUsuariosBadgeAnchor, usuariosContentChunk, '11. Badges de assinatura integradas no pageUsuarios');

fs.writeFileSync(serverPath, code, 'utf8');
console.log('✅ SUCESSO ABSOLUTO: Todas as 11 etapas foram aplicadas com sucesso em server.js!');
