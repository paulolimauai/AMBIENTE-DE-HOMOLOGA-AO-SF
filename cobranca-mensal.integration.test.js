'use strict';

/**
 * Cobrança mensal automática (todo dia 5), ponta a ponta: sobe o server.js de verdade (sem banco: NEXUS_DISABLE_DB=1) numa pasta
 * temporária (NEXUS_DATA_DIR) e numa porta livre. Nunca toca no SQL Server nem nos arquivos de dados do projeto.
 * Rodar com: node --test cobranca-mensal.integration.test.js
 *
 * O resultado não depende do dia em que o teste roda: o botão do administrador (forcar) gera em qualquer dia, e a rotina agendada
 * é conferida pelo que a regra manda para o dia de hoje.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const P = require('./pagamentos');

const JWT_SECRET = 'segredo-de-teste-' + 'x'.repeat(40);
const SYNC_TOKEN = 'token-sync-de-teste-' + 'y'.repeat(20);
const DIA = 86400000;
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
let ipSeq = 40;
const ipNovo = () => '10.7.8.' + (++ipSeq);

const base = { role: 'Usuário', active: true, phone: '(62) 99999-0000', birth_date: '01/01/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: new Date(Date.now() - 3600000).toISOString(), subscription_status: 'trial' };
const ativa = (extra) => ({ ...base, subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(Date.now() + 20 * DIA).toISOString(), ...extra });
function usuariosDeTeste() {
  return [
    { ...base, id: 1, name: 'Admin Teste', email: 'admin@teste.nexus', password: hashPwd('Admin@12345'), role: 'Administrador', cpf: '11144477735', subscription_status: 'active', subscription_plan: 'vitalicio' },
    ativa({ id: 2, name: 'Gabi Ativa', email: 'gabi@teste.nexus', password: hashPwd('Gabi@12345'), cpf: '52998224725' }),
    ativa({ id: 3, name: 'Hugo Ativo', email: 'hugo@teste.nexus', password: hashPwd('Hugo@12345'), cpf: '39053344705' }),
    { ...base, id: 4, name: 'Iris Teste', email: 'iris@teste.nexus', password: hashPwd('Iris@12345'), cpf: '12345678909' },
    { ...base, id: 5, name: 'Joao Vitalicio', email: 'joao@teste.nexus', password: hashPwd('Joao@12345'), cpf: '98765432100', subscription_status: 'active', subscription_plan: 'vitalicio' },
    ativa({ id: 6, name: 'Lia Anual', email: 'lia@teste.nexus', password: hashPwd('Lia@12345'), cpf: '11122233396', subscription_plan: 'anual', subscription_expires_at: new Date(Date.now() + 200 * DIA).toISOString() }),
    ativa({ id: 7, name: 'Teo Cortesia', email: 'teo@teste.nexus', password: hashPwd('Teo@12345'), cpf: '45678912385', subscription_method: 'admin_cortesia' }),
    { ...base, id: 8, name: 'Nina Vencida', email: 'nina@teste.nexus', password: hashPwd('Nina@12345'), cpf: '74185296374', subscription_status: 'expired', subscription_plan: 'mensal', subscription_expires_at: new Date(Date.now() - 9 * DIA).toISOString() }
  ];
}

async function subir({ livro, auto }) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-cobr-'));
  const usuarios = usuariosDeTeste();
  const seed = { 'local_users.json': usuarios, 'local_users.backup.json': usuarios, 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  if (livro) seed['local_pagamentos.json'] = livro;
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  const porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DISABLE_DB: '1', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET;
  if (auto) delete env.NEXUS_COBRANCA_AUTO; else env.NEXUS_COBRANCA_AUTO = '0';
  const proc = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  proc.stdout.on('data', (d) => { saida += d.toString(); });
  proc.stderr.on('data', (d) => { saida += d.toString(); });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) break; } catch (e) { /* subindo */ }
    await dorme(150);
    if (i === 79) throw new Error('servidor de teste não subiu:\n' + saida.slice(-1500));
  }
  assert.ok(!/Conectado com sucesso ao Microsoft SQL/.test(saida), 'o teste não pode usar o banco real');
  const s = {
    porta, pasta, saida: () => saida,
    async api(method, rota, { token, body } = {}) {
      const h = { 'X-Forwarded-For': ipNovo() };
      if (token) h.Authorization = 'Bearer ' + token;
      let corpo;
      if (body !== undefined) { corpo = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
      const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
      const texto = await r.text();
      let json = null; try { json = JSON.parse(texto); } catch (e) { /* não é JSON */ }
      return { status: r.status, json, texto };
    },
    async login(email, senha) { return (await s.api('POST', '/api/login', { body: { email, password: senha } })).json.token; },
    livro: () => (fs.existsSync(path.join(pasta, 'local_pagamentos.json')) ? JSON.parse(fs.readFileSync(path.join(pasta, 'local_pagamentos.json'), 'utf8')) : []),
    conta: (email) => JSON.parse(fs.readFileSync(path.join(pasta, 'local_users.json'), 'utf8')).find((u) => u.email === email),
    async parar() { proc.kill(); await dorme(200); try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ } }
  };
  return s;
}

/* ---------------------------------------------------------------- botão do administrador e o ciclo completo */
let sv, admin, gabi;
const mesAtual = P.mesDe(Date.now());

test.before(async () => {
  sv = await subir({ auto: false });
  admin = await sv.login('admin@teste.nexus', 'Admin@12345');
  gabi = await sv.login('gabi@teste.nexus', 'Gabi@12345');
});
test.after(async () => { if (sv) await sv.parar(); });

test('gerar as cobranças do mês só é permitido ao administrador', async () => {
  assert.equal((await sv.api('POST', '/api/admin/pagamentos/gerar-mensal', { body: {} })).status, 401);
  assert.equal((await sv.api('POST', '/api/admin/pagamentos/gerar-mensal', { token: gabi, body: {} })).status, 403);
  assert.equal(sv.livro().length, 0);
});

test('gera uma cobrança de R$ 18 para cada assinatura paga e ativa, e só para elas', async () => {
  const r = await sv.api('POST', '/api/admin/pagamentos/gerar-mensal', { token: admin, body: {} });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.geradas, 2);
  assert.equal(r.json.competencia, mesAtual);
  const livro = sv.livro();
  assert.deepEqual(livro.map((p) => p.email).sort(), ['gabi@teste.nexus', 'hugo@teste.nexus'], 'teste, vitalício, anual, cortesia, expirada e administrador não recebem');
  for (const p of livro) {
    assert.equal(p.valor, 18);
    assert.equal(p.plano, 'mensal');
    assert.equal(p.status, 'emitida');
    assert.equal(p.origem, 'automatica');
    assert.equal(p.competencia, mesAtual);
    assert.equal(p.vencimento, P.diaDe(Date.now() + 5 * DIA));
    assert.match(p.ref, /^NXA\d{6}[0-9A-F]{8}$/);
  }
  // as contas não mudam: o acesso só muda quando o administrador confirma o recebimento
  assert.equal(sv.conta('gabi@teste.nexus').subscription_status, 'active');
  assert.equal(sv.conta('iris@teste.nexus').subscription_status, 'trial');
  // o log de auditoria é gravado em disco com um pequeno atraso (750 ms)
  let log = '';
  for (let i = 0; i < 20 && !/Gerou 2 cobrança/.test(log); i++) { await dorme(150); log = fs.readFileSync(path.join(sv.pasta, 'system_logs.json'), 'utf8'); }
  assert.ok(/Gerou 2 cobrança/.test(log), 'fica no registro de auditoria');
});

test('rodar de novo no mesmo mês não repete nenhuma cobrança', async () => {
  const r = await sv.api('POST', '/api/admin/pagamentos/gerar-mensal', { token: admin, body: {} });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.geradas, 0);
  assert.equal(r.json.puladas.ja_gerada, 2);
  assert.equal(sv.livro().length, 2);
});

test('o painel recebe o dia da cobrança, a próxima data e as cobranças marcadas como automáticas', async () => {
  const j = (await sv.api('GET', '/api/admin/pagamentos', { token: admin })).json;
  assert.equal(j.cobranca_mensal.dia, 5);
  assert.equal(j.cobranca_mensal.prazo_dias, 5);
  assert.equal(j.cobranca_mensal.proxima, P.proximaGeracao(Date.now(), 5));
  assert.equal(j.pagamentos.filter((p) => p.origem === 'automatica').length, 2);
  assert.equal(j.resumo.emitidas.qtd, 2);
});

test('o cliente avisa o pagamento: entra na MESMA cobrança gerada (sem duplicar) e o administrador confirma somando 30 dias', async () => {
  const antes = Date.parse(sv.conta('gabi@teste.nexus').subscription_expires_at);
  const doGabi = sv.livro().find((p) => p.email === 'gabi@teste.nexus');
  const pay = await sv.api('POST', '/api/subscription/pay', { token: gabi, body: { email: 'gabi@teste.nexus', plan: 'mensal', method: 'pix', receipt_code: 'E2E123456' } });
  assert.equal(pay.status, 200, pay.texto);
  const apos = sv.livro().filter((p) => p.email === 'gabi@teste.nexus');
  assert.equal(apos.length, 1, 'continua uma cobrança só');
  assert.equal(apos[0].id, doGabi.id);
  assert.equal(apos[0].status, 'informada');
  assert.equal(sv.conta('gabi@teste.nexus').subscription_status, 'active', 'quem já era assinante segue ativo enquanto o administrador confere');

  const ok = await sv.api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: doGabi.id, acao: 'confirmar', valor: '18,00', metodo: 'pix' } });
  assert.equal(ok.status, 200, ok.texto);
  const depois = Date.parse(sv.conta('gabi@teste.nexus').subscription_expires_at);
  assert.ok(Math.abs(depois - (antes + 30 * DIA)) < 2000, 'somou 30 dias ao prazo que restava');
  assert.equal(sv.livro().find((p) => p.id === doGabi.id).status, 'paga');
});

test('cobrança cancelada pelo administrador não volta no mesmo mês, e quem pagou no ciclo não recebe outra', async () => {
  const doHugo = sv.livro().find((p) => p.email === 'hugo@teste.nexus');
  const c = await sv.api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: doHugo.id, acao: 'cancelar', obs: 'gerada por engano' } });
  assert.equal(c.status, 200, c.texto);
  const r = await sv.api('POST', '/api/admin/pagamentos/gerar-mensal', { token: admin, body: {} });
  assert.equal(r.json.geradas, 0, 'nem a cancelada do Hugo nem a paga da Gabi geram outra');
  assert.equal(sv.livro().length, 2);
});

/* ---------------------------------------------------------------- rotina agendada (ao iniciar o servidor) */
const diaDeHoje = parseInt(P.diaDe(Date.now()).slice(8), 10);

test('rotina ao iniciar: sem histórico de cobranças automáticas, só gera se hoje for o dia 5 (a primeira vez não é retroativa)', async () => {
  const s = await subir({ auto: true });
  try {
    await dorme(1500);
    const geradas = s.livro().filter((p) => p.origem === 'automatica');
    if (diaDeHoje === 5) assert.deepEqual(geradas.map((p) => p.email).sort(), ['gabi@teste.nexus', 'hugo@teste.nexus']);
    else assert.equal(geradas.length, 0, 'hoje é dia ' + diaDeHoje + ': sem cobrança retroativa na primeira vez');
  } finally { await s.parar(); }
});

test('rotina ao iniciar: servidor que ficou desligado no dia 5 completa o mês nos dias seguintes', async () => {
  const mesPassado = P.somarMeses(mesAtual, -1);
  const historico = P.criarCobranca({ usuario: { email: 'antiga@teste.nexus', name: 'Antiga' }, valor: 18, origem: 'automatica', competencia: mesPassado, agora: Date.now() - 30 * DIA });
  const s = await subir({ auto: true, livro: [historico] });
  try {
    await dorme(1500);
    const doMes = s.livro().filter((p) => p.origem === 'automatica' && p.competencia === mesAtual);
    if (diaDeHoje >= 5) assert.deepEqual(doMes.map((p) => p.email).sort(), ['gabi@teste.nexus', 'hugo@teste.nexus']);
    else assert.equal(doMes.length, 0, 'antes do dia 5 não gera');
    assert.equal(s.livro().filter((p) => p.competencia === mesPassado).length, 1, 'o histórico continua');
  } finally { await s.parar(); }
});
