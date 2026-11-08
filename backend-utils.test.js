'use strict';

// Testes dos utilitários do backend. Rodar com: npm test  (ou: node --test backend-utils.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const U = require('./backend-utils');

const pastaTemp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-utils-'));

test('decodeBodyChunk: caractere acentuado dividido entre dois pedaços não vira "�"', () => {
  const texto = JSON.stringify({ desc: 'Alimentação e açaí — 100% ção' });
  const bytes = Buffer.from(texto, 'utf8');
  // divide no meio de cada sequência multibyte possível
  for (let corte = 1; corte < bytes.length; corte++) {
    const req = {};
    let corpo = '';
    corpo += U.decodeBodyChunk(req, bytes.subarray(0, corte));
    corpo += U.decodeBodyChunk(req, bytes.subarray(corte));
    assert.equal(corpo, texto, 'corte em ' + corte);
  }
  // o jeito antigo realmente corrompia (prova de que o teste pega a falha)
  const ccedilla = Buffer.from('ç', 'utf8');
  assert.notEqual(ccedilla.subarray(0, 1).toString() + ccedilla.subarray(1).toString(), 'ç');
});

test('decodeBodyChunk: aceita texto já decodificado e mantém um decodificador por requisição', () => {
  assert.equal(U.decodeBodyChunk({}, 'abc'), 'abc');
  const a = {}, b = {};
  U.decodeBodyChunk(a, Buffer.from([0xC3]));
  assert.equal(U.decodeBodyChunk(b, Buffer.from([0xA7])), '�');   // b não herda o byte pendente de a
  assert.equal(U.decodeBodyChunk(a, Buffer.from([0xA7])), 'ç');
});

test('atomicWriteFileSync: grava, substitui e não deixa arquivo temporário', () => {
  const dir = pastaTemp();
  const f = path.join(dir, 'dados.json');
  U.atomicWriteFileSync(f, '{"a":1}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":1}');
  U.atomicWriteFileSync(f, '{"a":2,"nome":"Ação"}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2,"nome":"Ação"}');
  assert.deepEqual(fs.readdirSync(dir), ['dados.json']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('atomicWriteFileSync: se a pasta não existe, falha com erro (não engole)', () => {
  assert.throws(() => U.atomicWriteFileSync(path.join(os.tmpdir(), 'nao-existe-' + Date.now(), 'x.json'), '{}'));
});

test('createJsonFileCache: só reparseia quando o arquivo muda e avisa quando não existe', () => {
  const dir = pastaTemp();
  const f = path.join(dir, 'u.json');
  const cache = U.createJsonFileCache();
  assert.deepEqual(cache.read(f), { exists: false, value: undefined });
  fs.writeFileSync(f, '[1,2,3]');
  let parses = 0;
  const parse = (t) => { parses++; return JSON.parse(t); };
  const a = cache.read(f, parse);
  const b = cache.read(f, parse);
  assert.equal(parses, 1);
  assert.equal(a.value, b.value);          // mesmo objeto em memória
  fs.writeFileSync(f, '[1,2,3,4,5]');       // tamanho diferente => relê
  assert.deepEqual(cache.read(f, parse).value, [1, 2, 3, 4, 5]);
  assert.equal(parses, 2);
  cache.invalidate(f);
  cache.read(f, parse);
  assert.equal(parses, 3);
  fs.writeFileSync(f, '{quebrado');
  cache.invalidate(f);
  assert.throws(() => cache.read(f), SyntaxError);   // o chamador decide o fallback
  fs.rmSync(dir, { recursive: true, force: true });
});

test('deriveSyncToken: determinístico, diferente do segredo e sensível ao segredo', () => {
  const t1 = U.deriveSyncToken('segredo-do-servidor');
  assert.equal(t1, U.deriveSyncToken('segredo-do-servidor'));
  assert.notEqual(t1, 'segredo-do-servidor');
  assert.notEqual(t1, U.deriveSyncToken('outro-segredo'));
  assert.match(t1, /^[0-9a-f]{64}$/);
  assert.ok(!t1.includes('segredo'));
});

test('mergeUsersMirror: linhas do SQL sem senha não apagam a senha nem password_changed_at do espelho', () => {
  const espelho = [
    { email: 'Ana@x.com', password: 'scrypt:aa:bb', password_changed_at: '2026-11-08T10:00:00.000Z', name: 'Ana' },
    { email: 'bia@x.com', password: 'scrypt:cc:dd', name: 'Bia' }
  ];
  const doSql = [
    { email: 'ana@x.com', name: 'Ana Maria', role: 'Usuário' },                 // consulta sem a coluna password
    { email: 'bia@x.com', name: 'Bia', password: 'scrypt:novo:hash' },          // consulta com senha: o SQL vence
    { email: 'caio@x.com', name: 'Caio' }                                         // usuário novo
  ];
  const r = U.mergeUsersMirror(espelho, doSql);
  assert.equal(r[0].password, 'scrypt:aa:bb');
  assert.equal(r[0].password_changed_at, '2026-11-08T10:00:00.000Z');
  assert.equal(r[0].name, 'Ana Maria');
  assert.equal(r[1].password, 'scrypt:novo:hash');
  assert.equal(r[2].password, undefined);
  assert.equal(r.length, 3);
  assert.equal(espelho[0].name, 'Ana');   // não altera as entradas originais
});

test('mergeUsersMirror: entradas vazias e listas inválidas não quebram', () => {
  assert.deepEqual(U.mergeUsersMirror(null, [{ email: 'a@a.com' }]), [{ email: 'a@a.com' }]);
  assert.deepEqual(U.mergeUsersMirror([{ email: 'a@a.com', password: 'x' }], null), []);
  assert.deepEqual(U.mergeUsersMirror([], [null, {}]), [null, {}]);
});

test('sanitizeDeviceType: só texto curto e comum', () => {
  assert.equal(U.sanitizeDeviceType('Mobile', 'Computador'), 'Mobile');
  assert.equal(U.sanitizeDeviceType('  iPhone   15 ', 'Computador'), 'iPhone 15');
  assert.equal(U.sanitizeDeviceType('<img onerror=x>', 'Computador'), 'Computador');
  assert.equal(U.sanitizeDeviceType('x'.repeat(41), 'Computador'), 'Computador');
  assert.equal(U.sanitizeDeviceType({ toString() { return 'x'; } }, 'Computador'), 'Computador');
  assert.equal(U.sanitizeDeviceType(undefined, 'Mobile'), 'Mobile');
});

test('normalizePhoneInput: aceita DDD + 10/11 dígitos (com ou sem +55) e rejeita o resto', () => {
  assert.deepEqual(U.normalizePhoneInput(''), { ok: true, value: null });
  assert.deepEqual(U.normalizePhoneInput(null), { ok: true, value: null });
  assert.deepEqual(U.normalizePhoneInput('(62) 99234-5372'), { ok: true, value: '(62) 99234-5372' });
  assert.deepEqual(U.normalizePhoneInput('+55 62 99234 5372'), { ok: true, value: '(62) 99234-5372' });
  assert.deepEqual(U.normalizePhoneInput('6232345372'), { ok: true, value: '(62) 3234-5372' });
  assert.equal(U.normalizePhoneInput('123').ok, false);
  assert.equal(U.normalizePhoneInput('<script>').ok, false);
  assert.equal(U.normalizePhoneInput('9'.repeat(30)).ok, false);
});

test('normalizeBirthDateInput: formatos aceitos, datas inexistentes ou futuras são recusadas', () => {
  const agora = Date.UTC(2026, 10, 8);
  assert.deepEqual(U.normalizeBirthDateInput('', agora), { ok: true, value: null });
  assert.deepEqual(U.normalizeBirthDateInput('1990-05-17', agora), { ok: true, value: '17/05/1990' });
  assert.deepEqual(U.normalizeBirthDateInput('17/05/1990', agora), { ok: true, value: '17/05/1990' });
  assert.equal(U.normalizeBirthDateInput('31/02/1990', agora).ok, false);
  assert.equal(U.normalizeBirthDateInput('2030-01-01', agora).ok, false);
  assert.equal(U.normalizeBirthDateInput('1850-01-01', agora).ok, false);
  assert.equal(U.normalizeBirthDateInput('<b>x</b>', agora).ok, false);
  assert.equal(U.normalizeBirthDateInput('17-05-1990', agora).ok, false);
});

test('isUniqueViolation: reconhece chave duplicada do SQL Server', () => {
  assert.equal(U.isUniqueViolation({ number: 2627 }), true);
  assert.equal(U.isUniqueViolation({ number: 2601 }), true);
  assert.equal(U.isUniqueViolation({ message: 'Violation of UNIQUE KEY constraint UQ__usuarios' }), true);
  assert.equal(U.isUniqueViolation({ message: 'timeout' }), false);
  assert.equal(U.isUniqueViolation(null), false);
});

test('createLatestWinsRunner: em série por chave, junta rajadas e processa só a última carga', async () => {
  const processadas = [];
  let emAndamento = 0, maxSimultaneas = 0;
  const run = U.createLatestWinsRunner(async (chave, carga) => {
    emAndamento++; maxSimultaneas = Math.max(maxSimultaneas, emAndamento);
    await new Promise((r) => setTimeout(r, 15));
    processadas.push(chave + ':' + carga);
    emAndamento--;
  });
  const p = run('ana', 1);
  run('ana', 2); run('ana', 3); run('ana', 4);     // chegam enquanto o 1 roda
  const q = run('bia', 9);                           // outra chave roda em paralelo
  await Promise.all([p, q]);
  assert.deepEqual(processadas.filter((x) => x.startsWith('ana')), ['ana:1', 'ana:4']);
  assert.deepEqual(processadas.filter((x) => x.startsWith('bia')), ['bia:9']);
  assert.ok(maxSimultaneas <= 2);
  // depois de ociosa a chave aceita novo trabalho
  await run('ana', 5);
  assert.equal(processadas[processadas.length - 1], 'ana:5');
});

test('createLatestWinsRunner: erro do worker não trava a fila', async () => {
  let n = 0;
  const run = U.createLatestWinsRunner(async () => { n++; throw new Error('falhou'); });
  await run('x', 1);
  await run('x', 2);
  assert.equal(n, 2);
});
