'use strict';

// Testes da tela de Transações. Rodar com: npm test  (ou: node --test transacoes.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./transacoes');

const HOJE = '2026-11-08';
const parse = (v) => Math.abs(Number(v) || 0);
const fmt = (v) => 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ctx = {
  fmt, parseVal: parse, catColor: () => '#10B981', contaIcone: () => '<svg></svg>',
  metodo: (t) => (/cart/i.test(t.desc) ? 'Cartão de Crédito' : /boleto/i.test(t.desc) ? 'Boleto' : null)
};
const tx = (id, type, desc, val, date, status, extra) => Object.assign({ id, type, desc, val, date, status: status || 'Pago', cat: 'Geral', acc: 'Conta' }, extra || {});
const op = (extra) => Object.assign({ chave: 'date', dir: 'desc', visiveis: T.PAGINA, acoes: true, hoje: HOJE, filtrado: false, carregando: false, totalGeral: 0, periodo: 'Novembro / 2026' }, extra || {});
const linhas = (html) => (html.match(/<tr class="txp-row/g) || []).length;

test('dataISO: aceita os formatos do app e rejeita lixo', () => {
  assert.equal(T.dataISO('2026-11-05'), '2026-11-05');
  assert.equal(T.dataISO('2026-11-05T10:20:00.000Z'), '2026-11-05');
  assert.equal(T.dataISO('05/11/2026'), '2026-11-05');
  assert.equal(T.dataISO('5-1-2026'), '2026-01-05');
  assert.equal(T.dataISO('2026-13-01'), '');
  assert.equal(T.dataISO('ontem'), '');
  assert.equal(T.dataISO(null), '');
});

test('statusInfo: vencido é pendente com data anterior a hoje (hoje e futuro seguem pendentes)', () => {
  assert.deepEqual(T.statusInfo(tx(1, 'out', 'Luz', 10, '2026-11-07', 'Pendente'), HOJE).chave, 'overdue');
  assert.equal(T.statusInfo(tx(1, 'out', 'Luz', 10, '2026-11-07', 'Pendente'), HOJE).rotulo, 'Vencido');
  assert.equal(T.statusInfo(tx(2, 'in', 'Freela', 10, '2026-11-01', 'Pendente'), HOJE).rotulo, 'Atrasado');
  assert.equal(T.statusInfo(tx(3, 'out', 'Luz', 10, HOJE, 'Pendente'), HOJE).chave, 'pending');
  assert.equal(T.statusInfo(tx(4, 'out', 'Luz', 10, '2026-12-01', 'Pendente'), HOJE).chave, 'pending');
  assert.equal(T.statusInfo(tx(5, 'out', 'Luz', 10, '2026-01-01', 'Pago'), HOJE).rotulo, 'Pago');
  assert.equal(T.statusInfo(tx(6, 'in', 'Salário', 10, '2026-01-01', 'Recebido'), HOJE).rotulo, 'Recebido');
  assert.equal(T.statusInfo(tx(7, 'out', 'Sem data', 10, '', 'Pendente'), HOJE).chave, 'pending');
});

test('resumo: pendentes inclui os vencidos e os totais fecham em centavos', () => {
  const r = T.resumo([
    tx(1, 'in', 'Salário', 8500, '2026-11-05', 'Recebido'),
    tx(2, 'out', 'Luz', 245.8, '2026-11-03', 'Pendente'),
    tx(3, 'out', 'Internet', 129.9, '2026-11-20', 'Pendente'),
    tx(4, 'out', 'Mercado', 0.1, '2026-11-02', 'Pago'),
    tx(5, 'out', 'Mercado', 0.2, '2026-11-02', 'Pago')
  ], parse, HOJE);
  assert.equal(r.qtd, 5);
  assert.equal(r.receitas, 8500);
  assert.equal(r.despesas, 376);   // 245,80 + 129,90 + 0,10 + 0,20 (0,1 + 0,2 em ponto flutuante dá 0,30000000000000004)
  assert.equal(r.saldo, 8124);
  assert.equal(r.pendentes, 2);
  assert.equal(r.vencidos, 1);
  assert.equal(r.entradas, 1);
  assert.equal(r.saidas, 4);
});

test('ordenar: data decrescente por padrão, último cadastrado primeiro no mesmo dia, sem alterar a lista original', () => {
  const lista = [tx(1, 'out', 'A', 1, '2026-11-05'), tx(2, 'out', 'B', 2, '2026-11-07'), tx(3, 'out', 'C', 3, '2026-11-05'), tx(4, 'out', 'D', 4, '')];
  const copia = lista.map((t) => t.id);
  assert.deepEqual(T.ordenar(lista, 'date', 'desc', parse, HOJE).map((t) => t.id), [2, 3, 1, 4]);
  assert.deepEqual(T.ordenar(lista, 'date', 'asc', parse, HOJE).map((t) => t.id), [4, 1, 3, 2]);
  assert.deepEqual(lista.map((t) => t.id), copia);
});

test('ordenar: valor por magnitude, descrição sem diferenciar acentos/caixa e status (vencido, pendente, pago)', () => {
  const lista = [
    tx(1, 'out', 'água', 50, '2026-11-01', 'Pago'),
    tx(2, 'in', 'Zeca', 900, '2026-11-02', 'Recebido'),
    tx(3, 'out', 'Banco', 300, '2026-11-03', 'Pendente'),
    tx(4, 'out', 'Aluguel', 100, '2026-12-03', 'Pendente')
  ];
  assert.deepEqual(T.ordenar(lista, 'val', 'desc', parse, HOJE).map((t) => t.id), [2, 3, 4, 1]);
  assert.deepEqual(T.ordenar(lista, 'desc', 'asc', parse, HOJE).map((t) => t.desc), ['água', 'Aluguel', 'Banco', 'Zeca']);
  assert.deepEqual(T.ordenar(lista, 'status', 'asc', parse, HOJE).map((t) => t.id), [3, 4, 2, 1]);
});

test('csv: padrão brasileiro, BOM, aspas escapadas e fórmulas neutralizadas', () => {
  const texto = T.csv([
    tx(1, 'in', 'Salário', 8500, '2026-11-05', 'Recebido', { cat: 'Receita', acc: 'Nubank' }),
    tx(2, 'out', '=HYPERLINK("http://x")', 12.5, '2026-11-03', 'Pendente', { cat: '+cmd', acc: 'Linha\nquebrada' })
  ], parse, HOJE);
  assert.equal(texto.charCodeAt(0), 0xFEFF);
  const l = texto.slice(1).split('\r\n');
  assert.equal(l[0], '"Data";"Descrição";"Categoria";"Conta / Cartão";"Tipo";"Valor";"Status"');
  assert.equal(l[1], '"05/11/2026";"Salário";"Receita";"Nubank";"Receita";8500,00;"Recebido"');
  assert.equal(l[2], '"03/11/2026";"\'=HYPERLINK(""http://x"")";"\'+cmd";"Linha quebrada";"Despesa";-12,50;"Vencido"');
  assert.equal(l[3], '');
});

test('tabelaHTML: escapa texto dos dados e só aceita cor de verdade na categoria', () => {
  const html = T.tabelaHTML([tx(1, 'out', '<img src=x onerror=alert(1)>', 5, '2026-11-05', 'Pago', { cat: '"><b>x', acc: "<script>1</script>" })], op(), Object.assign({}, ctx, { catColor: () => 'red;background:url(x)' }));
  assert.ok(!/<img src=x/.test(html));
  assert.ok(!/<script>/.test(html));
  assert.ok(!/<b>x/.test(html));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('url(x)'));
  assert.ok(html.includes('background:#8EA3BB'));
});

test('tabelaHTML: ordenando por data, a data aparece só na primeira linha de cada dia; nas outras colunas, em todas', () => {
  const lista = [tx(1, 'out', 'A', 1, '2026-11-07'), tx(2, 'out', 'B', 1, '2026-11-07'), tx(3, 'out', 'C', 1, '2026-11-05')];
  const porData = T.tabelaHTML(T.ordenar(lista, 'date', 'desc', parse, HOJE), op(), ctx);
  assert.equal((porData.match(/txp-day-start/g) || []).length, 2);
  assert.equal((porData.match(/txp-cont/g) || []).length, 1);
  const porDesc = T.tabelaHTML(T.ordenar(lista, 'desc', 'asc', parse, HOJE), op({ chave: 'desc', dir: 'asc' }), ctx);
  assert.equal((porDesc.match(/txp-day-start/g) || []).length, 0);
  assert.equal((porDesc.match(/txp-cont/g) || []).length, 0);
  assert.ok(porData.includes('aria-sort="descending"'));
  assert.ok(porDesc.includes('aria-sort="ascending"'));
});

test('tabelaHTML: uma linha por lançamento (a tabela acompanha o tamanho dos dados) e as ações do app continuam ligadas', () => {
  const html = T.tabelaHTML([tx(7, 'in', 'Salário', 100, '2026-11-05', 'Recebido'), tx(8, 'out', 'Boleto luz', 50, '2026-11-06', 'Pendente')], op(), ctx);
  assert.equal(linhas(html), 2);
  assert.ok(html.includes('data-edit="7"') && html.includes('data-del="8"') && html.includes('data-togglestatus="8"'));
  assert.ok(html.includes('is-overdue'));
  assert.ok(html.includes('<strong>2</strong> lançamentos'));
  assert.ok(!html.includes('data-txmore'));
  assert.ok(html.includes('+R$ 100,00') && html.includes('-R$ 50,00'));
  assert.ok(html.includes('txp-chip">Boleto<'));
  assert.ok(!/style="[^"]*(max-)?height/.test(html));
});

test('tabelaHTML: um único lançamento usa o singular e não inventa método de pagamento', () => {
  const html = T.tabelaHTML([tx(1, 'out', 'Restaurante', 80, '2026-11-05')], op(), ctx);
  assert.ok(html.includes('<strong>1</strong> lançamento<'));
  assert.ok(!html.includes('txp-chip'));
});

test('tabelaHTML: lista grande mostra uma página por vez e oferece "Mostrar mais"', () => {
  const lista = Array.from({ length: 120 }, (_, i) => tx(i + 1, 'out', 'Item ' + i, 10, '2026-10-' + String((i % 28) + 1).padStart(2, '0')));
  const ordenada = T.ordenar(lista, 'date', 'desc', parse, HOJE);
  const p1 = T.tabelaHTML(ordenada, op(), ctx);
  assert.equal(linhas(p1), 50);
  assert.ok(p1.includes('Exibindo <strong>50</strong> de <strong>120</strong>'));
  assert.ok(p1.includes('Mostrar mais 50'));
  const p3 = T.tabelaHTML(ordenada, op({ visiveis: 150 }), ctx);
  assert.equal(linhas(p3), 120);
  assert.ok(!p3.includes('data-txmore'));
  assert.ok(p3.includes('data-txexport'));
});

test('estados vazios: carregando, sem dados, período vazio e filtros sem resultado', () => {
  assert.ok(T.tabelaHTML([], op({ carregando: true }), ctx).includes('Carregando transações'));
  const nenhuma = T.tabelaHTML([], op({ totalGeral: 0 }), ctx);
  assert.ok(nenhuma.includes('Nenhuma transação registrada') && nenhuma.includes('data-txaction="new"'));
  const periodo = T.tabelaHTML([], op({ totalGeral: 5 }), ctx);
  assert.ok(periodo.includes('Nenhuma transação neste período') && periodo.includes('data-txaction="all-dates"') && !periodo.includes('data-txaction="clear"'));
  assert.ok(periodo.includes('<strong>5 lançamentos</strong>'));
  const filtro = T.tabelaHTML([], op({ totalGeral: 1, filtrado: true }), ctx);
  assert.ok(filtro.includes('Nenhum lançamento encontrado') && filtro.includes('data-txaction="clear"'));
  assert.ok(filtro.includes('<strong>1 lançamento</strong>'));
});

test('rotuloRelativo: hoje, ontem, amanhã e nada nos outros dias', () => {
  assert.equal(T.rotuloRelativo('2026-11-08', HOJE), 'Hoje');
  assert.equal(T.rotuloRelativo('2026-11-07', HOJE), 'Ontem');
  assert.equal(T.rotuloRelativo('2026-11-09', HOJE), 'Amanhã');
  assert.equal(T.rotuloRelativo('2026-10-01', HOJE), '');
  assert.equal(T.rotuloRelativo('', HOJE), '');
});
