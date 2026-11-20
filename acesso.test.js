'use strict';

/** Relógio do bloqueio de conta entre PC e nuvem: node --test acesso.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./acesso');

const T0 = Date.parse('2026-11-20T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

test('ativo: só false, 0 e "0" bloqueiam (ausente = ativo)', () => {
  for (const v of [false, 0, '0']) assert.equal(A.ativo(v), false, String(v));
  for (const v of [true, 1, '1', undefined, null, 'true']) assert.equal(A.ativo(v), true, String(v));
});

test('pickActive: o carimbo mais novo vence, nos dois sentidos', () => {
  const nuvemBloqueada = { active: false, active_updated_at: iso(T0 + 5000) };
  const pcAntigo = { active: true, active_updated_at: iso(T0) };
  const a = A.pickActive(nuvemBloqueada, pcAntigo);
  assert.equal(a.source, 'existing');
  assert.equal(a.active, false, 'o PC com carimbo mais velho não desfaz o bloqueio');
  assert.equal(a.active_updated_at, iso(T0 + 5000));

  const pcDesbloqueou = { active: true, active_updated_at: iso(T0 + 9000) };
  const b = A.pickActive(nuvemBloqueada, pcDesbloqueou);
  assert.equal(b.source, 'incoming');
  assert.equal(b.active, true, 'desbloqueio mais novo vindo do PC vale');
  assert.equal(b.active_updated_at, iso(T0 + 9000));

  const igual = A.pickActive({ active: false, active_updated_at: iso(T0) }, { active: true, active_updated_at: iso(T0) });
  assert.equal(igual.source, 'same');
  assert.equal(igual.active, false, 'empate: fica o que já está');
});

test('pickActive: só um lado com carimbo -> esse lado; nenhum -> noClock (quem envia, por padrão)', () => {
  // o PC (SQL) manda a linha antiga SEM carimbo: a nuvem que bloqueou (com carimbo) não pode ser desfeita
  const s1 = A.pickActive({ active: false, active_updated_at: iso(T0) }, { active: true });
  assert.equal(s1.source, 'existing');
  assert.equal(s1.active, false);
  // o PC bloqueou (com carimbo) e a nuvem nunca teve carimbo: vale o PC
  const s2 = A.pickActive({ active: true }, { active: false, active_updated_at: iso(T0) });
  assert.equal(s2.source, 'incoming');
  assert.equal(s2.active, false);
  // ninguém tem carimbo: comportamento de sempre (o que chegou vale), ou o que já está
  assert.equal(A.pickActive({ active: true }, { active: false }).active, false);
  assert.equal(A.pickActive({ active: true }, { active: false }, { noClock: 'existing' }).active, true);
});

test('pickActive: campo ausente no lado escolhido cai no valor do outro; conta nova é ativa', () => {
  assert.equal(A.pickActive({ active: false, active_updated_at: iso(T0) }, { active_updated_at: iso(T0 + 1) }).active, false);
  assert.equal(A.pickActive(undefined, undefined).active, true);
  assert.equal(A.pickActive(undefined, { active: 0 }).active, false);
  assert.equal(A.pickActive({ active: '0' }, { active: 1 }, { noClock: 'existing' }).active, false);
});

test('stamp: carimba e nunca recua mesmo se o relógio da máquina voltou', () => {
  const u = A.stamp({ active: false }, T0);
  assert.equal(u.active_updated_at, iso(T0));
  A.stamp(u, T0 - 60000);
  assert.equal(u.active_updated_at, iso(T0 + 1), 'relógio voltou: o carimbo novo ainda é maior');
  assert.equal(A.stamp(null), null);
});

test('aplicar: copia valor e carimbo escolhidos', () => {
  const u = { active: true };
  A.aplicar(u, A.pickActive({ active: true }, { active: false, active_updated_at: iso(T0) }));
  assert.equal(u.active, false);
  assert.equal(u.active_updated_at, iso(T0));
});

test('cenário real: bloqueio na nuvem sobrevive a vários ciclos do PC; o desbloqueio do admin também', () => {
  let nuvem = { active: true };
  // 1) admin bloqueia na nuvem
  nuvem.active = false; A.stamp(nuvem, T0);
  // 2) PC (SQL antigo, sem carimbo) reenvia 3 vezes
  for (let i = 0; i < 3; i++) {
    const p = A.pickActive(nuvem, { active: true });
    A.aplicar(nuvem, p);
    assert.equal(nuvem.active, false, 'ciclo ' + i);
  }
  // 3) o PC importa o bloqueio da nuvem (passo A) e passa a mandar o carimbo junto
  const pc = A.aplicar({ active: true }, A.pickActive({ active: true }, nuvem, { noClock: 'existing' }));
  assert.equal(pc.active, false);
  assert.equal(pc.active_updated_at, nuvem.active_updated_at);
  assert.equal(A.pickActive(nuvem, pc).active, false);
  // 4) admin desbloqueia na nuvem depois: o carimbo novo vence o do PC
  nuvem.active = true; A.stamp(nuvem, T0 + 60000);
  assert.equal(A.pickActive(nuvem, pc).active, true);
});

test('ativoEfetivo: no login do PC vale o bloqueio carimbado no espelho que o SQL ainda não recebeu', () => {
  const sqlAtivo = { active: true };
  assert.equal(A.ativoEfetivo(sqlAtivo, { active: false, active_updated_at: iso(T0) }), false, 'bloqueio carimbado vale mesmo com o SQL atrasado');
  assert.equal(A.ativoEfetivo({ active: false }, { active: true, active_updated_at: iso(T0) }), true, 'ativação carimbada também');
  assert.equal(A.ativoEfetivo(sqlAtivo, { active: false }), true, 'espelho sem carimbo: vale o SQL (fonte soberana), como sempre');
  assert.equal(A.ativoEfetivo({ active: 0 }, undefined), false);
  assert.equal(A.ativoEfetivo({ active: 1 }, null), true);
  assert.equal(A.ativoEfetivo(undefined, undefined), true);
  assert.equal(A.ativoEfetivo(sqlAtivo, { active_updated_at: iso(T0) }), true, 'carimbo sem valor não inventa bloqueio');
});
