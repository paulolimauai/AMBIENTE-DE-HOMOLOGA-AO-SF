'use strict';

/**
 * Prova ponta a ponta, contra um SQL Server DE VERDADE, de que os dados financeiros são gravados no banco e voltam sozinhos depois de um apagão.
 * Cria o banco descartável NEXUS_PERSIST_TESTE (e o apaga no fim), sobe o server.js apontando para ele, com pasta de dados própria e SEM falar com
 * o Supabase real nem com a nuvem (Render). Não toca o banco do aplicativo (nexus_app).
 *
 *   node scripts/e2e_persistencia_sql.js
 *
 * Cenários: (1) cadastrar -> conferir no SQL (dados_financeiros, transacoes, contas_bancarias) e no espelho; (2) reiniciar;
 * (3) arquivo local zerado + sem histórico -> volta do SQL; (4) arquivo zerado + SQL zerado + sem histórico -> volta do espelho,
 * e o zerado NÃO sobrescreve o espelho; (5) conta realmente vazia continua vazia (nada inventado).
 */
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..');
const BANCO = 'NEXUS_PERSIST_TESTE';
const EMAIL = 'ana.persistencia@teste.nexus';
const SENHA = 'Ana@12345';
const SYNC_TOKEN = 'token-sync-de-teste-' + 'y'.repeat(20);
const JWT_SECRET = 'segredo-de-teste-' + 'x'.repeat(40);
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function sql(consulta, banco) {
  const args = ['-S', 'localhost', '-E', '-C', '-W', '-h', '-1', '-b'];
  if (banco) args.push('-d', banco);
  // A consulta vai por arquivo (-i): aspas dentro de -Q são desfeitas pelo Windows ao montar a linha de comando
  const arq = path.join(os.tmpdir(), 'nexus_e2e_' + crypto.randomBytes(4).toString('hex') + '.sql');
  fs.writeFileSync(arq, 'SET NOCOUNT ON;\n' + consulta + '\n');
  args.push('-i', arq);
  try { return execFileSync('sqlcmd', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  finally { try { fs.unlinkSync(arq); } catch (e) { /* temporário */ } }
}
const num = (consulta) => parseInt(sql(consulta, BANCO).split(/\r?\n/).pop(), 10);

let proc, porta, pasta, log = '', ipSeq = 100;
const resultados = [];
function confere(nome, ok, detalhe) { resultados.push({ nome, ok: Boolean(ok), detalhe: detalhe || '' }); console.log((ok ? '  OK    ' : '  FALHOU ') + nome + (detalhe && !ok ? '  -> ' + detalhe : '')); }

async function api(method, rota, { token, body, headers } = {}) {
  const h = { 'X-Forwarded-For': '10.5.4.' + (++ipSeq), ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  let corpo; if (body !== undefined) { corpo = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
  const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch (e) { /* não-JSON */ }
  return { status: r.status, json, texto };
}

async function subir() {
  log = ''; porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, MSSQL_DATABASE: BANCO, NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, TRUST_PROXY: '1',
    RENDER_CLOUD_URL: 'https://127.0.0.1:9', SUPABASE_URL: 'http://127.0.0.1:9', SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste', SUPABASE_ANON_KEY: 'chave-de-teste' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_DISABLE_DB; delete env.NEXUS_DISABLE_SUPABASE; delete env.NEXUS_ALLOW_DB_RESET;
  proc = spawn(process.execPath, ['server.js'], { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { log += d.toString(); });
  proc.stderr.on('data', (d) => { log += d.toString(); });
  for (let i = 0; i < 160; i++) {
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) break; } catch (e) { /* subindo */ }
    await dorme(150);
    if (i === 159) throw new Error('servidor não subiu:\n' + log.slice(-1500));
  }
  // espera a conexão com o banco de teste e a conferência inicial
  for (let i = 0; i < 120 && !/Conexão ativa e sincronizada/.test(log); i++) await dorme(150);
  if (!new RegExp('banco: ' + BANCO).test(log)) throw new Error('o servidor NÃO conectou ao banco de teste (' + BANCO + '):\n' + log.slice(-1500));
  if (/lrklz|nexus_app/.test(log.replace(/MSSQL_DATABASE/g, ''))) throw new Error('o servidor tocou o ambiente real:\n' + log.slice(-800));
  await dorme(2500);   // deixa a conferência de recuperação e o 1º envio ao espelho terminarem
}
async function parar() {
  if (!proc) return; const p = proc; proc = null;
  await new Promise((res) => { p.once('exit', res); p.kill(); setTimeout(res, 4000); });
  await dorme(400);
}

const dadosCom = (n) => ({
  categories: [{ id: 1, name: 'Casa', type: 'despesa', color: '#fff', icon: 'x', count: 0 }],
  accounts: [{ id: 1, name: 'Cartão Teste', type: 'cartao', balance: 0 }],
  transactions: Array.from({ length: n }, (_, i) => ({ id: i + 1, description: 'Lançamento ' + (i + 1), amount: 100 + i, type: 'despesa', date: '2026-11-20', status: 'pago', account_id: 1, category: 'Casa' })),
  budgets: [], goals: [], recurringList: [], alerts: [], attachments: [], notifications: [],
  nextAccId: 2, nextTxId: n + 1, nextBudgetId: 1, nextGoalId: 1, nextRecId: 1, nextAlertId: 1, nextAttId: 1, nextNotifId: 1,
  updated_at: new Date().toISOString()
});
const zerado = () => ({ ...dadosCom(0), accounts: [], updated_at: new Date(Date.now() + 120000).toISOString() });

const txNoSql = () => num("SELECT ISNULL((SELECT COUNT(*) FROM OPENJSON(dados,'$.transactions')),0) FROM dados_financeiros WHERE LOWER(email)='" + EMAIL + "'");
const txNoEspelho = () => num("SELECT ISNULL((SELECT COUNT(*) FROM OPENJSON(dados,'$.transactions')),0) FROM nexus_dados_financeiros WHERE LOWER(email)='" + EMAIL + "'");
const linhasTrans = () => num("SELECT COUNT(*) FROM transacoes WHERE LOWER(user_email)='" + EMAIL + "'");
const linhasContas = () => num("SELECT COUNT(*) FROM contas_bancarias WHERE LOWER(user_email)='" + EMAIL + "'");
const arquivoLocal = () => JSON.parse(fs.readFileSync(path.join(pasta, 'local_database_data.json'), 'utf8'))[EMAIL];
async function esperar(fn, ms) { const fim = Date.now() + (ms || 10000); let v; while (Date.now() < fim) { try { v = fn(); if (v) return v; } catch (e) { v = null; } await dorme(400); } return v; }
const ler = async (token) => (await api('GET', '/api/data?email=' + encodeURIComponent(EMAIL), { token })).json;
const entrar = async () => { const r = await api('POST', '/api/login', { body: { email: EMAIL, password: SENHA } }); if (r.status !== 200) throw new Error('login falhou: ' + r.texto); return r.json.token; };
const zerarArquivo = () => { const v = { [EMAIL]: zerado() }; fs.writeFileSync(path.join(pasta, 'local_database_data.json'), JSON.stringify(v)); fs.writeFileSync(path.join(pasta, 'local_database_data.backup.json'), JSON.stringify(v)); };
const apagarHistorico = () => fs.rmSync(path.join(pasta, 'backups_financeiros'), { recursive: true, force: true });

async function principal() {
  console.log('Banco descartável: ' + BANCO + ' (o banco do aplicativo não é tocado)');
  try { sql("IF DB_ID('" + BANCO + "') IS NOT NULL BEGIN ALTER DATABASE [" + BANCO + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + BANCO + "]; END"); } catch (e) { /* não existia */ }
  sql('CREATE DATABASE [' + BANCO + ']');
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-persist-'));
  for (const [n, c] of Object.entries({ 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require(path.join(RAIZ, 'atendimento')).filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] })) fs.writeFileSync(path.join(pasta, n), JSON.stringify(c, null, 2));

  console.log('\n[1] Cadastrar e conferir no banco');
  await subir();
  const ana = { id: 2, name: 'Ana Persistencia', email: EMAIL, password: hashPwd(SENHA), role: 'Usuário', active: true, cpf: '52998224725', phone: null, birth_date: '17/05/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: new Date().toISOString(), subscription_status: 'trial' };
  const criada = await api('POST', '/api/users', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: [ana] });
  confere('conta de teste criada', criada.status === 200, criada.texto.slice(0, 160));
  let token = await entrar();
  const salvo = await api('POST', '/api/data', { token, body: { email: EMAIL, data: dadosCom(3) } });
  confere('POST /api/data respondeu sucesso E o banco confirmou a gravação (sql:true)', salvo.status === 200 && salvo.json && salvo.json.success === true && salvo.json.sql === true, salvo.texto);
  confere('SQL Server: dados_financeiros tem os 3 lançamentos', await esperar(() => txNoSql() === 3), 'achou ' + txNoSql());
  confere('SQL Server: tabela transacoes tem 3 linhas', await esperar(() => linhasTrans() === 3), 'achou ' + linhasTrans());
  confere('SQL Server: tabela contas_bancarias tem 1 linha', await esperar(() => linhasContas() === 1), 'achou ' + linhasContas());
  confere('espelho durável (nexus_dados_financeiros) tem os 3 lançamentos', await esperar(() => txNoEspelho() === 3, 15000), 'achou ' + txNoEspelho());
  confere('arquivo local tem os 3 lançamentos', arquivoLocal().transactions.length === 3);
  confere('histórico local (backups_financeiros) guardou uma cópia', fs.existsSync(path.join(pasta, 'backups_financeiros')) && fs.readdirSync(path.join(pasta, 'backups_financeiros')).length >= 1);

  console.log('\n[2] Mudar o código = reiniciar o servidor');
  await parar(); await subir(); token = await entrar();
  const depois = await ler(token);
  confere('depois de reiniciar, a tela recebe os 3 lançamentos', depois.transactions.length === 3, 'recebeu ' + depois.transactions.length);
  confere('depois de reiniciar, o SQL continua com 3', txNoSql() === 3, 'achou ' + txNoSql());

  console.log('\n[3] Desastre A: arquivo local zerado e histórico apagado (só o SQL sabe)');
  await parar(); zerarArquivo(); apagarHistorico();
  await subir(); token = await entrar();
  const a = await ler(token);
  confere('os 3 lançamentos voltaram sozinhos do SQL Server', a.transactions.length === 3, 'recebeu ' + a.transactions.length + '\n' + log.slice(-600));
  confere('o arquivo local foi refeito', arquivoLocal().transactions.length === 3);
  confere('o SQL NÃO foi zerado pela subida', txNoSql() === 3, 'achou ' + txNoSql());

  console.log('\n[4] Desastre B: arquivo local zerado + SQL zerado + histórico apagado (só o espelho sabe)');
  await parar(); zerarArquivo(); apagarHistorico();
  sql("UPDATE dados_financeiros SET dados = '{\"categories\":[],\"accounts\":[],\"transactions\":[],\"budgets\":[],\"goals\":[],\"recurringList\":[],\"alerts\":[],\"attachments\":[],\"notifications\":[],\"updated_at\":\"2099-01-01T00:00:00.000Z\"}' WHERE LOWER(email)='" + EMAIL + "'", BANCO);
  sql("DELETE FROM transacoes WHERE LOWER(user_email)='" + EMAIL + "'", BANCO);
  confere('preparação: SQL realmente zerado', txNoSql() === 0 && linhasTrans() === 0);
  confere('preparação: espelho ainda tem 3', txNoEspelho() === 3, 'achou ' + txNoEspelho());
  await subir(); token = await entrar();
  const b = await ler(token);
  confere('os 3 lançamentos voltaram sozinhos do ESPELHO', b.transactions.length === 3, 'recebeu ' + b.transactions.length + '\n' + log.slice(-700));
  confere('o espelho NÃO foi sobrescrito pelo zerado (guarda ativa)', await esperar(() => txNoEspelho() === 3, 8000), 'achou ' + txNoEspelho());
  confere('o SQL principal foi refeito com os 3', await esperar(() => txNoSql() === 3, 8000), 'achou ' + txNoSql());
  confere('as linhas da tabela transacoes foram refeitas', await esperar(() => linhasTrans() === 3, 8000), 'achou ' + linhasTrans());

  console.log('\n[5] Controle: conta realmente nova e vazia continua vazia (nada é inventado)');
  const nova = { ...ana, id: 3, name: 'Bia Nova', email: 'bia.nova@teste.nexus', cpf: '39053344705', password: hashPwd('Bia@12345') };
  await api('POST', '/api/users', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: [ana, nova] });
  const rb = await api('POST', '/api/login', { body: { email: nova.email, password: 'Bia@12345' } });
  const vb = rb.status === 200 ? (await api('GET', '/api/data?email=' + encodeURIComponent(nova.email), { token: rb.json.token })).json : null;
  confere('conta nova não ganha lançamentos de ninguém', vb && vb.transactions.length === 0 && vb.accounts.length === 0, rb.texto.slice(0, 120));
}

principal()
  .catch((e) => { confere('execução do teste', false, e.message); })
  .finally(async () => {
    await parar();
    try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
    try { sql("IF DB_ID('" + BANCO + "') IS NOT NULL BEGIN ALTER DATABASE [" + BANCO + "] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [" + BANCO + "]; END"); console.log('\nBanco descartável removido.'); } catch (e) { console.log('\nAVISO: não consegui remover o banco ' + BANCO + ': ' + e.message); }
    const falhas = resultados.filter((r) => !r.ok);
    console.log('\n' + (resultados.length - falhas.length) + '/' + resultados.length + ' verificações OK' + (falhas.length ? ' — FALHARAM: ' + falhas.map((f) => f.nome).join(' | ') : ''));
    process.exit(falhas.length ? 1 : 0);
  });
