'use strict';

/**
 * Cofre de contas (cofre-contas.js): "cadastro a senha certinho e quando volto diz que o usuário não possui conta criada" (21/11/2026).
 * Rodar com: node --test cofre-contas.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarCofre, datasSanas, dataImpossivel, ARQUIVO, ARQUIVO_ANTERIOR, PASTA_DIARIA } = require('./cofre-contas');

const HASH = 'scrypt:' + 'a'.repeat(32) + ':' + 'b'.repeat(128);
const HASH2 = 'scrypt:' + 'c'.repeat(32) + ':' + 'd'.repeat(128);
const mudo = { warn() {}, log() {} };

function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cofre-teste-')); }
function conta(email, extra) { return Object.assign({ id: '1', name: 'Fulano', email, password: HASH, role: 'Usuário', active: true, cpf: '11144477735' }, extra || {}); }

test('registrar guarda a conta e o cofre sobrevive a um novo processo (relê do arquivo)', () => {
  const dir = pasta();
  criarCofre({ dir, log: mudo }).registrar([conta('a@x.com'), conta('b@x.com')]);
  const novo = criarCofre({ dir, log: mudo });
  assert.equal(novo.total(), 2);
  assert.equal(novo.buscar('A@X.com').password, HASH, 'busca ignora maiúsculas e devolve a senha guardada');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('conta que SUMIU da lista (arquivo zerado, banco novo, lista menor) volta; conta com lápide NÃO volta', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('fica@x.com'), conta('sumiu@x.com'), conta('apagada@x.com')]);
  const listaDepois = [conta('fica@x.com')];
  const faltam = c.faltantes(listaDepois, new Set(['apagada@x.com']));
  assert.deepEqual(faltam.map(u => u.email), ['sumiu@x.com']);
  assert.equal(faltam[0].password, HASH);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('lista vazia (disco novo) + cofre cheio => todas as contas sem lápide voltam', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('a@x.com'), conta('b@x.com')]);
  assert.equal(c.faltantes([], new Set()).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a senha guardada nunca é trocada por uma vazia ou ilegível, mas uma senha NOVA válida a substitui', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('a@x.com')]);
  c.registrar([conta('a@x.com', { password: '' })]);
  assert.equal(c.buscar('a@x.com').password, HASH);
  c.registrar([conta('a@x.com', { password: 'texto-puro' })]);
  assert.equal(c.buscar('a@x.com').password, HASH);
  c.registrar([conta('a@x.com', { password: HASH2 })]);
  assert.equal(c.buscar('a@x.com').password, HASH2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('excluir de propósito tira a conta de circulação, guarda a última versão em "excluidas" e ela não volta', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('a@x.com')]);
  assert.equal(c.excluir('a@x.com'), true);
  assert.equal(c.buscar('a@x.com'), null);
  assert.equal(c.faltantes([], new Set()).length, 0);
  const cru = JSON.parse(fs.readFileSync(path.join(dir, ARQUIVO), 'utf8'));
  assert.equal(cru.excluidas['a@x.com'].registro.password, HASH);
  assert.equal(c.excluir('nao-existe@x.com'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('conta recriada depois de excluída volta a valer e sai de "excluidas"', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('a@x.com')]); c.excluir('a@x.com');
  c.registrar([conta('a@x.com', { password: HASH2 })]);
  assert.equal(c.buscar('a@x.com').password, HASH2);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, ARQUIVO), 'utf8')).excluidas), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('arquivo principal danificado: o cofre cai na cópia anterior, e arquivo ausente começa vazio sem lançar', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('a@x.com')]);
  c.registrar([conta('b@x.com')]);               // a 2ª gravação deixa a 1ª em cofre_contas.anterior.json
  fs.writeFileSync(path.join(dir, ARQUIVO), '{ isto não é json');
  const lido = criarCofre({ dir, log: mudo });
  assert.ok(lido.buscar('a@x.com'), 'recuperou da cópia anterior');
  assert.ok(fs.existsSync(path.join(dir, ARQUIVO_ANTERIOR)));
  const vazio = criarCofre({ dir: path.join(dir, 'nao-existe'), log: mudo });
  assert.equal(vazio.total(), 0);
  assert.deepEqual(vazio.faltantes([], new Set()), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('uma cópia por dia em backups_contas (no máximo 30) e sem regravar quando nada mudou', () => {
  const dir = pasta();
  let dia = 0;
  const c = criarCofre({ dir, log: mudo, agora: () => new Date(Date.UTC(2026, 0, 1 + dia)) });
  for (dia = 0; dia < 35; dia++) c.registrar([conta('a@x.com', { name: 'Nome ' + dia })]);
  assert.equal(fs.readdirSync(path.join(dir, PASTA_DIARIA)).length, 30);
  const mtime = fs.statSync(path.join(dir, ARQUIVO)).mtimeMs;
  assert.equal(c.registrar([conta('a@x.com', { name: 'Nome 34' })]), 0, 'mesma conta, nada a gravar');
  assert.equal(fs.statSync(path.join(dir, ARQUIVO)).mtimeMs, mtime);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buscarPorCpf acha a conta só quando o CPF é único (recuperação por CPF)', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  c.registrar([conta('a@x.com', { cpf: '111.444.777-35' }), conta('b@x.com', { cpf: '52998224725' })]);
  assert.equal(c.buscarPorCpf('11144477735').email, 'a@x.com');
  assert.equal(c.buscarPorCpf('123'), null);
  c.registrar([conta('c@x.com', { cpf: '52998224725' })]);
  assert.equal(c.buscarPorCpf('52998224725'), null, 'dois cadastros com o mesmo CPF: ambíguo, não adivinha');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- datas impossíveis (deriva de +3 h do espelho) ----
const AGORA = Date.parse('2026-11-21T13:00:00Z');

test('dataImpossivel: futuro além de 36 h e antes de 2000 são lixo; passado, agora e vazio não', () => {
  assert.equal(dataImpossivel('2028-10-06T17:08:14-03:00', AGORA), true);
  assert.equal(dataImpossivel('2026-11-22T20:00:00Z', AGORA), false, 'dentro da folga de fuso');
  assert.equal(dataImpossivel('1999-12-31T00:00:00Z', AGORA), true);
  assert.equal(dataImpossivel('2026-11-19T11:08:14-03:00', AGORA), false);
  assert.equal(dataImpossivel('', AGORA), false);
  assert.equal(dataImpossivel(null, AGORA), false);
  assert.equal(dataImpossivel('texto', AGORA), false);
});

test('datasSanas: created_at/last_login do futuro voltam ao valor anterior real; sem anterior, last_login vira null e created_at usa o início do teste', () => {
  const anterior = { created_at: '2026-11-19T11:08:14-03:00', last_login: '2026-11-20T10:15:34-03:00' };
  const corrompido = { email: 'a@x.com', created_at: '2028-10-06T17:08:14-03:00', last_login: '2027-05-30T23:00:14-03:00', trial_started_at: '2026-11-19T11:08:14-03:00' };
  const a = datasSanas(corrompido, anterior, AGORA);
  assert.equal(a.created_at, anterior.created_at);
  assert.equal(a.last_login, anterior.last_login);
  const b = datasSanas(corrompido, null, AGORA);
  assert.equal(b.last_login, null);
  assert.equal(b.created_at, corrompido.trial_started_at);
  assert.equal(corrompido.created_at, '2028-10-06T17:08:14-03:00', 'não altera o objeto de entrada');
  const ok = { email: 'a@x.com', created_at: '2026-11-19T11:08:14-03:00' };
  assert.equal(datasSanas(ok, anterior, AGORA), ok, 'sem mudança devolve o mesmo objeto');
});

test('registrar não guarda data impossível: mantém a real que já estava no cofre', () => {
  const dir = pasta(); const c = criarCofre({ dir, log: mudo });
  const agora = new Date().toISOString();
  c.registrar([conta('a@x.com', { created_at: agora, last_login: agora })]);
  c.registrar([conta('a@x.com', { created_at: '2099-01-01T00:00:00-03:00', last_login: '2099-01-01T00:00:00-03:00' })]);
  const r = c.buscar('a@x.com');
  assert.equal(r.created_at, agora);
  assert.equal(r.last_login, agora);
  fs.rmSync(dir, { recursive: true, force: true });
});
