'use strict';

/**
 * Verificador de segredos (scripts/verificar_segredos.js): a barreira que impede senha, chave, token, hash e dado de cliente de entrar no Git.
 * Rodar com: node --test verificar-segredos.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./scripts/verificar_segredos');

const HASH = 'scrypt:' + 'a'.repeat(32) + ':' + 'b'.repeat(128);
const JWT = 'eyJ' + 'a'.repeat(20) + '.' + 'b'.repeat(30) + '.' + 'c'.repeat(20);
const ctx = (extra) => Object.assign({ arquivo: 'x.js', sensiveis: [], identidades: null }, extra || {});

test('caminhos que NUNCA podem ser versionados', () => {
  for (const p of ['.env', '.env.local', '.env.txt', '.nexus_sync_token', '.nexus_supabase', '.nexus_smtp', '.nexus_jwt_secret', '.nexus_owner', '.tmp_tok.txt',
    'local_users.json', 'local_users.backup.json', 'local_database_data.json', 'cofre_contas.json', 'cofre_contas.anterior.json', 'deleted_accounts.json',
    'cpf_registry.json', 'system_logs.json', 'pending_logins.json', 'supabase_sync_state.nuvem.json', 'sql_vigia_estado.json',
    'backups_contas/2026-11-21.json', 'dist/local_users.json', 'visitas/2026-11-21.jsonl', 'chave.pem', 'banco.bak', 'scripts/.nexus_smtp']) {
    assert.ok(caminhoProibido(p), p + ' devia ser proibido');
  }
});

function caminhoProibido(p) { return V.caminhoProibido(p); }

test('arquivos normais e o .env.example são permitidos', () => {
  for (const p of ['.env.example', 'server.js', 'cofre-contas.js', 'cofre-contas.test.js', 'depoimentos.json', 'package.json', 'scripts/build.js', 'login-nexus-v5.html', '.githooks/pre-commit']) {
    assert.equal(caminhoProibido(p), null, p + ' não devia ser bloqueado');
  }
});

test('conteúdo: hash scrypt completo, JWT, chave sb_secret, chave privada e URL de banco com senha são barrados', () => {
  assert.ok(V.analisarLinha("const h = '" + HASH + "';", ctx()).includes('hash de senha scrypt completo'));
  assert.ok(V.analisarLinha('KEY=' + JWT, ctx()).some((t) => /JWT/.test(t)));
  assert.ok(V.analisarLinha('SUPABASE=sb_secret_' + 'A1b2'.repeat(8), ctx()).some((t) => /sb_secret/.test(t)));
  assert.ok(V.analisarLinha('-----BEGIN PRIVATE KEY-----', ctx()).includes('chave privada'));   // nexus-segredos:permitir (exemplo falso para o teste)
  assert.ok(V.analisarLinha('DATABASE_URL=postgres://postgres:Abc12345@db.exemplo.supabase.co:5432/postgres', ctx()).includes('URL de banco com usuário:senha'));   // nexus-segredos:permitir (exemplo falso para o teste)
});

test('conteúdo: placeholders, exemplos e senhas de TESTE curtas (scrypt:x) não dão alarme falso', () => {
  for (const l of ["password: 'scrypt:aa:bb'", "password: 'scrypt:x'", 'JWT_SECRET=change-this-in-production-please', 'MSSQL_PASSWORD=sua_senha_aqui', 'GOOGLE_CLIENT_SECRET=seu-client-secret', 'SUPABASE_SERVICE_ROLE_KEY=', 'DATABASE_URL=postgres://usuario:senha@host/db',
    'const JWT_SECRET = process.env.JWT_SECRET;', "const x = 'Admin@12345';", 'NEXUS_SYNC_TOKEN=<cole-aqui>']) {
    assert.deepEqual(V.analisarLinha(l, ctx({ arquivo: l.startsWith('const') || l.startsWith('password') ? 'x.js' : '.env.example' })), [], 'alarme falso: ' + l);
  }
});

test('atribuição CHAVE=valor longo é barrada em .env.example/.yml/.json, mas não em código .js (evita alarme falso em teste)', () => {
  assert.ok(V.analisarLinha('NEXUS_SYNC_TOKEN=' + 'f'.repeat(40), ctx({ arquivo: '.env.example' })).includes('segredo atribuído (CHAVE=valor)'));
  assert.ok(V.analisarLinha('  SMTP_PASS: ' + 'x9'.repeat(8), ctx({ arquivo: 'render.yaml' })).includes('segredo atribuído (CHAVE=valor)'));
  assert.deepEqual(V.analisarLinha("const JWT_SECRET = 'segredo-de-teste-' + 'x'.repeat(40);", ctx({ arquivo: 'a.integration.test.js' })), []);
});

test('o marcador nexus-segredos:permitir libera UMA linha legítima', () => {
  assert.deepEqual(V.analisarLinha("const h = '" + HASH + "'; // " + V.MARCA_PERMITIR, ctx()), []);
});

test('valor REAL do seu .env / .nexus_* nunca passa, em qualquer arquivo, e a mensagem não repete o valor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'segredos-'));
  fs.writeFileSync(path.join(dir, '.env'), 'PORT=3000\nMSSQL_SERVER=localhost\nNEXUS_SYNC_TOKEN=tok-' + 'z'.repeat(30) + '\nSMTP_PASS=Senh@Real99\nSUPABASE_URL=https://abc.supabase.co\nDEBUG_FLAG=true\n');
  fs.writeFileSync(path.join(dir, '.nexus_owner'), 'x'.repeat(0));
  fs.writeFileSync(path.join(dir, '.nexus_jwt_secret'), 'j'.repeat(48));
  const sens = V.valoresSensiveisLocais(dir);
  const nomes = sens.map((s) => s.nome).sort();
  assert.deepEqual(nomes, ['.nexus_jwt_secret', 'NEXUS_SYNC_TOKEN', 'SMTP_PASS'], 'só valores com nome de segredo e comprimento útil: ' + nomes);
  const achados = V.analisarLinha('enviar com a senha Senh@Real99 aqui', ctx({ sensiveis: sens }));
  assert.equal(achados.length, 1);
  assert.ok(/SMTP_PASS/.test(achados[0]) && !/Senh@Real99/.test(achados[0]), 'o relatório diz O QUE vazou, nunca o valor');
  assert.deepEqual(V.analisarLinha('porta 3000 e localhost', ctx({ sensiveis: sens })), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('e-mail e CPF REAIS de clientes (local_users.json/cofre) são barrados; os fictícios de teste, não', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'segredos-'));
  fs.writeFileSync(path.join(dir, 'local_users.json'), JSON.stringify([{ email: 'Pessoa.Real@gmail.com', cpf: '123.456.789-09' }]));
  fs.writeFileSync(path.join(dir, 'cofre_contas.json'), JSON.stringify({ contas: { 'outra@hotmail.com': { registro: { email: 'outra@hotmail.com', cpf: '98765432100' } } } }));
  const id = V.identidadesLocais(dir);
  assert.ok(V.analisarLinha("email: 'pessoa.real@gmail.com'", ctx({ identidades: id })).includes('e-mail real de cliente (de local_users.json)'));
  assert.ok(V.analisarLinha("email: 'outra@hotmail.com'", ctx({ identidades: id })).length === 1);
  assert.ok(V.analisarLinha("cpf '123.456.789-09'", ctx({ identidades: id })).includes('CPF real de cliente'));
  assert.ok(V.analisarLinha("cpf '98765432100'", ctx({ identidades: id })).includes('CPF real de cliente'));
  assert.deepEqual(V.analisarLinha("email: 'ana@teste.nexus', cpf: '52998224725'", ctx({ identidades: id })), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('linha enorme ou vazia não trava nem dá alarme', () => {
  assert.deepEqual(V.analisarLinha('', ctx()), []);
  assert.deepEqual(V.analisarLinha('a'.repeat(30000), ctx()), []);
});
