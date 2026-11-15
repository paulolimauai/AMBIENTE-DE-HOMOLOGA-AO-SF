'use strict';
// Regras de "qual senha vale" (nuvem x SQL Server do PC x Supabase). Rodar: node --test credenciais.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isHash, clockMs, pickPassword, shouldAdoptRemote } = require('./credenciais');

const H1 = 'scrypt:' + 'a1'.repeat(16) + ':' + 'b1'.repeat(64);
const H2 = 'scrypt:' + 'a2'.repeat(16) + ':' + 'b2'.repeat(64);
const T1 = '2026-11-15T10:00:00.000Z';
const T2 = '2026-11-15T10:00:05.000Z';

test('isHash só aceita o formato scrypt do sistema', () => {
  assert.equal(isHash(H1), true);
  for (const v of ['', null, undefined, 'Senha@123', 'd41d8cd98f00b204e9800998ecf8427e', 'scrypt:xyz', 'scrypt::', 42]) assert.equal(isHash(v), false, String(v));
});

test('clockMs: data válida em ms; ausente ou inválida vira 0', () => {
  assert.equal(clockMs({ password_changed_at: T1 }), Date.parse(T1));
  assert.equal(clockMs({ password_changed_at: Date.parse(T1) }), Date.parse(T1));
  for (const v of [undefined, null, '', 'não é data', {}]) assert.equal(clockMs({ password_changed_at: v }), 0);
  assert.equal(clockMs(null), 0);
});

test('o caso do bug: hash antigo do PC (sem relógio) NUNCA troca a senha que a nuvem acabou de criar', () => {
  const nuvem = { password: H2, password_changed_at: T2 };       // senha criada agora na nuvem
  const pc = { password: H1 };                                    // SQL Server ainda com a antiga, sem relógio
  const r = pickPassword(nuvem, pc, { noClock: 'existing' });
  assert.equal(r.source, 'existing');
  assert.equal(r.password, H2);
  assert.equal(r.password_changed_at, T2);
});

test('hash antigo do PC COM relógio mais velho também não vence; com relógio mais novo vence', () => {
  assert.equal(pickPassword({ password: H2, password_changed_at: T2 }, { password: H1, password_changed_at: T1 }).source, 'existing');
  const r = pickPassword({ password: H1, password_changed_at: T1 }, { password: H2, password_changed_at: T2 });
  assert.equal(r.source, 'incoming');
  assert.equal(r.password, H2);
  assert.equal(r.password_changed_at, T2);
});

test('empate de relógio mantém o que já existe', () => {
  assert.equal(pickPassword({ password: H1, password_changed_at: T1 }, { password: H2, password_changed_at: T1 }).source, 'existing');
});

test('só um lado tem relógio: quem tem relógio foi trocada depois e vence', () => {
  assert.equal(pickPassword({ password: H1 }, { password: H2, password_changed_at: T1 }).source, 'incoming');
  assert.equal(pickPassword({ password: H1, password_changed_at: T1 }, { password: H2 }).source, 'existing');
});

test('ninguém tem relógio (cadastro antigo): decide o chamador, e a decisão é estável', () => {
  assert.equal(pickPassword({ password: H1 }, { password: H2 }).source, 'existing');
  assert.equal(pickPassword({ password: H1 }, { password: H2 }, { noClock: 'existing' }).source, 'existing');
  assert.equal(pickPassword({ password: H1 }, { password: H2 }, { noClock: 'incoming' }).source, 'incoming');
});

test('nunca apaga senha: o que chega vazio, em texto puro ou legado não substitui um hash', () => {
  for (const lixo of ['', null, undefined, 'Senha@123', 'd41d8cd98f00b204e9800998ecf8427e']) {
    const r = pickPassword({ password: H1, password_changed_at: T1 }, { password: lixo, password_changed_at: T2 }, { noClock: 'incoming' });
    assert.equal(r.source, 'existing');
    assert.equal(r.password, H1);
  }
});

test('sem hash gravado, vale o que chega (conta nova, disco zerado, senha legada)', () => {
  assert.equal(pickPassword(null, { password: H1 }).source, 'incoming');
  assert.equal(pickPassword({ password: '' }, { password: H1 }).source, 'incoming');
  assert.equal(pickPassword({ password: 'd41d8cd98f00b204e9800998ecf8427e' }, { password: H1 }).source, 'incoming');
  assert.equal(pickPassword({ password: H1 }, { password: H1 }).source, 'same');
});

test('hashes iguais: "same" guarda o relógio mais novo', () => {
  const r = pickPassword({ password: H1, password_changed_at: T1 }, { password: H1, password_changed_at: T2 });
  assert.equal(r.source, 'same');
  assert.equal(r.password_changed_at, T2);
  assert.equal(pickPassword({ password: H1 }, { password: H1, password_changed_at: T1 }).password_changed_at, T1);
});

test('shouldAdoptRemote: o Supabase só vale no login se for mais novo ou se a conta não existe aqui', () => {
  assert.equal(shouldAdoptRemote(null, { password: H1 }), true, 'conta ausente no servidor');
  assert.equal(shouldAdoptRemote({ password: '' }, { password: H1 }), true, 'sem senha no servidor');
  assert.equal(shouldAdoptRemote({ password: H1, password_changed_at: T1 }, { password: H2, password_changed_at: T2 }), true, 'Supabase mais novo');
  assert.equal(shouldAdoptRemote({ password: H1, password_changed_at: T2 }, { password: H2, password_changed_at: T1 }), false, 'senha antiga do Supabase não volta');
  assert.equal(shouldAdoptRemote({ password: H1 }, { password: H2 }), false, 'sem relógio dos dois lados o servidor mantém a sua');
  assert.equal(shouldAdoptRemote({ password: H1 }, { password: H2, password_changed_at: T1 }), true, 'só o Supabase tem relógio');
  assert.equal(shouldAdoptRemote({ password: H1, password_changed_at: T1 }, { password: H2 }), false, 'só o servidor tem relógio');
  assert.equal(shouldAdoptRemote({ password: H1 }, { password: 'texto puro' }), false, 'Supabase sem hash válido');
  assert.equal(shouldAdoptRemote({ password: H1 }, null), false, 'Supabase sem a conta');
});
