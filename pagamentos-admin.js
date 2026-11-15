/* Nexus - Pagamentos & Boletos (painel do administrador).
   Mesmo padrão do administracao.js: este arquivo tem o MODELO puro (testado em pagamentos-admin.test.js), o HTML e os eventos; o server.js só
   liga as ações do app pelo contexto (ctx) e fornece os dados (GET /api/admin/pagamentos). Nenhuma variável global do app é usada aqui.

   Telas (abas): Resumo (receita, MRR, vencimentos) | Cobranças (livro de pagamentos: filtros, lote, CSV, recibo, estorno) |
   Acessos (expirados e a vencer em 7 dias) | Nova cobrança (2ª via por Pix com QR local) | Conciliar extrato (OFX/CSV) | Solicitações (O.S.).

   ctx = função que devolve { usuarios:[...], eu:{email,nome}, ordens:[{id,protocol,nome,email,titulo,status}], toast(msg),
         sincronizar():Promise (atualiza a lista de contas do app), atualizarAbas(), abrirOs(id), abrirCadastro(email) } */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.NexusPag = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var DIA = 86400000;

  /* ============================================================ utilitários ============================================================ */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function paraMs(v) { var t = Date.parse(v); return isNaN(t) ? NaN : t; }
  function dataBR(v, comHora) {
    var t = paraMs(v);
    if (isNaN(t)) return '—';
    var o = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' };
    if (comHora) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(t).toLocaleString('pt-BR', o).replace(',', '');
  }
  function diaBR(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : '—'; }
  function mesDe(iso) { var t = paraMs(iso); return isNaN(t) ? '' : new Date(t - 3 * 3600000).toISOString().slice(0, 7); }
  function rotuloMes(chave) {
    var m = /^(\d{4})-(\d{2})$/.exec(chave || '');
    return m ? ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][parseInt(m[2], 10) - 1] + '/' + m[1] : '';
  }
  function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function hojeIso(agora) { return new Date((agora || Date.now()) - 3 * 3600000).toISOString().slice(0, 10); }
  function maisDiasIso(dias, agora) { return new Date((agora || Date.now()) - 3 * 3600000 + dias * DIA).toISOString().slice(0, 10); }
  // WhatsApp do Brasil: 55 + DDD + número (aceita com ou sem 55 e com máscara)
  function telefoneWhats(tel) {
    var d = soDigitos(tel);
    if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);
    return d.length === 10 || d.length === 11 ? '55' + d : '';
  }

  var METODOS = { pix: 'Pix', transferencia: 'Transferência / TED', dinheiro: 'Dinheiro', debit_card: 'Cartão de débito', credit_card: 'Cartão de crédito', boleto: 'Boleto' };
  var SITUACOES = {
    emitida: { rot: 'Cobrança emitida', cls: 'adm-p-info' },
    vencida: { rot: 'Vencida', cls: 'adm-p-ruim' },
    aguardando: { rot: 'Aguardando', cls: 'adm-p-aviso', dica: 'O cliente avisou que pagou: falta você conferir o recebimento e confirmar' },
    paga: { rot: 'Paga', cls: 'adm-p-ok' },
    cancelada: { rot: 'Cancelada', cls: 'adm-p-neutro' },
    estornada: { rot: 'Estornada', cls: 'adm-p-ruim' }
  };
  var ABAS = [
    { id: 'resumo', rotulo: 'Resumo' },
    { id: 'cobrancas', rotulo: 'Cobranças' },
    { id: 'acessos', rotulo: 'Expirados e a vencer' },
    { id: 'nova', rotulo: 'Nova cobrança (2ª via)' },
    { id: 'conciliar', rotulo: 'Conciliar extrato' },
    { id: 'solicitacoes', rotulo: 'Solicitações de boleto' }
  ];
  var ABA_ANTIGA = { pendentes: 'cobrancas', expirados: 'acessos', segunda_via_boleto: 'nova', solicitacoes_boleto: 'solicitacoes' };

  /* ============================================================ modelo ============================================================ */
  function aberta(p) { return p.situacao === 'aguardando' || p.situacao === 'emitida' || p.situacao === 'vencida'; }

  // f = { busca, situacao: 'todas' | 'abertas' | <situação>, mes: 'todos' | 'AAAA-MM' }
  function filtrar(lista, f) {
    var q = semAcento((f && f.busca) || '').trim();
    var sit = (f && f.situacao) || 'todas';
    var mes = (f && f.mes) || 'todos';
    return (lista || []).filter(function (p) {
      if (sit === 'abertas' ? !aberta(p) : (sit !== 'todas' && p.situacao !== sit)) return false;
      if (mes !== 'todos' && mesDe(p.paga_em || p.emitida_em) !== mes) return false;
      if (!q) return true;
      return semAcento([p.nome, p.email, p.ref, p.comprovante, p.id].join(' ')).indexOf(q) >= 0;
    });
  }
  function paginar(lista, pagina, porPagina) {
    var total = lista.length;
    var paginas = Math.max(1, Math.ceil(total / porPagina));
    var pg = Math.min(Math.max(1, pagina || 1), paginas);
    return { itens: lista.slice((pg - 1) * porPagina, pg * porPagina), total: total, paginas: paginas, pagina: pg };
  }
  function mesesDisponiveis(lista) {
    var set = {};
    (lista || []).forEach(function (p) { var m = mesDe(p.paga_em || p.emitida_em); if (m) set[m] = true; });
    return Object.keys(set).sort().reverse();
  }

  // Mensagem de WhatsApp com o Pix copia e cola dentro: o cliente paga sem digitar o valor (valor digitado à mão era a causa de pagamentos errados)
  // tipo: 'cobranca' (2ª via) | 'lembrete' (vence em breve) | 'vencido' (acesso expirado)
  function mensagemWhats(o) {
    var nome = primeiroNome(o.nome);
    var abre = 'Olá' + (nome ? ', ' + nome : '') + '! Aqui é do Nexus Financeiro Hub.';
    var corpo;
    if (o.tipo === 'lembrete') {
      corpo = o.dias != null && o.dias <= 0 ? 'Sua assinatura vence hoje.' : 'Sua assinatura vence em ' + plural(o.dias, 'dia', 'dias') + (o.expira ? ' (' + o.expira + ')' : '') + '.';
      corpo += ' Para continuar sem interrupção, a renovação mensal é de ' + moeda(o.valor) + '.';
    } else if (o.tipo === 'vencido') {
      corpo = 'Seu acesso ao Nexus expirou' + (o.expira ? ' em ' + o.expira : '') + '. Para voltar a usar, a assinatura mensal é de ' + moeda(o.valor) + '.';
    } else {
      corpo = 'Segue a cobrança da assinatura mensal do Nexus: ' + moeda(o.valor) + (o.vencimento ? ', com vencimento em ' + o.vencimento : '') + '.';
    }
    var linhas = [abre, corpo, '', 'Pix copia e cola (toque e segure para copiar):', o.payload || ''];
    if (o.chave) linhas.push('', 'Se preferir, a chave Pix (celular) é ' + o.chave + (o.favorecido ? ' — ' + o.favorecido : '') + ', no valor de ' + moeda(o.valor) + '.');
    if (o.ref) linhas.push('Referência: ' + o.ref);
    linhas.push('', 'Depois de pagar, o acesso é liberado assim que o recebimento for confirmado. Pode enviar o comprovante por aqui.');
    return linhas.join('\n');
  }
  function linkWhats(tel, texto) {
    var n = telefoneWhats(tel);
    return n ? 'https://wa.me/' + n + '?text=' + encodeURIComponent(texto) : '';
  }

  /* ============================================================ HTML ============================================================ */
  var IC = {
    busca: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    sinc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    ant: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    prox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    cartao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'
  };

  function pill(situacao) {
    var s = SITUACOES[situacao] || { rot: situacao, cls: 'adm-p-neutro' };
    return '<span class="adm-pill ' + s.cls + '"' + (s.dica ? ' title="' + esc(s.dica) + '"' : '') + '>' + esc(s.rot) + '</span>';
  }
  function kpi(o) {
    // valores em reais cabem numa linha só (o número grande do cartão quebrava "R$ / 162,00")
    var corpo = '<span class="adm-kpi-n' + (/^R\$/.test(String(o.n)) ? ' pg-din' : '') + '">' + esc(o.n) + '</span><span class="adm-kpi-t">' + esc(o.t) + '</span>' + (o.sub ? '<small>' + esc(o.sub) + '</small>' : '');
    return o.ir
      ? '<button type="button" class="adm-kpi adm-k-' + (o.cor || 'neutro') + '" data-pg-ir="' + esc(o.ir) + '" title="Ver a lista">' + corpo + '</button>'
      : '<div class="adm-kpi adm-kpi-fixo adm-k-' + (o.cor || 'neutro') + '">' + corpo + '</div>';
  }
  function vazio(titulo, texto) {
    return '<div class="adm-vazio"><span class="adm-vazio-ic">' + IC.cartao + '</span><h3>' + esc(titulo) + '</h3><p>' + esc(texto) + '</p></div>';
  }

  function navHTML(aba, c) {
    return '<nav class="pg-abas" role="tablist" aria-label="Seções de pagamentos">' + ABAS.map(function (a) {
      var on = a.id === aba;
      var n = '';
      if (a.id === 'cobrancas' && c.aguardando > 0) n = '<span class="adm-tab-n adm-tab-warn">' + c.aguardando + '</span>';
      if (a.id === 'solicitacoes' && c.solicitacoes > 0) n = '<span class="adm-tab-n">' + c.solicitacoes + '</span>';
      return '<button type="button" role="tab" class="pg-aba' + (on ? ' is-on' : '') + '" data-pg-aba="' + a.id + '" aria-selected="' + on + '">' + esc(a.rotulo) + n + '</button>';
    }).join('') + '</nav>';
  }

  /* ---- Resumo ---- */
  function barrasHTML(serie) {
    var max = Math.max.apply(null, serie.map(function (s) { return s.total; }).concat([1]));
    var texto = serie.map(function (s) { return rotuloMes(s.mes) + ' ' + moeda(s.total); }).join('; ');
    return '<div class="pg-barras" role="img" aria-label="Receita por mês: ' + esc(texto) + '">' + serie.map(function (s, i) {
      var h = s.total > 0 ? Math.max(4, Math.round((s.total / max) * 100)) : 0;
      return '<div class="pg-barra' + (i === serie.length - 1 ? ' is-atual' : '') + '"><span class="pg-barra-v">' + (s.total > 0 ? esc(moeda(s.total)) : '—') + '</span>' +
        '<div class="pg-barra-trilho"><i style="height:' + h + '%"></i></div><span class="pg-barra-m">' + esc(rotuloMes(s.mes)) + '</span>' +
        '<small>' + (s.qtd ? plural(s.qtd, 'pagamento', 'pagamentos') : 'sem pagamentos') + '</small></div>';
    }).join('') + '</div>';
  }
  function resumoHTML(dados) {
    var r = dados.resumo;
    var rec = r.receita;
    var variacao = rec.variacao_pct == null ? 'sem mês anterior para comparar' : (rec.variacao_pct >= 0 ? '+' : '') + rec.variacao_pct + '% sobre o mês anterior (' + moeda(rec.mes_anterior) + ')';
    var kpis = '<div class="adm-kpis">' +
      kpi({ n: moeda(rec.mes), t: 'Receita do mês', sub: variacao, cor: 'ok', ir: 'cobrancas:paga' }) +
      kpi({ n: moeda(r.mrr), t: 'Receita mensal recorrente (estimativa)', sub: r.pagantes + ' pagante(s) × ' + moeda(r.preco), cor: 'info' }) +
      kpi({ n: r.pagantes, t: 'Assinantes pagantes', sub: r.cortesias + ' cortesia(s) · ' + r.vitalicios + ' vitalício(s) · ' + r.testes + ' em teste', cor: 'ok' }) +
      kpi({ n: r.aguardando.qtd, t: 'Aguardando confirmação', sub: r.aguardando.qtd ? moeda(r.aguardando.valor) + ' a conferir' : 'nada a conferir', cor: r.aguardando.qtd ? 'aviso' : 'neutro', ir: 'cobrancas:aguardando' }) +
      kpi({ n: r.a_vencer_7d.qtd, t: 'Vencem em 7 dias', sub: r.a_vencer_7d.valor_previsto ? moeda(r.a_vencer_7d.valor_previsto) + ' previstos' : 'sem renovação prevista', cor: r.a_vencer_7d.qtd ? 'aviso' : 'neutro', ir: 'acessos' }) +
      kpi({ n: r.expirados.qtd, t: 'Acessos expirados', sub: 'precisam de pagamento', cor: r.expirados.qtd ? 'ruim' : 'neutro', ir: 'acessos' }) +
      kpi({ n: r.emitidas.qtd, t: 'Cobranças emitidas em aberto', sub: r.emitidas.vencidas + ' vencida(s) · ' + moeda(r.emitidas.valor), cor: r.emitidas.vencidas ? 'ruim' : 'info', ir: 'cobrancas:abertas' }) +
      kpi({ n: moeda(r.estornos_mes.valor), t: 'Estornos no mês', sub: plural(r.estornos_mes.qtd, 'estorno', 'estornos'), cor: r.estornos_mes.qtd ? 'ruim' : 'neutro' }) +
      '</div>';

    var pend = dados.pagamentos.filter(function (p) { return p.situacao === 'aguardando'; }).slice(0, 5);
    var listaPend = pend.length ? '<ul class="pg-lista-curta">' + pend.map(function (p) {
      return '<li><div><b>' + esc(p.nome || p.email) + '</b><small>' + esc(p.email) + ' · ' + esc(moeda(p.valor)) + ' · avisou em ' + esc(dataBR(p.informada_em || p.emitida_em, true)) + '</small></div>' +
        '<button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="confirmar" data-id="' + esc(p.id) + '">Confirmar</button></li>';
    }).join('') + '</ul>' : '<p class="pg-nada">Nenhum pagamento esperando confirmação.</p>';

    var venc = r.a_vencer_7d.lista.slice(0, 5);
    var listaVenc = venc.length ? '<ul class="pg-lista-curta">' + venc.map(function (u) {
      return '<li><div><b>' + esc(u.nome) + '</b><small>' + (u.dias <= 0 ? 'vence hoje' : 'vence em ' + plural(u.dias, 'dia', 'dias')) + (u.cortesia ? ' · cortesia' : '') + '</small></div>' +
        '<button type="button" class="adm-btn adm-btn-sm" data-pg-a="cobrar" data-email="' + esc(u.email) + '" data-tipo="lembrete" data-dias="' + u.dias + '">Lembrar</button></li>';
    }).join('') + '</ul>' : '<p class="pg-nada">Nenhuma assinatura vence nos próximos 7 dias.</p>';

    return kpis +
      '<div class="pg-grade">' +
        '<section class="pg-painel pg-painel-larga"><h3>Receita dos últimos 6 meses</h3>' + barrasHTML(r.serie) +
          '<p class="pg-nota">Conta só pagamentos confirmados (recebimento conferido por um administrador). A receita recorrente é uma estimativa: assinantes pagantes ativos × ' + esc(moeda(r.preco)) + '; cortesias e vitalícios não entram.</p>' +
          cobrancaMensalNota(dados) + '</section>' +
        '<section class="pg-painel"><h3>Esperando confirmação</h3>' + listaPend + '</section>' +
        '<section class="pg-painel"><h3>Vencem em breve</h3>' + listaVenc + '</section>' +
      '</div>';
  }

  /* ---- Cobranças ---- */
  var COLUNAS = '<colgroup><col style="width:46px"><col><col style="width:104px"><col style="width:150px"><col style="width:178px"><col style="width:292px"></colgroup>';
  function acoesDaLinha(p) {
    var a = [];
    if (aberta(p)) {
      a.push('<button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="confirmar" data-id="' + esc(p.id) + '">Confirmar</button>');
      a.push('<button type="button" class="adm-btn adm-btn-sm" data-pg-a="pix" data-id="' + esc(p.id) + '" title="Abrir o Pix, QR Code e a mensagem de WhatsApp desta cobrança">2ª via</button>');
      a.push('<button type="button" class="adm-btn adm-btn-sm" data-pg-a="cancelar" data-id="' + esc(p.id) + '">Cancelar</button>');
    }
    if (p.situacao === 'paga') {
      a.push('<button type="button" class="adm-btn adm-btn-sm" data-pg-a="recibo" data-id="' + esc(p.id) + '">Recibo</button>');
      a.push('<button type="button" class="adm-btn adm-btn-sm adm-btn-perigo" data-pg-a="estornar" data-id="' + esc(p.id) + '">Estornar</button>');
    }
    a.push('<button type="button" class="adm-btn adm-btn-sm" data-pg-a="historico" data-id="' + esc(p.id) + '">Histórico</button>');
    return a.join('');
  }
  function linhaCobranca(p, sel) {
    var datas = p.situacao === 'paga'
      ? '<b>Paga em ' + esc(dataBR(p.paga_em, true)) + '</b><small>cobre até ' + esc(dataBR(p.periodo_fim)) + '</small>'
      : '<b>Emitida ' + esc(dataBR(p.emitida_em)) + '</b><small>' + (p.vencimento ? 'vence ' + esc(diaBR(p.vencimento)) : 'sem vencimento') + '</small>';
    var por = p.situacao === 'paga' && p.confirmado_por ? '<small>por ' + esc(p.confirmado_por.nome || p.confirmado_por.email) + '</small>' : '';
    return '<tr class="adm-lin pg-lin' + (sel ? ' is-sel' : '') + '">' +
      '<td class="adm-c-sel"><input type="checkbox" class="adm-chk" data-pg-sel="' + esc(p.id) + '"' + (sel ? ' checked' : '') + (aberta(p) ? '' : ' disabled') + ' aria-label="Selecionar ' + esc(p.nome || p.email) + '"></td>' +
      '<td data-l="Cliente"><b class="adm-nome" title="' + esc(p.nome) + '">' + esc(p.nome || p.email) + '</b><small>' + esc(p.email) + ' · ref. ' + esc(p.ref) + '</small></td>' +
      '<td data-l="Valor"><b class="pg-valor">' + esc(moeda(p.valor)) + '</b><small>' + esc(METODOS[p.metodo] || p.metodo || '') + '</small></td>' +
      '<td data-l="Situação">' + pill(p.situacao) + (p.origem === 'legado' ? '<small>aviso anterior ao livro</small>' : (p.origem === 'usuario' ? '<small>avisado pelo cliente</small>' : (p.origem === 'automatica' ? '<small>gerada sozinha' + (p.competencia ? ' · ' + esc(rotuloMes(p.competencia)) : '') + '</small>' : ''))) + '</td>' +
      '<td data-l="Datas">' + datas + por + '</td>' +
      '<td class="pg-acoes" data-l="Ações">' + acoesDaLinha(p) + '</td></tr>';
  }
  function diaDaCobranca(dados) { return (dados && dados.cobranca_mensal && dados.cobranca_mensal.dia) || 5; }
  function cobrancaMensalNota(dados) {
    var c = dados && dados.cobranca_mensal;
    if (!c) return '';
    return '<p class="pg-nota">Todo dia ' + esc(c.dia) + ' o sistema gera sozinho a cobrança Pix de ' + esc(moeda(dados.preco)) + ' de cada assinatura paga e ativa (vence ' + plural(c.prazo_dias, 'dia', 'dias') + ' depois). ' +
      'Não recebem: teste, expirados, vitalícios, cortesias e plano anual; nem quem já pagou neste ciclo ou já tem cobrança em aberto. Próxima geração: <b>' + esc(diaBR(c.proxima)) + '</b>.</p>';
  }
  function cobrancasToolbar(estado, dados) {
    var meses = mesesDisponiveis(dados.pagamentos);
    var f = estado.filtro;
    var opSit = [['todas', 'Todas'], ['abertas', 'Em aberto (a receber)'], ['aguardando', 'Aguardando confirmação'], ['emitida', 'Cobrança emitida'], ['vencida', 'Vencidas'], ['paga', 'Pagas'], ['cancelada', 'Canceladas'], ['estornada', 'Estornadas']];
    var op = function (lista, atual) { return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(atual) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join(''); };
    return '<section class="adm-ferr" aria-label="Busca e filtros"><div class="adm-barra">' +
      '<label class="adm-busca">' + IC.busca + '<input type="search" id="pgBusca" data-pg-busca autocomplete="off" spellcheck="false" placeholder="Buscar nome, e-mail ou referência…" value="' + esc(f.busca) + '" aria-label="Buscar pagamentos"></label>' +
      '<label class="adm-sel"><span>Situação</span><select data-pg-filtro="situacao">' + op(opSit, f.situacao) + '</select></label>' +
      '<label class="adm-sel"><span>Mês</span><select data-pg-filtro="mes">' + op([['todos', 'Todos os meses']].concat(meses.map(function (m) { return [m, rotuloMes(m)]; })), f.mes) + '</select></label>' +
      '<button type="button" class="adm-btn" data-pg-a="gerar-mensal" title="O sistema já faz isto sozinho todo dia ' + esc(diaDaCobranca(dados)) + '. Use para gerar agora a cobrança do mês de quem ainda não tem.">Gerar cobranças do mês</button>' +
      '<button type="button" class="adm-btn" data-pg-a="csv" title="Baixar a lista filtrada em CSV (abre no Excel)">' + IC.baixar + '<span>Exportar CSV</span></button>' +
      '</div></section>';
  }
  function cobrancasLista(estado, dados) {
    var filtrados = filtrar(dados.pagamentos, estado.filtro);
    var pag = paginar(filtrados, estado.pagina, estado.porPagina);
    var selIds = Object.keys(estado.sel);
    var selHtml = selIds.length
      ? '<div class="adm-selbar"><b>' + plural(selIds.length, 'selecionada', 'selecionadas') + '</b><span class="adm-selbar-sp"></span>' +
        '<button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="confirmar-lote">Confirmar recebimento das selecionadas</button>' +
        '<button type="button" class="adm-btn adm-btn-sm" data-pg-a="limpar-sel">Limpar seleção</button></div>'
      : '';
    var pagina = pag.itens;
    var tudoSel = pagina.some(aberta) && pagina.filter(aberta).every(function (p) { return estado.sel[p.id]; });
    var tabela = pagina.length
      ? '<div class="adm-tabela-wrap pg-lista"><table class="adm-tabela pg-tabela">' + COLUNAS +
        '<thead><tr><th class="adm-c-sel"><input type="checkbox" class="adm-chk" data-pg-sel-pagina' + (tudoSel ? ' checked' : '') + ' aria-label="Selecionar as cobranças em aberto desta página"></th>' +
        ['Cliente', 'Valor', 'Situação', 'Datas', 'Ações'].map(function (t) { return '<th><span class="adm-th pg-th">' + t + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
        pagina.map(function (p) { return linhaCobranca(p, !!estado.sel[p.id]); }).join('') + '</tbody></table></div>'
      : vazio('Nenhuma cobrança encontrada', dados.pagamentos.length ? 'Nenhum registro combina com o filtro. Tire um filtro ou mude a busca.' : 'Ainda não há registros no livro. Eles aparecem quando uma cobrança é gerada ou um cliente avisa que pagou.');
    var rodape = '<div class="adm-rodape"><span class="adm-rodape-t"><b>' + pag.total + '</b> de ' + dados.pagamentos.length + ' registro' + (dados.pagamentos.length === 1 ? '' : 's') + '</span>' +
      (pag.paginas > 1 ? '<span class="pg-pags"><button type="button" class="adm-pg" data-pg-pag="' + (pag.pagina - 1) + '"' + (pag.pagina <= 1 ? ' disabled' : '') + ' aria-label="Página anterior">' + IC.ant + '</button>' +
        '<span class="adm-rodape-t">Página <b>' + pag.pagina + '</b> de ' + pag.paginas + '</span>' +
        '<button type="button" class="adm-pg" data-pg-pag="' + (pag.pagina + 1) + '"' + (pag.pagina >= pag.paginas ? ' disabled' : '') + ' aria-label="Próxima página">' + IC.prox + '</button></span>' : '') + '</div>';
    return selHtml + tabela + rodape;
  }
  function cobrancasHTML(estado, dados) {
    return cobrancasToolbar(estado, dados) + '<section id="pgLista" class="pg-lista-raiz" aria-label="Cobranças">' + cobrancasLista(estado, dados) + '</section>';
  }

  /* ---- Expirados e a vencer ---- */
  function acessosHTML(dados) {
    var r = dados.resumo;
    var tabelaExp = r.expirados.lista.length
      ? '<div class="adm-tabela-wrap pg-lista"><table class="adm-tabela pg-tabela"><colgroup><col><col style="width:200px"><col style="width:300px"></colgroup><thead><tr>' +
        ['Cliente', 'Situação', 'Ações'].map(function (t) { return '<th><span class="adm-th pg-th">' + t + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
        r.expirados.lista.map(function (u) {
          var sit = u.situacao === 'teste_fim' ? 'Teste encerrado' : (u.dias_atraso != null ? 'Expirou há ' + plural(u.dias_atraso, 'dia', 'dias') : 'Expirado');
          return '<tr class="adm-lin pg-lin"><td data-l="Cliente"><b class="adm-nome">' + esc(u.nome) + '</b><small>' + esc(u.email) + '</small></td>' +
            '<td data-l="Situação"><span class="adm-pill adm-p-ruim">' + esc(sit) + '</span>' + (u.expirou_em ? '<small>desde ' + esc(dataBR(u.expirou_em)) + '</small>' : '') + '</td>' +
            '<td class="pg-acoes" data-l="Ações"><button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="receber" data-email="' + esc(u.email) + '" title="O cliente já pagou: registrar o recebimento e liberar o acesso">Recebi o pagamento</button>' +
            '<button type="button" class="adm-btn adm-btn-sm" data-pg-a="cobrar" data-email="' + esc(u.email) + '" data-tipo="vencido">Cobrar (2ª via)</button>' +
            '<button type="button" class="adm-btn adm-btn-sm" data-pg-a="cadastro" data-email="' + esc(u.email) + '">Cadastro</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : vazio('Nenhum acesso expirado', 'Todos os assinantes estão em dia.');
    var tabelaVenc = r.a_vencer_7d.lista.length
      ? '<div class="adm-tabela-wrap pg-lista"><table class="adm-tabela pg-tabela"><colgroup><col><col style="width:200px"><col style="width:300px"></colgroup><thead><tr>' +
        ['Cliente', 'Vencimento', 'Ações'].map(function (t) { return '<th><span class="adm-th pg-th">' + t + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
        r.a_vencer_7d.lista.map(function (u) {
          return '<tr class="adm-lin pg-lin"><td data-l="Cliente"><b class="adm-nome">' + esc(u.nome) + '</b><small>' + esc(u.email) + '</small></td>' +
            '<td data-l="Vencimento"><span class="adm-pill adm-p-aviso">' + (u.dias <= 0 ? 'Vence hoje' : 'Em ' + plural(u.dias, 'dia', 'dias')) + '</span><small>' + esc(dataBR(u.expira)) + (u.cortesia ? ' · cortesia' : '') + '</small></td>' +
            '<td class="pg-acoes" data-l="Ações"><button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="cobrar" data-email="' + esc(u.email) + '" data-tipo="lembrete" data-dias="' + u.dias + '">Enviar lembrete</button>' +
            '<button type="button" class="adm-btn adm-btn-sm" data-pg-a="receber" data-email="' + esc(u.email) + '" title="O cliente já renovou: somar mais 30 dias ao prazo">Recebi a renovação</button></td></tr>';
        }).join('') + '</tbody></table></div>'
      : vazio('Nada vence em 7 dias', 'Nenhuma assinatura precisa de lembrete agora.');
    return '<section class="pg-bloco"><div class="pg-bloco-t"><h3>Vencem nos próximos 7 dias</h3><span class="adm-pill adm-p-aviso">' + r.a_vencer_7d.qtd + '</span></div>' + tabelaVenc + '</section>' +
      '<section class="pg-bloco"><div class="pg-bloco-t"><h3>Acessos expirados</h3><span class="adm-pill adm-p-ruim">' + r.expirados.qtd + '</span></div>' + tabelaExp +
      (r.expirados.qtd > r.expirados.lista.length ? '<p class="pg-nota">Mostrando os ' + r.expirados.lista.length + ' mais recentes.</p>' : '') + '</section>';
  }

  /* ---- Nova cobrança (2ª via) ---- */
  function rotuloConta(u) { return (u.name || u.email) + ' — ' + u.email; }
  function cobrancaResultadoHTML(res, usuario) {
    var p = res.pagamento;
    var pix = res.pix;
    var tel = usuario && usuario.phone;
    var msg = mensagemWhats({ tipo: 'cobranca', nome: p.nome, valor: p.valor, vencimento: p.vencimento ? diaBR(p.vencimento) : '', payload: pix.payload, ref: p.ref, chave: pix.chave, favorecido: pix.favorecido });
    var link = linkWhats(tel, msg);
    return '<div class="pg-resultado">' +
      '<div class="pg-resultado-qr"><img src="' + esc(pix.qr_url) + '" alt="QR Code Pix da cobrança ' + esc(p.ref) + '" width="220" height="220"></div>' +
      '<div class="pg-resultado-dados">' +
        '<dl class="pg-dl"><div><dt>Cliente</dt><dd>' + esc(p.nome) + '<small>' + esc(p.email) + '</small></dd></div>' +
        '<div><dt>Valor</dt><dd>' + esc(moeda(p.valor)) + '</dd></div><div><dt>Vencimento</dt><dd>' + esc(p.vencimento ? diaBR(p.vencimento) : '—') + '</dd></div>' +
        '<div><dt>Referência</dt><dd>' + esc(p.ref) + '</dd></div></dl>' +
        (res.reutilizada ? '<p class="pg-aviso">Já existia uma cobrança em aberto para esta conta: esta é a <b>2ª via da mesma cobrança</b> (mesma referência), com o vencimento ajustado.</p>' : '') +
        '<label class="pg-campo"><span>Pix copia e cola</span><textarea readonly rows="4" id="pgPayload" data-pg-copiavel>' + esc(pix.payload) + '</textarea></label>' +
        '<div class="pg-botoes">' +
          '<button type="button" class="adm-btn adm-btn-pri" data-pg-a="copiar" data-alvo="pgPayload">Copiar código Pix</button>' +
          '<button type="button" class="adm-btn" data-pg-a="imprimir" data-id="' + esc(p.id) + '">Imprimir / salvar em PDF</button>' +
          (link ? '<a class="adm-btn" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>' : '<span class="pg-nota">Esta conta não tem telefone válido para WhatsApp.</span>') +
        '</div>' +
        '<p class="pg-nota">É uma cobrança Pix para enviar ao cliente, <b>não um boleto bancário registrado</b>. O acesso é liberado quando você confirma o recebimento.</p>' +
      '</div></div>';
  }
  function novaHTML(estado, ctx) {
    var usuarios = (ctx.usuarios || []).filter(function (u) { return u && u.email && u.role !== 'Administrador'; })
      .sort(function (a, b) { return String(a.name || a.email).localeCompare(String(b.name || b.email), 'pt-BR'); });
    var n = estado.nova;
    var valorSel = n.cliente != null && n.cliente !== '' ? n.cliente : (n.email ? (function () { var u = usuarios.filter(function (x) { return x.email.toLowerCase() === n.email; })[0]; return u ? rotuloConta(u) : n.email; })() : '');
    return '<section class="pg-painel"><h3>Gerar a cobrança Pix de um cliente</h3>' +
      '<p class="pg-nota">Escolha a conta; o valor é o da assinatura mensal (' + esc(moeda(estado.dados ? estado.dados.preco : 0)) + '). Se já houver uma cobrança em aberto para a conta, ela é reaproveitada (2ª via).</p>' +
      '<div class="pg-form">' +
        '<label class="pg-campo"><span>Cliente</span><input list="pgContas" id="pgNovaCliente" data-pg-nova="cliente" autocomplete="off" placeholder="Digite o nome ou o e-mail…" value="' + esc(valorSel) + '"></label>' +
        '<datalist id="pgContas">' + usuarios.map(function (u) { return '<option value="' + esc(rotuloConta(u)) + '"></option>'; }).join('') + '</datalist>' +
        '<label class="pg-campo"><span>Vencimento</span><input type="date" id="pgNovaVenc" data-pg-nova="venc" min="' + esc(hojeIso()) + '" value="' + esc(n.venc || maisDiasIso(3)) + '"></label>' +
        '<label class="pg-campo pg-campo-larga"><span>Observação (opcional)</span><input type="text" id="pgNovaObs" data-pg-nova="obs" maxlength="200" placeholder="Ex.: renovação de dezembro" value="' + esc(n.obs || '') + '"></label>' +
      '</div>' +
      '<div class="pg-botoes"><button type="button" class="adm-btn adm-btn-pri" data-pg-a="nova-gerar"' + (n.enviando ? ' disabled' : '') + '>' + (n.enviando ? 'Gerando…' : 'Gerar cobrança Pix') + '</button></div>' +
      (n.erro ? '<p class="pg-erro" role="alert">' + esc(n.erro) + '</p>' : '') +
      '</section>' + (n.resultado ? '<section class="pg-painel"><h3>Cobrança pronta para enviar</h3>' + cobrancaResultadoHTML(n.resultado, n.usuario) + '</section>' : '');
  }

  /* ---- Conciliação ---- */
  function conciliarHTML(estado) {
    var c = estado.conc;
    var corpo = '';
    if (c.resultado) {
      var r = c.resultado;
      var fortes = r.sugestoes.filter(function (s) { return s.forca === 'forte'; });
      corpo += '<div class="adm-kpis">' +
        kpi({ n: r.lancamentos, t: 'Lançamentos lidos', sub: r.formato.toUpperCase() + ' · ' + r.creditos + ' entrada(s)', cor: 'neutro' }) +
        kpi({ n: r.sugestoes.length, t: 'Sugestões de pagamento', sub: fortes.length + ' forte(s)', cor: r.sugestoes.length ? 'ok' : 'neutro' }) +
        kpi({ n: r.sem_par.length, t: 'Entradas sem cobrança', sub: 'valor ou nome não conferem', cor: r.sem_par.length ? 'aviso' : 'neutro' }) +
        kpi({ n: r.ja_conciliados, t: 'Já conciliados antes', sub: 'ignorados', cor: 'info' }) + '</div>';
      if (r.sugestoes.length) {
        corpo += '<div class="adm-selbar"><b>' + plural(fortes.length, 'sugestão forte', 'sugestões fortes') + '</b><span class="adm-selbar-sp"></span>' +
          (fortes.length ? '<button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="conc-fortes">Confirmar todas as fortes</button>' : '') + '</div>' +
          '<div class="adm-tabela-wrap pg-lista"><table class="adm-tabela pg-tabela"><colgroup><col style="width:34%"><col><col style="width:150px"><col style="width:150px"></colgroup><thead><tr>' +
          ['Entrada no extrato', 'Cobrança sugerida', 'Confiança', 'Ação'].map(function (t) { return '<th><span class="adm-th pg-th">' + t + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
          r.sugestoes.map(function (s, i) {
            return '<tr class="adm-lin pg-lin"><td data-l="Extrato"><b class="adm-nome">' + esc(moeda(s.lancamento.valor)) + ' · ' + esc(diaBR(s.lancamento.data)) + '</b><small title="' + esc(s.lancamento.descricao) + '">' + esc(s.lancamento.descricao || 'sem descrição') + '</small></td>' +
              '<td data-l="Cobrança"><b class="adm-nome">' + esc(s.pagamento.nome || s.pagamento.email) + '</b><small>' + esc(s.pagamento.email) + ' · ref. ' + esc(s.pagamento.ref) + ' · ' + esc(moeda(s.pagamento.valor)) + '</small></td>' +
              '<td data-l="Confiança"><span class="adm-pill ' + (s.forca === 'forte' ? 'adm-p-ok' : 'adm-p-aviso') + '">' + (s.forca === 'forte' ? 'Forte' : 'Fraca') + '</span><small>' + esc(s.motivo) + '</small></td>' +
              '<td class="pg-acoes" data-l="Ação"><button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="conc-confirmar" data-i="' + i + '">Confirmar</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      } else {
        corpo += vazio('Nenhuma sugestão', 'Nenhuma entrada do extrato bate com uma cobrança em aberto (valor, data e nome/referência).');
      }
      if (r.sem_par.length) {
        corpo += '<details class="pg-detalhes"><summary>Entradas do extrato sem cobrança correspondente (' + r.sem_par.length + ')</summary><ul class="pg-lista-curta">' +
          r.sem_par.map(function (l) { return '<li><div><b>' + esc(moeda(l.valor)) + ' · ' + esc(diaBR(l.data)) + '</b><small>' + esc(l.descricao || 'sem descrição') + '</small></div></li>'; }).join('') + '</ul></details>';
      }
    }
    return '<section class="pg-painel"><h3>Conciliar com o extrato do banco</h3>' +
      '<p class="pg-nota">Baixe o extrato no app ou site do banco (formato <b>OFX</b> ou <b>CSV</b>) e envie aqui. O sistema procura as entradas que combinam com cobranças em aberto e <b>apenas sugere</b>: nada é confirmado sem o seu clique, e um lançamento do extrato só pode confirmar uma cobrança. O arquivo é lido no servidor e não é guardado.</p>' +
      '<div class="pg-botoes"><label class="adm-btn adm-btn-pri pg-arquivo">' + (c.enviando ? 'Lendo o extrato…' : 'Escolher arquivo do extrato') + '<input type="file" id="pgArquivo" data-pg-arquivo accept=".ofx,.csv,.txt,text/csv,application/x-ofx"' + (c.enviando ? ' disabled' : '') + '></label>' +
      (c.nome ? '<span class="pg-nota">' + esc(c.nome) + '</span>' : '') + '</div>' +
      (c.erro ? '<p class="pg-erro" role="alert">' + esc(c.erro) + '</p>' : '') + '</section>' + corpo;
  }

  /* ---- Solicitações (O.S.) ---- */
  function solicitacoesHTML(ctx) {
    var lista = ctx.ordens || [];
    if (!lista.length) return vazio('Nenhuma solicitação de boleto pendente', 'Quando um cliente pedir a 2ª via de boleto pelo atendimento, ela aparece aqui.');
    return '<div class="adm-tabela-wrap pg-lista"><table class="adm-tabela pg-tabela"><colgroup><col style="width:130px"><col><col style="width:150px"><col style="width:190px"></colgroup><thead><tr>' +
      ['Protocolo', 'Cliente e solicitação', 'Status', 'Ação'].map(function (t) { return '<th><span class="adm-th pg-th">' + t + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      lista.map(function (o) {
        return '<tr class="adm-lin pg-lin"><td data-l="Protocolo"><b>' + esc(o.protocol || o.id) + '</b></td>' +
          '<td data-l="Cliente"><b class="adm-nome">' + esc(o.nome || 'Cliente') + '</b><small>' + esc(o.email || '') + ' · ' + esc(o.titulo || 'Solicitação de boleto') + '</small></td>' +
          '<td data-l="Status">' + esc(o.status || 'Pendente') + '</td>' +
          '<td class="pg-acoes" data-l="Ação"><button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-pg-a="abrir-os" data-id="' + esc(o.id) + '">Abrir solicitação</button>' +
          '<button type="button" class="adm-btn adm-btn-sm" data-pg-a="cobrar" data-email="' + esc(o.email || '') + '" data-tipo="cobranca">Gerar Pix</button></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---- documentos para imprimir ---- */
  function docBase(titulo, corpo) {
    return '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>' + esc(titulo) + '</title>' +
      '<style>body{font:15px Arial,sans-serif;color:#172033;max-width:760px;margin:32px auto;padding:24px}header{border-bottom:2px solid #059669;padding-bottom:14px}h1{font-size:24px;margin:0 0 6px}small{color:#64748b}.box{border:1px solid #cbd5e1;border-radius:12px;padding:18px;margin:18px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.qr{width:220px;height:220px}.code{font:12px monospace;word-break:break-all;background:#f1f5f9;padding:12px;border-radius:8px}.note{color:#92400e;background:#fffbeb;border:1px solid #fcd34d;padding:12px;border-radius:8px}button{font:inherit;padding:8px 14px;cursor:pointer}@media print{button{display:none}body{margin:0 auto}}</style>' +
      '<body>' + corpo + '<p><button onclick="window.print()">Imprimir / salvar em PDF</button></p></body></html>';
  }
  function cobrancaDocumento(res, origem) {
    var p = res.pagamento, pix = res.pix;
    return docBase('Cobrança Pix ' + p.ref,
      '<header><small>NEXUS FINANCEIRO HUB · COBRANÇA</small><h1>Instrução de pagamento via Pix</h1><small>Referência ' + esc(p.ref) + '</small></header>' +
      '<section class="box grid"><div><small>CLIENTE</small><p><strong>' + esc(p.nome) + '</strong><br>' + esc(p.email) + '</p></div><div><small>PLANO</small><p><strong>Mensal · 30 dias</strong></p></div>' +
      '<div><small>VALOR</small><p><strong>' + esc(moeda(p.valor)) + '</strong></p></div><div><small>VENCIMENTO</small><p><strong>' + esc(p.vencimento ? diaBR(p.vencimento) : '—') + '</strong></p></div></section>' +
      '<section class="box" style="text-align:center"><h2>Escaneie o QR Code Pix</h2><img class="qr" src="' + esc((origem || '') + pix.qr_url) + '" alt="QR Code Pix"><p>Favorecido: <strong>' + esc(pix.favorecido) + '</strong></p><p>Chave Pix (celular): <strong>' + esc(pix.chave) + '</strong></p></section>' +
      '<section class="box"><strong>Pix copia e cola</strong><p class="code">' + esc(pix.payload) + '</p></section>' +
      '<p class="note"><strong>Importante:</strong> este documento é uma instrução de pagamento via Pix, não é um boleto bancário registrado. O acesso é liberado após a confirmação do recebimento.</p>');
  }
  function reciboDocumento(p) {
    return docBase('Recibo ' + p.ref,
      '<header><small>NEXUS FINANCEIRO HUB · RECIBO</small><h1>Recibo de pagamento</h1><small>Referência ' + esc(p.ref) + '</small></header>' +
      '<section class="box grid"><div><small>CLIENTE</small><p><strong>' + esc(p.nome) + '</strong><br>' + esc(p.email) + '</p></div><div><small>VALOR RECEBIDO</small><p><strong>' + esc(moeda(p.valor)) + '</strong></p></div>' +
      '<div><small>FORMA DE PAGAMENTO</small><p><strong>' + esc(METODOS[p.metodo] || p.metodo || 'Pix') + '</strong></p></div><div><small>DATA DO RECEBIMENTO</small><p><strong>' + esc(dataBR(p.paga_em, true)) + '</strong></p></div>' +
      '<div><small>REFERE-SE A</small><p><strong>Assinatura ' + esc(p.plano === 'anual' ? 'anual' : 'mensal') + '</strong></p></div><div><small>ACESSO COBERTO</small><p><strong>' + esc(dataBR(p.periodo_inicio)) + ' a ' + esc(dataBR(p.periodo_fim)) + '</strong></p></div></section>' +
      '<p><small>Recebimento confirmado por ' + esc(p.confirmado_por ? (p.confirmado_por.nome || p.confirmado_por.email) : 'administrador') + ' · registro ' + esc(p.id) + '</small></p>' +
      '<p class="note">Comprovante simples de pagamento da assinatura. Não é documento fiscal.</p>');
  }

  /* ============================================================ estado e telas ============================================================ */
  var estado = {
    aba: 'resumo', dados: null, carregando: false, carregadoEm: 0, erro: '',
    filtro: { busca: '', situacao: 'todas', mes: 'todos' }, pagina: 1, porPagina: 25, sel: {},
    nova: { email: '', cliente: '', venc: '', obs: '', resultado: null, usuario: null, enviando: false, erro: '' },
    conc: { resultado: null, enviando: false, nome: '', erro: '' }
  };
  var ctxFn = null, ligado = false, tempoBusca = null;
  function ctx() { return (ctxFn && ctxFn()) || {}; }
  function contagens() {
    var c = ctx();
    return { aguardando: estado.dados ? estado.dados.resumo.aguardando.qtd : 0, solicitacoes: (c.ordens || []).length };
  }
  function contagem() { return estado.dados ? estado.dados.resumo.aguardando.qtd : null; }

  function abaHTML() {
    var c = ctx();
    if (estado.erro && !estado.dados) return '<p class="pg-erro" role="alert">' + esc(estado.erro) + '</p><button type="button" class="adm-btn" data-pg-a="atualizar">Tentar de novo</button>';
    if (!estado.dados) return '<div class="adm-vazio"><h3>Carregando pagamentos…</h3><p>Buscando o livro de pagamentos no servidor.</p></div>';
    switch (estado.aba) {
      case 'cobrancas': return cobrancasHTML(estado, estado.dados);
      case 'acessos': return acessosHTML(estado.dados);
      case 'nova': return novaHTML(estado, c);
      case 'conciliar': return conciliarHTML(estado);
      case 'solicitacoes': return solicitacoesHTML(c);
      default: return resumoHTML(estado.dados);
    }
  }
  function cabecalhoHTML() {
    var hora = estado.carregadoEm ? new Date(estado.carregadoEm).toLocaleTimeString('pt-BR') : '';
    return '<header class="adm-cab"><div class="adm-cab-t"><span class="adm-cab-ic">' + IC.cartao + '</span><div><h1>Pagamentos &amp; Boletos</h1>' +
      '<p>Cobranças, recebimentos, 2ª via por Pix e conciliação do extrato. Assinatura mensal de <b class="pg-nw">' + esc(moeda(estado.dados ? estado.dados.preco : 0)) + '</b>.</p></div></div>' +
      '<div class="adm-cab-acoes"><span class="adm-sinc" id="pgSinc">' + (hora ? 'Atualizado às ' + esc(hora) : '') + '</span>' +
      '<button type="button" class="adm-btn" data-pg-a="atualizar">' + IC.sinc + '<span>Atualizar</span></button></div></header>';
  }
  function conteudo() {
    return cabecalhoHTML() + '<div id="pgNav">' + navHTML(estado.aba, contagens()) + '</div><div id="pgAba" class="pg-aba-corpo">' + abaHTML() + '</div>';
  }
  function raiz() { return root.document && root.document.getElementById('pgRaiz'); }
  // Em tela estreita as seções rolam na horizontal: depois de redesenhar, deixa a seção ativa à vista
  function mostrarAbaAtiva() {
    var doc = root.document;
    var n = doc.querySelector('.pg-abas'), a = doc.querySelector('.pg-aba.is-on');
    if (n && a && n.scrollWidth > n.clientWidth) n.scrollLeft = Math.max(0, a.offsetLeft - 12);
  }
  function repintar() { var r = raiz(); if (r) { r.innerHTML = conteudo(); mostrarAbaAtiva(); } }
  function repintarAba() {
    var n = root.document.getElementById('pgNav'), a = root.document.getElementById('pgAba');
    if (n) n.innerHTML = navHTML(estado.aba, contagens());
    if (a) a.innerHTML = abaHTML();
    mostrarAbaAtiva();
  }
  function repintarLista() {
    var l = root.document.getElementById('pgLista');
    if (l && estado.dados && estado.aba === 'cobrancas') l.innerHTML = cobrancasLista(estado, estado.dados);
    else repintarAba();
  }
  function avisarAbas() { var c = ctx(); if (c.atualizarAbas) c.atualizarAbas(); }
  function toast(msg) { var c = ctx(); if (c.toast) c.toast(msg); }

  /* ---- servidor ---- */
  function api(metodo, caminho, corpo) {
    var opts = { method: metodo, headers: {} };
    if (corpo !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(corpo); }
    return root.fetch(root.location.origin + caminho, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    }).catch(function () { return { success: false, error: 'Falha na comunicação com o servidor.', _status: 0 }; });
  }
  function carregar(silencioso) {
    if (estado.carregando) return Promise.resolve();
    estado.carregando = true;
    return api('GET', '/api/admin/pagamentos').then(function (j) {
      estado.carregando = false;
      if (j && j.success) {
        estado.dados = j; estado.erro = ''; estado.carregadoEm = Date.now();
        Object.keys(estado.sel).forEach(function (id) { if (!j.pagamentos.some(function (p) { return p.id === id && aberta(p); })) delete estado.sel[id]; });
      } else if (!silencioso || !estado.dados) estado.erro = (j && j.error) || 'Não foi possível carregar os pagamentos.';
      redesenharDepoisDeCarregar(silencioso);
      avisarAbas();
    });
  }
  // Não apaga o que a pessoa está digitando: numa atualização silenciosa, com o cursor num campo da aba, só a hora do cabeçalho muda
  function redesenharDepoisDeCarregar(silencioso) {
    var doc = root.document;
    if (!raiz()) return;
    var ativo = doc.activeElement;
    var digitando = silencioso && ativo && ativo.matches && ativo.matches('input,textarea,select') && raiz().contains(ativo);
    var sinc = doc.getElementById('pgSinc');
    if (sinc && estado.carregadoEm) sinc.textContent = 'Atualizado às ' + new Date(estado.carregadoEm).toLocaleTimeString('pt-BR');
    if (digitando) return;
    guardarCampos();
    repintar();
  }
  function guardarCampos() {
    var doc = root.document, n = estado.nova;
    var c = doc.getElementById('pgNovaCliente'), v = doc.getElementById('pgNovaVenc'), o = doc.getElementById('pgNovaObs');
    if (c) n.cliente = c.value;
    if (v) n.venc = v.value;
    if (o) n.obs = o.value;
  }
  // Depois de uma ação que muda contas: recarrega o livro e a lista de contas do app (cadastros e menu usam as mesmas contas)
  function depoisDeMudar() {
    var c = ctx();
    return Promise.resolve(c.sincronizar ? c.sincronizar() : null).catch(function () {}).then(function () { return carregar(true); });
  }

  /* ---- janelas (mesmas classes do painel de cadastros) ---- */
  function dialogo(o) {
    var doc = root.document;
    return new Promise(function (resolve) {
      var antigo = doc.getElementById('pgDialogo');
      if (antigo) antigo.remove();
      var el = doc.createElement('div');
      el.id = 'pgDialogo'; el.className = 'adm-dlg pg-dlg';
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'pgDlgT');
      el.innerHTML = '<div class="adm-dlg-fundo" data-r="0"></div><div class="adm-dlg-cx' + (o.larga ? ' pg-dlg-larga' : '') + '"><h3 id="pgDlgT">' + esc(o.titulo) + '</h3>' +
        '<div class="adm-dlg-tx">' + (o.html || '') + '<p class="pg-erro" id="pgDlgErro" role="alert" hidden></p></div>' +
        '<div class="adm-dlg-bt">' + (o.semCancelar ? '' : '<button type="button" class="adm-btn" data-r="0">' + esc(o.cancelar || 'Cancelar') + '</button>') +
        (o.ok ? '<button type="button" class="adm-btn ' + (o.perigo ? 'adm-btn-perigo-cheio' : 'adm-btn-pri') + '" data-r="1">' + esc(o.ok) + '</button>' : '') + '</div></div>';
      var anterior = doc.activeElement;
      var fim = function (v) { el.remove(); doc.removeEventListener('keydown', tecla, true); if (anterior && anterior.focus) { try { anterior.focus(); } catch (e) {} } resolve(v); };
      var tecla = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); fim(null); } };
      el.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-r]') : null;
        if (!b) return;
        if (b.getAttribute('data-r') !== '1') return fim(null);
        var vals = {};
        el.querySelectorAll('[data-campo]').forEach(function (c) { vals[c.getAttribute('data-campo')] = c.value; });
        var erro = o.validar ? o.validar(vals) : '';
        if (erro) { var e = el.querySelector('#pgDlgErro'); e.textContent = erro; e.hidden = false; return; }
        fim(vals);
      });
      doc.addEventListener('keydown', tecla, true);
      doc.body.appendChild(el);
      var alvo = el.querySelector('[data-campo]') || el.querySelector('[data-r="1"]') || el.querySelector('[data-r]');
      if (alvo) alvo.focus();
    });
  }
  function fecharDialogo() { var e = root.document.getElementById('pgDialogo'); if (e) { var b = e.querySelector('[data-r="0"]'); if (b) b.click(); } }

  function achar(id) { return estado.dados ? estado.dados.pagamentos.filter(function (p) { return p.id === id; })[0] : null; }
  function acharConta(email) {
    var k = String(email || '').toLowerCase();
    return (ctx().usuarios || []).filter(function (u) { return u && String(u.email || '').toLowerCase() === k; })[0] || null;
  }
  function selectMetodos(atual) {
    return '<select data-campo="metodo">' + Object.keys(METODOS).filter(function (m) { return m !== 'boleto' && m !== 'credit_card' && m !== 'debit_card'; })
      .map(function (m) { return '<option value="' + m + '"' + (m === atual ? ' selected' : '') + '>' + esc(METODOS[m]) + '</option>'; }).join('') + '</select>';
  }
  function validarValor(v) {
    var t = String(v.valor || '').trim();
    if (!t) return 'Informe o valor recebido.';
    if (!/^(R\$\s*)?\d{1,3}(\.\d{3})*(,\d{1,2})?$|^(R\$\s*)?\d+([.,]\d{1,2})?$/.test(t)) return 'Valor inválido. Exemplo: 18,00';
    return '';
  }

  /* ---- ações ---- */
  function confirmarRegistro(p, extra) {
    extra = extra || {};
    return dialogo({
      titulo: 'Confirmar recebimento', ok: 'Confirmar recebimento',
      html: '<p><b>' + esc(p.nome || p.email) + '</b> · ref. ' + esc(p.ref) + '<br>Cobrado: <b>' + esc(moeda(p.valor)) + '</b>. Confirme só depois de ver o dinheiro na conta.</p>' +
        '<label class="pg-campo"><span>Valor recebido (R$)</span><input data-campo="valor" inputmode="decimal" value="' + esc(String(Number(extra.valor != null ? extra.valor : p.valor).toFixed(2)).replace('.', ',')) + '"></label>' +
        '<label class="pg-campo"><span>Recebido por</span>' + selectMetodos('pix') + '</label>' +
        '<label class="pg-campo"><span>Observação (opcional)</span><input data-campo="obs" maxlength="200" placeholder="Ex.: comprovante enviado pelo WhatsApp"></label>' +
        '<p class="pg-nota">O acesso soma 30 dias ao prazo que a conta ainda tem. Confirmar duas vezes o mesmo registro não soma de novo.</p>',
      validar: validarValor
    }).then(function (v) {
      if (!v) return null;
      return api('POST', '/api/admin/pagamentos/acao', { id: p.id, acao: 'confirmar', valor: v.valor, metodo: v.metodo, obs: v.obs, extrato_id: extra.extratoId }).then(function (j) {
        toast(j && j.success ? '✅ ' + j.message : '⚠️ ' + ((j && j.error) || 'Não foi possível confirmar.'));
        return j;
      });
    });
  }
  function acaoConfirmar(id) {
    var p = achar(id);
    if (!p) return Promise.resolve();
    return confirmarRegistro(p).then(function (j) { if (j && j.success) return depoisDeMudar(); });
  }
  function acaoConfirmarLote() {
    var ids = Object.keys(estado.sel).filter(function (id) { var p = achar(id); return p && aberta(p); });
    if (!ids.length) { toast('Selecione cobranças em aberto.'); return Promise.resolve(); }
    var total = ids.reduce(function (s, id) { return s + achar(id).valor; }, 0);
    return dialogo({
      titulo: 'Confirmar ' + plural(ids.length, 'recebimento', 'recebimentos') + '?', ok: 'Confirmar ' + ids.length, larga: true,
      html: '<p>Total a conferir: <b>' + esc(moeda(total)) + '</b>. Cada conta ganha 30 dias, pelo valor cobrado, como <b>Pix</b>. Confirme só se TODOS já estão na sua conta; para valores diferentes, confirme um a um.</p>' +
        '<ul class="pg-lista-curta">' + ids.slice(0, 12).map(function (id) { var p = achar(id); return '<li><div><b>' + esc(p.nome || p.email) + '</b><small>' + esc(p.email) + '</small></div><b>' + esc(moeda(p.valor)) + '</b></li>'; }).join('') +
        (ids.length > 12 ? '<li><div><small>e mais ' + (ids.length - 12) + '…</small></div></li>' : '') + '</ul>'
    }).then(function (v) {
      if (!v) return null;
      var ok = 0, falhas = [];
      return ids.reduce(function (cadeia, id) {
        return cadeia.then(function () {
          var p = achar(id);
          return api('POST', '/api/admin/pagamentos/acao', { id: id, acao: 'confirmar', valor: p.valor, metodo: 'pix', obs: 'Confirmação em lote' }).then(function (j) { if (j && j.success) ok++; else falhas.push((p.nome || p.email) + ': ' + ((j && j.error) || 'erro')); });
        });
      }, Promise.resolve()).then(function () {
        estado.sel = {};
        toast(ok + ' de ' + ids.length + ' recebimento(s) confirmado(s).' + (falhas.length ? ' Falhas: ' + falhas.slice(0, 2).join(' | ') : ''));
        return depoisDeMudar();
      });
    });
  }
  function acaoCancelar(id) {
    var p = achar(id);
    if (!p) return Promise.resolve();
    return dialogo({
      titulo: 'Cancelar esta cobrança?', ok: 'Cancelar cobrança', cancelar: 'Voltar', perigo: true,
      html: '<p><b>' + esc(p.nome || p.email) + '</b> · ref. ' + esc(p.ref) + ' · ' + esc(moeda(p.valor)) + '<br>Use quando a cobrança foi gerada por engano ou está duplicada. O acesso da conta não muda.</p>' +
        '<label class="pg-campo"><span>Motivo (opcional)</span><input data-campo="obs" maxlength="200"></label>'
    }).then(function (v) {
      if (!v) return null;
      return api('POST', '/api/admin/pagamentos/acao', { id: id, acao: 'cancelar', obs: v.obs }).then(function (j) {
        toast(j && j.success ? j.message : '⚠️ ' + ((j && j.error) || 'Não foi possível cancelar.'));
        if (j && j.success) return depoisDeMudar();
      });
    });
  }
  function acaoEstornar(id) {
    var p = achar(id);
    if (!p) return Promise.resolve();
    return dialogo({
      titulo: 'Estornar este pagamento?', ok: 'Estornar pagamento', cancelar: 'Voltar', perigo: true,
      html: '<p><b>' + esc(p.nome || p.email) + '</b> · ' + esc(moeda(p.valor)) + ' recebido em ' + esc(dataBR(p.paga_em)) + '.<br>Use quando o dinheiro foi devolvido ao cliente ou o pagamento não existiu. Os <b>' + p.dias + ' dias</b> que ele deu serão tirados da conta' + (p.dias ? '; se não sobrar prazo, o acesso é bloqueado.' : '.') + '</p>' +
        '<label class="pg-campo"><span>Motivo (recomendado)</span><input data-campo="obs" maxlength="200" placeholder="Ex.: devolvido por Pix em 15/11"></label>'
    }).then(function (v) {
      if (!v) return null;
      return api('POST', '/api/admin/pagamentos/acao', { id: id, acao: 'estornar', obs: v.obs }).then(function (j) {
        toast(j && j.success ? j.message : '⚠️ ' + ((j && j.error) || 'Não foi possível estornar.'));
        if (j && j.success) return depoisDeMudar();
      });
    });
  }
  function acaoHistorico(id) {
    var p = achar(id);
    if (!p) return Promise.resolve();
    var h = (p.historico || []).slice().reverse();
    return dialogo({
      titulo: 'Histórico · ref. ' + p.ref, semCancelar: true, ok: 'Fechar', larga: true,
      html: '<p><b>' + esc(p.nome || p.email) + '</b> · ' + esc(moeda(p.valor)) + ' · ' + pill(p.situacao) + '</p>' +
        (h.length ? '<ul class="pg-hist">' + h.map(function (e) { return '<li><b>' + esc(e.acao) + '</b> <small>' + esc(dataBR(e.em, true)) + ' · ' + esc(e.por || 'sistema') + '</small>' + (e.nota ? '<span>' + esc(e.nota) + '</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="pg-nada">Sem eventos registrados.</p>')
    });
  }
  function acaoRecibo(id) {
    var p = achar(id);
    if (!p) return;
    abrirDocumento(reciboDocumento(p));
  }
  function abrirDocumento(html) {
    var w = root.open('', '_blank');
    if (!w) { toast('Permita a abertura de janelas para imprimir.'); return; }
    w.opener = null;
    w.document.open(); w.document.write(html); w.document.close(); w.focus();
  }
  // Mostra a cobrança (QR local, copia e cola, WhatsApp, impressão) numa janela
  function mostrarCobranca(res, usuario, tipo, extra) {
    extra = extra || {};
    var p = res.pagamento, pix = res.pix;
    var msg = mensagemWhats({ tipo: tipo || 'cobranca', nome: p.nome, valor: p.valor, vencimento: p.vencimento ? diaBR(p.vencimento) : '', payload: pix.payload, ref: p.ref, chave: pix.chave, favorecido: pix.favorecido, dias: extra.dias, expira: extra.expira });
    var link = linkWhats(usuario && usuario.phone, msg);
    estado.ultimaCobranca = res;
    return dialogo({
      titulo: (tipo === 'lembrete' ? 'Lembrete de renovação' : (res.reutilizada ? '2ª via da cobrança' : 'Cobrança gerada')) + ' · ' + (p.nome || p.email), semCancelar: true, ok: 'Fechar', larga: true,
      html: '<div class="pg-resultado"><div class="pg-resultado-qr"><img src="' + esc(pix.qr_url) + '" alt="QR Code Pix" width="200" height="200"></div><div class="pg-resultado-dados">' +
        '<p><b>' + esc(moeda(p.valor)) + '</b> · vence ' + esc(p.vencimento ? diaBR(p.vencimento) : '—') + ' · ref. ' + esc(p.ref) + '</p>' +
        (res.reutilizada ? '<p class="pg-aviso">Já existia uma cobrança em aberto: esta é a 2ª via dela (mesma referência).</p>' : '') +
        '<label class="pg-campo"><span>Mensagem pronta para o WhatsApp</span><textarea readonly rows="7" id="pgMsg" data-pg-copiavel>' + esc(msg) + '</textarea></label>' +
        '<div class="pg-botoes"><button type="button" class="adm-btn" data-pg-a="copiar" data-alvo="pgMsg">Copiar mensagem</button>' +
        '<button type="button" class="adm-btn" data-pg-a="copiar-pix" data-payload="' + esc(pix.payload) + '">Copiar só o código Pix</button>' +
        '<button type="button" class="adm-btn" data-pg-a="imprimir-ultima">Imprimir</button>' +
        (link ? '<a class="adm-btn adm-btn-pri" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">Abrir WhatsApp</a>' : '') + '</div>' +
        (link ? '' : '<p class="pg-nota">Esta conta não tem telefone válido para WhatsApp: copie a mensagem e envie por outro canal.</p>') +
      '</div></div>'
    });
  }
  function gerarCobranca(email, opcoes) {
    return api('POST', '/api/admin/pagamentos/cobranca', { email: email, vencimento: opcoes && opcoes.vencimento, obs: opcoes && opcoes.obs });
  }
  function acaoCobrar(email, tipo, dias) {
    var u = acharConta(email);
    var r = estado.dados && estado.dados.resumo;
    var info = r ? (r.expirados.lista.concat(r.a_vencer_7d.lista)).filter(function (x) { return x.email === String(email).toLowerCase(); })[0] : null;
    return gerarCobranca(email).then(function (j) {
      if (!j || !j.success) { toast('⚠️ ' + ((j && j.error) || 'Não foi possível gerar a cobrança.')); return; }
      var extra = { dias: dias != null ? parseInt(dias, 10) : (info && info.dias), expira: info && (info.expira || info.expirou_em) ? dataBR(info.expira || info.expirou_em) : '' };
      return carregar(true).then(function () { return mostrarCobranca(j, u, tipo, extra); });
    });
  }
  // O cliente já pagou e não há cobrança no livro: registra o recebimento (a rota antiga cria o registro e soma ao prazo)
  function acaoReceber(email) {
    var u = acharConta(email);
    var preco = estado.dados ? estado.dados.preco : 0;
    var nome = (u && u.name) || email;
    return dialogo({
      titulo: 'Registrar recebimento', ok: 'Registrar e liberar acesso',
      html: '<p><b>' + esc(nome) + '</b> · ' + esc(email) + '<br>Use quando o cliente pagou por fora (Pix direto, transferência, dinheiro) e não havia cobrança no livro. Confirme só depois de ver o dinheiro na conta.</p>' +
        '<label class="pg-campo"><span>Valor recebido (R$)</span><input data-campo="valor" inputmode="decimal" value="' + esc(String(Number(preco).toFixed(2)).replace('.', ',')) + '"></label>' +
        '<label class="pg-campo"><span>Recebido por</span>' + selectMetodos('pix') + '</label>' +
        '<label class="pg-campo"><span>Observação (opcional)</span><input data-campo="obs" maxlength="200"></label>',
      validar: validarValor
    }).then(function (v) {
      if (!v) return null;
      var c = ctx();
      return api('POST', '/api/subscription/confirm-payment', { admin_email: c.eu && c.eu.email, target_email: email, plan: 'mensal', method: v.metodo, amount: v.valor, obs: v.obs, conclude_os: false }).then(function (j) {
        toast(j && j.success ? '✅ ' + j.message : '⚠️ ' + ((j && j.error) || 'Não foi possível registrar.'));
        if (j && j.success) return depoisDeMudar();
      });
    });
  }
  function acaoPix(id) {
    return api('POST', '/api/admin/pagamentos/acao', { id: id, acao: 'pix' }).then(function (j) {
      if (!j || !j.success) { toast('⚠️ ' + ((j && j.error) || 'Não foi possível abrir a cobrança.')); return; }
      return mostrarCobranca({ pagamento: j.pagamento, pix: j.pix, reutilizada: true }, acharConta(j.pagamento.email), j.pagamento.situacao === 'vencida' ? 'vencido' : 'cobranca', {});
    });
  }
  function acaoNovaGerar() {
    var doc = root.document;
    var campo = (doc.getElementById('pgNovaCliente') || {}).value || '';
    var venc = (doc.getElementById('pgNovaVenc') || {}).value || '';
    var obs = (doc.getElementById('pgNovaObs') || {}).value || '';
    var achado = /[^\s<>()]+@[^\s<>()]+\.[^\s<>()]+/.exec(campo);
    var n = estado.nova;
    n.cliente = campo; n.venc = venc; n.obs = obs; n.erro = '';
    if (!achado) { n.erro = 'Escolha um cliente da lista (ou digite o e-mail da conta).'; repintarAba(); return Promise.resolve(); }
    n.email = achado[0].toLowerCase(); n.enviando = true; n.resultado = null;
    repintarAba();
    return gerarCobranca(n.email, { vencimento: venc, obs: obs }).then(function (j) {
      n.enviando = false;
      if (!j || !j.success) { n.erro = (j && j.error) || 'Não foi possível gerar a cobrança.'; }
      else { n.resultado = j; n.usuario = acharConta(n.email); toast(j.reutilizada ? '2ª via da cobrança aberta gerada.' : 'Cobrança Pix gerada.'); }
      repintarAba();
      return carregar(true);
    });
  }
  function acaoGerarMensal() {
    var c = (estado.dados && estado.dados.cobranca_mensal) || { dia: 5 };
    return dialogo({
      titulo: 'Gerar as cobranças do mês agora?', ok: 'Gerar cobranças',
      html: '<p>O sistema já gera sozinho a cobrança Pix de cada assinatura ativa todo dia ' + esc(c.dia) + '. Isto faz o mesmo agora, para o mês corrente.</p>' +
        '<p class="pg-nota">Quem já tem a cobrança do mês, já pagou neste ciclo ou já tem uma cobrança em aberto não recebe outra. O acesso das contas não muda: só vira pago quando você confirma o recebimento.</p>'
    }).then(function (v) {
      if (!v) return null;
      return api('POST', '/api/admin/pagamentos/gerar-mensal', {}).then(function (j) {
        toast(j && j.success ? '✅ ' + j.message : '⚠️ ' + ((j && j.error) || 'Não foi possível gerar as cobranças.'));
        if (j && j.success && j.geradas) return depoisDeMudar();
      });
    });
  }
  function baixarCsv() {
    var filtrados = estado.dados ? filtrar(estado.dados.pagamentos, estado.filtro) : [];
    if (!filtrados.length) { toast('Não há registros para exportar com este filtro.'); return Promise.resolve(); }
    return root.fetch(root.location.origin + '/api/admin/pagamentos/csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: filtrados.map(function (p) { return p.id; }) }) })
      .then(function (r) { if (!r.ok) throw new Error('csv'); return r.blob(); })
      .then(function (blob) {
        var a = root.document.createElement('a');
        a.href = root.URL.createObjectURL(blob);
        a.download = 'pagamentos-' + hojeIso() + '.csv';
        root.document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { root.URL.revokeObjectURL(a.href); }, 4000);
        toast(plural(filtrados.length, 'registro exportado', 'registros exportados') + '.');
      })
      .catch(function () { toast('⚠️ Não foi possível gerar o CSV.'); });
  }
  function copiar(texto, avisoOk) {
    var fim = function () { toast(avisoOk || 'Copiado.'); };
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) return root.navigator.clipboard.writeText(texto).then(fim).catch(function () { toast('Não consegui copiar: selecione o texto e copie.'); });
    toast('Selecione o texto e copie (Ctrl+C).');
    return Promise.resolve();
  }
  function lerArquivo(arq) {
    var c = estado.conc;
    if (!arq) return;
    c.nome = arq.name; c.erro = ''; c.resultado = null;
    if (arq.size > 2 * 1024 * 1024) { c.erro = 'O arquivo tem mais de 2 MB. Baixe um período menor do extrato.'; repintarAba(); return; }
    c.enviando = true; repintarAba();
    arq.text().then(function (texto) { return api('POST', '/api/admin/pagamentos/conciliar', { conteudo: texto }); }).then(function (j) {
      c.enviando = false;
      if (j && j.success) c.resultado = j; else c.erro = (j && j.error) || 'Não foi possível ler o extrato.';
      repintarAba();
    }).catch(function () { c.enviando = false; c.erro = 'Não foi possível ler o arquivo.'; repintarAba(); });
  }
  function confirmarSugestao(i, silencioso) {
    var r = estado.conc.resultado;
    var s = r && r.sugestoes[i];
    if (!s) return Promise.resolve(null);
    var p = achar(s.pagamento.id) || s.pagamento;
    var depois = function (j) {
      if (j && j.success) { r.sugestoes[i] = null; r.sugestoes = r.sugestoes.filter(Boolean); }
      return j;
    };
    if (silencioso) {
      return api('POST', '/api/admin/pagamentos/acao', { id: s.pagamento.id, acao: 'confirmar', valor: s.lancamento.valor, metodo: 'pix', obs: 'Conciliado com o extrato: ' + (s.lancamento.descricao || '').slice(0, 120), extrato_id: s.lancamento.hash }).then(depois);
    }
    return confirmarRegistro(p, { valor: s.lancamento.valor, extratoId: s.lancamento.hash }).then(depois);
  }
  function confirmarFortes() {
    var r = estado.conc.resultado;
    if (!r) return Promise.resolve();
    var idx = []; r.sugestoes.forEach(function (s, i) { if (s.forca === 'forte') idx.push(i); });
    if (!idx.length) return Promise.resolve();
    return dialogo({
      titulo: 'Confirmar ' + plural(idx.length, 'sugestão forte', 'sugestões fortes') + '?', ok: 'Confirmar ' + idx.length,
      html: '<p>Cada uma casa pelo <b>código da cobrança</b> ou pelo <b>valor e nome</b> do pagador no extrato. O valor confirmado é o que consta no extrato.</p>'
    }).then(function (v) {
      if (!v) return null;
      var ok = 0, falhas = 0;
      // do último para o primeiro, para os índices das sugestões restantes não mudarem durante o laço
      return idx.slice().reverse().reduce(function (cadeia, i) {
        return cadeia.then(function () { return confirmarSugestao(i, true).then(function (j) { if (j && j.success) ok++; else falhas++; }); });
      }, Promise.resolve()).then(function () {
        toast(ok + ' recebimento(s) confirmado(s)' + (falhas ? ' · ' + falhas + ' falha(s)' : '') + '.');
        return depoisDeMudar();
      });
    });
  }

  function executar(a, el) {
    var id = el.getAttribute('data-id') || '';
    var email = el.getAttribute('data-email') || '';
    switch (a) {
      case 'atualizar': return depoisDeMudar().then(function () { toast('Pagamentos atualizados.'); });
      case 'confirmar': return acaoConfirmar(id);
      case 'confirmar-lote': return acaoConfirmarLote();
      case 'limpar-sel': estado.sel = {}; repintarLista(); return;
      case 'cancelar': return acaoCancelar(id);
      case 'estornar': return acaoEstornar(id);
      case 'historico': return acaoHistorico(id);
      case 'recibo': return acaoRecibo(id);
      case 'pix': return acaoPix(id);
      case 'cobrar': return acaoCobrar(email, el.getAttribute('data-tipo') || 'cobranca', el.getAttribute('data-dias'));
      case 'receber': return acaoReceber(email);
      case 'cadastro': { var c = ctx(); if (c.abrirCadastro) c.abrirCadastro(email); return; }
      case 'abrir-os': { var c2 = ctx(); if (c2.abrirOs) c2.abrirOs(id); return; }
      case 'nova-gerar': return acaoNovaGerar();
      case 'gerar-mensal': return acaoGerarMensal();
      case 'csv': return baixarCsv();
      case 'copiar': { var alvo = root.document.getElementById(el.getAttribute('data-alvo')); return copiar(alvo ? alvo.value : '', 'Copiado.'); }
      case 'copiar-pix': return copiar(el.getAttribute('data-payload') || '', 'Código Pix copiado.');
      case 'imprimir': { var res = estado.nova.resultado; if (res) abrirDocumento(cobrancaDocumento(res, root.location.origin)); return; }
      case 'imprimir-ultima': { if (estado.ultimaCobranca) abrirDocumento(cobrancaDocumento(estado.ultimaCobranca, root.location.origin)); return; }
      case 'conc-confirmar': return confirmarSugestao(parseInt(el.getAttribute('data-i'), 10), false).then(function (j) { if (j && j.success) return depoisDeMudar().then(repintarAba); });
      case 'conc-fortes': return confirmarFortes().then(repintarAba);
    }
  }

  function ligarOuvintes() {
    if (ligado || !root.document) return;
    ligado = true;
    var d = root.document;
    d.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var aba = t.closest('[data-pg-aba]');
      if (aba) { estado.aba = aba.getAttribute('data-pg-aba'); estado.pagina = 1; repintarAba(); return; }
      var ir = t.closest('[data-pg-ir]');
      if (ir) {
        var p = ir.getAttribute('data-pg-ir').split(':');
        estado.aba = p[0];
        if (p[0] === 'cobrancas') { estado.filtro.situacao = p[1] || 'todas'; estado.filtro.busca = ''; estado.filtro.mes = 'todos'; estado.pagina = 1; }
        repintarAba();
        return;
      }
      var pg = t.closest('[data-pg-pag]');
      if (pg && !pg.disabled) { estado.pagina = parseInt(pg.getAttribute('data-pg-pag'), 10) || 1; repintarLista(); return; }
      var ac = t.closest('[data-pg-a]');
      if (ac && !ac.disabled) {
        if (ac.tagName !== 'A') ev.preventDefault();
        var r = executar(ac.getAttribute('data-pg-a'), ac);
        if (r && r.catch) r.catch(function () { toast('⚠️ Não foi possível concluir a ação.'); });
      }
    });
    d.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.matches) return;
      if (t.matches('[data-pg-filtro]')) { estado.filtro[t.getAttribute('data-pg-filtro')] = t.value; estado.pagina = 1; repintarLista(); return; }
      if (t.matches('[data-pg-sel]')) {
        var id = t.getAttribute('data-pg-sel');
        if (t.checked) estado.sel[id] = true; else delete estado.sel[id];
        repintarLista();
        var novo = d.querySelector('[data-pg-sel="' + String(id).replace(/"/g, '') + '"]');
        if (novo) novo.focus({ preventScroll: true });
        return;
      }
      if (t.matches('[data-pg-sel-pagina]')) {
        var pag = paginar(filtrar(estado.dados.pagamentos, estado.filtro), estado.pagina, estado.porPagina);
        pag.itens.filter(aberta).forEach(function (p) { if (t.checked) estado.sel[p.id] = true; else delete estado.sel[p.id]; });
        repintarLista();
        return;
      }
      if (t.matches('[data-pg-arquivo]')) { lerArquivo(t.files && t.files[0]); t.value = ''; }
    });
    d.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.matches) return;
      if (t.matches('[data-pg-busca]')) {
        clearTimeout(tempoBusca);
        tempoBusca = setTimeout(function () { estado.filtro.busca = t.value; estado.pagina = 1; repintarLista(); }, 140);
      }
    });
  }

  /* ============================================================ API pública ============================================================ */
  function html(fn) {
    if (fn) ctxFn = fn;
    ligarOuvintes();
    // Quem abre a tela por um atalho antigo (2ª via de um cliente, lista de pendentes...) cai na aba certa
    if (root.__pagamentosActiveTab) {
      var a = ABA_ANTIGA[root.__pagamentosActiveTab] || root.__pagamentosActiveTab;
      if (ABAS.some(function (x) { return x.id === a; })) {
        estado.aba = a;
        if (root.__pagamentosActiveTab === 'pendentes') { estado.filtro.situacao = 'abertas'; estado.pagina = 1; }
      }
      root.__pagamentosActiveTab = null;
    }
    if (root.__boletoPreselectedUser && root.__boletoPreselectedUser.email) {
      estado.nova.email = String(root.__boletoPreselectedUser.email).toLowerCase();
      estado.nova.cliente = '';
      estado.nova.resultado = null; estado.nova.erro = '';
      estado.aba = 'nova';
      root.__boletoPreselectedUser = null;
    }
    if (!estado.carregando && (!estado.dados || Date.now() - estado.carregadoEm > 30000)) setTimeout(function () { carregar(!!estado.dados); }, 0);
    return '<div id="pgRaiz" class="pg">' + conteudo() + '</div>';
  }
  // Para a contagem das abas do topo não esperar a tela de pagamentos ser aberta
  function precarregar(fn) {
    if (fn) ctxFn = fn;
    if (!estado.dados && !estado.carregando && root.fetch) carregar(true);
  }

  return {
    // modelo
    esc: esc, moeda: moeda, dataBR: dataBR, diaBR: diaBR, mesDe: mesDe, rotuloMes: rotuloMes, telefoneWhats: telefoneWhats, aberta: aberta,
    filtrar: filtrar, paginar: paginar, mesesDisponiveis: mesesDisponiveis, mensagemWhats: mensagemWhats, linkWhats: linkWhats,
    // telas
    resumoHTML: resumoHTML, cobrancasHTML: cobrancasHTML, acessosHTML: acessosHTML, novaHTML: novaHTML, conciliarHTML: conciliarHTML, solicitacoesHTML: solicitacoesHTML,
    cobrancaResultadoHTML: cobrancaResultadoHTML, cobrancaDocumento: cobrancaDocumento, reciboDocumento: reciboDocumento, navHTML: navHTML,
    // integração com o app
    html: html, precarregar: precarregar, carregar: carregar, contagem: contagem, estado: estado
  };
});
