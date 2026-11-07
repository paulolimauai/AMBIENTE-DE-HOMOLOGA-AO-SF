'use strict';

// Testes da leitura de extratos. Rodar com: npm test  (ou: node --test importacao.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('./importacao');

test('normalizarData: formatos brasileiros e ISO, e datas impossíveis', () => {
  assert.equal(I.normalizarData('2026-11-05'), '2026-11-05');
  assert.equal(I.normalizarData('05/11/2026'), '2026-11-05');
  assert.equal(I.normalizarData('5-1-2026'), '2026-01-05');
  assert.equal(I.normalizarData('05.11.2026'), '2026-11-05');
  assert.equal(I.normalizarData('05/11/26'), '2026-11-05');
  assert.equal(I.normalizarData('20261105'), '2026-11-05');
  assert.equal(I.normalizarData('20261105120000[-3:BRT]'), '2026-11-05');
  assert.equal(I.normalizarData('2026-11-05T10:20:00Z'), '2026-11-05');
  assert.equal(I.normalizarData('31/02/2026'), null); // fevereiro não tem dia 31
  assert.equal(I.normalizarData('32/01/2026'), null);
  assert.equal(I.normalizarData('13/13/2026'), null);
  assert.equal(I.normalizarData('abc'), null);
  assert.equal(I.normalizarData(''), null);
});

test('lerValor: vírgula decimal, milhar, sinais e moeda', () => {
  assert.equal(I.lerValor('1.234,56'), 1234.56);
  assert.equal(I.lerValor('-1.234,56'), -1234.56);
  assert.equal(I.lerValor('R$ 1.234,56'), 1234.56);
  assert.equal(I.lerValor('1,234.56'), 1234.56);
  assert.equal(I.lerValor('1234.56'), 1234.56);
  assert.equal(I.lerValor('1234,5'), 1234.5);
  assert.equal(I.lerValor('-12,50'), -12.5);
  assert.equal(I.lerValor('(123,45)'), -123.45);
  assert.equal(I.lerValor('123,45-'), -123.45);
  assert.equal(I.lerValor('+10'), 10);
  assert.equal(I.lerValor('1.234.567'), 1234567);
  assert.equal(I.lerValor('0.5'), 0.5);
  assert.equal(I.lerValor('0,75'), 0.75);
  assert.ok(Number.isNaN(I.lerValor('abc')));
  assert.ok(Number.isNaN(I.lerValor('')));
  assert.ok(Number.isNaN(I.lerValor('1,2,x')));
});

test('CSV brasileiro com ";" e vírgula decimal mantém os centavos e converte a data', () => {
  const csv = 'Data;Descrição;Valor\n05/11/2026;Supermercado Bom Preço;-1.234,56\n06/11/2026;Salário;8.500,00\n';
  const r = I.lerExtrato(csv);
  assert.equal(r.formato, 'csv');
  assert.deepEqual(r.linhas, [
    { date: '2026-11-05', desc: 'Supermercado Bom Preço', val: -1234.56 },
    { date: '2026-11-06', desc: 'Salário', val: 8500 }
  ]);
  assert.equal(r.ignoradas.length, 0);
});

test('CSV documentado (data,descricao,valor) e descrição com vírgula entre aspas', () => {
  const csv = 'data,descricao,valor\n2026-11-05,"Padaria, Centro",-12.50\n2026-11-06,Freela,300\n';
  const r = I.lerExtrato(csv);
  assert.equal(r.linhas.length, 2);
  assert.equal(r.linhas[0].desc, 'Padaria, Centro');
  assert.equal(r.linhas[0].val, -12.5);
  assert.equal(r.linhas[1].val, 300);
});

test('CSV sem cabeçalho e com colunas fora de ordem', () => {
  const r = I.lerExtrato('2026-11-05,Mercado,-50,25\n'); // vírgula decimal sem aspas vira coluna extra: não inventa dados
  assert.equal(r.linhas.length, 1);
  const r2 = I.lerExtrato('05/11/2026;Mercado;-50,25\n06/11/2026;Posto;-100,00');
  assert.deepEqual(r2.linhas.map((l) => l.val), [-50.25, -100]);
});

test('CSV com colunas Crédito e Débito', () => {
  const csv = 'Data;Histórico;Crédito;Débito\n01/11/2026;Depósito;1.000,00;\n02/11/2026;Conta de luz;;245,80\n';
  const r = I.lerExtrato(csv);
  assert.deepEqual(r.linhas.map((l) => [l.desc, l.val]), [['Depósito', 1000], ['Conta de luz', -245.8]]);
});

test('linhas ruins são ignoradas com o motivo, sem derrubar o resto', () => {
  const csv = 'data;descricao;valor\n31/02/2026;Data impossível;10,00\n05/11/2026;Sem valor;\n05/11/2026;Valor zero;0,00\n05/11/2026;Boa;-9,90\n';
  const r = I.lerExtrato(csv);
  assert.equal(r.linhas.length, 1);
  assert.equal(r.ignoradas.length, 3);
  assert.deepEqual(r.ignoradas.map((i) => i.motivo), ['data inválida ou ausente', 'valor inválido ou ausente', 'valor zerado']);
});

test('arquivo com BOM e linha de título antes do cabeçalho', () => {
  const r = I.lerExtrato('﻿Extrato da conta\nData;Descrição;Valor\n05/11/2026;Teste;-1,00\n');
  assert.equal(r.linhas.length, 1);
});

test('OFX é reconhecido pelo conteúdo (mesmo em .txt) e lê valores e datas', () => {
  const ofx = '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>\n' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105120000[-3:BRT]<TRNAMT>-1234.56<MEMO>COMPRA MERCADO</STMTTRN>\n' +
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261106<TRNAMT>8500,00<NAME>SALARIO</STMTTRN>\n' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>xx<TRNAMT>-1.00<MEMO>SEM DATA</STMTTRN>\n' +
    '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const r = I.lerExtrato(ofx);
  assert.equal(r.formato, 'ofx');
  assert.deepEqual(r.linhas, [
    { date: '2026-11-05', desc: 'COMPRA MERCADO', val: -1234.56 },
    { date: '2026-11-06', desc: 'SALARIO', val: 8500 }
  ]);
  assert.equal(r.ignoradas.length, 1);
});

test('OFX sem fechamento de tag (SGML) também é lido', () => {
  const ofx = '<OFX><STMTTRN>\n<DTPOSTED>20261105\n<TRNAMT>-10.00\n<MEMO>A\n<STMTTRN>\n<DTPOSTED>20261106\n<TRNAMT>20.00\n<MEMO>B\n</OFX>';
  const r = I.lerExtrato(ofx);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas.map((l) => l.desc), ['A', 'B']);
});

test('separarRepetidas: ignora o que a conta já tem, mas mantém duas compras idênticas novas', () => {
  const existentes = [
    { date: '2026-11-05', desc: 'Mercado', val: 50, type: 'out' },
    { date: '2026-11-06', desc: 'Salário', val: '8500', type: 'in' }
  ];
  const linhas = [
    { date: '2026-11-05', desc: 'mercado ', val: -50 }, // já existe (caixa/espaço não importam)
    { date: '2026-11-05', desc: 'Mercado', val: -50 }, // segunda compra igual no mesmo dia: é nova
    { date: '2026-11-06', desc: 'Salário', val: 8500 }, // já existe
    { date: '2026-11-07', desc: 'Posto', val: -80 }
  ];
  const { novas, repetidas } = I.separarRepetidas(linhas, existentes);
  assert.equal(repetidas.length, 2);
  assert.deepEqual(novas.map((l) => l.desc), ['Mercado', 'Posto']);
});

test('categoriaDaLinha: não grava despesa em categoria de receita (nem o contrário)', () => {
  const cats = [
    { name: 'Salário', type: 'receita' }, { name: 'Outras Receitas', type: 'receita' },
    { name: 'Moradia', type: 'despesa' }, { name: 'Outros', type: 'despesa' }
  ];
  assert.equal(I.categoriaDaLinha({ val: -10 }, 'Moradia', cats), 'Moradia');
  assert.equal(I.categoriaDaLinha({ val: -10 }, 'Salário', cats), 'Outros'); // despesa escolhida como receita
  assert.equal(I.categoriaDaLinha({ val: 10 }, 'Moradia', cats), 'Outras Receitas');
  assert.equal(I.categoriaDaLinha({ val: 10 }, 'Salário', cats), 'Salário');
});

test('arquivo vazio ou sem nada reconhecível não explode', () => {
  assert.deepEqual(I.lerExtrato(''), { formato: 'csv', linhas: [], ignoradas: [] });
  assert.equal(I.lerExtrato('só texto solto\nsem dados').linhas.length, 0);
  assert.equal(I.lerExtrato(null).linhas.length, 0);
});
