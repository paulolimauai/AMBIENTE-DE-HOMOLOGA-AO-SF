'use strict';

/**
 * Tela "Transações" do Nexus.
 *
 * Duas camadas no mesmo arquivo (mesmo padrão do dashboard-financeiro.js):
 *  1) MODELO (funções puras, sem DOM): status "vencido", ordenação, resumo e CSV. Tem testes em transacoes.test.js (Node).
 *  2) TELA: monta a tabela, o rodapé e os estados vazios e liga os eventos (ordenar, mostrar mais, exportar).
 *
 * Decisões que não dá para ler só do código:
 *  - A tabela NÃO tem altura própria: ela cresce e encolhe com a quantidade de lançamentos (nada de caixa com rolagem interna).
 *    Para listas muito grandes são mostrados PAGINA lançamentos por vez ("Mostrar mais").
 *  - "Vencido" não é um status gravado: é um lançamento Pendente com data anterior a hoje. O status gravado continua sendo
 *    Pendente/Pago/Recebido (é o que o resto do app, o servidor e os filtros usam).
 *  - Ordenando por data, a data aparece só na primeira linha de cada dia (como num extrato); nas demais colunas, em todas.
 *  - O módulo não conhece variáveis globais do app: tudo que ele precisa (formatar moeda, cor da categoria, ícones, ações)
 *    chega pelo objeto "ctx", montado em server.js (txContexto).
 */
(function (global, fabrica) {
  const api = fabrica(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.NexusTx = api;
})(typeof window !== 'undefined' ? window : null, function (global) {
  // ======================================================================
  // Utilitários
  // ======================================================================
  const PAGINA = 50;
  const CHAVES = ['date', 'desc', 'cat', 'acc', 'val', 'status'];
  const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const pad = (n) => String(n).padStart(2, '0');

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Só deixa passar cores de verdade (a cor da categoria vem dos dados do usuário e vai para um atributo style)
  function corSegura(c) {
    const s = String(c == null ? '' : c).trim();
    return /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([0-9a-z.,%\s/-]+\))$/i.test(s) ? s : '#8EA3BB';
  }

  // Aceita 2026-11-05, 2026-11-05T10:00:00, 05/11/2026 e 05-11-2026 (os mesmos formatos de parseDateParts, no server.js)
  function dataISO(v) {
    if (v == null || v === '') return '';
    const str = String(v).trim().split('T')[0].split(' ')[0];
    const p = str.indexOf('-') >= 0 ? str.split('-') : str.indexOf('/') >= 0 ? str.split('/') : null;
    if (!p || p.length !== 3) return '';
    let a, m, d;
    if (p[0].length === 4) { a = +p[0]; m = +p[1]; d = +p[2]; }
    else if (p[2].length === 4) { d = +p[0]; m = +p[1]; a = +p[2]; }
    else return '';
    if (!(a >= 1900 && a <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return '';
    return a + '-' + pad(m) + '-' + pad(d);
  }

  function hojeISO(agora) {
    const d = agora instanceof Date ? agora : new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  const partes = (iso) => iso.split('-').map(Number);
  function diasEntre(isoA, isoB) {
    const a = partes(isoA), b = partes(isoB);
    return Math.round((Date.UTC(a[0], a[1] - 1, a[2]) - Date.UTC(b[0], b[1] - 1, b[2])) / 86400000);
  }
  function diaDaSemana(iso) {
    const p = partes(iso);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
  }
  function dataBR(iso) {
    const p = partes(iso);
    return pad(p[2]) + '/' + pad(p[1]) + '/' + p[0];
  }
  function rotuloRelativo(iso, hoje) {
    if (!iso || !hoje) return '';
    const dif = diasEntre(iso, hoje);
    return dif === 0 ? 'Hoje' : dif === -1 ? 'Ontem' : dif === 1 ? 'Amanhã' : '';
  }
  const arred = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
  const plural = (n, um, varios) => n + ' ' + (n === 1 ? um : varios);

  // ======================================================================
  // Modelo
  // ======================================================================

  /** Status mostrado na tela: pendente, vencido (pendente com data passada) ou concluído (pago/recebido). */
  function statusInfo(t, hoje) {
    const entrada = !!t && t.type === 'in';
    if (!t || t.status !== 'Pendente') return { chave: 'done', rotulo: entrada ? 'Recebido' : 'Pago', entrada };
    const iso = dataISO(t.date);
    if (iso && hoje && iso < hoje) return { chave: 'overdue', rotulo: entrada ? 'Atrasado' : 'Vencido', entrada };
    return { chave: 'pending', rotulo: 'Pendente', entrada };
  }

  function resumo(lista, parse, hoje) {
    const r = { qtd: lista.length, entradas: 0, saidas: 0, receitas: 0, despesas: 0, saldo: 0, pendentes: 0, vencidos: 0 };
    lista.forEach((t) => {
      const v = parse(t.val);
      if (t.type === 'in') { r.entradas++; r.receitas += v; }
      else if (t.type === 'out') { r.saidas++; r.despesas += v; }
      const s = statusInfo(t, hoje).chave;
      if (s !== 'done') r.pendentes++;          // pendentes inclui os vencidos
      if (s === 'overdue') r.vencidos++;
    });
    r.receitas = arred(r.receitas);
    r.despesas = arred(r.despesas);
    r.saldo = arred(r.receitas - r.despesas);
    return r;
  }

  const ORDEM_STATUS = { overdue: 0, pending: 1, done: 2 };

  // Salário (pela categoria ou descrição) fica sempre no topo da lista; os demais seguem a ordenação escolhida
  function ehSalario(t) {
    return /sal[aá]rio/i.test(String((t && t.cat) || '') + ' ' + String((t && t.desc) || ''));
  }

  /** Ordena sem mexer na lista original. Empates: data mais recente e, por fim, o último cadastrado primeiro. */
  function ordenar(lista, chave, dir, parse, hoje) {
    const k = CHAVES.indexOf(chave) >= 0 ? chave : 'date';
    const sinal = dir === 'asc' ? 1 : -1;
    const col = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
    const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
    const cmpId = (a, b) => {
      const x = Number(a.id), y = Number(b.id);
      if (isFinite(x) && isFinite(y)) return x - y;
      return col.compare(String(a.id), String(b.id));
    };
    const primario = {
      date: (a, b) => cmpStr(dataISO(a.date), dataISO(b.date)),
      desc: (a, b) => col.compare(String(a.desc || ''), String(b.desc || '')),
      cat: (a, b) => col.compare(String(a.cat || ''), String(b.cat || '')),
      acc: (a, b) => col.compare(String(a.acc || ''), String(b.acc || '')),
      val: (a, b) => parse(a.val) - parse(b.val),
      status: (a, b) => ORDEM_STATUS[statusInfo(a, hoje).chave] - ORDEM_STATUS[statusInfo(b, hoje).chave]
    }[k];
    const comparador = (a, b) => {
      const c = primario(a, b);
      if (c) return c * sinal;
      if (k === 'date') return cmpId(a, b) * sinal;
      const d = cmpStr(dataISO(b.date), dataISO(a.date));
      return d || cmpId(b, a);
    };
    const salarios = [], demais = [];
    lista.forEach((t) => (ehSalario(t) ? salarios : demais).push(t));
    return salarios.sort(comparador).concat(demais.sort(comparador));
  }

  // ---------------------------------------------------------------- CSV
  // Planilhas executam texto que começa com = + - @ : o sinal é neutralizado com um apóstrofo (injeção de fórmula)
  function celulaCSV(v) {
    let s = String(v == null ? '' : v).replace(/[\r\n]+/g, ' ');
    if (/^[=+\-@\t]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function numeroBR(n) {
    return (Math.round(n * 100) / 100).toFixed(2).replace('.', ',');
  }
  /** CSV no padrão brasileiro: separador ";", decimal com vírgula e BOM (o Excel abre os acentos certos). */
  function csv(lista, parse, hoje) {
    const linhas = [['Data', 'Descrição', 'Categoria', 'Conta / Cartão', 'Tipo', 'Valor', 'Status'].map(celulaCSV).join(';')];
    lista.forEach((t) => {
      const iso = dataISO(t.date);
      const entrada = t.type === 'in';
      const v = parse(t.val);
      linhas.push([
        celulaCSV(iso ? dataBR(iso) : String(t.date || '')),
        celulaCSV(t.desc), celulaCSV(t.cat), celulaCSV(t.acc),
        celulaCSV(entrada ? 'Receita' : 'Despesa'),
        (entrada ? '' : '-') + numeroBR(v),
        celulaCSV(statusInfo(t, hoje).rotulo)
      ].join(';'));
    });
    return '﻿' + linhas.join('\r\n') + '\r\n';
  }

  // ======================================================================
  // Tela
  // ======================================================================
  const ICONES = {
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    both: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>'
  };
  function svg(nome, tam) {
    const t = tam || 16;
    return '<svg class="txp-ic" width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONES[nome] || '') + '</svg>';
  }

  const COLUNAS = [
    { k: 'date', t: 'Data', cls: 'txp-c-date' },
    { k: 'desc', t: 'Descrição', cls: 'txp-c-desc' },
    { k: 'cat', t: 'Categoria', cls: 'txp-c-cat' },
    { k: 'acc', t: 'Conta / Cartão', cls: 'txp-c-acc' },
    { k: 'val', t: 'Valor', cls: 'txp-c-val' },
    { k: 'status', t: 'Status', cls: 'txp-c-status' }
  ];

  function cabecalhoHTML(op) {
    const ths = COLUNAS.map((c) => {
      const ativa = op.chave === c.k;
      const aria = ativa ? (op.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      const seta = ativa ? svg(op.dir === 'asc' ? 'up' : 'down', 13) : svg('both', 13);
      return '<th scope="col" class="' + c.cls + '" aria-sort="' + aria + '">' +
        '<button type="button" class="txp-sort' + (ativa ? ' is-on' : '') + '" data-txsort="' + c.k + '" title="Ordenar por ' + c.t.toLowerCase() + '">' +
        '<span>' + c.t + '</span>' + seta + '</button></th>';
    }).join('');
    return '<thead><tr>' + ths + (op.acoes ? '<th scope="col" class="txp-c-act"><span class="txp-th-plain">Ações</span></th>' : '') + '</tr></thead>';
  }

  function linhaHTML(t, op, ctx, ant) {
    const entrada = t.type === 'in';
    const iso = dataISO(t.date);
    const st = statusInfo(t, op.hoje);
    const novoDia = op.chave !== 'date' || iso !== ant;
    const rel = iso ? rotuloRelativo(iso, op.hoje) : '';
    const dataTxt = iso ? dataBR(iso) : (ctx.fmtData ? ctx.fmtData(t.date) : String(t.date || '—'));
    const semana = iso ? DIAS_CURTOS[diaDaSemana(iso)] : '';
    const metodo = !entrada && ctx.metodo ? ctx.metodo(t) : '';
    const metodoTxt = metodo === 'Cartão de Crédito' ? 'Cartão' : metodo;
    const valor = ctx.fmt(Math.abs(ctx.parseVal(t.val)));
    const id = esc(t.id);
    const desc = String(t.desc || '');
    const dicaStatus = st.chave === 'overdue'
      ? 'Venceu em ' + dataTxt + ' — clique para marcar como ' + (entrada ? 'recebido' : 'pago')
      : st.chave === 'pending' ? 'Clique para marcar como ' + (entrada ? 'recebido' : 'pago') : 'Clique para voltar para pendente';
    const cls = ['txp-row'];
    if (op.chave === 'date') cls.push(novoDia ? 'txp-day-start' : 'txp-cont');
    if (st.chave === 'overdue') cls.push('is-overdue');

    return '<tr class="' + cls.join(' ') + '" data-txid="' + id + '">' +
      '<td class="txp-c-date"><span class="txp-d">' + dataTxt + '</span><span class="txp-w">' + semana + (rel ? ' · <b>' + rel + '</b>' : '') + '</span></td>' +
      '<td class="txp-c-desc"><span class="txp-desc" title="' + esc(desc) + '">' + esc(desc || 'Sem descrição') + '</span>' +
        (metodoTxt ? '<span class="txp-chip">' + esc(metodoTxt) + '</span>' : '') + '</td>' +
      '<td class="txp-c-cat"><span class="txp-cat"><i style="background:' + corSegura(ctx.catColor(t.cat)) + '"></i>' + esc(t.cat || 'Sem categoria') + '</span>' +
        '<span class="txp-sub">' + (ctx.contaIcone ? ctx.contaIcone(t.acc) : '') + '<span>' + esc(t.acc || '—') + '</span></span></td>' +
      '<td class="txp-c-acc"><span class="txp-acc">' + (ctx.contaIcone ? ctx.contaIcone(t.acc) : '') + '<span>' + esc(t.acc || '—') + '</span></span></td>' +
      '<td class="txp-c-val ' + (entrada ? 'txp-in' : 'txp-out') + '" title="' + (entrada ? 'Receita' : 'Despesa') + '">' + (entrada ? '+' : '-') + valor + '</td>' +
      '<td class="txp-c-status"><button type="button" class="txp-status is-' + st.chave + '" data-togglestatus="' + id + '" title="' + esc(dicaStatus) + '"><i></i>' + st.rotulo + '</button></td>' +
      (op.acoes
        ? '<td class="txp-c-act"><div class="txp-acts">' +
            '<button type="button" class="txp-act" data-edit="' + id + '" title="Editar transação" aria-label="Editar ' + esc(desc) + '">' + svg('edit', 15) + '</button>' +
            '<button type="button" class="txp-act txp-act-del" data-del="' + id + '" title="Excluir transação" aria-label="Excluir ' + esc(desc) + '">' + svg('trash', 15) + '</button>' +
          '</div></td>'
        : '') +
    '</tr>';
  }

  // Resumo financeiro do conjunto filtrado: Receitas, Despesas e Saldo (o que entrou menos o que saiu)
  function resumoHTML(r, ctx) {
    if (!r || !r.qtd) return '';
    const saldoCls = r.saldo > 0 ? 'is-pos' : (r.saldo < 0 ? 'is-neg' : '');
    const saldoSinal = r.saldo > 0 ? '+' : (r.saldo < 0 ? '-' : '');
    return '<div class="txp-sum" role="group" aria-label="Resumo dos lançamentos filtrados">' +
      '<div class="txp-sum-item is-in"><span class="txp-sum-ic">' + svg('up', 14) + '</span>' +
        '<span class="txp-sum-txt"><small>Receitas</small><b>' + ctx.fmt(r.receitas) + '</b><em>' + plural(r.entradas, 'lançamento', 'lançamentos') + '</em></span></div>' +
      '<div class="txp-sum-item is-out"><span class="txp-sum-ic">' + svg('down', 14) + '</span>' +
        '<span class="txp-sum-txt"><small>Despesas</small><b>' + ctx.fmt(r.despesas) + '</b><em>' + plural(r.saidas, 'lançamento', 'lançamentos') + '</em></span></div>' +
      '<div class="txp-sum-item ' + saldoCls + '"><span class="txp-sum-ic">' + svg('both', 14) + '</span>' +
        '<span class="txp-sum-txt"><small>Saldo</small><b>' + saldoSinal + ctx.fmt(Math.abs(r.saldo)) + '</b><em>no período filtrado</em></span></div>' +
    '</div>';
  }

  function rodapeHTML(mostradas, total, r, restante) {
    const info = mostradas < total
      ? 'Exibindo <strong>' + mostradas + '</strong> de <strong>' + total + '</strong> lançamentos'
      : '<strong>' + total + '</strong> ' + (total === 1 ? 'lançamento' : 'lançamentos');
    const chips = (r.pendentes ? '<span class="txp-foot-chip">' + plural(r.pendentes, 'pendente', 'pendentes') + '</span>' : '') +
      (r.vencidos ? '<span class="txp-foot-chip is-overdue">' + plural(r.vencidos, 'vencido', 'vencidos') + '</span>' : '');
    return '<div class="txp-foot">' +
      '<p class="txp-foot-info" role="status" aria-live="polite">' + info + '</p>' + chips +
      '<span class="txp-foot-gap"></span>' +
      (restante > 0 ? '<button type="button" class="txp-more" data-txmore>Mostrar mais ' + Math.min(PAGINA, restante) + '</button>' : '') +
      '<button type="button" class="txp-export" data-txexport title="Baixar a lista filtrada em CSV (abre no Excel)">' + svg('download', 15) + '<span>Exportar CSV</span></button>' +
    '</div>';
  }

  function vazioHTML(op, ctx) {
    if (op.carregando) {
      return '<div class="txp-empty" role="status"><span class="txp-spinner" aria-hidden="true"></span><h3>Carregando transações</h3><p>Sincronizando seus dados financeiros com o servidor.</p></div>';
    }
    if (op.totalGeral > 0) {
      const titulo = op.filtrado ? 'Nenhum lançamento encontrado' : 'Nenhuma transação neste período';
      const texto = (op.filtrado ? 'Nenhum registro corresponde aos filtros selecionados.' : 'Não há lançamentos em ' + esc(op.periodo) + '.') +
        ' Seu extrato geral tem <strong>' + plural(op.totalGeral, 'lançamento', 'lançamentos') + '</strong>.';
      return '<div class="txp-empty"><div class="txp-empty-ic">' + svg(op.filtrado ? 'search' : 'inbox', 24) + '</div>' +
        '<h3>' + titulo + '</h3><p>' + texto + '</p>' +
        '<div class="txp-empty-acts"><button type="button" class="btn-primary tx-btn" data-txaction="all-dates">' + svg('globe', 15) + '<span>Ver todas as datas</span></button>' +
        (op.filtrado ? '<button type="button" class="btn-ghost tx-btn" data-txaction="clear">' + svg('close', 14) + '<span>Limpar filtros</span></button>' : '') +
        '</div></div>';
    }
    return '<div class="txp-empty"><div class="txp-empty-ic">' + svg('inbox', 24) + '</div>' +
      '<h3>Nenhuma transação registrada</h3>' +
      '<p>Cadastre receitas e despesas para acompanhar o fluxo de caixa de ' + esc(op.periodo) + '.</p>' +
      '<div class="txp-empty-acts"><button type="button" class="btn-primary tx-btn" data-txaction="new">' + svg('plus', 15) + '<span>Nova transação</span></button></div></div>';
  }

  /**
   * HTML da tabela já ordenada (lista = lançamentos filtrados).
   * op: { chave, dir, visiveis, filtrado, carregando, totalGeral, periodo, acoes, hoje }
   */
  function tabelaHTML(lista, op, ctx) {
    if (!lista.length) return vazioHTML(op, ctx);
    const visiveis = Math.max(PAGINA, op.visiveis || PAGINA);
    const parte = lista.slice(0, visiveis);
    const r = resumo(lista, ctx.parseVal, op.hoje);
    // Totais por dia (para o separador de data no estilo extrato): só faz sentido ordenando por data
    const porDia = {};
    if (op.chave === 'date') {
      lista.forEach((t) => {
        const iso = dataISO(t.date);
        if (!iso) return;
        const d = porDia[iso] || (porDia[iso] = { i: 0, o: 0 });
        const v = ctx.parseVal(t.val);
        if (t.type === 'in') d.i += v; else d.o += v;
      });
    }
    const sepDia = (iso) => {
      const d = porDia[iso];
      if (!d) return '';
      const p = iso.split('-');
      const rotulo = pad(+p[2]) + '/' + pad(+p[1]) + '/' + p[0] + ' · ' + DIAS_CURTOS[diaDaSemana(iso)];
      return '<tr class="txp-day" aria-hidden="true"><td colspan="7">' +
        '<span class="txp-day-l">' + rotulo + '</span>' +
        '<span class="txp-day-t">' +
          '<em class="txp-in">+' + ctx.fmt(d.i) + '</em>' +
          '<em class="txp-out">−' + ctx.fmt(d.o) + '</em>' +
          '<b class="' + (d.i - d.o >= 0 ? 'txp-in' : 'txp-out') + '">' + (d.i - d.o >= 0 ? '+' : '−') + ctx.fmt(Math.abs(d.i - d.o)) + '</b>' +
        '</span></td></tr>';
    };
    let ant = null;
    const diasVistos = new Set();
    const linhas = parte.map((t) => {
      const iso = dataISO(t.date);
      // Com o salário fixo no topo, o mesmo dia pode reaparecer depois: o separador sai só na primeira ocorrência
      const novoDia = op.chave === 'date' && iso !== ant && !diasVistos.has(iso);
      if (iso) diasVistos.add(iso);
      const h = (novoDia ? sepDia(iso) : '') + linhaHTML(t, op, ctx, ant);
      ant = iso;
      return h;
    }).join('');
    return '<div class="txp-wrap">' +
      '<div class="txp-scroll"><table class="txp-table"><caption class="txp-sr">Lançamentos de ' + esc(op.periodo) + ', ordenados por ' + esc(COLUNAS.filter((c) => c.k === op.chave)[0].t.toLowerCase()) + '</caption>' +
      cabecalhoHTML(op) + '<tbody>' + linhas + '</tbody></table></div>' +
      resumoHTML(r, ctx) +
      rodapeHTML(parte.length, lista.length, r, lista.length - parte.length) +
    '</div>';
  }

  // ---------------------------------------------------------------- Estado e eventos
  const estado = { chave: 'date', dir: 'desc', visiveis: PAGINA, assinatura: null, ultimo: null };
  try {
    const salvo = JSON.parse(global && global.localStorage ? global.localStorage.getItem('nexus_tx_ordem') || 'null' : 'null');
    if (salvo && CHAVES.indexOf(salvo.chave) >= 0 && (salvo.dir === 'asc' || salvo.dir === 'desc')) { estado.chave = salvo.chave; estado.dir = salvo.dir; }
  } catch (e) { /* sem armazenamento: usa a ordem padrão */ }
  function guardarOrdem() {
    try { global.localStorage.setItem('nexus_tx_ordem', JSON.stringify({ chave: estado.chave, dir: estado.dir })); } catch (e) { /* ok */ }
  }

  function opcoes(extras, hoje) {
    return {
      chave: estado.chave, dir: estado.dir, visiveis: estado.visiveis, acoes: true, hoje,
      filtrado: !!extras.filtrado, carregando: !!extras.carregando, totalGeral: extras.totalGeral || 0, periodo: extras.periodo || ''
    };
  }

  /** HTML pronto (usado na montagem inicial da página, antes de qualquer interação). */
  function html(lista, extras, ctx) {
    const hoje = hojeISO();
    return tabelaHTML(ordenar(lista, estado.chave, estado.dir, ctx.parseVal, hoje), opcoes(extras, hoje), ctx);
  }

  function pintar() {
    const u = estado.ultimo;
    if (!u || !u.wrap.isConnected) return;
    const hoje = hojeISO();
    u.ordenada = ordenar(u.lista, estado.chave, estado.dir, u.ctx.parseVal, hoje);
    u.wrap.innerHTML = tabelaHTML(u.ordenada, opcoes(u.extras, hoje), u.ctx);
  }

  function baixarCSV(u) {
    const hoje = hojeISO();
    const texto = csv(u.ordenada || ordenar(u.lista, estado.chave, estado.dir, u.ctx.parseVal, hoje), u.ctx.parseVal, hoje);
    const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transacoes-' + hoje + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 0);
  }

  function ligarTabela(wrap) {
    if (wrap._txLigado) return;
    wrap._txLigado = true;
    wrap.addEventListener('click', function (e) {
      const alvo = e.target && e.target.closest ? e.target.closest('[data-txsort],[data-txmore],[data-txexport],[data-txaction]') : null;
      const u = estado.ultimo;
      if (!alvo || !u || !wrap.contains(alvo)) return;
      if (alvo.hasAttribute('data-txsort')) {
        const k = alvo.getAttribute('data-txsort');
        if (estado.chave === k) estado.dir = estado.dir === 'asc' ? 'desc' : 'asc';
        else { estado.chave = k; estado.dir = (k === 'date' || k === 'val') ? 'desc' : 'asc'; }
        estado.visiveis = PAGINA;
        guardarOrdem();
        pintar();
        const novo = wrap.querySelector('[data-txsort="' + k + '"]');
        if (novo) novo.focus();
      } else if (alvo.hasAttribute('data-txmore')) {
        const antes = Math.min(estado.visiveis, u.lista.length);
        estado.visiveis += PAGINA;
        pintar();
        const linhas = wrap.querySelectorAll('tbody tr');
        const primeira = linhas[antes];
        if (primeira) { primeira.setAttribute('tabindex', '-1'); primeira.focus({ preventScroll: true }); primeira.scrollIntoView({ block: 'nearest' }); }
      } else if (alvo.hasAttribute('data-txexport')) {
        baixarCSV(u);
      } else if (u.ctx.acao) {
        u.ctx.acao(alvo.getAttribute('data-txaction'));
      }
    });
  }

  // Filtro "Tipo" em botões (Todos / Receitas / Despesas): o <select id="txFiltroTipo"> continua existindo (escondido) e
  // é ele que o restante do app lê; os botões só gravam o valor nele e disparam o mesmo evento.
  function ligarToolbar() {
    const barra = typeof document !== 'undefined' ? document.querySelector('.tx-toolbar') : null;
    if (!barra || barra._txLigado) return;
    barra._txLigado = true;
    barra.addEventListener('click', function (e) {
      const b = e.target && e.target.closest ? e.target.closest('[data-txtipo]') : null;
      const sel = document.getElementById('txFiltroTipo');
      if (!b || !sel) return;
      sel.value = b.getAttribute('data-txtipo');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  function sincronizarToolbar() {
    if (typeof document === 'undefined') return;
    const sel = document.getElementById('txFiltroTipo');
    const valor = sel ? sel.value : '';
    document.querySelectorAll('[data-txtipo]').forEach(function (b) {
      const ativo = b.getAttribute('data-txtipo') === valor;
      b.classList.toggle('is-on', ativo);
      b.setAttribute('aria-pressed', ativo ? 'true' : 'false');
    });
  }

  /**
   * Redesenha a tabela dentro de wrap. extras: { filtrado, assinatura, carregando, totalGeral, periodo }.
   * "assinatura" resume os filtros ativos: quando ela muda, a lista volta a mostrar só a primeira página.
   */
  function atualizar(wrap, lista, extras, ctx) {
    if (!wrap) return false;
    ligarTabela(wrap);
    ligarToolbar();
    if (extras.assinatura !== estado.assinatura) { estado.assinatura = extras.assinatura; estado.visiveis = PAGINA; }
    estado.ultimo = { wrap, lista, extras, ctx, ordenada: null };
    pintar();
    sincronizarToolbar();
    return true;
  }

  return {
    PAGINA, atualizar, html, sincronizarToolbar, estado,
    // exportados para os testes
    statusInfo, resumo, ordenar, csv, tabelaHTML, dataISO, hojeISO, rotuloRelativo, esc, corSegura
  };
});
