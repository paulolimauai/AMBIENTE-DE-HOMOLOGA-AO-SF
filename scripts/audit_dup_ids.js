const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const raw = server.slice(i, j);
const ASSETS_V = 'vT';
const html = eval('`' + raw.slice(raw.indexOf('`') + 1) + '`');
for (const id of ['regPwdMatchMsg', 'registerFeedbackBanner', 'exec4kOkBtn', 'ordensPage']) {
  let k = -1;
  console.log('=====', id);
  while ((k = html.indexOf('id="' + id + '"', k + 1)) >= 0) {
    const line = html.slice(0, k).split('\n').length;
    console.log(' linha', line, ':', html.slice(Math.max(0, k - 100), k + 140).replace(/\s+/g, ' '));
  }
}
