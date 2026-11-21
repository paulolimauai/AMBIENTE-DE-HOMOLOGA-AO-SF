'use strict';

/**
 * Integração da persistência dos dados financeiros: sobe o server.js de verdade (sem banco: NEXUS_DISABLE_DB=1) numa pasta temporária e reproduz
 * o que o usuário relatou ("cadastro os dados no painel, mudo o código e some tudo"):
 *   - o que é cadastrado fica em disco e em backups_financeiros/ e sobrevive a reinícios do servidor;
 *   - um retrato ZERADO (disco novo do Render, restore vazio, cliente antigo) não apaga conta preenchida;
 *   - se o arquivo local for zerado mesmo assim, a conta VOLTA SOZINHA a partir do histórico, ao subir e ao ser lida;
 *   - gravação que reduz o conteúdo guarda antes a versão anterior.
 * Rodar com: node --test dados-persistencia.integration.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const JWT_SECRET = 'segredo-de-teste-' + 'x'.repeat(40);
const SYNC_TOKEN = 'token-sync-de-teste-' + 'y'.repeat(20);
const EMAIL = 'ana@teste.nexus';
const SENHA = 'Ana@12345';
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

let proc, porta, pasta, logSaida = '', ipSeq = 20;
const ipNovo = () => '10.9.8.' + (++ipSeq);

async function api(method, rota, { token, body } = {}) {
  const h = { 'X-Forwarded-For': ipNovo() };
  if (token) h.Authorization = 'Bearer ' + token;
  let corpo;
  if (body !== undefined) { corpo = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch (e) { /* não-JSON */ }
  return { status: r.status, json, texto };
}

const dadosCom = (n, extra) => ({
  categories: [{ id: 1, name: 'Casa', type: 'despesa', color: '#fff', icon: 'x', count: 0 }],
  accounts: [{ id: 1, name: 'Cartão Teste', type: 'cartao' }],
  transactions: Array.from({ length: n }, (_, i) => ({ id: i + 1, description: 'Lançamento ' + (i + 1), amount: 100 + i, type: 'despesa', date: '2026-11-20', status: 'pago', account_id: 1, category: 'Casa' })),
  budgets: [], goals: [], recurringList: [], alerts: [], attachments: [], notifications: [],
  nextAccId: 2, nextTxId: n + 1, nextBudgetId: 1, nextGoalId: 1, nextRecId: 1, nextAlertId: 1, nextAttId: 1, nextNotifId: 1,
  updated_at: new Date().toISOString(),
  ...(extra || {})
});
const zerado = () => ({ ...dadosCom(0), accounts: [], updated_at: new Date(Date.now() + 60000).toISOString() });   // carimbo MAIS NOVO: o pior caso

const lerArquivo = () => JSON.parse(fs.readFileSync(path.join(pasta, 'local_database_data.json'), 'utf8'));
const pastaHistorico = () => path.join(pasta, 'backups_financeiros');
const copiasDoHistorico = () => { try { return fs.readdirSync(pastaHistorico()).flatMap((d) => fs.readdirSync(path.join(pastaHistorico(), d))).filter((n) => n.endsWith('.json')); } catch (e) { return []; } };

async function subir() {
  logSaida = '';
  porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET;
  proc = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { logSaida += d.toString(); });
  proc.stderr.on('data', (d) => { logSaida += d.toString(); });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) return; } catch (e) { /* ainda subindo */ }
    await dorme(150);
  }
  throw new Error('servidor de teste não subiu:\n' + logSaida.slice(-1500));
}
async function parar() {
  if (!proc) return;
  const p = proc; proc = null;
  await new Promise((res) => { p.once('exit', res); p.kill(); setTimeout(res, 3000); });
  await dorme(200);
}
async function entrar() {
  const r = await api('POST', '/api/login', { body: { email: EMAIL, password: SENHA } });
  assert.equal(r.status, 200, 'login: ' + r.texto);
  return r.json.token;
}
const salvar = (token, dados, extra) => api('POST', '/api/data', { token, body: { email: EMAIL, data: dados, ...(extra || {}) } });
const ler = (token) => api('GET', '/api/data?email=' + encodeURIComponent(EMAIL), { token });

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-dados-'));
  const ana = { id: 2, name: 'Ana Teste', email: EMAIL, password: hashPwd(SENHA), role: 'Usuário', active: true, cpf: '52998224725', phone: null, birth_date: '17/05/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: new Date().toISOString(), subscription_status: 'trial' };
  const seed = { 'local_users.json': [ana], 'local_users.backup.json': [ana], 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  await subir();
});

test.after(async () => {
  await parar();
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
});

test('1) o que é cadastrado vai para o arquivo e para o histórico, e a leitura devolve igual', async () => {
  const token = await entrar();
  const r = await salvar(token, dadosCom(3));
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.success, true);
  assert.equal(lerArquivo()[EMAIL].transactions.length, 3, 'não chegou ao arquivo');
  assert.ok(copiasDoHistorico().length >= 1, 'não gerou cópia no histórico (backups_financeiros)');
  const g = await ler(token);
  assert.equal(g.status, 200);
  assert.equal(g.json.transactions.length, 3);
  assert.equal(g.json.accounts.length, 1);
});

test('2) mudar o código = reiniciar o servidor: os dados continuam lá', async () => {
  await parar();
  await subir();
  const token = await entrar();
  const g = await ler(token);
  assert.equal(g.json.transactions.length, 3, 'sumiu depois de reiniciar');
  assert.equal(g.json.accounts.length, 1);
});

test('3) retrato ZERADO (mesmo com carimbo mais novo) não apaga conta preenchida', async () => {
  const token = await entrar();
  const r = await salvar(token, zerado());
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.preserved, true, 'o zerado foi aceito: ' + r.texto);
  const g = await ler(token);
  assert.equal(g.json.transactions.length, 3);
  assert.equal(lerArquivo()[EMAIL].transactions.length, 3);
});

test('4) arquivo local ZERADO à força (disco novo): ao subir, a conta volta sozinha do histórico', async () => {
  await parar();
  const vazio = { [EMAIL]: zerado() };
  fs.writeFileSync(path.join(pasta, 'local_database_data.json'), JSON.stringify(vazio));
  fs.writeFileSync(path.join(pasta, 'local_database_data.backup.json'), JSON.stringify(vazio));   // o "backup" espelho zera junto
  assert.equal(lerArquivo()[EMAIL].transactions.length, 0, 'preparação: o arquivo precisa estar zerado');
  assert.ok(copiasDoHistorico().length >= 1, 'preparação: o histórico precisa existir');
  await subir();
  const token = await entrar();
  const g = await ler(token);
  assert.equal(g.json.transactions.length, 3, 'não voltou do histórico. Log:\n' + logSaida.slice(-1200));
  assert.equal(g.json.accounts.length, 1);
  assert.equal(lerArquivo()[EMAIL].transactions.length, 3, 'a recuperação não foi gravada no arquivo');
  assert.match(logSaida, /\[RECUPERAÇÃO\] Dados financeiros de ana\*\*\*@teste\.nexus restaurados de histórico local/);
});

test('5) zerado com o servidor NO AR (sem reiniciar): a próxima leitura traz a conta de volta', async () => {
  const token = await entrar();
  // simula outro processo/sincronização zerando o arquivo por baixo do servidor
  const vazio = { [EMAIL]: zerado() };
  fs.writeFileSync(path.join(pasta, 'local_database_data.json'), JSON.stringify(vazio));
  fs.writeFileSync(path.join(pasta, 'local_database_data.backup.json'), JSON.stringify(vazio));
  await dorme(1500);   // o cache de arquivos percebe a troca pela data de modificação
  const g = await ler(token);
  assert.equal(g.json.transactions.length, 3, 'a leitura devolveu a conta zerada');
});

test('6) gravação que REDUZ o conteúdo guarda antes a versão anterior', async () => {
  const token = await entrar();
  assert.equal((await salvar(token, dadosCom(6, { updated_at: new Date(Date.now() + 1000).toISOString() }))).status, 200);
  const antes = copiasDoHistorico().length;
  assert.equal((await salvar(token, dadosCom(1, { updated_at: new Date(Date.now() + 2000).toISOString() }))).status, 200);   // apagou 5 de 6
  assert.equal(lerArquivo()[EMAIL].transactions.length, 1, 'a exclusão legítima do usuário vale');
  const dir = pastaHistorico();
  const todas = fs.readdirSync(dir).flatMap((d) => fs.readdirSync(path.join(dir, d)).map((n) => path.join(dir, d, n))).filter((f) => f.endsWith('.json'));
  const comSeis = todas.filter((f) => JSON.parse(fs.readFileSync(f, 'utf8')).dados.transactions.length === 6);
  assert.ok(comSeis.length >= 1, 'a versão com 6 lançamentos não ficou no histórico (cópias: ' + antes + ' -> ' + todas.length + ')');
});

test('7) o histórico não cria nada para conta nova e vazia (nada a proteger, nada a restaurar)', async () => {
  const token = await entrar();
  const g = await ler(token);
  assert.equal(g.status, 200);
  const dir = pastaHistorico();
  assert.ok(fs.existsSync(dir));
  for (const d of fs.readdirSync(dir)) for (const n of fs.readdirSync(path.join(dir, d))) {
    if (!n.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(dir, d, n), 'utf8'));
    assert.ok(j.dados.transactions.length + j.dados.accounts.length > 0, 'cópia zerada no histórico: ' + n);
  }
});
