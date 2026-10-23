/**
 * Sincronização automática do workspace com o Git remoto.
 * Executar com: npm run auto:sync
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKSPACE_DIR = __dirname;
const DEBOUNCE_MS = 2500;
const IGNORED = [
  /[\\/]node_modules([\\/]|$)/i,
  /[\\/]\.git([\\/]|$)/i,
  /[\\/]\.agents([\\/]|$)/i,
  /[\\/]\.codex([\\/]|$)/i,
  /system_logs\.json$/i
];

let timer = null;
let syncing = false;
let rerunRequested = false;

function isIgnored(filename) {
  return IGNORED.some(pattern => pattern.test(String(filename)));
}

function runGit(args) {
  const result = spawnSync('git', args, {
    cwd: WORKSPACE_DIR,
    encoding: 'utf8',
    windowsHide: true
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} falhou`).trim());
  }
  return (result.stdout || '').trim();
}

function hasChanges() {
  return Boolean(runGit(['status', '--porcelain']));
}

function commitAndPush() {
  if (syncing) {
    rerunRequested = true;
    return;
  }

  syncing = true;
  try {
    if (!hasChanges()) return;

    if (fs.existsSync(path.join(WORKSPACE_DIR, 'server.js'))) {
      const check = spawnSync(process.execPath, ['--check', 'server.js'], {
        cwd: WORKSPACE_DIR,
        encoding: 'utf8',
        windowsHide: true
      });
      if (check.status !== 0) {
        throw new Error(`server.js inválido: ${(check.stderr || check.stdout || '').trim()}`);
      }
    }

    runGit(['add', '-A']);
    const changedFiles = runGit(['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean);
    if (!changedFiles.length) return;

    const stamp = new Date().toLocaleString('pt-BR', { hour12: false }).replace(',', '');
    const message = `auto: sincroniza alterações (${stamp})`;
    runGit(['commit', '-m', message]);
    runGit(['push', 'origin', 'main']);
    console.log(`[auto-sync] ${changedFiles.length} arquivo(s) enviado(s) para origin/main.`);
  } catch (error) {
    console.error(`[auto-sync] Falha: ${error.message}`);
  } finally {
    syncing = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleSync();
    }
  }
}

function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(commitAndPush, DEBOUNCE_MS);
}

console.log('[auto-sync] Monitor ativo. Alterações serão commitadas e enviadas automaticamente.');

fs.watch(WORKSPACE_DIR, { recursive: true }, (_eventType, filename) => {
  if (!filename || isIgnored(filename)) return;
  scheduleSync();
});

