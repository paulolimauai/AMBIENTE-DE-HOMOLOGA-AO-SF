'use strict';

/**
 * Confere, SÓ LEITURA, se os dados financeiros de cada conta estão gravados em todos os lugares e se batem:
 *   arquivo local | SQL Server (dados_financeiros) | espelho no SQL (nexus_dados_financeiros) | tabelas relacionais | histórico local | nuvem (Render)
 *
 *   node scripts/verificar_dados.js            (PC: arquivo + SQL + espelho + histórico)
 *   node scripts/verificar_dados.js --nuvem    (inclui o que a nuvem/Render guarda; usa NEXUS_SYNC_TOKEN do .env)
 *
 * Sai com código 1 se achar divergência. Nunca escreve nada e nunca imprime e-mail inteiro, senha ou conteúdo: só contagens.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const BackupFinanceiro = require('../backup-financeiro');

const RAIZ = path.resolve(__dirname, '..');
const DATA = process.env.NEXUS_DATA_DIR || RAIZ;
const env = {};
try { for (const l of fs.readFileSync(path.join(RAIZ, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch (e) { /* sem .env */ }
const BANCO = process.env.MSSQL_DATABASE || env.MSSQL_DATABASE || 'nexus_app';
const mask = (e) => String(e).replace(/^([^@]{1,3})[^@]*@/, '$1***@');
const lc = (e) => String(e || '').toLowerCase().trim();
const cont = (d) => ({ lanc: Array.isArray(d && d.transactions) ? d.transactions.length : 0, contas: Array.isArray(d && d.accounts) ? d.accounts.length : 0, orc: Array.isArray(d && d.budgets) ? d.budgets.length : 0, metas: Array.isArray(d && d.goals) ? d.goals.length : 0 });
const txt = (c) => c ? c.lanc + ' lanç / ' + c.contas + ' contas' + (c.orc || c.metas ? ' / ' + c.orc + ' orç / ' + c.metas + ' metas' : '') : '—';
const igual = (a, b) => a && b && a.lanc === b.lanc && a.contas === b.contas && a.orc === b.orc && a.metas === b.metas;

function sql(consulta) {
  const arq = path.join(os.tmpdir(), 'nexus_ver_' + crypto.randomBytes(4).toString('hex') + '.sql');
  fs.writeFileSync(arq, 'SET NOCOUNT ON;\n' + consulta + '\n');
  try { return execFileSync('sqlcmd', ['-S', 'localhost', '-d', BANCO, '-E', '-C', '-W', '-h', '-1', '-s', '|', '-b', '-i', arq], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  finally { try { fs.unlinkSync(arq); } catch (e) { /* temporário */ } }
}
const linhas = (saida) => saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split('|'));
const CONT_SQL = (col) => "ISNULL((SELECT COUNT(*) FROM OPENJSON(" + col + ",'$.transactions')),0), ISNULL((SELECT COUNT(*) FROM OPENJSON(" + col + ",'$.accounts')),0), ISNULL((SELECT COUNT(*) FROM OPENJSON(" + col + ",'$.budgets')),0), ISNULL((SELECT COUNT(*) FROM OPENJSON(" + col + ",'$.goals')),0)";

async function principal() {
  const contas = new Map();   // e-mail -> { local, sql, sqlForma, espelho, rel, hist, nuvem }
  const get = (e) => { const k = lc(e); if (!contas.has(k)) contas.set(k, {}); return contas.get(k); };
  const problemas = [];

  // arquivo local
  let local = {};
  try { local = JSON.parse(fs.readFileSync(path.join(DATA, 'local_database_data.json'), 'utf8')); } catch (e) { problemas.push('arquivo local_database_data.json ilegível: ' + e.message); }
  for (const [k, v] of Object.entries(local)) if (k) get(k).local = cont(v);
  try { for (const u of JSON.parse(fs.readFileSync(path.join(DATA, 'local_users.json'), 'utf8'))) if (u && u.email) get(u.email); } catch (e) { /* sem usuários */ }

  // SQL Server
  let sqlOk = true;
  try {
    for (const l of linhas(sql("SELECT email, CASE WHEN JSON_QUERY(dados,'$.transactions') IS NOT NULL OR JSON_QUERY(dados,'$.categories') IS NOT NULL THEN 'financeiro' ELSE 'OUTRA COISA' END, " + CONT_SQL('dados') + " FROM dados_financeiros"))) {
      const c = get(l[0]); c.sqlForma = l[1]; c.sql = { lanc: +l[2], contas: +l[3], orc: +l[4], metas: +l[5] };
    }
    for (const l of linhas(sql("SELECT email, " + CONT_SQL('dados') + " FROM nexus_dados_financeiros WHERE email NOT LIKE '__sis__%'"))) get(l[0]).espelho = { lanc: +l[1], contas: +l[2], orc: +l[3], metas: +l[4] };
    for (const l of linhas(sql("SELECT user_email, COUNT(*) FROM transacoes GROUP BY user_email"))) { const c = get(l[0]); c.rel = c.rel || {}; c.rel.lanc = +l[1]; }
    for (const l of linhas(sql("SELECT user_email, COUNT(*) FROM contas_bancarias GROUP BY user_email"))) { const c = get(l[0]); c.rel = c.rel || {}; c.rel.contas = +l[1]; }
  } catch (e) { sqlOk = false; problemas.push('SQL Server (' + BANCO + ') inacessível: ' + String(e.message).split('\n')[0]); }

  // histórico local
  const hist = BackupFinanceiro.createStore({ dir: path.join(DATA, 'backups_financeiros') });
  for (const k of contas.keys()) { const ult = hist.latest(k); if (ult) get(k).hist = { ...cont(ult.dados), n: hist.list(k).length, quando: new Date(ult.ts).toISOString().slice(0, 16).replace('T', ' ') }; }

  // nuvem (opcional)
  if (process.argv.includes('--nuvem')) {
    try {
      const srv = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');
      const url = (srv.match(/RENDER_CLOUD_URL\s*=\s*process\.env\.RENDER_CLOUD_URL \|\| '([^']+)'/) || [])[1];
      const r = await fetch(url + '/api/sync/financial', { headers: { 'X-Nexus-Sync-Token': env.NEXUS_SYNC_TOKEN || '' }, signal: AbortSignal.timeout(45000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      for (const [k, v] of Object.entries(await r.json())) get(k).nuvem = cont(v);
    } catch (e) { problemas.push('nuvem (Render) inacessível: ' + e.message); }
  }

  console.log('Banco do aplicativo: ' + BANCO + (sqlOk ? '' : '  (INACESSÍVEL)') + '   Pasta de dados: ' + (DATA === RAIZ ? 'a do projeto' : DATA) + '\n');
  const fontes = [['arquivo', 'local'], ['SQL', 'sql'], ['espelho', 'espelho'], ['histórico', 'hist']].concat(process.argv.includes('--nuvem') ? [['nuvem', 'nuvem']] : []);
  for (const [email, c] of contas) {
    const base = c.local || c.sql || c.espelho;
    const alvo = ['local', 'sql', 'espelho', 'nuvem'].filter((f) => c[f] && (c[f].lanc || c[f].contas || c[f].orc || c[f].metas));
    console.log(mask(email));
    for (const [nome, f] of fontes) console.log('   ' + nome.padEnd(10) + txt(c[f]) + (f === 'hist' && c.hist ? '   (' + c.hist.n + ' cópia(s), última ' + c.hist.quando + ')' : ''));
    if (c.rel || sqlOk) console.log('   ' + 'tabelas'.padEnd(10) + 'transacoes=' + ((c.rel && c.rel.lanc) || 0) + '  contas_bancarias=' + ((c.rel && c.rel.contas) || 0));
    const avisos = [];
    if (c.sqlForma && c.sqlForma !== 'financeiro') avisos.push('SQL dados_financeiros guarda ' + c.sqlForma + ' (não é o financeiro)');
    const comConteudo = (x) => x && (x.lanc || x.contas || x.orc || x.metas);
    if (comConteudo(c.local) && sqlOk && !comConteudo(c.sql)) avisos.push('arquivo tem dados mas o SQL está zerado');
    if (comConteudo(c.local) && sqlOk && !comConteudo(c.espelho)) avisos.push('arquivo tem dados mas o espelho está zerado');
    if (comConteudo(c.local) && comConteudo(c.sql) && !igual(c.local, c.sql)) avisos.push('arquivo e SQL com contagens diferentes');
    if (comConteudo(c.sql) && c.local && !comConteudo(c.local)) avisos.push('o SQL tem dados mas o arquivo local está zerado (a recuperação automática refaz sozinha)');
    if (c.rel && c.sql && (c.rel.lanc || 0) !== c.sql.lanc) avisos.push('tabela transacoes (' + (c.rel.lanc || 0) + ') ≠ dados_financeiros (' + c.sql.lanc + ')');
    if (c.rel && c.sql && (c.rel.contas || 0) !== c.sql.contas) avisos.push('tabela contas_bancarias (' + (c.rel.contas || 0) + ') ≠ dados_financeiros (' + c.sql.contas + ')');
    if (c.nuvem && Boolean(comConteudo(c.nuvem)) !== Boolean(comConteudo(c.local))) avisos.push('a nuvem difere do PC (o PC reenvia a cada 10 s)');
    if (alvo.length === 0 && c.hist && comConteudo(c.hist)) avisos.push('conta zerada, mas há cópia no histórico (a recuperação automática a devolve)');
    if (base && !avisos.length) console.log('   → OK');
    for (const a of avisos) { console.log('   → ATENÇÃO: ' + a); problemas.push(mask(email) + ': ' + a); }
    console.log('');
  }
  console.log(problemas.length ? problemas.length + ' ponto(s) de atenção.' : 'Tudo certo: os dados estão gravados e batem em todas as fontes consultadas.');
  process.exitCode = problemas.length ? 1 : 0;   // (process.exit() com requisição de rede ainda fechando derruba o Node no Windows)
}
principal().catch((e) => { console.error('erro: ' + e.message); process.exitCode = 2; });
