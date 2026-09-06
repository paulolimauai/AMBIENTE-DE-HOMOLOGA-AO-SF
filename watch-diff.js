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

function formatColoredDiff(rawDiff) {
  const lines = rawDiff.split('\n');
  return lines.map(line => {
    if (line.startsWith('diff --git') || line.startsWith('index ')) {
      return '\x1b[1m\x1b[38;2;86;156;214m' + line + '\x1b[0m';
    } else if (line.startsWith('--- a/')) {
      return '\x1b[38;2;244;71;71m' + line + '\x1b[0m';
    } else if (line.startsWith('+++ b/')) {
      return '\x1b[38;2;78;201;176m' + line + '\x1b[0m';
    } else if (line.startsWith('@@')) {
      return '\x1b[1m\x1b[38;2;197;134;192m' + line + '\x1b[0m';
    } else if (line.startsWith('+')) {
      return '\x1b[38;2;78;201;176m' + line + '\x1b[0m';
    } else if (line.startsWith('-')) {
      return '\x1b[38;2;244;71;71m' + line + '\x1b[0m';
    } else {
      return '\x1b[38;2;212;212;212m' + line + '\x1b[0m';
    }
  }).join('\n');
}

function showLiveDiff(changedFile) {
  try {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    
    // Obter git diff atual (incluindo staged e unstaged)
    let diffOutput = '';
    try {
      diffOutput = execSync('git diff HEAD --color=always', {
        cwd: WORKSPACE_DIR,
        encoding: 'utf-8'
      });
    } catch (e) {
      diffOutput = '';
    }

    if (!diffOutput.trim()) {
      // Se não há alterações não salvas, mostrar o último commit como exemplo ao vivo
      try {
        const lastCommitInfo = execSync('git log -1 --stat -p --color=always', {
          cwd: WORKSPACE_DIR,
          encoding: 'utf-8'
        });
        console.log(`\n\x1b[38;2;78;201;176m[${timestamp}] ⚡ CÓDIGO ONLINE SINCRONIZADO - ÚLTIMA MODIFICAÇÃO:\x1b[0m`);
        console.log('\x1b[38;2;86;156;214m' + '─'.repeat(78) + '\x1b[0m');
        process.stdout.write(formatColoredDiff(lastCommitInfo));
        console.log('\x1b[38;2;86;156;214m' + '─'.repeat(78) + '\x1b[0m');
        console.log(`\x1b[38;2;106;153;85m👀 Monitor ativo. Qualquer alteração em arquivos aparecerá aqui em tempo real com cores.\x1b[0m\n`);
      } catch (e) {
        console.log(`\n\x1b[38;2;106;153;85m[${timestamp}] ✅ Diretório sincronizado e sem modificações pendentes.\x1b[0m`);
      }
      return;
    }

    if (diffOutput === lastDiffOutput) {
      return;
    }
    lastDiffOutput = diffOutput;

    console.log(`\n\x1b[38;2;212;212;212m[${timestamp}] \x1b[1m\x1b[38;2;86;156;214m🔍 Modificação de Código Online Detectada:\x1b[0m ${changedFile ? `\x1b[38;2;181;206;168m${changedFile}\x1b[0m` : ''}`);
    console.log('\x1b[38;2;86;156;214m' + '═'.repeat(78) + '\x1b[0m');
    process.stdout.write(formatColoredDiff(diffOutput));
    console.log('\x1b[38;2;86;156;214m' + '═'.repeat(78) + '\x1b[0m\n');
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
