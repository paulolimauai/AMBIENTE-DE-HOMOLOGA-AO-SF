'use strict';
// Liga a barreira de segredos neste clone do repositório: git passa a rodar .githooks/pre-commit (scripts/verificar_segredos.js --staged) em TODO commit,
// inclusive os feitos por "git add ." ou por outra ferramenta. Roda sozinho no "npm install" (script "prepare"); sem .git (ex.: build no Render) não faz nada.
const cp = require('child_process');
const path = require('path');
const raiz = path.join(__dirname, '..');
try {
  cp.execFileSync('git', ['rev-parse', '--git-dir'], { cwd: raiz, stdio: 'ignore' });
  cp.execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: raiz, stdio: 'ignore' });
  console.log('[proteger:git] Barreira de segredos ligada: todo commit passa por scripts/verificar_segredos.js.');
} catch (e) {
  /* sem git neste ambiente: nada a proteger */
}
