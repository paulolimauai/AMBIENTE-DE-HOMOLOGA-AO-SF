/* Visitas ao site — painel do administrador (/admin-assinaturas-glpi), aba "Visitas".
   Carregado depois do script principal do painel: acrescenta a aba ao menu (MODS), o ícone (IC), o título (T) e a tela (V.vis),
   e embrulha window.rend para buscar os dados toda vez que a aba é aberta.

   Dados: GET /api/admin/visitas?dias=N (só administrador). O IP chega JÁ MASCARADO do servidor (189.45.xxx.xxx); o completo
   existe apenas nos arquivos da pasta visitas/. A localização (país, estado, cidade) é estimada pelo IP e vem da Cloudflare.
   As peças de tela são funções puras (texto → HTML) e ficam testadas em admin-visitas.test.js. */
(function (raiz, fabrica) {
  'use strict';
  var A = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = A;   // testes (node --test)
  if (raiz && raiz.document) A.montar(raiz);
})(typeof window !== 'undefined' ? window : null, function () {
  // 'tudo' = todo o histórico guardado (o servidor nunca apaga nada)
  var PERIODOS = [{ dias: 7, rotulo: 'Últimos 7 dias' }, { dias: 30, rotulo: 'Últimos 30 dias' }, { dias: 90, rotulo: 'Últimos 90 dias' }, { dias: 365, rotulo: 'Último ano' }, { dias: 'tudo', rotulo: 'Todo o histórico' }];
  var DIAS_POR_MES = 120;   // acima disso o gráfico passa a uma coluna por mês (365 colunas diárias ficam ilegíveis)
  var PADRAO = 7;
  var ALTURA_BARRA = 132;   // px da barra do dia mais movimentado
  var ICONE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';

  var CSS = [
    '.vr h3,.vg h3{font-size:calc(var(--fs)*1.14);margin:0 0 12px}',
    '.vr-lista{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px}',
    '.vr-l{display:flex;align-items:baseline;gap:8px}',
    '.vr-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.vr-l b{font-variant-numeric:tabular-nums}',
    '.vr-l small{color:var(--m);min-width:3.4em;text-align:right;font-size:var(--fs);font-variant-numeric:tabular-nums}',
    '.vr-b{height:6px;border-radius:99px;background:var(--surf2);margin-top:5px;overflow:hidden}',
    '.vr-b i{display:block;height:100%;border-radius:99px;background:var(--a)}',
    '.vg-top{display:flex;align-items:baseline;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin-bottom:6px}',
    '.vg-top h3{margin:0}',
    '.vd{display:flex;align-items:flex-end;gap:3px;height:' + (ALTURA_BARRA + 24) + 'px}',
    '.vd-c{flex:1 1 0;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:4px}',
    '.vd-c i{display:block;width:100%;max-width:46px;border-radius:5px 5px 2px 2px;background:var(--a)}',
    '.vd-c i.z{background:var(--b2)}',
    '.vd-v{font-size:var(--fs);color:var(--m);font-variant-numeric:tabular-nums;line-height:1;min-height:1em}',
    '.vd-eixo{display:flex;justify-content:space-between;color:var(--m);font-size:var(--fs);margin-top:8px}',
    // 3 quadros por linha quando cabe (6 quadros = 2 linhas cheias); menos colunas só se a largura não deixar
    '.vgrid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(max(300px,calc((100% - 32px)/3)),1fr))}',
    '.vt-h{display:flex;align-items:baseline;justify-content:space-between;gap:6px 16px;flex-wrap:wrap;padding:16px 18px 10px}',
    '.vt-h h3{font-size:calc(var(--fs)*1.14);margin:0}',
    '.vmais{display:flex;justify-content:center;padding:12px;border-top:1px solid var(--b)}',
    '.vip{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:var(--fs)}',
    '.vnd{color:var(--m)}',
    '.vsub{display:block;color:var(--m);font-size:var(--fs);margin-top:2px}'
  ].join('');

  /* ---------- peças puras ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function inteiro(n) { return Number(n || 0).toLocaleString('pt-BR'); }
  function plural(n, um, varios) { return Number(n) === 1 ? um : varios; }
  function rotuloDia(dia) { var m = String(dia || '').match(/^\d{4}-(\d{2})-(\d{2})$/); return m ? m[2] + '/' + m[1] : ''; }
  function porcento(parte, total) {
    if (!total || !parte) return '0%';
    var p = Math.round(parte * 100 / total);
    return p < 1 ? '<1%' : p + '%';
  }

  var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function rotuloMes(mes) { var m = String(mes || '').match(/^(\d{4})-(\d{2})$/); return m && MESES[Number(m[2]) - 1] ? MESES[Number(m[2]) - 1] + '/' + m[1].slice(2) : ''; }
  function dataBR(iso) { var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function tamanho(b) {
    b = Number(b) || 0;
    if (b < 1024) return b + ' bytes';
    if (b < 1048576) return Math.round(b / 1024) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1).replace('.', ',') + ' MB';
    return (b / 1073741824).toFixed(2).replace('.', ',') + ' GB';
  }
  // Soma os dias de cada mês (mesma pessoa em dois dias contaria duas vezes: por isso o mês não mostra "visitantes")
  function agruparPorMes(lista) {
    var meses = [], idx = {};
    (lista || []).forEach(function (x) {
      var m = String(x.dia).slice(0, 7);
      if (!(m in idx)) { idx[m] = meses.length; meses.push({ dia: m, mes: true, visitas: 0 }); }
      meses[idx[m]].visitas += x.visitas || 0;
    });
    return meses;
  }
  function textoHistorico(h) {
    if (!h || !h.arquivos) return 'Nada é apagado: o histórico fica guardado sem prazo.';
    return 'Nada é apagado: o histórico fica guardado sem prazo. Há registros desde ' + dataBR(h.desde) + ' (' + inteiro(h.arquivos) + ' ' + plural(h.arquivos, 'dia', 'dias') + ' com acessos, ocupando ' + tamanho(h.bytes) + ' no disco do servidor).';
  }

  // Lista com barras: nome, quantidade, % do total de visitas. Mostra no máximo 8 itens.
  function ranking(titulo, lista, total, vazio) {
    var itens = (lista || []).slice(0, 8);
    var max = itens.reduce(function (m, x) { return Math.max(m, x.visitas || 0); }, 0) || 1;
    var corpo = itens.length
      ? '<ol class="vr-lista">' + itens.map(function (x) {
        var larg = Math.max(3, Math.round((x.visitas || 0) * 100 / max));
        return '<li><div class="vr-l"><span class="vr-n" title="' + esc(x.nome) + '">' + esc(x.nome) + '</span><b>' + inteiro(x.visitas) + '</b><small>' + porcento(x.visitas, total) + '</small></div>'
          + '<div class="vr-b" aria-hidden="true"><i style="width:' + larg + '%"></i></div></li>';
      }).join('') + '</ol>'
      : '<p class="sub">' + esc(vazio || 'Sem dados neste período.') + '</p>';
    return '<div class="glass pad vr"><h3>' + esc(titulo) + '</h3>' + corpo + '</div>';
  }

  // Uma coluna por dia (ou por mês, quando o período passa de 120 dias). Com até 14 colunas o número aparece sobre a barra;
  // com mais, só no tooltip e no texto de apoio.
  function graficoDias(porDia) {
    var dias = porDia || [];
    if (!dias.length) return { html: '', pico: '', porMes: false };
    var porMes = dias.length > DIAS_POR_MES;
    var lista = porMes ? agruparPorMes(dias) : dias;
    var rotulo = function (x) { return x.mes ? rotuloMes(x.dia) : rotuloDia(x.dia); };
    var max = lista.reduce(function (m, x) { return Math.max(m, x.visitas || 0); }, 0);
    var total = lista.reduce(function (s, x) { return s + (x.visitas || 0); }, 0);
    var mostrar = lista.length <= 14;
    var pico = lista.reduce(function (p, x) { return (x.visitas || 0) > (p.visitas || 0) ? x : p; }, lista[0]);
    var colunas = lista.map(function (x) {
      var n = x.visitas || 0;
      var px = n ? Math.max(4, Math.round(n * ALTURA_BARRA / max)) : 2;
      var dica = rotulo(x) + ': ' + inteiro(n) + ' ' + plural(n, 'visita', 'visitas') + (x.mes ? '' : ' · ' + inteiro(x.visitantes) + ' ' + plural(x.visitantes, 'visitante', 'visitantes'));
      return '<div class="vd-c" title="' + esc(dica) + '"><span class="vd-v">' + (mostrar && n ? inteiro(n) : '') + '</span><i' + (n ? '' : ' class="z"') + ' style="height:' + px + 'px"></i></div>';
    }).join('');
    var meio = lista[Math.floor((lista.length - 1) / 2)];
    var eixo = '<span>' + rotulo(lista[0]) + '</span>' + (lista.length > 2 ? '<span>' + rotulo(meio) + '</span>' : '') + (lista.length > 1 ? '<span>' + rotulo(lista[lista.length - 1]) + '</span>' : '');
    var resumo = (porMes ? 'Visitas por mês, de ' : 'Visitas por dia, de ') + rotulo(lista[0]) + ' a ' + rotulo(lista[lista.length - 1]) + '. Total: ' + inteiro(total) + (max ? (porMes ? '. Maior mês: ' : '. Maior dia: ') + rotulo(pico) + ', com ' + inteiro(max) : '') + '.';
    return { html: '<div class="vd" role="img" aria-label="' + esc(resumo) + '">' + colunas + '</div><div class="vd-eixo" aria-hidden="true">' + eixo + '</div>', pico: max ? rotulo(pico) + ' · ' + inteiro(max) + ' ' + plural(max, 'visita', 'visitas') : '', porMes: porMes };
  }

  function linhasRecentes(lista) {
    return (lista || []).map(function (r) {
      var sistema = (r.tipo || 'Computador') + ' · ' + (r.so && r.so !== 'Outro' ? r.so : 'Outro sistema');
      var semLocal = !r.local || r.local === 'Não informado';
      return '<tr><td data-l="Quando">' + esc(rotuloDia(r.dia) + ' ' + String(r.hora || '').slice(0, 5)) + '</td>'
        + '<td data-l="Local"><span' + (semLocal ? ' class="vnd"' : '') + '>' + esc(r.local || 'Não informado') + '</span></td>'
        + '<td data-l="IP (mascarado)"><code class="vip">' + esc(r.ip) + '</code></td>'
        + '<td data-l="Página">' + esc(r.pagina) + '</td>'
        + '<td data-l="Origem">' + esc(r.origem) + '</td>'
        + '<td data-l="Aparelho e sistema"><span>' + esc(sistema) + '</span><small class="vsub">' + esc(r.navegador) + '</small></td></tr>';
    }).join('');
  }

  // O que falta ligar para a localização aparecer (a pessoa que administra precisa saber o passo exato)
  function avisoLocal(d) {
    if (!d || !d.visitas) return '';
    var temPais = (d.paises || []).some(function (p) { return p.nome !== 'Não informado'; });
    var temCidade = (d.cidades || []).length > 0;
    if (!temPais) return 'A localização vem da Cloudflare, que fica na frente do site publicado. Ainda não chegou nenhuma: se este é o site no ar, ligue <b>Network → IP Geolocation</b> na Cloudflare. Acessos feitos nesta máquina (localhost) nunca têm localização.';
    if (!temCidade) return 'Só o <b>país</b> está chegando. Para ver também estado e cidade, ligue na Cloudflare: <b>Rules → Managed Transforms → “Add visitor location headers”</b>.';
    return '';
  }

  function nota(ui, html) { return '<div class="note">' + ui.I('info') + '<span>' + html + '</span></div>'; }

  var LINHAS_INICIAIS = 15;

  // ui = { head, kpi, I } do próprio painel (injetado para a função poder ser testada sem o painel)
  // todas = true mostra todos os acessos recentes que o servidor mandou (até 50); senão só os 15 mais novos
  function tela(d, ui, dias, todas) {
    var ult = d.porDia && d.porDia.length ? d.porDia[d.porDia.length - 1] : { visitas: 0, visitantes: 0 };
    var topo = ui.head('vis', 'Visitas', 'Quem abriu o site, de onde veio e em qual aparelho. O IP aparece mascarado; o completo fica só nos arquivos do servidor.',
      '<button type="button" class="btn p" onclick="visRecarregar()">' + ui.I('undo') + ' Atualizar visitas</button>');
    var abas = '<div class="tabs" role="tablist" aria-label="Período">' + PERIODOS.map(function (p) {
      return '<button type="button" class="tab" role="tab" aria-selected="' + (p.dias === dias) + '" onclick="visDias(' + (typeof p.dias === 'string' ? "'" + p.dias + "'" : p.dias) + ')">' + p.rotulo + '</button>';
    }).join('') + '</div>';
    var kpis = '<div class="grid g4">'
      + ui.kpi('vis', 'Visitas', inteiro(d.visitas), 'Abertas por pessoas')
      + ui.kpi('subs', 'Visitantes', inteiro(d.visitantes), 'IP + navegador', 'e')
      + ui.kpi('clock', 'Hoje', inteiro(ult.visitas), inteiro(ult.visitantes) + ' ' + plural(ult.visitantes, 'visitante', 'visitantes'))
      + ui.kpi('info', 'Robôs', inteiro(d.robos), 'Fora das contagens')
      + '</div>';
    var aviso = avisoLocal(d);
    var meio;
    if (!d.visitas) {
      meio = '<div class="glass big"><div class="ei">' + ui.I('info') + '</div><h3>Nenhuma visita neste período</h3><p>'
        + (d.robos ? inteiro(d.robos) + ' ' + plural(d.robos, 'acesso de robô foi ignorado', 'acessos de robôs foram ignorados') + '. ' : '')
        + 'Quando alguém abrir o site, o acesso aparece aqui.</p></div>';
    } else {
      var g = graficoDias(d.porDia);
      var todos = d.recentes || [];
      var mostrados = todas ? todos : todos.slice(0, LINHAS_INICIAIS);
      meio = '<div class="glass pad vg"><div class="vg-top"><h3>' + (g.porMes ? 'Visitas por mês' : 'Visitas por dia') + '</h3>' + (g.pico ? '<span class="sub" style="margin:0">' + (g.porMes ? 'Maior mês: ' : 'Maior dia: ') + esc(g.pico) + '</span>' : '') + '</div>' + g.html + '</div>'
        + '<div class="vgrid">'
        + ranking('Países', d.paises, d.visitas, 'Ainda sem localização.')
        + ranking('Cidades', d.cidades, d.visitas, 'Nenhuma cidade identificada.')
        + ranking('Páginas', d.paginas, d.visitas)
        + ranking('De onde chegaram', d.origens, d.visitas)
        + ranking('Aparelho e sistema', d.sistemas || d.dispositivos, d.visitas)
        + ranking('Navegadores', d.navegadores, d.visitas)
        + '</div>'
        + '<div class="glass tbl"><div class="vt-h"><h3>Acessos recentes</h3><span class="sub" style="margin:0">' + (mostrados.length === todos.length ? 'Os ' + inteiro(todos.length) + ' mais novos' : 'Os ' + inteiro(mostrados.length) + ' mais novos, de ' + inteiro(todos.length)) + '</span></div>'
        + '<div class="scroll"><table><thead><tr><th>Quando</th><th>Local</th><th>IP (mascarado)</th><th>Página</th><th>Origem</th><th>Aparelho e sistema</th></tr></thead><tbody>'
        + linhasRecentes(mostrados) + '</tbody></table></div>'
        + (todos.length > LINHAS_INICIAIS ? '<div class="vmais"><button type="button" class="btn sm" onclick="visTodos()">' + (todas ? 'Mostrar só os ' + LINHAS_INICIAIS + ' mais novos' : 'Mostrar todos os ' + inteiro(todos.length) + ' acessos') + '</button></div>' : '')
        + '</div>';
    }
    var rodape = nota(ui, esc(textoHistorico(d.historico)) + ' “Visitante” é a soma de IP e navegador: a mesma pessoa em dois aparelhos conta duas vezes. A localização é uma estimativa pelo IP: indica a região do provedor, não o endereço da pessoa.');
    return '<section>' + topo + abas + kpis + (aviso ? nota(ui, aviso) : '') + meio + rodape + '</section>';
  }

  function telaErro(msg, ui) {
    return '<section><div class="glass big"><div class="ei">' + ui.I('alert') + '</div><h3 style="font-size:calc(var(--fs)*1.286)">Não foi possível carregar as visitas</h3><p>' + esc(msg) + '</p>'
      + '<button type="button" class="btn p" onclick="visRecarregar()">' + ui.I('undo') + ' Tentar de novo</button></div></section>';
  }

  /* ---------- encaixe no painel ---------- */
  function montar(w) {
    var d = w.document;
    var VIS = { dias: PADRAO, estado: 'novo', dados: null, erro: '', aba: '', todas: false };

    var estilo = d.createElement('style');
    estilo.textContent = CSS;
    d.head.appendChild(estilo);

    // Peças do painel (consts do script principal: acessíveis pelo nome; entram só na hora de usar)
    function ui() { return { head: head, kpi: kpi, I: I }; }
    function painelPronto() { try { return typeof MODS === 'object' && typeof IC === 'object' && typeof V === 'object' && typeof T === 'object' && typeof head === 'function' && typeof kpi === 'function' && typeof I === 'function' && typeof skel === 'function'; } catch (e) { return false; } }
    if (!painelPronto()) return;

    IC.vis = ICONE;
    T.vis = 'Visitas';
    if (!MODS.some(function (m) { return m[0] === 'vis'; })) MODS.push(['vis', 'Visitas']);
    V.vis = function () {
      if (VIS.estado === 'ok' && VIS.dados) return tela(VIS.dados, ui(), VIS.dias, VIS.todas);
      if (VIS.estado === 'erro') return telaErro(VIS.erro, ui());
      return skel();
    };

    function abaAtual() { return String(w.location.hash || '').slice(1); }
    function token() { return w.NexusSSO && w.NexusSSO.token ? w.NexusSSO.token() : ''; }

    function carregar() {
      var dias = VIS.dias;
      VIS.estado = 'carregando';
      w.fetch('/api/admin/visitas?dias=' + encodeURIComponent(dias), { headers: { 'Authorization': 'Bearer ' + token() } })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (r.status === 401 && w.NexusSSO) w.NexusSSO.verificar().then(function (v) { if (v.estado === 'sem-sessao') w.NexusSSO.irParaLogin(); });
            if (!r.ok || j.success === false) throw new Error(j.error || ('Erro ' + r.status));
            return j;
          });
        })
        .then(function (j) { if (dias === VIS.dias) { VIS.dados = j; VIS.estado = 'ok'; } })
        .catch(function (e) { if (dias === VIS.dias) { VIS.estado = 'erro'; VIS.erro = (e && e.message) || 'O servidor não respondeu.'; } })
        .then(function () { if (abaAtual() === 'vis') w.rend(); });
    }

    // Toda vez que a aba é aberta os dados são buscados de novo; com ela já aberta, rend() só redesenha o que já veio
    var rendOriginal = w.rend;
    w.rend = function () {
      var m = abaAtual();
      if (m === 'vis' && VIS.aba !== 'vis') { VIS.estado = 'novo'; VIS.todas = false; }
      VIS.aba = m;
      var r = rendOriginal.apply(this, arguments);
      var real = false; try { real = Boolean(S && S.real); } catch (e) {}
      if (m === 'vis' && VIS.estado === 'novo' && real) carregar();
      return r;
    };

    w.visDias = function (dias) { VIS.dias = dias; VIS.estado = 'novo'; VIS.todas = false; w.rend(); };
    w.visRecarregar = function () { VIS.estado = 'novo'; VIS.todas = false; w.rend(); };
    w.visTodos = function () { VIS.todas = !VIS.todas; w.rend(); };   // só redesenha: os 50 já vieram do servidor
  }

  return { PERIODOS: PERIODOS, esc: esc, inteiro: inteiro, rotuloDia: rotuloDia, rotuloMes: rotuloMes, dataBR: dataBR, tamanho: tamanho, agruparPorMes: agruparPorMes, textoHistorico: textoHistorico, porcento: porcento, ranking: ranking, graficoDias: graficoDias, linhasRecentes: linhasRecentes, avisoLocal: avisoLocal, tela: tela, telaErro: telaErro, montar: montar };
});
