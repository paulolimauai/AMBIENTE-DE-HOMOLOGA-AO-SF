'use strict';

/**
 * Dashboard financeiro do Nexus.
 *
 * Duas camadas no mesmo arquivo:
 *  1) MODELO (funções puras, sem DOM): transforma as movimentações cadastradas em números confiáveis. Tem testes em
 *     dashboard-financeiro.test.js (rodam em Node).
 *  2) TELA: monta o HTML do painel e desenha os gráficos (Chart.js) a partir do modelo.
 *
 * Regras que o painel antigo misturava e aqui ficam separadas:
 *  - "realizado" = lançamento Pago/Recebido; "previsto" = ainda Pendente (mesmo com data futura);
 *  - saldo em contas = saldo inicial das contas + entradas - saídas JÁ realizadas (cartão de crédito fica de fora até a fatura);
 *  - projeção = saldo de hoje + pendências cadastradas (as vencidas caem "amanhã", as futuras na própria data);
 *  - variação sempre contra o mês anterior até o mesmo dia.
 */
(function (global, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.NexusDash = api;
})(typeof window !== 'undefined' ? window : null, function () {
  // ======================================================================
  // Utilitários
  // ======================================================================
  const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const pad = (n) => String(n).padStart(2, '0');
  const diasNoMes = (a, m) => new Date(a, m, 0).getDate();
  const chave = (a, m, d) => a + '-' + pad(m) + '-' + pad(d);
  const arred = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

  function fmtBR(v) {
    return 'R$ ' + (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Eixo: valor inteiro abaixo de 10 mil; compacto ("12 mil") a partir daí
  function fmtEixo(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) < 10000) { const r = Math.round(n); return 'R$ ' + (r === 0 ? 0 : r).toLocaleString('pt-BR'); }   // sem "R$ -0"
    return 'R$ ' + new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  }
  function esc(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Mesma leitura de valores do app (aceita "1.234,56", "1234.56" e números)
  function parseValor(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? Math.abs(v) : 0;
    if (!v) return 0;
    let limpo = String(v).replace(/[^0-9.,-]/g, '').trim();
    if (limpo.includes(',') && limpo.includes('.')) {
      limpo = limpo.indexOf('.') < limpo.indexOf(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo.replace(/,/g, '');
    } else if (limpo.includes(',')) {
      limpo = limpo.replace(',', '.');
    }
    const n = Math.abs(parseFloat(limpo));
    return Number.isFinite(n) ? n : 0;
  }

  // Mesma leitura de datas do app (AAAA-MM-DD, DD/MM/AAAA, ISO com hora)
  function parseData(valor) {
    if (!valor) return null;
    const texto = String(valor).trim().split('T')[0];
    if (texto.includes('-')) {
      const p = texto.split('-');
      if (p.length === 3) {
        return p[0].length === 4
          ? { year: parseInt(p[0], 10), month: parseInt(p[1], 10), day: parseInt(p[2], 10) }
          : { year: parseInt(p[2], 10), month: parseInt(p[1], 10), day: parseInt(p[0], 10) };
      }
    }
    if (texto.includes('/')) {
      const p = texto.split('/');
      if (p.length === 3) {
        return p[2].length === 4
          ? { year: parseInt(p[2], 10), month: parseInt(p[1], 10), day: parseInt(p[0], 10) }
          : { year: parseInt(p[0], 10), month: parseInt(p[1], 10), day: parseInt(p[2], 10) };
      }
    }
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }

  function diferencaDias(deStr, ateStr) {
    const a = deStr.split('-').map(Number);
    const b = ateStr.split('-').map(Number);
    return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
  }
  function somarDias(str, n) {
    const p = str.split('-').map(Number);
    const d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return chave(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  function mesAnterior(a, m, n = 1) {
    let ano = a;
    let mes = m - n;
    while (mes <= 0) { mes += 12; ano -= 1; }
    return { ano, mes };
  }
  function dataCurta(str) {
    const p = str.split('-');
    return p[2] + '/' + p[1];
  }
  function diaSemana(str) {
    const p = str.split('-').map(Number);
    return DIAS_SEMANA[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }
  const pctDe = (parte, todo) => (todo > 0 ? (parte / todo) * 100 : null);

  // ======================================================================
  // Modelo
  // ======================================================================
  const STATUS_PAGOS = ['Pago', 'Paga', 'Recebido', 'Recebida', 'Efetivado', 'Efetuado', 'Efetuada', 'Confirmado', 'Confirmada',
    'Liquidado', 'Liquidada', 'Concluído', 'Concluída', 'Concluido', 'Concluida', 'Baixado', 'Baixada', 'Quitado', 'Quitada',
    'Paid', 'Received', 'Settled'];
  const STATUS_IGNORADOS = ['Cancelado', 'Cancelada', 'Cancelled', 'Estornado', 'Estornada', 'Reversed', 'Excluído', 'Excluída', 'Deleted'];
  const TIPOS_ENTRADA = ['in', 'receita', 'income', 'entrada'];
  const TIPOS_SAIDA = ['out', 'despesa', 'expense', 'saida', 'saída'];
  const BASE_MINIMA_PERCENTUAL = 50;

  // Registro sem status (dados antigos): vale como realizado se a data já passou
  function estaRealizado(status, data, hojeStr) {
    if (STATUS_PAGOS.includes(status)) return true;
    if (!status) return data <= hojeStr;
    return false;
  }

  // Aceita o formato atual (type 'in'/'out') e o legado (type 'receita'/'despesa', amount, description, category)
  function tipoDe(t) {
    const v = String(t.type || t.tipo || t.kind || '').toLowerCase();
    if (TIPOS_ENTRADA.includes(v)) return 'in';
    if (TIPOS_SAIDA.includes(v)) return 'out';
    return '';
  }
  const primeiro = (...vals) => { for (const v of vals) { if (v !== undefined && v !== null && v !== '') return v; } return undefined; };

  function normalizarLancamentos(transacoes, idsDeCartao, hojeStr) {
    const lista = [];
    (Array.isArray(transacoes) ? transacoes : []).forEach((t) => {
      if (!t) return;
      const status = String(t.status || t.situacao || '');
      if (STATUS_IGNORADOS.includes(status)) return; // cancelado/estornado não é nem previsto nem realizado
      const tipo = tipoDe(t);
      if (!tipo) return;
      const p = parseData(primeiro(t.date, t.data, t.dueDate, t.vencimento));
      if (!p || !p.year || !p.month || !p.day) return;
      const data = chave(p.year, p.month, p.day);
      lista.push({
        id: t.id,
        tipo,
        valor: parseValor(primeiro(t.val, t.amount, t.value, t.valor, t.valorTotal)),
        ano: p.year,
        mes: p.month,
        dia: p.day,
        data,
        realizado: estaRealizado(status, data, hojeStr),
        desc: String(primeiro(t.desc, t.description, t.name, t.titulo, t.descricao) || ''),
        cat: String(primeiro(t.cat, t.category, t.categoria) || 'Sem categoria'),
        conta: String(primeiro(t.acc, t.account, t.accountName, t.card, t.conta) || ''),
        pm: String(primeiro(t.paymentMethod, t.payment_method, t.meio, t.formaPagamento) || ''),
        noCartao: idsDeCartao.has(String(t.id))
      });
    });
    return lista;
  }

  function somar(lista) {
    const r = { realizado: 0, previsto: 0, qtd: 0, qtdPrevisto: 0, qtdRealizado: 0, total: 0 };
    lista.forEach((l) => {
      r.qtd += 1;
      if (l.realizado) { r.realizado += l.valor; r.qtdRealizado += 1; }
      else { r.previsto += l.valor; r.qtdPrevisto += 1; }
    });
    r.realizado = arred(r.realizado);
    r.previsto = arred(r.previsto);
    r.total = arred(r.realizado + r.previsto);
    return r;
  }

  function variacao(atual, anterior) {
    return { atual: arred(atual), anterior: arred(anterior), diff: arred(atual - anterior), pct: anterior > 0 ? ((atual - anterior) / anterior) * 100 : null };
  }

  function calcular(ctx) {
    const hoje = ctx && ctx.hoje instanceof Date ? ctx.hoje : new Date();
    const hojeStr = chave(hoje.getFullYear(), hoje.getMonth() + 1, hoje.getDate());
    const hojeDia = hoje.getDate();
    const pedido = (ctx && ctx.periodo) || {};
    const todasAsDatas = !(pedido.month >= 1 && pedido.month <= 12);
    const refAno = todasAsDatas ? hoje.getFullYear() : pedido.year;
    const refMes = todasAsDatas ? hoje.getMonth() + 1 : pedido.month;
    const ehMesAtual = refAno === hoje.getFullYear() && refMes === hoje.getMonth() + 1;
    const ehFuturo = !todasAsDatas && (refAno > hoje.getFullYear() || (refAno === hoje.getFullYear() && refMes > hoje.getMonth() + 1));
    const rotulo = todasAsDatas ? 'Todas as datas' : MESES[refMes - 1] + ' / ' + refAno;

    const contas = (ctx.contas || []).map((c) => ({
      id: c.id,
      nome: String(c.nome || ''),
      ehCartao: Boolean(c.ehCartao),
      saldoInicial: Number(c.saldoInicial) || 0,
      limiteTotal: Number(c.limiteTotal) || 0,
      fatura: Number(c.fatura) || 0,
      disponivel: Number(c.disponivel) || 0,
      usoPct: Number(c.usoPct) || 0,
      txIds: c.txIds || []
    }));
    const idsDeCartao = new Set();
    contas.filter((c) => c.ehCartao).forEach((c) => c.txIds.forEach((id) => idsDeCartao.add(String(id))));

    const lancs = normalizarLancamentos(ctx.transacoes, idsDeCartao, hojeStr);
    // Entrada registrada no cartão é pagamento de fatura/estorno, não renda: fica fora de receitas, gráficos e comparativos
    const lancsFluxo = lancs.filter((l) => !(l.tipo === 'in' && l.noCartao));
    const noPeriodo = (l) => todasAsDatas || (l.ano === refAno && l.mes === refMes);
    const doPeriodo = lancsFluxo.filter(noPeriodo);
    const entradas = doPeriodo.filter((l) => l.tipo === 'in');
    const saidas = doPeriodo.filter((l) => l.tipo === 'out');
    const receitas = somar(entradas);
    const despesas = somar(saidas);

    const resultadoRealizado = arred(receitas.realizado - despesas.realizado);
    const resultadoPrevisto = arred(receitas.total - despesas.total);
    const taxaPoupanca = receitas.realizado > 0 ? Math.round((resultadoRealizado / receitas.realizado) * 100) : null;
    const comprometimento = receitas.realizado > 0 ? Math.round((despesas.realizado / receitas.realizado) * 100) : (despesas.realizado > 0 ? 100 : 0);

    // ---------- Saldo em contas e projeção ----------
    const saldoInicial = arred(contas.filter((c) => !c.ehCartao).reduce((s, c) => s + c.saldoInicial, 0));
    const caixa = lancs.filter((l) => !l.noCartao);
    // Data em que cada lançamento mexe no caixa: o realizado nunca fica no futuro; o pendente nunca fica no passado
    const efetiva = (l) => (l.realizado ? (l.data < hojeStr ? l.data : hojeStr) : (l.data < hojeStr ? hojeStr : l.data));
    const movimentos = caixa.map((l) => ({ data: efetiva(l), delta: l.tipo === 'in' ? l.valor : -l.valor, realizado: l.realizado }));
    const saldoAtual = arred(saldoInicial + movimentos.filter((m) => m.realizado).reduce((s, m) => s + m.delta, 0));
    // Disponível para gastar = saldo em contas + receitas previstas − despesas previstas do período.
    // O realizado já está dentro do saldoAtual, então só entram as pendências (previsto) para não contar duas vezes.
    const disponivelGastar = arred(saldoAtual + receitas.previsto - despesas.previsto);
    const saldoRealEm = (ds) => arred(saldoInicial + movimentos.filter((m) => m.realizado && m.data <= ds).reduce((s, m) => s + m.delta, 0));
    const saldoProjetadoEm = (ds) => (ds <= hojeStr
      ? saldoRealEm(ds)
      : arred(saldoAtual + movimentos.filter((m) => !m.realizado && m.data <= ds).reduce((s, m) => s + m.delta, 0)));

    // ---------- Série diária do mês de referência ----------
    const nDias = diasNoMes(refAno, refMes);
    const dias = [];
    const flux = { in: [], out: [], inPrev: [], outPrev: [] };
    const saldoReal = [];
    const saldoProj = [];
    const eventos = [];
    for (let d = 1; d <= nDias; d++) {
      const ds = chave(refAno, refMes, d);
      dias.push(d);
      const doDia = lancsFluxo.filter((l) => l.data === ds);
      flux.in.push(arred(doDia.filter((l) => l.tipo === 'in' && l.realizado).reduce((s, l) => s + l.valor, 0)));
      flux.out.push(arred(doDia.filter((l) => l.tipo === 'out' && l.realizado).reduce((s, l) => s + l.valor, 0)));
      flux.inPrev.push(arred(doDia.filter((l) => l.tipo === 'in' && !l.realizado).reduce((s, l) => s + l.valor, 0)));
      flux.outPrev.push(arred(doDia.filter((l) => l.tipo === 'out' && !l.realizado).reduce((s, l) => s + l.valor, 0)));
      eventos.push(doDia.slice().sort((a, b) => b.valor - a.valor).slice(0, 3).map((l) => ({ desc: l.desc, valor: l.valor, tipo: l.tipo, realizado: l.realizado })));
      saldoReal.push(ds <= hojeStr ? saldoRealEm(ds) : null);
      saldoProj.push(ds >= hojeStr ? saldoProjetadoEm(ds) : null);
    }
    const fimDoMes = chave(refAno, refMes, nDias);
    // Mês já encerrado: saldo real no último dia; mês corrente/futuro: projeção com as pendências cadastradas
    const saldoProjetadoFim = fimDoMes <= hojeStr ? saldoRealEm(fimDoMes) : saldoProjetadoEm(fimDoMes);
    // Menor saldo do período: considera o realizado E o projetado (mês encerrado só tem realizado; mês corrente mistura os dois)
    const serieSaldos = saldoReal.concat(saldoProj).filter((v) => v != null);
    const saldoMinimo = serieSaldos.length ? arred(Math.min(...serieSaldos)) : saldoAtual;
    let primeiroDiaNegativo = null;
    for (let i = 0; i < nDias; i++) {
      if (saldoProj[i] != null && saldoProj[i] < 0 && dias[i] > (ehMesAtual ? hojeDia : 0)) { primeiroDiaNegativo = chave(refAno, refMes, dias[i]); break; }
    }
    const serieDiaria = { dias, ...flux, saldoReal, saldoProj, eventos, hojeIdx: ehMesAtual ? hojeDia - 1 : -1 };

    // ---------- Série mensal (6 meses até o mês de referência) ----------
    const serieMensal = [];
    for (let i = 5; i >= 0; i--) {
      const { ano, mes } = mesAnterior(refAno, refMes, i);
      const doMes = lancsFluxo.filter((l) => l.ano === ano && l.mes === mes);
      const e = somar(doMes.filter((l) => l.tipo === 'in'));
      const s = somar(doMes.filter((l) => l.tipo === 'out'));
      serieMensal.push({
        ano, mes, rotulo: MESES_CURTOS[mes - 1] + '/' + String(ano).slice(2),
        entradas: e.realizado, saidas: s.realizado, resultado: arred(e.realizado - s.realizado),
        entradasPrevistas: e.previsto, saidasPrevistas: s.previsto
      });
    }

    // ---------- Comparativo com o mês anterior (até o mesmo dia) ----------
    let comparativo = null;
    if (!todasAsDatas && !ehFuturo) {
      const ant = mesAnterior(refAno, refMes);
      const limiteDia = ehMesAtual ? hojeDia : 31;
      const janela = (a, m, ate) => lancsFluxo.filter((l) => l.ano === a && l.mes === m && l.dia <= ate);
      const atualJanela = janela(refAno, refMes, limiteDia);
      const antJanela = janela(ant.ano, ant.mes, limiteDia);
      const soma = (lista, tipo) => lista.filter((l) => l.tipo === tipo && l.realizado).reduce((s, l) => s + l.valor, 0);
      comparativo = {
        rotulo: 'vs ' + MESES_CURTOS[ant.mes - 1] + (ehMesAtual ? ' (até dia ' + hojeDia + ')' : ''),
        receitas: variacao(soma(atualJanela, 'in'), soma(antJanela, 'in')),
        despesas: variacao(soma(atualJanela, 'out'), soma(antJanela, 'out')),
        resultado: variacao(soma(atualJanela, 'in') - soma(atualJanela, 'out'), soma(antJanela, 'in') - soma(antJanela, 'out'))
      };
      comparativo.resultado.pct = null; // resultado compara em reais (a base pode ser negativa)
    }

    // ---------- Categorias de despesa ----------
    const catMeta = {};
    (ctx.categorias || []).forEach((c) => { if (c && c.name) catMeta[c.name] = c; });
    const porCat = {};
    saidas.forEach((l) => {
      const c = porCat[l.cat] || (porCat[l.cat] = { nome: l.cat, valor: 0, realizado: 0, previsto: 0 });
      c.valor += l.valor;
      if (l.realizado) c.realizado += l.valor; else c.previsto += l.valor;
    });
    const antCat = {};
    const atualCat = {};
    if (!todasAsDatas && !ehFuturo) {
      const ant = mesAnterior(refAno, refMes);
      const limiteDia = ehMesAtual ? hojeDia : 31;
      lancs.filter((l) => l.tipo === 'out' && l.dia <= limiteDia).forEach((l) => {
        if (l.ano === ant.ano && l.mes === ant.mes) antCat[l.cat] = (antCat[l.cat] || 0) + l.valor;
        if (l.ano === refAno && l.mes === refMes) atualCat[l.cat] = (atualCat[l.cat] || 0) + l.valor;
      });
    }
    const totalDespesaCats = Object.values(porCat).reduce((s, c) => s + c.valor, 0);
    const categorias = Object.values(porCat).sort((a, b) => b.valor - a.valor).map((c) => {
      const anterior = antCat[c.nome] || 0;
      const atualJ = atualCat[c.nome] || 0;
      const meta = catMeta[c.nome] || {};
      return {
        nome: c.nome, valor: arred(c.valor), realizado: arred(c.realizado), previsto: arred(c.previsto),
        pct: totalDespesaCats > 0 ? (c.valor / totalDespesaCats) * 100 : 0,
        anterior: arred(anterior), atualJanela: arred(atualJ),
        deltaPct: anterior > 0 ? ((atualJ - anterior) / anterior) * 100 : null,
        deltaValor: arred(atualJ - anterior),
        // Base pequena (menos de R$ 50 no período de comparação): percentual enganaria, então a tela mostra o valor em reais
        baseFraca: anterior < BASE_MINIMA_PERCENTUAL,
        novo: anterior === 0 && atualJ > 0 && Boolean(comparativo),
        cor: meta.color || '#8a93a3', icone: meta.icon || ''
      };
    });

    // ---------- Agenda: vencidas e próximos 30 dias ----------
    const grupos = { vencidas: [], hoje: [], semana: [], mes: [] };
    lancs.filter((l) => !l.realizado && diferencaDias(hojeStr, l.data) <= 30).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0)).forEach((l) => {
      const dd = diferencaDias(hojeStr, l.data);
      const item = { id: l.id, desc: l.desc, cat: l.cat, tipo: l.tipo, valor: l.valor, data: l.data, dias: dd, conta: l.conta };
      if (dd < 0) grupos.vencidas.push(item);
      else if (dd === 0) grupos.hoje.push(item);
      else if (dd <= 7) grupos.semana.push(item);
      else grupos.mes.push(item);
    });
    const soma2 = (arr, tipo) => arred(arr.filter((i) => i.tipo === tipo).reduce((s, i) => s + i.valor, 0));
    const todosAgenda = [...grupos.vencidas, ...grupos.hoje, ...grupos.semana, ...grupos.mes];
    const agenda = {
      grupos,
      itens: todosAgenda,
      qtdVencidas: grupos.vencidas.filter((i) => i.tipo === 'out').length,
      totalVencido: soma2(grupos.vencidas, 'out'),
      totalAPagar: soma2(todosAgenda, 'out'),
      totalAReceber: soma2(todosAgenda, 'in'),
      proximos7Pagar: soma2([...grupos.hoje, ...grupos.semana], 'out')
    };

    // ---------- Últimas movimentações realizadas ----------
    const ultimas = doPeriodo.filter((l) => l.realizado)
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : (Number(b.id) || 0) - (Number(a.id) || 0)))
      .slice(0, 40)
      .map((l) => ({ id: l.id, desc: l.desc, cat: l.cat, tipo: l.tipo, valor: l.valor, data: l.data, conta: l.conta, cor: (catMeta[l.cat] || {}).color || '#8a93a3' }));

    // ---------- Orçamentos ----------
    const orcamentos = (ctx.orcamentos || []).map((b) => {
      const gasto = arred(saidas.filter((l) => l.cat === b.category).reduce((s, l) => s + l.valor, 0));
      const limite = parseValor(b.limit);
      return { categoria: b.category, limite, gasto, pct: limite > 0 ? Math.round((gasto / limite) * 100) : (gasto > 0 ? 100 : 0) };
    }).sort((a, b) => b.pct - a.pct);
    const tempoDecorridoPct = ehMesAtual ? Math.round((hojeDia / nDias) * 100) : (ehFuturo ? 0 : 100);

    // ---------- Cartões ----------
    const cartoes = contas.filter((c) => c.ehCartao);
    const limiteCartoes = cartoes.reduce((s, c) => s + c.limiteTotal, 0);
    const faturaCartoes = cartoes.reduce((s, c) => s + c.fatura, 0);
    // Compras de cartão que não foram vinculadas a um cartão específico (paymentMethod/cat/conta genéricos):
    // entram na dívida total para não ficar nada de fora — só saídas, e nunca as já contadas na fatura de um cartão
    const ehCartaoTxt = (s) => /cart/i.test(String(s || ''));
    const dividaExtra = arred(lancsFluxo
      .filter((l) => l.tipo === 'out' && !l.noCartao && (ehCartaoTxt(l.pm) || ehCartaoTxt(l.cat) || ehCartaoTxt(l.conta)))
      .reduce((s, l) => s + l.valor, 0));
    const cartoesResumo = {
      itens: cartoes, limite: arred(limiteCartoes), fatura: arred(faturaCartoes),
      // Dívida total no cartão = faturas atuais + compras de cartão ainda não alocadas a um cartão específico
      divida: arred(faturaCartoes + dividaExtra),
      dividaExtra,
      disponivel: arred(cartoes.reduce((s, c) => s + c.disponivel, 0)),
      usoPct: limiteCartoes > 0 ? Math.min(100, Math.round((faturaCartoes / limiteCartoes) * 100)) : 0
    };
    const contasBancarias = contas.filter((c) => !c.ehCartao).map((c) => {
      const mov = caixa.filter((l) => (c.txIds || []).map(String).includes(String(l.id)));
      const saldo = arred(c.saldoInicial + mov.filter((l) => l.realizado).reduce((s, l) => s + (l.tipo === 'in' ? l.valor : -l.valor), 0));
      return { id: c.id, nome: c.nome, saldo };
    });
    // Movimentações de caixa sem conta vinculada (ex.: conta genérica "Boleto / Pix / Outros"):
    // entram no "Saldo em contas hoje", então precisam aparecer aqui para a lista fechar com o total
    const idsVinculados = new Set();
    contas.forEach((c) => (c.txIds || []).forEach((id) => idsVinculados.add(String(id))));
    const saldoSemConta = arred(caixa
      .filter((l) => l.realizado && !idsVinculados.has(String(l.id)))
      .reduce((s, l) => s + (l.tipo === 'in' ? l.valor : -l.valor), 0));
    if (Math.abs(saldoSemConta) >= 0.005) {
      contasBancarias.push({ id: null, nome: 'Sem conta vinculada', saldo: saldoSemConta });
    }

    // ---------- Ritmo ----------
    const inicio30 = somarDias(hojeStr, -29);
    const gastos30 = lancs.filter((l) => l.tipo === 'out' && l.realizado && l.data >= inicio30 && l.data <= hojeStr).reduce((s, l) => s + l.valor, 0);
    const mediaDiaria30 = arred(gastos30 / 30);
    const autonomiaDias = saldoAtual > 0 && mediaDiaria30 > 0 ? Math.min(999, Math.floor(saldoAtual / mediaDiaria30)) : null;
    const maiorEntrada = entradas.reduce((m, l) => Math.max(m, l.valor), 0);
    const maiorSaida = saidas.reduce((m, l) => Math.max(m, l.valor), 0);

    // ---------- Acumulado de todos os meses com lançamento realizado (entradas − saídas de toda a base) ----------
    const mesesCadastrados = new Set();
    const porMesAcum = new Map(); // 'AAAA-MM' -> { e, s }
    let acumEntradas = 0;
    let acumSaidas = 0;
    lancsFluxo.forEach((l) => {
      if (!l.realizado) return;
      const chave = l.ano + '-' + String(l.mes).padStart(2, '0');
      mesesCadastrados.add(l.ano + '-' + l.mes);
      const mm = porMesAcum.get(chave) || { e: 0, s: 0 };
      if (l.tipo === 'in') { acumEntradas += l.valor; mm.e += l.valor; } else { acumSaidas += l.valor; mm.s += l.valor; }
      porMesAcum.set(chave, mm);
    });
    // Curva do acumulado mês a mês (ordem cronológica), para o mini-gráfico da seção de saldo
    let accAcum = 0;
    const serieAcumulado = [...porMesAcum.keys()].sort().map((chave) => {
      const partes = chave.split('-');
      const mm = porMesAcum.get(chave);
      accAcum = arred(accAcum + mm.e - mm.s);
      return { ano: Number(partes[0]), mes: Number(partes[1]), rotulo: MESES_CURTOS[Number(partes[1]) - 1] + '/' + partes[0].slice(2), liquido: arred(mm.e - mm.s), acumulado: accAcum };
    });
    const acumulado = { entradas: arred(acumEntradas), saidas: arred(acumSaidas), resultado: arred(acumEntradas - acumSaidas), meses: mesesCadastrados.size, serie: serieAcumulado };

    // ---------- Saúde financeira (0 a 100) ----------
    let score = 55;
    if (receitas.realizado > 0) {
      if (resultadoRealizado > 0) score += 25;
      if (taxaPoupanca >= 20) score += 15; else if (taxaPoupanca >= 10) score += 10;
      if (comprometimento <= 60) score += 10; else if (comprometimento > 85) score -= 15;
    } else if (despesas.realizado === 0) {
      score = 80;
    }
    if (cartoesResumo.usoPct <= 50) score += 5; else if (cartoesResumo.usoPct > 80) score -= 10;
    if (agenda.qtdVencidas > 0) score -= 20;
    score = Math.max(10, Math.min(100, score));
    // Sem nenhuma movimentação no período não há o que avaliar: a nota fica vazia ("--") em vez de inventar "Excelente 85"
    const semDados = receitas.qtd + despesas.qtd === 0;
    const saude = {
      score: semDados ? null : score,
      semDados,
      status: semDados ? 'Sem dados' : (score >= 75 ? 'Excelente' : score >= 50 ? 'Equilibrado' : 'Atenção'),
      nivel: semDados ? 'neutro' : (score >= 75 ? 'bom' : score >= 50 ? 'medio' : 'ruim'),
      pilares: [
        { nome: 'Poupança', valor: taxaPoupanca == null ? 0 : Math.max(0, taxaPoupanca), bom: taxaPoupanca != null && taxaPoupanca >= 20, medio: taxaPoupanca != null && taxaPoupanca >= 10, maisEhMelhor: true },
        { nome: 'Comprometimento', valor: Math.min(100, comprometimento), bom: comprometimento <= 60, medio: comprometimento <= 80, maisEhMelhor: false },
        { nome: 'Uso do cartão', valor: cartoesResumo.usoPct, bom: cartoesResumo.usoPct <= 50, medio: cartoesResumo.usoPct <= 80, maisEhMelhor: false },
        { nome: 'Pontualidade', valor: agenda.qtdVencidas > 0 ? Math.max(0, 100 - agenda.qtdVencidas * 25) : 100, bom: agenda.qtdVencidas === 0, medio: agenda.qtdVencidas === 1, maisEhMelhor: true }
      ]
    };

    // ---------- Avisos (só o que as movimentações cadastradas provam) ----------
    const insights = [];
    if (agenda.qtdVencidas > 0) {
      insights.push({ nivel: 'alerta', prioridade: 1, titulo: agenda.qtdVencidas + (agenda.qtdVencidas === 1 ? ' conta vencida' : ' contas vencidas'), texto: 'Somam ' + fmtBR(agenda.totalVencido) + ' em atraso. Dê baixa assim que pagar.' });
    }
    if (primeiroDiaNegativo) {
      insights.push({ nivel: 'alerta', prioridade: 2, titulo: 'Saldo negativo previsto', texto: 'Pelas pendências cadastradas, as contas ficam abaixo de zero em ' + dataCurta(primeiroDiaNegativo) + '.' });
    }
    if (cartoesResumo.usoPct >= 80) {
      insights.push({ nivel: 'alerta', prioridade: 3, titulo: 'Limite do cartão quase no fim', texto: cartoesResumo.usoPct + '% do limite total está em uso.' });
    }
    const maior = categorias.find((c) => !c.baseFraca && c.deltaPct != null && c.deltaPct >= 25 && c.deltaValor >= 100);
    if (maior && comparativo) {
      insights.push({ nivel: 'atencao', prioridade: 4, titulo: maior.nome + ' subiu ' + Math.round(maior.deltaPct) + '%', texto: '+' + fmtBR(maior.deltaValor) + ' ' + comparativo.rotulo + '.' });
    }
    if (categorias.length && categorias[0].pct >= 40 && categorias.length > 1) {
      insights.push({ nivel: 'info', prioridade: 5, titulo: categorias[0].nome + ' concentra ' + Math.round(categorias[0].pct) + '% dos gastos', texto: 'É a categoria que mais pesa no período.' });
    }
    if (agenda.totalAReceber > 0) {
      insights.push({ nivel: 'info', prioridade: 6, titulo: fmtBR(agenda.totalAReceber) + ' a receber', texto: 'Entradas pendentes nos próximos 30 dias entram na projeção do saldo.' });
    }
    if (taxaPoupanca != null && taxaPoupanca >= 20) {
      insights.push({ nivel: 'ok', prioridade: 7, titulo: 'Você guardou ' + taxaPoupanca + '% da renda', texto: 'Acima da meta de 20% sobre o que já entrou no período.' });
    }
    insights.sort((a, b) => a.prioridade - b.prioridade);

    return {
      hoje: hojeStr, hojeDia, periodo: { ano: refAno, mes: refMes, rotulo, todasAsDatas, ehMesAtual, ehFuturo, diasNoMes: nDias },
      vazio: lancs.length === 0,
      totais: { receitas, despesas, resultadoRealizado, resultadoPrevisto, taxaPoupanca, comprometimento },
      comparativo,
      contas: { saldoInicial, saldoAtual, disponivelGastar, saldoProjetadoFim, saldoMinimo, primeiroDiaNegativo, bancarias: contasBancarias, cartoes: cartoesResumo },
      serieDiaria, serieMensal, categorias, totalDespesaCats: arred(totalDespesaCats), acumulado,
      agenda, ultimas, orcamentos, tempoDecorridoPct,
      ritmo: { mediaDiaria30, autonomiaDias, maiorEntrada: arred(maiorEntrada), maiorSaida: arred(maiorSaida) },
      saude, insights: insights.slice(0, 3)
    };
  }

  // Menor saldo previsto nas contas e o dia em que acontece (null quando o período não tem projeção, como um mês já encerrado)
  function menorSaldoProjetado(serie) {
    let melhor = null;
    ((serie && serie.saldoProj) || []).forEach((v, i) => {
      if (v != null && (melhor === null || v < melhor.valor)) melhor = { valor: v, dia: serie.dias[i], idx: i };
    });
    return melhor;
  }

  // Menor saldo já realizado no período (fallback para meses encerrados, que não têm projeção)
  function menorSaldoRealizado(serie) {
    let melhor = null;
    ((serie && serie.saldoReal) || []).forEach((v, i) => {
      if (v != null && (melhor === null || v < melhor.valor)) melhor = { valor: v, dia: serie.dias[i], idx: i };
    });
    return melhor;
  }

  // Cada elemento clicável do painel carrega o destino em data-fd-*; esta função devolve só o que a lista de movimentações aceita
  const STATUS_VALIDOS = ['Pago', 'Recebido', 'Pendente'];
  function filtrosDeAtalho(ds) {
    const d = ds || {};
    return {
      tipo: d.fdTipo === 'in' || d.fdTipo === 'out' ? d.fdTipo : '',
      status: STATUS_VALIDOS.includes(d.fdStatus) ? d.fdStatus : '',
      cat: String(d.fdCat || ''),
      conta: String(d.fdConta || '')
    };
  }

  // ======================================================================
  // Tela (HTML)
  // ======================================================================
  const estado = { visao: 'saldo', filtro: 'all', aba: 'agenda', tabela: false, modelo: null, util: null, ativo: false, grafico: null };

  const svg = (corpo, tam, sw) => '<svg width="' + (tam || 15) + '" height="' + (tam || 15) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 2.2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + corpo + '</svg>';
  const ICONES = {
    seta: svg('<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>', 14, 2.4),
    check: svg('<polyline points="20 6 9 17 4 12"/>', 13, 2.8),
    alerta: svg('<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'),
    info: svg('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
    tabela: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v16"/>', 13),
    receita: svg('<path d="M17 7 7 17"/><path d="M17 17H7V7"/>', 16, 2.4),
    despesa: svg('<path d="M7 7h10v10"/><path d="M7 17 17 7"/>', 16, 2.4),
    resultado: svg('<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>', 16),
    cartao: svg('<rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/>', 16),
    carteira: svg('<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>', 16),
    atualizar: svg('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', 16),
    mais: svg('<path d="M12 5v14"/><path d="M5 12h14"/>', 14, 2.6),
    olho: svg('<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>', 14),
    olhoFechado: svg('<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/>', 14)
  };

  const fmtU = (v) => ((estado.util && estado.util.fmt) || fmtBR)(v);
  const dinheiro = (v) => '<span class="fd-money">' + esc(fmtU(v)) + '</span>';
  const dinheiroSinal = (v, tipo) => '<span class="fd-money">' + (tipo === 'in' ? '+' : '−') + esc(fmtU(v)) + '</span>';

  // Atributos de um elemento clicável: um único ouvinte no documento (ver ligarOuvintes) leva até a tela de destino
  function atalho(f) {
    const o = f || {};
    if (o.pagina) return ' role="link" tabindex="0" data-fd-ir="' + esc(o.pagina) + '"';
    return ' role="link" tabindex="0" data-fd-ir="mov"' + ['tipo', 'status', 'cat', 'conta'].filter((k) => o[k]).map((k) => ' data-fd-' + k + '="' + esc(o[k]) + '"').join('');
  }

  // Variação contra o mês anterior. "boaSe": se subir é bom (receitas) ou ruim (despesas). Cor + seta + sinal: nunca só cor.
  function chipVariacao(v, boaSe, rotulo, emReais) {
    if (!v) return '';
    const rot = rotulo ? ' <span class="fd-delta-rot">' + esc(rotulo) + '</span>' : '';
    // Sem base de comparação (mês anterior zerado): só avisa que é novo, sem inventar percentual
    if (!emReais && v.pct == null) return v.atual > 0 ? '<span class="fd-delta fd-neutro" title="Sem valor no período de comparação">novo</span>' + rot : '';
    const base = emReais ? v.diff : v.pct;
    const estavel = emReais ? Math.abs(v.diff) < 0.005 : Math.round(v.pct) === 0;
    if (estavel) return '<span class="fd-delta fd-neutro" title="Igual ao período de comparação">= estável</span>' + rot;
    const sobe = base > 0;
    const bom = boaSe === 'subir' ? sobe : !sobe;
    const texto = emReais ? fmtU(Math.abs(v.diff)) : Math.round(Math.abs(v.pct)) + '%';
    const dica = 'Atual: ' + fmtU(v.atual) + ' · Anterior: ' + fmtU(v.anterior);
    return '<span class="fd-delta ' + (bom ? 'fd-bom' : 'fd-ruim') + (emReais ? ' fd-money' : '') + '" title="' + esc(dica) + '">' + (sobe ? '▲' : '▼') + ' ' + esc(texto) + '</span>' + rot;
  }

  // Valor grande dos cartões do topo; "cls" pinta o número (fd-val-in / fd-val-out) quando o sinal importa
  const valorTile = (v, cls) => '<div class="fd-tile-valor fd-money' + (cls ? ' ' + cls : '') + '" data-anim-val="' + v + '">' + esc(fmtU(v)) + '</div>';

  function cabecalho(m, util) {
    const saud = util.saudacao ? util.saudacao() : { text: 'Olá' };
    const oculto = typeof document !== 'undefined' && document.body && document.body.classList.contains('hide-sensitive-balances');
    const feitas = m.totais.receitas.qtdRealizado + m.totais.despesas.qtdRealizado;
    // Sem moldura: a saudação fica direto sobre o fundo. O horário é o botão de atualizar (o carimbo é preenchido por carimbarAtualizacao)
    return '<header class="fd-cabecalho">' +
      '<div class="fd-cab-esq"><div class="fd-data">' + esc(util.dataHoje ? util.dataHoje() : m.hoje) + '</div>' +
      '<h1 class="fd-saudacao">' + esc(saud.text) + ', <strong class="fd-nome">' + esc(util.primeiroNome || 'Usuário') + '</strong></h1>' +
      '<p class="fd-sub">' + esc(m.periodo.rotulo) + ' • ' + feitas + (feitas === 1 ? ' movimentação realizada' : ' movimentações realizadas') +
      ' <button type="button" class="fd-atualiza" data-fd-acao="atualizar" title="Atualizar os dados agora" aria-label="Atualizar os dados">até às <span id="fdAtualizadoEm">--:--</span></button></p></div>' +
      '<div class="fd-cab-dir">' + (util.periodPickerHTML ? util.periodPickerHTML() : '') +
      '<button type="button" class="fd-btn fd-privacidade" onclick="window.toggleSensitiveBalances()" id="btnToggleBalances" title="Ocultar ou exibir saldos">' +
      '<span id="btnEyeIcon">' + (oculto ? ICONES.olhoFechado : ICONES.olho) + '</span><span id="btnEyeText">' + (oculto ? 'Exibir Saldos' : 'Ocultar Saldos') + '</span></button>' +
      '<div class="fd-acoes-rapidas">' +
      '<button type="button" class="fd-btn fd-btn-receita" data-fd-acao="nova-receita" title="Lançar uma receita">' + ICONES.mais + '<span>Receita</span></button>' +
      '<button type="button" class="fd-btn fd-btn-despesa" data-fd-acao="nova-despesa" title="Lançar uma despesa">' + ICONES.mais + '<span>Despesa</span></button></div>' +
      '</div></header>';
  }

  function blocoAvisos(m) {
    if (!m.insights.length) return '';
    return '<div class="fd-avisos" role="list">' + m.insights.map((i) =>
      '<div class="fd-aviso fd-vidro fd-aviso-' + i.nivel + '" role="listitem"><span class="fd-aviso-ic">' + (i.nivel === 'alerta' || i.nivel === 'atencao' ? ICONES.alerta : i.nivel === 'ok' ? ICONES.check : ICONES.info) + '</span>' +
      '<div><strong>' + esc(i.titulo) + '</strong><span>' + esc(i.texto) + '</span></div></div>').join('') + '</div>';
  }

  // Cartão do topo: rótulo + ícone, número grande e uma ou duas linhas de apoio
  function tileKpi(o) {
    return '<div class="fd-tile fd-vidro fd-clicavel ' + (o.classe || '') + '"' + atalho(o.ir) + ' title="' + esc(o.dica) + '">' +
      '<div class="fd-tile-topo"><span class="fd-tile-rotulo">' + esc(o.rotulo) + '</span><span class="fd-ic ' + o.tom + '">' + o.icone + '</span></div>' +
      o.valorHtml + '<div class="fd-tile-rodape">' + o.linhas.filter(Boolean).map((l) => '<div class="fd-tile-linha">' + l + '</div>').join('') + '</div></div>';
  }

  // Quatro cartões iguais: Receitas, Despesas, Disponível p/ gastar e Dívida nos cartões
  function blocoKpis(m) {
    const c = m.contas;
    const t = m.totais;
    const cmp = m.comparativo;
    const cartoes = c.cartoes;
    const dividaTotal = cartoes.divida != null ? cartoes.divida : cartoes.fatura;
    const semMov = t.receitas.qtd + t.despesas.qtd === 0;
    const recebido = t.receitas.qtd
      ? 'Recebido ' + dinheiro(t.receitas.realizado) + ' · A receber ' + dinheiro(t.receitas.previsto)
      : 'A receber: ' + dinheiro(0);
    const pago = t.despesas.qtd
      ? 'Pago ' + dinheiro(t.despesas.realizado) + ' · A pagar ' + dinheiro(t.despesas.previsto)
      : 'Sem lançamentos no período';
    const formula = semMov && c.saldoAtual === 0
      ? 'Saldo + A receber − A pagar'
      : 'Saldo ' + dinheiro(c.saldoAtual) + ' + A receber ' + dinheiro(t.receitas.previsto) + ' − A pagar ' + dinheiro(t.despesas.previsto);
    const tiles =
      tileKpi({
        rotulo: 'Receitas', tom: 'fd-ic-in', icone: ICONES.receita, ir: { tipo: 'in' }, dica: 'Ver as receitas em Movimentações', classe: 'fd-tile-in',
        valorHtml: valorTile(t.receitas.total), linhas: [recebido, cmp ? chipVariacao(cmp.receitas, 'subir', cmp.rotulo) : '']
      }) +
      tileKpi({
        rotulo: 'Despesas', tom: 'fd-ic-out', icone: ICONES.despesa, ir: { tipo: 'out' }, dica: 'Ver as despesas em Movimentações', classe: 'fd-tile-out',
        valorHtml: valorTile(t.despesas.total), linhas: [pago, cmp ? chipVariacao(cmp.despesas, 'descer', cmp.rotulo) : '']
      }) +
      tileKpi({
        rotulo: 'Disponível p/ gastar', tom: 'fd-ic-disp', icone: ICONES.carteira, ir: {}, dica: 'Saldo em contas + o que falta receber − o que falta pagar: quanto ainda pode ser gasto',
        classe: 'fd-tile-disp',
        valorHtml: valorTile(c.disponivelGastar, c.disponivelGastar < 0 ? 'fd-val-out' : (c.disponivelGastar > 0 ? 'fd-val-in' : '')), linhas: [formula]
      }) +
      tileKpi({
        rotulo: 'Dívida nos cartões', tom: 'fd-ic-neutro', icone: ICONES.cartao, ir: { pagina: 'cartoes' }, dica: 'Total devido em todos os cartões de crédito cadastrados (todas as faturas)',
        classe: 'fd-tile-neutro',
        valorHtml: valorTile(dividaTotal),
        linhas: cartoes.itens.length
          ? [cartoes.usoPct + '% do limite · ' + (cartoes.disponivel < 0 ? dinheiro(Math.abs(cartoes.disponivel)) + ' acima do limite' : dinheiro(cartoes.disponivel) + ' livres'),
            '<div class="fd-meter" role="img" aria-label="Uso do limite ' + cartoes.usoPct + '%"><i class="' + (cartoes.usoPct >= 85 ? 'fd-m-ruim' : cartoes.usoPct >= 60 ? 'fd-m-medio' : 'fd-m-bom') + '" style="width:' + Math.min(100, cartoes.usoPct) + '%"></i></div>']
          : [dividaTotal > 0 ? 'Há compras no cartão, mas nenhum cartão cadastrado · cadastre em Contas e Cartões' : 'Nenhum cartão cadastrado']
      });
    return '<div class="fd-kpis" aria-label="Resumo do período">' + tiles + '</div>';
  }

  function abasGrafico() {
    const abas = [['saldo', 'Saldo projetado'], ['mensal', 'Entradas e saídas · 6 meses'], ['diario', 'Dia a dia']];
    return '<div class="fd-abas" role="tablist" aria-label="Visão do gráfico">' + abas.map(([id, nome]) =>
      '<button type="button" role="tab" class="fd-aba' + (estado.visao === id ? ' ativa' : '') + '" aria-selected="' + (estado.visao === id) + '" data-fd-visao="' + id + '" onclick="NexusDash.mudarVisao(\'' + id + '\')">' + esc(nome) + '</button>').join('') + '</div>';
  }

  function textoGrafico(m) {
    if (estado.visao === 'mensal') return 'Realizado em cada mês — o mês de referência é o último';
    if (estado.visao === 'diario') return 'Entradas e saídas de ' + m.periodo.rotulo + ' (as previstas em tom mais claro)';
    return m.periodo.ehFuturo ? 'Projeção do saldo a partir das pendências cadastradas' : 'Saldo em contas ao fim de cada dia · realizado até ontem, hoje e projeção com as pendências';
  }

  function blocoGrafico(m) {
    const r = m.ritmo;
    // Menor saldo do período (previsto, quando há projeção) e o dia em que acontece: avisa antes do caixa ficar no vermelho
    const minProj = menorSaldoProjetado(m.serieDiaria);
    const minimo = minProj || menorSaldoRealizado(m.serieDiaria);
    const quandoMin = minimo ? (m.periodo.ehMesAtual && minimo.dia === m.hojeDia ? 'hoje' : 'em ' + pad(minimo.dia) + '/' + pad(m.periodo.mes)) : '';
    const metricaMinimo = minimo ? metrica(minProj ? 'Menor saldo previsto' : 'Menor saldo', '<span class="' + (minimo.valor < 0 ? 'fd-sai-neg' : '') + '">' + dinheiro(minimo.valor) + '</span>', quandoMin) : '';
    // Sem nenhuma movimentação o gráfico mostra só o eixo, com um aviso honesto por cima (nada de barras inventadas)
    const aviso = m.vazio ? '<div class="fd-grafico-aviso"><strong>Sem movimentações em ' + esc(m.periodo.rotulo) + '</strong><span>O fluxo de caixa aparece assim que você cadastrar receitas e despesas.</span></div>' : '';
    return '<article class="fd-card fd-vidro fd-card-grafico">' +
      '<div class="fd-card-topo"><div><h2 class="fd-titulo">Fluxo de caixa</h2><p class="fd-legenda" id="fdLegendaGrafico">' + esc(textoGrafico(m)) + '</p></div>' +
      '<div class="fd-topo-acoes">' + abasGrafico() +
      '<button type="button" class="fd-btn-tabela' + (estado.tabela ? ' ativa' : '') + '" onclick="NexusDash.alternarTabela()" aria-pressed="' + estado.tabela + '" title="Ver os mesmos dados em tabela">' + ICONES.tabela + ' Tabela</button></div></div>' +
      '<div class="fd-grafico-caixa fd-grafico-caixa-saldo" id="fdGraficoCaixa"' + (estado.tabela ? ' hidden' : '') + '><canvas id="fdChartPrincipal" role="img" aria-label="Gráfico de fluxo de caixa"></canvas>' + aviso + '</div>' +
      '<div class="fd-tabela-caixa" id="fdTabelaCaixa"' + (estado.tabela ? '' : ' hidden') + '>' + tabelaDados(m) + '</div>' +
      '<div class="fd-metricas">' + metricaMinimo +
        metrica('Média diária de gastos', r.mediaDiaria30 > 0 ? dinheiro(r.mediaDiaria30) : '—', r.mediaDiaria30 > 0 ? '30 dias' : 'sem gastos pagos') +
        metrica('Autonomia', r.autonomiaDias == null ? (r.mediaDiaria30 <= 0 && m.contas.saldoAtual > 0 ? 'Sem limite' : '—') : r.autonomiaDias + (r.autonomiaDias === 1 ? ' dia' : ' dias'), r.mediaDiaria30 > 0 ? 'saldo ÷ gasto diário' : '') +
        metrica('Maior entrada', dinheiro(r.maiorEntrada), '') +
        metrica('Maior saída', dinheiro(r.maiorSaida), '') +
      '</div></article>';
  }
  // Rótulo em cima; embaixo o valor e a nota curta na mesma linha (quebra só se faltar largura)
  const metrica = (rot, valor, nota) => '<div class="fd-metrica"><span>' + rot + '</span><div class="fd-metrica-v"><strong>' + valor + '</strong>' + (nota ? '<em>' + nota + '</em>' : '') + '</div></div>';

  function tabelaDados(m) {
    if (estado.visao === 'mensal') {
      return '<table class="fd-tabela"><caption class="fd-so-leitor">Entradas e saídas realizadas por mês</caption><thead><tr><th>Mês</th><th>Entradas</th><th>Saídas</th><th>Resultado</th></tr></thead><tbody>' +
        m.serieMensal.map((s) => '<tr><td>' + esc(s.rotulo) + '</td><td>' + dinheiro(s.entradas) + '</td><td>' + dinheiro(s.saidas) + '</td><td>' + dinheiro(s.resultado) + '</td></tr>').join('') + '</tbody></table>';
    }
    const d = m.serieDiaria;
    const linhas = d.dias.map((dia, i) => ({ dia, i })).filter(({ i }) => d.saldoReal[i] != null || d.saldoProj[i] != null || d.in[i] || d.out[i] || d.inPrev[i] || d.outPrev[i]);
    if (estado.visao === 'diario') {
      return '<table class="fd-tabela"><caption class="fd-so-leitor">Entradas e saídas por dia</caption><thead><tr><th>Dia</th><th>Entradas</th><th>Saídas</th><th>Previsto a receber</th><th>Previsto a pagar</th></tr></thead><tbody>' +
        linhas.filter(({ i }) => d.in[i] || d.out[i] || d.inPrev[i] || d.outPrev[i]).map(({ dia, i }) => '<tr><td>' + pad(dia) + '/' + pad(m.periodo.mes) + '</td><td>' + dinheiro(d.in[i]) + '</td><td>' + dinheiro(d.out[i]) + '</td><td>' + dinheiro(d.inPrev[i]) + '</td><td>' + dinheiro(d.outPrev[i]) + '</td></tr>').join('') + '</tbody></table>';
    }
    return '<table class="fd-tabela"><caption class="fd-so-leitor">Saldo em contas por dia</caption><thead><tr><th>Dia</th><th>Saldo realizado</th><th>Saldo projetado</th></tr></thead><tbody>' +
      linhas.map(({ dia, i }) => '<tr><td>' + pad(dia) + '/' + pad(m.periodo.mes) + '</td><td>' + (d.saldoReal[i] == null ? '—' : dinheiro(d.saldoReal[i])) + '</td><td>' + (d.saldoProj[i] == null ? '—' : dinheiro(d.saldoProj[i])) + '</td></tr>').join('') + '</tbody></table>';
  }

  // Para onde vai o dinheiro: rosca com as 5 maiores categorias (o resto vira "Outras") e a lista ao lado com valor e %.
  // Cada linha leva às despesas da categoria. Sem despesas: rosca apagada, explicação e o botão de cadastrar.
  function blocoCategorias(m) {
    const lista = m.categorias;
    let corpo;
    if (!lista.length) {
      corpo = '<div class="fd-rosca-vazia"><span class="fd-rosca-box"><span class="fd-rosca fd-rosca-fantasma" aria-hidden="true"></span></span>' +
        '<div class="fd-vazio"><strong>Nenhuma despesa no período.</strong><span>Cadastre movimentações para ver para onde vai o seu dinheiro.</span></div>' +
        '<button type="button" class="fd-btn" data-fd-acao="nova-despesa">' + ICONES.mais + '<span>Cadastrar movimentação</span></button></div>';
    } else {
      const topo = lista.slice(0, 5);
      const resto = lista.slice(5);
      const fatias = topo.map((c) => ({ nome: c.nome, cor: c.cor, pct: c.pct, valor: c.valor, ir: c.nome }))
        .concat(resto.length ? [{ nome: 'Outras (' + resto.length + ')', cor: '#8a93a3', pct: resto.reduce((s, c) => s + c.pct, 0), valor: resto.reduce((s, c) => s + c.valor, 0), ir: null }] : []);
      let acc = 0;
      const paradas = fatias.map((f) => { const ini = acc; acc += f.pct; return f.cor + ' ' + ini.toFixed(2) + '% ' + Math.min(100, acc).toFixed(2) + '%'; }).join(', ');
      const descricao = fatias.map((f) => f.nome + ' ' + Math.round(f.pct) + '%').join(', ');
      corpo = '<div class="fd-rosca-caixa"><div class="fd-rosca-box"><span class="fd-rosca" role="img" aria-label="Despesas por categoria: ' + esc(descricao) + '" style="background:conic-gradient(' + paradas + ')"></span>' +
        '<div class="fd-rosca-centro"><strong class="fd-money">' + esc(fmtU(m.totalDespesaCats)) + '</strong><span>em despesas</span></div></div>' +
        '<ul class="fd-rosca-leg">' + fatias.map((f) =>
          '<li class="' + (f.ir ? 'fd-clicavel' : '') + '"' + (f.ir ? atalho({ tipo: 'out', cat: f.ir }) + ' title="Ver as despesas de ' + esc(f.nome) + '"' : '') + '>' +
          '<i class="fd-bolinha" style="background:' + esc(f.cor) + '"></i><span class="fd-leg-nome">' + esc(f.nome) + '<small class="fd-money">' + esc(fmtU(f.valor)) + '</small></span><b>' + Math.round(f.pct) + '%</b></li>').join('') + '</ul></div>';
    }
    return '<article class="fd-card fd-vidro fd-card-categorias"><div class="fd-card-topo"><div><h2 class="fd-titulo">Para onde vai o dinheiro</h2><p class="fd-legenda">Despesas de ' + esc(m.periodo.rotulo) + ' · pagas e a pagar</p></div></div>' + corpo + '</article>';
  }

  function linhaAgenda(i, hojeStr) {
    const entra = i.tipo === 'in';
    const quando = i.dias < 0 ? 'há ' + Math.abs(i.dias) + (Math.abs(i.dias) === 1 ? ' dia' : ' dias') : i.dias === 0 ? 'hoje' : i.dias === 1 ? 'amanhã' : 'em ' + i.dias + ' dias';
    return '<li class="fd-ag-item' + (i.dias < 0 ? ' fd-ag-atraso' : '') + '">' +
      '<div class="fd-ag-data"><strong>' + esc(dataCurta(i.data)) + '</strong><span>' + esc(diaSemana(i.data)) + '</span></div>' +
      '<div class="fd-ag-info"><strong>' + esc(i.desc) + '</strong><span>' + esc(i.cat) + ' · ' + quando + '</span></div>' +
      '<div class="fd-ag-valor ' + (entra ? 'fd-entra' : 'fd-sai') + '">' + dinheiroSinal(i.valor, i.tipo) + '</div>' +
      '<button type="button" class="fd-btn-baixa" data-paytx="' + esc(i.id) + '" title="' + (entra ? 'Marcar como recebido' : 'Marcar como pago') + '">' + ICONES.check + '<span>' + (entra ? 'Receber' : 'Pagar') + '</span></button></li>';
  }

  function corpoAgenda(m) {
    const a = m.agenda;
    const secoes = [['Vencidas', a.grupos.vencidas, 'fd-grupo-ruim'], ['Hoje', a.grupos.hoje, ''], ['Próximos 7 dias', a.grupos.semana, ''], ['Até 30 dias', a.grupos.mes, '']];
    let restante = 8;
    let corpo = '';
    secoes.forEach(([nome, itens, classe]) => {
      if (!itens.length || restante <= 0) return;
      const mostrar = itens.slice(0, restante);
      restante -= mostrar.length;
      corpo += '<div class="fd-grupo ' + classe + '"><h3>' + nome + ' <em>' + itens.length + '</em></h3><ul class="fd-ag-lista">' + mostrar.map((i) => linhaAgenda(i, m.hoje)).join('') + '</ul></div>';
    });
    const ocultos = a.itens.length - (8 - restante);
    if (!a.itens.length) corpo = '<div class="fd-vazio fd-vazio-ok"><strong>Nada para pagar ou receber nos próximos 30 dias.</strong><span>Tudo em dia por aqui.</span></div>';
    return corpo + (ocultos > 0 ? '<button type="button" class="fd-link" data-fd-ir="mov" data-fd-status="Pendente">+ ' + ocultos + ' lançamento' + (ocultos === 1 ? '' : 's') + ' · ver todos ' + ICONES.seta + '</button>' : '');
  }

  function medidor(valor, nivelClasse, rotulo) {
    return '<div class="fd-meter" role="img" aria-label="' + esc(rotulo) + '"><i class="' + nivelClasse + '" style="width:' + Math.max(0, Math.min(100, valor)) + '%"></i></div>';
  }

  // Saúde financeira: caixa com a nota ("--" enquanto não há movimentações) e, ao lado, a nota e os pilares com barras
  function blocoSaude(m) {
    const s = m.saude;
    const nivelCls = s.nivel === 'bom' ? 'fd-m-bom' : s.nivel === 'medio' ? 'fd-m-medio' : s.nivel === 'ruim' ? 'fd-m-ruim' : 'fd-m-neutro';
    const temCartao = m.contas.cartoes.itens.length > 0;
    const linhas = [{ nome: 'Score', texto: s.semDados ? '-- / 100' : s.score + ' / 100', valor: s.semDados ? 0 : s.score, nivel: nivelCls }]
      .concat(s.pilares.filter((p) => p.nome !== 'Uso do cartão' || temCartao).map((p) => ({
        nome: p.nome, texto: Math.round(p.valor) + '%', valor: p.valor,
        nivel: s.semDados && p.nome !== 'Pontualidade' ? 'fd-m-neutro' : (p.bom ? 'fd-m-bom' : p.medio ? 'fd-m-medio' : 'fd-m-ruim')
      })));
    return '<article class="fd-card fd-vidro fd-card-saude"><div class="fd-card-topo"><div><h2 class="fd-titulo">Saúde financeira</h2><p class="fd-legenda">Nota atualizada com as movimentações</p></div></div>' +
      '<div class="fd-saude-corpo"><div class="fd-nota-caixa"><div class="fd-nota-num">' + (s.semDados ? '--' : s.score) + '<small> / 100</small></div>' +
      '<div class="fd-nota-status' + (s.semDados ? '' : ' fd-nota-' + s.nivel) + '">' + esc(s.status) + '</div>' +
      '<p class="fd-nota-dica">' + (s.semDados ? 'Cadastre suas primeiras movimentações para calcular seu score.' : 'Calculada com as movimentações do período.') + '</p></div>' +
      '<div class="fd-saude-linhas">' + linhas.map((l) => '<div class="fd-saude-linha"><div class="fd-pilar-topo"><span>' + esc(l.nome) + '</span><strong>' + esc(l.texto) + '</strong></div>' + medidor(l.valor, l.nivel, l.nome + ' ' + l.texto) + '</div>').join('') + '</div></div></article>';
  }

  function blocoContas(m) {
    const c = m.contas;
    const bancos = c.bancarias.length
      ? '<ul class="fd-lista-simples">' + c.bancarias.map((b) => '<li class="fd-clicavel"' + atalho({ conta: b.nome }) + ' title="Ver as movimentações de ' + esc(b.nome) + '"><span>' + esc(b.nome) + '</span><strong class="' + (b.saldo < 0 ? 'fd-sai' : '') + '">' + dinheiro(b.saldo) + '</strong></li>').join('') + '</ul>'
      : '<div class="fd-vazio"><strong>Nenhuma conta bancária cadastrada.</strong></div><button type="button" class="fd-btn fd-btn-centro" data-fd-ir="cartoes">' + ICONES.mais + '<span>Cadastrar conta</span></button>';
    const cartoes = c.cartoes.itens.length
      ? '<p class="fd-legenda" style="margin:0 0 6px">Dívida total nos cartões: <strong class="fd-money">' + esc(fmtU(c.cartoes.divida != null ? c.cartoes.divida : c.cartoes.fatura)) + '</strong>' +
        ' <span style="opacity:.75">(' + c.cartoes.itens.map((k) => esc(k.nome) + ' ' + esc(fmtU(k.fatura))).join(' · ') +
        (c.cartoes.dividaExtra > 0 ? ' · não identificados ' + esc(fmtU(c.cartoes.dividaExtra)) : '') + ')</span></p>' +
        '<ul class="fd-cartoes">' + c.cartoes.itens.map((k) => '<li class="fd-clicavel"' + atalho({ conta: k.nome }) + ' title="Ver as movimentações de ' + esc(k.nome) + '"><div class="fd-cartao-topo"><span>' + esc(k.nome) + '</span><strong>' + k.usoPct + '%</strong></div>' +
        medidor(k.usoPct, k.usoPct >= 85 ? 'fd-m-ruim' : k.usoPct >= 60 ? 'fd-m-medio' : 'fd-m-bom', k.nome + ' ' + k.usoPct + '% do limite') +
        '<div class="fd-cartao-nota"><span>Fatura ' + dinheiro(k.fatura) + '</span><span>' + (k.disponivel < 0 ? 'Acima do limite ' + dinheiro(Math.abs(k.disponivel)) : 'Livre ' + dinheiro(k.disponivel)) + '</span></div></li>').join('') + '</ul>'
      : '';
    return '<article class="fd-card fd-vidro fd-card-contas"><div class="fd-card-topo"><div><h2 class="fd-titulo">Contas e cartões</h2></div>' +
      (c.bancarias.length || c.cartoes.itens.length ? '<button type="button" class="fd-link fd-link-topo" data-fd-ir="cartoes">Gerenciar</button>' : '') + '</div>' +
      bancos + (cartoes ? '<h3 class="fd-sub-titulo">Cartões de crédito</h3>' + cartoes : '') + '</article>';
  }

  function blocoOrcamentos(m) {
    if (!m.orcamentos.length) return '';
    const marcador = m.tempoDecorridoPct;
    return '<article class="fd-card fd-vidro"><div class="fd-card-topo"><div><h2 class="fd-titulo">Orçamentos</h2><p class="fd-legenda">Gasto contra o limite · o traço marca o tempo do mês (' + marcador + '%)</p></div>' +
      '<button type="button" class="fd-link fd-link-topo" data-fd-ir="orcamentos">Ajustar</button></div>' +
      '<ul class="fd-orcamentos">' + m.orcamentos.slice(0, 5).map((o) => {
        const nivel = o.pct > 100 ? 'fd-m-ruim' : o.pct > marcador + 10 || o.pct >= 90 ? 'fd-m-medio' : 'fd-m-bom';
        return '<li class="fd-clicavel"' + atalho({ tipo: 'out', cat: o.categoria }) + ' title="Ver as despesas de ' + esc(o.categoria) + '"><div class="fd-cartao-topo"><span>' + esc(o.categoria) + '</span><strong>' + o.pct + '%</strong></div>' +
          '<div class="fd-meter fd-meter-marca" role="img" aria-label="' + esc(o.categoria) + ': ' + o.pct + '% do limite"><i class="' + nivel + '" style="width:' + Math.min(100, o.pct) + '%"></i><b style="left:' + marcador + '%" title="Tempo decorrido do mês"></b></div>' +
          '<div class="fd-cartao-nota"><span>' + dinheiro(o.gasto) + ' de ' + dinheiro(o.limite) + '</span><span>' + (o.limite - o.gasto >= 0 ? 'Sobram ' + dinheiro(o.limite - o.gasto) : 'Estourou ' + dinheiro(o.gasto - o.limite)) + '</span></div></li>';
      }).join('') + '</ul></article>';
  }

  function linhasUltimas(m, filtro) {
    const lista = m.ultimas.filter((u) => filtro === 'all' || u.tipo === filtro).slice(0, 5);
    if (!lista.length) return '<div class="fd-vazio"><strong>Nenhuma movimentação realizada</strong><span>As movimentações pagas ou recebidas do período aparecem aqui.</span></div>';
    return '<ul class="fd-ult-lista">' + lista.map((u) =>
      '<li class="fd-ult-item"><div class="fd-ult-data">' + esc(dataCurta(u.data)) + '</div>' +
      '<div class="fd-ult-info"><strong>' + esc(u.desc || 'Sem descrição') + '</strong><span><i class="fd-bolinha" style="background:' + esc(u.cor) + '"></i>' + esc(u.cat) + (u.conta ? ' · ' + esc(u.conta) : '') + '</span></div>' +
      '<div class="fd-ult-valor ' + (u.tipo === 'in' ? 'fd-entra' : 'fd-sai') + '">' + dinheiroSinal(u.valor, u.tipo) + '</div></li>').join('') + '</ul>';
  }

  // Lado direito do cabeçalho do cartão de contas: totais da agenda ou filtros + extrato, conforme a aba
  function ladoAgenda(m, aba) {
    if (aba === 'ultimas') {
      const filtros = [['all', 'Todas'], ['in', 'Receitas'], ['out', 'Despesas']];
      return '<div class="fd-abas fd-abas-peq" role="group" aria-label="Filtrar movimentações">' + filtros.map(([id, nome]) =>
        '<button type="button" class="fd-aba' + (estado.filtro === id ? ' ativa' : '') + '" data-fd-filtro="' + id + '" onclick="NexusDash.filtrarUltimas(\'' + id + '\')">' + nome + '</button>').join('') + '</div>' +
        '<button type="button" class="fd-link fd-link-topo" id="fdVerExtrato" data-fd-ir="mov"' + (estado.filtro !== 'all' ? ' data-fd-tipo="' + estado.filtro + '"' : '') + '>Ver extrato ' + ICONES.seta + '</button>';
    }
    const a = m.agenda;
    // Os dois totais levam às pendências do tipo correspondente
    return '<div class="fd-resumo-agenda"><span class="fd-clicavel"' + atalho({ tipo: 'out', status: 'Pendente' }) + ' title="Ver as despesas pendentes"><em>A pagar</em>' + dinheiro(a.totalAPagar) + '</span>' +
      '<span class="fd-clicavel"' + atalho({ tipo: 'in', status: 'Pendente' }) + ' title="Ver as receitas pendentes"><em>A receber</em>' + dinheiro(a.totalAReceber) + '</span></div>';
  }

  // Um cartão com duas abas no título: "Contas dos próximos 30 dias" e "Últimas movimentações"
  function blocoAgendaUltimas(m) {
    const aba = estado.aba === 'ultimas' ? 'ultimas' : 'agenda';
    const titulos = [['agenda', 'Contas dos próximos 30 dias'], ['ultimas', 'Últimas movimentações']];
    return '<article class="fd-card fd-vidro fd-card-agenda"><div class="fd-card-topo">' +
      '<div class="fd-titulo-abas" role="tablist" aria-label="Contas e movimentações">' + titulos.map(([id, nome]) =>
        '<button type="button" role="tab" class="fd-tab-titulo' + (aba === id ? ' ativa' : '') + '" aria-selected="' + (aba === id) + '" data-fd-aba="' + id + '" onclick="NexusDash.mudarAba(\'' + id + '\')">' + nome + '</button>').join('') + '</div>' +
      '<div class="fd-topo-acoes" id="fdAgendaLado">' + ladoAgenda(m, aba) + '</div></div>' +
      '<div id="fdAgendaCorpo">' + (aba === 'ultimas' ? '<div id="fdUltimas">' + linhasUltimas(m, estado.filtro) + '</div>' : corpoAgenda(m)) + '</div></article>';
  }

  function blocoVazio() {
    return '<section class="fd-card fd-vidro fd-vazio-total"><h2 class="fd-titulo">Comece pelas suas movimentações</h2>' +
      '<p class="fd-legenda">Cadastre receitas e despesas para ver saldo, projeção, categorias e contas a pagar aqui.</p>' +
      '<button type="button" class="fd-btn fd-btn-despesa" data-fd-acao="nova-despesa">' + ICONES.mais + '<span>Cadastrar movimentação</span></button></section>';
  }

  function paginaHtml(m, util) {
    const raiz = (miolo) => '<div class="dashboard-cockpit-frame fd-root">' + cabecalho(m, util) + miolo + '</div>';
    const orcamentos = blocoOrcamentos(m);
    return raiz('<div class="fd-corpo">' +
      blocoKpis(m) +
      '<div class="fd-linha fd-linha-b">' + blocoGrafico(m) + blocoCategorias(m) + '</div>' +
      '<div class="fd-linha fd-linha-c">' + blocoSaude(m) + blocoAgendaUltimas(m) + blocoContas(m) + '</div>' +
      (orcamentos ? '<div class="fd-linha fd-linha-d fd-n1">' + orcamentos + '</div>' : '') + '</div>');
  }

  // ======================================================================
  // Cena de vidro (fundo fixo do painel) e ações
  // ======================================================================
  // Fica fora do painel, direto no app: sobrevive às renderizações (sem piscar) e só aparece enquanto o dashboard está na tela.
  // Tudo em vmax e gradientes: nítido de 1080p a 4K e acompanha a paleta escolhida (--nx-o1..o4).
  const CENA = '<span class="fd-orb fd-o1"></span><span class="fd-orb fd-o2"></span><span class="fd-orb fd-o3"></span><span class="fd-orb fd-o4"></span>' +
    '<span class="fd-placa fd-p1"></span><span class="fd-placa fd-p2"></span><span class="fd-placa fd-p3"></span>' +
    '<div class="fd-malha"></div><div class="fd-granulado"></div><div class="fd-vinheta"></div>';
  let observadorSaida = null;

  function garantirCena() {
    if (typeof document === 'undefined' || !document.body) return;
    let cena = document.getElementById('fdCena');
    if (!cena) {
      cena = document.createElement('div');
      cena.id = 'fdCena';
      cena.className = 'fd-cena';
      cena.setAttribute('aria-hidden', 'true');
      cena.innerHTML = CENA;
      const pai = document.getElementById('appMain') || document.body;
      pai.insertBefore(cena, pai.firstChild);
    }
    document.documentElement.classList.add('fd-vidro-ativo');
    const conteudo = document.getElementById('pageContent');
    if (conteudo && !observadorSaida && typeof MutationObserver !== 'undefined') {
      // Ao trocar de página o painel some do DOM: desliga o vidro e solta o gráfico
      observadorSaida = new MutationObserver(() => {
        if (document.querySelector('.fd-root')) return;
        document.documentElement.classList.remove('fd-vidro-ativo');
        if (estado.grafico && estado.grafico.destroy) { estado.grafico.destroy(); estado.grafico = null; }
        if (estado.relogioId) { clearInterval(estado.relogioId); estado.relogioId = null; }
      });
      observadorSaida.observe(conteudo, { childList: true });
    }
  }

  function irParaMovimentacoes(filtros) {
    if (typeof window === 'undefined' || typeof window.navigate !== 'function') return;
    const f = filtros || {};
    window.navigate('transacoes');
    let tentativas = 0;
    // A tela de movimentações é montada de forma assíncrona: espera os filtros existirem antes de preenchê-los
    const aplicar = () => {
      const tipo = document.getElementById('txFiltroTipo');
      if (!tipo) { if (tentativas++ < 40) setTimeout(aplicar, 50); return; }
      const campos = { txFiltroTipo: f.tipo, txFiltroStatus: f.status, txFiltroCat: f.cat, txFiltroConta: f.conta };
      Object.keys(campos).forEach((id) => { const el = document.getElementById(id); if (el) el.value = campos[id] || ''; });
      if (typeof window.refreshTxTable === 'function') window.refreshTxTable();
      else tipo.dispatchEvent(new Event('change', { bubbles: true }));
    };
    aplicar();
  }

  function executarAcao(nome, el) {
    const w = window;
    if (nome === 'nova-receita' && typeof w.openModal === 'function') w.openModal(null, 'in');
    else if (nome === 'nova-despesa' && typeof w.openModal === 'function') w.openModal(null, 'out');
    else if (nome === 'atualizar' && typeof w.syncDashboardData === 'function') {
      el.classList.add('girando');
      el.disabled = true;
      w.syncDashboardData();
    }
  }

  let ouvintesLigados = false;
  function ligarOuvintes() {
    if (ouvintesLigados || typeof document === 'undefined') return;
    ouvintesLigados = true;
    const ativar = (el) => {
      if (el.hasAttribute('data-fd-acao')) { executarAcao(el.getAttribute('data-fd-acao'), el); return; }
      const destino = el.getAttribute('data-fd-ir');
      if (destino === 'mov') irParaMovimentacoes(filtrosDeAtalho(el.dataset));
      else if (destino && typeof window.navigate === 'function') window.navigate(destino);
    };
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('.fd-root [data-fd-acao], .fd-root [data-fd-ir]') : null;
      if (!el) return;
      // Botão dentro de um cartão clicável (ex.: dar baixa) faz só o que é dele
      const interno = e.target.closest('button, a, input, select, textarea');
      if (interno && interno !== el && el.contains(interno)) return;
      ativar(el);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = e.target && e.target.closest ? e.target.closest('.fd-root [role="link"][data-fd-ir]') : null;
      if (!el || el !== e.target) return;
      e.preventDefault();
      ativar(el);
    });
  }

  // ======================================================================
  // Gráficos (Chart.js)
  // ======================================================================
  function tema() {
    const el = (typeof document !== 'undefined' && document.querySelector('.fd-root')) || null;
    const cs = el ? getComputedStyle(el) : null;
    const v = (nome, padrao) => (cs && cs.getPropertyValue(nome).trim()) || padrao;
    return {
      ink: v('--fd-ink', '#F1F5F9'), ink2: v('--fd-ink-2', '#CBD5E1'), muted: v('--fd-muted', '#94A3B8'),
      grid: v('--fd-grid', 'rgba(148,163,184,.14)'), zero: v('--fd-zero', 'rgba(148,163,184,.42)'), surface: v('--fd-surface', '#0d0e12'),
      entrada: v('--fd-in', '#059669'), saida: v('--fd-out', '#EF4444'), accent: v('--fd-accent', '#3987E5'),
      tipTexto: v('--fd-ink', '#F1F5F9'), tipFundo: v('--fd-tip', 'rgba(15,23,42,.96)')
    };
  }
  function comAlpha(cor, a) {
    const m = /^#([0-9a-f]{6})$/i.exec(cor);
    if (!m) return cor;
    const n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  const plugins = {
    // Linha vertical de referência ao passar o mouse (a leitura exata vem do tooltip)
    cruz: {
      id: 'fdCruz',
      afterDatasetsDraw(chart) {
        const ativos = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
        if (!ativos.length || chart.config.type !== 'line') return;
        const { ctx, chartArea } = chart;
        const x = ativos[0].element.x;
        ctx.save();
        ctx.beginPath(); ctx.moveTo(x, chartArea.top); ctx.lineTo(x, chartArea.bottom);
        ctx.lineWidth = 1; ctx.strokeStyle = chart.options.plugins.fdCruz && chart.options.plugins.fdCruz.cor || 'rgba(148,163,184,.5)';
        ctx.stroke(); ctx.restore();
      }
    },
    // Escala automática (zoom do body em 2K/4K/5K): o gráfico tem o tamanho em pixels CSS, mas a posição do mouse/toque chegava em pixels visuais,
    // então o ponto sob o ponteiro ficava deslocado pelo fator do zoom (a 150%, o meio do gráfico mostrava o dia 22 em vez do 14).
    // Aqui a posição é refeita dividindo pela razão visual/CSS do canvas; a 100% a razão é 1 e nada muda.
    zoom: {
      id: 'fdZoom',
      beforeEvent(chart, args) {
        const e = args.event, n = e && e.native, cv = chart.canvas;
        if (!n || !cv || !cv.getBoundingClientRect || !cv.clientWidth || !cv.clientHeight) return;
        const src = (n.touches && n.touches[0]) || (n.changedTouches && n.changedTouches[0]) || n;
        if (typeof src.clientX !== 'number' || typeof src.clientY !== 'number') return;
        const r = cv.getBoundingClientRect();
        const kx = r.width / cv.clientWidth, ky = r.height / cv.clientHeight;
        if (Math.abs(kx - 1) < 0.01 && Math.abs(ky - 1) < 0.01) return;
        e.x = (src.clientX - r.left) / kx;
        e.y = (src.clientY - r.top) / ky;
        if (typeof chart.isPointInArea === 'function') args.inChartArea = chart.isPointInArea(e);
      }
    }
  };

  function opcoesBase(t, m) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
      plugins: {
        fdCruz: { cor: t.zero },
        legend: { display: true, position: 'top', align: 'start', labels: { color: t.ink2, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 14, weight: '600' }, padding: 14 } },
        tooltip: { backgroundColor: t.tipFundo, titleColor: t.tipTexto, bodyColor: t.tipTexto, footerColor: t.muted, borderColor: t.grid, borderWidth: 1, padding: 11, boxPadding: 5, cornerRadius: 10, usePointStyle: true, displayColors: true }
      },
      scales: {
        x: { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.muted, font: { size: 14 }, maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: (c) => (c.tick && c.tick.value === 0 ? t.zero : t.grid), lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { color: t.muted, font: { size: 14 }, padding: 8, callback: (v) => fmtEixo(v) } }
      }
    };
  }

  function configSaldo(m, t) {
    const d = m.serieDiaria;
    const opc = opcoesBase(t, m);
    const hojeIdx = d.hojeIdx;
    opc.scales.x.ticks.callback = function (valor, i) { return d.dias[i]; };
    // Barras com o saldo ao fim de cada dia, sempre a partir do zero (a escala não exagera as variações):
    // verde = realizado, azul = hoje, azul claro = projeção com as pendências. A chave da legenda é um quadradinho.
    opc.plugins.legend.labels.pointStyle = 'rectRounded';
    opc.scales.y.beginAtZero = true;
    // Conta sem movimentação nenhuma: escala de 0 a 100 em vez de R$ -1 / R$ 1 repetidos no eixo
    const valores = [].concat(d.saldoReal, d.saldoProj).filter((v) => v != null && Math.abs(v) > 0.004);
    if (!valores.length) { opc.scales.y.min = 0; opc.scales.y.suggestedMax = 100; opc.scales.y.ticks.maxTicksLimit = 4; }
    opc.plugins.tooltip.callbacks = {
      title: (itens) => { const i = itens[0].dataIndex; return diaSemana(chave(m.periodo.ano, m.periodo.mes, d.dias[i])) + ', ' + pad(d.dias[i]) + '/' + pad(m.periodo.mes); },
      label: (c) => ' ' + c.dataset.label + ': ' + fmtU(c.parsed.y),
      afterBody: (itens) => {
        const ev = d.eventos[itens[0].dataIndex] || [];
        return ev.map((e) => (e.tipo === 'in' ? '+ ' : '− ') + e.desc + ' · ' + fmtU(e.valor) + (e.realizado ? '' : ' (previsto)'));
      }
    };
    // Cada dia pertence a UMA série: realizado (até ontem), hoje, ou projeção (de amanhã em diante). Mês encerrado = só realizado; mês futuro = só projeção.
    const antes = (i) => hojeIdx < 0 || i < hojeIdx;
    const depois = (i) => hojeIdx < 0 || i > hojeIdx;
    const realizado = d.saldoReal.map((v, i) => (antes(i) ? v : null));
    const hoje = d.saldoReal.map((v, i) => (i === hojeIdx ? (v != null ? v : d.saldoProj[i]) : null));
    const projecao = d.saldoProj.map((v, i) => (depois(i) ? v : null));
    const base = { borderRadius: { topLeft: 3, topRight: 3, bottomLeft: 3, bottomRight: 3 }, borderSkipped: false, maxBarThickness: 18, barPercentage: 0.82, categoryPercentage: 0.94, grouped: false };
    return {
      type: 'bar',
      data: {
        labels: d.dias.map((x) => String(x)),
        datasets: [
          { label: 'Realizado', data: realizado, backgroundColor: comAlpha(t.entrada, 0.82), ...base },
          { label: 'Hoje', data: hoje, backgroundColor: t.accent, ...base },
          { label: 'Projetado', data: projecao, backgroundColor: comAlpha(t.accent, 0.36), borderColor: comAlpha(t.accent, 0.7), borderWidth: 1, ...base }
        ]
      },
      options: opc
    };
  }

  function configMensal(m, t) {
    const s = m.serieMensal;
    const opc = opcoesBase(t, m);
    opc.plugins.tooltip.callbacks = {
      label: (c) => ' ' + c.dataset.label + ': ' + fmtU(c.parsed.y),
      afterBody: (itens) => { const x = s[itens[0].dataIndex]; return ['Resultado: ' + fmtU(x.resultado)].concat(x.entradasPrevistas || x.saidasPrevistas ? ['Previsto: +' + fmtU(x.entradasPrevistas) + ' / −' + fmtU(x.saidasPrevistas)] : []); }
    };
    const base = { borderColor: t.surface, borderWidth: 2, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 24, barPercentage: 0.9, categoryPercentage: 0.72 };
    return {
      type: 'bar',
      data: { labels: s.map((x) => x.rotulo), datasets: [
        { label: 'Entradas', data: s.map((x) => x.entradas), backgroundColor: t.entrada, ...base },
        { label: 'Saídas', data: s.map((x) => x.saidas), backgroundColor: t.saida, ...base }
      ] },
      options: opc
    };
  }

  function configDiario(m, t) {
    const d = m.serieDiaria;
    const opc = opcoesBase(t, m);
    opc.scales.x.stacked = true; opc.scales.y.stacked = true;
    opc.scales.x.ticks.callback = function (valor, i) { return d.dias[i]; };
    opc.plugins.tooltip.callbacks = {
      title: (itens) => { const i = itens[0].dataIndex; return diaSemana(chave(m.periodo.ano, m.periodo.mes, d.dias[i])) + ', ' + pad(d.dias[i]) + '/' + pad(m.periodo.mes); },
      label: (c) => (c.parsed.y ? ' ' + c.dataset.label + ': ' + fmtU(c.parsed.y) : null)
    };
    // Com 30 dias lado a lado a barra já é fina: o vão de 2px entre marcas vira 1px para sobrar largura de leitura
    const base = { borderColor: t.surface, borderWidth: 1, borderRadius: { topLeft: 3, topRight: 3 }, borderSkipped: 'bottom', maxBarThickness: 16, categoryPercentage: 0.94, barPercentage: 0.96 };
    return {
      type: 'bar',
      data: { labels: d.dias.map(String), datasets: [
        { label: 'Entradas', data: d.in, backgroundColor: t.entrada, stack: 'entradas', ...base },
        { label: 'Entradas previstas', data: d.inPrev, backgroundColor: comAlpha(t.entrada, 0.5), stack: 'entradas', ...base },
        { label: 'Saídas', data: d.out, backgroundColor: t.saida, stack: 'saidas', ...base },
        { label: 'Saídas previstas', data: d.outPrev, backgroundColor: comAlpha(t.saida, 0.5), stack: 'saidas', ...base }
      ] },
      options: opc
    };
  }

  // Carimbo "atualizado às HH:MM": preenchido via textContent para NÃO alterar o HTML renderizado.
  // Se o horário fosse gerado no HTML, o painel inteiro seria reconstruído a cada virada de minuto (htmlChanged → tremor).
  function carimbarAtualizacao() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('fdAtualizadoEm');
    if (!el) return;
    const n = new Date();
    el.textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
  }

  let tentativas = 0;
  function desenhar() {
    carimbarAtualizacao();
    if (!estado.relogioId && typeof document !== 'undefined') {
      estado.relogioId = setInterval(carimbarAtualizacao, 20000);
    }
    const m = estado.modelo;
    if (!m || typeof document === 'undefined') return;
    const canvas = document.getElementById('fdChartPrincipal');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      if (tentativas++ < 20) setTimeout(desenhar, 300);
      return;
    }
    tentativas = 0;
    if (estado.grafico && estado.grafico.destroy) estado.grafico.destroy();
    const t = tema();
    try {
      if (Chart.defaults && Chart.defaults.font) Chart.defaults.font.family = "'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif";
      const cfg = estado.visao === 'mensal' ? configMensal(m, t) : estado.visao === 'diario' ? configDiario(m, t) : configSaldo(m, t);
      cfg.plugins = (cfg.plugins || []).concat([plugins.zoom]);
      estado.grafico = new Chart(canvas, cfg);
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('Dashboard: falha ao desenhar o gráfico', e);
    }
    return estado.grafico;
  }

  // As cores do gráfico são lidas do tema na hora de desenhar: ao trocar claro/escuro, desenha de novo
  if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
    let temaAnterior = null;
    let espera = null;
    const observar = () => {
      const eClaro = () => document.body.classList.contains('light') || document.documentElement.classList.contains('light');
      temaAnterior = eClaro();
      const obs = new MutationObserver(() => {
        const agora = eClaro();
        if (agora === temaAnterior) return;
        temaAnterior = agora;
        clearTimeout(espera);
        espera = setTimeout(() => { if (estado.ativo && document.getElementById('fdChartPrincipal')) desenhar(); }, 80);
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      if (document.body) obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observar); else observar();
  }

  // ======================================================================
  // API pública
  // ======================================================================
  function pagina(ctx) {
    const modelo = calcular(ctx);
    estado.modelo = modelo;
    estado.util = ctx.util || {};
    estado.ativo = true;
    garantirCena();
    ligarOuvintes();
    return paginaHtml(modelo, estado.util);
  }

  function mudarVisao(visao) {
    estado.visao = ['saldo', 'mensal', 'diario'].includes(visao) ? visao : 'saldo';
    if (typeof document === 'undefined') return;
    document.querySelectorAll('[data-fd-visao]').forEach((b) => {
      const ativa = b.getAttribute('data-fd-visao') === estado.visao;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', String(ativa));
    });
    const leg = document.getElementById('fdLegendaGrafico');
    if (leg && estado.modelo) leg.textContent = textoGrafico(estado.modelo);
    const tab = document.getElementById('fdTabelaCaixa');
    if (tab && estado.modelo) tab.innerHTML = tabelaDados(estado.modelo);
    desenhar();
  }

  // Abas do cartão "Contas dos próximos 30 dias" / "Últimas movimentações": troca só o miolo do cartão (sem redesenhar o painel)
  function mudarAba(aba) {
    estado.aba = aba === 'ultimas' ? 'ultimas' : 'agenda';
    if (typeof document === 'undefined' || !estado.modelo) return;
    document.querySelectorAll('[data-fd-aba]').forEach((b) => {
      const ativa = b.getAttribute('data-fd-aba') === estado.aba;
      b.classList.toggle('ativa', ativa);
      b.setAttribute('aria-selected', String(ativa));
    });
    const lado = document.getElementById('fdAgendaLado');
    if (lado) lado.innerHTML = ladoAgenda(estado.modelo, estado.aba);
    const corpo = document.getElementById('fdAgendaCorpo');
    if (corpo) corpo.innerHTML = estado.aba === 'ultimas' ? '<div id="fdUltimas">' + linhasUltimas(estado.modelo, estado.filtro) + '</div>' : corpoAgenda(estado.modelo);
  }

  function alternarTabela() {
    estado.tabela = !estado.tabela;
    if (typeof document === 'undefined') return;
    const caixa = document.getElementById('fdGraficoCaixa');
    const tab = document.getElementById('fdTabelaCaixa');
    if (caixa) caixa.hidden = estado.tabela;
    if (tab) { tab.hidden = !estado.tabela; if (estado.modelo) tab.innerHTML = tabelaDados(estado.modelo); }
    const btn = document.querySelector('.fd-btn-tabela');
    if (btn) { btn.classList.toggle('ativa', estado.tabela); btn.setAttribute('aria-pressed', String(estado.tabela)); }
    if (!estado.tabela) desenhar();
  }

  function filtrarUltimas(filtro) {
    estado.filtro = ['all', 'in', 'out'].includes(filtro) ? filtro : 'all';
    if (typeof document === 'undefined' || !estado.modelo) return;
    document.querySelectorAll('[data-fd-filtro]').forEach((b) => b.classList.toggle('ativa', b.getAttribute('data-fd-filtro') === estado.filtro));
    const alvo = document.getElementById('fdUltimas');
    if (alvo) alvo.innerHTML = linhasUltimas(estado.modelo, estado.filtro);
    // "Ver extrato" leva para a lista já filtrada pelo mesmo tipo
    const extrato = document.getElementById('fdVerExtrato');
    if (extrato) { if (estado.filtro === 'all') extrato.removeAttribute('data-fd-tipo'); else extrato.setAttribute('data-fd-tipo', estado.filtro); }
  }

  return {
    calcular, pagina, desenhar, mudarVisao, mudarAba, alternarTabela, filtrarUltimas, estado,
    graficoPrincipal: () => estado.grafico,
    // exportados para os testes
    menorSaldoProjetado, filtrosDeAtalho,
    util: { parseValor, parseData, diferencaDias, somarDias, fmtBR, fmtEixo, esc, chave }
  };
});
