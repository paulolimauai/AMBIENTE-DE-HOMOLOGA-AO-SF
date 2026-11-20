'use strict';
/** Situação do plano na tela Assinaturas do painel do administrador (prazos, teste grátis, destaque dos que vencem): node --test admin-assinaturas.test.js
 *  A lógica mora dentro de admin-assinaturas-glpi.html: o teste extrai o trecho (de "const ptBR=" até "const pcell=") e o executa isolado,
 *  com a data congelada em 20/11/2026 19:30 (Brasília) e o fuso fixado, para não depender da hora nem da máquina. */
process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'admin-assinaturas-glpi.html'), 'utf8');
const ini = html.indexOf('const ptBR=');
const marca = html.indexOf('const pcell=');
assert.ok(ini > 0 && marca > ini, 'trecho da situação do plano não encontrado no painel');
const trecho = html.slice(ini, html.indexOf('\n', marca));

const AGORA = new Date('2026-11-20T22:30:00Z').getTime();   // 19:30 em Brasília
class DataCongelada extends Date { constructor(...a) { if (a.length) super(...a); else super(AGORA); } static now() { return AGORA; } }
const ctx = vm.createContext({
  Date: DataCongelada,
  brl: (n) => 'R$ ' + Number(n).toFixed(2).replace('.', ','),
  esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
});
vm.runInContext(trecho, ctx);
const run = (expr) => vm.runInContext(expr, ctx);
const pinfo = (s) => JSON.parse(JSON.stringify(vm.runInContext('(function(s){return pinfo(s)})', ctx)(s)));
const rel = (txt, hora) => vm.runInContext('(function(t,h){return tmpRel(ptBR(t),h)})', ctx)(txt, hora);

test('tempo em palavras: hoje, amanhã, ontem, em N dias, há N dias', () => {
  assert.strictEqual(rel('20/11/2026'), 'hoje');
  assert.strictEqual(rel('21/11/2026'), 'amanhã');
  assert.strictEqual(rel('19/11/2026'), 'ontem');
  assert.strictEqual(rel('22/11/2026'), 'em 2 dias');
  assert.strictEqual(rel('08/12/2026'), 'em 18 dias');
  assert.strictEqual(rel('08/11/2026'), 'há 12 dias');
  assert.strictEqual(rel('abc'), '');
});

test('tempo com hora (teste de 24 h): em horas até 48 h, depois em dias', () => {
  assert.strictEqual(rel('21/11/2026 19:30', true), 'em 24 h');
  assert.strictEqual(rel('21/11/2026 07:30', true), 'em 12 h');
  assert.strictEqual(rel('19/11/2026 19:30', true), 'há 24 h');
  assert.strictEqual(rel('20/11/2026 19:40', true), 'em 1 h', 'mínimo de 1 h, nunca "em 0 h"');
  assert.strictEqual(rel('18/11/2026 19:30', true), 'há 2 dias', '48 h ou mais volta a contar em dias');
});

test('plano pago: vence em até 7 dias de calendário fica em destaque (w), com data e tempo restante', () => {
  const mensal = (val) => pinfo({ p: 'Nexus Mensal', v: 18, val });
  assert.deepStrictEqual(mensal('08/12/2026'), { c: 'ok', l: 'Nexus Mensal • R$ 18,00', d: 'até 08/12/2026 · em 18 dias', w: false });
  assert.strictEqual(mensal('22/11/2026').w, true);
  assert.strictEqual(mensal('27/11/2026').w, true, 'exatamente 7 dias ainda é "em até 7 dias"');
  assert.strictEqual(mensal('28/11/2026').w, false, '8 dias não');
  assert.strictEqual(mensal('20/11/2026').w, true, 'vence hoje');
  assert.strictEqual(pinfo({ p: 'Nexus Anual', v: 216, val: '08/06/2027' }).d, 'até 08/06/2027 · em 200 dias');
});

test('plano vencido: Expirado, com a data e há quanto tempo', () => {
  assert.deepStrictEqual(pinfo({ p: 'Nexus Mensal', v: 18, val: '08/11/2026' }), { c: 'er', l: 'Nexus Mensal • Expirado', d: 'expirou em 08/11/2026 · há 12 dias' });
  assert.strictEqual(pinfo({ p: 'Nexus Mensal', v: 18, val: '19/11/2026' }).d, 'expirou em 19/11/2026 · ontem');
});

test('vitalício e administrador: sem vencimento', () => {
  assert.deepStrictEqual(pinfo({ p: 'Vitalício', v: 0, val: 'Vitalício' }), { c: 'ok', l: 'Vitalício • Vitalício', d: 'sem vencimento' });
  assert.strictEqual(pinfo({ p: 'Administrador', v: 0, val: 'Vitalício' }).d, 'sem vencimento');
});

test('teste grátis: em curso mostra quando termina; encerrado vira "Teste encerrado" (vencido) e conta como não contratou', () => {
  const emCurso = pinfo({ p: 'Teste grátis', v: 0, val: '21/11/2026 19:30' });
  assert.deepStrictEqual(emCurso, { c: 'wa', l: 'Teste grátis • 1 dia', d: 'termina em 24 h', t: 'Termina em 21/11/2026 19:30' });
  const acabado = pinfo({ p: 'Teste grátis', v: 0, val: '18/11/2026 19:30' });
  assert.deepStrictEqual(acabado, { c: 'er', l: 'Teste encerrado', d: 'encerrado há 2 dias · não contratou', t: 'Terminou em 18/11/2026 19:30' });
  const semData = pinfo({ p: 'Teste grátis', v: 0, val: '—' });
  assert.strictEqual(semData.c, 'wa');
  assert.strictEqual(semData.d, 'ainda não contratou o Mensal', 'sem data, nunca mais "válido até — —"');
  assert.ok(!JSON.stringify([emCurso, acabado, semData]).includes('—'), 'nenhum traço solto no lugar da data');
});

test('conta sem cadastro no site', () => {
  assert.deepStrictEqual(pinfo(null), { c: 'mu', l: 'Sem cadastro no site', d: '' });
});

test('situação para o filtro: bloqueado vem antes de tudo; o resto segue a cor do plano', () => {
  const st = (s) => vm.runInContext('(function(s){return stSub(s)})', ctx)(s);
  assert.strictEqual(st({ s: 'Ativo', p: 'Nexus Mensal', v: 18, val: '08/12/2026' }), 'ok');
  assert.strictEqual(st({ s: 'Bloqueado', p: 'Nexus Mensal', v: 18, val: '08/12/2026' }), 'blk', 'bloqueado com plano em dia conta como bloqueado, não como ativo');
  assert.strictEqual(st({ s: 'Ativo', p: 'Teste grátis', v: 0, val: '21/11/2026 19:30' }), 'wa');
  assert.strictEqual(st({ s: 'Ativo', p: 'Teste grátis', v: 0, val: '18/11/2026 19:30' }), 'er');
  assert.strictEqual(st({ s: 'Ativo', p: 'Nexus Mensal', v: 18, val: '08/11/2026' }), 'er');
});

test('a célula do plano escapa HTML e põe a dica (title) com a data completa do teste', () => {
  const pcell = (s) => vm.runInContext('(function(s){return pcell(s)})', ctx)(s);
  const h = pcell({ p: 'Teste grátis', v: 0, val: '21/11/2026 19:30' });
  assert.ok(h.includes('<span class="tag wa">Teste grátis • 1 dia</span>'));
  assert.ok(h.includes('title="Termina em 21/11/2026 19:30"') && h.includes('termina em 24 h'));
  assert.ok(pcell({ p: 'Nexus Mensal', v: 18, val: '22/11/2026' }).includes('class="sub pd soon"'), 'vence em breve: classe de destaque');
  assert.ok(!pcell({ p: 'Nexus Mensal', v: 18, val: '08/12/2026' }).includes('soon'));
  const hostil = pcell({ p: '<img src=x onerror=alert(1)>', v: 18, val: '08/12/2026' });
  assert.ok(!hostil.includes('<img'), 'nome de plano hostil não vira HTML');
});

test('a tela nova existe no painel: filtro por situação, ordenação, menu ⋯, e saiu o campo de mensalidade editável', () => {
  for (const marca of ['function setSit(', 'function menuLinha(', 'function fecharMenu(', 'class="seg"', 'id="so"', 'role="menuitem"', 'aria-haspopup="menu"', "Plano e vencimento"]) {
    assert.ok(html.includes(marca), 'faltou: ' + marca);
  }
  assert.ok(!html.includes('Valor da mensalidade'), 'o campo de mensalidade editável (que só mudava o cache local) foi removido');
  assert.ok(!html.includes('id="fs"'), 'o select de situação foi trocado pelos botões com contagem');
  assert.ok(html.includes('trial_started_at') && html.includes('864e5'), 'o fim do teste grátis é calculado (24 h), sem "válido até — —"');
});
