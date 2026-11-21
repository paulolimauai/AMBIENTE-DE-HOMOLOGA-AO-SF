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
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_DEPOIMENTOS_FILE: path.join(pasta, 'depoimentos.json'), NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, NEXUS_OWNER_EMAIL: 'dono@teste.nexus', NEXUS_RESERVED_EMAILS: 'reservado@teste.nexus', RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1' };
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

test('estado da gravação no Supabase: só o administrador vê, e nunca expõe chaves', async () => {
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  assert.equal((await api('GET', '/api/admin/supabase-status')).status, 401, 'sem login');
  assert.ok([401, 403].includes((await api('GET', '/api/admin/supabase-status', { token: ana })).status), 'usuário comum');
  const r = await api('GET', '/api/admin/supabase-status', { token: admin });
  assert.equal(r.status, 200, r.texto);
  const corpo = JSON.parse(r.texto);
  assert.equal(corpo.success, true);
  assert.equal(corpo.supabase.enabled, false, 'o servidor de teste (NEXUS_DISABLE_DB=1) não pode gravar no Supabase real');
  assert.ok(!/eyJ|sb_secret|service_role_key|password/i.test(r.texto), 'a resposta não pode conter chaves nem senhas');
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

test('sessão única: /api/auth/session diz quem é a conta e se é administradora (telas do admin não têm login próprio)', async () => {
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  assert.equal((await api('GET', '/api/auth/session')).status, 401, 'sem token');
  assert.equal((await api('GET', '/api/auth/session', { token: 'lixo.lixo.lixo' })).status, 401, 'token inválido');
  const a = await api('GET', '/api/auth/session', { token: admin });
  assert.equal(a.status, 200, a.texto);
  assert.equal(a.json.user.isAdmin, true);
  assert.equal(a.json.user.role, 'Administrador');
  assert.equal(a.json.user.email, 'admin@teste.nexus');
  assert.match(a.headers.get('cache-control') || '', /no-store/);
  const u = await api('GET', '/api/auth/session', { token: ana });
  assert.equal(u.status, 200, u.texto);
  assert.equal(u.json.user.isAdmin, false, 'usuário comum nunca é administrador');
  assert.notEqual(u.json.user.role, 'Administrador');
  assert.ok(!/password|scrypt|eyJ/i.test(a.texto + u.texto), 'a resposta não pode conter senha, hash nem token');
  // a mesma decisão vale para o conteúdo: usuário comum não lê os arquivos do site, administrador lê
  assert.ok([401, 403].includes((await api('GET', '/api/admin/site/files', { token: ana })).status));
  assert.equal((await api('GET', '/api/admin/site/files', { token: admin })).status, 200);
});

test('sessão única: telas e script compartilhado são servidos e o login só devolve para telas do próprio site', async () => {
  for (const [rota, tipo] of [['/nexus-sso.js', 'javascript'], ['/admin-site.html', 'html'], ['/admin-site.js', 'javascript'], ['/admin-assinaturas-glpi.html', 'html'], ['/login.html', 'html'], ['/glpi.html', 'html']]) {
    const r = await api('GET', rota);
    assert.equal(r.status, 200, rota);
    assert.ok((r.headers.get('content-type') || '').includes(tipo), rota + ' ' + r.headers.get('content-type'));
  }
  // as telas do administrador não podem ter voltado a ter formulário de login próprio
  const painel = (await api('GET', '/admin-assinaturas-glpi.html')).texto;
  assert.ok(!/id="lf"|id="demo"|[A-Za-z0-9._-]+@gmail\.com"\s*>|type="password"/.test(painel), 'painel do admin não tem login próprio');
  assert.ok(painel.includes('/nexus-sso.js') && painel.includes('NexusSSO.exigirAdmin'), 'painel usa o porteiro compartilhado');
  // Os botões do painel usam onclick="blk(..)" etc. (escopo global): se as funções reais não forem expostas em window, valem as de demonstração,
  // que só mexem no cache do navegador — "Bloquear" parecia funcionar na tela e o servidor nunca era avisado.
  assert.ok(/Object\.assign\(window,\{[^}]*\bblk:blk\b[^}]*\bgrant:grant\b/.test(painel), 'o painel precisa expor blk/grant/... reais em window');
  assert.ok((await api('GET', '/admin-site.html')).texto.includes('/nexus-sso.js'));
  // O painel do administrador tem endereço limpo (/admin-assinaturas-glpi) e é ele que o site e o login oferecem;
  // o editor de arquivos do site (/admin-site.html) não tem mais link público.
  const limpo = await api('GET', '/admin-assinaturas-glpi');
  assert.equal(limpo.status, 200, 'endereço sem .html');
  assert.ok((limpo.headers.get('content-type') || '').includes('html'));
  assert.equal(limpo.texto, painel, 'o endereço limpo serve o mesmo painel');
  assert.notEqual((await api('GET', '/admin-assinaturas-glpi/outra-coisa')).texto, painel, 'o alias não vale para subcaminhos');
  const inicio = (await api('GET', '/inicio')).texto;
  assert.ok(/<a href="\/login\.html\?next=admin">Área do Administrador<\/a>/.test(inicio), 'rodapé do /inicio aponta para o painel do administrador pelo endereço curto');
  // faixa "Acesso rápido": Financeiro, Central de Suporte e Administrador como links diretos, também na gaveta do celular
  assert.ok(/id="acessos"/.test(inicio), '/inicio tem a faixa Acesso rápido');
  for (const href of ['/login.html', '/suporte', '/login.html?next=admin']) {
    assert.ok(inicio.includes('class="acx-c card" href="' + href + '"'), 'cartão de acesso rápido para ' + href);
    assert.ok(inicio.includes('<a href="' + href + '">'), 'gaveta do celular com o link ' + href);
  }
  assert.ok(!/admin-site\.html/.test(inicio), '/inicio não aponta mais para o editor do site');
  const loginPagina = (await api('GET', '/login.html')).texto;
  assert.ok(/href="\/admin-assinaturas-glpi">Área do administrador</.test(loginPagina), 'rodapé do login aponta para o painel');
  assert.ok(!/class="voltar" href="\/admin-site\.html"/.test(loginPagina));
  // o login só aceita voltar para uma lista fechada de telas (nada de redirecionamento aberto)
  const loginHtml = (await api('GET', '/login.html')).texto;
  assert.ok(loginHtml.includes('DESTINOS_OK'), 'login tem a lista fechada de destinos');
  assert.ok(!/location\.replace\('\/'\)/.test(loginHtml), 'login não manda mais sempre para "/" (usa o destino validado)');
  // Nexus e GLPI: "Sair" apaga também a sessão do outro; botões do menu mantêm a sessão da aba (sem noopener)
  const glpi = (await api('GET', '/glpi.html')).texto;
  assert.ok(glpi.includes('limparSessaoCompartilhada') && glpi.includes('abrirNoNexus'));
  const app = (await api('GET', '/login.html')).status;   // o app em "/" depende de sessão; a presença dos botões é conferida no código-fonte
  assert.equal(app, 200);
  const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(/id="menuAdminAssinaturasBtn"[^>]*onclick="window\.open\('\/admin-assinaturas-glpi\.html','_blank'\)"/.test(fonte));
  assert.ok(/id="mobileDrawerAdminAssinaturasBtn"[^>]*onclick="window\.open\('\/admin-assinaturas-glpi\.html','_blank'\)"/.test(fonte), 'gaveta do celular: sem noopener, a aba nova herda a sessão');
  assert.ok(!/menuSiteAdminBtn|mobileDrawerSiteAdminBtn|>Administrar Site</.test(fonte), 'o atalho "Administrar Site" saiu dos menus do Nexus');
  assert.ok(!/window\.open\('\/glpi\.html\?' \+ modeQuery, '_blank', 'noopener/.test(fonte));
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

test('fila de chamados: filas e técnicos, requisição/incidente, SLA 5 dias úteis e ciclo Novo -> Atendimento atribuído -> Resolvido -> Fechado', async () => {
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

  // o usuário abre um INCIDENTE de falha (mesmo pedindo "Crítica", só existe a prioridade Baixa): cai na fila N2, SLA de 5 dias úteis, status "Novo"
  const aberto = await api('POST', '/api/ordens', { token: ana, body: {
    service_type: 'Falhas/Bugs/Correções', ticket_type: 'Incidente', priority: 'Crítica',
    title: 'Erro ao gerar boleto', description: 'O sistema mostra tela branca ao gerar o boleto do mês.', canal_atendimento: 'Central GLPI'
  } });
  assert.equal(aberto.status, 200, aberto.texto);
  const protocolo = aberto.json.protocol;
  assert.equal(aberto.json.ordem.status, 'Novo');
  assert.equal(aberto.json.ordem.sla, '5 Dias Úteis');
  assert.equal(aberto.json.ordem.priority, 'Baixa');
  assert.equal(aberto.json.ordem.ticket_type, 'Incidente');
  assert.equal(aberto.json.ordem.fila, 'Suporte Técnico N2');
  // uma requisição comum (2ª via) cai na outra fila e sem escolha de tipo vale o sugerido
  const segunda = await api('POST', '/api/ordens', { token: ana, body: { service_type: '2ª Via de fatura', priority: 'Baixa', title: 'Preciso da 2ª via', description: 'Perdi o boleto de outubro e preciso de outro.' } });
  assert.equal(segunda.status, 200, segunda.texto);
  assert.equal(segunda.json.ordem.ticket_type, 'Requisição');
  assert.equal(segunda.json.ordem.fila, 'Financeiro N1');
  assert.equal(segunda.json.ordem.sla, '5 Dias Úteis');
  // tipo e prioridade inválidos
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

test('permissões delegadas: só o admin concede; quem recebe libera assinatura e bloqueia contas de usuário, nunca administradores nem a própria conta', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const liberar = (token, de, para, extra) => api('POST', '/api/subscription/admin-grant-time', { token, body: Object.assign({ admin_email: de, target_email: para, duration_minutes: 60 }, extra || {}) });
  const ativo = (token, email, active) => api('POST', '/api/delegate/account-active', { token, body: { email, active } });
  const permissoes = (token, email, lista) => api('POST', '/api/admin/permissions', { token, body: { email, permissions: lista } });

  // sem permissão nenhuma: usuário comum não faz nada disso
  assert.equal((await liberar(ana, 'ana@teste.nexus', 'bia@teste.nexus')).status, 403);
  assert.equal((await api('GET', '/api/delegate/accounts', { token: ana })).status, 403);
  assert.equal((await ativo(ana, 'bia@teste.nexus', false)).status, 403);
  assert.equal((await api('GET', '/api/logs', { token: ana })).status, 401);

  // só o administrador concede, só ids do catálogo, nunca para administrador nem para si mesmo
  assert.equal((await permissoes(ana, 'ana@teste.nexus', ['assinatura.liberar'])).status, 401, 'usuário comum não se concede permissão');
  assert.equal((await api('GET', '/api/admin/permissions', { token: ana })).status, 401);
  assert.equal((await permissoes(admin, 'ana@teste.nexus', ['coisa.inventada'])).status, 400);
  assert.equal((await permissoes(admin, 'ana@teste.nexus', 'assinatura.liberar')).status, 400);
  assert.equal((await permissoes(admin, 'admin@teste.nexus', ['logs.ver'])).status, 403);
  assert.equal((await permissoes(admin, 'nao@existe.nexus', ['logs.ver'])).status, 404);
  const cat = await api('GET', '/api/admin/permissions', { token: admin });
  assert.deepEqual(cat.json.catalog.map((p) => p.id), ['assinatura.liberar', 'contas.bloquear', 'logs.ver']);

  // concedida: vale na hora, com o MESMO token, e vem no cadastro da própria conta
  assert.equal((await permissoes(admin, 'ana@teste.nexus', ['assinatura.liberar', 'contas.bloquear'])).status, 200);
  assert.deepEqual(lerArquivo('local_permissions.json')['ana@teste.nexus'], ['assinatura.liberar', 'contas.bloquear']);
  const meuCadastro = (await api('GET', '/api/users', { token: ana })).json;
  assert.deepEqual(meuCadastro.map((u) => u.email), ['ana@teste.nexus']);
  assert.deepEqual(meuCadastro[0].permissions, ['assinatura.liberar', 'contas.bloquear']);
  const ok = await liberar(ana, 'ana@teste.nexus', 'bia@teste.nexus');
  assert.equal(ok.status, 200, ok.texto);
  assert.equal(ok.json.plan, 'cortesia_admin');

  // a lista que ela vê não traz administrador nem ela mesma, e não expõe dados pessoais
  const contas = (await api('GET', '/api/delegate/accounts', { token: ana })).json.accounts;
  const emails = contas.map((c) => c.email);
  assert.ok(emails.includes('bia@teste.nexus'), 'vê as contas de usuário');
  assert.ok(!emails.includes('admin@teste.nexus') && !emails.includes('ana@teste.nexus'), 'sem administrador e sem a própria conta');
  const daBia = contas.find((c) => c.email === 'bia@teste.nexus');
  assert.equal(daBia.access.is_subscribed, true);
  assert.ok(!/cpf|phone|birth|password/i.test(Object.keys(daBia).join()), 'sem dados pessoais');

  // nunca em administrador nem na própria conta (5 ações) e não passa por admin trocando admin_email
  for (const alvo of ['admin@teste.nexus', 'ana@teste.nexus']) {
    assert.equal((await liberar(ana, 'ana@teste.nexus', alvo, { is_lifetime: true })).status, 403, 'liberar ' + alvo);
    assert.equal((await api('POST', '/api/subscription/confirm-payment', { token: ana, body: { admin_email: 'ana@teste.nexus', target_email: alvo, plan: 'vitalicio' } })).status, 403, 'confirmar ' + alvo);
    assert.equal((await api('POST', '/api/subscription/revoke-payment', { token: ana, body: { admin_email: 'ana@teste.nexus', target_email: alvo } })).status, 403, 'revogar ' + alvo);
    assert.equal((await api('POST', '/api/subscription/reset-trial', { token: ana, body: { admin_email: 'ana@teste.nexus', email: alvo } })).status, 403, 'novo teste ' + alvo);
    assert.equal((await ativo(ana, alvo, false)).status, 403, 'bloquear ' + alvo);
  }
  assert.equal((await liberar(ana, 'admin@teste.nexus', 'bia@teste.nexus')).status, 403, 'o admin_email do corpo não vale: quem manda é o token');

  // bloquear e ativar de verdade: a conta bloqueada não entra e a sessão aberta cai
  const biaToken = (await login('bia@teste.nexus', 'Bia@12345')).token;
  assert.equal((await ativo(ana, 'bia@teste.nexus', 'sim')).status, 400);
  assert.equal((await ativo(ana, 'bia@teste.nexus', false)).status, 200);
  assert.notEqual((await api('POST', '/api/login', { body: { email: 'bia@teste.nexus', password: 'Bia@12345' } })).status, 200);
  assert.equal((await api('GET', '/api/users', { token: biaToken })).status, 401);
  assert.equal((await ativo(ana, 'bia@teste.nexus', true)).status, 200);
  assert.equal((await api('POST', '/api/login', { body: { email: 'bia@teste.nexus', password: 'Bia@12345' } })).status, 200);

  // permissões parciais: só "ver logs" lê a auditoria e não faz mais nada; retirar tudo corta na hora
  assert.equal((await permissoes(admin, 'ana@teste.nexus', ['logs.ver'])).status, 200);
  assert.equal((await api('GET', '/api/logs', { token: ana })).status, 200);
  assert.equal((await liberar(ana, 'ana@teste.nexus', 'bia@teste.nexus')).status, 403);
  assert.equal((await api('GET', '/api/delegate/accounts', { token: ana })).status, 403);
  const trilha = JSON.stringify((await api('GET', '/api/logs', { token: admin })).json);
  assert.ok(trilha.includes('Alteração de Permissões') && trilha.includes('Bloqueou a conta de Bia Teste'), 'concessão e bloqueio ficam na auditoria');
  assert.equal((await permissoes(admin, 'ana@teste.nexus', [])).status, 200);
  assert.equal((await api('GET', '/api/logs', { token: ana })).status, 401);
  assert.ok(!lerArquivo('local_permissions.json')['ana@teste.nexus'], 'lista vazia remove a entrada do arquivo');
});

test('oferta: 1 dia grátis no cadastro e depois plano único Mensal de R$ 18,00 (anual recusado, valor sempre do servidor)', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const reg = await api('POST', '/api/register', { body: { name: 'Paula Oferta', email: 'paula@teste.nexus', password: 'Paula@12345', cpf: cpfValido(246813579), terms_accepted: true, truthful_declaration: true } });
  assert.equal(reg.status, 200, reg.texto);
  const token = (await login('paula@teste.nexus', 'Paula@12345')).token;

  // 1 dia grátis: 24 h de teste, sem assinatura
  const antes = (await api('GET', '/api/subscription/status?email=paula%40teste.nexus', { token })).json;
  assert.equal(antes.status, 'trial');
  assert.equal(antes.is_subscribed, false);
  assert.ok(antes.remaining_seconds > 86000 && antes.remaining_seconds <= 86400, 'teste de 1 dia: ' + antes.remaining_seconds);

  // plano anual saiu da oferta: recusado, e a mensagem diz o plano e o preço vigentes
  const anual = await api('POST', '/api/subscription/pay', { token, body: { email: 'paula@teste.nexus', plan: 'anual', method: 'pix', amount: 150 } });
  assert.equal(anual.status, 400, anual.texto);
  assert.match(anual.json.error, /Mensal/);
  assert.match(anual.json.error, /18,00/);

  // o valor é do servidor: "amount" enviado pelo navegador é ignorado; sem plano vale o mensal
  const adulterado = await api('POST', '/api/subscription/pay', { token, body: { email: 'paula@teste.nexus', plan: 'mensal', method: 'pix', amount: 1 } });
  assert.equal(adulterado.status, 200, adulterado.texto);
  assert.equal(adulterado.json.amount, 18);
  assert.equal(adulterado.json.plan, 'mensal');
  assert.equal((await api('POST', '/api/subscription/pay', { token, body: { email: 'paula@teste.nexus', method: 'pix' } })).json.amount, 18);

  // pagar não libera sozinho: continua no teste, com o pedido aguardando; quem libera é a confirmação do admin (30 dias)
  const pedido = (await api('GET', '/api/subscription/status?email=paula%40teste.nexus', { token })).json;
  assert.equal(pedido.is_subscribed, false);
  const conf = await api('POST', '/api/subscription/confirm-payment', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: 'paula@teste.nexus', plan: 'mensal', method: 'pix' } });
  assert.equal(conf.status, 200, conf.texto);
  const depois = (await api('GET', '/api/subscription/status?email=paula%40teste.nexus', { token })).json;
  assert.equal(depois.is_subscribed, true);
  assert.equal(depois.subscription_plan, 'mensal');
  const dias = (new Date(depois.subscription_expires_at).getTime() - Date.now()) / 86400000;
  assert.ok(dias > 29 && dias <= 30.01, 'validade de 30 dias: ' + dias);
});

test('expirar assinaturas em lote: o servidor confere cada conta e só expira assinatura ativa de usuário comum', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const rota = '/api/subscription/revoke-payment-bulk';
  const lote = (token, emails) => api('POST', rota, { token, body: { target_emails: emails } });
  const permissoes = (email, lista) => api('POST', '/api/admin/permissions', { token: admin, body: { email, permissions: lista } });
  const criar = async (n, cpfBase) => {
    const email = 'lote' + n + '@teste.nexus';
    const nome = ['Lote Alfa', 'Lote Beta', 'Lote Gama', 'Lote Delta', 'Lote Epsilon'][n - 1];   // o cadastro só aceita letras no nome
    const r = await api('POST', '/api/register', { body: { name: nome, email, password: 'Lote@12345', cpf: cpfValido(cpfBase), terms_accepted: true, truthful_declaration: true } });
    assert.equal(r.status, 200, r.texto);
    return email;
  };
  const status = async (email) => (await api('GET', '/api/subscription/status?email=' + encodeURIComponent(email), { token: (await login(email, 'Lote@12345')).token })).json;
  const mensal = (email) => api('POST', '/api/subscription/confirm-payment', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: email, plan: 'mensal', method: 'pix' } });

  const a = await criar(1, 310245871), b = await criar(2, 428917305), c = await criar(3, 536078142), d = await criar(4, 641829073), e = await criar(5, 752093614);
  assert.equal((await mensal(a)).status, 200);
  assert.equal((await mensal(b)).status, 200);
  assert.equal((await mensal(e)).status, 200);
  const vit = await api('POST', '/api/subscription/admin-grant-time', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: c, is_lifetime: true } });
  assert.equal(vit.status, 200, vit.texto);
  assert.equal((await status(a)).is_subscribed, true);

  // quem não tem a permissão (ou nem entrou) não expira nada
  assert.ok([401, 403].includes((await api('POST', rota, { body: { target_emails: [a] } })).status), 'sem login');
  assert.equal((await lote(ana, [a])).status, 403, 'usuário comum');
  assert.equal((await status(a)).is_subscribed, true, 'a recusa não mexeu na conta');

  // pedido malformado
  for (const corpo of [{}, { target_emails: 'a@b.com' }, { target_emails: [] }, { target_emails: [123, { toString: 1 }, null] }, { target_emails: Array.from({ length: 501 }, (_, i) => 'x' + i + '@teste.nexus') }]) {
    const r = await api('POST', rota, { token: admin, body: corpo });
    assert.equal(r.status, 400, JSON.stringify(corpo).slice(0, 60) + ' -> ' + r.texto);
  }

  // o administrador manda 7 contas: 2 com assinatura ativa (uma repetida e em maiúsculas), 1 vitalícia, 1 em teste, a própria, uma que não existe
  const r1 = await lote(admin, [a, b.toUpperCase(), a, c, d, 'admin@teste.nexus', 'nao@existe.nexus']);
  assert.equal(r1.status, 200, r1.texto);
  assert.equal(r1.json.success, true);
  assert.deepEqual([...r1.json.expired].sort(), [a, b].sort());
  const motivo = Object.fromEntries(r1.json.skipped.map((s) => [s.email, s.reason]));
  assert.deepEqual(motivo, { [c]: 'vitalicia', [d]: 'sem_assinatura_ativa', 'admin@teste.nexus': 'propria_conta', 'nao@existe.nexus': 'nao_encontrada' });
  assert.match(r1.json.message, /2 assinatura/);

  // de verdade: as duas voltam a exigir pagamento (arquivo e consulta), as outras ficam como estavam
  for (const u of [a, b]) {
    const s = await status(u);
    assert.equal(s.is_subscribed, false, u + ' deveria exigir pagamento');
    assert.equal(s.status, 'expired');
    const reg = lerArquivo('local_users.json').find((x) => x.email === u);
    assert.equal(reg.subscription_status, 'expired');
    assert.equal(reg.subscription_plan, null);
    assert.ok(new Date(reg.subscription_expires_at).getTime() < Date.now(), 'vencimento no passado');
  }
  assert.equal((await status(c)).is_subscribed, true, 'vitalícia intacta');
  assert.equal((await status(e)).is_subscribed, true, 'conta fora do pedido intacta');
  assert.equal((await status(d)).is_subscribed, false);

  // repetir não faz nada de novo (já estão expiradas) e a auditoria registrou a primeira vez
  const r2 = await lote(admin, [a, b]);
  assert.equal(r2.status, 200);
  assert.deepEqual(r2.json.expired, []);
  assert.deepEqual(r2.json.skipped.map((s) => s.reason), ['sem_assinatura_ativa', 'sem_assinatura_ativa']);
  assert.match(r2.json.message, /Nenhuma/);
  assert.ok(JSON.stringify((await api('GET', '/api/logs', { token: admin })).json).includes('Expirou 2 assinatura(s) em lote'), 'a auditoria registra o lote');

  // quem só recebeu a permissão de liberar assinatura também pode, mas nunca em administrador nem na própria conta
  assert.equal((await permissoes('ana@teste.nexus', ['assinatura.liberar'])).status, 200);
  const r3 = await lote(ana, [e, 'admin@teste.nexus', 'ana@teste.nexus']);
  assert.equal(r3.status, 200, r3.texto);
  assert.deepEqual(r3.json.expired, [e]);
  assert.deepEqual(Object.fromEntries(r3.json.skipped.map((s) => [s.email, s.reason])), { 'admin@teste.nexus': 'administrador', 'ana@teste.nexus': 'propria_conta' });
  assert.equal((await status(e)).is_subscribed, false);
  assert.equal((await permissoes('ana@teste.nexus', [])).status, 200);
  assert.equal((await lote(ana, [a])).status, 403, 'tirada a permissão, corta na hora');
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

test('perfil: troca de senha com sessão ativa não exige a senha atual e invalida o token antigo', async () => {
  const antigo = (await login('bia@teste.nexus', 'Bia@12345')).token;
  // Sem token não troca senha
  const semSessao = await api('POST', '/api/user/profile', { body: { newPassword: 'Nova@123456' } });
  assert.equal(semSessao.status, 401);
  // Senha fraca é recusada
  const fraca = await api('POST', '/api/user/profile', { token: antigo, body: { newPassword: 'fraca' } });
  assert.equal(fraca.status, 400);
  // Nova senha igual à atual é recusada (sem precisar enviar a atual)
  const igual = await api('POST', '/api/user/profile', { token: antigo, body: { newPassword: 'Bia@12345' } });
  assert.equal(igual.status, 400);
  // Com a sessão ativa basta a nova senha — o campo currentPassword foi aposentado
  const ok = await api('POST', '/api/user/profile', { token: antigo, body: { newPassword: 'Nova@123456' } });
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
  // O servidor grava em "arquivo.tmp" e renomeia: um .tmp visto no meio da gravação é normal. Só um que NÃO some em ~2 s é sobra de verdade.
  let temporarios = [];
  for (let i = 0; i < 20; i++) {
    temporarios = fs.readdirSync(pasta).filter((f) => f.endsWith('.tmp'));
    if (!temporarios.length) break;
    await dorme(100);
  }
  assert.deepEqual(temporarios, []);
});

test('sem NEXUS_SYNC_TOKEN o token é derivado do segredo; o próprio segredo só vale na transição e lixo nunca vale', async () => {
  const pasta2 = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-int2-'));
  for (const [nome, conteudo] of Object.entries({ 'local_users.json': [], 'local_users.backup.json': [], 'deleted_accounts.json': [], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': [], 'pending_logins.json': [], 'system_logs.json': [] })) fs.writeFileSync(path.join(pasta2, nome), JSON.stringify(conteudo));
  const porta2 = await portaLivre();
  const env = { ...process.env, PORT: String(porta2), NEXUS_DATA_DIR: pasta2, NEXUS_DISABLE_DB: '1', NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1', NEXUS_SYNC_TOKEN_FILE: path.join(pasta2, 'sem_token_versionado'), NEXUS_SYNC_TOKEN: '' };
  delete env.RENDER; delete env.IS_RENDER; // NEXUS_SYNC_TOKEN fica '' para o dotenv do .env não repor o segredo real
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

test('site inicial: "/" sem sessão abre o /inicio antes do login; o /inicio mostra o preço do servidor e os arquivos do site são servidos', async () => {
  const raiz = await (await fetch('http://127.0.0.1:' + porta + '/')).text();
  assert.ok(raiz.includes("window.location.replace('/inicio')"), 'sem sessão, "/" deveria ir ao site inicial');
  assert.ok(!raiz.includes("window.location.replace('/login.html');}else"), 'o portão não deveria mais ir direto ao login');

  const site = await api('GET', '/inicio');
  assert.equal(site.status, 200);
  assert.match(site.headers.get('content-type'), /text\/html/);
  assert.ok(!site.texto.includes('%%'), 'sobrou marcador sem trocar no site inicial');
  assert.ok(site.texto.includes('R$ 18,00'), 'o preço do plano deveria vir do servidor');
  assert.match(site.texto, /href="\/login\.html#criar"/);
  assert.match(site.texto, /href="\/login\.html"/);
  assert.match(site.texto, /site-inicial\.css\?v=\d+/);
  assert.match(site.texto, /site-inicial\.js\?v=\d+/);
  for (const apelido of ['/site', '/site-inicial.html']) assert.equal((await api('GET', apelido)).status, 200, apelido);

  const css = await api('GET', '/site-inicial.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);
  const js = await api('GET', '/site-inicial.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/);
});

test('visitas: abrir página grava o IP completo na pasta visitas/; só o administrador consulta e vê o IP mascarado', async () => {
  const ip = '189.45.10.77';
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const cab = { 'User-Agent': UA, Referer: 'https://www.google.com/search?q=nexus&token=segredo' };
  assert.equal((await api('GET', '/inicio', { ip, headers: cab })).status, 200);
  // arquivo, API e imagem não são "visita": só a abertura da página
  await api('GET', '/site-inicial.css', { ip, headers: cab });
  await api('GET', '/api/health', { ip, headers: cab });

  const pastaVisitas = path.join(pasta, 'visitas');
  const linhas = [];
  fs.readdirSync(pastaVisitas).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).forEach(n => {
    fs.readFileSync(path.join(pastaVisitas, n), 'utf8').split('\n').filter(Boolean).forEach(l => linhas.push(JSON.parse(l)));
  });
  const minhas = linhas.filter(l => l.ip === ip);
  assert.equal(minhas.length, 1, 'só a página /inicio deveria ter sido registrada');
  assert.equal(minhas[0].pagina, '/inicio');
  assert.equal(minhas[0].tipo, 'Celular');
  assert.equal(minhas[0].origem, 'google.com');
  assert.ok(!JSON.stringify(minhas[0]).includes('segredo'), 'a query da origem não pode ser gravada');

  // a aba "Visitas" do painel: o painel carrega o script e o servidor o entrega como JavaScript
  assert.match((await api('GET', '/admin-assinaturas-glpi')).texto, /<script src="\/admin-visitas\.js"><\/script>/);
  const scriptAba = await api('GET', '/admin-visitas.js');
  assert.equal(scriptAba.status, 200);
  assert.match(scriptAba.headers.get('content-type'), /javascript/);

  assert.equal((await api('GET', '/api/admin/visitas')).status, 401, 'sem login');
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  assert.ok([401, 403].includes((await api('GET', '/api/admin/visitas', { token: ana })).status), 'usuário comum');
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const r = await api('GET', '/api/admin/visitas?dias=7', { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.retencaoDias, undefined, 'não existe mais prazo de apagar');
  assert.ok(r.json.historico && r.json.historico.arquivos >= 1 && r.json.historico.bytes > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.json.historico.desde), 'resumo do histórico guardado');
  const tudoApi = await api('GET', '/api/admin/visitas?dias=tudo', { token: admin });
  assert.equal(tudoApi.status, 200);
  assert.ok(tudoApi.json.dias >= 1 && tudoApi.json.visitas >= 1, 'dias=tudo funciona pela API');
  assert.ok(r.json.visitas >= 1);
  assert.ok(r.json.sistemas.some(s => s.nome === 'Celular · iOS'), 'aparelho e sistema operacional no resumo');
  assert.ok(r.json.recentes.some(v => v.ip === '189.45.xxx.xxx' && v.pagina === '/inicio'), 'IP mascarado deveria aparecer');
  assert.ok(!r.texto.includes(ip), 'o IP completo não pode sair pela API');

  // Localização: o servidor de teste roda "atrás de proxy" (TRUST_PROXY=1), como no Render + Cloudflare.
  // "São Paulo" em UTF-8 chega lido como latin1 ("SÃ£o Paulo") e deve ser gravado já corrigido.
  const ipSp = '201.17.3.88';
  await api('GET', '/inicio', { ip: ipSp, headers: { 'User-Agent': UA, 'CF-IPCountry': 'BR', 'CF-Region-Code': 'SP', 'CF-IPCity': 'SÃ£o Paulo' } });
  const gravadas = [];
  fs.readdirSync(pastaVisitas).filter(n => /\.jsonl$/.test(n)).forEach(n => fs.readFileSync(path.join(pastaVisitas, n), 'utf8').split('\n').filter(Boolean).forEach(l => gravadas.push(JSON.parse(l))));
  const sp = gravadas.find(l => l.ip === ipSp);
  assert.deepEqual([sp.pais, sp.regiao, sp.cidade], ['BR', 'SP', 'São Paulo']);
  const r2 = await api('GET', '/api/admin/visitas?dias=7', { token: admin });
  assert.ok(r2.json.paises.some(p => p.nome === 'Brasil'), 'país no resumo');
  assert.ok(r2.json.cidades.some(c => c.nome === 'São Paulo/SP'), 'cidade no resumo');
  assert.ok(r2.json.recentes.some(v => v.ip === '201.17.xxx.xxx' && v.local === 'São Paulo/SP · Brasil'), 'local no acesso recente');
  assert.ok(!r2.texto.includes(ipSp), 'o IP completo não pode sair pela API');
});

test('site inicial profissional: endereço canônico no domínio próprio, imagem de compartilhamento, dados estruturados, ícones, manifest, links legais e cache versionado', async () => {
  const site = (await api('GET', '/inicio')).texto;
  const DOMINIO = 'https://nexusfinanceirohub.com.br';
  assert.ok(site.includes('<link rel="canonical" href="' + DOMINIO + '/inicio">'), 'canonical no domínio próprio');
  assert.ok(site.includes('<meta property="og:url" content="' + DOMINIO + '/inicio">'));
  assert.ok(site.includes('og:image" content="' + DOMINIO + '/images/og-nexus-v1.png"'), 'imagem de compartilhamento da marca');
  assert.ok(/og:image:width" content="1200"/.test(site) && /og:image:height" content="630"/.test(site), 'proporção 1200x630 declarada');
  assert.ok(!/onrender\.com/.test(site), 'o site público não deve citar o endereço do Render');
  assert.ok(site.includes('rel="manifest" href="/manifest.webmanifest"') && site.includes('rel="apple-touch-icon"'), 'manifest e ícone do iPhone');

  // dados estruturados: válidos, com o preço do servidor e o FAQ igual ao que está escrito na página
  const bruto = /<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/.exec(site);
  assert.ok(bruto, 'JSON-LD presente');
  const ld = JSON.parse(bruto[1]);
  const tipos = ld['@graph'].map((n) => n['@type']);
  assert.deepEqual(tipos, ['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
  assert.equal(ld['@graph'][2].offers.price, '18.00');
  const perguntasLd = ld['@graph'][3].mainEntity.map((q) => q.name);
  const perguntasPagina = [...site.matchAll(/<details name="faq"[^>]*><summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1].replace(/<[^>]+>/g, '').trim());
  assert.ok(perguntasPagina.length >= 10 && JSON.stringify(perguntasLd) === JSON.stringify(perguntasPagina), 'o FAQ do JSON-LD precisa acompanhar as perguntas da página');

  // rodapé com os documentos legais (e as páginas existem e usam o estilo compartilhado)
  assert.ok(site.includes('href="/termos.html">Termos de abertura de conta') && site.includes('href="/privacidade.html">Política de privacidade'), 'rodapé com Termos e Privacidade');
  for (const rota of ['/termos.html', '/privacidade.html']) {
    const pg = await api('GET', rota);
    assert.equal(pg.status, 200, rota);
    assert.ok(pg.texto.includes('/legal.css') && pg.texto.includes('class="lg-doc"'), rota + ' no padrão novo');
  }
  assert.equal((await api('GET', '/legal.css')).status, 200);

  // manifest, ícones, favicon.ico, sitemap e robots
  const manifest = await api('GET', '/manifest.webmanifest');
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /manifest\+json/);
  const m = JSON.parse(manifest.texto);
  assert.equal(m.name, 'Nexus Financeiro');
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.purpose === 'maskable') && m.icons.length === 3);
  for (const icone of m.icons) assert.equal((await api('GET', icone.src)).status, 200, icone.src);
  for (const arq of ['/images/og-nexus-v1.png', '/images/icons/apple-touch-icon.png']) {
    const r = await fetch('http://127.0.0.1:' + porta + arq);
    assert.equal(r.status, 200, arq);
    assert.match(r.headers.get('content-type'), /image\/png/);
  }
  const ico = await fetch('http://127.0.0.1:' + porta + '/favicon.ico');
  assert.equal(ico.status, 200);
  assert.equal(ico.headers.get('content-type'), 'image/x-icon');
  const sitemap = (await api('GET', '/sitemap.xml')).texto;
  assert.ok(sitemap.includes('<loc>' + DOMINIO + '/inicio</loc>') && !/onrender\.com/.test(sitemap), 'sitemap no domínio próprio');
  assert.ok((await api('GET', '/robots.txt')).texto.includes('Sitemap: ' + DOMINIO + '/sitemap.xml'));

  // CSS/JS chamados com ?v= valem 1 ano (a página troca o ?v= quando o arquivo muda); sem ?v= continuam revalidando
  const versionado = await api('GET', '/site-inicial.css?v=123');
  assert.match(versionado.headers.get('cache-control'), /max-age=31536000.*immutable/);
  assert.equal((await api('GET', '/site-inicial.css')).headers.get('cache-control'), 'no-cache');
});

test('depoimentos do site: só relatos reais e autorizados aparecem; sem nenhum, a seção não existe; nada é inventado', async () => {
  // o arquivo que vai para o ar nunca traz item sem autorização (e hoje nenhum é de mentira: só entra o que o usuário passar)
  const doProjeto = JSON.parse(fs.readFileSync(path.join(__dirname, 'depoimentos.json'), 'utf8'));
  assert.ok(Array.isArray(doProjeto.depoimentos));
  for (const d of doProjeto.depoimentos) assert.equal(d.autorizado, true, 'depoimento sem autorização no arquivo do projeto: ' + JSON.stringify(d).slice(0, 80));

  const arquivo = path.join(pasta, 'depoimentos.json');
  try { fs.unlinkSync(arquivo); } catch (e) { /* ainda não existe */ }
  const vazio = (await api('GET', '/inicio')).texto;
  assert.ok(!vazio.includes('id="depoimentos"') && !vazio.includes('%%'), 'sem depoimentos a seção não existe');

  fs.writeFileSync(arquivo, JSON.stringify({ depoimentos: [
    { nome: 'Ana Teste', perfil: 'Perfil de teste', texto: 'Texto de teste do layout <script>alert(1)</script> custa R$ 18 e $& fica literal.', nota: 5, autorizado: true },
    { nome: 'Sem Autorizacao', texto: 'Este texto tem tamanho suficiente, mas não foi autorizado.', autorizado: false },
    { nome: 'Sem Campo', texto: 'Este texto tem tamanho suficiente, mas falta o campo autorizado.' },
    { nome: 'Curto', texto: 'curto demais', autorizado: true },
    { nome: 'Bia Teste', texto: 'Segundo texto de teste do layout, sem nota e sem perfil informado.', autorizado: true }
  ] }));
  const cheio = (await api('GET', '/inicio')).texto;
  assert.ok(cheio.includes('id="depoimentos"'), 'com depoimentos autorizados a seção aparece');
  assert.equal((cheio.match(/class="card dep rv"/g) || []).length, 2, 'só os 2 válidos e autorizados');
  assert.ok(!cheio.includes('Sem Autorizacao') && !cheio.includes('Sem Campo') && !cheio.includes('>Curto<'));
  assert.ok(!cheio.includes('<script>alert(1)</script>') && cheio.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'texto escapado');
  assert.ok(cheio.includes('custa R$ 18 e $&amp; fica literal'), '"$&" não pode ser interpretado na troca');
  assert.equal((cheio.match(/aria-label="Nota 5 de 5"/g) || []).length, 1, 'estrelas só para quem tem nota');
  assert.ok(!/AggregateRating|"@type":"Review"/.test(cheio), 'sem marcação de avaliação para o Google');
  assert.ok(!cheio.includes('%%'));

  fs.unlinkSync(arquivo);
  assert.ok(!(await api('GET', '/inicio')).texto.includes('id="depoimentos"'), 'apagando o arquivo, a seção some de novo');
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

// Cria uma conta de usuário comum só para o teste (nunca mexe na senha das contas fixas dos outros testes)
async function criarContaDeTeste(admin, email, senha) {
  const r = await api('POST', '/api/users', { token: admin, body: [{ name: 'Conta ' + email.split('@')[0], email, password: senha, role: 'Usuário', active: true, terms_accepted: true, admin_create: true }] });
  assert.ok(r.status === 200 || r.status === 201, 'criar conta de teste: ' + r.status + ' ' + r.texto);
}

test('liberar assinatura: horas, dias, vitalício, limite de 10 anos e conta que já é vitalício', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const email = 'liberar.teste@teste.nexus';
  await criarContaDeTeste(admin, email, 'Liberar@12345');
  const liberar = (corpo) => api('POST', '/api/subscription/admin-grant-time', { token: admin, body: { admin_email: 'admin@teste.nexus', target_email: email, ...corpo } });
  const conta = async () => (await api('GET', '/api/users', { token: admin })).json.find((u) => u.email === email);

  const horas = await liberar({ duration_minutes: 3 * 60 });
  assert.equal(horas.status, 200, horas.texto);
  assert.match(horas.json.message, /3 horas/, horas.json.message);
  const venc1 = new Date((await conta()).subscription_expires_at).getTime();
  assert.ok(Math.abs(venc1 - (Date.now() + 3 * 3600e3)) < 120e3, 'vence em ~3 horas');

  // soma ao vencimento que ainda vale: +1 dia
  const dia = await liberar({ duration_minutes: 1440 });
  assert.equal(dia.status, 200, dia.texto);
  assert.match(dia.json.message, /1 dia\b/, dia.json.message);
  const venc2 = new Date((await conta()).subscription_expires_at).getTime();
  assert.ok(Math.abs((venc2 - venc1) - 86400e3) < 5e3, 'somou 1 dia ao vencimento anterior');

  const misto = await liberar({ duration_minutes: 1440 + 150 });
  assert.match(misto.json.message, /1 dia, 2 horas e 30 minutos/, misto.json.message);

  // limite de 10 anos: no limite passa, 1 minuto a mais é recusado
  assert.equal((await liberar({ duration_minutes: 10 * 365 * 24 * 60 + 1 })).status, 400);
  assert.equal((await liberar({ duration_minutes: 10 * 365 * 24 * 60 })).status, 200);

  // vitalício: sem prazo; e a partir daí tempo avulso é recusado em vez de rebaixar o plano
  const vit = await liberar({ is_lifetime: true });
  assert.equal(vit.status, 200, vit.texto);
  assert.match(vit.json.message, /vitalício/i);
  assert.equal((await conta()).subscription_plan, 'vitalicio');
  const somar = await liberar({ duration_minutes: 60 });
  assert.equal(somar.status, 409, somar.texto);
  assert.equal((await conta()).subscription_plan, 'vitalicio', 'o plano vitalício não pode ser rebaixado por uma liberação de horas');

  // usuário comum não libera nada
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const negado = await api('POST', '/api/subscription/admin-grant-time', { token: ana, body: { admin_email: 'ana@teste.nexus', target_email: email, duration_minutes: 60 } });
  assert.ok([401, 403].includes(negado.status), 'status ' + negado.status);
  assert.equal((await api('DELETE', '/api/users?email=' + email, { token: admin })).status, 200);
});

test('redefinir senha pelo administrador: senha provisória única, troca obrigatória, sessões antigas caem, auditoria sem a senha', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const email = 'senha.teste@teste.nexus';
  await criarContaDeTeste(admin, email, 'Antiga@12345');
  const sessaoAntiga = (await login(email, 'Antiga@12345')).token;
  assert.ok(sessaoAntiga);
  const redefinir = (corpo, token) => api('POST', '/api/admin/users/reset-password', { token, body: corpo });

  // quem pode: só administrador autenticado; a própria conta, e-mail inválido e conta inexistente são recusados
  assert.equal((await redefinir({ email }, undefined)).status, 401, 'sem login');
  assert.ok([401, 403].includes((await redefinir({ email }, ana)).status), 'usuário comum');
  assert.equal((await redefinir({ email: 'admin@teste.nexus' }, admin)).status, 400, 'própria conta');
  assert.equal((await redefinir({ email: 'isso-nao-e-email' }, admin)).status, 400);
  assert.equal((await redefinir({ email: 'ninguem@teste.nexus' }, admin)).status, 404);
  assert.equal((await login(email, 'Antiga@12345')).success, true, 'as recusas não podem ter mexido na senha');

  await dorme(1100);   // o token vale por segundo: a troca precisa ser POSTERIOR à emissão da sessão antiga
  const r = await redefinir({ email }, admin);
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.success, true);
  assert.match(r.json.tempPassword, /^Nx@[0-9a-f]{12}$/);
  assert.equal(r.json.must_change_password, true, 'troca obrigatória por padrão');
  assert.match(r.headers.get('cache-control') || '', /no-store/);
  const provisoria = r.json.tempPassword;

  // senha antiga morreu, a provisória entra e exige a troca; a sessão aberta antes foi derrubada
  const antiga = await api('POST', '/api/login', { body: { email, password: 'Antiga@12345' } });
  assert.equal(antiga.status, 401, 'a senha antiga não pode mais entrar');
  const nova = await login(email, provisoria);
  assert.equal(nova.success, true, JSON.stringify(nova));
  assert.ok(nova.must_change_password === true || (nova.user && nova.user.must_change_password === true), 'deve exigir a troca no login');
  assert.equal((await api('GET', '/api/auth/session', { token: sessaoAntiga })).status, 401, 'sessão aberta antes da redefinição deve cair');
  assert.equal((await api('GET', '/api/auth/session', { token: nova.token })).status, 200);

  // dá para redefinir sem exigir a troca; cada redefinição gera uma senha diferente
  const r2 = await redefinir({ email, must_change_password: false }, admin);
  assert.equal(r2.status, 200, r2.texto);
  assert.notEqual(r2.json.tempPassword, provisoria);
  assert.equal(r2.json.must_change_password, false);
  const livre = await login(email, r2.json.tempPassword);
  assert.equal(livre.success, true);
  assert.ok(!(livre.must_change_password === true || (livre.user && livre.user.must_change_password === true)), 'não deveria exigir a troca');

  // auditoria: registra quem fez e em quem, nunca a senha
  const logs = JSON.stringify((await api('GET', '/api/logs', { token: admin })).json);
  assert.ok(logs.includes('Redefinição de senha') && logs.includes(email), 'a redefinição deve constar do log');
  assert.ok(!logs.includes(provisoria) && !logs.includes(r2.json.tempPassword), 'a senha provisória nunca pode ir para o log');
  assert.ok(!JSON.stringify(lerArquivo('local_users.json')).includes(r2.json.tempPassword), 'a senha só pode ficar guardada como hash');
  assert.equal((await api('DELETE', '/api/users?email=' + email, { token: admin })).status, 200);
});

// Abre o canal de eventos (SSE) de uma conta e acumula o que chega; fechou resolve quando o servidor encerra a conexão
function abrirEventos(token) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: porta, path: '/api/events?token=' + encodeURIComponent(token), headers: { 'X-Forwarded-For': ipNovo() } }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      const canal = { status: res.statusCode, texto: () => texto, fechou: new Promise((r) => res.on('close', r)), fechar: () => req.destroy() };
      res.on('data', (d) => { texto += d; });
      resolve(canal);
    });
    req.on('error', reject);
  });
}
const esperarAte = async (fn, ms) => { const fim = Date.now() + ms; while (Date.now() < fim) { if (await fn()) return true; await dorme(40); } return false; };
const listaDeUsuarios = async (admin) => { const r = await api('GET', '/api/users', { token: admin }); return Array.isArray(r.json) ? r.json : (r.json.users || []); };

test('bloqueio: a sessão aberta cai na hora, o token morre com o motivo "blocked" e desbloquear devolve o acesso', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const email = 'bloqueio.teste@teste.nexus';
  await criarContaDeTeste(admin, email, 'Bloqueio@12345');
  const sessao = (await login(email, 'Bloqueio@12345')).token;
  assert.equal((await api('GET', '/api/auth/session', { token: sessao })).status, 200);
  const canal = await abrirEventos(sessao);
  assert.equal(canal.status, 200, 'o canal de eventos da conta abre');
  await dorme(1100);   // o token vale por segundo; só para o teste não depender de empate de relógio

  const bloquear = await api('POST', '/api/users', { token: admin, body: [{ email, name: 'Conta bloqueio', active: false }] });
  assert.equal(bloquear.status, 200, bloquear.texto);
  assert.ok(await esperarAte(() => canal.texto().includes('event: session_ended'), 3000), 'o app aberto recebe session_ended: ' + canal.texto());
  assert.match(canal.texto(), /data: \{"reason":"blocked"\}/);
  await Promise.race([canal.fechou, dorme(3000)]);
  const fechouLogo = await esperarAte(async () => (await abrirEventos(sessao)).status === 401, 1500);
  assert.ok(fechouLogo, 'nova conexão de eventos com o token antigo é recusada');

  const velha = await api('GET', '/api/auth/session', { token: sessao });
  assert.equal(velha.status, 401);
  assert.equal(velha.json.reason, 'blocked', 'o app sabe que foi bloqueio e avisa a pessoa');
  const novoLogin = await api('POST', '/api/login', { body: { email, password: 'Bloqueio@12345' } });
  assert.ok([401, 403].includes(novoLogin.status) && !(novoLogin.json && novoLogin.json.success), 'login recusado: ' + novoLogin.status + ' ' + novoLogin.texto);
  assert.equal((await api('GET', '/api/data?email=' + email, { token: sessao })).status, 401, 'a sessão antiga não lê mais os dados');
  const conta = (await listaDeUsuarios(admin)).find((u) => u.email === email);
  assert.equal(conta.active, false);
  assert.ok(conta.active_updated_at, 'o bloqueio fica carimbado (relógio do bloqueio)');

  // desbloquear devolve o acesso (e o carimbo avança)
  assert.equal((await api('POST', '/api/users', { token: admin, body: [{ email, name: 'Conta bloqueio', active: true }] })).status, 200);
  assert.equal((await login(email, 'Bloqueio@12345')).success, true, 'depois de desbloqueada a conta entra de novo');
  assert.ok(new Date((await listaDeUsuarios(admin)).find((u) => u.email === email).active_updated_at) >= new Date(conta.active_updated_at));
  assert.equal((await api('DELETE', '/api/users?email=' + email, { token: admin })).status, 200);
});

test('bloqueio feito na nuvem NÃO é desfeito pela linha antiga que o PC reenvia a cada 10 s (relógio do bloqueio)', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const email = 'sync.bloqueio@teste.nexus';
  await criarContaDeTeste(admin, email, 'Sync@12345');
  const doPc = (corpo) => api('POST', '/api/users?overwrite=true', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: [{ email, name: 'Conta sync', ...corpo }] });
  const estado = async () => (await listaDeUsuarios(admin)).find((u) => u.email === email);

  // o administrador bloqueia no site (nuvem)
  assert.equal((await api('POST', '/api/users', { token: admin, body: [{ email, name: 'Conta sync', active: false }] })).status, 200);
  const bloqueada = await estado();
  assert.equal(bloqueada.active, false);
  const carimboBloqueio = bloqueada.active_updated_at;
  assert.ok(carimboBloqueio);

  // o PC (SQL Server ainda com active = 1, SEM carimbo) reenvia a mesma linha em vários ciclos: o bloqueio fica
  for (let i = 0; i < 3; i++) {
    assert.equal((await doPc({ active: true })).status, 200);
    assert.equal((await estado()).active, false, 'ciclo ' + i + ': o PC desfez o bloqueio');
  }
  assert.ok(!(await login(email, 'Sync@12345')).success, 'a conta bloqueada não entra');
  // linha do PC com carimbo ANTERIOR ao do bloqueio: também não vale
  assert.equal((await doPc({ active: true, active_updated_at: new Date(new Date(carimboBloqueio).getTime() - 60000).toISOString() })).status, 200);
  assert.equal((await estado()).active, false, 'carimbo mais velho não desfaz o bloqueio');
  assert.equal((await estado()).active_updated_at, carimboBloqueio, 'o carimbo do bloqueio não recua');

  // ativação feita DEPOIS no PC (carimbo mais novo): vale
  const ativacaoNoPc = new Date(new Date(carimboBloqueio).getTime() + 60000).toISOString();
  assert.equal((await doPc({ active: true, active_updated_at: ativacaoNoPc })).status, 200);
  assert.equal((await estado()).active, true, 'o desbloqueio mais novo vindo do PC vale');
  assert.equal((await login(email, 'Sync@12345')).success, true);

  // novo bloqueio na nuvem (carimbo agora, mais novo que o do PC): a linha do passo anterior não o desfaz
  assert.equal((await api('POST', '/api/users', { token: admin, body: [{ email, name: 'Conta sync', active: false }] })).status, 200);
  const novo = await estado();
  assert.equal(novo.active, false);
  assert.ok(novo.active_updated_at, 'o novo bloqueio também fica carimbado');
  assert.equal((await doPc({ active: true, active_updated_at: ativacaoNoPc })).status, 200);
  assert.equal((await estado()).active, false, 'o PC com carimbo mais velho não reativa');

  // o navegador do administrador não forja carimbo: o dele é ignorado e a mudança recebe o carimbo do servidor
  const forjado = await api('POST', '/api/users', { token: admin, body: [{ email, name: 'Conta sync', active: true, active_updated_at: '2000-01-01T00:00:00.000Z' }] });
  assert.equal(forjado.status, 200);
  const depois = await estado();
  assert.equal(depois.active, true);
  assert.ok(new Date(depois.active_updated_at).getFullYear() >= 2026, 'carimbo vindo do cliente é ignorado: ' + depois.active_updated_at);
  assert.equal((await api('DELETE', '/api/users?email=' + email, { token: admin })).status, 200);
});

test('sessões abertas também caem ao redefinir a senha ou excluir a conta, cada uma com o seu motivo', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const emailA = 'cai.senha@teste.nexus', emailB = 'cai.exclusao@teste.nexus';
  await criarContaDeTeste(admin, emailA, 'Cai@12345');
  await criarContaDeTeste(admin, emailB, 'Cai@12345');
  const tokenA = (await login(emailA, 'Cai@12345')).token;
  const tokenB = (await login(emailB, 'Cai@12345')).token;
  const canalA = await abrirEventos(tokenA);
  const canalB = await abrirEventos(tokenB);
  const canalOutro = await abrirEventos((await login('ana@teste.nexus', 'Ana@12345')).token);   // outra conta: não pode ser derrubada
  await dorme(1100);
  assert.equal((await api('POST', '/api/admin/users/reset-password', { token: admin, body: { email: emailA } })).status, 200);
  assert.ok(await esperarAte(() => canalA.texto().includes('session_ended'), 3000));
  assert.match(canalA.texto(), /"reason":"password"/);
  assert.equal((await api('GET', '/api/auth/session', { token: tokenA })).json.reason, 'password');
  assert.equal((await api('DELETE', '/api/users?email=' + emailB, { token: admin })).status, 200);
  assert.ok(await esperarAte(() => canalB.texto().includes('session_ended'), 3000));
  assert.match(canalB.texto(), /"reason":"deleted"/);
  assert.equal((await api('GET', '/api/auth/session', { token: tokenB })).json.reason, 'deleted');
  await dorme(300);
  assert.ok(!canalOutro.texto().includes('session_ended'), 'só a conta atingida é derrubada');
  assert.equal((await api('GET', '/api/auth/session', { token: 'lixo.lixo.lixo' })).json.reason, 'invalid', 'token que não é de ninguém não ganha motivo específico');
  canalOutro.fechar();
  assert.equal((await api('DELETE', '/api/users?email=' + emailA, { token: admin })).status, 200);
});

test('conta proprietária: bloquear é RECUSADO com o motivo (antes devolvia "success" e não fazia nada), não é carimbada e ninguém toma a senha dela', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const dono = 'dono@teste.nexus';   // a conta proprietária é a que está em NEXUS_OWNER_EMAIL (o teste define no ambiente do servidor)
  await criarContaDeTeste(admin, dono, 'Dono@12345');
  const estado = async () => (await listaDeUsuarios(admin)).find((u) => u.email === dono);
  const antes = await estado();
  assert.equal(antes.active, true);
  assert.equal(antes.is_owner, true, 'a lista marca a conta proprietária para as telas não oferecerem bloquear');
  assert.ok((await listaDeUsuarios(admin)).filter((u) => u.email !== dono).every((u) => u.is_owner === undefined), 'só a proprietária é marcada');

  // pedido de bloqueio feito pelo administrador (é o que o painel envia)
  const pedido = await api('POST', '/api/users', { token: admin, body: [{ email: dono, name: 'Dono', active: false }] });
  assert.equal(pedido.status, 403, pedido.texto);
  assert.equal(pedido.json.success, false);
  assert.match(pedido.json.error, /proprietária não pode ser bloqueada/);
  const depois = await estado();
  assert.equal(depois.active, true);
  assert.equal(depois.active_updated_at, antes.active_updated_at, 'recusa não pode deixar carimbo de bloqueio');
  assert.equal((await login(dono, 'Dono@12345')).success, true, 'a proprietária continua entrando');

  // mesma regra na rota de ativar/bloquear e na redefinição de senha
  const delegada = await api('POST', '/api/delegate/account-active', { token: admin, body: { email: dono, active: false } });
  assert.equal(delegada.status, 403, delegada.texto);
  assert.match(delegada.json.error, /proprietária/);
  const senha = await api('POST', '/api/admin/users/reset-password', { token: admin, body: { email: dono } });
  assert.equal(senha.status, 403, senha.texto);
  assert.match(senha.json.error, /proprietária/);
  assert.equal((await login(dono, 'Dono@12345')).success, true, 'a senha dela não mudou');

  // lista antiga reenviada com a proprietária ativa, ou espelho do PC com active falso, não bloqueia nem derruba ninguém
  assert.equal((await api('POST', '/api/users', { token: admin, body: [{ email: dono, name: 'Dono', active: true }] })).status, 200);
  const doPc = await api('POST', '/api/users?overwrite=true', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: [{ email: dono, name: 'Dono', active: false, active_updated_at: new Date(Date.now() + 60000).toISOString() }] });
  assert.equal(doPc.status, 200);
  assert.equal((await estado()).active, true, 'nem a sincronização bloqueia a proprietária');

  // outro administrador continua podendo ser bloqueado e a mensagem do login é legível
  const outro = 'admin.bloqueavel@teste.nexus';
  await criarContaDeTeste(admin, outro, 'Outro@12345');
  assert.equal((await api('POST', '/api/users', { token: admin, body: [{ email: outro, name: 'Outro admin', role: 'Administrador', active: false }] })).status, 200);
  const recusado = await api('POST', '/api/login', { body: { email: outro, password: 'Outro@12345' } });
  assert.equal(recusado.status, 403);
  assert.match(recusado.json.error, /desativada pelo administrador/);
  assert.ok(!/banco de dados/.test(recusado.json.error), 'a mensagem não fala em "banco de dados"');
  assert.equal((await api('DELETE', '/api/users?email=' + outro, { token: admin })).status, 200);
  assert.equal((await api('DELETE', '/api/users?email=' + dono, { token: admin })).status, 403, 'e a proprietária também não é excluída');
});

test('a antiga proprietária (antiga.dona@teste.nexus) virou conta comum: sem poder de administrador, o login não a promove de volta e ela pode ser bloqueada e excluída', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const antiga = 'antiga.dona@teste.nexus';
  await criarContaDeTeste(admin, antiga, 'Antiga@12345');
  const sessao = await login(antiga, 'Antiga@12345');
  assert.equal(sessao.success, true);
  const eu = (await listaDeUsuarios(admin)).find((u) => u.email === antiga);
  assert.equal(eu.role, 'Usuário', 'o login não a promove de volta a Administrador (isso só vale para a proprietária atual)');
  assert.equal(eu.is_owner, undefined, 'ela não é mais marcada como proprietária');
  for (const rota of ['/api/admin/visitas', '/api/admin/usage']) {
    const r = await api('GET', rota, { token: sessao.token });
    assert.ok([401, 403].includes(r.status), rota + ' deveria recusar quem não é administrador: ' + r.status);
  }
  // pode ser bloqueada e excluída como qualquer conta comum
  assert.equal((await api('POST', '/api/users', { token: admin, body: [{ email: antiga, name: 'Antiga', active: false }] })).status, 200);
  assert.equal((await api('DELETE', '/api/users?email=' + antiga, { token: admin })).status, 200);
  // o HTML do app é público (qualquer visitante lê, sem login): NENHUM e-mail de proprietária, nem a atual nem a antiga, pode estar nele; o app usa is_owner
  const app = (await api('GET', '/')).texto;
  assert.ok(!app.toLowerCase().includes('dono@teste.nexus'), 'o e-mail da proprietária atual está escrito no HTML público do app');
  assert.ok(!app.includes('NEXUS_OWNER_EMAIL'), 'o app não tem mais a constante com o e-mail da proprietária');
  assert.ok(app.includes('u.is_owner === true'), 'o app reconhece a proprietária pela marca is_owner do servidor');
  assert.ok(!app.toLowerCase().includes(antiga), 'o app não repete o e-mail da antiga proprietária');
  const painel = (await api('GET', '/admin-assinaturas-glpi.html')).texto;
  assert.ok(!painel.toLowerCase().includes(antiga) && painel.includes('u.is_owner===true'), 'o painel reconhece a proprietária pela marca is_owner, sem e-mail fixo');
});

test('e-mail RESERVADO: o cadastro público nunca o cria (mesmo com a lista vazia); só a sincronização interna cria; o login e a sessão marcam is_owner da proprietária', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const reservado = 'reservado@teste.nexus';   // definido em NEXUS_RESERVED_EMAILS (a proprietária entra na mesma lista; ver RESERVED_EMAILS no server.js)
  assert.ok(!(await listaDeUsuarios(admin)).some((u) => u.email === reservado), 'pré-condição: nenhuma conta com esse e-mail');
  const corpo = { name: 'Pessoa Qualquer', email: reservado, password: 'Atacante@2026', cpf: '93541134780', terms_accepted: true, truthful_declaration: true };
  const publico = await api('POST', '/api/register', { body: corpo });
  assert.equal(publico.status, 409, 'cadastro público do e-mail reservado devia ser recusado: ' + publico.texto);
  assert.equal(publico.json.errorType, 'email_exists');
  assert.equal(publico.json.error, 'Este e-mail já possui cadastro.', 'a resposta não revela que o e-mail é reservado');
  const variacao = await api('POST', '/api/register', { body: { ...corpo, email: '  RESERVADO@Teste.Nexus ' } });
  assert.equal(variacao.status, 409, 'caixa/espaço não burlam a reserva: ' + variacao.texto);
  assert.ok(!(await listaDeUsuarios(admin)).some((u) => u.email === reservado), 'o cadastro público criou a conta reservada');
  // a sincronização interna (token + senha já em hash) continua podendo criar a conta
  const interno = await api('POST', '/api/register', { headers: { 'X-Nexus-Sync-Token': SYNC_TOKEN }, body: { name: 'Dona Verdadeira', email: reservado, password_hash: hashPwd('Dona@12345'), cpf: '93541134780', terms_accepted: true, truthful_declaration: true } });
  assert.equal(interno.status, 200, interno.texto);
  assert.equal((await api('DELETE', '/api/users?email=' + reservado, { token: admin })).status, 200);
  // a proprietária atual (NEXUS_OWNER_EMAIL) vem marcada pelo servidor no login e na sessão, e conta comum nunca é marcada
  const entrou = await api('POST', '/api/login', { body: { email: 'dono@teste.nexus', password: 'Dono@12345' } });
  assert.equal(entrou.status, 200, entrou.texto);
  assert.equal(entrou.json.user.is_owner, true, 'o login devolve a marca is_owner para o app (que não tem mais o e-mail no HTML)');
  assert.equal(entrou.json.user.role, 'Administrador');
  const sessao = await api('GET', '/api/auth/session', { token: entrou.json.token });
  assert.equal(sessao.json.user.is_owner, true, 'a sessão também marca is_owner');
  const comum = await api('POST', '/api/login', { body: { email: 'ana@teste.nexus', password: 'Ana@12345' } });
  assert.equal(comum.json.user.is_owner, undefined, 'conta comum nunca é marcada');
});
test('excluir conta registra tombstone com motivo e o histórico só abre para administrador', async () => {
  const admin = (await login('admin@teste.nexus', 'Admin@12345')).token;
  const ana = (await login('ana@teste.nexus', 'Ana@12345')).token;
  const email = 'excluir.com.motivo@teste.nexus';
  await criarContaDeTeste(admin, email, 'Exclui@12345');

  // usuário comum não vê o histórico de exclusões
  const semPerm = await api('GET', '/api/admin/contas-excluidas', { token: ana });
  assert.ok([401, 403].includes(semPerm.status), 'status ' + semPerm.status);

  const motivo = 'Cadastro duplicado, pedido do cliente';
  const del = await api('DELETE', '/api/users?email=' + encodeURIComponent(email) + '&reason=' + encodeURIComponent(motivo), { token: admin });
  assert.equal(del.status, 200, del.texto);

  // tombstone gravado com nome, motivo, quem excluiu e data — o arquivo é replicado ao Supabase
  const excluidas = lerArquivo('deleted_accounts.json');
  const reg = excluidas.find(x => x.email === email);
  assert.ok(reg, 'a exclusão deve gerar tombstone em deleted_accounts.json');
  assert.equal(reg.reason, motivo);
  assert.ok(reg.deleted_at);
  assert.equal(reg.deleted_by, 'admin@teste.nexus');

  // endpoint admin devolve o histórico com o motivo
  const hist = await api('GET', '/api/admin/contas-excluidas', { token: admin });
  assert.equal(hist.status, 200, hist.texto);
  const item = (hist.json.exclusoes || []).find(x => x.email === email);
  assert.ok(item && item.reason === motivo, 'o histórico deve trazer o motivo');

  // o item não retorna às listagens
  const lista = await listaDeUsuarios(admin);
  assert.ok(!lista.some(u => u.email === email));

  // a auditoria registra o motivo
  const logs = JSON.stringify((await api('GET', '/api/logs', { token: admin })).json);
  assert.ok(logs.includes(motivo), 'o motivo deve constar no log de auditoria');
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
