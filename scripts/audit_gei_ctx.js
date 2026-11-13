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
  let k = -1;
  console.log('\n########## ' + id + ' ##########');
  while ((k = html.indexOf("getElementById('" + id + "')", k + 1)) >= 0) {
    const line = html.slice(0, k).split('\n').length;
    console.log('--- linha HTML ' + line + ' ---');
    console.log(html.slice(Math.max(0, k - 350), k + 350).replace(/\n/g, '\n'));
  }
  k = -1;
  while ((k = html.indexOf('getElementById("' + id + '")', k + 1)) >= 0) {
    const line = html.slice(0, k).split('\n').length;
    console.log('--- linha HTML ' + line + ' (dq) ---');
    console.log(html.slice(Math.max(0, k - 350), k + 350));
  }
}
