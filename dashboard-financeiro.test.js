'use strict';

// Testes do cálculo do dashboard. Rodar com: npm test  (ou: node --test dashboard-financeiro.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('./dashboard-financeiro');

// Hoje = 06/11/2026. Todos os números esperados abaixo foram conferidos à mão.
const HOJE = new Date(2026, 10, 6, 12, 0, 0);
const tx = (id, type, desc, val, date, cat, status, acc) => ({ id, type, desc, val, date, cat, status, acc: acc || 'Conta' });
const transacoes = () => [
  tx(1, 'in', 'Salário', 5000, '2026-11-05', 'Salário', 'Recebido'),
  tx(2, 'out', 'Aluguel', 1500, '2026-11-10', 'Moradia', 'Pendente'),
  tx(3, 'out', 'Mercado', 200, '2026-11-03', 'Supermercado', 'Pago'),
  tx(4, 'out', 'Compra no cartão', 300, '2026-11-04', 'Lazer', 'Pago', 'Cartão'),
  tx(5, 'in', 'Freela', 800, '2026-11-20', 'Freelance', 'Pendente'),
  tx(6, 'out', 'Seguro', 400, '2026-11-02', 'Transporte', 'Pendente'),
  tx(7, 'out', 'Mercado', 150, '2026-10-03', 'Supermercado', 'Pago'),
  tx(8, 'out', 'Mercado', 250, '2026-10-20', 'Supermercado', 'Pago'),
  tx(9, 'in', 'Salário', 5000, '2026-10-05', 'Salário', 'Recebido'),
  tx(10, 'out', 'Mercado', 100, '2026-10-02', 'Supermercado', 'Pago')
];
const contas = () => [
  { id: 1, nome: 'Conta', ehCartao: false, saldoInicial: 1000, txIds: [1, 2, 3, 5, 6, 7, 8, 9, 10] },
  { id: 2, nome: 'Cartão', ehCartao: true, limiteTotal: 5000, fatura: 300, disponivel: 4700, usoPct: 6, txIds: [4] }
];
const categorias = () => [{ name: 'Moradia', color: '#c98a3f', icon: '🏠' }, { name: 'Supermercado', color: '#d8a34b', icon: '🛒' }];
const ctx = (extra = {}) => ({
  hoje: HOJE, periodo: { year: 2026, month: 11 }, transacoes: transacoes(), contas: contas(), categorias: categorias(), orcamentos: [], ...extra
});

test('totais do mês separam realizado de previsto (pendente com data futura não conta como realizado)', () => {
  const m = D.calcular(ctx());
  assert.equal(m.totais.receitas.realizado, 5000);
  assert.equal(m.totais.receitas.previsto, 800);
  assert.equal(m.totais.receitas.total, 5800);
  assert.equal(m.totais.despesas.realizado, 500); // mercado 200 + cartão 300
  assert.equal(m.totais.despesas.previsto, 1900); // aluguel 1500 + seguro vencido 400
  assert.equal(m.totais.despesas.total, 2400);
  assert.equal(m.totais.resultadoRealizado, 4500);
  assert.equal(m.totais.resultadoPrevisto, 3400);
  assert.equal(m.totais.taxaPoupanca, 90);
  assert.equal(m.totais.comprometimento, 10);
});

test('saldo em contas = saldo inicial + realizado (cartão fica de fora) e não muda com o mês escolhido', () => {
  const nov = D.calcular(ctx());
  const out = D.calcular(ctx({ periodo: { year: 2026, month: 10 } }));
  const todas = D.calcular(ctx({ periodo: { year: 2026, month: 0 } }));
  // 1000 + 5000 - 200 - 150 - 250 + 5000 - 100 (a compra de 300 foi no cartão)
  assert.equal(nov.contas.saldoAtual, 10300);
  assert.equal(out.contas.saldoAtual, 10300);
  assert.equal(todas.contas.saldoAtual, 10300);
});

test('projeção do fim do mês soma as pendências (vencidas caem logo depois de hoje, futuras na própria data)', () => {
  const m = D.calcular(ctx());
  // 10300 - aluguel 1500 + freela 800 - seguro vencido 400
  assert.equal(m.contas.saldoProjetadoFim, 9200);
  const s = m.serieDiaria;
  assert.equal(s.hojeIdx, 5);
  assert.equal(s.saldoReal[5], 10300);
  assert.equal(s.saldoReal[6], null);
  assert.equal(s.saldoProj[4], null);
  assert.equal(s.saldoProj[5], 10300); // ponto de ligação com a linha real
  assert.equal(s.saldoProj[6], 9900); // vencido de 400 sai
  assert.equal(s.saldoProj[9], 8400); // aluguel no dia 10
  assert.equal(s.saldoProj[19], 9200); // freela no dia 20
  assert.equal(s.saldoProj[29], 9200);
  assert.equal(m.contas.saldoMinimo, 8400);
});

test('saldo real dia a dia usa só o realizado até aquele dia', () => {
  const s = D.calcular(ctx()).serieDiaria;
  assert.equal(s.saldoReal[1], 5500); // dia 2: só outubro, 1000 + 5000 - 150 - 250 - 100
  assert.equal(s.saldoReal[4], 10300); // dia 5: salário entrou
});

test('mês passado: série toda realizada, sem projeção; mês futuro: só projeção', () => {
  const out = D.calcular(ctx({ periodo: { year: 2026, month: 10 } }));
  assert.ok(out.serieDiaria.saldoReal.every((v) => v != null));
  assert.ok(out.serieDiaria.saldoProj.every((v) => v == null));
  assert.equal(out.serieDiaria.hojeIdx, -1);
  const dez = D.calcular(ctx({ periodo: { year: 2026, month: 12 } }));
  assert.ok(dez.serieDiaria.saldoReal.every((v) => v == null));
  assert.ok(dez.serieDiaria.saldoProj.every((v) => v != null));
  assert.equal(dez.periodo.ehFuturo, true);
  assert.equal(dez.comparativo, null);
});

test('comparativo usa o mês anterior até o mesmo dia', () => {
  const c = D.calcular(ctx()).comparativo;
  assert.equal(c.rotulo, 'vs out (até dia 6)');
  assert.deepEqual([c.receitas.atual, c.receitas.anterior, c.receitas.pct], [5000, 5000, 0]);
  assert.deepEqual([c.despesas.atual, c.despesas.anterior, c.despesas.pct], [500, 250, 100]);
  assert.equal(c.resultado.diff, -250);
});

test('categorias: participação, previsto e variação contra o mês anterior até o mesmo dia', () => {
  const m = D.calcular(ctx());
  const nomes = m.categorias.map((c) => c.nome);
  assert.deepEqual(nomes, ['Moradia', 'Transporte', 'Lazer', 'Supermercado']);
  const moradia = m.categorias[0];
  assert.equal(moradia.valor, 1500);
  assert.equal(moradia.previsto, 1500);
  assert.equal(Math.round(moradia.pct * 10) / 10, 62.5);
  assert.equal(moradia.cor, '#c98a3f');
  const mercado = m.categorias.find((c) => c.nome === 'Supermercado');
  assert.equal(Math.round(mercado.deltaPct), -20); // 200 contra 250 (out, dias 1-6)
  assert.equal(m.totalDespesaCats, 2400);
});

test('agenda: vencidas, esta semana e até 30 dias, com totais', () => {
  const a = D.calcular(ctx()).agenda;
  assert.deepEqual(a.grupos.vencidas.map((i) => i.desc), ['Seguro']);
  assert.equal(a.grupos.vencidas[0].dias, -4);
  assert.deepEqual(a.grupos.hoje, []);
  assert.deepEqual(a.grupos.semana.map((i) => i.desc), ['Aluguel']);
  assert.deepEqual(a.grupos.mes.map((i) => i.desc), ['Freela']);
  assert.equal(a.totalAPagar, 1900);
  assert.equal(a.totalAReceber, 800);
  assert.equal(a.qtdVencidas, 1);
  assert.equal(a.totalVencido, 400);
});

test('pendência além de 30 dias não entra na agenda', () => {
  const lista = transacoes().concat([tx(11, 'out', 'IPVA 2027', 900, '2027-02-15', 'Transporte', 'Pendente')]);
  const a = D.calcular(ctx({ transacoes: lista })).agenda;
  assert.ok(!a.itens.some((i) => i.desc === 'IPVA 2027'));
});

test('últimas movimentações: só realizadas, da mais recente para a mais antiga', () => {
  const u = D.calcular(ctx()).ultimas;
  assert.deepEqual(u.map((x) => x.desc), ['Salário', 'Compra no cartão', 'Mercado']);
});

test('cartões e contas: usa o resumo do app e calcula o saldo por conta pelas movimentações realizadas', () => {
  const c = D.calcular(ctx()).contas;
  assert.equal(c.cartoes.itens.length, 1);
  assert.equal(c.cartoes.fatura, 300);
  assert.equal(c.cartoes.usoPct, 6);
  assert.deepEqual(c.bancarias, [{ id: 1, nome: 'Conta', saldo: 10300 }]);
});

test('registro antigo sem status: realizado se a data já passou, pendente se é futura', () => {
  const lista = [tx(1, 'out', 'Antigo', 100, '2026-10-01', 'Outros', ''), tx(2, 'out', 'Futuro', 50, '2026-11-20', 'Outros', undefined)];
  const m = D.calcular(ctx({ transacoes: lista, contas: [] }));
  assert.equal(m.totais.despesas.realizado, 0); // outubro não está no período
  assert.equal(m.totais.despesas.previsto, 50);
  const out = D.calcular(ctx({ transacoes: lista, contas: [], periodo: { year: 2026, month: 10 } }));
  assert.equal(out.totais.despesas.realizado, 100);
});

test('entrada registrada no cartão (pagamento de fatura) não conta como receita', () => {
  const lista = transacoes().concat([tx(13, 'in', 'Pagamento da fatura', 2000, '2026-11-05', 'Cartão de Crédito', 'Recebido', 'Cartão')]);
  const cs = contas();
  cs[1].txIds = [4, 13];
  const m = D.calcular(ctx({ transacoes: lista, contas: cs }));
  assert.equal(m.totais.receitas.realizado, 5000); // só o salário
  assert.equal(m.serieMensal[5].entradas, 5000);
  assert.equal(m.comparativo.receitas.atual, 5000);
  assert.equal(m.contas.saldoAtual, 10300); // também não mexe no saldo das contas
  assert.ok(!m.ultimas.some((u) => u.desc === 'Pagamento da fatura'));
});

test('acumulado soma o realizado de todos os meses cadastrados (entradas − saídas)', () => {
  const m = D.calcular(ctx());
  // realizado em toda a base: 5000+5000 (salários) − (200+300+150+250+100) = 10000 − 1000 = 9000; meses: out e nov = 2
  assert.equal(m.acumulado.entradas, 10000);
  assert.equal(m.acumulado.saidas, 1000);
  assert.equal(m.acumulado.resultado, 9000);
  assert.equal(m.acumulado.meses, 2);
  assert.equal(m.acumulado.serie.length, 2);
  assert.deepEqual(m.acumulado.serie.map((p) => p.acumulado), [4500, 9000]); // out: 5000−500; nov: +4500
  const vazio = D.calcular(ctx({ transacoes: [], contas: [] }));
  assert.equal(vazio.acumulado.resultado, 0);
  assert.equal(vazio.acumulado.meses, 0);
  const html = D.pagina({ ...ctx(), util: {} });
  assert.ok(html.includes('Acumulado de todos os meses'));
  assert.ok(html.includes('saldo positivo disponível'));
  assert.ok(html.includes('fd-acum-barra'));
  assert.ok(html.includes('fd-acum-svg'));
});

test('"Todas as datas" soma tudo e não compara com mês anterior', () => {
  const m = D.calcular(ctx({ periodo: { year: 2026, month: 0 } }));
  assert.equal(m.comparativo, null);
  assert.equal(m.totais.receitas.realizado, 10000);
  assert.equal(m.periodo.rotulo, 'Todas as datas');
});

test('série mensal: seis meses até o mês de referência, só o realizado em cada um', () => {
  const s = D.calcular(ctx()).serieMensal;
  assert.equal(s.length, 6);
  assert.equal(s[5].rotulo, 'nov/26');
  assert.equal(s[4].rotulo, 'out/26');
  assert.equal(s[5].entradas, 5000);
  assert.equal(s[5].saidas, 500);
  assert.equal(s[4].saidas, 500); // 150 + 250 + 100
  assert.equal(s[5].entradasPrevistas, 800);
  assert.equal(s[0].entradas, 0);
});

test('orçamentos: gasto do período contra o limite', () => {
  const m = D.calcular(ctx({ orcamentos: [{ category: 'Supermercado', limit: 400 }, { category: 'Lazer', limit: 200 }] }));
  const lazer = m.orcamentos.find((o) => o.categoria === 'Lazer');
  assert.equal(lazer.gasto, 300);
  assert.equal(lazer.pct, 150);
  assert.equal(m.orcamentos[0].categoria, 'Lazer'); // mais estourado primeiro
  assert.equal(m.tempoDecorridoPct, 20); // dia 6 de 30
});

test('avisos: vencidas primeiro; só afirma o que as movimentações provam', () => {
  const m = D.calcular(ctx());
  assert.equal(m.insights[0].titulo, '1 conta vencida');
  assert.ok(m.insights.length <= 3);
  const sem = D.calcular(ctx({ transacoes: [tx(1, 'in', 'Salário', 1000, '2026-11-05', 'Salário', 'Recebido')], contas: [] }));
  assert.ok(!sem.insights.some((i) => /vencida/.test(i.titulo)));
});

test('saldo negativo previsto gera aviso com o primeiro dia', () => {
  const lista = [tx(1, 'in', 'Salário', 500, '2026-11-05', 'Salário', 'Recebido'), tx(2, 'out', 'Aluguel', 900, '2026-11-12', 'Moradia', 'Pendente')];
  const m = D.calcular(ctx({ transacoes: lista, contas: [{ id: 1, nome: 'Conta', saldoInicial: 0, txIds: [1, 2] }] }));
  assert.equal(m.contas.primeiroDiaNegativo, '2026-11-12');
  assert.ok(m.insights.some((i) => i.titulo === 'Saldo negativo previsto' && /12\/11/.test(i.texto)));
});

test('sem movimentações: modelo vazio exibe painel completo e sem exceções', () => {
  const m = D.calcular(ctx({ transacoes: [], contas: [] }));
  assert.equal(m.vazio, true);
  assert.equal(m.contas.saldoAtual, 0);
  assert.equal(m.agenda.itens.length, 0);
  const html = D.pagina({ ...ctx({ transacoes: [], contas: [] }), util: {} });
  assert.match(html, /Saldo em contas hoje/);
  assert.match(html, /Fluxo de caixa/);
});

test('dados sujos: valor em texto, data em DD/MM/AAAA, tipo inválido e data ausente', () => {
  const lista = [
    tx(1, 'in', 'A', '1.234,56', '05/11/2026', 'Salário', 'Recebido'),
    { id: 2, type: 'xx', desc: 'tipo ruim', val: 10, date: '2026-11-01' },
    { id: 3, type: 'out', desc: 'sem data', val: 10 },
    null
  ];
  const m = D.calcular(ctx({ transacoes: lista, contas: [] }));
  assert.equal(m.totais.receitas.realizado, 1234.56);
  assert.equal(m.totais.despesas.total, 0);
});

test('pagina() gera o HTML com os blocos, botões de baixa e escapa texto do usuário', () => {
  const lista = transacoes().concat([tx(12, 'out', '<img src=x onerror=alert(1)>', 10, '2026-11-08', 'Outros', 'Pendente')]);
  const html = D.pagina({ ...ctx({ transacoes: lista }), util: { saudacao: () => ({ text: 'Bom dia' }), primeiroNome: 'Marina', dataHoje: () => 'sexta-feira, 6 de novembro' } });
  for (const trecho of ['Saldo em contas hoje', 'Fluxo de caixa', 'Para onde vai o dinheiro', 'Contas dos próximos 30 dias', 'Saúde financeira', 'Últimas movimentações', 'data-paytx="2"', 'Bom dia, <span>Marina</span>']) {
    assert.ok(html.includes(trecho), 'faltou: ' + trecho);
  }
  assert.ok(!html.includes('<img src=x onerror'), 'texto do usuário não foi escapado');
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('utilitários: parseValor, parseData e eixo', () => {
  assert.equal(D.util.parseValor('R$ 1.234,56'), 1234.56);
  assert.equal(D.util.parseValor('12,5'), 12.5);
  assert.equal(D.util.parseValor(-7), 7);
  assert.equal(D.util.parseValor(undefined), 0);
  assert.deepEqual(D.util.parseData('2026-11-05T10:00:00Z'), { year: 2026, month: 11, day: 5 });
  assert.deepEqual(D.util.parseData('05/11/2026'), { year: 2026, month: 11, day: 5 });
  assert.equal(D.util.parseData('lixo'), null);
  assert.equal(D.util.fmtEixo(1500), 'R$ 1.500');
  assert.match(D.util.fmtEixo(25000), /25/);
  assert.equal(D.util.diferencaDias('2026-11-06', '2026-11-20'), 14);
  assert.equal(D.util.somarDias('2026-11-30', 1), '2026-12-01');
});

test('menorSaldoProjetado: acha o fundo da curva e o dia (null quando não há projeção)', () => {
  const m = D.calcular(ctx());
  const menor = D.menorSaldoProjetado(m.serieDiaria);
  assert.equal(menor.valor, 8400); // depois do aluguel do dia 10, antes do freela do dia 20
  assert.equal(menor.dia, 10);
  assert.equal(menor.valor, m.contas.saldoMinimo);
  // mês já encerrado: todas as projeções são null
  const out = D.calcular(ctx({ periodo: { year: 2026, month: 10 } }));
  assert.equal(D.menorSaldoProjetado(out.serieDiaria), null);
  assert.equal(D.menorSaldoProjetado(null), null);
});

test('filtrosDeAtalho: só entrega à lista de movimentações valores que ela aceita', () => {
  assert.deepEqual(D.filtrosDeAtalho({ fdTipo: 'out', fdStatus: 'Pendente', fdCat: 'Moradia', fdConta: 'Nubank' }), { tipo: 'out', status: 'Pendente', cat: 'Moradia', conta: 'Nubank' });
  assert.deepEqual(D.filtrosDeAtalho({ fdTipo: 'drop table', fdStatus: 'Hackeado' }), { tipo: '', status: '', cat: '', conta: '' });
  assert.deepEqual(D.filtrosDeAtalho(undefined), { tipo: '', status: '', cat: '', conta: '' });
});

test('pagina(): atalhos de navegação, ações rápidas e escape dos atributos', () => {
  const lista = transacoes().concat([tx(12, 'out', 'Teste', 10, '2026-11-02', 'A"B<c>', 'Pago')]);
  const html = D.pagina({ ...ctx({ transacoes: lista }), util: { saudacao: () => ({ text: 'Bom dia' }), primeiroNome: 'Marina', dataHoje: () => 'sexta-feira' } });
  for (const trecho of [
    'data-fd-ir="mov" data-fd-tipo="in"', // tile Receitas
    'data-fd-ir="mov" data-fd-tipo="out"', // tile Despesas
    'data-fd-ir="cartoes"', // tile Cartões
    'data-fd-ir="mov" data-fd-tipo="in" data-fd-status="Pendente"', // A receber (30 dias)
    'data-fd-ir="mov" data-fd-tipo="out" data-fd-cat="Supermercado"', // categoria do ranking
    'data-fd-acao="nova-receita"', 'data-fd-acao="nova-despesa"', 'data-fd-acao="atualizar"',
    'fd-spark-ponto', 'fd-spark-eixo'
  ]) assert.ok(html.includes(trecho), 'faltou: ' + trecho);
  // categoria com aspas e sinais de maior/menor não escapa do atributo
  assert.ok(html.includes('data-fd-cat="A&quot;B&lt;c&gt;"'));
  assert.ok(!html.includes('data-fd-cat="A"B'));
});

test('pagina() vazia: exibe todas as faixas do painel completo e mantém o cabeçalho com as ações rápidas', () => {
  const html = D.pagina({ ...ctx({ transacoes: [], contas: [] }), util: {} });
  assert.match(html, /data-fd-acao="nova-despesa"/);
  assert.match(html, /data-fd-acao="nova-receita"/);
  assert.ok(html.includes('fd-linha-a'), 'sem dados exibe as faixas completas do painel');
});
