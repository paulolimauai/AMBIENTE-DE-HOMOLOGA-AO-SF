'use strict';
// ============================================================================
// Verificador de segredos: impede que senha, chave, token, hash de senha ou dado de cliente entre no Git.
//
// Por quê (21/11/2026): o repositório é PÚBLICO e o histórico já continha o token de sincronização, as chaves do Supabase e a senha do e-mail de suporte.
// Segredo só existe neste computador (.env e arquivos .nexus_*, ambos fora do Git) e nas variáveis do painel do Render.
//
// Uso:
//   node scripts/verificar_segredos.js --staged   confere SÓ as linhas que estão sendo commitadas (é o que o hook .githooks/pre-commit roda)
//   node scripts/verificar_segredos.js --tree     confere TODOS os arquivos versionados hoje (auditoria sob demanda: npm run verificar:segredos)
// Sai com código 1 e lista "arquivo:linha — tipo" (NUNCA o valor) quando acha algo. Para liberar UMA linha que é legítima de verdade, escreva
// "nexus-segredos:permitir" num comentário na própria linha.
// ============================================================================
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const MARCA_PERMITIR = 'nexus-segredos:permitir';

// Arquivos que NUNCA podem ser versionados (segredos, dados de clientes, cópias e estados locais)
const CAMINHOS_PROIBIDOS = [
  [/(^|\/)\.env($|\.)(?!example$)/, 'arquivo .env (segredos do ambiente)'],
  [/(^|\/)\.nexus_[^/]*$/, 'arquivo .nexus_* (token/chave/senha local)'],
  [/(^|\/)\.tmp_tok/, 'token temporário'],
  [/(^|\/)local_[^/]*\.json(\.[^/]*)?$/, 'dados locais do app (contas, financeiro, chamados...)'],
  [/(^|\/)(cofre_contas|deleted_accounts|cpf_registry|system_logs|pending_logins|sql_vigia_estado|supabase_sync_state)[^/]*$/, 'dados/estado local do app'],
  [/^(backups_contas|backups_financeiros|visitas|logs|dist)\//, 'pasta de dados/saída local'],
  [/(^|\/)espelho_[^/]*\.json$/, 'cópia local de dados'],
  [/\.(pem|key|pfx|p12|jks)$/i, 'chave/certificado privado'],
  [/\.(bak|dump|sqlite3?|mdf|ldf|bacpac)$/i, 'backup/banco de dados']
];
const ARQUIVOS_BINARIOS = /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp4|pdf|zip|gz)$/i;

// Padrões de conteúdo (cada um acha um tipo de segredo). `soNaoCodigo`: só vale fora de .js (em código a atribuição de teste daria alarme falso).
const PADROES = [
  { tipo: 'hash de senha scrypt completo', re: /scrypt:[a-f0-9]{32}:[a-f0-9]{128}/ },
  { tipo: 'JWT / chave de API (eyJ...)', re: /eyJ[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{15,}\.[A-Za-z0-9_\-]{10,}/ },
  { tipo: 'chave Supabase sb_secret/sb_publishable', re: /sb_(secret|publishable)_[A-Za-z0-9_\-]{16,}/ },
  { tipo: 'chave privada', re: /BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY/ },
  { tipo: 'token GitHub/AWS/Slack/OpenAI', re: /(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abp]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9]{32,})/ },
  { tipo: 'URL de banco com usuário:senha', re: /postgres(ql)?:\/\/[^\s:@/]+:(?!senha|password|sua_|<|\$|\{)[^\s:@/]{4,}@/i },
  { tipo: 'segredo atribuído (CHAVE=valor)', soNaoCodigo: true, re: /\b[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|PASS|PWD|API_KEY|SERVICE_ROLE_KEY|ANON_KEY)\s*[:=]\s*["']?(?![\s"'#]|change|sua[_-]|seu[_-]|your|<|\$|\{|xxx|exemplo|placeholder|\.\.\.)[A-Za-z0-9_\-.+/=]{12,}/ }
];

const ehCodigo = (arq) => /\.(js|mjs|cjs)$/i.test(arq);
const NOME_SEGREDO = /(KEY|PASS|PWD|SECRET|TOKEN|SENHA|CREDENCIAL)/i;
const VALOR_BANAL = /^(true|false|null|undefined|localhost|127\.0\.0\.1|nexus_app|mssql|mssql-sync|utf-?8|production|development|[0-9]{1,6})$/i;

/** Valores sensíveis DESTE computador (do .env e dos arquivos .nexus_*): se aparecerem num commit, é vazamento. Devolve [{nome, valor}]. Nunca imprima o valor. */
function valoresSensiveisLocais(raiz) {
  const out = [];
  const add = (nome, valor) => { const v = String(valor || '').trim().replace(/^["']|["']$/g, ''); if (v.length >= 8 && !VALOR_BANAL.test(v)) out.push({ nome, valor: v }); };
  try {
    for (const linha of fs.readFileSync(path.join(raiz, '.env'), 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && NOME_SEGREDO.test(m[1])) add(m[1], m[2]);
    }
  } catch (e) { /* sem .env (CI): só os padrões valem */ }
  try {
    for (const f of fs.readdirSync(raiz)) {
      if (/^\.nexus_/.test(f)) { try { const t = fs.readFileSync(path.join(raiz, f), 'utf8'); if (t.length < 4096) { for (const l of t.split(/\r?\n/)) { const m = l.match(/^\s*[A-Z0-9_]+\s*=\s*(.+)$/); add(f, m ? m[1] : l); } } } catch (e) {} }
    }
  } catch (e) { /* ignora */ }
  return out;
}

/** Identidades REAIS de clientes deste computador (e-mails e CPFs de local_users.json/cofre): não podem aparecer em arquivo versionado. */
function identidadesLocais(raiz) {
  const emails = new Set(); const cpfs = new Set();
  const colher = (lista) => (Array.isArray(lista) ? lista : []).forEach((u) => {
    if (!u) return;
    if (u.email && /@/.test(u.email)) emails.add(String(u.email).toLowerCase().trim());
    const d = String(u.cpf || '').replace(/\D/g, ''); if (d.length === 11) cpfs.add(d);
  });
  try { colher(JSON.parse(fs.readFileSync(path.join(raiz, 'local_users.json'), 'utf8'))); } catch (e) {}
  try { const c = JSON.parse(fs.readFileSync(path.join(raiz, 'cofre_contas.json'), 'utf8')); colher(Object.values(c.contas || {}).map((x) => x.registro)); } catch (e) {}
  try { Object.values(JSON.parse(fs.readFileSync(path.join(raiz, 'cpf_registry.json'), 'utf8'))).forEach((r) => { const d = String((r && r.cpf) || '').replace(/\D/g, ''); if (d.length === 11) cpfs.add(d); }); } catch (e) {}
  return { emails, cpfs };
}

function caminhoProibido(arq) {
  const a = String(arq || '').replace(/\\/g, '/');
  if (/(^|\/)\.env\.example$/.test(a)) return null;
  for (const [re, motivo] of CAMINHOS_PROIBIDOS) if (re.test(a)) return motivo;
  return null;
}

/** Acha problemas em UMA linha. `ctx`: { arquivo, sensiveis, identidades }. Devolve lista de tipos (nunca o valor). */
function analisarLinha(linha, ctx) {
  if (!linha || linha.length > 20000 || linha.includes(MARCA_PERMITIR)) return [];
  const tipos = [];
  for (const p of PADROES) {
    if (p.soNaoCodigo && ehCodigo(ctx.arquivo)) continue;
    if (p.re.test(linha)) tipos.push(p.tipo);
  }
  for (const s of ctx.sensiveis || []) if (linha.includes(s.valor)) { tipos.push('valor real de ' + s.nome + ' (do seu .env/.nexus_*)'); }
  if (ctx.identidades) {
    const minus = linha.toLowerCase();
    for (const e of ctx.identidades.emails) if (minus.includes(e)) { tipos.push('e-mail real de cliente (de local_users.json)'); break; }
    const digitos = linha.replace(/[.\-\s]/g, '');
    for (const c of ctx.identidades.cpfs) if (digitos.includes(c)) { tipos.push('CPF real de cliente'); break; }
  }
  return Array.from(new Set(tipos));
}

function git(args) { return cp.execFileSync('git', ['-c', 'core.quotepath=false'].concat(args), { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }); }

/** Linhas ADICIONADAS no índice (o que vai entrar no commit): [{arquivo, linha, texto}] + arquivos tocados */
function linhasStaged() {
  const arquivos = git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
  const diff = git(['diff', '--cached', '-U0', '--no-color', '--diff-filter=ACMR']);
  const linhas = []; let arq = null; let n = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { arq = l.slice(4).replace(/^b\//, ''); continue; }
    if (l.startsWith('@@')) { const m = l.match(/\+(\d+)/); n = m ? Number(m[1]) : 0; continue; }
    if (l.startsWith('+') && !l.startsWith('+++')) { linhas.push({ arquivo: arq, linha: n, texto: l.slice(1) }); n++; }
  }
  return { arquivos, linhas };
}

function verificar(modo, raiz) {
  const base = raiz || ROOT;
  const ctx = { sensiveis: valoresSensiveisLocais(base), identidades: identidadesLocais(base) };
  const problemas = [];
  if (modo === 'staged') {
    const { arquivos, linhas } = linhasStaged();
    for (const a of arquivos) { const m = caminhoProibido(a); if (m) problemas.push({ arquivo: a, linha: 0, tipo: 'arquivo proibido: ' + m }); }
    for (const l of linhas) {
      if (ARQUIVOS_BINARIOS.test(l.arquivo || '')) continue;
      for (const t of analisarLinha(l.texto, Object.assign({ arquivo: l.arquivo }, ctx))) problemas.push({ arquivo: l.arquivo, linha: l.linha, tipo: t });
    }
  } else {
    const arquivos = git(['ls-files']).split('\n').filter(Boolean);
    for (const a of arquivos) {
      const m = caminhoProibido(a); if (m) problemas.push({ arquivo: a, linha: 0, tipo: 'arquivo proibido: ' + m });
      if (ARQUIVOS_BINARIOS.test(a)) continue;
      let texto; try { texto = fs.readFileSync(path.join(base, a), 'utf8'); } catch (e) { continue; }
      if (texto.length > 6 * 1024 * 1024) continue;
      const ls = texto.split(/\r?\n/);
      for (let i = 0; i < ls.length; i++) for (const t of analisarLinha(ls[i], Object.assign({ arquivo: a }, ctx))) problemas.push({ arquivo: a, linha: i + 1, tipo: t });
    }
  }
  return problemas;
}

function main() {
  const modo = process.argv.includes('--tree') ? 'tree' : 'staged';
  let problemas;
  try { problemas = verificar(modo); } catch (e) { console.error('[segredos] Não foi possível verificar (' + e.message + '). Commit bloqueado por segurança.'); process.exit(1); }
  if (!problemas.length) { if (modo === 'tree') console.log('[segredos] Nenhum segredo encontrado nos arquivos versionados.'); return; }
  console.error('\n⛔ [segredos] COMMIT BLOQUEADO: segredo ou dado sensível no que seria enviado ao Git (o repositório pode ser público).');
  const vistos = new Set();
  for (const p of problemas) { const k = p.arquivo + ':' + p.linha + ':' + p.tipo; if (vistos.has(k)) continue; vistos.add(k); console.error('   ' + p.arquivo + (p.linha ? ':' + p.linha : '') + '  —  ' + p.tipo); }
  console.error('\nTire o valor do arquivo (segredo vai no .env deste computador e nas variáveis do Render) e confirme de novo. Linha legítima de verdade: comente nexus-segredos:permitir nela.\n');
  process.exit(1);
}

if (require.main === module) main();
module.exports = { caminhoProibido, analisarLinha, valoresSensiveisLocais, identidadesLocais, verificar, PADROES, MARCA_PERMITIR };
