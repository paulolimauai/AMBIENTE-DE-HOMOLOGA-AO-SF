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

const staticFiles = fs.readdirSync(ROOT).filter((f) =>
  /\.(html|css|js|png|jpg|jpeg|svg|ico|webmanifest|txt|json)$/i.test(f) &&
  !f.endsWith('.test.js') &&
  !['package.json', 'package-lock.json'].includes(f)
);
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
    fs.cpSync(imgDir, path.join(DIST, 'images'), { recursive: true });
    console.log('[build] images/ copiada (' + (imgSize / 1024 / 1024).toFixed(1) + ' MB).');
  } else {
    console.log('[build] images/ ignorada (' + (imgSize / 1024 / 1024).toFixed(0) + ' MB — acima do limite de hospedagem estática).');
  }
}

console.log('[build] Concluído. Saída em dist/ (' + staticFiles.length + ' arquivos estáticos).');
