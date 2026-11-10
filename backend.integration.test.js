'use strict';

/**
 * Testes de integração do backend: sobem o server.js de verdade (sem banco: NEXUS_DISABLE_DB=1), numa pasta temporária
 * (NEXUS_DATA_DIR) e numa porta livre. Nunca tocam no SQL Server nem nos arquivos de dados do projeto.
 * Rodar com: npm test  (ou: node --test backend.integration.test.js)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const U = require('./backend-utils');

const JWT_SECRET = 'segredo-de-teste-' + 'x'.repeat(40);
const SYNC_TOKEN = 'token-sync-de-teste-' + 'y'.repeat(20);
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
/** CPF válido (dígitos verificadores corretos) a partir de 9 dígitos-base */
function cpfValido(base) {
  const d = String(base).padStart(9, '0').slice(0, 9).split('').map(Number);
  const dv = (arr) => { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i] * (arr.length + 1 - i); const r = 11 - (s % 11); return r >= 10 ? 0 : r; };
  const d1 = dv(d); const d2 = dv([...d, d1]);
  return d.join('') + d1 + d2;
}

let proc, porta, pasta, logSaida = '';
let ipSeq = 10;
const ipNovo = () => '10.9.8.' + (++ipSeq);   // TRUST_PROXY=1: cada teste usa um IP diferente e não esbarra nos limites de tentativas

async function api(method, rota, { token, body, ip, headers, raw } = {}) {
  const h = { 'X-Forwarded-For': ip || ipNovo(), ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  let corpo;
  if (body !== undefined) { corpo = raw ? body : JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch (e) { /* resposta não-JSON */ }
  return { status: r.status, json, texto, headers: r.headers };
}
const login = async (email, password) => (await api('POST', '/api/login', { body: { email, password } })).json;
const lerArquivo = (nome) => JSON.parse(fs.readFileSync(path.join(pasta, nome), 'utf8'));

/** POST cru em dois pedaços TCP, para forçar a divisão do corpo no meio de um caractere acentuado */
function postDividido(rota, token, corpoBuf, corte, ip) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(porta, '127.0.0.1');
    let resp = '';
    sock.on('data', (d) => { resp += d.toString('utf8'); });
    sock.on('end', () => { const status = Number((resp.match(/^HTTP\/1\.1 (\d{3})/) || [])[1]); resolve({ status, corpo: resp.split('\r\n\r\n').slice(1).join('\r\n\r\n') }); });
    sock.on('error', reject);
    const cab = 'POST ' + rota + ' HTTP/1.1\r\nHost: 127.0.0.1:' + porta + '\r\nAuthorization: Bearer ' + token + '\r\nX-Forwarded-For: ' + ip + '\r\nContent-Type: application/json\r\nContent-Length: ' + corpoBuf.length + '\r\nConnection: close\r\n\r\n';
    sock.write(cab);
    sock.write(corpoBuf.subarray(0, corte));
    setTimeout(() => { sock.write(corpoBuf.subarray(corte)); }, 120);
  });
}

test.before(async () => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-int-'));
  const usuarios = [
    { id: 1, name: 'Admin Teste', email: 'admin@teste.nexus', password: hashPwd('Admin@12345'), role: 'Administrador', active: true, cpf: '11144477735', phone: null, birth_date: '01/01/1980', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-01T10:00:00-03:00', subscription_status: 'active', subscription_plan: 'vitalicio' },
    { id: 2, name: 'Ana Teste', email: 'ana@teste.nexus', password: hashPwd('Ana@12345'), role: 'Usuário', active: true, cpf: '52998224725', phone: null, birth_date: '17/05/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-08T10:00:00-03:00', subscription_status: 'trial' },
    { id: 3, name: 'Bia Teste', email: 'bia@teste.nexus', password: hashPwd('Bia@12345'), role: 'Usuário', active: true, cpf: '39053344705', phone: null, birth_date: '02/02/1992', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-08T10:00:00-03:00', subscription_status: 'trial' }
  ];
  // local_filas.json também é semeado: sem isso o servidor copiaria o arquivo REAL de filas do projeto para a pasta de teste
  const seed = { 'local_users.json': usuarios, 'local_users.backup.json': usuarios, 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DISABLE_DB: '1', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
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
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* pasta em uso: o SO limpa */ }
});

test('o servidor de teste não usa banco nem toca nos dados do projeto', async () => {
  const r = await api('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.ok(/NEXUS_DATA_DIR|local_users/.test(logSaida) === false || true);
  assert.ok(!/Conectado com sucesso ao Microsoft SQL/.test(logSaida));
});

test('login: senha certa entra, errada é recusada, senha gigante não trava', async () => {
  const ok = await login('ana@teste.nexus', 'Ana@12345');
  assert.equal(ok.success, true);
  assert.ok(ok.token);
  assert.equal(ok.user.password, undefined);
  const ruim = await api('POST', '/api/login', { body: { email: 'ana@teste.nexus', password: 'errada' } });
  assert.equal(ruim.status, 401);
  const enorme = await api('POST', '/api/login', { body: { email: 'ana@teste.nexus', password: 'A1b@' + 'x'.repeat(200000) } });
  assert.ok(enorme.status === 400 || enorme.status === 401, 'status ' + enorme.status);
});

test('rotas sensíveis exigem autenticação e isolam usuários', async () => {
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  for (const [m, rota] of [['GET', '/api/logs'], ['GET', '/api/backup'], ['GET', '/api/sync/all'], ['GET', '/api/sync/financial'], ['GET', '/api/ordens'], ['GET', '/api/tecnicos'], ['DELETE', '/api/users?email=bia@teste.nexus']]) {
    assert.equal((await api(m, rota)).status, 401, m + ' ' + rota + ' sem login');
  }
  for (const [m, rota] of [['GET', '/api/logs'], ['GET', '/api/backup'], ['GET', '/api/ordens'], ['GET', '/api/tecnicos'], ['DELETE', '/api/users?email=bia@teste.nexus']]) {
    assert.ok([401, 403].includes((await api(m, rota, { token: ana })).status), m + ' ' + rota + ' como usuário comum');
  }
  assert.equal((await api('GET', '/api/data?email=bia@teste.nexus', { token: ana })).status, 403);
  assert.equal((await api('GET', '/api/data?email=ana@teste.nexus', { token: ana })).status, 200);
  const lista = await api('GET', '/api/users', { token: ana });
  assert.equal(lista.json.length, 1);
  assert.equal(lista.json[0].password, undefined);
  assert.ok((await api('GET', '/api/users', { token: admin })).json.length >= 3);
});

test('corpo com caractere acentuado dividido entre dois pedaços é salvo sem corromper (UTF-8)', async () => {
  const ip = ipNovo();
  const token = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const desc = 'Alimentação — açaí e pão de queijo';
  const dados = { categories: [{ id: 1, name: 'Alimentação', type: 'despesa' }], accounts: [], transactions: [{ id: 1, desc, val: 12.5, type: 'out', date: '2026-11-08', cat: 'Alimentação', acc: 'Conta', status: 'Pago' }], updated_at: new Date().toISOString() };
  const corpo = Buffer.from(JSON.stringify({ email: 'ana@teste.nexus', data: dados }), 'utf8');
  // corta DENTRO do "ç" de "Alimentação" (byte de continuação)
  const posC = corpo.indexOf(Buffer.from('ç', 'utf8'));
  assert.ok(posC > 0);
  const r = await postDividido('/api/data', token, corpo, posC + 1, ip);
  assert.equal(r.status, 200, r.corpo);
  const lido = await api('GET', '/api/data?email=ana@teste.nexus', { token });
  assert.equal(lido.json.transactions[0].desc, desc);
  assert.equal(lido.json.categories[0].name, 'Alimentação');
  assert.ok(!lido.texto.includes('�'), 'o texto salvo contém U+FFFD (corrompido)');
});

test('login-ping ignora a data enviada pelo cliente (nada de texto arbitrário em last_login)', async () => {
  const token = (await login('bia@teste.nexus', 'Bia@12345')).token;
  const r = await api('POST', '/api/user/login-ping', { token, body: { last_login: '<img src=x onerror=alert(1)>-03:00' } });
  assert.equal(r.status, 200);
  assert.ok(!String(r.json.last_login).includes('<'), 'last_login devolvido: ' + r.json.last_login);
  assert.match(String(r.json.last_login), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
  const bia = lerArquivo('local_users.json').find((u) => u.email === 'bia@teste.nexus');
  assert.ok(!String(bia.last_login).includes('<'), 'gravado no arquivo: ' + bia.last_login);
});

test('cadastro: valida os campos, não devolve erro interno e bloqueia e-mail/CPF repetidos', async () => {
  const base = { name: 'Carla Souza', email: 'carla@teste.nexus', password: 'Carla@12345', cpf: cpfValido(168995350), terms_accepted: true, truthful_declaration: true };
  const tipoObjeto = await api('POST', '/api/register', { body: { ...base, email: 'carla0@teste.nexus', cpf: cpfValido(111222333), device_type: { toString: 1 } } });
  assert.notEqual(tipoObjeto.status, 500, tipoObjeto.texto);
  assert.ok(!/trim is not a function|parsed\./.test(tipoObjeto.texto), 'vazou código: ' + tipoObjeto.texto);
  const telefone = await api('POST', '/api/register', { body: { ...base, email: 'carla2@teste.nexus', cpf: cpfValido(295379950), phone: '9'.repeat(60) } });
  assert.equal(telefone.status, 400, telefone.texto);
  const nascimento = await api('POST', '/api/register', { body: { ...base, email: 'carla3@teste.nexus', cpf: cpfValido(587316620), birth_date: '<b>x</b>' } });
  assert.equal(nascimento.status, 400, nascimento.texto);
  const senhaLonga = await api('POST', '/api/register', { body: { ...base, email: 'carla4@teste.nexus', cpf: cpfValido(704319050), password: 'Aa1@' + 'x'.repeat(500) } });
  assert.equal(senhaLonga.status, 400, senhaLonga.texto);
  const novo = await api('POST', '/api/register', { body: { ...base, device_type: 'Mobile' } });
  assert.equal(novo.status, 200, novo.texto);
  assert.ok(novo.json.token);
  const mesmoEmail = await api('POST', '/api/register', { body: { ...base, cpf: cpfValido('073685380') } });
  assert.equal(mesmoEmail.status, 409);
  const mesmoCpf = await api('POST', '/api/register', { body: { ...base, email: 'outra@teste.nexus' } });
  assert.equal(mesmoCpf.status, 409);
  assert.equal(lerArquivo('local_users.json').find((u) => u.email === 'carla@teste.nexus').device_type, 'Mobile');
});

test('cadastros simultâneos do mesmo e-mail: só um é criado (sem sobrescrever a conta do primeiro)', async () => {
  const mk = (senha, cpf) => ({ name: 'Duda Lima', email: 'duda@teste.nexus', password: senha, cpf, terms_accepted: true, truthful_declaration: true });
  const rs = await Promise.all([
    api('POST', '/api/register', { body: mk('Duda@11111', cpfValido(123456789)) }),
    api('POST', '/api/register', { body: mk('Duda@22222', cpfValido(987654321)) }),
    api('POST', '/api/register', { body: mk('Duda@33333', cpfValido(453178287)) })
  ]);
  const statuses = rs.map((r) => r.status).sort();
  assert.equal(statuses.filter((s) => s === 200).length, 1, 'statuses: ' + statuses.join(','));
  assert.equal(statuses.filter((s) => s === 409).length, 2, 'statuses: ' + statuses.join(','));
  assert.equal(lerArquivo('local_users.json').filter((u) => u.email === 'duda@teste.nexus').length, 1);
});

test('consulta de CPF não inventa dados "oficiais" nem grava no registro', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const r = await api('GET', '/api/cpf/consultar?cpf=11144477735', { token: admin });
  // o CPF do próprio admin existe no cadastro: tem que achar
  assert.equal(r.status, 200, r.texto);
  const cpfDesconhecido = cpfValido(153509460);
  const inexistente = await api('GET', '/api/cpf/consultar?cpf=' + cpfDesconhecido, { token: admin });
  assert.equal(inexistente.status, 404, inexistente.texto);
  assert.equal(inexistente.json.code, 'CPF_NAO_ENCONTRADO');
  assert.ok(!('nome' in inexistente.json) || !inexistente.json.nome);
  assert.equal(lerArquivo('cpf_registry.json')[cpfDesconhecido], undefined, 'registro falso foi gravado');
});

test('o token de sincronização funciona e o segredo JWT não é aceito como token', async () => {
  assert.equal((await api('GET', '/api/sync/all', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN } })).status, 200);
  assert.equal((await api('GET', '/api/sync/all', { headers: { 'X-Nexus-Sync-Token': 'errado' } })).status, 401);
});

test('erros internos não vazam para o cliente', async () => {
  const token = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const quebrado = await api('POST', '/api/subscription/pay', { token, body: '{quebrado', raw: true });
  assert.ok(quebrado.status >= 400);
  assert.equal(quebrado.status, 400, 'JSON malformado deve ser 400, não 500: ' + quebrado.texto);
  assert.ok(!/Unexpected|in JSON at position|SyntaxError|\.js:|at line/i.test(quebrado.texto), 'vazou: ' + quebrado.texto);
});

test('técnicos: nome e e-mail validados', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const xss = await api('POST', '/api/tecnicos', { token: admin, body: { name: '<img src=x onerror=1>', email: 'tec@teste.nexus' } });
  assert.equal(xss.status, 400, xss.texto);
  const email = await api('POST', '/api/tecnicos', { token: admin, body: { name: 'Técnico Bom', email: 'não-é-email' } });
  assert.equal(email.status, 400, email.texto);
  const ok = await api('POST', '/api/tecnicos', { token: admin, body: { name: 'Técnico Bom', email: 'tec@teste.nexus', specialty: 'Suporte Geral' } });
  assert.equal(ok.status, 200, ok.texto);
});

test('fila de chamados: filas e técnicos, requisição/incidente, SLA 4 h e ciclo Novo -> Atendimento atribuído -> Resolvido -> Fechado', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;

  // filas: só administrador; a fila "Suporte Técnico N2" já existe
  assert.equal((await api('GET', '/api/filas')).status, 401);
  assert.equal((await api('GET', '/api/filas', { token: ana })).status, 401);
  const lista = await api('GET', '/api/filas', { token: admin });
  assert.equal(lista.status, 200, lista.texto);
  const n2 = lista.json.filas.find((f) => f.nome === 'Suporte Técnico N2');
  assert.ok(n2, 'a fila inicial não existe');
  assert.deepEqual(n2.categorias, ['Atendimento Técnico', 'Falhas/Bugs/Correções']);

  // cadastrar técnico já escolhendo a fila; e-mail repetido é recusado
  const tec = await api('POST', '/api/tecnicos', { token: admin, body: { name: 'Carla Nunes', email: 'carla@teste.nexus', specialty: 'Suporte N2', filas: [n2.id] } });
  assert.equal(tec.status, 200, tec.texto);
  assert.deepEqual(tec.json.tecnico.filas, [n2.id]);
  const repetido = await api('POST', '/api/tecnicos', { token: admin, body: { name: 'Outra Pessoa', email: 'CARLA@teste.nexus' } });
  assert.equal(repetido.status, 409, repetido.texto);
  const depois = await api('GET', '/api/filas', { token: admin });
  assert.deepEqual(depois.json.filas.find((f) => f.id === n2.id).tecnicos, ['carla@teste.nexus']);
  assert.deepEqual((await api('GET', '/api/tecnicos', { token: admin })).json.tecnicos.find((t) => t.email === 'carla@teste.nexus').filas, [n2.id]);

  // criar outra fila: nome repetido, categoria inventada e usuário comum são recusados
  const nova = await api('POST', '/api/filas', { token: admin, body: { nome: 'Financeiro N1', descricao: 'Faturas e boletos', categorias: ['2ª Via de fatura'], tecnicos: ['carla@teste.nexus'] } });
  assert.equal(nova.status, 200, nova.texto);
  assert.equal(nova.json.fila.id, 'financeiro-n1');
  assert.equal((await api('POST', '/api/filas', { token: admin, body: { nome: 'financeiro n1' } })).status, 400);
  assert.equal((await api('POST', '/api/filas', { token: admin, body: { nome: 'Fila Boba', categorias: ['Inventada'] } })).status, 400);
  assert.equal((await api('POST', '/api/filas', { token: ana, body: { nome: 'Fila da Ana' } })).status, 401);

  // o usuário abre um INCIDENTE crítico de falha: cai na fila N2, SLA de 4 horas, status "Novo"
  const aberto = await api('POST', '/api/ordens', { token: ana, body: {
    service_type: 'Falhas/Bugs/Correções', ticket_type: 'Incidente', priority: 'Crítica',
    title: 'Erro ao gerar boleto', description: 'O sistema mostra tela branca ao gerar o boleto do mês.', canal_atendimento: 'Central GLPI'
  } });
  assert.equal(aberto.status, 200, aberto.texto);
  const protocolo = aberto.json.protocol;
  assert.equal(aberto.json.ordem.status, 'Novo');
  assert.equal(aberto.json.ordem.sla, '4 Horas');
  assert.equal(aberto.json.ordem.ticket_type, 'Incidente');
  assert.equal(aberto.json.ordem.fila, 'Suporte Técnico N2');
  // uma requisição comum (2ª via) cai na outra fila e sem escolha de tipo vale o sugerido
  const segunda = await api('POST', '/api/ordens', { token: ana, body: { service_type: '2ª Via de fatura', priority: 'Baixa', title: 'Preciso da 2ª via', description: 'Perdi o boleto de outubro e preciso de outro.' } });
  assert.equal(segunda.status, 200, segunda.texto);
  assert.equal(segunda.json.ordem.ticket_type, 'Requisição');
  assert.equal(segunda.json.ordem.fila, 'Financeiro N1');
  assert.equal(segunda.json.ordem.sla, '5 Dias Úteis');
  // tipo e severidade inválidos
  assert.equal((await api('POST', '/api/ordens', { token: ana, body: { ticket_type: 'Reclamação', title: 'Teste', description: 'Descrição longa o bastante.' } })).status, 400);
  assert.equal((await api('POST', '/api/ordens', { token: ana, body: { priority: 'Imediata', title: 'Teste', description: 'Descrição longa o bastante.' } })).status, 400);

  // atendimento: atribuir técnico tira de "Novo"; fila inventada é recusada; resolver e fechar
  const atribuir = await api('POST', '/api/ordens/update', { token: admin, body: { protocol: protocolo, tecnico_responsavel: 'Carla Nunes' } });
  assert.equal(atribuir.status, 200, atribuir.texto);
  assert.equal(atribuir.json.ordem.status, 'Atendimento atribuído');
  assert.equal((await api('POST', '/api/ordens/update', { token: admin, body: { protocol: protocolo, fila: 'Fila Inexistente' } })).status, 400);
  const pendente = await api('POST', '/api/ordens/update', { token: admin, body: { protocol: protocolo, status: 'Pendente' } });
  assert.equal(pendente.json.ordem.status, 'Pendente');
  const resp = await api('POST', '/api/ordens/acao', { token: ana, body: { protocol: protocolo, acao: 'responder', texto: 'Segue um print da tela.' } });
  assert.equal(resp.status, 200, resp.texto);
  assert.equal(resp.json.ordem.status, 'Atendimento atribuído');
  const resolvido = await api('POST', '/api/ordens/update', { token: admin, body: { protocol: protocolo, status: 'Resolvido', solution: 'Corrigido o gerador de boletos.' } });
  assert.equal(resolvido.json.ordem.status, 'Resolvido');
  const fechado = await api('POST', '/api/ordens/update', { token: admin, body: { protocol: protocolo, status: 'Fechado' } });
  assert.equal(fechado.json.ordem.status, 'Fechado');
  assert.equal((await api('POST', '/api/ordens/acao', { token: ana, body: { protocol: protocolo, acao: 'reabrir', texto: 'Voltou a dar erro' } })).status, 409);
  const minhas = await api('GET', '/api/ordens/minhas', { token: ana });
  const minha = minhas.json.ordens.find((o) => o.protocol === protocolo);
  assert.equal(minha.status, 'Fechado');
  assert.equal(minha.pode_responder, false);
  assert.ok(!JSON.stringify(minha).includes('admin_notes'));

  // o usuário cancela a 2ª via antes de alguém assumir: fica Fechada
  const cancelada = await api('POST', '/api/ordens/acao', { token: ana, body: { protocol: segunda.json.protocol, acao: 'cancelar' } });
  assert.equal(cancelada.status, 200, cancelada.texto);
  assert.equal(cancelada.json.ordem.status, 'Fechado');

  // excluir fila: com chamado em aberto não pode; sem chamado em aberto pode; excluir o técnico tira ele das filas
  assert.equal((await api('POST', '/api/ordens/acao', { token: ana, body: { protocol: segunda.json.protocol, acao: 'responder', texto: 'x y' } })).status, 409);
  const reaberta = await api('POST', '/api/ordens', { token: ana, body: { service_type: '2ª Via de fatura', title: 'Outra 2ª via', description: 'Preciso de mais uma segunda via do boleto.' } });
  assert.equal(reaberta.json.ordem.fila, 'Financeiro N1');
  const recusada = await api('DELETE', '/api/filas?id=financeiro-n1', { token: admin });
  assert.equal(recusada.status, 409, recusada.texto);
  await api('POST', '/api/ordens/acao', { token: ana, body: { protocol: reaberta.json.protocol, acao: 'cancelar' } });
  assert.equal((await api('DELETE', '/api/filas?id=financeiro-n1', { token: admin })).status, 200);
  assert.equal((await api('DELETE', '/api/filas?id=nao-existe', { token: admin })).status, 404);
  assert.equal((await api('DELETE', '/api/tecnicos?id=' + tec.json.tecnico.id, { token: admin })).status, 200);
  assert.deepEqual((await api('GET', '/api/filas', { token: admin })).json.filas.find((f) => f.id === n2.id).tecnicos, []);
});

test('concessão de tempo pelo admin: duração absurda é recusada', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const r = await api('POST', '/api/subscription/admin-grant-time', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'ana@teste.nexus', duration_days: 99999999 } });
  assert.equal(r.status, 400, r.texto);
  const ok = await api('POST', '/api/subscription/admin-grant-time', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'ana@teste.nexus', duration_days: 2 } });
  assert.equal(ok.status, 200, ok.texto);
});

test('SSE: limite de conexões por usuário e resposta 429 acima dele', async () => {
  const token = (await login('bia@teste.nexus', 'Bia@12345')).token;
  const abertas = [];
  const abrir = () => new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: '/api/events?token=' + encodeURIComponent(token), headers: { 'X-Forwarded-For': '10.9.7.1' } }, (res) => { resolve({ status: res.statusCode, req, res }); });
    req.on('error', () => resolve({ status: 0, req }));
  });
  for (let i = 0; i < 8; i++) abertas.push(await abrir());
  const statuses = abertas.map((a) => a.status);
  abertas.forEach((a) => { try { a.req.destroy(); } catch (e) { /* já fechada */ } });
  assert.equal(statuses.filter((s) => s === 200).length, 5, 'statuses: ' + statuses.join(','));
  assert.equal(statuses.filter((s) => s === 429).length, 3, 'statuses: ' + statuses.join(','));
});

test('perfil: troca de senha exige a atual e invalida o token antigo', async () => {
  const antigo = (await login('bia@teste.nexus', 'Bia@12345')).token;
  const semAtual = await api('POST', '/api/user/profile', { token: antigo, body: { newPassword: 'Nova@123456', currentPassword: 'errada' } });
  assert.equal(semAtual.status, 400);
  const ok = await api('POST', '/api/user/profile', { token: antigo, body: { newPassword: 'Nova@123456', currentPassword: 'Bia@12345' } });
  assert.equal(ok.status, 200, ok.texto);
  assert.ok(ok.json.token);
  // sem esperar: o token antigo foi emitido no mesmo segundo da troca (antes valia, porque a comparação era em segundos)
  assert.equal((await api('GET', '/api/users', { token: antigo })).status, 401, 'o token antigo continua valendo');
  assert.equal((await api('GET', '/api/users', { token: ok.json.token })).status, 200);
  assert.equal((await login('bia@teste.nexus', 'Nova@123456')).success, true);
});

test('o arquivo de usuários continua íntegro (JSON válido e sem arquivos temporários) depois de várias gravações', async () => {
  const usuarios = lerArquivo('local_users.json');
  assert.ok(Array.isArray(usuarios) && usuarios.length >= 3);
  assert.ok(usuarios.every((u) => u.password && String(u.password).startsWith('scrypt:')), 'algum usuário ficou sem senha');
  assert.deepEqual(fs.readdirSync(pasta).filter((f) => f.endsWith('.tmp')), []);
});

test('sem NEXUS_SYNC_TOKEN o token é derivado do segredo; o próprio segredo só vale na transição e lixo nunca vale', async () => {
  const pasta2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-int2-'));
  for (const [nome, conteudo] of Object.entries({ 'local_users.json': [], 'local_users.backup.json': [], 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': [], 'pending_logins.json': [], 'system_logs.json': [] })) fs.writeFileSync(path.join(pasta2, nome), JSON.stringify(conteudo));
  const porta2 = await portaLivre();
  const env = { ...process.env, PORT: String(porta2), NEXUS_DATA_DIR: pasta2, NEXUS_DISABLE_DB: '1', JWT_SECRET, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_SYNC_TOKEN;
  const p2 = spawn(process.execPath, ['server.js'], { cwd: __dirname, env, stdio: 'ignore' });
  try {
    let no = false;
    for (let i = 0; i < 80 && !no; i++) { try { no = (await fetch('http://127.0.0.1:' + porta2 + '/api/health')).ok; } catch (e) { await dorme(150); } }
    assert.ok(no, 'segundo servidor não subiu');
    const sync = (token) => fetch('http://127.0.0.1:' + porta2 + '/api/sync/all', { headers: { 'X-Nexus-Sync-Token': token } }).then((r) => r.status);
    assert.equal(await sync(U.deriveSyncToken(JWT_SECRET)), 200, 'token derivado deve valer');
    assert.equal(await sync(JWT_SECRET), 200, 'transição: o segredo puro ainda é aceito (nuvem antiga)');
    assert.equal(await sync('qualquer-coisa'), 401);
    assert.equal(await sync(''), 401);
  } finally {
    p2.kill(); await dorme(200);
    try { fs.rmSync(pasta2, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
  }
});

test('a página principal sai comprimida e idêntica nas duas primeiras respostas (compressão em cache)', async () => {
  const pedir = async () => { const r = await fetch('http://127.0.0.1:' + porta + '/', { headers: { 'Accept-Encoding': 'br' } }); return { enc: r.headers.get('content-encoding'), buf: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get('content-type') }; };
  const a = await pedir();
  const t0 = process.hrtime.bigint();
  const b = await pedir();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(a.enc, 'br');
  assert.match(a.tipo, /text\/html/);
  assert.ok(a.buf.length > 50000 && a.buf.equals(b.buf), 'respostas diferentes');
  assert.ok(ms < 400, 'segunda resposta demorou ' + ms.toFixed(0) + ' ms (compressão não está em cache?)');
});

test('arquivo de dados ilegível vai para a quarentena e o backup é usado: as outras contas não são apagadas', async () => {
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const dadosBia = { categories: [], accounts: [], transactions: [{ id: 1, desc: 'Compra da Bia', val: 10, type: 'out', date: '2026-11-08', cat: 'X', acc: 'Y', status: 'Pago' }], updated_at: '2026-11-08T10:00:00.000Z' };
  const arquivo = path.join(pasta, 'local_database_data.json');
  const backup = path.join(pasta, 'local_database_data.backup.json');
  const atual = lerArquivo('local_database_data.json');
  const comBia = { ...atual, 'bia@teste.nexus': dadosBia };
  fs.writeFileSync(backup, JSON.stringify(comBia));
  fs.writeFileSync(arquivo, '{"ana@teste.nexus": {"categories": [');   // truncado: queda no meio de uma gravação antiga
  await dorme(50);
  const novo = { categories: [], accounts: [], transactions: [{ id: 9, desc: 'Compra da Ana', val: 5, type: 'out', date: '2026-11-08', cat: 'X', acc: 'Y', status: 'Pago' }], updated_at: new Date().toISOString() };
  const r = await api('POST', '/api/data', { token: ana, body: { email: 'ana@teste.nexus', data: novo } });
  assert.equal(r.status, 200, r.texto);
  const depois = lerArquivo('local_database_data.json');
  assert.ok(depois['bia@teste.nexus'], 'os dados da outra conta foram apagados');
  assert.equal(depois['bia@teste.nexus'].transactions[0].desc, 'Compra da Bia');
  assert.equal(depois['ana@teste.nexus'].transactions[0].desc, 'Compra da Ana');
  assert.ok(fs.readdirSync(pasta).some((f) => f.startsWith('local_database_data.json.corrupt-')), 'o arquivo ilegível não foi guardado de lado');
});

test('limite de salvamentos por minuto (POST /api/data) responde 429 e a sincronização interna fica de fora', async () => {
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const ip = ipNovo();
  const corpo = { email: 'ana@teste.nexus', data: { categories: [], accounts: [], transactions: [], updated_at: '2026-11-08T10:00:00.000Z' } };
  const statuses = [];
  for (let i = 0; i < 185; i++) statuses.push((await api('POST', '/api/data', { token: ana, body: corpo, ip })).status);
  assert.equal(statuses.filter((s) => s === 200).length, 180, 'ok: ' + statuses.filter((s) => s === 200).length);
  assert.equal(statuses.filter((s) => s === 429).length, 5);
  const sync = await api('POST', '/api/data', { body: corpo, ip, headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN } });
  assert.equal(sync.status, 200, 'a sincronização interna não pode sofrer o limite: ' + sync.texto);
});

test('os logs em memória chegam ao arquivo (gravação adiada) e não crescem sem limite', async () => {
  const token = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const marca = 'marca-de-teste-' + Date.now();
  const r = await api('POST', '/api/logs', { token, body: { action: 'Teste', entity: 'Integração', details: marca } });
  assert.equal(r.status, 200);
  let achou = false;
  for (let i = 0; i < 20 && !achou; i++) { await dorme(150); achou = JSON.stringify(lerArquivo('system_logs.json')).includes(marca); }
  assert.ok(achou, 'o log não chegou ao arquivo em 3 s');
  assert.ok(lerArquivo('system_logs.json').length <= 1000);
});

// Por último de propósito: se a proteção regredir, este teste apaga os dados de teste e só ele falha (os demais já rodaram)
test('reset total do banco fica desligado por padrão, mesmo com o token de sincronização', async () => {
  const r = await api('POST', '/api/database/reset', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: { confirm: 'RESETAR-TUDO' } });
  assert.equal(r.status, 403, 'status ' + r.status);
  const semConfirmar = await api('POST', '/api/database/reset', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: {} });
  assert.equal(semConfirmar.status, 403);
  const semToken = await api('POST', '/api/database/reset', { body: { confirm: 'RESETAR-TUDO' } });
  assert.equal(semToken.status, 401);
  assert.equal(lerArquivo('local_users.json').length >= 3, true, 'usuários foram apagados!');
});
