const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const h = server.slice(i, j);
// menu items do sidebar
const re = /data-page="([^"]+)"/g;
let m;
const seen = new Set();
while ((m = re.exec(h))) {
  if (seen.has(m[1])) continue;
  seen.add(m[1]);
  const line = h.slice(0, m.index).split('\n').length;
  console.log(String(line).padStart(6), m[1]);
}
