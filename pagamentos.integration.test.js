'use strict';

/**
 * Pagamentos e cobranças, ponta a ponta: sobe o server.js de verdade (sem banco: NEXUS_DISABLE_DB=1), numa pasta temporária
 * (NEXUS_DATA_DIR) e numa porta livre. Nunca toca no SQL Server nem nos arquivos de dados do projeto.
 * Rodar com: node --test pagamentos.integration.test.js
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

let proc, porta, pasta, logSaida = '';
let ipSeq = 20;
const ipNovo = () => '10.7.6.' + (++ipSeq);

async function api(method, rota, { token, body, headers } = {}) {
  const h = { 'X-Forwarded-For': ipNovo(), ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  let corpo;
  if (body !== undefined) { corpo = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch (e) { /* não é JSON */ }
  return { status: r.status, json, texto, headers: r.headers };
}
const login = async (email, password) => (await api('POST', '/api/login', { body: { email, password } })).json;
const lerArquivo = (nome) => JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'));
const livro = () => (fs.existsSync(path.join(pasta, 'local_pagamentos.json')) ? lerArquivo('local_pagamentos.json') : []);
const conta = (email) => lerArquivo('local_users.json').find((u) => u.email === email);
const ms = (v) => Date.parse(v);

const T0_BIA = Date.now() + 10 * DIA;

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pag-'));
  const base = { role: 'Usuário', active: true, phone: '(62) 99999-0000', birth_date: '01/01/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: new Date(Date.now() - 3600000).toISOString(), subscription_status: 'trial' };
  const usuarios = [
    { ...base, id: 1, name: 'Admin Teste', email: 'admin@teste.nexus', password: hashPwd('Admin@12345'), role: 'Administrador', cpf: '11144477735', subscription_status: 'active', subscription_plan: 'vitalicio' },
    { ...base, id: 2, name: 'Ana Souza', email: 'ana@teste.nexus', password: hashPwd('Ana@12345'), cpf: '52998224725' },
    { ...base, id: 3, name: 'Bia Lima', email: 'bia@teste.nexus', password: hashPwd('Bia@12345'), cpf: '39053344705', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(T0_BIA).toISOString() },
    { ...base, id: 4, name: 'Caio Vencido', email: 'caio@teste.nexus', password: hashPwd('Caio@12345'), cpf: '12345678909', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(Date.now() - 6 * DIA).toISOString() },
    { ...base, id: 5, name: 'Dani Pendente', email: 'dani@teste.nexus', password: hashPwd('Dani@12345'), cpf: '98765432100', subscription_status: 'trial', subscription_payment_id: 'NEXUS-SUB-1700000000000-AB12CD-REF-NX99887766' },
    { ...base, id: 6, name: 'Eva Delegada', email: 'eva@teste.nexus', password: hashPwd('Eva@12345'), cpf: '11122233396' },
    { ...base, id: 7, name: 'Fabio Sem Cobranca', email: 'fabio@teste.nexus', password: hashPwd('Fabio@12345'), cpf: '45678912385', subscription_status: 'expired', subscription_plan: 'mensal', subscription_expires_at: new Date(Date.now() - 20 * DIA).toISOString() }
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
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) break; } catch (e) { /* subindo */ }
    await dorme(150);
    if (i === 79) throw new Error('servidor de teste não subiu:\n' + logSaida.slice(-1500));
  }
  assert.ok(!/Conectado com sucesso ao Microsoft SQL/.test(logSaida), 'o teste não pode usar o banco real');
});

test.after(async () => {
  if (proc) { proc.kill(); await dorme(200); }
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
});

let admin, ana, bia, eva;
const tokens = async () => {
  admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  bia = (await login('bia@teste.nexus', 'Bia@12345')).token;
  eva = (await login('eva@teste.nexus', 'Eva@12345')).token;
};

test('ao iniciar, a assinatura vencida vira "expirada" mesmo que o dono nunca mais abra o app', async () => {
  for (let i = 0; i < 20 && conta('caio@teste.nexus').subscription_status !== 'expired'; i++) await dorme(150);
  assert.equal(conta('caio@teste.nexus').subscription_status, 'expired');
  assert.equal(conta('bia@teste.nexus').subscription_status, 'active', 'quem ainda tem prazo continua ativo');
  assert.equal(conta('admin@teste.nexus').subscription_plan, 'vitalicio');
  await tokens();
});

test('o livro e o resumo só aparecem para administrador', async () => {
  assert.equal((await api('GET', '/api/admin/pagamentos')).status, 401);
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: ana })).status, 403);
  assert.equal((await api('POST', '/api/admin/pagamentos/cobranca', { token: ana, body: { email: 'ana@teste.nexus' } })).status, 403);
  assert.equal((await api('POST', '/api/admin/pagamentos/conciliar', { token: ana, body: { conteudo: 'x' } })).status, 403);
  assert.equal((await api('POST', '/api/admin/pagamentos/csv', { token: ana, body: {} })).status, 403);
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { body: { id: 'x', acao: 'confirmar' } })).status, 401);
});

test('o aviso de pagamento anterior ao livro entra como "aguardando" uma vez só, e o resumo usa a data da assinatura', async () => {
  const a = await api('GET', '/api/admin/pagamentos', { token: admin });
  assert.equal(a.status, 200, a.texto);
  const dani = a.json.pagamentos.filter((p) => p.email === 'dani@teste.nexus');
  assert.equal(dani.length, 1);
  assert.equal(dani[0].situacao, 'aguardando');
  assert.equal(dani[0].origem, 'legado');
  assert.equal(dani[0].valor, 18);
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: admin })).json.pagamentos.filter((p) => p.email === 'dani@teste.nexus').length, 1, 'não duplica na segunda leitura');
  const r = a.json.resumo;
  assert.equal(a.json.preco, 18);
  assert.equal(r.pagantes, 1);
  assert.equal(r.mrr, 18);
  assert.equal(r.aguardando.qtd, 1);
  const emails = r.expirados.lista.map((u) => u.email).sort();
  assert.ok(emails.includes('caio@teste.nexus') && emails.includes('fabio@teste.nexus'), 'expirados: ' + emails);
  assert.ok(!emails.includes('bia@teste.nexus'));
});

let cobrancaAna;
test('gerar a cobrança Pix: valor do servidor, Pix válido com a referência, e a 2ª via reaproveita a mesma cobrança', async () => {
  const j1 = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'ana@teste.nexus', vencimento: P.diaDe(Date.now() + 5 * DIA), valor: 1, amount: 1 } });
  assert.equal(j1.status, 200, j1.texto);
  cobrancaAna = j1.json.pagamento;
  assert.equal(cobrancaAna.valor, 18, 'o navegador não escolhe o valor');
  assert.equal(cobrancaAna.status, 'emitida');
  assert.equal(j1.json.reutilizada, false);
  const lido = P.pixLer(j1.json.pix.payload);
  assert.ok(lido.crcOk);
  assert.equal(lido.campos['54'], '18.00');
  assert.equal(lido.campos['62'], '05' + String(cobrancaAna.ref.length).padStart(2, '0') + cobrancaAna.ref);
  assert.match(j1.json.pix.qr_url, /^\/api\/pix\/qr\.svg\?data=/);

  const j2 = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'ana@teste.nexus', vencimento: P.diaDe(Date.now() + 7 * DIA) } });
  assert.equal(j2.json.reutilizada, true);
  assert.equal(j2.json.pagamento.id, cobrancaAna.id, 'mesma cobrança, 2ª via');
  assert.equal(j2.json.pagamento.ref, cobrancaAna.ref);
  assert.equal(j2.json.pagamento.vencimento, P.diaDe(Date.now() + 7 * DIA));
  assert.equal(livro().filter((p) => p.email === 'ana@teste.nexus').length, 1);
});

test('gerar cobrança: recusa conta inexistente, administrador, vitalício, data inválida e data passada', async () => {
  const pede = (body) => api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body });
  assert.equal((await pede({ email: 'ninguem@teste.nexus' })).status, 404);
  assert.equal((await pede({ email: 'admin@teste.nexus' })).status, 400);
  assert.equal((await pede({ email: 'eva@teste.nexus', vencimento: '2026-02-31' })).status, 400);
  assert.equal((await pede({ email: 'eva@teste.nexus', vencimento: '2020-01-01' })).status, 400);
  assert.equal((await pede({ email: 'eva@teste.nexus', referencia: cobrancaAna.ref })).status, 409);
});

test('QR do Pix gerado no servidor: só aceita BR Code com CRC válido', async () => {
  const pix = (await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: cobrancaAna.id, acao: 'pix' } })).json.pix;
  const ok = await api('GET', pix.qr_url);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(ok.texto, /^<svg /);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(ok.texto));
  const adulterado = pix.payload.slice(0, -4) + (pix.payload.endsWith('0000') ? '1111' : '0000');
  assert.equal((await api('GET', '/api/pix/qr.svg?data=' + encodeURIComponent(adulterado))).status, 400);
  assert.equal((await api('GET', '/api/pix/qr.svg?data=' + encodeURIComponent('https://exemplo.com/qualquer-coisa'))).status, 400);
  assert.equal((await api('GET', '/api/pix/qr.svg')).status, 400);
});

test('cliente avisa que pagou: a cobrança emitida vira "aguardando" (sem duplicar) e o acesso não é liberado', async () => {
  const pay = await api('POST', '/api/subscription/pay', { token: ana, body: { email: 'ana@teste.nexus', plan: 'mensal', method: 'pix', receipt_code: 'NX12345678' } });
  assert.equal(pay.status, 200, pay.texto);
  const doAna = livro().filter((p) => p.email === 'ana@teste.nexus');
  assert.equal(doAna.length, 1, 'continua um registro só');
  assert.equal(doAna[0].id, cobrancaAna.id);
  assert.equal(doAna[0].status, 'informada');
  assert.equal(doAna[0].comprovante, 'NX12345678');
  const st = (await api('GET', '/api/subscription/status?email=ana%40teste.nexus', { token: ana })).json;
  assert.equal(st.is_subscribed, false);
});

test('renovação antes de vencer: assinante ATIVO que avisa o Pix aparece na fila e segue ativo', async () => {
  const pay = await api('POST', '/api/subscription/pay', { token: bia, body: { email: 'bia@teste.nexus', plan: 'mensal', method: 'pix', receipt_code: 'NX55556666' } });
  assert.equal(pay.status, 200, pay.texto);
  assert.equal(pay.json.access_status, 'active');
  const fila = (await api('GET', '/api/admin/pagamentos', { token: admin })).json.pagamentos.filter((p) => p.email === 'bia@teste.nexus');
  assert.equal(fila.length, 1);
  assert.equal(fila[0].situacao, 'aguardando');
  assert.equal(fila[0].ref, 'NX55556666', 'a referência é o código do Pix que o cliente pagou');
  assert.equal(conta('bia@teste.nexus').subscription_status, 'active');
});

test('confirmar fixa o vencimento em 30 dias a partir da confirmação (sem acumular o que restava) e confirmar de novo não estende outra vez', async () => {
  const id = livro().find((p) => p.email === 'bia@teste.nexus').id;
  const antes = ms(conta('bia@teste.nexus').subscription_expires_at);
  assert.ok(Math.abs(antes - T0_BIA) < 2000);
  const c1 = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id, acao: 'confirmar', valor: '18.00', metodo: 'pix' } });
  assert.equal(c1.status, 200, c1.texto);
  assert.equal(c1.json.already_confirmed, false);
  const depois = ms(conta('bia@teste.nexus').subscription_expires_at);
  const diasApos = (depois - Date.now()) / DIA;
  assert.ok(diasApos > 29.9 && diasApos <= 30.01, 'vencimento = confirmação + 30 dias (os 10 dias que restavam não acumulam): ' + diasApos.toFixed(2) + ' dias');
  const reg = livro().find((p) => p.id === id);
  assert.equal(reg.status, 'paga');
  assert.equal(reg.valor, 18, '"18.00" vale 18, nunca 1800');
  assert.equal(reg.confirmado_por.email, 'admin@teste.nexus');
  assert.ok(Math.abs(ms(reg.periodo_fim) - depois) < 2000);
  const c2 = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id, acao: 'confirmar' } });
  assert.equal(c2.status, 200);
  assert.equal(c2.json.already_confirmed, true);
  assert.equal(ms(conta('bia@teste.nexus').subscription_expires_at), depois, 'não estendeu de novo');
});

test('valor recebido inválido é recusado e nada muda', async () => {
  const id = cobrancaAna.id;
  for (const valor of ['abc', '0', '-5', '999999']) {
    const r = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id, acao: 'confirmar', valor } });
    assert.equal(r.status, 400, 'valor ' + valor + ' → ' + r.texto);
  }
  assert.equal(livro().find((p) => p.id === id).status, 'informada');
  assert.equal(conta('ana@teste.nexus').subscription_status, 'trial');
});

test('confirmar a cobrança de uma conta em teste: acesso por 30 dias a partir de agora', async () => {
  const r = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: cobrancaAna.id, acao: 'confirmar', valor: '18,00', metodo: 'transferencia', obs: 'TED' } });
  assert.equal(r.status, 200, r.texto);
  const c = conta('ana@teste.nexus');
  assert.equal(c.subscription_status, 'active');
  assert.equal(c.subscription_method, 'transferencia');
  const dias = (ms(c.subscription_expires_at) - Date.now()) / DIA;
  assert.ok(dias > 29.9 && dias <= 30.01, 'dias: ' + dias);
  const st = (await api('GET', '/api/subscription/status?email=ana%40teste.nexus', { token: ana })).json;
  assert.equal(st.is_subscribed, true);
});

test('estornar tira os 30 dias da conta e bloqueia quando não sobra prazo; só administrador estorna', async () => {
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: eva, body: { id: cobrancaAna.id, acao: 'estornar' } })).status, 403);
  const r = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: cobrancaAna.id, acao: 'estornar', obs: 'devolvido' } });
  assert.equal(r.status, 200, r.texto);
  assert.equal(livro().find((p) => p.id === cobrancaAna.id).status, 'estornada');
  assert.equal(conta('ana@teste.nexus').subscription_status, 'expired');
  const st = (await api('GET', '/api/subscription/status?email=ana%40teste.nexus', { token: ana })).json;
  assert.equal(st.is_subscribed, false);
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: cobrancaAna.id, acao: 'estornar' } })).status, 409, 'não estorna duas vezes');
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: cobrancaAna.id, acao: 'confirmar' } })).status, 409, 'estornada não volta a ser confirmada');
});

test('cancelar a cobrança aberta libera a marca de "aguardando" da conta', async () => {
  const dani = livro().find((p) => p.email === 'dani@teste.nexus');
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: eva, body: { id: dani.id, acao: 'cancelar' } })).status, 403);
  const r = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: dani.id, acao: 'cancelar', obs: 'engano' } });
  assert.equal(r.status, 200, r.texto);
  assert.equal(livro().find((p) => p.id === dani.id).status, 'cancelada');
  assert.ok(!conta('dani@teste.nexus').subscription_payment_id, 'a conta deixa de ficar marcada como aguardando');
  const lista = (await api('GET', '/api/admin/pagamentos', { token: admin })).json.pagamentos.filter((p) => p.email === 'dani@teste.nexus');
  assert.equal(lista.length, 1, 'não é reimportada como aviso legado');
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: dani.id, acao: 'cancelar' } })).status, 409);
});

test('permissão "liberar assinatura": a conta delegada confirma, mas não vê o livro nem cancela, e não confirma a si mesma', async () => {
  const dar = await api('POST', '/api/admin/permissions', { token: admin, body: { email: 'eva@teste.nexus', permissions: ['assinatura.liberar'] } });
  assert.equal(dar.status, 200, dar.texto);
  const cob = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'caio@teste.nexus' } });
  assert.equal(cob.status, 200, cob.texto);
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: eva })).status, 403);
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: eva, body: { id: cob.json.pagamento.id, acao: 'cancelar' } })).status, 403);
  const minha = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'eva@teste.nexus' } });
  assert.equal((await api('POST', '/api/admin/pagamentos/acao', { token: eva, body: { id: minha.json.pagamento.id, acao: 'confirmar' } })).status, 403, 'não libera o próprio acesso');
  const ok = await api('POST', '/api/admin/pagamentos/acao', { token: eva, body: { id: cob.json.pagamento.id, acao: 'confirmar', valor: '18,00' } });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(conta('caio@teste.nexus').subscription_status, 'active');
  assert.equal(livro().find((p) => p.id === cob.json.pagamento.id).confirmado_por.email, 'eva@teste.nexus', 'fica registrado quem confirmou');
});

test('rota antiga de confirmar (cadastros e O.S.): cria o registro no livro, fixa 30 dias e o duplo clique não estende duas vezes', async () => {
  const antes = livro().length;
  const corpo = { admin_email: 'admin@teste.nexus', target_email: 'fabio@teste.nexus', plan: 'mensal', method: 'pix', amount: '18,00', obs: 'Pix direto' };
  const a = await api('POST', '/api/subscription/confirm-payment', { token: admin, body: corpo });
  assert.equal(a.status, 200, a.texto);
  assert.equal(a.json.amount, 18);
  const exp1 = ms(conta('fabio@teste.nexus').subscription_expires_at);
  assert.ok(Math.abs((exp1 - Date.now()) / DIA - 30) < 0.01);
  const b = await api('POST', '/api/subscription/confirm-payment', { token: admin, body: corpo });
  assert.equal(b.status, 200, b.texto);
  assert.equal(b.json.already_confirmed, true);
  assert.equal(ms(conta('fabio@teste.nexus').subscription_expires_at), exp1);
  const novos = livro().slice(antes).filter((p) => p.email === 'fabio@teste.nexus');
  assert.equal(novos.length, 1);
  assert.equal(novos[0].status, 'paga');
  assert.equal(novos[0].origem, 'admin');
  // conta vitalícia não tem o que cobrar
  const vit = await api('POST', '/api/subscription/confirm-payment', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'admin@teste.nexus', plan: 'mensal' } });
  assert.equal(vit.status, 409);
});

test('conciliação: sugere pelo código e pelo nome, não altera nada, e um lançamento só confirma uma cobrança', async () => {
  const cobGeral = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'ana@teste.nexus' } });
  assert.equal(cobGeral.status, 200, cobGeral.texto);
  const ref = cobGeral.json.pagamento.ref;
  const hoje = P.diaDe(Date.now()).replace(/-/g, '');
  const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${hoje}120000[-3:BRT]<TRNAMT>18.00<FITID>F1<MEMO>PIX RECEBIDO ${ref}</STMTTRN>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${hoje}120000[-3:BRT]<TRNAMT>-30.00<FITID>F2<MEMO>MERCADO</STMTTRN>\n</BANKTRANLIST></OFX>`;
  const antes = JSON.stringify(livro());
  const c = await api('POST', '/api/admin/pagamentos/conciliar', { token: admin, body: { conteudo: ofx } });
  assert.equal(c.status, 200, c.texto);
  assert.equal(c.json.formato, 'ofx');
  assert.equal(c.json.sugestoes.length, 1);
  assert.equal(c.json.sugestoes[0].forca, 'forte');
  assert.equal(c.json.sugestoes[0].pagamento.id, cobGeral.json.pagamento.id);
  assert.equal(JSON.stringify(livro()), antes, 'conciliar só sugere');
  assert.equal((await api('POST', '/api/admin/pagamentos/conciliar', { token: admin, body: { conteudo: 'isto não é um extrato' } })).status, 422);

  const s = c.json.sugestoes[0];
  const ok = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: s.pagamento.id, acao: 'confirmar', valor: s.lancamento.valor, metodo: 'pix', extrato_id: s.lancamento.hash } });
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(livro().find((p) => p.id === s.pagamento.id).extrato_id, s.lancamento.hash);
  // o mesmo lançamento não confirma uma segunda cobrança
  const outra = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'dani@teste.nexus' } });
  const dup = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: outra.json.pagamento.id, acao: 'confirmar', valor: 18, extrato_id: s.lancamento.hash } });
  assert.equal(dup.status, 409, dup.texto);
  // e ao ler o mesmo extrato de novo, ele aparece como já conciliado
  const de_novo = await api('POST', '/api/admin/pagamentos/conciliar', { token: admin, body: { conteudo: ofx } });
  assert.equal(de_novo.json.ja_conciliados, 1);
  assert.equal(de_novo.json.sugestoes.length, 0);
});

test('CSV: só administrador, com BOM, ponto e vírgula e os registros pedidos', async () => {
  const ids = livro().slice(0, 2).map((p) => p.id);
  const r = await api('POST', '/api/admin/pagamentos/csv', { token: admin, body: { ids } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="pagamentos-\d{4}-\d{2}-\d{2}\.csv"/);
  // fetch().text() descarta o BOM ao decodificar: confere nos bytes (o BOM faz o Excel abrir os acentos certos)
  const cru = await fetch('http://127.0.0.1:' + porta + '/api/admin/pagamentos/csv', { method: 'POST', headers: { Authorization: 'Bearer ' + admin, 'Content-Type': 'application/json', 'X-Forwarded-For': ipNovo() }, body: JSON.stringify({ ids }) });
  assert.deepEqual(Array.from(new Uint8Array(await cru.arrayBuffer()).slice(0, 3)), [0xEF, 0xBB, 0xBF]);
  assert.equal(r.texto.split('\r\n').length, 3);
  assert.match(r.texto, /Referência;Cliente;E-mail/);
  assert.ok(ids.every((id) => r.texto.includes(livro().find((p) => p.id === id).ref)));
});

test('o livro sobrevive à exclusão da conta e não é baixável pelo navegador', async () => {
  const antes = livro().filter((p) => p.email === 'caio@teste.nexus').length;
  assert.ok(antes >= 1);
  const del = await api('DELETE', '/api/users?email=caio%40teste.nexus', { token: admin });
  assert.ok(del.status === 200, del.texto);
  assert.equal(livro().filter((p) => p.email === 'caio@teste.nexus').length, antes, 'registro financeiro fica');
  assert.equal((await api('GET', '/local_pagamentos.json')).status, 404);
  assert.notEqual((await api('GET', '/pagamentos.js')).headers.get('content-type'), 'application/javascript; charset=utf-8', 'regras do servidor não são servidas');
});

test('a tela carrega o módulo novo e o QR do cliente vem do próprio servidor', async () => {
  const pagina = await api('GET', '/');
  assert.equal(pagina.status, 200);
  assert.match(pagina.texto, /\/pagamentos-admin\.js\?v=/);
  assert.match(pagina.texto, /\/pagamentos-admin\.css\?v=/);
  assert.ok(!/api\.qrserver\.com/.test(pagina.texto), 'nenhum QR de terceiros');
  assert.match(pagina.texto, /\/api\/pix\/qr\.svg\?data=/);
  const js = await api('GET', '/pagamentos-admin.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await api('GET', '/pagamentos-admin.css')).status, 200);
});


/* ---------------------------------------------------------------- configuração financeira (preço, Pix, cobrança mensal) */
const CFG_NOVA = () => ({ preco: '20,50', pix: { tipo: 'email', chave: 'Cobranca@Nexus.com', nome: 'Nexus Pagamentos', cidade: 'São Paulo' }, whatsapp: '(11) 98888-7777', cobranca: { dia: 10, prazo_dias: 5 } });
const salvarConfig = (token, config, senha) => api('POST', '/api/admin/financeiro/config', { token, body: { config, senha_atual: senha } });

async function subirOutraInstancia(pastaDados) {
  const portaOutra = await portaLivre();
  const env = { ...process.env, PORT: String(portaOutra), NEXUS_DATA_DIR: pastaDados, NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET;
  const filho = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d.toString(); });
  filho.stderr.on('data', (d) => { saida += d.toString(); });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch('http://127.0.0.1:' + portaOutra + '/api/health'); if (r.ok) break; } catch (e) { /* subindo */ }
    await dorme(150);
    if (i === 79) { filho.kill(); throw new Error('segunda instância não subiu:\n' + saida.slice(-1200)); }
  }
  const get = async (rota, token) => { const r = await fetch('http://127.0.0.1:' + portaOutra + rota, { headers: { 'X-Forwarded-For': ipNovo(), ...(token ? { Authorization: 'Bearer ' + token } : {}) } }); const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch (e) { /* html */ } return { status: r.status, texto, json }; };
  return { get, saida: () => saida, matar: async () => { filho.kill(); await dorme(250); } };
}

test('configuração financeira: só administrador lê e altera; sem senha ou com senha errada nada muda', async () => {
  const lido = await api('GET', '/api/admin/pagamentos', { token: admin });
  const c = lido.json.config;
  assert.equal(c.atual.preco, 18);
  assert.equal(c.atual.cobranca.dia, 5);
  assert.equal(c.apresentacao.chave_exibicao, '(62) 99234-5372', 'padrão = os valores de antes');
  assert.deepEqual(c.historico, []);

  assert.equal((await api('POST', '/api/admin/financeiro/config', { body: { config: CFG_NOVA(), senha_atual: 'Admin@12345' } })).status, 401);
  assert.equal((await salvarConfig(ana, CFG_NOVA(), 'Ana@12345')).status, 403, 'usuário comum não altera, nem com a própria senha');
  const sem = await salvarConfig(admin, CFG_NOVA(), '');
  assert.equal(sem.status, 400);
  assert.equal(sem.json.campo, 'senha_atual');
  const errada = await salvarConfig(admin, CFG_NOVA(), 'senha-errada');
  assert.equal(errada.status, 403);
  assert.equal(errada.json.campo, 'senha_atual');
  assert.equal(fs.existsSync(path.join(pasta, 'local_financeiro_config.json')), false, 'nada foi gravado');
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: admin })).json.preco, 18);
});

test('configuração financeira: valor inválido é recusado com o campo certo e nada muda', async () => {
  const inv = async (f) => { const cfg = CFG_NOVA(); f(cfg); return salvarConfig(admin, cfg, 'Admin@12345'); };
  const a = await inv((c) => { c.preco = '0'; });
  assert.equal(a.status, 422); assert.equal(a.json.campo, 'preco');
  const b = await inv((c) => { c.pix.chave = 'não é e-mail'; });
  assert.equal(b.status, 422); assert.equal(b.json.campo, 'pix.chave');
  const d = await inv((c) => { c.cobranca.dia = 31; });
  assert.equal(d.status, 422); assert.equal(d.json.campo, 'cobranca.dia');
  const e = await inv((c) => { c.whatsapp = '123'; });
  assert.equal(e.status, 422); assert.equal(e.json.campo, 'whatsapp');
  assert.equal(fs.existsSync(path.join(pasta, 'local_financeiro_config.json')), false);
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: admin })).json.preco, 18);
});

test('configuração financeira: o preço e o Pix novos valem na hora (cobrança, QR, página do cliente) sem reiniciar', async () => {
  const antes = livro().filter((p) => p.email === 'dani@teste.nexus')[0];
  const r = await salvarConfig(admin, CFG_NOVA(), 'Admin@12345');
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.mudou, true);
  assert.equal(r.json.preco, 20.5);
  assert.equal(r.json.preco_texto, 'R$ 20,50');
  assert.equal(r.json.config.apresentacao.chave_exibicao, 'cobranca@nexus.com');
  assert.equal(r.json.config.apresentacao.chave_tipo_rotulo, 'e-mail');

  const lido = (await api('GET', '/api/admin/pagamentos', { token: admin })).json;
  assert.equal(lido.preco, 20.5);
  assert.equal(lido.cobranca_mensal.dia, 10);
  assert.equal(lido.cobranca_mensal.prazo_dias, 5);
  assert.match(lido.cobranca_mensal.proxima, /-10$/);
  assert.equal(lido.pix.chave, 'cobranca@nexus.com');
  assert.equal(lido.pix.tipo_chave, 'e-mail');
  assert.equal(lido.config.historico.length, 1);
  assert.equal(lido.config.historico[0].por.email, 'admin@teste.nexus');

  // cobrança nova: valor novo e BR Code com a chave, o nome e a cidade novos (CRC conferido)
  const cob = await api('POST', '/api/admin/pagamentos/cobranca', { token: admin, body: { email: 'eva@teste.nexus' } });
  assert.equal(cob.status, 200, cob.texto);
  assert.equal(cob.json.pagamento.valor, 20.5);
  assert.ok(Array.isArray(cob.json.outras_abertas));
  const bc = P.pixLer(cob.json.pix.payload);
  assert.equal(bc.crcOk, true);
  assert.equal(bc.campos['54'], '20.50');
  assert.equal(bc.campos['59'], 'NEXUS PAGAMENTOS');
  assert.equal(bc.campos['60'], 'SAO PAULO');
  assert.ok(cob.json.pix.payload.includes('cobranca@nexus.com'));
  assert.equal(cob.json.pix.chave, 'cobranca@nexus.com');

  // o que já estava emitido/avisado mantém o valor da época
  assert.equal(livro().filter((p) => p.email === 'dani@teste.nexus')[0].valor, antes.valor);
  assert.equal(antes.valor, 18);

  // o cliente que avisa o pagamento agora cai no preço novo (o navegador nunca decide o valor)
  const pay = await api('POST', '/api/subscription/pay', { token: eva, body: { email: 'eva@teste.nexus', plan: 'mensal', method: 'pix', amount: 1 } });
  assert.equal(pay.status, 200, pay.texto);
  assert.equal(pay.json.amount, 20.5);

  // repetir a mesma configuração não conta como alteração
  const igual = await salvarConfig(admin, CFG_NOVA(), 'Admin@12345');
  assert.equal(igual.status, 200);
  assert.equal(igual.json.mudou, false);
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: admin })).json.config.historico.length, 1);
});

test('configuração financeira: a página do cliente é refeita com o preço, a chave Pix e o WhatsApp novos', async () => {
  const pagina = (await api('GET', '/')).texto;
  assert.match(pagina, /const NEXUS_MONTHLY_PRICE = 20\.5;/);
  assert.match(pagina, /const NEXUS_MONTHLY_LABEL = 'R\$ 20,50';/);
  assert.ok(pagina.includes('R$ 20,50'));
  assert.ok(pagina.includes("const pixKey = 'cobranca@nexus.com';"));
  assert.ok(pagina.includes("const beneficiaryName = 'NEXUS PAGAMENTOS';"));
  assert.ok(pagina.includes("const city = 'SAO PAULO';"));
  assert.ok(pagina.includes("const key = 'cobranca@nexus.com';"), 'o botão "Copiar" copia a chave nova');
  assert.ok(pagina.includes('https://wa.me/5511988887777'));
  assert.ok(pagina.includes('(11) 98888-7777'));
  assert.ok(pagina.includes('Chave Pix (e-mail)'));
  assert.ok(!pagina.includes('62992345372') && !pagina.includes('99234-5372'), 'nenhum rastro da chave e do telefone antigos');
  assert.ok(!pagina.includes('R$ 18,00'), 'nenhum rastro do preço antigo na página');
  const glpi = (await api('GET', '/glpi.html')).texto;
  assert.ok(glpi.includes('assinar o plano Mensal por apenas R$ 20,50.'), 'o texto de ajuda do atendimento também mostra o preço novo');
  assert.ok(!glpi.includes('{{PRECO_MENSAL}}'));
});

test('configuração financeira: fica gravada, entra na auditoria (com a chave escondida) e é bloqueada para download', async () => {
  const arq = lerArquivo('local_financeiro_config.json');
  assert.equal(arq.config.preco, 20.5);
  assert.deepEqual(arq.config.pix, { tipo: 'email', chave: 'cobranca@nexus.com', nome: 'NEXUS PAGAMENTOS', cidade: 'SAO PAULO' });
  assert.equal(arq.config.whatsapp, '11988887777');
  assert.equal(arq.historico.length, 1);
  assert.ok(arq.historico[0].mudancas.some((m) => /Preço mensal: R\$ 18,00 → R\$ 20,50/.test(m)));
  assert.ok(arq.historico[0].mudancas.every((m) => !m.includes('cobranca@nexus.com') && !m.includes('992345372')), 'a chave inteira não vai para o histórico');
  assert.equal((await api('GET', '/local_financeiro_config.json')).status, 404);

  let trilha = '';
  for (let i = 0; i < 30 && !/Alterou a configuração financeira/.test(trilha); i++) { await dorme(200); trilha = JSON.stringify((await api('GET', '/api/logs', { token: admin })).json); }
  assert.match(trilha, /Alterou a configuração financeira/);
  assert.match(trilha, /Tentou alterar a configuração financeira com a senha incorreta/);
  assert.ok(!trilha.includes('cobranca@nexus.com'), 'a trilha de auditoria não mostra a chave inteira');
});

test('configuração financeira: sobrevive a reiniciar o servidor; arquivo inválido volta ao padrão sem derrubar o sistema', async () => {
  const outra = await subirOutraInstancia(pasta);
  try {
    const pagina = (await outra.get('/')).texto;
    assert.ok(pagina.includes('R$ 20,50') && pagina.includes('https://wa.me/5511988887777'), 'a segunda instância já nasce com o preço e o WhatsApp novos');
    const tok = (await login('admin@teste.nexus', 'Admin@12345')).token;
    assert.equal((await outra.get('/api/admin/pagamentos', tok)).json.preco, 20.5);
  } finally { await outra.matar(); }

  const pastaRuim = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-pag-cfg-'));
  try {
    for (const nome of fs.readdirSync(pasta)) { if (/\.json$/.test(nome)) fs.copyFileSync(path.join(pasta, nome), path.join(pastaRuim, nome)); }
    fs.writeFileSync(path.join(pastaRuim, 'local_financeiro_config.json'), JSON.stringify({ config: { preco: -5, pix: { tipo: 'cpf', chave: '111' }, cobranca: { dia: 99 } }, historico: [] }));
    const ruim = await subirOutraInstancia(pastaRuim);
    try {
      const pagina = (await ruim.get('/')).texto;
      assert.ok(pagina.includes('R$ 18,00'), 'configuração inválida: vale o padrão');
      assert.match(ruim.saida(), /local_financeiro_config\.json inválido/);
    } finally { await ruim.matar(); }
  } finally { try { fs.rmSync(pastaRuim, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ } }
});

test('configuração financeira: depois de 5 senhas erradas o administrador é travado por um tempo (inclusive com a senha certa)', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await salvarConfig(admin, CFG_NOVA(), 'chute-' + i);
    assert.ok(r.status === 403 || r.status === 429, 'tentativa ' + i + ': ' + r.status);
  }
  const travado = await salvarConfig(admin, { ...CFG_NOVA(), preco: '25,00' }, 'Admin@12345');
  assert.equal(travado.status, 429, travado.texto);
  assert.equal((await api('GET', '/api/admin/pagamentos', { token: admin })).json.preco, 20.5, 'nada foi alterado');
});

/* ---------------------------------------------------------------- lançamento retroativo de pagamento */
test('lançamento retroativo: só administrador, e recusa conta inexistente, administrador, data futura/antiga/inválida e valor ausente', async () => {
  const hist = (token, body) => api('POST', '/api/admin/pagamentos/historico', { token, body });
  const registrosAntes = livro().length;
  const ontem = P.diaDe(Date.now() - DIA);
  assert.equal((await hist(undefined, { email: 'fabio@teste.nexus', data: ontem, valor: '18,00' })).status, 401);
  assert.equal((await hist(ana, { email: 'fabio@teste.nexus', data: ontem, valor: '18,00' })).status, 403);
  assert.equal((await hist(admin, { email: 'ninguem@teste.nexus', data: ontem, valor: '18,00' })).status, 404);
  assert.equal((await hist(admin, { email: 'admin@teste.nexus', data: ontem, valor: '18,00' })).status, 400);
  const futura = await hist(admin, { email: 'fabio@teste.nexus', data: P.diaDe(Date.now() + 3 * DIA), valor: '18,00' });
  assert.equal(futura.status, 400); assert.equal(futura.json.campo, 'data');
  assert.equal((await hist(admin, { email: 'fabio@teste.nexus', data: '2026-02-31', valor: '18,00' })).json.campo, 'data');
  assert.equal((await hist(admin, { email: 'fabio@teste.nexus', data: P.diaDe(Date.now() - 900 * DIA), valor: '18,00' })).json.campo, 'data');
  assert.equal((await hist(admin, { email: 'fabio@teste.nexus', data: ontem })).json.campo, 'valor', 'sem valor não chuta o preço atual');
  assert.equal((await hist(admin, { email: 'fabio@teste.nexus', data: ontem, valor: '0' })).json.campo, 'valor');
  assert.equal((await hist(admin, { email: 'fabio@teste.nexus', data: ontem, valor: '999999' })).json.campo, 'valor');
  assert.equal(livro().length, registrosAntes, 'nada foi gravado');
});

const historicosDoFabio = () => livro().filter((p) => p.email === 'fabio@teste.nexus' && p.origem === 'historico');

test('lançamento retroativo: entra na receita do mês da data, não mexe no acesso da conta e não duplica', async () => {
  const antes = conta('fabio@teste.nexus');
  const resumoAntes = (await api('GET', '/api/admin/pagamentos', { token: admin })).json.resumo;
  const data = P.diaDe(Date.now() - 40 * DIA);
  const r = await api('POST', '/api/admin/pagamentos/historico', { token: admin, body: { email: 'fabio@teste.nexus', data, valor: '18,00', metodo: 'transferencia', obs: 'paga antes do livro' } });
  assert.equal(r.status, 200, r.texto);
  const reg = historicosDoFabio()[0];
  assert.equal(reg.status, 'paga');
  assert.equal(reg.origem, 'historico');
  assert.equal(reg.valor, 18);
  assert.equal(reg.metodo, 'transferencia');
  assert.equal(reg.dias, 0, 'não dá dias a ninguém');
  assert.equal(P.diaDe(Date.parse(reg.paga_em)), data, 'a data do dinheiro, não a de hoje');
  assert.equal(reg.confirmado_por.email, 'admin@teste.nexus');
  assert.ok(reg.historico.some((h) => h.acao === 'lancamento'));

  const depois = conta('fabio@teste.nexus');
  assert.equal(depois.subscription_status, antes.subscription_status, 'o acesso da conta não muda');
  assert.equal(depois.subscription_expires_at, antes.subscription_expires_at);

  const resumo = (await api('GET', '/api/admin/pagamentos', { token: admin })).json.resumo;
  const mes = P.mesDe(Date.parse(data + 'T12:00:00-03:00'));
  const serieAntes = resumoAntes.serie.find((s) => s.mes === mes), serieDepois = resumo.serie.find((s) => s.mes === mes);
  assert.equal(Math.round((serieDepois.total - serieAntes.total) * 100), 1800, 'a receita do mês da data subiu R$ 18,00');
  assert.equal(resumo.receita.qtd_total, resumoAntes.receita.qtd_total + 1);
  assert.equal(Math.round((resumo.receita.total - resumoAntes.receita.total) * 100), 1800);

  const igual = await api('POST', '/api/admin/pagamentos/historico', { token: admin, body: { email: 'fabio@teste.nexus', data, valor: '18,00' } });
  assert.equal(igual.status, 409, 'mesmo valor, mesma conta, mesma data: provavelmente duplo clique');
  assert.equal(historicosDoFabio().length, 1);
  const outroValor = await api('POST', '/api/admin/pagamentos/historico', { token: admin, body: { email: 'fabio@teste.nexus', data, valor: '25,00' } });
  assert.equal(outroValor.status, 200, 'outro valor na mesma data é outro pagamento');
});

test('lançamento retroativo: estornar tira da receita sem mexer no acesso, e o CSV e a auditoria mostram a origem', async () => {
  const antes = conta('fabio@teste.nexus');
  const reg = historicosDoFabio().filter((p) => p.valor === 25)[0];
  const est = await api('POST', '/api/admin/pagamentos/acao', { token: admin, body: { id: reg.id, acao: 'estornar', obs: 'lançado por engano' } });
  assert.equal(est.status, 200, est.texto);
  assert.match(est.json.message, /registro/, 'só o registro foi estornado');
  const depois = conta('fabio@teste.nexus');
  assert.equal(depois.subscription_status, antes.subscription_status);
  assert.equal(depois.subscription_expires_at, antes.subscription_expires_at, 'nenhum dia foi tirado da conta');

  const csv = (await api('POST', '/api/admin/pagamentos/csv', { token: admin, body: { ids: historicosDoFabio().map((p) => p.id) } })).texto;
  assert.match(csv, /historico/);
  let trilha = '';
  for (let i = 0; i < 30 && !/Lançou o pagamento retroativo/.test(trilha); i++) { await dorme(200); trilha = JSON.stringify((await api('GET', '/api/logs', { token: admin })).json); }
  assert.match(trilha, /Lançou o pagamento retroativo/);
});
test('boleto Pix na conta do cliente: 2ª via completa na conta dele, sem passar pelo administrador', async () => {
  assert.equal((await api('GET', '/api/subscription/boleto')).status, 401, 'sem login não sai boleto');
  assert.equal((await api('GET', '/api/subscription/boleto', { token: admin })).status, 403, 'administrador/vitalício não tem cobrança');

  const fabio = (await login('fabio@teste.nexus', 'Fabio@12345')).token;
  const antes = livro().filter((p) => p.email === 'fabio@teste.nexus').length;
  const doc = await api('GET', '/api/subscription/boleto', { token: fabio });
  assert.equal(doc.status, 200, doc.texto.slice(0, 300));
  assert.match(doc.headers.get('content-type'), /text\/html/);
  assert.match(doc.texto, /BOLETO PIX/);
  assert.match(doc.texto, /NEXUS FINANCEIRO HUB/);
  assert.match(doc.texto, /Fabio Sem Cobranca/);
  assert.match(doc.texto, /fabio@teste\.nexus/);
  assert.match(doc.texto, /CPF: 456\.789\.123-85/);
  assert.match(doc.texto, /RECEBEDOR/);
  assert.match(doc.texto, /Chave Pix \(/);
  assert.match(doc.texto, /\/api\/pix\/qr\.svg\?data=/);
  assert.match(doc.texto, /não um boleto bancário registrado/);

  const abertasFabio = livro().filter((p) => p.email === 'fabio@teste.nexus' && p.origem === 'usuario' && P.emAberto(p));
  assert.equal(abertasFabio.length, 1, 'a 1ª via emitiu a cobrança na conta do cliente');
  assert.ok(livro().length > antes, 'a cobrança entrou no livro');

  const doc2 = await api('GET', '/api/subscription/boleto', { token: fabio });
  assert.equal(doc2.status, 200);
  assert.match(doc2.texto, new RegExp(abertasFabio[0].ref), 'a 2ª via é da MESMA cobrança');
  assert.equal(livro().filter((p) => p.email === 'fabio@teste.nexus' && p.origem === 'usuario' && P.emAberto(p)).length, 1, 'baixar de novo não duplica a cobrança');
});
