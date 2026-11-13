const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const h = server.slice(i, j);
const needle = process.argv[2] || 'is-admin';
const before = parseInt(process.argv[3] || '300', 10);
const after = parseInt(process.argv[4] || '300', 10);
let k = -1, n = 0;
while ((k = h.indexOf(needle, k + 1)) >= 0) {
  n++;
  const line = h.slice(0, k).split('\n').length;
  console.log('=== ' + needle + ' #' + n + ' @html-line ' + line + ' ===');
  console.log(h.slice(Math.max(0, k - before), k + after).replace(/\s+/g, ' '));
}
console.log('total', n);
