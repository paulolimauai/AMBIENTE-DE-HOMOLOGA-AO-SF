const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const raw = server.slice(i, j);
const ASSETS_V = 'vT';
const html = eval('`' + raw.slice(raw.indexOf('`') + 1) + '`');
const ids = process.argv.slice(2);
for (const id of ids) {
  const dq = html.split('id="' + id + '"').length - 1;
  const sq = html.split("id='" + id + "'").length - 1;
  const gei = html.split("getElementById('" + id + "')").length - 1 + html.split('getElementById("' + id + '")').length - 1;
  console.log(id.padEnd(35), 'dq:' + dq, 'sq:' + sq, 'gei:' + gei);
}
