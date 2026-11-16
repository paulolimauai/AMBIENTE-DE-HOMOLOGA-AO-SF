/* Nexus Financeiro: site inicial (página pública, antes do login).
   Faz: abas dos módulos, simulação do atendimento, cores/aparência (mesmas chaves do login e do app), menu do celular,
   contadores, "aparecer ao rolar" e troca dos botões quando já há sessão aberta.
   Tudo o que está escrito aqui vem do que o sistema faz hoje (atendimento.js, telas do server.js e pagamentos). */
(function () {
  'use strict';
  var D = document, R = D.documentElement, T = window.NxTema || null;
  function $(s, c) { return (c || D).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || D).querySelectorAll(s)); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var reduzir = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- ícones ---------- */
  var ICONES = {
    dash: '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
    trans: '<path d="M7 4v16M7 20l-3-3M7 20l3-3"/><path d="M17 20V4M17 4l-3 3M17 4l3 3"/>',
    cartao: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>',
    orc: '<path d="M21 12A9 9 0 1 1 12 3v9h9Z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15Z"/>',
    meta: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
    rel: '<path d="M6 3h8l5 5v13H6Z"/><path d="M14 3v5h5M9 17v-3M12.5 17v-6M16 17v-2"/>',
    rec: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    imp: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    anx: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    shield: '<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M16 7l3 3"/>',
    head: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/><path d="M20 20c0 1.1-1.8 2-4 2h-2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.7 3.1 2.4 3.5 5.2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    busca: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    pix: '<path d="M12 3 21 12l-9 9-9-9Z"/><path d="m8.5 12 3.5-3.5 3.5 3.5-3.5 3.5Z"/>',
    doc: '<path d="M6 3h8l5 5v13H6Z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
    sino: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a2 2 0 0 0 3.4 0"/>',
    cel: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18h2"/>',
    ajuste: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    paleta: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4-4-7.3-9-7.3Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>'
  };
  function ic(n) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONES[n] || '') + '</svg>'; }

  /* ---------- módulos do sistema (texto = telas reais do app) ---------- */
  function row(a, b, cls) { return '<div class="row"><span>' + a + '</span><b class="' + (cls || '') + '">' + b + '</b></div>'; }
  /* pares [receita, despesa] por mês; a legenda diz qual cor é qual */
  function bars(vs) {
    return '<div class="key"><span><i style="--c:var(--brand)"></i>Receitas</span><span><i style="--c:var(--glow-b)"></i>Despesas</span></div><div class="bars">' +
      vs.map(function (p, i) { return '<span class="g"><i style="--v:' + p[0] + '%;--i:' + i + '"></i><i style="--v:' + p[1] + '%;--i:' + i + '"></i></span>'; }).join('') + '</div>';
  }
  function barra(nome, pct, cor, rotulo) {
    return '<div><div class="mrow"><span>' + nome + '</span><b>' + rotulo + '</b></div><div class="meter"><i style="--w:' + Math.min(pct, 100) + '%;--c:' + cor + '"></i></div></div>';
  }
  var RECURSOS = [
    {
      id: 'dashboard', ic: 'dash', nome: 'Dashboard Financeiro',
      resumo: 'O centro de controle do seu dinheiro: saldo, entradas e saídas do período em uma tela só, com atalhos para o que pede ação.',
      itens: ['Saldo consolidado, receitas e despesas do período', 'Gráficos por categoria e comparativo entre entradas e saídas', 'Nota de saúde financeira e média diária de gastos dos últimos 30 dias', 'Período por mês, por ano ou o histórico completo'],
      vz: function () {
        /* o painel do topo da página já mostra saldo e gráfico: aqui entra a nota de saúde, que o texto ao lado descreve (valores coerentes com as outras abas) */
        return '<div class="vz" aria-hidden="true"><small>Saúde financeira · nota do período</small><div class="saude"><div class="nota">90<small>/100</small></div><div class="sd"><span class="pill ok">Excelente</span><small>Média diária de gastos · R$ 177,58</small></div></div>' +
          barra('Poupança', 40, 'var(--ok)', '40%') + barra('Comprometimento', 60, 'var(--ok)', '60%') + barra('Uso do cartão', 33, 'var(--ok)', '33%') + barra('Pontualidade', 75, 'var(--warn)', '75%') + '</div>';
      }
    },
    {
      id: 'transacoes', ic: 'trans', nome: 'Transações',
      resumo: 'Lance receitas e despesas em segundos e encontre qualquer movimentação depois.',
      itens: ['Descrição, valor, categoria, conta, data e tipo (receita ou despesa)', 'Busca rápida e filtros por categoria, tipo e conta', 'Edição e exclusão em um clique', 'Situação de vencido calculada sozinha, pela data'],
      vz: function () {
        return '<div class="vz" aria-hidden="true"><div class="busca">' + ic('busca') + '<span>Buscar lançamento</span></div>' +
          row('Salário · Receita', '+ R$ 6.500,00', 'pos') + row('Mercado · Alimentação', '− R$ 214,90', 'neg') + row('Internet · Moradia', '− R$ 119,90', 'neg') + row('Freela · Receita', '+ R$ 1.200,00', 'pos') + '</div>';
      }
    },
    {
      id: 'cartoes', ic: 'cartao', nome: 'Contas e Cartões',
      resumo: 'Bancos, carteiras e cartões de crédito reunidos, para você saber quanto tem e quanto ainda pode gastar.',
      itens: ['Contas bancárias, carteiras e dinheiro em espécie', 'Cartões com limite, dia de fechamento e dia de vencimento', 'Limite disponível e faturas a pagar sempre à vista'],
      vz: function () {
        return '<div class="vz" aria-hidden="true"><div class="cartao"><small>Cartão de crédito</small><b>R$ 5.350,00 disponíveis</b><div class="meter"><i style="--w:33%"></i></div>' +
          '<div class="mrow" style="color:inherit;margin-top:.6rem"><span>Limite R$ 8.000,00</span><span>Fecha dia 25 · vence dia 5</span></div></div>' + row('Fatura atual', 'R$ 2.650,00', 'neg') + '</div>';
      }
    },
    {
      id: 'orcamentos', ic: 'orc', nome: 'Planejamento Orçamentário',
      resumo: 'Defina um teto de gastos por categoria e acompanhe, em tempo real, o quanto do limite já foi usado.',
      itens: ['Limite mensal para cada categoria (alimentação, transporte, lazer...)', 'Barra de progresso com aviso a partir de 80% do limite', 'Alerta de excedido ao passar de 100%, mostrando quanto passou', 'Quanto resta disponível, sem fazer conta'],
      vz: function () {
        return '<div class="vz" aria-hidden="true">' +
          barra('Alimentação <span class="pill ok">Normal</span>', 62, 'var(--ok)', '62%') +
          barra('Lazer <span class="pill warn">Alerta</span>', 85, 'var(--warn)', '85%') +
          barra('Transporte <span class="pill bad">Excedido</span>', 104, 'var(--danger)', '104%') + '</div>';
      }
    },
    {
      id: 'metas', ic: 'meta', nome: 'Planejamento de Metas',
      resumo: 'Transforme um objetivo em número: quanto guardar e até quando.',
      itens: ['Metas como reserva de emergência, viagem ou compra de um bem', 'Valor alvo e data limite', 'Progresso em porcentagem atualizado a cada aporte'],
      vz: function () {
        return '<div class="vz" aria-hidden="true"><div class="anel"><div class="rw"><div class="r" style="--p:68"></div><b>68%</b></div><div><b style="color:var(--white)">Reserva de emergência</b><br>R$ 13.600 de R$ 20.000<br><small>Meta até dez/2027</small></div></div></div>';
      }
    },
    {
      id: 'relatorios', ic: 'rel', nome: 'Relatórios e Insights',
      resumo: 'Uma leitura clara do período: para onde o dinheiro foi e quanto sobrou.',
      itens: ['Receitas, despesas e balanço do período', 'Taxa de poupança: quanto da renda foi economizado', 'Distribuição das despesas por categoria', 'Comparativo com o histórico geral e impressão em PDF'],
      vz: function () {
        return '<div class="vz" aria-hidden="true"><div class="donut-w"><div class="donut"></div><div class="legend"><span><i style="--c:var(--brand)"></i>Moradia 38%</span><span><i style="--c:var(--glow-b)"></i>Alimentação 24%</span><span><i style="--c:var(--accent)"></i>Transporte 18%</span><span><i style="--c:var(--tint2)"></i>Outros 20%</span></div></div>' +
          row('Balanço do período', '+ R$ 3.572,60', 'pos') + row('Taxa de poupança', '40%', 'pos') + '</div>';
      }
    },
    {
      id: 'recorrentes', ic: 'rec', nome: 'Despesas Fixas',
      resumo: 'Aluguel, assinaturas e parcelamentos organizados mês a mês, sem esquecer nenhum vencimento.',
      itens: ['Contratos e mensalidades com vencimento, conta e duração (12 ou 24 meses, outro prazo ou contínuo)', 'Cronograma mês a mês de cada parcela', 'Lance a parcela do mês em um clique', 'Conclusão automática quando todas as parcelas são lançadas'],
      vz: function () {
        var p = '';
        for (var i = 1; i <= 12; i++) p += '<i class="' + (i < 8 ? 'f' : i === 8 ? 'a' : '') + '">' + i + '</i>';
        return '<div class="vz" aria-hidden="true">' + row('Financiamento · dia 10', 'R$ 890,00', 'neg') + '<small>Parcelas (12 meses)</small><div class="parc">' + p + '</div><div class="row"><span>Parcela atual</span><b style="color:var(--accent)">▶ Lançar (8/12)</b></div></div>';
      }
    },
    {
      id: 'importar', ic: 'imp', nome: 'Importar Extrato',
      resumo: 'Traga o extrato do banco para dentro do sistema e deixe de digitar lançamento por lançamento.',
      itens: ['Arquivos OFX e CSV', 'CSV com vírgula ou ponto e vírgula, como os bancos brasileiros exportam', 'Entende valores como 1.234,56 e datas como 15/11/2026', 'O extrato do mês vira lançamentos de uma só vez'],
      vz: function () {
        return '<div class="vz" aria-hidden="true"><div class="row"><span>extrato-novembro.ofx</span><b class="pos">OFX</b></div><div class="seta">' + ic('seta') + '</div>' +
          row('Padaria · 12/11/2026', '− R$ 18,50', 'neg') + row('Transferência recebida', '+ R$ 450,00', 'pos') + row('Posto de combustível', '− R$ 230,00', 'neg') + '</div>';
      }
    },
    {
      id: 'anexos', ic: 'anx', nome: 'Gestão de Documentos',
      resumo: 'Notas, recibos e faturas guardados junto do lançamento a que pertencem.',
      itens: ['Imagens (PNG, JPG e WEBP), PDF, DOCX e TXT', 'Vincule o comprovante a uma transação ou guarde como anexo avulso', 'Arraste e solte vários arquivos de uma vez'],
      vz: function () {
        return '<div class="vz" aria-hidden="true"><div class="arq"><div><b>PDF</b><span>fatura-nov.pdf</span></div><div><b>JPG</b><span>recibo-mercado.jpg</span></div><div><b>DOCX</b><span>contrato.docx</span></div></div>' + row('Vinculado a', 'Mercado · 12/11', '') + '</div>';
      }
    }
  ];

  /* ---------- Central de Serviços (categorias e etapas = atendimento.js) ---------- */
  var CATEGORIAS = [
    ['Reset de senha', 'Requisição'], ['Pagamento não reconhecido', 'Incidente'], ['Desbloqueio de usuário', 'Requisição'],
    ['Conta/Login', 'Incidente'], ['Dados Cadastrais', 'Requisição'], ['Liberação de degustação', 'Requisição'],
    ['2ª Via de fatura', 'Requisição'], ['Atendimento Técnico', 'Incidente'], ['Falhas/Bugs/Correções', 'Incidente'], ['Outros', 'Requisição']
  ];
  var ETAPAS = [
    { n: 'Novo', d: 'Você abre o chamado em poucos passos e recebe um protocolo para acompanhar o andamento.' },
    { n: 'Atendimento atribuído', d: 'Um técnico da fila responsável assume o chamado e passa a responder por ali.' },
    { n: 'Pendente', d: 'O técnico aguarda uma informação sua. Ao responder, o atendimento continua de onde parou.', opc: true },
    { n: 'Resolvido', d: 'A solução fica registrada no chamado. Se o problema voltar, você pode reabrir em até 7 dias.' },
    { n: 'Fechado', d: 'Chamado encerrado de forma definitiva.' }
  ];

  /* ---------- sessão: quem já entrou vê "Ir para o painel" ---------- */
  function logado() {
    try {
      return sessionStorage.getItem('nexus_session_active') === 'true' &&
        !!(localStorage.getItem('nexus_session') || localStorage.getItem('nexus_cached_user')) &&
        localStorage.getItem('nexus_login_v5') === 'true';
    } catch (e) { return false; }
  }
  function ajustarBotoes() {
    if (!logado()) return;
    $$('[data-cta="entrar"]').forEach(function (a) {
      a.setAttribute('href', '/');
      var t = $('.t', a); if (t) t.textContent = 'Ir para o painel';
      a.classList.remove('gho'); a.classList.add('pri');
    });
    $$('[data-cta="criar"]').forEach(function (a) { a.hidden = true; });
    $$('.final').forEach(function (s) { s.hidden = true; }); /* a chamada final só tem "Criar conta": para quem já entrou ela ficaria vazia */
  }

  /* ---------- cores e aparência (o script de tema do <head> guarda o estado; aqui ficam só os controles) ---------- */
  function montarCores(box) {
    if (!T || !box) return;
    var cor = function (h) { return 'hsl(' + h + ' 95% 58%)'; };
    T.PALETAS.forEach(function (p) {
      var b = D.createElement('button');
      b.type = 'button'; b.className = 'sw'; b.dataset.id = p.id; b.title = p.nome;
      b.setAttribute('aria-label', 'Paleta ' + p.nome); b.setAttribute('aria-pressed', 'false');
      b.style.setProperty('--c', 'linear-gradient(135deg,' + cor(p.h[0]) + ' 0 34%,' + cor(p.h[1]) + ' 34% 67%,' + cor(p.h[2]) + ' 67%)');
      b.addEventListener('click', function () { T.escolher(p.id, true); });
      box.appendChild(b);
    });
    var l = D.createElement('label');
    l.className = 'sw sw-c'; l.title = 'Cor personalizada'; l.setAttribute('aria-pressed', 'false');
    l.innerHTML = '<input type="color" value="#4f7cff" aria-label="Escolher cor personalizada">';
    $('input', l).addEventListener('input', function () { T.personalizada(this.value, true); });
    box.appendChild(l);
  }
  function montarModos(box) {
    if (!T || !box) return;
    [['auto', 'Automático'], ['escuro', 'Escuro'], ['claro', 'Claro']].forEach(function (m) {
      var b = D.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.m = m[0]; b.textContent = m[1]; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { T.setModo(m[0], true); });
      box.appendChild(b);
    });
  }
  function montarFundos(box) {
    if (!T || !box) return;
    T.FUNDOS.forEach(function (f) {
      var b = D.createElement('button');
      b.type = 'button'; b.className = 'chip'; b.dataset.f = f[0]; b.textContent = f[1]; b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { T.setFundo(f[0], true); });
      box.appendChild(b);
    });
  }
  function sincronizarControles() {
    if (!T) return;
    var cor = T.corAtual(), modo = T.modo(), fundo = T.fundo();
    $$('.chip[data-f]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.f === fundo)); });
    $$('.sw[data-id]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.id === cor.id)); });
    $$('.sw-c').forEach(function (l) {
      l.setAttribute('aria-pressed', String(cor.id === 'custom'));
      if (cor.id === 'custom' && cor.hex) { var i = $('input', l); if (i) i.value = cor.hex; }
    });
    $$('.chip[data-m]').forEach(function (c) { c.setAttribute('aria-pressed', String(c.dataset.m === modo)); });
  }
  function iniciarPersonalizar() {
    $$('[data-cores]').forEach(montarCores);
    $$('[data-modos]').forEach(montarModos);
    $$('[data-fundos]').forEach(montarFundos);
    if (T) { T.onChange = sincronizarControles; sincronizarControles(); }
    var btn = $('#cfg-btn'), pop = $('#cfg-pop');
    if (!btn || !pop) return;
    function abrir(v) { pop.hidden = !v; btn.setAttribute('aria-expanded', String(v)); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); abrir(pop.hidden); });
    pop.addEventListener('click', function (e) { e.stopPropagation(); });
    D.addEventListener('click', function () { abrir(false); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { abrir(false); btn.focus(); } });
    var reset = $('#cfg-reset');
    if (reset && T) reset.addEventListener('click', function () { T.escolher(T.PADRAO, true); T.setModo('auto', true); T.setFundo('padrao', true); });
  }

  /* ---------- topo, menu do celular e seção ativa ---------- */
  function iniciarTopo() {
    var topo = $('#topo'), gaveta = $('#gaveta'), burger = $('#burger');
    function marcar() { topo.classList.toggle('on', (window.scrollY || R.scrollTop) > 8); }
    window.addEventListener('scroll', marcar, { passive: true }); marcar();
    function menu(v) {
      gaveta.hidden = !v; burger.setAttribute('aria-expanded', String(v));
      burger.setAttribute('aria-label', v ? 'Fechar menu' : 'Abrir menu');
      burger.innerHTML = ic(v ? 'x' : 'menu');
      D.body.classList.toggle('menu-aberto', v);
      if (v) { var primeiro = $('a', gaveta); if (primeiro) primeiro.focus(); }
    }
    burger.innerHTML = ic('menu');
    burger.addEventListener('click', function () { menu(gaveta.hidden); });
    $$('a', gaveta).forEach(function (a) { a.addEventListener('click', function () { menu(false); }); });
    D.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !gaveta.hidden) { menu(false); burger.focus(); } });
    window.addEventListener('resize', function () { if (window.innerWidth >= 1280 && !gaveta.hidden) menu(false); });

    var links = $$('.nav a'), alvos = links.map(function (a) { return $(a.getAttribute('href')); });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return;
          links.forEach(function (a, i) {
            var on = alvos[i] === e.target;
            a.classList.toggle('on', on);
            if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
          });
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      alvos.forEach(function (s) { if (s) io.observe(s); });
    }
  }

  /* ---------- números que sobem e "aparecer ao rolar" ---------- */
  function contar(el) {
    var alvo = parseFloat(el.dataset.count), pre = el.dataset.pre || '', suf = el.dataset.suf || '';
    function texto(v) { return pre + Math.round(v).toLocaleString('pt-BR') + suf; }
    if (reduzir || !isFinite(alvo)) { el.textContent = texto(alvo); return; }
    var ini = null;
    function passo(t) {
      if (ini === null) ini = t;
      var p = Math.min(1, (t - ini) / 1100), e = 1 - Math.pow(1 - p, 3);
      el.textContent = texto(alvo * e);
      if (p < 1) requestAnimationFrame(passo);
    }
    requestAnimationFrame(passo);
  }
  function iniciarMovimento() {
    var cont = $$('[data-count]');
    if (!('IntersectionObserver' in window)) { cont.forEach(contar); $$('.rv').forEach(function (e) { e.classList.add('in'); }); return; }
    cont.forEach(function (el) { if (!reduzir) el.textContent = (el.dataset.pre || '') + '0' + (el.dataset.suf || ''); });
    var ioN = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { contar(e.target); ioN.unobserve(e.target); } });
    }, { threshold: .4 });
    cont.forEach(function (el) { ioN.observe(el); });
    var ioR = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); ioR.unobserve(e.target); } });
    }, { threshold: .12, rootMargin: '0px 0px -6% 0px' });
    $$('.rv').forEach(function (el) { ioR.observe(el); });
    var mock = $('.mock');
    if (mock) setTimeout(function () { mock.classList.add('go'); }, 250);
  }

  /* ---------- módulos (abas) ---------- */
  function iniciarRecursos() {
    var tabs = $('#tabs'), painel = $('#painel');
    if (!tabs || !painel) return;
    var atual = 0;
    tabs.innerHTML = RECURSOS.map(function (r, i) {
      return '<button class="tab" role="tab" type="button" id="tab-' + r.id + '" aria-controls="painel" aria-selected="false" tabindex="-1" data-i="' + i + '">' + ic(r.ic) + '<span>' + esc(r.nome) + '</span></button>';
    }).join('');
    var botoes = $$('.tab', tabs);
    function desenhar(i, animar) {
      var r = RECURSOS[i];
      painel.innerHTML = '<div class="painel-in' + (animar ? ' troca' : '') + '"><div><span class="ico">' + ic(r.ic) + '</span><h3>' + esc(r.nome) + '</h3><p>' + esc(r.resumo) + '</p>' +
        '<ul class="tick">' + r.itens.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' + r.vz() + '</div>';
    }
    function mostrar(i, foco, animar) {
      atual = i;
      var r = RECURSOS[i];
      botoes.forEach(function (b, k) { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
      painel.setAttribute('aria-labelledby', 'tab-' + r.id);
      desenhar(i, animar);
      if (foco) botoes[i].focus();
      var ativo = botoes[i];
      if (tabs.scrollWidth > tabs.clientWidth && ativo.scrollIntoView) {
        var x = ativo.offsetLeft - (tabs.clientWidth - ativo.offsetWidth) / 2;
        tabs.scrollTo ? tabs.scrollTo({ left: x, behavior: reduzir ? 'auto' : 'smooth' }) : (tabs.scrollLeft = x);
      }
    }
    botoes.forEach(function (b, i) {
      b.addEventListener('click', function () { mostrar(i, false, true); });
      b.addEventListener('keydown', function (e) {
        var n = botoes.length, k = -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') k = (atual + 1) % n;
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') k = (atual - 1 + n) % n;
        else if (e.key === 'Home') k = 0;
        else if (e.key === 'End') k = n - 1;
        if (k < 0) return;
        e.preventDefault(); mostrar(k, true, true);
      });
    });
    mostrar(0, false, false);
    function igualar() {
      painel.style.minHeight = '';
      var maior = 0;
      for (var k = 0; k < RECURSOS.length; k++) { desenhar(k, false); maior = Math.max(maior, painel.offsetHeight); }
      desenhar(atual, false);
      painel.style.minHeight = maior + 'px';
    }
    igualar();
    if (D.fonts && D.fonts.ready) D.fonts.ready.then(igualar);
    var espera = null;
    window.addEventListener('resize', function () { clearTimeout(espera); espera = setTimeout(igualar, 150); });
  }

  /* ---------- Central de Serviços: categoria, tipo e etapas do chamado ---------- */
  function iniciarAtendimento() {
    var cats = $('#cats'), ficha = $('#ficha'), linha = $('#linha'), desc = $('#etdesc');
    if (!cats || !linha) return;
    var cat = 0, etapa = 0, manual = false, timer = null;
    cats.innerHTML = CATEGORIAS.map(function (c, i) { return '<button type="button" class="cat" data-i="' + i + '" aria-pressed="false">' + esc(c[0]) + '</button>'; }).join('');
    linha.innerHTML = ETAPAS.map(function (e, i) {
      return '<button type="button" class="et' + (e.opc ? ' opc' : '') + '" data-i="' + i + '"><i>' + (i + 1) + '</i><span>' + esc(e.n) + (e.opc ? '<br><small>(se precisar)</small>' : '') + '</span></button>';
    }).join('');
    function pintarCat() {
      $$('.cat', cats).forEach(function (b, i) { b.setAttribute('aria-pressed', String(i === cat)); });
      ficha.innerHTML = '<div><small>Categoria</small><b>' + esc(CATEGORIAS[cat][0]) + '</b></div><div><small>Tipo sugerido</small><b>' + CATEGORIAS[cat][1] + '</b></div><div><small>Prazo de atendimento</small><b>5 dias úteis</b></div>';
    }
    function pintarEtapa() {
      $$('.et', linha).forEach(function (b, i) { b.classList.toggle('ok', i < etapa); b.classList.toggle('now', i === etapa); b.setAttribute('aria-current', i === etapa ? 'step' : 'false'); });
      desc.innerHTML = '<b>' + esc(ETAPAS[etapa].n) + '</b>' + esc(ETAPAS[etapa].d);
    }
    $$('.cat', cats).forEach(function (b, i) { b.addEventListener('click', function () { cat = i; pintarCat(); }); });
    $$('.et', linha).forEach(function (b, i) { b.addEventListener('click', function () { manual = true; etapa = i; pintarEtapa(); }); });
    pintarCat(); pintarEtapa();
    if (reduzir || !('IntersectionObserver' in window)) return;
    var vis = false;
    function ciclo() {
      clearInterval(timer);
      timer = setInterval(function () {
        if (manual || !vis) return;
        etapa = (etapa + 1) % ETAPAS.length; pintarEtapa();
      }, 2600);
    }
    new IntersectionObserver(function (es) { vis = es[0].isIntersecting; }, { threshold: .4 }).observe(linha);
    ciclo();
  }

  /* ---------- início ---------- */
  function iniciar() {
    var ano = $('#ano'); if (ano) ano.textContent = '© ' + new Date().getFullYear() + ' Nexus Financeiro. Todos os direitos reservados.';
    ajustarBotoes();
    iniciarPersonalizar();
    iniciarTopo();
    iniciarRecursos();
    iniciarAtendimento();
    iniciarMovimento();
  }
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
