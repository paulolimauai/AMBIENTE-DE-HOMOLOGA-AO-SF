const fs = require('fs');

console.log('Preparing subscription & trial implementation for server.js...');

let serverCode = fs.readFileSync('server.js', 'utf8');

// 1. Verificando pontos de ancoragem no código
const anchorMigrations = "IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')";
const anchorTimeout = "const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;";
const anchorCss = "/* Alinhamento Multidispositivo de Painéis e Cards */";
const anchorOverlays = "<!-- OVERLAY 4K: EXIBIÇÃO DA SENHA TEMPORÁRIA EM TELA -->";
const anchorClientEngine = "window.checkServerRegPasswordMatch = function() {";
const anchorApiRoutes = "// ==================== ROTAS DE ORDENS DE SERVIÇO (O.S.) ====================";
const anchorLoginSelect = "SELECT id, name, email, password, role, active, last_login, cpf, phone, birth_date, terms_accepted, created_at, device_type, must_change_password FROM usuarios WHERE LOWER(email) = LOWER($1)";
const anchorUsersGetSelect = "SELECT id, name, email, password, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted, device_type, must_change_password FROM usuarios ORDER BY id ASC";
const anchorRestoreSession = "sessionStorage.setItem('nexus_session_active', 'true');\n  if (!sessionStorage.getItem('nexus_last_activity')) {";

console.log('Verificando âncoras:');
console.log('anchorMigrations:', serverCode.includes(anchorMigrations));
console.log('anchorTimeout:', serverCode.includes(anchorTimeout));
console.log('anchorCss:', serverCode.includes(anchorCss));
console.log('anchorOverlays:', serverCode.includes(anchorOverlays));
console.log('anchorClientEngine:', serverCode.includes(anchorClientEngine));
console.log('anchorApiRoutes:', serverCode.includes(anchorApiRoutes));
console.log('anchorLoginSelect:', serverCode.includes(anchorLoginSelect));
console.log('anchorUsersGetSelect:', serverCode.includes(anchorUsersGetSelect));
console.log('anchorRestoreSession:', serverCode.includes(anchorRestoreSession));
