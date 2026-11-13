// Avalia o template htmlContent de verdade (com ASSETS_V) e valida a sintaxe dos <script> inline servidos.
const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const startMarker = 'const htmlContent = `';
const i = server.indexOf(startMarker);
if (i < 0) { console.log('htmlContent não achado'); process.exit(1); }
const tStart = i + startMarker.length;
// acha o fechamento: "`" seguido de ";" ou "," — o template termina em </html>`;
const endMarker = '</html>`;';
const j = server.indexOf(endMarker, tStart);
if (j < 0) { console.log('fim do template não achado'); process.exit(1); }
const templateSrc = server.slice(tStart, j) + '</html>'; // sem o backtick final
// avalia como template literal
const ASSETS_V = 'vTEST';
let html;
try {
  html = eval('`' + templateSrc + '`');
} catch (e) {
  console.log('ERRO AO AVALIAR TEMPLATE:', e.message);
  process.exit(1);
}
console.log('HTML servido:', html.length, 'bytes');

const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let m, n = 0, fails = 0;
while ((m = re.exec(html))) {
  n++;
  const code = m[1];
  if (!code.trim()) continue;
  const f = path.join(os.tmpdir(), 'nx_script_' + n + '.js');
  fs.writeFileSync(f, code);
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    fails++;
    console.log('=== BLOCO ' + n + ' COM ERRO DE SINTAXE ===');
    console.log((e.stderr || e.stdout || '').toString().split('\n').slice(0, 14).join('\n'));
    // posição aproximada no html
    const upto = html.slice(0, m.index);
    const line = upto.split('\n').length;
    console.log('bloco começa ~linha HTML ' + line);
  }
}
console.log('blocos inline:', n, '| com erro:', fails);
