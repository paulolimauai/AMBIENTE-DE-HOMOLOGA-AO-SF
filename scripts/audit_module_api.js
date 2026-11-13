// Verifica se os métodos window.NexusX.yyy chamados no HTML existem nos módulos
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const html = server.slice(i, j);

const mods = {
  NexusDash: 'dashboard-financeiro.js',
  NexusTx: 'transacoes.js',
  NexusAdm: 'administracao.js',
  NexusImport: 'importacao.js'
};

// descobre as chaves do objeto api retornado por cada módulo: procura "return {" no fim / api = {...}
function moduleKeys(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const keys = new Set();
  // padrao: return { a, b: fn, ... } ou api.x =
  const retRe = /return\s*\{([\s\S]*?)\};/g;
  let m;
  while ((m = retRe.exec(src))) {
    const body = m[1];
    const keyRe = /([A-Za-z_$][\w$]*)\s*[:,]/g;
    let k;
    while ((k = keyRe.exec(body))) keys.add(k[1]);
  }
  const assignRe = /api\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = assignRe.exec(src))) keys.add(m[1]);
  return { keys, src };
}

// chamadas no html: window.NexusX.metodo( ou NexusX.metodo(
for (const [ns, file] of Object.entries(mods)) {
  const { keys, src } = moduleKeys(file);
  const callRe = new RegExp('(?:window\\.)?' + ns + '\\.([A-Za-z_$][\\w$]*)', 'g');
  const used = new Set();
  let m;
  while ((m = callRe.exec(html))) used.add(m[1]);
  const missing = [...used].filter(u => !keys.has(u));
  console.log('=== ' + ns + ' (' + file + ') ===');
  console.log('usados:', [...used].sort().join(', '));
  console.log('exportados:', [...keys].sort().join(', '));
  if (missing.length) console.log('!!! FALTANDO:', missing.join(', '));
  else console.log('OK: todos os métodos usados existem');
}
