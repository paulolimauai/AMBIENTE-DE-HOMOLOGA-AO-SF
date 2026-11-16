'use strict';

/**
 * Integração da assinatura: sobe o server.js de verdade (sem banco: NEXUS_DISABLE_DB=1) numa pasta temporária e reproduz o que aconteceu em
 * 16/11/2026: o administrador liberava/bloqueava na nuvem e o PC (SQL Server, com a assinatura antiga e sem relógio) desfazia em poucos
 * segundos; liberações seguidas partiam da mesma base; e a lista de usuários que o navegador do administrador reenvia sobrescrevia a assinatura.
 * Rodar com: node --test assinatura.integration.test.js
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
const DIA = 86400000;
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

let proc, porta, pasta, logSaida = '', ipSeq = 60;
const ipNovo = () => '10.7.8.' + (++ipSeq);

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
const login = async (email, password) => (await api('POST', '/api/login', { body: { email, password } })).json;
const sync = (rota, body, method) => api(method || 'POST', rota, { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body });
const lerUsuarios = () => JSON.parse(fs.readFileSync(path.join(pasta, 'local_users.json'), 'utf8'));
const conta = (email) => lerUsuarios().find((u) => u.email === email);
const ms = (v) => Date.parse(v);

// Linha como o SQL Server do PC a enviaria: assinatura que ELE tem, SEM os relógios (as colunas não existem lá)
const linhaDoPc = (email, assinatura) => {
  const { password_changed_at, subscription_updated_at, ...resto } = conta(email); // eslint-disable-line no-unused-vars
  return { ...resto, ...(assinatura || {}) };
};
const envioDoPc = (itens) => sync('/api/users?overwrite=true', lerUsuarios().map((u) => { const e = itens.find((i) => i[0] === u.email); return linhaDoPc(u.email, e ? e[1] : undefined); }));

let admin;
const liberar = (email, corpo) => api('POST', '/api/subscription/admin-grant-time', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: email, ...corpo } });

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ass-'));
  const base = { role: 'Usuário', active: true, phone: '(62) 99999-0000', birth_date: '01/01/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: new Date(Date.now() - 3600000).toISOString(), subscription_status: 'trial' };
  const usuarios = [
    { ...base, id: 1, name: 'Admin Teste', email: 'admin@teste.nexus', password: hashPwd('Admin@12345'), role: 'Administrador', cpf: '11144477735', subscription_status: 'active', subscription_plan: 'vitalicio' },
    { ...base, id: 2, name: 'Ana Souza', email: 'ana@teste.nexus', password: hashPwd('Ana@12345'), cpf: '52998224725' },
    { ...base, id: 3, name: 'Bia Lima', email: 'bia@teste.nexus', password: hashPwd('Bia@12345'), cpf: '39053344705' },
    { ...base, id: 4, name: 'Caio Ativo', email: 'caio@teste.nexus', password: hashPwd('Caio@12345'), cpf: '12345678909', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(Date.now() + 10 * DIA).toISOString() },
    { ...base, id: 5, name: 'Edu Sem Teste', email: 'edu@teste.nexus', password: hashPwd('Edu@12345'), cpf: '98765432100', trial_started_at: new Date(Date.now() - 3 * DIA).toISOString(), subscription_status: 'expired' },
    { ...base, id: 6, name: 'Lia Legado', email: 'lia@teste.nexus', password: hashPwd('Lia@12345'), cpf: '11122233396', subscription_status: 'active', subscription_plan: 'administrador_ilimitado' }
  ];
  const seed = { 'local_users.json': usuarios, 'local_users.backup.json': usuarios, 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET;
  proc = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { logSaida += d.toString(); });
  proc.stderr.on('data', (d) => { logSaida += d.toString(); });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) break; } catch (e) { /* ainda subindo */ }
    await dorme(150);
    if (i === 79) throw new Error('servidor de teste não subiu:\n' + logSaida.slice(-1500));
  }
  assert.ok(!/Conectado com sucesso ao Microsoft SQL/.test(logSaida), 'o teste não pode usar o banco real');
  admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
});

test.after(async () => {
  if (proc) { proc.kill(); await dorme(200); }
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
});

test('PONTO DO BUG: liberação feita na nuvem NÃO é desfeita pelo envio do PC (assinatura antiga do SQL, sem relógio), nem por envios repetidos', async () => {
  const r = await liberar('ana@teste.nexus', { duration_days: 30 });
  assert.equal(r.status, 200, r.texto);
  assert.match(r.json.message, /Vence em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}\./, 'a mensagem da liberação traz o vencimento com data e hora');
  const apos = conta('ana@teste.nexus');
  assert.equal(apos.subscription_status, 'active'); assert.equal(apos.subscription_plan, 'cortesia_admin');
  assert.ok(apos.subscription_updated_at, 'a liberação carimba o relógio da assinatura');
  const vence = ms(apos.subscription_expires_at);
  for (let i = 0; i < 4; i++) {
    const envio = await envioDoPc([['ana@teste.nexus', { subscription_status: 'trial', subscription_plan: null, subscription_expires_at: null, subscription_method: null, subscription_payment_id: null }]]);
    assert.equal(envio.status, 200, envio.texto);
  }
  const depois = conta('ana@teste.nexus');
  assert.equal(depois.subscription_status, 'active', 'o PC desfez a liberação');
  assert.equal(depois.subscription_plan, 'cortesia_admin');
  assert.equal(ms(depois.subscription_expires_at), vence, 'a data e hora do vencimento mudaram');
  assert.equal(depois.subscription_updated_at, apos.subscription_updated_at);
});

test('liberações seguidas somam (30 dias + 1 dia = 31): a segunda parte da primeira, que ficou gravada', async () => {
  const antes = Date.now();
  assert.equal((await liberar('bia@teste.nexus', { duration_days: 30 })).status, 200);
  assert.equal((await liberar('bia@teste.nexus', { duration_days: 1 })).status, 200);
  const venc = ms(conta('bia@teste.nexus').subscription_expires_at);
  assert.ok(Math.abs(venc - (antes + 31 * DIA)) < 60000, 'esperado ~31 dias, deu ' + ((venc - antes) / DIA).toFixed(3));
  // mesmo com o PC mandando a assinatura antiga entre uma e outra
  await envioDoPc([['bia@teste.nexus', { subscription_status: 'trial', subscription_expires_at: null }]]);
  assert.equal((await liberar('bia@teste.nexus', { duration_minutes: 60 })).status, 200);
  const venc2 = ms(conta('bia@teste.nexus').subscription_expires_at);
  assert.ok(Math.abs(venc2 - (venc + 3600000)) < 5000, 'a terceira liberação não somou à anterior: ' + ((venc2 - venc) / 60000).toFixed(1) + ' min');
});

test('bloqueio feito na nuvem NÃO é desfeito pelo PC que ainda tem a assinatura ativa antiga (o caso da Cicera, 05:02)', async () => {
  const ativaNoPc = { subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: conta('caio@teste.nexus').subscription_expires_at };
  const rev = await api('POST', '/api/subscription/revoke-payment', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'caio@teste.nexus' } });
  assert.equal(rev.status, 200, rev.texto);
  assert.equal(conta('caio@teste.nexus').subscription_status, 'expired');
  for (let i = 0; i < 3; i++) assert.equal((await envioDoPc([['caio@teste.nexus', ativaNoPc]])).status, 200);
  const c = conta('caio@teste.nexus');
  assert.equal(c.subscription_status, 'expired', 'o PC reativou a conta bloqueada');
  assert.ok(ms(c.subscription_expires_at) < Date.now(), 'o vencimento voltou para o futuro');
});

test('o PC com mudança MAIS NOVA (liberou no localhost) chega à nuvem; com mudança MAIS ANTIGA é ignorado', async () => {
  const futuro = new Date(Date.now() + 40 * DIA).toISOString();
  const maisNova = new Date(Date.now() + 5000).toISOString();
  await envioDoPc([['caio@teste.nexus', { subscription_status: 'active', subscription_plan: 'cortesia_admin', subscription_method: 'admin_cortesia', subscription_expires_at: futuro, subscription_updated_at: maisNova }]]);
  let c = conta('caio@teste.nexus');
  assert.equal(c.subscription_status, 'active', 'a liberação feita no PC (carimbo mais novo) não chegou à nuvem');
  assert.equal(ms(c.subscription_expires_at), ms(futuro)); assert.equal(c.subscription_updated_at, maisNova);
  // um envio com carimbo mais ANTIGO que o da nuvem não a desfaz
  await envioDoPc([['caio@teste.nexus', { subscription_status: 'expired', subscription_plan: null, subscription_expires_at: new Date(Date.now() - DIA).toISOString(), subscription_updated_at: new Date(Date.now() - 3600000).toISOString() }]]);
  c = conta('caio@teste.nexus');
  assert.equal(c.subscription_status, 'active'); assert.equal(c.subscription_updated_at, maisNova);
});

test('compatibilidade: sem relógio em nenhum dos lados, o PC continua sendo a fonte (como sempre foi)', async () => {
  const antes = conta('edu@teste.nexus');
  assert.equal(antes.subscription_updated_at, undefined);
  await envioDoPc([['edu@teste.nexus', { subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(Date.now() + 20 * DIA).toISOString() }]]);
  const depois = conta('edu@teste.nexus');
  assert.equal(depois.subscription_status, 'active'); assert.equal(depois.subscription_plan, 'mensal');
});

test('a lista de usuários que o NAVEGADOR do administrador reenvia não define a assinatura (a leitura antiga não desfaz a liberação)', async () => {
  assert.equal((await liberar('ana@teste.nexus', { duration_days: 5 })).status, 200);
  const certa = conta('ana@teste.nexus');
  // o navegador ainda tem a versão antiga (trial, sem plano) e a salva ao fazer outra ação qualquer
  const velha = { ...certa, subscription_status: 'trial', subscription_plan: null, subscription_expires_at: null, subscription_method: null, subscription_payment_id: null, name: 'Ana Souza Editada' };
  const salvou = await api('POST', '/api/users', { token: admin, body: [velha] });
  assert.equal(salvou.status, 200, salvou.texto);
  const depois = conta('ana@teste.nexus');
  assert.equal(depois.name, 'Ana Souza Editada', 'o resto do cadastro continua sendo salvo');
  assert.equal(depois.subscription_status, 'active', 'a lista do navegador desfez a liberação');
  assert.equal(ms(depois.subscription_expires_at), ms(certa.subscription_expires_at));
  assert.equal(depois.subscription_plan, 'cortesia_admin');
  // e uma assinatura inventada pela lista também não vale
  const inventada = await api('POST', '/api/users', { token: admin, body: [{ ...depois, subscription_status: 'active', subscription_plan: 'vitalicio', subscription_expires_at: '2099-12-31T23:59:59Z' }] });
  assert.equal(inventada.status, 200);
  assert.equal(conta('ana@teste.nexus').subscription_plan, 'cortesia_admin');
});

test('exceção: o plano falso "administrador_ilimitado" de uma conta antiga é limpo ao rebaixar o perfil (e a limpeza também é carimbada)', async () => {
  const lia = conta('lia@teste.nexus');
  assert.equal(lia.subscription_plan, 'administrador_ilimitado');
  const r = await api('POST', '/api/users', { token: admin, body: [{ ...lia, subscription_plan: null, subscription_status: 'trial' }] });
  assert.equal(r.status, 200, r.texto);
  const depois = conta('lia@teste.nexus');
  assert.equal(depois.subscription_plan, null); assert.equal(depois.subscription_status, 'trial');
  assert.ok(depois.subscription_updated_at, 'a limpeza é uma mudança intencional e fica carimbada');
});

test('pagamento INFORMADO pelo usuário na nuvem (aguardando confirmação) não é desfeito pelo PC; a confirmação do admin depois vale', async () => {
  const tok = (await login('edu@teste.nexus', 'Edu@12345')).token;
  // o envio anterior deixou o Edu "ativo" por 20 dias; volta a expirar de forma intencional para testar o aviso
  await api('POST', '/api/subscription/revoke-payment', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'edu@teste.nexus' } });
  const pag = await api('POST', '/api/subscription/pay', { token: tok, body: { email: 'edu@teste.nexus', plan: 'mensal', method: 'pix', receipt_code: 'ABC123' } });
  assert.equal(pag.status, 200, pag.texto);
  const aviso = conta('edu@teste.nexus');
  assert.equal(aviso.subscription_status, 'pending_payment');
  assert.ok(aviso.subscription_payment_id && aviso.subscription_payment_id.startsWith('NEXUS-SUB-'));
  await envioDoPc([['edu@teste.nexus', { subscription_status: 'expired', subscription_plan: null, subscription_payment_id: null }]]);
  assert.equal(conta('edu@teste.nexus').subscription_status, 'pending_payment', 'o PC apagou o aviso de pagamento');
  const conf = await api('POST', '/api/subscription/confirm-payment', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'edu@teste.nexus', plan: 'mensal', amount: '18,00' } });
  assert.equal(conf.status, 200, conf.texto);
  await envioDoPc([['edu@teste.nexus', { subscription_status: 'pending_payment', subscription_payment_id: null }]]);
  assert.equal(conta('edu@teste.nexus').subscription_status, 'active', 'a confirmação foi desfeita pelo PC');
});

test('a resposta de /api/subscription/status traz o instante da última mudança (a tela mostra data e hora reais)', async () => {
  const tok = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const s = await api('GET', '/api/subscription/status?email=ana%40teste.nexus', { token: tok });
  assert.equal(s.status, 200, s.texto);
  assert.equal(s.json.is_subscribed, true);
  assert.equal(s.json.subscription_updated_at, conta('ana@teste.nexus').subscription_updated_at);
  assert.ok(s.json.subscription_expires_at);
});
