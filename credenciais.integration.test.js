'use strict';

/**
 * Integração das credenciais: sobe o server.js de verdade (sem banco: NEXUS_DISABLE_DB=1) numa pasta temporária e reproduz o que acontecia
 * em produção: a senha criada na nuvem era desfeita pelo envio de 10 em 10 s do PC (hash antigo do SQL Server com overwrite=true).
 * Rodar com: node --test credenciais.integration.test.js
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

let proc, porta, pasta, logSaida = '', ipSeq = 40;
const ipNovo = () => '10.7.6.' + (++ipSeq);

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

// Linha como o SQL Server do PC a enviaria: com o hash que ele tem, e SEM password_changed_at (a coluna não existe lá)
const linhaDoPc = (u, extra) => {
  const { password_changed_at, must_change_password, ...resto } = u; // eslint-disable-line no-unused-vars
  return { ...resto, must_change_password: false, ...(extra || {}) };
};

const ADMIN = { id: 1, name: 'Admin Teste', email: 'admin@teste.nexus', password: hashPwd('Admin@12345'), role: 'Administrador', active: true, cpf: '11144477735', phone: null, birth_date: '01/01/1980', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-01T10:00:00-03:00', subscription_status: 'active', subscription_plan: 'vitalicio' };
const ANA = { id: 2, name: 'Ana Teste', email: 'ana@teste.nexus', password: hashPwd('Ana@12345'), role: 'Usuário', active: true, cpf: '52998224725', phone: null, birth_date: '17/05/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-08T10:00:00-03:00', subscription_status: 'trial' };
const BIA = { id: 3, name: 'Bia Teste', email: 'bia@teste.nexus', password: hashPwd('Bia@12345'), role: 'Usuário', active: true, cpf: '39053344705', phone: null, birth_date: '02/02/1992', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-08T10:00:00-03:00', subscription_status: 'trial' };
const ANA_SENHA_ANTIGA = 'Ana@12345';

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cred-'));
  const usuarios = [ADMIN, ANA, BIA];
  const seed = { 'local_users.json': usuarios, 'local_users.backup.json': usuarios, 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET;
  proc = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { logSaida += d.toString(); });
  proc.stderr.on('data', (d) => { logSaida += d.toString(); });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) return; } catch (e) { /* ainda subindo */ }
    await dorme(150);
  }
  throw new Error('servidor de teste não subiu:\n' + logSaida.slice(-1500));
});

test.after(async () => {
  if (proc) { proc.kill(); await dorme(200); }
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
});

test('PONTO DO BUG: senha criada na nuvem NÃO é desfeita pelo envio do PC com o hash antigo do SQL Server', async () => {
  // 1) "esqueci a senha" na nuvem: gera a senha provisória (hash novo + password_changed_at)
  const rec = await api('POST', '/api/forgot-password', { body: { email: 'ana@teste.nexus', birth_date: '17/05/1990' } });
  assert.equal(rec.status, 200, rec.texto);
  const provisoria = rec.json.tempPassword;
  assert.ok(provisoria, 'a recuperação devolve a senha provisória');
  assert.ok(usuario('ana@teste.nexus').password_changed_at, 'a troca grava o relógio da senha');

  // 2) o PC envia (overwrite=true) o que o SQL Server ainda tem: o hash ANTIGO da Ana, sem relógio
  const envio = await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(ANA), linhaDoPc(BIA)]);
  assert.equal(envio.status, 200, envio.texto);

  // 3) a senha provisória continua valendo; a antiga não volta
  const ok = await login('ana@teste.nexus', provisoria);
  assert.equal(ok.status, 200, 'a senha criada na nuvem sumiu depois do envio do PC: ' + ok.texto);
  assert.equal(ok.json.success, true);
  const velha = await login('ana@teste.nexus', ANA_SENHA_ANTIGA);
  assert.equal(velha.status, 401, 'a senha antiga voltou a valer');
});

test('envios repetidos do PC (a cada 10 s) não mexem na senha nova', async () => {
  const rec = await api('POST', '/api/forgot-password', { body: { email: 'ana@teste.nexus', birth_date: '17/05/1990' } });
  const nova = rec.json.tempPassword;
  for (let i = 0; i < 5; i++) {
    assert.equal((await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(ANA), linhaDoPc(BIA)])).status, 200);
  }
  assert.equal((await login('ana@teste.nexus', nova)).status, 200);
});

test('senha trocada NO PC (hash com relógio mais novo) chega à nuvem e vale; a anterior deixa de valer', async () => {
  const novaNoPc = 'Pc@Nova12345';
  const relogio = new Date().toISOString();                // mais novo que a troca feita na nuvem logo antes
  const envio = await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(ANA, { password: hashPwd(novaNoPc), password_changed_at: relogio }), linhaDoPc(BIA)]);
  assert.equal(envio.status, 200, envio.texto);
  assert.equal((await login('ana@teste.nexus', novaNoPc)).status, 200, 'a senha trocada no PC não chegou à nuvem');
  assert.equal(usuario('ana@teste.nexus').password_changed_at, relogio, 'o relógio da troca acompanha o hash');

  // e um envio atrasado com o hash velho (sem relógio) não a desfaz
  await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(ANA), linhaDoPc(BIA)]);
  assert.equal((await login('ana@teste.nexus', novaNoPc)).status, 200, 'o envio atrasado desfez a senha do PC');
});

test('conta criada só na nuvem não some quando o PC envia a lista dele (overwrite=true)', async () => {
  const cloud = await sync('/api/users', [{ name: 'Carla Nuvem', email: 'carla@teste.nexus', password: hashPwd('Carla@12345'), role: 'Usuário', active: true, cpf: '', birth_date: '03/03/1993' }]);
  assert.equal(cloud.status, 200, cloud.texto);
  assert.equal((await login('carla@teste.nexus', 'Carla@12345')).status, 200);

  // o PC ainda não conhece a Carla: o envio dele não traz a conta
  await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(usuario('ana@teste.nexus')), linhaDoPc(BIA)]);
  assert.ok(usuario('carla@teste.nexus'), 'a conta criada só na nuvem foi apagada pelo envio do PC');
  assert.equal((await login('carla@teste.nexus', 'Carla@12345')).status, 200);
  const lista = await sync('/api/users', undefined, 'GET');
  assert.ok(lista.json.some((u) => u.email === 'carla@teste.nexus'), 'o PC não veria a conta para importá-la');
});

test('conta excluída de propósito continua excluída (o envio do PC não a ressuscita)', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).json.token;
  const del = await api('DELETE', '/api/users?email=bia@teste.nexus', { token: admin });
  assert.equal(del.status, 200, del.texto);
  await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(usuario('ana@teste.nexus')), linhaDoPc(BIA)]);
  assert.equal(usuario('bia@teste.nexus'), undefined, 'a conta excluída voltou');
  assert.equal((await login('bia@teste.nexus', 'Bia@12345')).status, 404);
});

test('a troca de senha em Minha Conta e a recuperação continuam funcionando (login com a nova, recusa da antiga)', async () => {
  const entrou = await login('ana@teste.nexus', 'Pc@Nova12345');
  assert.equal(entrou.status, 200);
  const nova = 'Outra@Senha123';
  const troca = await api('POST', '/api/user/profile', { token: entrou.json.token, body: { newPassword: nova } });
  assert.equal(troca.status, 200, troca.texto);
  assert.equal((await login('ana@teste.nexus', nova)).status, 200);
  assert.equal((await login('ana@teste.nexus', 'Pc@Nova12345')).status, 401);
  // o envio atrasado do PC (hash velho, sem relógio) tampouco desfaz esta
  await sync('/api/users?overwrite=true', [linhaDoPc(ADMIN), linhaDoPc(ANA, { password: hashPwd('Pc@Nova12345') })]);
  assert.equal((await login('ana@teste.nexus', nova)).status, 200);
});
