// Build para hospedagem estática (ex.: Cloudflare Pages).
// Valida a sintaxe de todos os módulos JS e monta dist/ com os arquivos estáticos.
// ATENÇÃO: o Nexus é uma aplicação Node.js (server.js) — as telas são geradas pelo
// servidor e as APIs (/api/*) exigem o backend. Em hospedagem puramente estática,
// apenas páginas avulsas (login, central de chamados) funcionam; o app completo
// precisa de um host Node (Render, Railway, VPS etc.).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

// 1) Validação de sintaxe de todos os módulos do servidor e do frontend
const jsFiles = [
  'server.js', 'supabase-sync.js', 'atendimento.js', 'backend-utils.js',
  'transacoes.js', 'dashboard-financeiro.js', 'administracao.js',
  'importacao.js', 'auto-sync.js', 'watch-diff.js'
];
for (const f of jsFiles) {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p)) execFileSync(process.execPath, ['--check', p], { stdio: 'inherit' });
}
console.log('[build] Sintaxe OK em ' + jsFiles.length + ' arquivos.');

// 2) Monta dist/ com os arquivos estáticos servidos diretamente
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// O QUE VAI PARA O SITE (dist/ é público na internet). Regras, todas ao mesmo tempo:
//  1) só arquivo VERSIONADO no Git (o que o Git ignora — dados de clientes, cofre, estados locais, .env, .nexus_* — nunca é copiado, mesmo que exista nesta pasta);
//  2) só o que o NAVEGADOR usa: html, css, imagens, manifest e os .js de tela listados abaixo (a mesma lista que o servidor entrega em STATIC_EXACT_FILES);
//  3) nunca .json/.txt (dados e diagnósticos), nunca teste, nunca código do servidor (server.js, supabase-sync.js, credenciais, cofre, sincronização...).
// Tudo que ficar de fora continua sendo atendido pelo servidor no Render (o Worker repassa o que não está em dist/).
const JS_DO_NAVEGADOR = new Set([
  'dashboard-financeiro.js', 'importacao.js', 'transacoes.js', 'administracao.js', 'assinaturas.js', 'pagamentos-admin.js',
  'site-inicial.js', 'admin-site.js', 'admin-liberacao.js', 'admin-visitas.js', 'nexus-sso.js'
]);
// A fonte da verdade é o mapa STATIC_EXACT_FILES do server.js (o que o servidor entrega ao navegador): quando um .js de tela novo entra lá, entra aqui sozinho.
try {
  const fonte = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const ini = fonte.indexOf('const STATIC_EXACT_FILES = {');
  const bloco = ini >= 0 ? fonte.slice(ini, fonte.indexOf('};', ini)) : '';
  for (const m of bloco.matchAll(/'\/([A-Za-z0-9_\-.]+\.js)'\s*:/g)) JS_DO_NAVEGADOR.add(m[1]);
} catch (e) { /* mantém a lista fixa acima */ }
function arquivosVersionados() {
  try {
    const lista = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).split('\0').filter(Boolean);
    return new Set(lista.filter((f) => !f.includes('/')));
  } catch (e) {
    console.warn('[build] git indisponível (' + e.message.split('\n')[0] + '): sem o filtro de arquivos versionados; valem só as regras 2 e 3.');
    return null;
  }
}
const versionados = arquivosVersionados();
const SENSIVEL = /^(\.|local_|cofre_|backups_|deleted_accounts|cpf_registry|system_logs|pending_logins|sql_vigia|supabase_sync|espelho_|page\.html$|script5\.js$)/;
const staticFiles = fs.readdirSync(ROOT).filter((f) => {
  if (!fs.statSync(path.join(ROOT, f)).isFile()) return false;
  if (versionados && !versionados.has(f)) return false;
  if (SENSIVEL.test(f) || f.endsWith('.test.js')) return false;
  if (/\.(html|css|png|jpg|jpeg|svg|ico|webmanifest)$/i.test(f)) return true;
  if (/\.js$/i.test(f)) return JS_DO_NAVEGADOR.has(f);
  return false;
});
for (const f of staticFiles) {
  fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
}

// imagens/ só entra se for pequena o suficiente para o limite da hospedagem
const imgDir = path.join(ROOT, 'images');
if (fs.existsSync(imgDir)) {
  const imgSize = fs.readdirSync(imgDir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .reduce((acc, e) => acc + fs.statSync(path.join(imgDir, e.name)).size, 0);
  if (imgSize < 20 * 1024 * 1024) {
    fs.cpSync(imgDir, path.join(DIST, 'images'), { recursive: true, filter: (src) => path.relative(imgDir, src).split(path.sep)[0] !== 'SITE' });
    console.log('[build] images/ copiada (' + (imgSize / 1024 / 1024).toFixed(1) + ' MB).');
  } else {
    console.log('[build] images/ ignorada (' + (imgSize / 1024 / 1024).toFixed(0) + ' MB — acima do limite de hospedagem estática).');
  }
}

console.log('[build] Concluído. Saída em dist/ (' + staticFiles.length + ' arquivos estáticos).');
