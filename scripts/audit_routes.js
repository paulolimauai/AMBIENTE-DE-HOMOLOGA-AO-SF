// Auditoria v2: todos os literais '/api/...' no frontend vs rotas do server.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const htmlStart = server.indexOf('const htmlContent = `');
const htmlEnd = server.indexOf('</html>`;', htmlStart);
const html = server.slice(htmlStart, htmlEnd > htmlStart ? htmlEnd : server.length);

const files = { 'server-inline-html': html };
for (const f of ['dashboard-financeiro.js', 'transacoes.js', 'administracao.js', 'importacao.js', 'atendimento.js', 'glpi-enterprise.html', 'login-nexus-v5.html']) {
  try { files[f] = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) {}
}

const routes = [];
const re = /req\.method === '([A-Z]+)'[^;]{0,200}?parsedUrl\.pathname === '([^']+)'/g;
let m;
while ((m = re.exec(server))) {
  // captura todos os literais de path na mesma condição
  const seg = m[0];
  const paths = [...seg.matchAll(/parsedUrl\.pathname === '([^']+)'/g)].map(x => x[1]);
  const meths = [...seg.matchAll(/req\.method === '([A-Z]+)'/g)].map(x => x[1]);
  for (const p of paths) routes.push({ method: meths.join('|'), path: p });
}

const litRe = /['"`](\/api\/[A-Za-z0-9_\-\/{}$:.]*)['"`]/g;
const calls = new Map(); // path -> Set(files)
for (const [name, content] of Object.entries(files)) {
  let mm;
  while ((mm = litRe.exec(content))) {
    let p = mm[1];
    // template com ${} -> vira segmento variável
    p = p.replace(/\$\{[^}]*\}/g, '*');
    p = p.split('?')[0].replace(/\/+$/, '') || '/api';
    if (!calls.has(p)) calls.set(p, new Set());
    calls.get(p).add(name);
  }
}

function segMatch(rp, cp) {
  const rs = rp.split('/'), cs = cp.split('/');
  if (rs.length !== cs.length) return false;
  return rs.every((s, i) => s === cs[i] || s === '*' || cs[i] === '*');
}

const missing = [];
for (const [p, fset] of calls) {
  const ok = routes.some(r => segMatch(r.path, p));
  if (!ok) missing.push({ p, files: [...fset] });
}

console.log('=== LITERAIS /api NO FRONTEND (' + calls.size + ') ===');
for (const [p, fset] of [...calls.entries()].sort()) console.log(p.padEnd(55), '<-', [...fset].join(', '));
console.log('\n=== SEM ROTA ===');
missing.forEach(x => console.log(x.p, '<-', x.files.join(', ')));
