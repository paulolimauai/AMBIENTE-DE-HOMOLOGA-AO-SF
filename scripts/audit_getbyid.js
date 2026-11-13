// getElementById('x') no HTML/JS inline que não correspondem a nenhum id="x" estático
// (ids criados dinamicamente em innerHTML aparecem como id="x" em strings — então a checagem é segura)
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const raw = server.slice(i, j);
const ASSETS_V = 'vT';
const html = eval('`' + raw.slice(raw.indexOf('`') + 1) + '`');

const idRe = /\bid="([^"${}]+)"/g; // ids estáticos e ids dentro de templates JS (id="x" literal)
const ids = new Set();
let m;
while ((m = idRe.exec(html))) ids.add(m[1]);
// ids montados dinamicamente: id=\'x\' ou id=" + var — marca prefixos
const dynRe = /id=\\?['"]([A-Za-z][\w-]*)\\?['"]/g;
while ((m = dynRe.exec(html))) ids.add(m[1]);
// id=\`...\` template
const tplRe = /id=\$\{?[`'"]?([A-Za-z][\w-]*)/g;
while ((m = tplRe.exec(html))) ids.add(m[1]);

const geiRe = /getElementById\(\s*['"`]([A-Za-z][\w-]*)['"`]\s*\)/g;
const used = new Map();
while ((m = geiRe.exec(html))) {
  if (!ids.has(m[1])) {
    if (!used.has(m[1])) used.set(m[1], 0);
    used.set(m[1], used.get(m[1]) + 1);
  }
}
console.log('ids referenciados sem id= correspondente:', used.size);
[...used.entries()].sort().forEach(([k, v]) => console.log(v + 'x', k));
