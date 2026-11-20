'use strict';

/** Regras do painel do administrador para liberar acesso (horas, dias, para sempre) e redefinir senha: node --test admin-liberacao.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('./admin-liberacao');

const AGORA = Date.parse('2026-11-20T15:00:00Z');
const HORA = 3600e3;
const DIA = 24 * HORA;

test('minutosDe: quantidade livre em minutos, horas ou dias, com vírgula decimal', () => {
  assert.equal(L.minutosDe('3', 60), 180);
  assert.equal(L.minutosDe('1,5', 60), 90);
  assert.equal(L.minutosDe(' 2 ', 1440), 2880);
  assert.equal(L.minutosDe('45', 1), 45);
  for (const ruim of ['', '   ', 'abc', '0', '-2', '0,001', null, undefined, 'Infinity', '1e999']) {
    assert.equal(L.minutosDe(ruim, 60), null, 'deveria recusar ' + JSON.stringify(ruim));
  }
});

test('erroDuracao: vazio recusa, 10 anos passa, 1 minuto a mais recusa (mesmo teto do servidor)', () => {
  assert.notEqual(L.erroDuracao(null), '');
  assert.equal(L.erroDuracao(1), '');
  assert.equal(L.erroDuracao(L.MAX_MIN), '');
  assert.match(L.erroDuracao(L.MAX_MIN + 1), /10 anos/);
  assert.equal(L.MAX_MIN, 10 * 365 * 24 * 60);
});

test('vencimentoApos: soma ao prazo que ainda vale; vencido ou vazio conta de agora', () => {
  const futuro = new Date(AGORA + 2 * DIA).toISOString();
  assert.equal(L.vencimentoApos(futuro, 1440, AGORA).getTime(), AGORA + 3 * DIA, 'soma ao vencimento futuro');
  const passado = new Date(AGORA - 5 * DIA).toISOString();
  assert.equal(L.vencimentoApos(passado, 60, AGORA).getTime(), AGORA + HORA, 'vencido: conta de agora');
  assert.equal(L.vencimentoApos('', 90, AGORA).getTime(), AGORA + 90 * 60e3);
  assert.equal(L.vencimentoApos('data inválida', 90, AGORA).getTime(), AGORA + 90 * 60e3);
  assert.equal(L.vencimentoApos(undefined, 1, AGORA).getTime(), AGORA + 60e3);
});

test('descreverDuracao: texto igual ao que o servidor devolve na mensagem da liberação', () => {
  const casos = [[1, '1 minuto'], [45, '45 minutos'], [60, '1 hora'], [180, '3 horas'], [90, '1 hora e 30 minutos'], [1440, '1 dia'], [2 * 1440, '2 dias'],
    [1560, '1 dia e 2 horas'], [1440 + 150, '1 dia, 2 horas e 30 minutos'], [0, '0 minuto']];
  for (const [min, texto] of casos) assert.equal(L.descreverDuracao(min), texto, min + ' min');
  // a função do servidor é a fonte: extraída do server.js e comparada nos mesmos casos (e em mais alguns)
  const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const m = fonte.match(/function descreverDuracao\(totalMinutos\) \{[\s\S]*?\n\}\n/);
  assert.ok(m, 'descreverDuracao não encontrada no server.js');
  const noServidor = new Function(m[0] + '; return descreverDuracao;')();
  for (const min of [...casos.map((c) => c[0]), 59, 61, 1439, 1441, 525600, 10 * 525600, 100000]) {
    assert.equal(L.descreverDuracao(min), noServidor(min), 'cliente e servidor divergem em ' + min);
  }
});

test('atalhos: 1 hora, 1 dia e "Para sempre" existem; só o último é vitalício; todos cabem no limite', () => {
  const por = Object.fromEntries(L.ATALHOS.map((a) => [a.id, a]));
  assert.equal(por['1h'].min, 60);
  assert.equal(por['1d'].min, 1440);
  assert.equal(por['30d'].min, 30 * 1440);
  assert.equal(por.vit.vitalicio, true);
  assert.equal(L.ATALHOS.filter((a) => a.vitalicio).length, 1);
  for (const a of L.ATALHOS.filter((x) => !x.vitalicio)) assert.equal(L.erroDuracao(a.min), '', a.id);
  assert.deepEqual(L.UNIDADES.map((u) => u.mult), [60, 1440, 1]);
});

test('condicao: administrador e vitalício não recebem tempo avulso', () => {
  assert.equal(L.condicao({ p: 'Administrador', val: 'Vitalício' }), 'admin');
  assert.equal(L.condicao({ p: 'Vitalício', val: 'Vitalício' }), 'vitalicio');
  assert.equal(L.condicao({ p: 'Nexus Mensal', val: '31/12/2026', _plano: 'vitalicio' }), 'vitalicio');
  assert.equal(L.condicao({ p: 'Nexus Mensal', val: '31/12/2026', _plano: 'cortesia_admin' }), 'normal');
  assert.equal(L.condicao({ p: 'Teste grátis', val: '—' }), 'normal');
  assert.equal(L.condicao(null), 'normal');
});

test('resumo: diz antes o que vai acontecer e quando não dá para liberar', () => {
  const futuro = new Date(AGORA + 2 * DIA).toISOString();
  const normal = { p: 'Nexus Mensal', val: '22/11/2026', _plano: 'mensal', _exp: futuro };

  const soma = L.resumo(normal, { min: 1440 }, AGORA);
  assert.equal(soma.ok, true);
  assert.match(soma.texto, /^Soma 1 dia ao prazo que ainda vale \(até /);
  assert.match(soma.texto, /Passa a vencer em/);

  const semPrazo = L.resumo({ p: 'Teste grátis', val: '—', _exp: '' }, { min: 180 }, AGORA);
  assert.equal(semPrazo.ok, true);
  assert.match(semPrazo.texto, /3 horas a partir de agora/);
  assert.match(semPrazo.texto, /20\/11\/2026.*15:00|20\/11\/2026.*12:00|20\/11\/2026/);

  const vitalicio = L.resumo(normal, { vitalicio: true }, AGORA);
  assert.equal(vitalicio.ok, true);
  assert.equal(vitalicio.tom, 'warn');
  assert.match(vitalicio.texto, /nunca vence/);

  assert.equal(L.resumo(normal, { min: L.MAX_MIN + 1 }, AGORA).ok, false);
  assert.equal(L.resumo(normal, { min: null }, AGORA).ok, false);

  const jaVitalicio = { p: 'Vitalício', val: 'Vitalício' };
  assert.equal(L.resumo(jaVitalicio, { min: 60 }, AGORA).ok, false);
  assert.match(L.resumo(jaVitalicio, { min: 60 }, AGORA).texto, /não há tempo a somar/);
  assert.equal(L.resumo(jaVitalicio, { vitalicio: true }, AGORA).ok, false);
  assert.equal(L.resumo({ p: 'Administrador', val: 'Vitalício' }, { min: 60 }, AGORA).ok, false);
});

test('dataHora: horário de Brasília, não o do navegador', () => {
  assert.match(L.dataHora(new Date('2026-11-20T15:00:00Z')), /20\/11\/2026.*12:00/);
  assert.match(L.dataHora(new Date('2026-11-20T02:30:00Z')), /19\/11\/2026.*23:30/);
});

test('a senha redefinida não é guardada em lugar nenhum do painel (só aparece na janela)', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'admin-liberacao.js'), 'utf8');
  assert.ok(!/localStorage|sessionStorage|save\(|log\(|S\.logs/.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '')), 'não pode gravar nada no navegador');
  assert.ok(!/toast\([^)]*tempPassword/.test(fonte), 'a senha não vai para o aviso (toast)');
  assert.ok(/mc\.innerHTML = ''/.test(fonte), 'fechar a janela apaga a senha do DOM');
});
