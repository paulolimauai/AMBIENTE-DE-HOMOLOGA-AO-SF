'use strict';
// Regras da assinatura entre nuvem e PC. Rodar: node --test assinatura.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./assinatura');

const base = (extra) => Object.assign({ subscription_status: 'trial', subscription_plan: null, subscription_expires_at: null, subscription_method: null, subscription_payment_id: null, trial_started_at: '2026-11-08T10:00:00-03:00' }, extra || {});
const liberada = (clock, exp) => base({ subscription_status: 'active', subscription_plan: 'cortesia_admin', subscription_expires_at: exp || '2026-12-16T02:00:18-03:00', subscription_method: 'admin_cortesia', subscription_payment_id: 'ADMIN-GRANT-1', subscription_updated_at: clock });

test('relógio dos dois lados: vale o mais novo; igual = mantém o que já está', () => {
  const nuvem = liberada('2026-11-16T05:00:00.000Z');
  const pcAntigo = base({ subscription_status: 'expired', subscription_updated_at: '2026-11-16T04:00:00.000Z' });
  const r = A.pickSubscription(nuvem, pcAntigo);
  assert.equal(r.source, 'existing'); assert.equal(r.fields.subscription_status, 'active'); assert.equal(r.subscription_updated_at, '2026-11-16T05:00:00.000Z');
  const r2 = A.pickSubscription(pcAntigo, nuvem);
  assert.equal(r2.source, 'incoming'); assert.equal(r2.fields.subscription_plan, 'cortesia_admin'); assert.equal(r2.subscription_updated_at, '2026-11-16T05:00:00.000Z');
  assert.equal(A.pickSubscription(nuvem, Object.assign({}, nuvem)).source, 'same');
});

test('só um lado com relógio: esse lado vale (PC sem relógio não desfaz a liberação feita na nuvem)', () => {
  const nuvem = liberada('2026-11-16T05:00:00.000Z');
  const pcSemRelogio = base({ subscription_status: 'expired' });
  assert.equal(A.pickSubscription(nuvem, pcSemRelogio).source, 'existing', 'a nuvem tem relógio: o envio sem relógio não vence');
  assert.equal(A.pickSubscription(pcSemRelogio, nuvem).source, 'incoming', 'o PC adota a da nuvem, que tem relógio');
});

test('sem relógio nos dois lados: decisão estável pelo noClock (compatível com o que sempre foi)', () => {
  const a = base({ subscription_status: 'expired' }); const b = base({ subscription_status: 'active' });
  assert.equal(A.pickSubscription(a, b).source, 'incoming', 'padrão: quem envia (o PC) é a fonte soberana');
  assert.equal(A.pickSubscription(a, b, { noClock: 'incoming' }).source, 'incoming');
  assert.equal(A.pickSubscription(a, b, { noClock: 'existing' }).source, 'existing', 'o PC não troca a sua por uma da nuvem sem relógio');
  assert.equal(A.pickSubscription(a, b, { noClock: 'lixo' }).source, 'incoming');
});

test('envio parcial: o campo que não veio fica com o valor que já existia', () => {
  const existente = liberada('2026-11-16T04:00:00.000Z');
  const parcial = { subscription_status: 'expired', subscription_updated_at: '2026-11-16T05:00:00.000Z' };
  const r = A.pickSubscription(existente, parcial);
  assert.equal(r.source, 'incoming'); assert.equal(r.fields.subscription_status, 'expired');
  assert.equal(r.fields.subscription_plan, 'cortesia_admin', 'plano não veio: mantém');
  assert.equal(A.pickSubscription(existente, {}).fields.subscription_expires_at, existente.subscription_expires_at);
  assert.equal(A.pickSubscription(null, parcial).fields.subscription_plan, undefined);
});

test('mesmaAssinatura: nulo = vazio, datas pelo instante (fuso/formato não contam), resto pelo texto', () => {
  assert.equal(A.mesmaAssinatura(liberada('x', '2026-12-16T02:00:18-03:00'), liberada('y', '2026-12-16T05:00:18.000Z')), true, 'mesmo instante em formatos diferentes');
  assert.equal(A.mesmaAssinatura(base({ subscription_plan: null }), base({ subscription_plan: '' })), true);
  assert.equal(A.mesmaAssinatura(liberada('x', '2026-12-16T02:00:18-03:00'), liberada('x', '2026-12-17T02:00:18-03:00')), false, 'vencimento diferente');
  assert.equal(A.mesmaAssinatura(base({ subscription_status: 'active' }), base({ subscription_status: 'expired' })), false);
  assert.equal(A.mesmaAssinatura(base({ subscription_payment_id: 'A' }), base({ subscription_payment_id: null })), false);
  assert.equal(A.mesmaAssinatura(null, null), true);
});

test('stamp: carimba agora e nunca recua (relógio da máquina voltou)', () => {
  const u = {};
  A.stamp(u, Date.parse('2026-11-16T05:00:00.000Z'));
  assert.equal(u.subscription_updated_at, '2026-11-16T05:00:00.000Z');
  A.stamp(u, Date.parse('2026-11-16T04:00:00.000Z'));                       // máquina voltou 1 h
  assert.ok(Date.parse(u.subscription_updated_at) > Date.parse('2026-11-16T05:00:00.000Z'), 'o carimbo novo é maior que o anterior');
  const v = A.stamp({}); assert.ok(Math.abs(Date.now() - Date.parse(v.subscription_updated_at)) < 2000);
  assert.equal(A.stamp(null), null);
});

test('aplicar e recortar: copiam só a assinatura e o carimbo', () => {
  const origem = Object.assign(liberada('2026-11-16T05:00:00.000Z'), { name: 'Ana', password: 'scrypt:x' });
  const rec = A.recortar(origem);
  assert.deepEqual(Object.keys(rec).sort(), [...A.CAMPOS, A.RELOGIO].sort());
  assert.equal('password' in rec, false);
  const alvo = { name: 'Bia', password: 'scrypt:y', subscription_status: 'expired' };
  A.aplicar(alvo, A.pickSubscription(alvo, origem));
  assert.equal(alvo.subscription_status, 'active'); assert.equal(alvo.subscription_updated_at, '2026-11-16T05:00:00.000Z');
  assert.equal(alvo.name, 'Bia'); assert.equal(alvo.password, 'scrypt:y');
});

test('cenário real de 16/11: bloqueio feito na nuvem 05:02:02 não é desfeito pelo PC (que ainda tem a liberação antiga sem relógio)', () => {
  const pc = liberada(undefined, '2026-12-13T08:56:38-03:00');                        // SQL do PC: ativa, sem relógio
  const nuvem = Object.assign(base({ subscription_status: 'expired', subscription_plan: null, subscription_expires_at: '2026-11-16T02:01:00-03:00', subscription_method: 'admin_cortesia' }), { subscription_updated_at: '2026-11-16T05:02:02.000Z' });
  // envio do PC para a nuvem (a cada 10 s): a nuvem tem relógio, o PC não → fica o bloqueio
  assert.equal(A.pickSubscription(nuvem, pc).source, 'existing');
  // importação da nuvem pelo PC: a nuvem tem relógio, o PC não → o PC adota o bloqueio
  const adotada = A.pickSubscription(pc, nuvem, { noClock: 'existing' });
  assert.equal(adotada.source, 'incoming'); assert.equal(adotada.fields.subscription_status, 'expired');
});
