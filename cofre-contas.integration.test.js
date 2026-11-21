'use strict';

/**
 * Integração do cofre de contas: sobe o server.js de verdade (NEXUS_DISABLE_DB=1) numa pasta temporária e reproduz o relato de 21/11/2026:
 * "cadastro a senha certinho e quando volto diz que o usuário não possui conta criada, mas ao redefinir a senha consigo".
 * Cenários: disco zerado no redeploy, lista menor devolvida por uma sincronização, arquivo que perde uma conta com o servidor no ar,
 * exclusão de propósito (nunca ressuscita) e datas impossíveis do espelho.
 * Rodar com: node --test cofre-contas.integration.test.js
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
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

let proc, porta, pasta, logSaida = '', ipSeq = 60;
const ipNovo = () => '10.7.7.' + (++ipSeq);

async function api(method, rota, { token, body, headers } = {}) {
  const h = { 'X-Forwarded-For': ipNovo(), ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  let corpo;
  if (body !== undefined) { corpo = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch (e) { /* não-JSON */ }
  return { status: r.status, json, texto };
}
const login = (email, password) => api('POST', '/api/login', { body: { email, password } });
const sync = (rota, body, method) => api(method || 'POST', rota, { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body });
const lerUsuarios = () => JSON.parse(fs.readFileSync(path.join(pasta, 'local_users.json'), 'utf8'));
const usuario = (email) => lerUsuarios().find((u) => u.email === email);
const lerCofre = () => JSON.parse(fs.readFileSync(path.join(pasta, 'cofre_contas.json'), 'utf8'));
const gravarLista = (lista) => { for (const n of ['local_users.json', 'local_users.backup.json']) fs.writeFileSync(path.join(pasta, n), JSON.stringify(lista, null, 2)); };

const conta = (id, nome, email, senha, cpf, nasc, extra) => ({ id, name: nome, email, password: hashPwd(senha), role: 'Usuário', active: true, cpf, phone: null, birth_date: nasc, terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-08T10:00:00-03:00', subscription_status: 'trial', created_at: '2026-11-08T10:00:00-03:00', ...(extra || {}) });
const ADMIN = conta(1, 'Admin Teste', 'admin@teste.nexus', 'Admin@12345', '11144477735', '01/01/1980', { role: 'Administrador', subscription_status: 'active', subscription_plan: 'vitalicio' });
const ANA = conta(2, 'Ana Teste', 'ana@teste.nexus', 'Ana@12345', '52998224725', '17/05/1990');
const BIA = conta(3, 'Bia Teste', 'bia@teste.nexus', 'Bia@12345', '39053344705', '02/02/1992');
const CLO = conta(4, 'Clo Teste', 'clo@teste.nexus', 'Clo@12345', '86288366757', '09/09/1989');

async function subir() {
  porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET;
  logSaida = '';
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
  await new Promise((fim) => { p.once('exit', fim); p.kill(); setTimeout(fim, 3000); });
  await dorme(150);
}

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cofre-'));
  const seed = { 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  gravarLista([ADMIN, ANA, BIA, CLO]);
  await subir();
});

test.after(async () => {
  await parar();
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
});

test('na subida o cofre aprende todas as contas da lista (com a senha em hash) e o /api/health mostra o cofre', async () => {
  const cofre = lerCofre();
  assert.deepEqual(Object.keys(cofre.contas).sort(), ['admin@teste.nexus', 'ana@teste.nexus', 'bia@teste.nexus', 'clo@teste.nexus']);
  assert.ok(String(cofre.contas['ana@teste.nexus'].registro.password).startsWith('scrypt:'));
  const saude = await sync('/api/health', undefined, 'GET');
  assert.equal(saude.json.armazenamento.cofre_contas.contas, 4);
  assert.equal(saude.json.armazenamento.contas_no_arquivo, 4);
  assert.ok(!/scrypt:/.test(saude.texto), 'o /api/health nunca mostra hash');
  assert.ok(!/@teste\.nexus/.test(JSON.stringify(saude.json.armazenamento)), 'nem e-mail');
});

test('PONTO DO BUG: disco zerado no redeploy (lista vazia) => as contas voltam do cofre ANTES de o servidor aceitar conexões e o login funciona', async () => {
  await parar();
  gravarLista([]);   // o que o Render faz a cada reinício sem disco persistente: arquivo vazio
  await subir();
  assert.ok(/\[COFRE\].*restaurada/.test(logSaida) || lerUsuarios().length === 4, 'o cofre devia ter restaurado as contas na subida:\n' + logSaida.slice(-800));
  assert.equal(lerUsuarios().length, 4);
  const ok = await login('ana@teste.nexus', 'Ana@12345');
  assert.equal(ok.status, 200, 'depois do disco zerado o login deu: ' + ok.texto);
  assert.equal(ok.json.success, true);
  assert.equal((await login('ana@teste.nexus', 'senha-errada')).status, 401, 'senha errada continua recusada (a restauração não afrouxa nada)');
});

test('conta que some do arquivo COM O SERVIDOR NO AR: o login a traz de volta em vez de dizer "não possui conta criada"', async () => {
  gravarLista([ADMIN, ANA, CLO]);   // BIA some do arquivo (sincronização que devolveu lista menor)
  assert.equal(usuario('bia@teste.nexus'), undefined);
  const ok = await login('bia@teste.nexus', 'Bia@12345');
  assert.equal(ok.status, 200, 'a conta guardada no cofre devia ter voltado: ' + ok.texto);
  assert.ok(usuario('bia@teste.nexus'), 'a conta voltou para o arquivo');
});

test('a recuperação de senha também acha a conta que sumiu do arquivo (por e-mail e por CPF) e continua exigindo a data de nascimento', async () => {
  gravarLista([ADMIN, ANA]);   // BIA e CLO somem
  const semData = await api('POST', '/api/forgot-password', { body: { email: 'clo@teste.nexus', birth_date: '01/01/2000' } });
  assert.equal(semData.status, 400, 'o segundo fator não é dispensado para conta restaurada: ' + semData.texto);
  assert.equal(semData.json.errorType, 'invalid_birth_date');
  const porEmail = await api('POST', '/api/forgot-password', { body: { email: 'clo@teste.nexus', birth_date: '09/09/1989' } });
  assert.equal(porEmail.status, 200, porEmail.texto);
  assert.ok(porEmail.json.tempPassword);
  gravarLista([ADMIN, ANA]);
  const porCpf = await api('POST', '/api/forgot-password', { body: { cpf: '39053344705', birth_date: '02/02/1992' } });
  assert.equal(porCpf.status, 200, 'por CPF: ' + porCpf.texto);
});

test('TRAVA ANTI-PERDA: um administrador que salva uma lista SEM uma conta (overwrite) não a apaga se não há lápide', async () => {
  gravarLista([ADMIN, ANA, BIA, CLO]);
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).json.token;
  const envio = await api('POST', '/api/users?overwrite=true', { token: admin, body: [ADMIN, ANA] });
  assert.equal(envio.status, 200, envio.texto);
  const emails = lerUsuarios().map((u) => u.email).sort();
  assert.deepEqual(emails, ['admin@teste.nexus', 'ana@teste.nexus', 'bia@teste.nexus', 'clo@teste.nexus'], 'contas sem lápide foram apagadas pela lista menor');
  assert.match(logSaida, /MANTIDAS/);
});

test('exclusão DE PROPÓSITO continua valendo: a conta não volta no login, nem na subida, nem pelo cofre', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).json.token;
  const del = await api('DELETE', '/api/users?email=clo@teste.nexus', { token: admin });
  assert.equal(del.status, 200, del.texto);
  assert.equal(usuario('clo@teste.nexus'), undefined);
  assert.equal((await login('clo@teste.nexus', 'Clo@12345')).status, 404);
  assert.equal(lerCofre().contas['clo@teste.nexus'], undefined, 'saiu de circulação no cofre');
  assert.ok(lerCofre().excluidas['clo@teste.nexus'], 'a última versão fica guardada em "excluidas"');
  await parar(); await subir();
  assert.equal(usuario('clo@teste.nexus'), undefined, 'a subida do servidor ressuscitou uma conta excluída');
  assert.equal((await login('clo@teste.nexus', 'Clo@12345')).status, 404);
  const rec = await api('POST', '/api/forgot-password', { body: { email: 'clo@teste.nexus', birth_date: '09/09/1989' } });
  assert.equal(rec.status, 404, 'a recuperação de senha também não a reconhece');
});

test('DATAS IMPOSSÍVEIS (deriva de fuso do espelho): created_at/last_login do futuro enviados pelo PC não são gravados', async () => {
  gravarLista([ADMIN, ANA, BIA]);
  const antes = usuario('ana@teste.nexus');
  const envio = await sync('/api/users?overwrite=true', [
    { ...ADMIN }, { ...ANA, created_at: '2028-10-06T17:08:14-03:00', last_login: '2027-05-30T23:00:14-03:00' }, { ...BIA }
  ]);
  assert.equal(envio.status, 200, envio.texto);
  const depois = usuario('ana@teste.nexus');
  assert.ok(Date.parse(depois.created_at) < Date.now() + 36 * 3600 * 1000, 'created_at ficou no futuro: ' + depois.created_at);
  assert.ok(!depois.last_login || Date.parse(depois.last_login) < Date.now() + 36 * 3600 * 1000, 'last_login ficou no futuro: ' + depois.last_login);
  assert.equal(depois.created_at, antes.created_at, 'voltou ao created_at real que já estava no arquivo');
});
