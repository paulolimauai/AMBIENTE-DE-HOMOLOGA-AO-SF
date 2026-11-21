'use strict';

/** Testes do histórico dos dados financeiros. Rodar com: node --test backup-financeiro.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const B = require('./backup-financeiro');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-bkp-'));
const sem = (n, extra) => ({ categories: [{ id: 1, name: 'Casa' }], accounts: [], transactions: Array.from({ length: n }, (_, i) => ({ id: i + 1, description: 'Item ' + (i + 1), amount: 10 + i })), budgets: [], goals: [], recurringList: [], alerts: [], attachments: [], notifications: [], updated_at: '2026-11-20T10:00:00.000Z', ...(extra || {}) });
const store = (dir, o) => { let t = 1_800_000_000_000; const s = B.createStore({ dir, now: () => t, log: { warn() {} }, ...(o || {}) }); s.avanca = ms => { t += ms; }; return s; };

test('isBlank: só categorias padrão = zerado; qualquer lançamento/conta/meta = preenchido', () => {
  assert.equal(B.isBlank(null), true);
  assert.equal(B.isBlank([]), true);
  assert.equal(B.isBlank({ categories: [{ id: 1 }], transactions: [], accounts: [] }), true);
  assert.equal(B.isBlank(sem(1)), false);
  assert.equal(B.isBlank({ goals: [{ id: 1 }] }), false);
  assert.equal(B.isBlank({ accounts: [{ id: 1 }] }), false);
});

test('retrato zerado NUNCA vira cópia (não há o que proteger e ele não pode empurrar versões boas para fora)', () => {
  const d = pasta(); const s = store(d);
  assert.equal(s.save('a@x.com', sem(0)), null);
  assert.equal(s.list('a@x.com').length, 0);
  assert.equal(s.latest('a@x.com'), null);
});

test('guarda a versão, devolve a mais recente e ignora conteúdo idêntico (mesmo com updated_at diferente)', () => {
  const d = pasta(); const s = store(d);
  assert.ok(s.save('A@X.com', sem(3)));
  s.avanca(60000);
  assert.equal(s.save('a@x.com', sem(3, { updated_at: '2026-11-21T00:00:00.000Z' })), null, 'mesmo conteúdo, só mudou o carimbo');
  s.avanca(60000);
  assert.ok(s.save('a@x.com', sem(4)));
  assert.equal(s.list('a@x.com').length, 2);
  assert.equal(s.latest('a@x.com').dados.transactions.length, 4);
});

test('intervalo mínimo entre cópias, exceto com force (antes de uma gravação que reduz o conteúdo)', () => {
  const d = pasta(); const s = store(d);
  assert.ok(s.save('a@x.com', sem(2)));
  s.avanca(5000);
  assert.equal(s.save('a@x.com', sem(3)), null, 'menos de 30 s desde a última');
  assert.ok(s.save('a@x.com', sem(3), { force: true }));
  assert.equal(s.latest('a@x.com').dados.transactions.length, 3);
});

test('o histórico sobrevive a "novo servidor": outra instância na mesma pasta enxerga as cópias e não repete a última', () => {
  const d = pasta();
  const a = store(d); a.save('a@x.com', sem(5));
  const b = store(d); b.avanca(120000);
  assert.equal(b.save('a@x.com', sem(5)), null, 'conteúdo igual ao da última cópia em disco');
  assert.equal(b.latest('a@x.com').dados.transactions.length, 5);
});

test('poda: as 30 mais novas ficam, das antigas 1 por dia, e nada além de 30 dias', () => {
  const d = pasta(); const s = store(d, { keepRecent: 3, keepDays: 5 });
  for (let i = 1; i <= 8; i++) { s.save('a@x.com', sem(i), { force: true }); s.avanca(86400000 * 1.1); }   // 1 cópia por ~dia
  const n = s.list('a@x.com').length;
  assert.ok(n >= 3 && n <= 8, 'ficaram ' + n);
  assert.equal(s.latest('a@x.com').dados.transactions.length, 8, 'a mais nova nunca é podada');
  for (let i = 0; i < 12; i++) { s.avanca(86400000 * 6); s.save('a@x.com', sem(20 + i), { force: true }); }
  assert.ok(s.list('a@x.com').length <= 3 + 5 + 1, 'antigas além do prazo saíram: ' + s.list('a@x.com').length);
});

test('cópia ilegível é pulada: latest() devolve a anterior', () => {
  const d = pasta(); const s = store(d);
  s.save('a@x.com', sem(2)); s.avanca(60000);
  const ruim = s.save('a@x.com', sem(3));
  fs.writeFileSync(ruim, '{ isso nao e json');
  assert.equal(s.latest('a@x.com').dados.transactions.length, 2);
});

test('contas diferentes não se misturam', () => {
  const d = pasta(); const s = store(d);
  s.save('a@x.com', sem(2)); s.save('b@x.com', sem(7));
  assert.equal(s.latest('a@x.com').dados.transactions.length, 2);
  assert.equal(s.latest('b@x.com').dados.transactions.length, 7);
  assert.equal(s.latest('c@x.com'), null);
});

test('pickBest: descarta zerado e ilegível; vence o conteúdo mais recente; empate = mais itens', () => {
  const velho = { fonte: 'SQL', dados: sem(5, { updated_at: '2026-11-10T00:00:00.000Z' }) };
  const novo = { fonte: 'espelho', dados: JSON.stringify(sem(3, { updated_at: '2026-11-18T00:00:00.000Z' })) };
  const zerado = { fonte: 'nuvem', dados: sem(0, { updated_at: '2026-11-21T00:00:00.000Z' }) };   // o zero MAIS NOVO não ganha
  assert.equal(B.pickBest([velho, novo, zerado, null, { fonte: 'x', dados: '{quebrado' }]).fonte, 'espelho');
  const igual1 = { fonte: 'a', dados: sem(2) }, igual2 = { fonte: 'b', dados: sem(6) };
  assert.equal(B.pickBest([igual1, igual2]).fonte, 'b');
  assert.equal(B.pickBest([zerado]), null);
  assert.equal(B.pickBest([]), null);
  assert.equal(B.pickBest(undefined), null);
});
