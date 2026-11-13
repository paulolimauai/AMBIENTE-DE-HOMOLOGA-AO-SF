const fs = require('fs');
const s = fs.readFileSync('server.js', 'utf8');
const i = s.indexOf('const htmlContent');
const j = s.indexOf('</html>`;', i);
const h = s.slice(i, j);
const needle = process.argv[2] || '/api/data?email';
const before = parseInt(process.argv[3] || '700', 10);
const after = parseInt(process.argv[4] || '700', 10);
let k = -1, n = 0;
while ((k = h.indexOf(needle, k + 1)) >= 0) {
  n++;
  console.log('=== ocorrencia ' + n + ' @' + k + ' ===');
  console.log(h.slice(Math.max(0, k - before), k + after));
}
console.log('total', n);
