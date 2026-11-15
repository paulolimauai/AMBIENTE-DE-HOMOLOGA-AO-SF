'use strict';

/**
 * O login "puxa do banco": sobe o server.js de verdade com o Supabase LIGADO, mas apontado para um Supabase falso (HTTP local, nada de rede
 * externa) e com os pacotes do SQL Server bloqueados por um pré-carregamento só do teste (nunca toca no SQL Server real nem no Supabase real).
 * Rodar com: node --test credenciais-supabase.integration.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const JWT_SECRET = 'segredo-de-teste-' + 'x'.repeat(40);
const SYNC_TOKEN = 'token-sync-de-teste-' + 'y'.repeat(20);
const hashPwd = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return 'scrypt:' + salt + ':' + crypto.scryptSync(p, salt, 64).toString('hex'); };
const portaLivre = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const CHAVE_FALSA = b64u({ alg: 'HS256', typ: 'JWT' }) + '.' + b64u({ role: 'service_role', ref: 'teste' }) + '.assinatura';

const T_VELHO = '2026-11-10T10:00:00.000Z';
const T_NOVO = '2026-11-15T10:00:00.000Z';
const base = (id, nome, email, extra) => ({ id, name: nome, email, role: 'Usuário', active: true, cpf: null, phone: null, birth_date: '01/01/1990', terms_accepted: true, device_type: 'Computador', trial_started_at: '2026-11-08T10:00:00-03:00', subscription_status: 'trial', ...(extra || {}) });

// --- o "banco" falso: o que o Supabase guarda como cópia fiel da conta (dados_financeiros.dados)
const remoto = new Map();           // e-mail -> objeto da conta
const consultas = { dados: 0 };     // quantas vezes o servidor perguntou por UMA conta
let remotoCaido = false;
let fake, fakePorta;

function subirSupabaseFalso() {
  return new Promise((resolve) => {
    fake = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const tabela = u.pathname.replace(/^\/rest\/v1\//, '');
      req.on('data', () => {}); // descarta o corpo (as gravações do servidor são aceitas e ignoradas)
      req.on('end', () => {
        if (remotoCaido) { res.writeHead(503, { 'Content-Type': 'text/plain' }); return res.end('indisponivel'); }
        if (req.method === 'GET') {
          const eq = u.searchParams.get('email');
          let dados = [];
          if (tabela === 'dados_financeiros' && eq && eq.startsWith('eq.')) {
            consultas.dados++;
            const acc = remoto.get(eq.slice(3));
            if (acc) dados = [{ email: eq.slice(3), dados: acc }];
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          return res.end(JSON.stringify(dados));
        }
        if (req.method === 'POST') { res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(); }
        res.writeHead(204); res.end();
      });
    });
    fake.listen(0, '127.0.0.1', () => { fakePorta = fake.address().port; resolve(); });
  });
}

let proc, porta, pasta, logSaida = '', ipSeq = 80;
const ipNovo = () => '10.5.4.' + (++ipSeq);
async function api(method, rota, { token, body } = {}) {
  const h = { 'X-Forwarded-For': ipNovo() };
  if (token) h.Authorization = 'Bearer ' + token;
  let corpo; if (body !== undefined) { corpo = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + porta + rota, { method, headers: h, body: corpo });
  const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch (e) { /* não-JSON */ }
  return { status: r.status, json, texto };
}
const login = (email, password) => api('POST', '/api/login', { body: { email, password } });
const lerUsuarios = () => JSON.parse(fs.readFileSync(path.join(pasta, 'local_users.json'), 'utf8'));
const usuario = (email) => lerUsuarios().find((u) => u.email === email);

const SENHA_ANA_VELHA = 'Ana@Velha123', SENHA_ANA_NOVA = 'Ana@Nova12345';
const SENHA_BIA_VELHA = 'Bia@Velha123', SENHA_BIA_NOVA = 'Bia@Nova12345';

test.before(async () => {
  await subirSupabaseFalso();
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-credsb-'));
  // pré-carregamento só do teste: sem os pacotes do SQL Server o servidor nem tenta conectar ao banco (o Supabase segue ligado)
  const preload = path.join(pasta, 'sem-sql.js');
  fs.writeFileSync(preload, "const M=require('module');const o=M._load;M._load=function(r){if(/^(mssql|msnodesqlv8)(\\/|$)/.test(r)){const e=new Error(\"Cannot find module '\"+r+\"'\");e.code='MODULE_NOT_FOUND';throw e;}return o.apply(this,arguments);};");

  const admin = base(1, 'Admin Teste', 'admin@teste.nexus', { role: 'Administrador', password: hashPwd('Admin@12345'), subscription_status: 'active', subscription_plan: 'vitalicio' });
  // Ana: o servidor tem a senha VELHA (sem relógio); o Supabase tem a NOVA (com relógio)
  const ana = base(2, 'Ana Teste', 'ana@teste.nexus', { password: hashPwd(SENHA_ANA_VELHA) });
  // Bia: o servidor tem a NOVA (relógio novo); o Supabase ficou com a VELHA (relógio velho)
  const bia = base(3, 'Bia Teste', 'bia@teste.nexus', { password: hashPwd(SENHA_BIA_NOVA), password_changed_at: T_NOVO });
  const usuarios = [admin, ana, bia];
  remoto.set('ana@teste.nexus', { ...ana, password: hashPwd(SENHA_ANA_NOVA), password_changed_at: T_NOVO });
  remoto.set('bia@teste.nexus', { ...bia, password: hashPwd(SENHA_BIA_VELHA), password_changed_at: T_VELHO });
  // Dora: a conta só existe no Supabase (disco zerado no redeploy)
  remoto.set('dora@teste.nexus', base(4, 'Dora Teste', 'dora@teste.nexus', { password: hashPwd('Dora@12345'), password_changed_at: T_NOVO }));
  // Eva: excluída de propósito no servidor, mas ainda com cópia no Supabase
  remoto.set('eva@teste.nexus', base(5, 'Eva Teste', 'eva@teste.nexus', { password: hashPwd('Eva@12345'), password_changed_at: T_NOVO }));
  // Gil: cópia no Supabase marcada como desativada
  remoto.set('gil@teste.nexus', base(6, 'Gil Teste', 'gil@teste.nexus', { password: hashPwd('Gil@12345'), password_changed_at: T_NOVO, active: false }));

  const seed = { 'local_users.json': usuarios, 'local_users.backup.json': usuarios, 'deleted_accounts.json': [{ email: 'eva@teste.nexus', deleted_at: '2026-11-12T10:00:00.000Z' }], 'local_database_data.json': {}, 'local_database_data.backup.json': {}, 'cpf_registry.json': {}, 'cpf_registry.backup.json': {}, 'local_ordens_servico.json': [], 'local_tecnicos.json': [], 'local_filas.json': require('./atendimento').filasIniciais(), 'pending_logins.json': [], 'system_logs.json': [] };
  for (const [nome, conteudo] of Object.entries(seed)) fs.writeFileSync(path.join(pasta, nome), JSON.stringify(conteudo, null, 2));
  porta = await portaLivre();
  const env = { ...process.env, PORT: String(porta), NEXUS_DATA_DIR: pasta, NEXUS_COBRANCA_AUTO: '0', JWT_SECRET, NEXUS_SYNC_TOKEN: SYNC_TOKEN, RENDER_CLOUD_URL: 'https://127.0.0.1:9', TRUST_PROXY: '1', SUPABASE_URL: 'http://127.0.0.1:' + fakePorta, SUPABASE_SERVICE_ROLE_KEY: CHAVE_FALSA, NEXUS_SUPABASE_FILE: path.join(pasta, 'sem-arquivo-supabase') };
  delete env.RENDER; delete env.IS_RENDER; delete env.NEXUS_ALLOW_DB_RESET; delete env.NEXUS_DISABLE_DB; delete env.NEXUS_DISABLE_SUPABASE;
  proc = spawn(process.execPath, ['-r', preload, 'server.js'], { cwd: __dirname, env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => { logSaida += d.toString(); });
  proc.stderr.on('data', (d) => { logSaida += d.toString(); });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch('http://127.0.0.1:' + porta + '/api/health'); if (r.ok) break; } catch (e) { /* ainda subindo */ }
    await dorme(150);
    if (i === 99) throw new Error('servidor de teste não subiu:\n' + logSaida.slice(-1500));
  }
  assert.ok(!/Conectado com sucesso ao Microsoft SQL/.test(logSaida), 'o teste não pode tocar no SQL Server');
  assert.ok(/Gravação direta ativa/.test(logSaida), 'o Supabase (falso) precisa estar ligado neste teste:\n' + logSaida.slice(-1500));
});

test.after(async () => {
  if (proc) { proc.kill(); await dorme(200); }
  if (fake) fake.close();
  try { fs.rmSync(pasta, { recursive: true, force: true }); } catch (e) { /* o SO limpa */ }
});

test('login com a senha certa do servidor NÃO consulta o Supabase (nada de espera à toa)', async () => {
  const antes = consultas.dados;
  const r = await login('admin@teste.nexus', 'Admin@12345');
  assert.equal(r.status, 200, r.texto);
  assert.equal(consultas.dados, antes, 'consultou o Supabase sem precisar');
});

test('servidor com a senha VELHA e Supabase com a NOVA: o login puxa a nova do banco e corrige o servidor', async () => {
  const r = await login('ana@teste.nexus', SENHA_ANA_NOVA);
  assert.equal(r.status, 200, 'o login não puxou a senha do Supabase: ' + r.texto + '\n' + logSaida.slice(-600));
  assert.equal(r.json.success, true);
  const salvo = usuario('ana@teste.nexus');
  assert.equal(salvo.password_changed_at, T_NOVO, 'o relógio da troca veio junto');
  assert.ok(/CREDENCIAL\] Senha de ana@teste.nexus puxada do Supabase/.test(logSaida));
  // a partir daí o servidor já tem a senha: não precisa mais perguntar ao Supabase, e a velha deixa de valer
  const antes = consultas.dados;
  assert.equal((await login('ana@teste.nexus', SENHA_ANA_NOVA)).status, 200);
  assert.equal(consultas.dados, antes, 'voltou a consultar o Supabase com a senha já corrigida');
  assert.equal((await login('ana@teste.nexus', SENHA_ANA_VELHA)).status, 401);
});

test('conta que só existe no Supabase (disco zerado) entra e passa a existir no servidor', async () => {
  assert.equal(usuario('dora@teste.nexus'), undefined);
  const r = await login('dora@teste.nexus', 'Dora@12345');
  assert.equal(r.status, 200, r.texto);
  const salvo = usuario('dora@teste.nexus');
  assert.ok(salvo, 'a conta não foi gravada no servidor');
  assert.equal(salvo.name, 'Dora Teste');
  assert.equal(salvo.role, 'Usuário');
  assert.equal((await login('dora@teste.nexus', 'Dora@12345')).status, 200);
});

test('senha MAIS ANTIGA no Supabase nunca volta a valer', async () => {
  const velha = await login('bia@teste.nexus', SENHA_BIA_VELHA);
  assert.equal(velha.status, 401, 'a senha antiga do Supabase foi aceita');
  assert.equal(usuario('bia@teste.nexus').password_changed_at, T_NOVO, 'o servidor não pode regredir');
  assert.equal((await login('bia@teste.nexus', SENHA_BIA_NOVA)).status, 200);
});

test('conta excluída continua excluída mesmo com cópia no Supabase; e não consulta o banco', async () => {
  const antes = consultas.dados;
  const r = await login('eva@teste.nexus', 'Eva@12345');
  assert.equal(r.status, 404);
  assert.equal(consultas.dados, antes);
  assert.equal(usuario('eva@teste.nexus'), undefined);
});

test('cópia desativada no Supabase: entra no fluxo normal e é barrada como conta desativada', async () => {
  const r = await login('gil@teste.nexus', 'Gil@12345');
  assert.equal(r.status, 403, r.texto);
  assert.equal(r.json.errorType, 'user_inactive');
});

test('senha errada digitada não adota nada e o servidor continua igual', async () => {
  const antes = JSON.stringify(usuario('ana@teste.nexus'));
  const r = await login('ana@teste.nexus', 'Qualquer@Outra1');
  assert.equal(r.status, 401);
  assert.equal(JSON.stringify(usuario('ana@teste.nexus')), antes);
  assert.equal((await login('ninguem@teste.nexus', 'Qualquer@Outra1')).status, 404);
});

test('Supabase fora do ar: quem tem a senha certa no servidor entra, e a recusa continua rápida (sem travar o login)', async () => {
  remotoCaido = true;
  try {
    assert.equal((await login('admin@teste.nexus', 'Admin@12345')).status, 200);
    const t0 = Date.now();
    const r = await login('ana@teste.nexus', 'Qualquer@Outra1');
    assert.equal(r.status, 401);
    assert.ok(Date.now() - t0 < 1500, 'o login esperou o Supabase por ' + (Date.now() - t0) + ' ms');
  } finally { remotoCaido = false; }
});
