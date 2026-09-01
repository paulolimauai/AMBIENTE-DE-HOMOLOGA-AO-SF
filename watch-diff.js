/**
 * ==============================================================================
 * MONITOR DE ALTERAÇÕES EM TEMPO REAL (LIVE DIFF - VS CODE DARK+ THEME)
 * ==============================================================================
 * Monitora o diretório do projeto e exibe instantaneamente no terminal qualquer
 * linha de código modificada, adicionada (+) ou removida (-), com realce de sintaxe
 * e numeração de linhas estilo VS Code.
 */

const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const WORKSPACE_DIR = __dirname;
const IGNORE_PATTERNS = [
  /node_modules/,
  /[\\/]\.git([\\/]|$)/,
  /[\\/]\.vscode([\\/]|$)/,
  /[\\/]\.agents([\\/]|$)/,
  /system_logs\.json/,
  /package-lock\.json/
];

let debounceTimer = null;
let lastDiffOutput = '';

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function printHeader() {
  console.log('\x1b[38;2;86;156;214m' + '═'.repeat(78) + '\x1b[0m');
  console.log('\x1b[1m\x1b[38;2;78;201;176m  ⚡ MONITOR DE ALTERAÇÕES EM TEMPO REAL (LIVE DIFF VS CODE) ⚡\x1b[0m');
  console.log('\x1b[38;2;156;220;254m  Modificações no código aparecerão abaixo instantaneamente com cores e linhas.\x1b[0m');
  console.log('\x1b[38;2;106;153;85m  Pressione Ctrl+C para encerrar o monitor.\x1b[0m');
  console.log('\x1b[38;2;86;156;214m' + '═'.repeat(78) + '\x1b[0m\n');
}

function hasDelta() {
  try {
    execSync('delta --version', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

const isDeltaAvailable = hasDelta();

function showLiveDiff(changedFile) {
  try {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    
    // Obter git diff atual
    const gitDiffCmd = isDeltaAvailable
      ? 'git diff --color=always'
      : 'git diff --color=always';

    const diffOutput = execSync(gitDiffCmd, {
      cwd: WORKSPACE_DIR,
      encoding: 'utf-8',
      env: {
        ...process.env,
        BAT_THEME: 'Visual Studio Dark+',
        DELTA_NAVIGATE: '1'
      }
    });

    if (!diffOutput.trim()) {
      // Se não há diff do git, verificar se é um arquivo novo não rastreado
      const untracked = execSync('git ls-files --others --exclude-standard', {
        cwd: WORKSPACE_DIR,
        encoding: 'utf-8'
      }).trim();

      if (untracked) {
        console.log(`\n\x1b[38;2;206;145;120m[${timestamp}] 📄 Novo Arquivo Detectado:\x1b[0m \x1b[1m${untracked}\x1b[0m`);
      } else {
        console.log(`\n\x1b[38;2;106;153;85m[${timestamp}] ✅ Diretório sincronizado e sem modificações pendentes.\x1b[0m`);
      }
      return;
    }

    if (diffOutput === lastDiffOutput) {
      return;
    }
    lastDiffOutput = diffOutput;

    console.log(`\n\x1b[38;2;212;212;212m[${timestamp}] \x1b[1m\x1b[38;2;86;156;214m🔍 Alteração Detectada:\x1b[0m ${changedFile ? `\x1b[38;2;181;206;168m${changedFile}\x1b[0m` : ''}`);
    console.log('\x1b[38;2;106;153;85m' + '-'.repeat(78) + '\x1b[0m');

    if (isDeltaAvailable) {
      const deltaProcess = spawn('delta', ['--syntax-theme=Visual Studio Dark+', '--line-numbers'], {
        cwd: WORKSPACE_DIR,
        stdio: ['pipe', 'inherit', 'inherit'],
        shell: true
      });
      deltaProcess.stdin.write(diffOutput);
      deltaProcess.stdin.end();
    } else {
      process.stdout.write(diffOutput);
    }
  } catch (err) {
    console.error('Erro ao renderizar diff:', err.message);
  }
}

function startWatcher() {
  clearScreen();
  printHeader();
  showLiveDiff();

  try {
    fs.watch(WORKSPACE_DIR, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      for (const pattern of IGNORE_PATTERNS) {
        if (pattern.test(filename)) {
          return;
        }
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        showLiveDiff(filename);
      }, 250);
    });
  } catch (watchErr) {
    console.error('Falha ao iniciar watcher nativo:', watchErr);
  }
}

startWatcher();
