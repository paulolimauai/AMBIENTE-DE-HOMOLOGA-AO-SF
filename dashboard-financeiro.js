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
    if (Math.abs(n) < 10000) return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
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
  const STATUS_PAGOS = ['Pago', 'Recebido'];
  const BASE_MINIMA_PERCENTUAL = 50;

  // Registro sem status (dados antigos): vale como realizado se a data já passou
  function estaRealizado(status, data, hojeStr) {
    if (STATUS_PAGOS.includes(status)) return true;
    if (!status) return data <= hojeStr;
    return false;
  }

  function normalizarLancamentos(transacoes, idsDeCartao, hojeStr) {
    const lista = [];
    (Array.isArray(transacoes) ? transacoes : []).forEach((t) => {
      if (!t || (t.type !== 'in' && t.type !== 'out')) return;
      const p = parseData(t.date);
      if (!p || !p.year || !p.month || !p.day) return;
      const data = chave(p.year, p.month, p.day);
      lista.push({
        id: t.id,
        tipo: t.type,
        valor: parseValor(t.val),
        ano: p.year,
        mes: p.month,
        dia: p.day,
        data,
        realizado: estaRealizado(t.status, data, hojeStr),
        desc: String(t.desc || ''),
        cat: String(t.cat || 'Sem categoria'),
        conta: String(t.acc || t.card || ''),
        noCartao: idsDeCartao.has(String(t.id))
      });
    });
    return lista;
  }

  function somar(lista) {
    const r = { realizado: 0, previsto: 0, qtd: 0, qtdPrevisto: 0, total: 0 };
    lista.forEach((l) => {
      r.qtd += 1;
      if (l.realizado) r.realizado += l.valor;
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
    const projetados = saldoProj.filter((v) => v != null);
    const saldoMinimo = projetados.length ? Math.min(...projetados) : saldoAtual;
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
    const cartoesResumo = {
      itens: cartoes, limite: arred(limiteCartoes), fatura: arred(faturaCartoes),
      disponivel: arred(cartoes.reduce((s, c) => s + c.disponivel, 0)),
      usoPct: limiteCartoes > 0 ? Math.min(100, Math.round((faturaCartoes / limiteCartoes) * 100)) : 0
    };
    const contasBancarias = contas.filter((c) => !c.ehCartao).map((c) => {
      const mov = caixa.filter((l) => (c.txIds || []).map(String).includes(String(l.id)));
      const saldo = arred(c.saldoInicial + mov.filter((l) => l.realizado).reduce((s, l) => s + (l.tipo === 'in' ? l.valor : -l.valor), 0));
      return { id: c.id, nome: c.nome, saldo };
    });

    // ---------- Ritmo ----------
    const inicio30 = somarDias(hojeStr, -29);
    const gastos30 = lancs.filter((l) => l.tipo === 'out' && l.realizado && l.data >= inicio30 && l.data <= hojeStr).reduce((s, l) => s + l.valor, 0);
    const mediaDiaria30 = arred(gastos30 / 30);
    const autonomiaDias = saldoAtual > 0 && mediaDiaria30 > 0 ? Math.min(999, Math.floor(saldoAtual / mediaDiaria30)) : null;
    const maiorEntrada = entradas.reduce((m, l) => Math.max(m, l.valor), 0);
    const maiorSaida = saidas.reduce((m, l) => Math.max(m, l.valor), 0);

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
    const saude = {
      score,
      status: score >= 75 ? 'Excelente' : score >= 50 ? 'Equilibrado' : 'Atenção',
      nivel: score >= 75 ? 'bom' : score >= 50 ? 'medio' : 'ruim',
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
      contas: { saldoInicial, saldoAtual, saldoProjetadoFim, saldoMinimo, primeiroDiaNegativo, bancarias: contasBancarias, cartoes: cartoesResumo },
      serieDiaria, serieMensal, categorias, totalDespesaCats: arred(totalDespesaCats),
      agenda, ultimas, orcamentos, tempoDecorridoPct,
      ritmo: { mediaDiaria30, autonomiaDias, maiorEntrada: arred(maiorEntrada), maiorSaida: arred(maiorSaida) },
      saude, insights: insights.slice(0, 3)
    };
  }

  // ======================================================================
  // Tela (HTML)
  // ======================================================================
  const estado = { visao: 'saldo', filtro: 'all', tabela: false, modelo: null, util: null, ativo: false, grafico: null };

  const ICONES = {
    seta: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>',
    check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    alerta: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    info: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
    tabela: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v16"/></svg>'
  };

  const fmtU = (v) => ((estado.util && estado.util.fmt) || fmtBR)(v);
  const dinheiro = (v) => '<span class="fd-money">' + esc(fmtU(v)) + '</span>';
  const dinheiroSinal = (v, tipo) => '<span class="fd-money">' + (tipo === 'in' ? '+' : '−') + esc(fmtU(v)) + '</span>';

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
    return '<span class="fd-delta ' + (bom ? 'fd-bom' : 'fd-ruim') + '" title="' + esc(dica) + '">' + (sobe ? '▲' : '▼') + ' ' + esc(texto) + '</span>' + rot;
  }

  function sparkline(m) {
    const d = m.serieDiaria;
    const pontos = [];
    d.dias.forEach((dia, i) => {
      const real = d.saldoReal[i];
      const proj = d.saldoProj[i];
      if (real != null || proj != null) pontos.push({ i, real, proj });
    });
    if (pontos.length < 2) return '';
    const valores = pontos.map((p) => (p.real != null ? p.real : p.proj));
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const faixa = max - min || 1;
    const L = 240; const A = 64; const margem = 8;
    const x = (i) => margem + (i / Math.max(1, d.dias.length - 1)) * (L - margem * 2);
    const y = (v) => A - margem - ((v - min) / faixa) * (A - margem * 2);
    const rota = (lista) => lista.map((p, k) => (k ? 'L' : 'M') + x(p.i).toFixed(1) + ' ' + y(p.v).toFixed(1)).join(' ');
    const reais = pontos.filter((p) => p.real != null).map((p) => ({ i: p.i, v: p.real }));
    const projs = pontos.filter((p) => p.proj != null).map((p) => ({ i: p.i, v: p.proj }));
    const hojeP = d.hojeIdx >= 0 ? reais[reais.length - 1] : null;
    return '<svg class="fd-spark" viewBox="0 0 ' + L + ' ' + A + '" role="img" aria-label="Evolução do saldo no mês: linha cheia é o realizado e a tracejada é a projeção">' +
      (reais.length > 1 ? '<path d="' + rota(reais) + '" class="fd-spark-real"/>' : '') +
      (projs.length > 1 ? '<path d="' + rota(projs) + '" class="fd-spark-proj"/>' : '') +
      (hojeP ? '<circle cx="' + x(hojeP.i).toFixed(1) + '" cy="' + y(hojeP.v).toFixed(1) + '" r="5" class="fd-spark-dot"/>' : '') +
      '</svg>';
  }

  function tile(rotulo, valorHtml, linhas, extraClasse) {
    return '<div class="fd-tile ' + (extraClasse || '') + '"><div class="fd-tile-rotulo">' + esc(rotulo) + '</div>' + valorHtml + linhas.filter(Boolean).map((l) => '<div class="fd-tile-linha">' + l + '</div>').join('') + '</div>';
  }
  const valorTile = (v, prefixo) => '<div class="fd-tile-valor" data-anim-val="' + v + '"' + (prefixo ? ' data-prefix="' + prefixo + '"' : '') + '>' + esc((prefixo || '') + fmtU(v)) + '</div>';

  function cabecalho(m, util) {
    const saud = util.saudacao ? util.saudacao() : { text: 'Olá' };
    return '<header class="fd-cabecalho">' +
      '<div class="fd-cab-esq"><div class="fd-data">' + esc(util.dataHoje ? util.dataHoje() : m.hoje) + '</div>' +
      '<h1 class="fd-saudacao">' + esc(saud.text) + ', <span>' + esc(util.primeiroNome || 'Usuário') + '</span></h1>' +
      '<p class="fd-sub">Visão financeira baseada nas suas movimentações cadastradas</p></div>' +
      '<div class="fd-cab-dir">' + (util.periodPickerHTML ? util.periodPickerHTML() : '') +
      '<button type="button" class="btn-hero-privacy fd-privacidade" onclick="window.toggleSensitiveBalances()" id="btnToggleBalances" title="Ocultar ou exibir saldos">' +
      '<span class="btn-hero-icon-pill"><span id="btnEyeIcon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span></span>' +
      '<span id="btnEyeText">Ocultar Saldos</span></button></div></header>';
  }

  function blocoAvisos(m) {
    if (!m.insights.length) return '';
    return '<div class="fd-avisos" role="list">' + m.insights.map((i) =>
      '<div class="fd-aviso fd-aviso-' + i.nivel + '" role="listitem"><span class="fd-aviso-ic">' + (i.nivel === 'alerta' || i.nivel === 'atencao' ? ICONES.alerta : i.nivel === 'ok' ? ICONES.check : ICONES.info) + '</span>' +
      '<div><strong>' + esc(i.titulo) + '</strong><span>' + esc(i.texto) + '</span></div></div>').join('') + '</div>';
  }

  function blocoSituacao(m) {
    const c = m.contas;
    const t = m.totais;
    const cmp = m.comparativo;
    const projDiff = arred(c.saldoProjetadoFim - c.saldoAtual);
    const mesCurto = MESES_CURTOS[m.periodo.mes - 1];
    const encerrado = !m.periodo.ehMesAtual && !m.periodo.ehFuturo && !m.periodo.todasAsDatas;
    const fimRotulo = encerrado ? 'Saldo no fim de ' + mesCurto : (m.periodo.ehFuturo ? 'Projeção para o fim de ' + mesCurto : 'Projeção para o fim do mês');
    const hero = '<div class="fd-hero">' +
      '<div class="fd-hero-rotulo">Saldo em contas hoje <span class="fd-dica" tabindex="0" title="Saldo inicial das contas + entradas − saídas já realizadas. Cartões de crédito entram quando a fatura é paga.">?</span></div>' +
      '<div class="fd-hero-valor" data-anim-val="' + c.saldoAtual + '">' + esc(fmtU(c.saldoAtual)) + '</div>' +
      '<div class="fd-hero-proj">' +
        '<span class="fd-hero-proj-rot">' + esc(fimRotulo) + '</span> ' + dinheiro(c.saldoProjetadoFim) +
        (Math.abs(projDiff) >= 0.01 ? ' <span class="fd-delta ' + (projDiff >= 0 ? 'fd-bom' : 'fd-ruim') + '">' + (projDiff >= 0 ? '▲ ' : '▼ ') + esc(fmtU(Math.abs(projDiff))) + '</span>' : '') +
      '</div>' +
      '<div class="fd-hero-nota">' + (m.agenda.itens.length ? 'Considera ' + m.agenda.itens.length + ' lançamento' + (m.agenda.itens.length === 1 ? ' pendente' : 's pendentes') + ' nos próximos 30 dias.' : 'Nenhuma pendência nos próximos 30 dias.') + '</div>' +
      sparkline(m) + '</div>';

    const tiles =
      tile('Receitas', valorTile(t.receitas.realizado), [
        cmp ? chipVariacao(cmp.receitas, 'subir', cmp.rotulo) : '',
        t.receitas.previsto > 0 ? '+ ' + dinheiro(t.receitas.previsto) + ' a receber' : (t.receitas.qtd + ' entrada' + (t.receitas.qtd === 1 ? '' : 's'))
      ]) +
      tile('Despesas', valorTile(t.despesas.realizado), [
        cmp ? chipVariacao(cmp.despesas, 'descer', cmp.rotulo) : '',
        t.despesas.previsto > 0 ? '+ ' + dinheiro(t.despesas.previsto) + ' a pagar' : (t.despesas.qtd + ' saída' + (t.despesas.qtd === 1 ? '' : 's'))
      ]) +
      tile('Resultado', valorTile(t.resultadoRealizado, t.resultadoRealizado > 0 ? '+' : ''), [
        cmp ? chipVariacao(cmp.resultado, 'subir', cmp.rotulo, true) : '',
        t.taxaPoupanca == null ? 'Sem receita realizada' : (t.taxaPoupanca >= 0 ? 'Guardou ' : 'Gastou além: ') + Math.abs(t.taxaPoupanca) + '% da renda'
      ], t.resultadoRealizado < 0 ? 'fd-tile-neg' : '') +
      tile('Cartões', valorTile(c.cartoes.fatura), [
        c.cartoes.itens.length ? c.cartoes.usoPct + '% do limite · ' + dinheiro(c.cartoes.disponivel) + ' livres' : 'Nenhum cartão cadastrado',
        c.cartoes.itens.length ? '<div class="fd-meter" role="img" aria-label="Uso do limite ' + c.cartoes.usoPct + '%"><i class="' + (c.cartoes.usoPct >= 85 ? 'fd-m-ruim' : c.cartoes.usoPct >= 60 ? 'fd-m-medio' : 'fd-m-bom') + '" style="width:' + Math.min(100, c.cartoes.usoPct) + '%"></i></div>' : ''
      ]) +
      tile('A pagar (30 dias)', valorTile(m.agenda.totalAPagar), [
        m.agenda.qtdVencidas ? '<span class="fd-delta fd-ruim">' + m.agenda.qtdVencidas + ' vencida' + (m.agenda.qtdVencidas === 1 ? '' : 's') + ' · ' + esc(fmtU(m.agenda.totalVencido)) + '</span>' : '<span class="fd-delta fd-bom">✓ em dia</span>',
        m.agenda.totalAReceber > 0 ? 'A receber: ' + dinheiro(m.agenda.totalAReceber) : ''
      ], m.agenda.qtdVencidas ? 'fd-tile-neg' : '');

    return '<section class="fd-situacao" aria-label="Situação financeira">' + hero + '<div class="fd-tiles">' + tiles + '</div></section>';
  }

  function abasGrafico() {
    const abas = [['saldo', 'Saldo projetado'], ['mensal', 'Entradas e saídas · 6 meses'], ['diario', 'Dia a dia']];
    return '<div class="fd-abas" role="tablist" aria-label="Visão do gráfico">' + abas.map(([id, nome]) =>
      '<button type="button" role="tab" class="fd-aba' + (estado.visao === id ? ' ativa' : '') + '" aria-selected="' + (estado.visao === id) + '" data-fd-visao="' + id + '" onclick="NexusDash.mudarVisao(\'' + id + '\')">' + esc(nome) + '</button>').join('') + '</div>';
  }

  function textoGrafico(m) {
    if (estado.visao === 'mensal') return 'Realizado em cada mês — o mês de referência é o último';
    if (estado.visao === 'diario') return 'Entradas e saídas de ' + m.periodo.rotulo + ' (as previstas em tom mais claro)';
    return m.periodo.ehFuturo ? 'Projeção do saldo a partir das pendências cadastradas' : 'Linha cheia = realizado · tracejada = projeção com as pendências cadastradas';
  }

  function blocoGrafico(m) {
    const r = m.ritmo;
    return '<article class="fd-card fd-card-grafico">' +
      '<div class="fd-card-topo"><div><h2 class="fd-titulo">Fluxo de caixa</h2><p class="fd-legenda" id="fdLegendaGrafico">' + esc(textoGrafico(m)) + '</p></div>' +
      '<div class="fd-topo-acoes">' + abasGrafico() +
      '<button type="button" class="fd-btn-tabela' + (estado.tabela ? ' ativa' : '') + '" onclick="NexusDash.alternarTabela()" aria-pressed="' + estado.tabela + '" title="Ver os mesmos dados em tabela">' + ICONES.tabela + ' Tabela</button></div></div>' +
      '<div class="fd-grafico-caixa" id="fdGraficoCaixa"' + (estado.tabela ? ' hidden' : '') + '><canvas id="fdChartPrincipal" role="img" aria-label="Gráfico de fluxo de caixa"></canvas></div>' +
      '<div class="fd-tabela-caixa" id="fdTabelaCaixa"' + (estado.tabela ? '' : ' hidden') + '>' + tabelaDados(m) + '</div>' +
      '<div class="fd-metricas">' +
        metrica('Média diária de gastos', dinheiro(r.mediaDiaria30), 'últimos 30 dias') +
        metrica('Autonomia', r.autonomiaDias == null ? '—' : r.autonomiaDias + (r.autonomiaDias === 1 ? ' dia' : ' dias'), 'saldo ÷ gasto diário') +
        metrica('Maior entrada', dinheiro(r.maiorEntrada), esc(m.periodo.rotulo)) +
        metrica('Maior saída', dinheiro(r.maiorSaida), esc(m.periodo.rotulo)) +
      '</div></article>';
  }
  const metrica = (rot, valor, nota) => '<div class="fd-metrica"><span>' + rot + '</span><strong>' + valor + '</strong><em>' + nota + '</em></div>';

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

  function chipDeCategoria(c) {
    if (c.novo) return '<span class="fd-delta fd-neutro" title="Sem gasto nesta categoria no período de comparação">novo</span>';
    if (c.deltaPct == null) return '';
    if (c.baseFraca) {
      if (Math.abs(c.deltaValor) < 20) return '';
      const sobe = c.deltaValor > 0;
      return '<span class="fd-delta ' + (sobe ? 'fd-ruim' : 'fd-bom') + '" title="Mês anterior até o mesmo dia: ' + esc(fmtU(c.anterior)) + '">' + (sobe ? '▲ ' : '▼ ') + esc(fmtU(Math.abs(c.deltaValor))) + '</span>';
    }
    const p = Math.round(c.deltaPct);
    if (p === 0) return '<span class="fd-delta fd-neutro">= estável</span>';
    return '<span class="fd-delta ' + (p > 0 ? 'fd-ruim' : 'fd-bom') + '" title="Mês anterior até o mesmo dia: ' + esc(fmtU(c.anterior)) + '">' + (p > 0 ? '▲' : '▼') + ' ' + Math.abs(p) + '%</span>';
  }

  function blocoCategorias(m) {
    const lista = m.categorias;
    let corpo;
    if (!lista.length) {
      corpo = '<div class="fd-vazio"><strong>Sem despesas neste período</strong><span>Cadastre movimentações para ver para onde vai o dinheiro.</span></div>';
    } else {
      const topo = lista.slice(0, 6);
      const resto = lista.slice(6);
      const maximo = topo[0].valor || 1;
      corpo = '<ol class="fd-ranking">' + topo.map((c) =>
        '<li class="fd-rank-item"><div class="fd-rank-linha"><span class="fd-rank-nome"><i class="fd-bolinha" style="background:' + esc(c.cor) + '"></i>' + esc(c.nome) + '</span>' +
        '<span class="fd-rank-valor">' + dinheiro(c.valor) + ' <small>' + Math.round(c.pct) + '%</small></span></div>' +
        '<div class="fd-barra" role="img" aria-label="' + esc(c.nome) + ': ' + Math.round(c.pct) + '% das despesas"><i style="width:' + Math.max(2, (c.valor / maximo) * 100).toFixed(1) + '%"></i></div>' +
        '<div class="fd-rank-nota">' + chipDeCategoria(c) + (c.previsto > 0 ? ' <span class="fd-delta-rot">' + dinheiro(c.previsto) + ' ainda a pagar</span>' : '') + '</div></li>').join('') + '</ol>' +
        (resto.length ? '<div class="fd-rank-resto">+ ' + resto.length + ' categoria' + (resto.length === 1 ? '' : 's') + ' · ' + dinheiro(resto.reduce((s, c) => s + c.valor, 0)) + '</div>' : '');
    }
    return '<article class="fd-card"><div class="fd-card-topo"><div><h2 class="fd-titulo">Para onde vai o dinheiro</h2><p class="fd-legenda">Despesas de ' + esc(m.periodo.rotulo) + ' · pagas e a pagar</p></div>' +
      '<span class="fd-selo">' + dinheiro(m.totalDespesaCats) + '</span></div>' + corpo +
      (m.comparativo && lista.length ? '<p class="fd-rodape-nota">Variação ' + esc(m.comparativo.rotulo) + '.</p>' : '') + '</article>';
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

  function blocoAgenda(m) {
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
    if (!a.itens.length) corpo = '<div class="fd-vazio fd-vazio-ok"><strong>Tudo em dia</strong><span>Nenhuma conta a pagar ou a receber nos próximos 30 dias.</span></div>';
    return '<article class="fd-card"><div class="fd-card-topo"><div><h2 class="fd-titulo">Contas dos próximos 30 dias</h2><p class="fd-legenda">Pendências cadastradas, das mais urgentes às mais distantes</p></div>' +
      '<div class="fd-resumo-agenda"><span><em>A pagar</em>' + dinheiro(a.totalAPagar) + '</span><span><em>A receber</em>' + dinheiro(a.totalAReceber) + '</span></div></div>' + corpo +
      (ocultos > 0 ? '<button type="button" class="fd-link" data-nav="transacoes" onclick="navigate(\'transacoes\')">+ ' + ocultos + ' lançamento' + (ocultos === 1 ? '' : 's') + ' · ver todos ' + ICONES.seta + '</button>' : '') + '</article>';
  }

  function medidor(valor, nivelClasse, rotulo) {
    return '<div class="fd-meter" role="img" aria-label="' + esc(rotulo) + '"><i class="' + nivelClasse + '" style="width:' + Math.max(0, Math.min(100, valor)) + '%"></i></div>';
  }

  function blocoSaude(m) {
    const s = m.saude;
    const pilares = s.pilares.map((p) => {
      const nivel = p.bom ? 'fd-m-bom' : p.medio ? 'fd-m-medio' : 'fd-m-ruim';
      return '<div class="fd-pilar"><div class="fd-pilar-topo"><span>' + esc(p.nome) + '</span><strong>' + Math.round(p.valor) + '%</strong></div>' + medidor(p.valor, nivel, p.nome + ' ' + Math.round(p.valor) + '%') + '</div>';
    }).join('');
    return '<article class="fd-card"><div class="fd-card-topo"><div><h2 class="fd-titulo">Saúde financeira</h2><p class="fd-legenda">Nota calculada com as movimentações do período</p></div>' +
      '<span class="fd-selo fd-selo-' + s.nivel + '">' + esc(s.status) + '</span></div>' +
      '<div class="fd-nota"><div class="fd-nota-valor">' + s.score + '<small>/100</small></div>' + medidor(s.score, s.nivel === 'bom' ? 'fd-m-bom' : s.nivel === 'medio' ? 'fd-m-medio' : 'fd-m-ruim', 'Nota ' + s.score + ' de 100') + '</div>' +
      '<div class="fd-pilares">' + pilares + '</div></article>';
  }

  function blocoContas(m) {
    const c = m.contas;
    const bancos = c.bancarias.length
      ? '<ul class="fd-lista-simples">' + c.bancarias.map((b) => '<li><span>' + esc(b.nome) + '</span><strong class="' + (b.saldo < 0 ? 'fd-sai' : '') + '">' + dinheiro(b.saldo) + '</strong></li>').join('') + '</ul>'
      : '<p class="fd-legenda">Nenhuma conta bancária cadastrada.</p>';
    const cartoes = c.cartoes.itens.length
      ? '<ul class="fd-cartoes">' + c.cartoes.itens.map((k) => '<li><div class="fd-cartao-topo"><span>' + esc(k.nome) + '</span><strong>' + k.usoPct + '%</strong></div>' +
        medidor(k.usoPct, k.usoPct >= 85 ? 'fd-m-ruim' : k.usoPct >= 60 ? 'fd-m-medio' : 'fd-m-bom', k.nome + ' ' + k.usoPct + '% do limite') +
        '<div class="fd-cartao-nota"><span>Fatura ' + dinheiro(k.fatura) + '</span><span>Livre ' + dinheiro(k.disponivel) + '</span></div></li>').join('') + '</ul>'
      : '';
    return '<article class="fd-card"><div class="fd-card-topo"><div><h2 class="fd-titulo">Contas e cartões</h2><p class="fd-legenda">Saldos de hoje e uso dos limites</p></div>' +
      '<button type="button" class="fd-link fd-link-topo" data-nav="cartoes" onclick="navigate(\'cartoes\')">Gerenciar</button></div>' +
      '<h3 class="fd-sub-titulo">Contas</h3>' + bancos + (cartoes ? '<h3 class="fd-sub-titulo">Cartões de crédito</h3>' + cartoes : '') + '</article>';
  }

  function blocoOrcamentos(m) {
    if (!m.orcamentos.length) return '';
    const marcador = m.tempoDecorridoPct;
    return '<article class="fd-card"><div class="fd-card-topo"><div><h2 class="fd-titulo">Orçamentos</h2><p class="fd-legenda">Gasto contra o limite · o traço marca o tempo do mês (' + marcador + '%)</p></div>' +
      '<button type="button" class="fd-link fd-link-topo" data-nav="orcamentos" onclick="navigate(\'orcamentos\')">Ajustar</button></div>' +
      '<ul class="fd-orcamentos">' + m.orcamentos.slice(0, 5).map((o) => {
        const nivel = o.pct > 100 ? 'fd-m-ruim' : o.pct > marcador + 10 || o.pct >= 90 ? 'fd-m-medio' : 'fd-m-bom';
        return '<li><div class="fd-cartao-topo"><span>' + esc(o.categoria) + '</span><strong>' + o.pct + '%</strong></div>' +
          '<div class="fd-meter fd-meter-marca" role="img" aria-label="' + esc(o.categoria) + ': ' + o.pct + '% do limite"><i class="' + nivel + '" style="width:' + Math.min(100, o.pct) + '%"></i><b style="left:' + marcador + '%" title="Tempo decorrido do mês"></b></div>' +
          '<div class="fd-cartao-nota"><span>' + dinheiro(o.gasto) + ' de ' + dinheiro(o.limite) + '</span><span>' + (o.limite - o.gasto >= 0 ? 'Sobram ' + dinheiro(o.limite - o.gasto) : 'Estourou ' + dinheiro(o.gasto - o.limite)) + '</span></div></li>';
      }).join('') + '</ul></article>';
  }

  function linhasUltimas(m, filtro) {
    const lista = m.ultimas.filter((u) => filtro === 'all' || u.tipo === filtro).slice(0, 8);
    if (!lista.length) return '<div class="fd-vazio"><strong>Nenhuma movimentação realizada</strong><span>As movimentações pagas ou recebidas do período aparecem aqui.</span></div>';
    return '<ul class="fd-ult-lista">' + lista.map((u) =>
      '<li class="fd-ult-item"><div class="fd-ult-data">' + esc(dataCurta(u.data)) + '</div>' +
      '<div class="fd-ult-info"><strong>' + esc(u.desc || 'Sem descrição') + '</strong><span><i class="fd-bolinha" style="background:' + esc(u.cor) + '"></i>' + esc(u.cat) + (u.conta ? ' · ' + esc(u.conta) : '') + '</span></div>' +
      '<div class="fd-ult-valor ' + (u.tipo === 'in' ? 'fd-entra' : 'fd-sai') + '">' + dinheiroSinal(u.valor, u.tipo) + '</div></li>').join('') + '</ul>';
  }

  function blocoUltimas(m) {
    const filtros = [['all', 'Todas'], ['in', 'Receitas'], ['out', 'Despesas']];
    return '<article class="fd-card fd-card-largo"><div class="fd-card-topo"><div><h2 class="fd-titulo">Últimas movimentações</h2><p class="fd-legenda">Só o que já foi pago ou recebido em ' + esc(m.periodo.rotulo) + '</p></div>' +
      '<div class="fd-topo-acoes"><div class="fd-abas fd-abas-peq" role="group" aria-label="Filtrar movimentações">' + filtros.map(([id, nome]) =>
        '<button type="button" class="fd-aba' + (estado.filtro === id ? ' ativa' : '') + '" data-fd-filtro="' + id + '" onclick="NexusDash.filtrarUltimas(\'' + id + '\')">' + nome + '</button>').join('') + '</div>' +
      '<button type="button" class="fd-link fd-link-topo" data-nav="transacoes" onclick="navigate(\'transacoes\')">Ver extrato ' + ICONES.seta + '</button></div></div>' +
      '<div id="fdUltimas">' + linhasUltimas(m, estado.filtro) + '</div></article>';
  }

  function blocoVazio() {
    return '<section class="fd-card fd-vazio-total"><h2 class="fd-titulo">Comece pelas suas movimentações</h2>' +
      '<p class="fd-legenda">Cadastre receitas e despesas para ver saldo, projeção, categorias e contas a pagar aqui.</p>' +
      '<button type="button" class="btn-primary" data-nav="transacoes" onclick="navigate(\'transacoes\')">Cadastrar movimentação</button></section>';
  }

  function paginaHtml(m, util) {
    return '<div class="dashboard-cockpit-frame fd-root">' + cabecalho(m, util) +
      (m.vazio ? blocoVazio() : blocoAvisos(m) + blocoSituacao(m) +
        '<div class="fd-grade fd-grade-1">' + blocoGrafico(m) + blocoCategorias(m) + '</div>' +
        '<div class="fd-grade fd-grade-2"><div class="fd-coluna">' + blocoAgenda(m) + blocoUltimas(m) + '</div>' +
        '<div class="fd-coluna">' + blocoSaude(m) + blocoContas(m) + blocoOrcamentos(m) + '</div></div>') +
      '</div>';
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
    }
  };

  function opcoesBase(t, m) {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 240 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
      plugins: {
        fdCruz: { cor: t.zero },
        legend: { display: true, position: 'top', align: 'start', labels: { color: t.ink2, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 11.5, weight: '600' }, padding: 14 } },
        tooltip: { backgroundColor: t.tipFundo, titleColor: t.tipTexto, bodyColor: t.tipTexto, footerColor: t.muted, borderColor: t.grid, borderWidth: 1, padding: 11, boxPadding: 5, usePointStyle: true, displayColors: true }
      },
      scales: {
        x: { grid: { display: false }, border: { color: t.grid }, ticks: { color: t.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 } },
        y: { grid: { color: (c) => (c.tick && c.tick.value === 0 ? t.zero : t.grid), lineWidth: 1, drawTicks: false }, border: { display: false }, ticks: { color: t.muted, font: { size: 11 }, padding: 8, callback: (v) => fmtEixo(v) } }
      }
    };
  }

  function configSaldo(m, t) {
    const d = m.serieDiaria;
    const opc = opcoesBase(t, m);
    const hojeIdx = d.hojeIdx;
    opc.scales.x.ticks.callback = function (valor, i) { return d.dias[i]; };
    // Chave da legenda como traço: a linha cheia (realizado) e a tracejada (projeção) se distinguem sem depender de cor
    opc.plugins.legend.labels.usePointStyle = false;
    opc.plugins.legend.labels.boxWidth = 28;
    opc.plugins.legend.labels.boxHeight = 2;
    opc.plugins.tooltip.callbacks = {
      title: (itens) => { const i = itens[0].dataIndex; return diaSemana(chave(m.periodo.ano, m.periodo.mes, d.dias[i])) + ', ' + pad(d.dias[i]) + '/' + pad(m.periodo.mes); },
      label: (c) => ' ' + c.dataset.label + ': ' + fmtU(c.parsed.y),
      afterBody: (itens) => {
        const ev = d.eventos[itens[0].dataIndex] || [];
        return ev.map((e) => (e.tipo === 'in' ? '+ ' : '− ') + e.desc + ' · ' + fmtU(e.valor) + (e.realizado ? '' : ' (previsto)'));
      }
    };
    return {
      type: 'line',
      data: {
        labels: d.dias.map((x) => String(x)),
        datasets: [
          { label: 'Saldo realizado', data: d.saldoReal, borderColor: t.accent, backgroundColor: comAlpha(t.accent, 0.1), fill: 'origin', borderWidth: 2, tension: 0.2, spanGaps: false,
            pointRadius: d.saldoReal.map((v, i) => (i === hojeIdx ? 5 : 0)), pointHoverRadius: 6, pointHitRadius: 18, pointBackgroundColor: t.accent, pointBorderColor: t.surface, pointBorderWidth: 2 },
          { label: 'Saldo projetado', data: d.saldoProj, borderColor: t.accent, backgroundColor: 'transparent', fill: false, borderWidth: 2, borderDash: [6, 5], tension: 0.2, spanGaps: false,
            pointRadius: 0, pointHoverRadius: 6, pointHitRadius: 18, pointBackgroundColor: t.accent, pointBorderColor: t.surface, pointBorderWidth: 2 }
        ]
      },
      options: opc, plugins: [plugins.cruz]
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

  let tentativas = 0;
  function desenhar() {
    const m = estado.modelo;
    if (!m || m.vazio || typeof document === 'undefined') return;
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
  }

  return {
    calcular, pagina, desenhar, mudarVisao, alternarTabela, filtrarUltimas, estado,
    graficoPrincipal: () => estado.grafico,
    // exportados para os testes
    util: { parseValor, parseData, diferencaDias, somarDias, fmtBR, fmtEixo, esc, chave }
  };
});
