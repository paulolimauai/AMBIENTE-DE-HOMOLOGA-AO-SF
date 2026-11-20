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

test('userForCloud: TODOS os carimbos de data passam pela conversão de Brasília (created_at ficava de fora e a nuvem/Supabase guardavam 3 h a menos)', () => {
  const conv = (v) => 'BR:' + v;
  const doSql = { email: 'a@a.com', password: 'scrypt:x:y', name: 'A', birth_date: '1990-01-01', created_at: 'C', last_login: 'L', trial_started_at: 'T', subscription_expires_at: 'S' };
  const r = U.userForCloud(doSql, conv, '2026-11-15T10:00:00.000Z');
  assert.deepEqual([r.created_at, r.last_login, r.trial_started_at, r.subscription_expires_at], ['BR:C', 'BR:L', 'BR:T', 'BR:S']);
  assert.deepEqual(U.USER_DATE_FIELDS.slice().sort(), ['created_at', 'last_login', 'subscription_expires_at', 'trial_started_at']);
  assert.equal(r.birth_date, '1990-01-01', 'data de nascimento (sem hora) não é convertida');
  assert.equal(r.password_changed_at, '2026-11-15T10:00:00.000Z', 'relógio da senha vem do espelho');
  assert.equal(doSql.created_at, 'C', 'não altera a linha original');
  const vazio = U.userForCloud({ email: 'b@b.com', created_at: null, last_login: undefined }, conv);
  assert.equal(vazio.created_at, null); assert.equal(vazio.last_login, undefined);
  assert.equal(U.userForCloud({ password_changed_at: 'X' }, conv, 'Y').password_changed_at, 'X', 'o que o SQL já trouxe não é sobrescrito');
});

test('userForCloud: mudança de assinatura CARIMBADA no espelho vai à nuvem (com o carimbo), mesmo que o SQL ainda esteja atrasado', () => {
  const conv = (v) => v;
  const sql = { email: 'a@a.com', subscription_status: 'expired', subscription_plan: null, subscription_expires_at: '2026-11-01T10:00:00-03:00' };
  const espelho = { email: 'a@a.com', subscription_status: 'active', subscription_plan: 'cortesia_admin', subscription_expires_at: '2026-12-16T02:00:18-03:00', subscription_method: 'admin_cortesia', subscription_payment_id: 'ADMIN-GRANT-1', subscription_updated_at: '2026-11-16T05:00:18.000Z' };
  const r = U.userForCloud(sql, conv, undefined, espelho);
  assert.equal(r.subscription_status, 'active'); assert.equal(r.subscription_plan, 'cortesia_admin'); assert.equal(r.subscription_updated_at, '2026-11-16T05:00:18.000Z');
  assert.equal(r.subscription_expires_at, '2026-12-16T02:00:18-03:00');
  // espelho SEM carimbo: vale o SQL, como sempre
  const s = U.userForCloud(sql, conv, undefined, { email: 'a@a.com', subscription_status: 'active' });
  assert.equal(s.subscription_status, 'expired'); assert.equal(s.subscription_updated_at, undefined);
});

test('mergeUsersMirror: o carimbo da assinatura sobrevive e uma mudança carimbada não é desfeita por uma linha atrasada do SQL', () => {
  const espelho = [{ email: 'a@a.com', password: 'scrypt:x', subscription_status: 'active', subscription_plan: 'cortesia_admin', subscription_expires_at: '2026-12-16T02:00:18-03:00', subscription_updated_at: '2026-11-16T05:00:18.000Z' }];
  const linhaAtrasada = [{ email: 'a@a.com', subscription_status: 'expired', subscription_plan: null, subscription_expires_at: '2026-11-01T10:00:00-03:00' }];
  const r = U.mergeUsersMirror(espelho, linhaAtrasada)[0];
  assert.equal(r.subscription_status, 'active', 'o SQL ainda não recebeu o UPDATE: a mudança carimbada fica');
  assert.equal(r.subscription_plan, 'cortesia_admin'); assert.equal(r.subscription_updated_at, '2026-11-16T05:00:18.000Z'); assert.equal(r.password, 'scrypt:x');
  // sem carimbo no espelho: o SQL vence (fonte soberana), como sempre
  const semCarimbo = U.mergeUsersMirror([{ email: 'a@a.com', password: 'scrypt:x', subscription_status: 'active' }], linhaAtrasada)[0];
  assert.equal(semCarimbo.subscription_status, 'expired');
  // linha que já traz carimbo (veio da nuvem): vale o que ela trouxe
  const comCarimbo = U.mergeUsersMirror(espelho, [{ email: 'a@a.com', subscription_status: 'expired', subscription_updated_at: '2026-11-16T06:00:00.000Z' }])[0];
  assert.equal(comCarimbo.subscription_status, 'expired'); assert.equal(comCarimbo.subscription_updated_at, '2026-11-16T06:00:00.000Z');
});

test('userForCloud: bloqueio CARIMBADO no espelho vai à nuvem (com o carimbo), mesmo que o SQL ainda diga ativo', () => {
  const conv = (v) => v;
  const sql = { email: 'a@a.com', active: true };
  const espelho = { email: 'a@a.com', active: false, active_updated_at: '2026-11-20T12:00:00.000Z' };
  const r = U.userForCloud(sql, conv, undefined, espelho);
  assert.equal(r.active, false, 'o PC manda o bloqueio que o administrador fez, não o active = 1 atrasado do SQL');
  assert.equal(r.active_updated_at, '2026-11-20T12:00:00.000Z');
  // espelho SEM carimbo: vale o SQL, como sempre, e nenhum carimbo é inventado
  const s = U.userForCloud(sql, conv, undefined, { email: 'a@a.com', active: false });
  assert.equal(s.active, true); assert.equal(s.active_updated_at, undefined);
  // o bloqueio e a assinatura têm relógios independentes: um não leva o outro
  const so = U.userForCloud({ email: 'a@a.com', active: true, subscription_status: 'expired' }, conv, undefined, { email: 'a@a.com', active: false, active_updated_at: '2026-11-20T12:00:00.000Z' });
  assert.equal(so.subscription_status, 'expired'); assert.equal(so.subscription_updated_at, undefined);
});

test('mergeUsersMirror: o carimbo do bloqueio sobrevive e o bloqueio não é desfeito por uma linha atrasada do SQL', () => {
  const espelho = [{ email: 'a@a.com', password: 'scrypt:x', active: false, active_updated_at: '2026-11-20T12:00:00.000Z' }];
  const linhaAtrasada = [{ email: 'a@a.com', active: true }];
  const r = U.mergeUsersMirror(espelho, linhaAtrasada)[0];
  assert.equal(r.active, false, 'o SQL ainda não recebeu o UPDATE: o bloqueio carimbado fica');
  assert.equal(r.active_updated_at, '2026-11-20T12:00:00.000Z'); assert.equal(r.password, 'scrypt:x');
  // sem carimbo no espelho: o SQL vence (fonte soberana), como sempre
  assert.equal(U.mergeUsersMirror([{ email: 'a@a.com', password: 'scrypt:x', active: false }], linhaAtrasada)[0].active, true);
  // linha que já traz carimbo (veio da nuvem): vale o que ela trouxe
  const comCarimbo = U.mergeUsersMirror(espelho, [{ email: 'a@a.com', active: true, active_updated_at: '2026-11-20T13:00:00.000Z' }])[0];
  assert.equal(comCarimbo.active, true); assert.equal(comCarimbo.active_updated_at, '2026-11-20T13:00:00.000Z');
  assert.ok(U.LOCAL_ONLY_USER_FIELDS.includes('active_updated_at'));
});
