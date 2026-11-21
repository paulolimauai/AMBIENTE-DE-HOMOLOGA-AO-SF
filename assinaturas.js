/* Nexus - Administração: aba "Assinaturas" (perfil Administrador).
   Mesmo padrão de administracao.js e pagamentos-admin.js: este arquivo tem o MODELO puro (testado em assinaturas.test.js), o HTML e os
   eventos; o server.js só liga as ações do app pelo contexto (ctx). Aqui ficam, num lugar só, as ações que antes estavam escondidas na
   janela de edição do cadastro: liberar o plano mensal, dar tempo de cortesia (1 h, 24 h, 7 d, 30 d, 1 ano, personalizado, vitalício),
   bloquear, reiniciar o teste e abrir a 2ª via, além de ver quem vence nos próximos dias e agir em várias contas de uma vez.

   ctx = função que devolve { agora, usuarios, eu:{email,nome}, preco:{numero,rotulo}, sincronizadoEm, eventos(email):[...], toast(msg),
         acoes:{ conceder(email,min), vitalicio(email), mensal(email,metodo), mensalVarios(emails,metodo), bloquear(email), reiniciarTeste(email), segundaVia(r),
                 abrirCadastro(email), sincronizar(), concederVarios(emails,min), expirarVarios(emails) } }

   A situação segue as regras do servidor (getUserSubscriptionInfo) pelo classificarAssinatura() do administracao.js, que precisa
   estar carregado antes deste arquivo. Administrador tem acesso ilimitado e por isso não aparece na lista. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.NexusAss = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var Adm = root.NexusAdm || (typeof require === 'function' ? require('./administracao.js') : null);
  if (!Adm) throw new Error('assinaturas.js precisa do administracao.js carregado antes.');

  var DIA = 86400000, HORA = 3600000;
  var esc = Adm.esc, semAcento = Adm.semAcento, dataBR = Adm.dataBR, iniciais = Adm.iniciais;

  /* ============================================================ utilitários ============================================================ */
  function paraMs(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    var t = Date.parse(s);
    if (isNaN(t) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) t = Date.parse(s.replace(' ', 'T') + (s.length <= 19 ? '-03:00' : ''));
    return t;
  }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }
  function moeda(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function hora(ms) { return new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }); }

  /* ============================================================ modelo ============================================================ */
  // Situação "de negócio" de uma conta (o classificarAssinatura separa por regra de acesso; aqui separamos também quem paga de quem ganhou cortesia)
  var SIT = {
    paga: { rotulo: 'Assinante', pill: 'adm-p-ok', dica: 'Assinatura mensal paga e ativa' },
    cortesia: { rotulo: 'Cortesia', pill: 'adm-p-ouro', dica: 'Tempo liberado pelo administrador, sem pagamento' },
    vitalicia: { rotulo: 'Vitalício', pill: 'adm-p-ok', dica: 'Acesso sem vencimento' },
    teste: { rotulo: 'Em teste', pill: 'adm-p-aviso', dica: 'Dia grátis de teste' },
    pendente: { rotulo: 'Aguardando pagamento', pill: 'adm-p-info', dica: 'A pessoa informou o pagamento e ele ainda não foi conferido' },
    encerrada: { rotulo: 'Acesso encerrado', pill: 'adm-p-ruim', dica: 'Teste ou plano vencido: só volta a entrar depois de pagar' }
  };
  var PRIORIDADE = { pendente: 0, vencendo: 1, encerrada: 2, teste: 3, paga: 4, cortesia: 5, vitalicia: 6 };
  var METODOS = { pix: 'Pix', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito', boleto: 'Boleto bancário', admin_cortesia: 'Cortesia do administrador' };
  var DIAS_VENCENDO = 7;

  function situacaoDe(r) {
    if (r.admin) return 'admin';
    var c = r.ass.chave;
    if (c === 'vitalicio') return 'vitalicia';
    if (c === 'ativo') return (String(r.plano).toLowerCase() === 'cortesia_admin' || r.metodo === 'admin_cortesia') ? 'cortesia' : 'paga';
    if (c === 'pendente') return 'pendente';
    if (c === 'teste') return 'teste';
    return 'encerrada'; // expirado ou teste encerrado
  }

  // Registro de uma conta: o do administracao.js + situação, vencimento e rótulos desta aba
  function registro(u, agora) {
    agora = agora || Date.now();
    var r = Adm.normalizarUsuario(u, null, agora);
    r.sit = situacaoDe(r);
    var ini = paraMs(u.trial_started_at);
    r.testeInicio = isNaN(ini) ? NaN : ini;
    // Vencimento: o da assinatura (ativa ou já vencida) ou, sem ela, o fim do dia grátis
    var venc = r.ass.expira;
    if (!venc && !isNaN(ini) && (r.ass.chave === 'teste' || r.ass.chave === 'teste_fim')) venc = ini + DIA;
    r.venc = venc || null;
    r.metodoRotulo = METODOS[r.metodo] || (r.metodo ? r.metodo : '');
    return r;
  }

  function vencendo(r, agora, dias) {
    if (r.sit !== 'paga' && r.sit !== 'cortesia') return false;
    return !!r.venc && r.venc > agora && r.venc - agora <= (dias || DIAS_VENCENDO) * DIA;
  }
  // Vence nas próximas 24 h (subconjunto de "vencendo": urgência máxima, usada no filtro "Vencem hoje")
  function venceHoje(r, agora) {
    agora = agora || Date.now();
    return vencendo(r, agora) && r.venc - agora <= DIA;
  }

  function relFuturo(ms) {
    if (ms < HORA) return 'em menos de 1 h';
    if (ms < DIA) return 'em ' + Math.ceil(ms / HORA) + ' h';
    return 'em ' + plural(Math.ceil(ms / DIA), 'dia', 'dias');
  }
  function relPassado(ms) {
    if (ms < HORA) return 'há menos de 1 h';
    if (ms < DIA) return 'há ' + Math.floor(ms / HORA) + ' h';
    return 'há ' + plural(Math.floor(ms / DIA), 'dia', 'dias');
  }
  // { texto, tom }: "vence em 12 dias" (ok), "vence em 3 dias" (aviso), "venceu há 2 dias" (ruim)...
  function textoVenc(r, agora) {
    if (r.sit === 'vitalicia') return { texto: 'sem vencimento', tom: 'ok' };
    if (!r.venc) return { texto: '', tom: 'neutro' };
    var teste = r.ass.chave === 'teste' || r.ass.chave === 'teste_fim';
    if (r.venc > agora) {
      var resta = r.venc - agora;
      return { texto: (teste ? 'termina ' : 'vence ') + relFuturo(resta), tom: (teste || resta <= DIAS_VENCENDO * DIA) ? 'aviso' : 'ok' };
    }
    return { texto: (teste ? 'terminou ' : 'venceu ') + relPassado(agora - r.venc), tom: 'ruim' };
  }

  function passa(r, f, agora) {
    if (r.admin) return false;
    if (f.sit && f.sit !== 'todas') {
      if (f.sit === 'vencendo') { if (!vencendo(r, agora)) return false; }
      else if (f.sit === 'hoje') { if (!venceHoje(r, agora)) return false; }
      else if (r.sit !== f.sit) return false;
    }
    var termos = semAcento(f.busca || '').split(/\s+/).filter(Boolean);
    for (var i = 0; i < termos.length; i++) if (r.busca.indexOf(termos[i]) < 0) return false;
    return true;
  }
  function filtrar(regs, f, agora) { return regs.filter(function (r) { return passa(r, f || {}, agora || Date.now()); }); }

  function prioridade(r, agora) { return vencendo(r, agora) ? PRIORIDADE.vencendo : PRIORIDADE[r.sit]; }
  function porNome(a, b) { return String(a.nome).localeCompare(String(b.nome), 'pt-BR', { sensitivity: 'base' }); }
  // Datas ausentes ficam sempre no fim, qualquer que seja o sentido
  function porData(campo, dir) {
    return function (a, b) {
      var x = a[campo], y = b[campo];
      var nx = x == null || isNaN(x), ny = y == null || isNaN(y);
      if (nx && ny) return porNome(a, b);
      if (nx) return 1;
      if (ny) return -1;
      return (dir === 'desc' ? y - x : x - y) || porNome(a, b);
    };
  }
  var ORDENS = [['prioridade', 'Quem precisa de atenção'], ['venc:asc', 'Vencimento (mais próximo)'], ['venc:desc', 'Vencimento (mais distante)'],
    ['login:desc', 'Último acesso (mais recente)'], ['nome:asc', 'Nome (A a Z)'], ['criadoEm:desc', 'Cadastro (mais recente)']];
  function ordenar(regs, ordem, agora) {
    agora = agora || Date.now();
    var lista = regs.slice();
    if (ordem === 'nome:asc') return lista.sort(porNome);
    if (ordem === 'criadoEm:desc') return lista.sort(porData('criadoEm', 'desc'));
    if (ordem === 'login:desc') return lista.sort(porData('ultimoLogin', 'desc'));
    if (ordem === 'venc:asc') return lista.sort(porData('venc', 'asc'));
    if (ordem === 'venc:desc') return lista.sort(porData('venc', 'desc'));
    return lista.sort(function (a, b) {
      var d = prioridade(a, agora) - prioridade(b, agora);
      return d || porData('venc', 'asc')(a, b);
    });
  }

  function resumo(regs, agora, preco) {
    agora = agora || Date.now();
    var o = { total: 0, paga: 0, cortesia: 0, vitalicia: 0, teste: 0, pendente: 0, encerrada: 0, vencendo: 0, admins: 0, receita: 0 };
    regs.forEach(function (r) {
      if (r.admin) { o.admins++; return; }
      o.total++; o[r.sit]++;
      if (vencendo(r, agora)) o.vencendo++;
    });
    o.receita = preco > 0 ? Math.round(o.paga * preco * 100) / 100 : 0;
    return o;
  }

  function paginar(lista, pagina, porPagina) { return Adm.paginar(lista, pagina, porPagina); }

  /* ---- tempo de cortesia ---- */
  var UNIDADES = { minutes: 1, hours: 60, days: 1440, months: 43200, years: 525600 };
  var MAX_MINUTOS = 10 * 525600; // o servidor recusa mais de 10 anos
  var RAPIDOS = [[60, '+1 hora'], [1440, '+24 horas'], [10080, '+7 dias'], [43200, '+30 dias'], [525600, '+1 ano']];
  var LOTE_TEMPOS = [[1440, '1 dia'], [10080, '7 dias'], [43200, '30 dias'], [525600, '1 ano']];
  function textoMinutos(min) {
    if (min % 525600 === 0) return plural(min / 525600, 'ano', 'anos');
    if (min % 43200 === 0) return plural(min / 43200, 'mês (30 dias)', 'meses (30 dias cada)');
    if (min % 1440 === 0) return plural(min / 1440, 'dia', 'dias');
    if (min % 60 === 0) return plural(min / 60, 'hora', 'horas');
    return plural(min, 'minuto', 'minutos');
  }
  function minutosDe(qtd, unidade) {
    var n = parseInt(qtd, 10);
    if (!(n > 0)) return { ok: false, erro: 'Informe uma quantidade maior que zero.' };
    var f = UNIDADES[unidade];
    if (!f) return { ok: false, erro: 'Escolha a unidade de tempo.' };
    var min = n * f;
    if (min > MAX_MINUTOS) return { ok: false, erro: 'O máximo é 10 anos. Para acesso sem prazo use "Vitalício".' };
    return { ok: true, minutos: min, texto: textoMinutos(min) };
  }

  // Quem recebe "dar tempo" em lote: administrador, a própria conta e vitalícia ficam de fora (somar tempo a um vitalício viraria prazo de 2099)
  function alvosConceder(regs, emails, eu) {
    var sel = {};
    (emails || []).forEach(function (e) { sel[String(e).toLowerCase()] = true; });
    var out = { elegiveis: [], ignoradas: { voce: 0, admin: 0, vitalicio: 0 } };
    (regs || []).forEach(function (r) {
      if (!sel[r.email]) return;
      if (r.email === eu) out.ignoradas.voce++;
      else if (r.admin) out.ignoradas.admin++;
      else if (r.sit === 'vitalicia') out.ignoradas.vitalicio++;
      else out.elegiveis.push(r);
    });
    return out;
  }
  function textoIgnoradasConceder(ig) {
    var p = [];
    if (ig.vitalicio) p.push(plural(ig.vitalicio, 'vitalícia', 'vitalícias'));
    if (ig.admin) p.push(plural(ig.admin, 'administrador', 'administradores'));
    if (ig.voce) p.push('a sua conta');
    return p.join(', ');
  }

  /* ---- liberar o mensal em lote ---- */
  // Quem recebe "Liberar mensal" em lote: pendente, encerrada ou teste — e assinante/cortesia prestes a vencer (renovação). Quem está em dia fica de fora.
  function alvosMensal(regs, emails, eu, agora) {
    agora = agora || Date.now();
    var sel = {};
    (emails || []).forEach(function (e) { sel[String(e).toLowerCase()] = true; });
    var out = { elegiveis: [], ignoradas: { voce: 0, admin: 0, vitalicio: 0, emDia: 0 } };
    (regs || []).forEach(function (r) {
      if (!sel[r.email]) return;
      if (r.email === eu) out.ignoradas.voce++;
      else if (r.admin) out.ignoradas.admin++;
      else if (r.sit === 'vitalicia') out.ignoradas.vitalicio++;
      else if ((r.sit === 'paga' || r.sit === 'cortesia') && !vencendo(r, agora)) out.ignoradas.emDia++;
      else out.elegiveis.push(r);
    });
    return out;
  }
  function textoIgnoradasMensal(ig) {
    var p = [];
    if (ig.emDia) p.push(plural(ig.emDia, 'conta já em dia', 'contas já em dia'));
    if (ig.vitalicio) p.push(plural(ig.vitalicio, 'vitalícia', 'vitalícias'));
    if (ig.admin) p.push(plural(ig.admin, 'administrador', 'administradores'));
    if (ig.voce) p.push('a sua conta');
    return p.join(', ');
  }

  /* ---- CSV (abre no Excel: ; como separador, célula que começa com = + - @ ganha apóstrofo) ---- */
  function csvCelula(v) {
    var s = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return /[;"]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function csv(regs, agora) {
    agora = agora || Date.now();
    var linhas = [['Nome', 'E-mail', 'CPF', 'Telefone', 'Conta', 'Situação', 'Plano', 'Forma de pagamento', 'Vencimento', 'Prazo']];
    regs.forEach(function (r) {
      linhas.push([r.nome, r.email, r.cpfFmt, r.telFmt, r.ativo ? 'Ativa' : 'Bloqueada', SIT[r.sit] ? SIT[r.sit].rotulo : r.sit,
        r.ass.chave === 'ativo' ? r.ass.rotulo : '', r.metodoRotulo, r.venc ? dataBR(r.venc, true) : '', textoVenc(r, agora).texto]);
    });
    return linhas.map(function (l) { return l.map(csvCelula).join(';'); }).join('\r\n');
  }

  /* ============================================================ estado ============================================================ */
  // larguraDr: largura do painel da conta em px (null = padrão); drMax: painel em tela cheia
  var estado = { busca: '', sit: 'todas', ordem: 'prioridade', pagina: 1, porPagina: 25, sel: {}, detalhe: null, retorno: null, ocupado: false, larguraDr: null, drMax: false };
  var ctxFn = null, ligado = false, tempoBusca = null, relTimer = null, ultimo = {};
  var CHAVE_PREFS = 'nexus_ass_prefs';
  // O painel da conta é uma janela no MEIO da tela: 1040 px mostra situação, histórico e ações lado a lado (2 colunas) sem cortar nada
  // Mínimo 520: abaixo disso o nome da pessoa quebra no meio da palavra (avatar + setas + tela cheia + fechar dividem o cabeçalho)
  var LARG_MIN = 520, LARG_PADRAO = 1040;
  function lerPrefs() {
    try {
      var p = JSON.parse(root.localStorage.getItem(CHAVE_PREFS) || '{}');
      if ([25, 50, 100].indexOf(p.porPagina) >= 0) estado.porPagina = p.porPagina;
      // chave própria (larguraJanela): o valor antigo (larguraDr) era de quando o painel ficava colado no canto direito e não vale para a janela central
      if (p.larguraJanela >= LARG_MIN && p.larguraJanela <= 4000) estado.larguraDr = Math.round(p.larguraJanela);
    } catch (e) {}
  }
  function gravarPrefs() { try { root.localStorage.setItem(CHAVE_PREFS, JSON.stringify({ porPagina: estado.porPagina, larguraJanela: estado.larguraDr })); } catch (e) {} }
  // Largura do painel da conta: nunca menor que o mínimo e nunca maior que a tela menos uma faixa (o fundo escuro continua clicável para fechar)
  function limitarLargura(px, vw) {
    vw = vw || 1280;
    var max = Math.max(LARG_MIN, vw - 40);
    // Sem valor (nada guardado, texto, NaN) = padrão; qualquer número, mesmo zero ou negativo (arrastou além da borda), é limitado ao mínimo
    var n = px === null || px === '' || px === undefined ? NaN : Math.round(Number(px));
    if (!isFinite(n)) n = LARG_PADRAO;
    return Math.min(max, Math.max(LARG_MIN, n));
  }
  // O app aplica zoom no <body> (escala automática) e a gaveta fica dentro dele: o mouse anda em pixels de tela, o painel mede em pixels do painel.
  // larguraTela() = largura que "100%" tem para o painel (o container fixo da gaveta); zoomTela() = quantos pixels de tela vale 1 px do painel.
  function larguraTela() {
    var d = root.document, el = d && d.getElementById('asGaveta');
    // clientWidth (sem a borda de 1 px que o app põe em todo role="dialog") é exatamente o que 100% vale para o painel
    return (el && el.clientWidth) || (d && d.documentElement && d.documentElement.clientWidth) || root.innerWidth || 1280;
  }
  function zoomTela() {
    var d = root.document, el = d && d.getElementById('asGaveta');
    if (!el || !el.offsetWidth) return 1;
    var z = el.getBoundingClientRect().width / el.offsetWidth;
    return z > 0.2 && z < 5 ? z : 1;
  }

  function contexto() { return ctxFn ? ctxFn() : { usuarios: [], acoes: {} }; }
  function calcular(ctx) {
    var agora = ctx.agora || Date.now();
    var visto = {}, regs = [];
    (ctx.usuarios || []).forEach(function (u) {
      if (!u || !u.email) return;
      var k = String(u.email).toLowerCase().trim();
      if (visto[k]) return;
      visto[k] = true;
      regs.push(registro(u, agora));
    });
    var preco = ctx.preco && ctx.preco.numero > 0 ? ctx.preco.numero : 0;
    var filtrados = filtrar(regs, estado, agora);
    var ordenados = ordenar(filtrados, estado.ordem, agora);
    var pag = paginar(ordenados, estado.pagina, estado.porPagina);
    estado.pagina = pag.pagina;
    return { todos: regs, filtrados: filtrados, ordenados: ordenados, pag: pag, resumo: resumo(regs, agora, preco), agora: agora, preco: preco,
      eu: String((ctx.eu && ctx.eu.email) || '').toLowerCase() };
  }
  function achar(m, email) { for (var i = 0; i < m.todos.length; i++) if (m.todos[i].email === email) return m.todos[i]; return null; }

  /* ============================================================ ícones ============================================================ */
  function svg(d) { return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; }
  var IC = {
    escudo: svg('<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
    busca: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    olho: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
    ok: svg('<polyline points="20 6 9 17 4 12"/>'),
    relogio: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>'),
    cadeado: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
    sinc: svg('<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
    baixar: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    ant: svg('<polyline points="15 18 9 12 15 6"/>'),
    prox: svg('<polyline points="9 18 15 12 9 6"/>'),
    doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
    lapis: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    copiar: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    inf: svg('<path d="M18.2 8.3a4 4 0 0 0-5.6 0L12 9l-.6-.7a4 4 0 1 0 0 5.7l.6-.7.6.7a4 4 0 1 0 5.6-5.7Z"/>'),
    cartao: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'),
    expandir: svg('<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>'),
    recolher: svg('<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>')
  };

  /* ============================================================ HTML: página ============================================================ */
  function opcoes(lista, atual) {
    return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(atual) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  function pill(sit, extra) { var s = SIT[sit]; return '<span class="adm-pill ' + s.pill + '" title="' + esc(s.dica) + '">' + esc(extra || s.rotulo) + '</span>'; }
  function pillConta(r) { return r.ativo ? '' : '<span class="adm-pill adm-p-ruim" title="O login desta conta está bloqueado">Conta bloqueada</span>'; }
  function avatar(r, extra) {
    return '<span class="adm-av' + (extra ? ' ' + extra : '') + '" aria-hidden="true">' + esc(r.iniciais) + '<i class="adm-dot' + (r.ativo ? '' : ' is-off') + '"></i></span>';
  }

  var KPIS = [
    { id: 'todas', rotulo: 'Contas', dica: 'todas as contas de usuário', campo: 'total', cor: 'neutro' },
    { id: 'paga', rotulo: 'Assinantes', dica: 'plano mensal pago', campo: 'paga', cor: 'ok' },
    { id: 'vencendo', rotulo: 'Vencem em ' + DIAS_VENCENDO + ' dias', dica: 'renovação próxima', campo: 'vencendo', cor: 'ouro', atencao: true },
    { id: 'pendente', rotulo: 'Aguardando pagamento', dica: 'pagamento informado', campo: 'pendente', cor: 'info', atencao: true },
    { id: 'encerrada', rotulo: 'Acesso encerrado', dica: 'teste ou plano vencido', campo: 'encerrada', cor: 'ruim', atencao: true },
    { id: 'teste', rotulo: 'Em teste', dica: 'dia grátis', campo: 'teste', cor: 'aviso' },
    { id: 'cortesia', rotulo: 'Cortesias', dica: 'liberadas sem pagamento', campo: 'cortesia', cor: 'ouro' },
    { id: 'vitalicia', rotulo: 'Vitalícios', dica: 'sem vencimento', campo: 'vitalicia', cor: 'ok' }
  ];
  function htmlKpi(k, r) {
    var n = r[k.campo];
    var on = estado.sit === k.id;
    var alerta = !!k.atencao && n > 0;
    return '<button type="button" role="listitem" class="adm-kpi adm-k-' + k.cor + (on ? ' is-on' : '') + (n === 0 ? ' is-zero' : '') + (alerta ? ' is-atencao' : '') + '" data-as-kpi="' + k.id + '" aria-pressed="' + on + '"' +
      ' title="Filtrar: ' + esc(k.rotulo) + ' (' + esc(k.dica) + ')' + (alerta ? ' - pede atenção' : '') + '">' +
      (alerta ? '<i class="adm-kpi-al" aria-hidden="true"></i><span class="adm-sr">Pede atenção: </span>' : '') +
      '<span class="adm-kpi-n">' + n + '</span><span class="adm-kpi-t">' + esc(k.rotulo) + '</span><small>' + esc(k.dica) + '</small></button>';
  }
  function htmlResumo(m) {
    var r = m.resumo;
    return '<div class="adm-kpis as-kpis" role="list" aria-label="Resumo das assinaturas">' + KPIS.map(function (k) { return htmlKpi(k, r); }).join('') + '</div>';
  }

  var ICONE_FILTRO = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="22 3 2 3 10 12.5 10 19 14 21 14 12.5 22 3"/></svg>';
  var NOME_SIT = { todas: 'Todas', paga: 'Assinantes', vencendo: 'Vencem em ' + DIAS_VENCENDO + ' dias', hoje: 'Vencem hoje', pendente: 'Aguardando pagamento', encerrada: 'Acesso encerrado', teste: 'Em teste', cortesia: 'Cortesias', vitalicia: 'Vitalícios' };
  function htmlContador(m) {
    return '<span class="adm-cont" aria-live="polite"><b>' + m.pag.total + '</b> de ' + m.resumo.total + ' conta' + (m.resumo.total === 1 ? '' : 's') + '</span>';
  }
  function htmlChips() {
    var chips = [];
    if (estado.busca) chips.push(['busca', 'Busca: "' + estado.busca + '"']);
    if (estado.sit !== 'todas') chips.push(['sit', NOME_SIT[estado.sit] || estado.sit]);
    if (!chips.length) return '';
    return chips.map(function (c) { return '<button type="button" class="adm-chip" data-as-chip="' + c[0] + '" title="Remover este filtro">' + esc(c[1]) + IC.x + '</button>'; }).join('') +
      '<button type="button" class="adm-link" data-as-a="limpar">Limpar tudo</button>';
  }
  function htmlBarra(m) {
    var nf = estado.sit !== 'todas' ? 1 : 0;
    // Situação e Ordenar ficam logo depois da caixa #asFtog: no celular o CSS do painel as esconde e o botão "Filtros" as mostra (no computador o botão some)
    return '<div class="adm-barra as-barra">' +
      '<label class="adm-busca">' + IC.busca + '<input type="search" id="asBusca" data-as-busca autocomplete="off" spellcheck="false" placeholder="Buscar nome, e-mail, CPF…  ( / )" value="' + esc(estado.busca) + '" aria-label="Buscar contas"></label>' +
      '<input type="checkbox" id="asFtog" class="adm-ftog" aria-label="Mostrar ou esconder os filtros">' +
      '<label for="asFtog" class="adm-fbtn as-fbtn" title="Situação e ordem">' + ICONE_FILTRO + '<span>Filtros</span><b class="adm-fn" data-as-fn' + (nf ? '' : ' hidden') + '>' + (nf || '') + '</b></label>' +
      '<label class="adm-sel"><span>Situação</span><select data-as-filtro="sit">' + opcoes(Object.keys(NOME_SIT).map(function (k) { return [k, NOME_SIT[k]]; }), estado.sit) + '</select></label>' +
      '<label class="adm-sel adm-sel-ord"><span>Ordenar por</span><select data-as-ordem>' + opcoes(ORDENS, estado.ordem) + '</select></label>' +
      '<span class="adm-cont-w" id="asCont">' + htmlContador(m) + '</span></div>';
  }

  /* ---- lista ---- */
  // Botão contextual da linha: o próximo passo mais provável para aquela situação
  function acaoRapida(r, agora) {
    if (r.sit === 'pendente') return { a: 'mensal', rotulo: 'Confirmar pagamento', ic: 'ok', pri: true, dica: 'Reconhece o pagamento informado e libera o plano mensal' };
    if (r.sit === 'encerrada' || r.sit === 'teste' || vencendo(r, agora)) return { a: 'mensal', rotulo: 'Liberar mensal', ic: 'ok', pri: true, dica: 'Reconhece o pagamento e deixa o acesso válido por 30 dias' };
    // Assinante pago em dia não ganha atalho: dar tempo a quem paga troca o plano para "cortesia" (regra do servidor), e isso não pode ser um clique sem querer
    if (r.sit === 'cortesia') return { a: 'conceder', min: 43200, rotulo: '+30 dias', ic: 'relogio', dica: 'Soma 30 dias de cortesia ao que ainda resta' };
    return null;
  }
  function botoesLinha(r, m) {
    var q = acaoRapida(r, m.agora);
    var eu = r.email === m.eu;
    return (q && !eu ? '<button type="button" class="adm-btn adm-btn-sm' + (q.pri ? ' adm-btn-pri' : '') + '" data-as-a="' + q.a + '"' + (q.min ? ' data-min="' + q.min + '"' : '') + ' data-email="' + esc(r.email) + '" title="' + esc(q.dica) + '">' + IC[q.ic] + '<span>' + esc(q.rotulo) + '</span></button>' : '') +
      '<button type="button" class="adm-ib" data-as-abrir="' + esc(r.email) + '" title="Ver detalhes e todas as ações" aria-label="Gerenciar a assinatura de ' + esc(r.nome) + '">' + IC.olho + '</button>';
  }
  // O nome é um botão de verdade: dá para clicar, alcançar pelo Tab e abrir com Enter
  function nomeBtn(r) {
    return '<button type="button" class="adm-nome as-nome" data-as-abrir="' + esc(r.email) + '" title="Abrir a assinatura de ' + esc(r.nome) + '">' + esc(r.nome) + '</button>';
  }
  function checkbox(r, m) {
    var eu = r.email === m.eu;
    return '<input type="checkbox" class="adm-chk" data-as-sel="' + esc(r.email) + '"' + (estado.sel[r.email] ? ' checked' : '') + (eu ? ' disabled title="Você não pode agir sobre a própria conta"' : '') + ' aria-label="Selecionar ' + esc(r.nome) + '">';
  }
  function celulaVenc(r, m) {
    var t = textoVenc(r, m.agora);
    if (r.sit === 'vitalicia') return '<b>Sem vencimento</b>';
    if (!r.venc) return '<span class="adm-nd">—</span>';
    return '<b>' + esc(dataBR(r.venc, true)) + '</b><small class="as-rel as-rel-' + t.tom + '">' + esc(t.texto) + '</small>';
  }
  function celulaPlano(r) {
    if (r.sit === 'paga' || r.sit === 'cortesia') return '<b>' + esc(r.ass.rotulo) + '</b><small>' + esc(r.metodoRotulo || '—') + '</small>';
    if (r.sit === 'vitalicia') return '<b>Vitalício</b><small>' + esc(r.metodoRotulo || 'Liberado pelo administrador') + '</small>';
    if (r.sit === 'pendente') return '<b>Mensal</b><small>' + esc(r.metodoRotulo || 'Pagamento informado') + '</small>';
    return '<span class="adm-nd">—</span>';
  }
  function linhaTabela(r, m) {
    return '<tr class="adm-lin as-lin' + (r.ativo ? '' : ' is-off') + (estado.sel[r.email] ? ' is-sel' : '') + (estado.detalhe === r.email ? ' is-aberto' : '') + '" data-as-abrir="' + esc(r.email) + '">' +
      '<td class="as-c-sel">' + checkbox(r, m) + '</td>' +
      '<td class="as-c-tit"><div class="adm-tit">' + avatar(r) + '<div class="adm-tit-t">' + nomeBtn(r) + '<small title="' + esc(r.email) + '">' + esc(r.email) + '</small></div></div></td>' +
      '<td class="as-c-sit">' + pill(r.sit, vencendo(r, m.agora) ? SIT[r.sit].rotulo + ' · vence logo' : '') + (r.ativo ? '' : '<small>Conta bloqueada</small>') + '</td>' +
      '<td class="as-c-plano">' + celulaPlano(r) + '</td>' +
      '<td class="as-c-venc">' + celulaVenc(r, m) + '</td>' +
      '<td class="as-c-acoes"><div class="adm-acoes">' + botoesLinha(r, m) + '</div></td></tr>';
  }
  function htmlTabela(m) {
    var selecionaveis = m.pag.itens.filter(function (r) { return r.email !== m.eu; });
    var todos = selecionaveis.length > 0 && selecionaveis.every(function (r) { return estado.sel[r.email]; });
    return '<div class="adm-tabela-wrap as-tabela-wrap"><table class="adm-tabela as-tabela">' +
      '<colgroup><col class="as-c-sel"><col class="as-c-tit"><col class="as-c-sit"><col class="as-c-plano"><col class="as-c-venc"><col class="as-c-acoes"></colgroup><thead><tr>' +
      '<th scope="col" class="as-c-sel"><input type="checkbox" class="adm-chk" data-as-sel-pagina ' + (todos ? 'checked ' : '') + 'aria-label="Selecionar todas as contas desta página"></th>' +
      '<th scope="col" class="as-c-tit">Conta</th><th scope="col" class="as-c-sit">Situação</th><th scope="col" class="as-c-plano">Plano</th><th scope="col" class="as-c-venc">Vencimento</th>' +
      '<th scope="col" class="as-c-acoes"><span class="adm-sr">Ações</span></th></tr></thead><tbody>' +
      m.pag.itens.map(function (r) { return linhaTabela(r, m); }).join('') + '</tbody></table></div>';
  }
  function cartao(r, m) {
    var t = textoVenc(r, m.agora);
    return '<article class="adm-card as-card' + (r.ativo ? '' : ' is-off') + (estado.sel[r.email] ? ' is-sel' : '') + (estado.detalhe === r.email ? ' is-aberto' : '') + '" data-as-abrir="' + esc(r.email) + '">' +
      '<header class="adm-card-cab">' + checkbox(r, m) + avatar(r) + '<div class="adm-tit-t">' + nomeBtn(r) + '<small>' + esc(r.email) + '</small></div></header>' +
      '<div class="adm-card-pills">' + pill(r.sit) + pillConta(r) + '</div>' +
      '<dl class="adm-card-meta"><div><dt>Plano</dt><dd>' + esc(r.sit === 'paga' || r.sit === 'cortesia' ? r.ass.rotulo + (r.metodoRotulo ? ' · ' + r.metodoRotulo : '') : '—') + '</dd></div>' +
      '<div><dt>Vencimento</dt><dd>' + (r.sit === 'vitalicia' ? 'Sem vencimento' : (r.venc ? esc(dataBR(r.venc, true)) : '—')) + '</dd></div>' +
      (t.texto && r.sit !== 'vitalicia' ? '<div><dt>Prazo</dt><dd class="as-rel as-rel-' + t.tom + '">' + esc(t.texto) + '</dd></div>' : '') + '</dl>' +
      '<footer class="adm-card-acoes">' + botoesLinha(r, m) + '</footer></article>';
  }
  function htmlVazio(m) {
    if (!m.resumo.total) {
      return '<div class="adm-vazio"><div class="adm-vazio-ic">' + IC.escudo + '</div><h3>Nenhuma conta de usuário ainda</h3><p>Administradores têm acesso ilimitado e não entram aqui. Quando houver contas de usuário, a assinatura de cada uma aparece nesta lista.</p></div>';
    }
    return '<div class="adm-vazio"><div class="adm-vazio-ic">' + IC.busca + '</div><h3>Nenhuma conta encontrada</h3><p>Nenhuma conta combina com a busca e o filtro escolhidos.</p>' +
      '<button type="button" class="adm-btn" data-as-a="limpar">Limpar busca e filtros</button></div>';
  }
  function htmlSelecao(m) {
    var emails = Object.keys(estado.sel).filter(function (e) { return estado.sel[e]; });
    if (!emails.length) return '';
    var nCon = alvosConceder(m.todos, emails, m.eu).elegiveis.length;
    var nExp = Adm.alvosExpirar(m.todos, emails, m.eu).elegiveis.length;
    var nMen = alvosMensal(m.todos, emails, m.eu, m.agora).elegiveis.length;
    var naoSel = m.ordenados.filter(function (r) { return r.email !== m.eu && !estado.sel[r.email]; }).length;
    return '<div class="adm-selbar as-selbar" role="region" aria-label="Ações em lote"><b>' + plural(emails.length, 'selecionada', 'selecionadas') + '</b>' +
      (naoSel > 0 ? '<button type="button" class="adm-link" data-as-a="sel-filtrados">Selecionar todas as ' + m.ordenados.filter(function (r) { return r.email !== m.eu; }).length + ' da lista</button>' : '') +
      '<span class="adm-selbar-sp"></span>' +
      '<span class="as-lote-tempo"><select id="asLoteTempo" aria-label="Tempo a conceder">' + opcoes(LOTE_TEMPOS, 10080) + '</select></span>' +
      '<button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-as-a="lote-conceder"' + (nCon ? '' : ' disabled') + ' title="Soma o tempo escolhido, como cortesia, às contas selecionadas">' + IC.relogio + '<span>Dar tempo' + (nCon ? ' (' + nCon + ')' : '') + '</span></button>' +
      '<button type="button" class="adm-btn adm-btn-sm" data-as-a="lote-mensal"' + (nMen ? ' title="Reconhece o pagamento e libera 30 dias para as contas que estão sem plano em dia"' : ' disabled title="Nenhuma conta selecionada precisa do mensal (em dia, vitalícia ou fora do escopo)"') + '>' + IC.ok + '<span>Liberar mensal' + (nMen ? ' (' + nMen + ')' : '') + '</span></button>' +
      '<button type="button" class="adm-btn adm-btn-sm adm-btn-perigo" data-as-a="lote-expirar"' + (nExp ? ' title="Exige novo pagamento de ' + plural(nExp, 'conta com assinatura ativa', 'contas com assinatura ativa') + '"' : ' disabled title="Nenhuma conta selecionada tem assinatura ativa"') + '>' + IC.cadeado + '<span>Expirar' + (nExp ? ' (' + nExp + ')' : '') + '</span></button>' +
      '<button type="button" class="adm-btn adm-btn-sm" data-as-a="lote-exportar">' + IC.baixar + '<span>Exportar seleção</span></button>' +
      '<button type="button" class="adm-ib" data-as-a="lote-limpar" title="Limpar seleção" aria-label="Limpar seleção">' + IC.x + '</button></div>';
  }
  function htmlRodape(m) {
    var p = m.pag;
    if (!p.total) return '';
    var botoes = '';
    var ini = Math.max(1, Math.min(p.pagina - 2, p.paginas - 4)), fim = Math.min(p.paginas, ini + 4);
    for (var i = ini; i <= fim; i++) botoes += '<button type="button" class="adm-pg' + (i === p.pagina ? ' is-on' : '') + '" data-as-pag="' + i + '"' + (i === p.pagina ? ' aria-current="page"' : '') + '>' + i + '</button>';
    return '<div class="adm-rodape"><span class="adm-rodape-t">Mostrando <b>' + p.de + '–' + p.ate + '</b> de <b>' + p.total + '</b></span>' +
      '<div class="adm-pags" role="navigation" aria-label="Páginas">' +
        '<button type="button" class="adm-pg" data-as-pag="' + (p.pagina - 1) + '"' + (p.pagina <= 1 ? ' disabled' : '') + ' aria-label="Página anterior">' + IC.ant + '</button>' + botoes +
        '<button type="button" class="adm-pg" data-as-pag="' + (p.pagina + 1) + '"' + (p.pagina >= p.paginas ? ' disabled' : '') + ' aria-label="Próxima página">' + IC.prox + '</button></div>' +
      '<label class="adm-sel adm-sel-pp"><span>Por página</span><select data-as-pp>' + opcoes([[25, '25'], [50, '50'], [100, '100']], estado.porPagina) + '</select></label></div>';
  }
  function htmlLista(m) {
    if (!m.pag.total) return htmlVazio(m);
    return htmlSelecao(m) + htmlTabela(m) + '<div class="adm-cartoes as-cartoes">' + m.pag.itens.map(function (r) { return cartao(r, m); }).join('') + '</div>' + htmlRodape(m);
  }
  function htmlCabecalho(ctx, m) {
    var quando = ctx.sincronizadoEm ? 'Atualizado às ' + hora(ctx.sincronizadoEm) : '';
    return Adm.cabecalhoHTML({
      icone: 'escudo', titulo: 'Assinaturas',
      subtitulo: 'Quem está em teste, quem paga e quem vence. Libere o mensal, dê tempo de cortesia, bloqueie ou reinicie o teste sem abrir o cadastro.' + (m.preco > 0 ? ' Plano mensal de ' + moeda(m.preco) + '.' : ''),
      acoes: (m.preco > 0 ? '<span class="as-receita" title="Assinantes pagos × valor do plano mensal. Cortesias e vitalícios não entram."><small>Receita mensal estimada</small><b id="asReceita">' + esc(moeda(m.resumo.receita)) + '</b></span>' : '') +
        '<span class="adm-sinc" id="asSinc">' + esc(quando) + '</span>' +
        '<button type="button" class="adm-btn" data-as-a="sincronizar">' + IC.sinc + '<span>Sincronizar</span></button>' +
        '<button type="button" class="adm-btn" data-as-a="exportar" title="Baixar a lista filtrada em CSV (abre no Excel)">' + IC.baixar + '<span>Exportar CSV</span></button>'
    });
  }
  function paginaHTML(ctx) {
    var m = calcular(ctx);
    return '<div id="asRaiz" class="as">' + htmlCabecalho(ctx, m) +
      '<section id="asResumo" class="adm-resumo" aria-label="Resumo">' + htmlResumo(m) + '</section>' +
      '<section class="adm-ferr" aria-label="Busca e filtros">' + htmlBarra(m) + '<div class="adm-chips" id="asChips">' + htmlChips() + '</div></section>' +
      '<section class="adm-lista as-lista" id="asLista" aria-label="Lista de assinaturas">' + htmlLista(m) + '</section></div>';
  }

  /* ============================================================ HTML: gaveta de uma conta ============================================================ */
  function linhaDl(t, v) { return '<div class="adm-dl-l"><dt>' + esc(t) + '</dt><dd>' + (v === '' || v == null ? '<span class="adm-nd">—</span>' : v) + '</dd></div>'; }
  // Quanto do período mensal de 30 dias já passou (só faz sentido para assinatura paga; cortesia e vitalício não têm período fixo)
  function htmlProgresso(r, agora) {
    if (r.sit !== 'paga' || !r.venc) return '';
    var pct = Math.max(0, Math.min(100, Math.round((1 - (r.venc - agora) / (30 * DIA)) * 100)));
    return '<div class="as-prog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '" aria-label="Período mensal decorrido" title="' + pct + '% do período mensal de 30 dias já passou">' +
      '<i style="width:' + pct + '%"></i></div><small class="as-prog-t">' + pct + '% do período mensal</small>';
  }
  function btnAc(a, email, ic, rotulo, dica, classe, extra) {
    return '<button type="button" class="adm-ac ' + (classe || '') + '" data-as-a="' + a + '" data-email="' + esc(email) + '"' + (extra || '') + (dica ? ' title="' + esc(dica) + '"' : '') + '>' + IC[ic] + '<span>' + esc(rotulo) + '</span></button>';
  }
  function detalheHTML(r, m, ctx) {
    var t = textoVenc(r, m.agora);
    var idx = m.ordenados.findIndex(function (x) { return x.email === r.email; });
    var eu = r.email === m.eu;
    var eventos = (ctx.eventos ? ctx.eventos(r.email) : []) || [];
    var rotuloPreco = m.preco > 0 ? ' (' + moeda(m.preco) + ')' : '';
    var vencTxt = r.sit === 'vitalicia' ? 'Sem vencimento' : (r.venc ? esc(dataBR(r.venc, true)) + (t.texto ? ' · <span class="as-rel as-rel-' + t.tom + '">' + esc(t.texto) + '</span>' : '') : '');
    var corpoAcoes;
    if (eu) {
      corpoAcoes = '<p class="adm-nota">Esta é a sua conta: por segurança, as ações de assinatura não valem para ela.</p>';
    } else {
      corpoAcoes =
        '<section><h4>Liberar o plano mensal</h4>' +
          '<p class="adm-nota">Reconhece o pagamento, registra no livro de pagamentos e deixa o acesso válido por 30 dias a partir da confirmação.</p>' +
          '<button type="button" class="adm-btn adm-btn-pri as-cheio" data-as-a="mensal" data-email="' + esc(r.email) + '">' + IC.ok + '<span>Liberar mensal' + esc(rotuloPreco) + '</span></button></section>' +
        '<section><h4>Dar tempo (cortesia)</h4>' +
          '<p class="adm-nota">Soma ao que a conta ainda tem. Não entra como receita.</p>' +
          (r.sit === 'paga' ? '<p class="adm-nota as-aviso" role="note">Esta conta paga o mensal: ao dar tempo, ela passa a constar como <b>cortesia</b> e sai da receita estimada.</p>' : '') +
          '<div class="as-grade">' + RAPIDOS.map(function (q) {
            return '<button type="button" class="adm-btn adm-btn-sm" data-as-a="conceder" data-min="' + q[0] + '" data-email="' + esc(r.email) + '">' + esc(q[1]) + '</button>';
          }).join('') +
          '<button type="button" class="adm-btn adm-btn-sm as-vital" data-as-a="vitalicio" data-email="' + esc(r.email) + '" title="Acesso sem prazo">' + IC.inf + '<span>Vitalício</span></button></div>' +
          '<div class="as-custom"><label class="adm-sr" for="asQtd">Quantidade</label><input type="number" id="asQtd" min="1" step="1" inputmode="numeric" placeholder="Qtd" aria-label="Quantidade de tempo">' +
            '<label class="adm-sr" for="asUnid">Unidade</label><select id="asUnid" aria-label="Unidade de tempo"><option value="minutes">Minuto(s)</option><option value="hours" selected>Hora(s)</option><option value="days">Dia(s)</option><option value="months">Mês(es)</option><option value="years">Ano(s)</option></select>' +
            '<button type="button" class="adm-btn adm-btn-sm adm-btn-pri" data-as-a="custom" data-email="' + esc(r.email) + '">Liberar</button></div>' +
          '<p class="as-erro" id="asErro" role="alert" hidden></p></section>' +
        '<section><h4>Bloqueio e teste</h4><div class="adm-ac-grade">' +
          btnAc('bloquear', r.email, 'cadeado', 'Bloquear / exigir pagamento', r.sit === 'encerrada' ? 'Esta conta já está sem acesso' : 'Encerra o acesso agora; só volta depois de um novo pagamento', 'adm-ac-perigo', r.sit === 'encerrada' ? ' disabled' : '') +
          btnAc('teste', r.email, 'relogio', 'Reiniciar teste (1 dia)', 'Devolve 1 dia grátis a partir de agora') + '</div></section>' +
        '<section><h4>Outras ações</h4><div class="adm-ac-grade">' +
          btnAc('boleto', r.email, 'doc', '2ª via de boleto ou Pix', 'Gera a cobrança para enviar à pessoa') +
          btnAc('cadastro', r.email, 'lapis', 'Abrir cadastro', 'Nome, CPF, telefone, perfil e senha') +
          btnAc('copiar', r.email, 'copiar', 'Copiar e-mail') + '</div></section>';
    }
    var ev = eventos.length
      ? '<ul class="adm-eventos">' + eventos.slice(0, 8).map(function (e) {
        return '<li><b>' + esc(e.action || 'Evento') + '</b><span>' + esc(String(e.details || '').slice(0, 160)) + '</span><small>' + esc(dataBR(e.timestamp || e.created_at, true)) + '</small></li>';
      }).join('') + '</ul>'
      : '<p class="adm-nd">Nenhum evento de assinatura registrado para esta conta.</p>';
    var cheia = !!estado.drMax;
    return '<div class="adm-dr-fundo" data-as-a="fechar"></div>' +
      '<div class="adm-dr-painel" role="document">' +
      '<div class="as-dr-alca" id="asDrAlca" data-as-alca role="separator" aria-orientation="vertical" tabindex="0" aria-label="Ajustar a largura do painel. Setas esquerda e direita ajustam; Enter alterna tela cheia"' +
        ' aria-valuemin="' + LARG_MIN + '" aria-valuenow="' + (estado.larguraDr || LARG_PADRAO) + '" title="Arraste para ajustar a largura. Duplo clique restaura o tamanho padrão."><i aria-hidden="true"></i></div>' +
      '<header class="adm-dr-cab"><div class="adm-dr-id">' + avatar(r, 'adm-av-lg') + '<div class="adm-dr-nome"><h3 id="asDrTitulo">' + esc(r.nome) + '</h3><span class="adm-mail">' + esc(r.email) + '</span>' +
        '<div class="adm-dr-pills">' + pill(r.sit) + pillConta(r) + '</div></div></div>' +
        '<div class="adm-dr-nav">' +
          '<button type="button" class="adm-ib" data-as-a="ant" data-email="' + esc(r.email) + '" title="Conta anterior da lista (←)" aria-label="Conta anterior"' + (idx <= 0 ? ' disabled' : '') + '>' + IC.ant + '</button>' +
          '<span class="adm-dr-pos">' + (idx >= 0 ? (idx + 1) + ' de ' + m.ordenados.length : '') + '</span>' +
          '<button type="button" class="adm-ib" data-as-a="prox" data-email="' + esc(r.email) + '" title="Próxima conta da lista (→)" aria-label="Próxima conta"' + (idx < 0 || idx >= m.ordenados.length - 1 ? ' disabled' : '') + '>' + IC.prox + '</button>' +
          '<button type="button" class="adm-ib as-expandir" data-as-a="expandir" aria-pressed="' + cheia + '" title="' + (cheia ? 'Voltar à largura anterior' : 'Ocupar a tela toda') + '" aria-label="' + (cheia ? 'Voltar à largura anterior' : 'Ocupar a tela toda') + '">' + (cheia ? IC.recolher : IC.expandir) + '</button>' +
          '<button type="button" class="adm-ib" data-as-a="fechar" id="asDrFechar" title="Fechar (Esc)" aria-label="Fechar">' + IC.x + '</button></div></header>' +
      '<div class="adm-dr-corpo">' +
        '<div class="as-dr-a"><section><h4>Situação</h4><dl class="adm-dl">' +
          linhaDl('Situação', esc(SIT[r.sit].rotulo) + (r.sit === 'paga' || r.sit === 'cortesia' ? ' · ' + esc(r.ass.rotulo) : '')) +
          linhaDl('Vencimento', vencTxt) +
          linhaDl('Forma de pagamento', esc(r.metodoRotulo)) + linhaDl('Último protocolo', esc(r.protocolo)) +
          linhaDl('Teste iniciado em', isNaN(r.testeInicio) ? '' : esc(dataBR(r.testeInicio, true))) +
          linhaDl('Conta', r.ativo ? 'Ativa' : 'Bloqueada') + '</dl>' + htmlProgresso(r, m.agora) + '</section>' +
        '<section><h4>Dados da conta</h4><dl class="adm-dl">' +
          linhaDl('CPF', esc(r.cpfFmt)) + linhaDl('Telefone', esc(r.telFmt)) + linhaDl('Nascimento', esc(r.nasc)) +
          linhaDl('Último acesso', r.ultimoLogin ? esc(dataBR(r.ultimoLogin, true)) : '') +
          linhaDl('Cadastro', r.criadoEm ? esc(dataBR(r.criadoEm, true)) : '') + '</dl></section></div>' +
        // Em painel largo: situação e histórico na coluna da esquerda, ações na da direita (CSS por container query)
        '<div class="as-dr-b">' + corpoAcoes + '</div>' +
        '<div class="as-dr-c"><section><h4>Histórico da assinatura</h4>' + ev + '</section></div>' +
      '</div></div>';
  }

  /* ============================================================ DOM: pintura, gaveta e janelas ============================================================ */
  function doc() { return root.document; }
  function pintar(id, html) {
    var el = doc() && doc().getElementById(id);
    if (!el) return false;
    if (ultimo[id] === html && el.innerHTML) return true;
    ultimo[id] = html;
    el.innerHTML = html;
    return true;
  }
  function paginaAtiva() { return !!(doc() && doc().getElementById('asRaiz')); }
  function repintar() {
    var ctx = contexto(), m = calcular(ctx);
    pintar('asResumo', htmlResumo(m));
    pintar('asChips', htmlChips());
    pintar('asCont', htmlContador(m));
    pintar('asLista', htmlLista(m));
    var sinc = doc().getElementById('asSinc');
    if (sinc && ctx.sincronizadoEm) sinc.textContent = 'Atualizado às ' + hora(ctx.sincronizadoEm);
    var rec = doc().getElementById('asReceita');
    if (rec) rec.textContent = moeda(m.resumo.receita);
    var fn = doc().querySelector('[data-as-fn]');
    if (fn) { var nf = estado.sit !== 'todas' ? 1 : 0; fn.textContent = nf || ''; fn.hidden = !nf; }
    if (estado.detalhe) atualizarGaveta(ctx, m);
  }

  function elementoGaveta() {
    var d = doc(), el = d.getElementById('asGaveta');
    if (el) return el;
    el = d.createElement('div');
    el.id = 'asGaveta'; el.className = 'adm-dr as-dr'; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'asDrTitulo');
    d.body.appendChild(el);
    return el;
  }
  function atualizarGaveta(ctx, m) {
    var d = doc(), el = d.getElementById('asGaveta');
    if (!el || !estado.detalhe) return;
    var r = achar(m, estado.detalhe);
    if (!r) { fecharDetalhe(); return; }
    var corpo = el.querySelector('.adm-dr-corpo');
    var rolagem = corpo ? corpo.scrollTop : 0;
    var q = d.getElementById('asQtd'), u = d.getElementById('asUnid');
    var guardado = { q: q ? q.value : '', u: u ? u.value : '', foco: d.activeElement && d.activeElement.id };
    var html = detalheHTML(r, m, ctx);
    if (ultimo.asGaveta === html) return;
    ultimo.asGaveta = html;
    el.innerHTML = html;
    var c2 = el.querySelector('.adm-dr-corpo'); if (c2) c2.scrollTop = rolagem;
    var q2 = d.getElementById('asQtd'), u2 = d.getElementById('asUnid');
    if (q2 && guardado.q) q2.value = guardado.q;
    if (u2 && guardado.u) u2.value = guardado.u;
    if (guardado.foco && d.getElementById(guardado.foco)) d.getElementById(guardado.foco).focus({ preventScroll: true });
  }
  /* ---- largura ajustável do painel ---- */
  function marcarExpandir(el) {
    var b = el && el.querySelector('.as-expandir');
    if (!b) return;
    var t = estado.drMax ? 'Voltar à largura anterior' : 'Ocupar a tela toda';
    b.setAttribute('aria-pressed', String(!!estado.drMax)); b.title = t; b.setAttribute('aria-label', t);
    b.innerHTML = estado.drMax ? IC.recolher : IC.expandir;
  }
  // Põe no elemento a largura guardada (variável CSS) e o modo tela cheia; chamado ao abrir e quando a janela muda de tamanho
  function sincronizarLargura() {
    var el = doc() && doc().getElementById('asGaveta');
    if (!el) return;
    var w = limitarLargura(estado.larguraDr || LARG_PADRAO, larguraTela());
    el.style.setProperty('--as-dr-w', w + 'px');
    el.classList.toggle('is-cheia', !!estado.drMax);
    var a = el.querySelector('[data-as-alca]'); if (a) a.setAttribute('aria-valuenow', String(estado.drMax ? larguraTela() : w));
    marcarExpandir(el);
  }
  function aplicarLargura(px, persistir) {
    estado.larguraDr = limitarLargura(px, larguraTela());
    estado.drMax = false;
    sincronizarLargura();
    if (persistir) gravarPrefs();
  }
  function alternarCheia() {
    estado.drMax = !estado.drMax;
    sincronizarLargura();
  }
  function arrastarAlca(ev) {
    var d = doc(), el = d.getElementById('asGaveta');
    if (!el) return;
    ev.preventDefault();
    el.classList.add('is-arrastando');
    // O painel fica no meio e cresce dos dois lados: largura = 2 x a distância do mouse até o centro da janela, convertida para pixels do painel
    // A alça fica dentro da moldura: guarda onde o mouse a agarrou para a borda acompanhar o mouse sem dar um pulo ao começar
    var z = zoomTela(), r0 = el.getBoundingClientRect(), centro = r0.left + r0.width / 2;
    var painel = el.querySelector('.adm-dr-painel'), desvio = painel ? ev.clientX - painel.getBoundingClientRect().left : 0;
    var mover = function (e) { aplicarLargura(2 * Math.abs(centro - (e.clientX - desvio)) / z, false); };
    var fim = function () {
      d.removeEventListener('pointermove', mover); d.removeEventListener('pointerup', fim); d.removeEventListener('pointercancel', fim);
      el.classList.remove('is-arrastando'); gravarPrefs();
    };
    d.addEventListener('pointermove', mover); d.addEventListener('pointerup', fim); d.addEventListener('pointercancel', fim);
  }
  // Teclado na alça: ← alarga, → estreita (Shift = passo grande), Home = mínimo, End = máximo, Enter = tela cheia
  function teclaAlca(ev) {
    var passo = ev.shiftKey ? 128 : 32;
    var atual = estado.drMax ? larguraTela() : (estado.larguraDr || LARG_PADRAO);
    if (ev.key === 'ArrowLeft') aplicarLargura(atual + passo, true);
    else if (ev.key === 'ArrowRight') aplicarLargura(atual - passo, true);
    else if (ev.key === 'Home') aplicarLargura(LARG_MIN, true);
    else if (ev.key === 'End') aplicarLargura(larguraTela(), true);
    else if (ev.key === 'Enter' || ev.key === ' ') alternarCheia();
    else return;
    ev.preventDefault();
  }

  function abrirDetalhe(email) {
    var d = doc();
    email = String(email || '').toLowerCase();
    var ctx = contexto(), m = calcular(ctx), r = achar(m, email);
    if (!r || r.admin) return;
    var el = elementoGaveta();
    if (!estado.detalhe) estado.retorno = d.activeElement;
    estado.detalhe = email;
    delete ultimo.asGaveta;
    el.hidden = false;
    atualizarGaveta(ctx, m);
    sincronizarLargura();
    if (!el.classList.contains('is-aberta')) root.requestAnimationFrame ? root.requestAnimationFrame(function () { el.classList.add('is-aberta'); }) : el.classList.add('is-aberta');
    var f = d.getElementById('asDrFechar'); if (f) f.focus({ preventScroll: true });
    pintar('asLista', htmlLista(m));
  }
  function fecharDetalhe() {
    var d = doc(), el = d && d.getElementById('asGaveta');
    if (!estado.detalhe && !(el && !el.hidden)) return;
    estado.detalhe = null;
    estado.drMax = false; // a largura escolhida fica guardada; a tela cheia vale só enquanto o painel está aberto
    delete ultimo.asGaveta;
    if (el) { el.classList.remove('is-aberta', 'is-cheia', 'is-arrastando'); el.hidden = true; el.innerHTML = ''; }
    var volta = estado.retorno; estado.retorno = null;
    if (paginaAtiva()) repintar();
    if (volta && volta.focus && d.contains(volta)) { try { volta.focus({ preventScroll: true }); } catch (e) {} }
  }
  function vizinho(email, passo) {
    var m = calcular(contexto());
    var i = m.ordenados.findIndex(function (x) { return x.email === email; });
    var alvo = m.ordenados[i + passo];
    if (alvo) abrirDetalhe(alvo.email);
  }

  // Janela de confirmação própria (a do app só confirma ações de erro e fecha ao clicar fora). `coletar(el)` lê campos antes de a janela sair.
  function dialogo(o) {
    var d = doc();
    return new Promise(function (resolve) {
      var antigo = d.getElementById('asDialogo');
      if (antigo) antigo.remove();
      var el = d.createElement('div');
      el.id = 'asDialogo'; el.className = 'adm-dlg';
      el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-labelledby', 'asDlgT');
      el.innerHTML = '<div class="adm-dlg-fundo"></div><div class="adm-dlg-cx"><h3 id="asDlgT">' + esc(o.titulo) + '</h3><div class="adm-dlg-tx">' + (o.html || '<p>' + esc(o.texto || '') + '</p>') + '</div>' +
        '<div class="adm-dlg-bt"><button type="button" class="adm-btn" data-r="0">' + esc(o.cancelar || 'Cancelar') + '</button>' +
        '<button type="button" class="adm-btn ' + (o.perigo ? 'adm-btn-perigo-cheio' : 'adm-btn-pri') + '" data-r="1">' + esc(o.ok || 'Confirmar') + '</button></div></div>';
      var anterior = d.activeElement;
      var fim = function (v) {
        var valor = v && o.coletar ? o.coletar(el) : v;
        el.remove(); d.removeEventListener('keydown', tecla, true);
        if (anterior && anterior.focus) { try { anterior.focus(); } catch (e) {} }
        resolve(valor);
      };
      var tecla = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); fim(false); } };
      el.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-r]') : null;
        if (b) fim(b.getAttribute('data-r') === '1');
      });
      d.addEventListener('keydown', tecla, true);
      d.body.appendChild(el);
      var alvo = el.querySelector(o.foco || '[data-r="1"]');
      if (alvo) alvo.focus();
    });
  }
  function listaNomes(regs, max) {
    max = max || 8;
    var itens = regs.slice(0, max).map(function (r) { return '<li>' + esc(r.nome) + ' <small>' + esc(r.email) + '</small></li>'; }).join('');
    return '<ul class="as-dlg-lista">' + itens + (regs.length > max ? '<li>e mais ' + (regs.length - max) + '</li>' : '') + '</ul>';
  }
  function baixarArquivo(nome, texto, tipo) {
    var d = doc();
    var blob = new root.Blob(['﻿' + texto], { type: tipo || 'text/csv;charset=utf-8' });
    var url = root.URL.createObjectURL(blob);
    var a = d.createElement('a');
    a.href = url; a.download = nome; d.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { root.URL.revokeObjectURL(url); }, 1500);
  }
  function nomeArquivo() {
    var n = new Date(), p = function (x) { return String(x).padStart(2, '0'); };
    return 'assinaturas-' + n.getFullYear() + p(n.getMonth() + 1) + p(n.getDate()) + '-' + p(n.getHours()) + p(n.getMinutes()) + '.csv';
  }
  function toast(msg) { var c = contexto(); if (c.toast) c.toast(msg); }
  function selecionados() { return Object.keys(estado.sel).filter(function (e) { return estado.sel[e]; }); }

  /* ============================================================ ações ============================================================ */
  function selectMetodos(atual) {
    return '<label class="adm-sel as-dlg-campo"><span>Forma de pagamento recebida</span><select id="asDlgMetodo">' +
      opcoes([['pix', 'Pix'], ['credit_card', 'Cartão de crédito'], ['debit_card', 'Cartão de débito'], ['boleto', 'Boleto bancário']], METODOS[atual] && atual !== 'admin_cortesia' ? atual : 'pix') + '</select></label>';
  }
  async function liberarMensal(r, A, preco) {
    var pendente = r.sit === 'pendente';
    var metodo = await dialogo({
      titulo: pendente ? 'Confirmar o pagamento de ' + r.nome + '?' : 'Liberar o plano mensal para ' + r.nome + '?',
      html: '<p>' + (pendente ? 'A pessoa informou o pagamento. Ao confirmar, ' : 'Só confirme se o pagamento foi recebido. ') + 'o sistema <b>registra ' + (preco > 0 ? esc(moeda(preco)) : 'o valor do plano') + ' no livro de pagamentos</b> e deixa o acesso válido por <b>30 dias a partir da confirmação</b>.</p>' + selectMetodos(r.metodo),
      ok: pendente ? 'Confirmar pagamento' : 'Liberar mensal', foco: '#asDlgMetodo',
      coletar: function (el) { var s = el.querySelector('#asDlgMetodo'); return s ? s.value : 'pix'; }
    });
    if (!metodo) return false;
    await A.mensal(r.email, metodo);
    return true;
  }
  async function conceder(r, minutos, A) {
    if (!A.conceder) return false;
    await A.conceder(r.email, minutos);
    return true;
  }
  async function vitalicio(r, A) {
    var ok = await dialogo({ titulo: 'Conceder acesso vitalício a ' + r.nome + '?', html: '<p>A conta fica com acesso <b>sem prazo e sem cobrança</b>. Para voltar a cobrar, use “Bloquear / exigir pagamento”.</p>', ok: 'Conceder vitalício' });
    if (!ok) return false;
    await A.vitalicio(r.email);
    return true;
  }
  async function bloquear(r, A) {
    var ok = await dialogo({ titulo: 'Bloquear o acesso de ' + r.nome + '?', html: '<p>O acesso é encerrado <b>agora</b>. A pessoa só volta a usar o sistema depois de pagar de novo (ou de você liberar).</p>', ok: 'Bloquear acesso', perigo: true });
    if (!ok) return false;
    await A.bloquear(r.email);
    return true;
  }
  async function reiniciarTeste(r, A) {
    var ok = await dialogo({ titulo: 'Reiniciar o teste de ' + r.nome + '?', html: '<p>A conta ganha <b>1 dia grátis</b> a partir de agora, mesmo que o teste já tenha acabado.</p>', ok: 'Reiniciar teste' });
    if (!ok) return false;
    await A.reiniciarTeste(r.email);
    return true;
  }
  async function loteConceder(m, A) {
    var emails = selecionados();
    var alvos = alvosConceder(m.todos, emails, m.eu);
    var sel = doc().getElementById('asLoteTempo');
    var minutos = parseInt(sel ? sel.value : '0', 10);
    if (!alvos.elegiveis.length || !(minutos > 0)) return;
    var ign = textoIgnoradasConceder(alvos.ignoradas);
    var pagantes = alvos.elegiveis.filter(function (r) { return r.sit === 'paga'; }).length;
    var ok = await dialogo({
      titulo: 'Dar ' + textoMinutos(minutos) + ' a ' + plural(alvos.elegiveis.length, 'conta', 'contas') + '?',
      html: '<p>O tempo é somado, como <b>cortesia</b>, ao que cada conta ainda tem. Não entra como receita.</p>' +
        (pagantes ? '<p class="as-aviso" role="note"><b>Atenção:</b> ' + plural(pagantes, 'conta paga', 'contas pagam') + ' o mensal e ' + (pagantes === 1 ? 'passa' : 'passam') + ' a constar como cortesia (saem da receita estimada).</p>' : '') +
        listaNomes(alvos.elegiveis) +
        (ign ? '<p class="adm-nota">Ignoradas: ' + esc(ign) + '.</p>' : ''),
      ok: 'Dar tempo'
    });
    if (!ok) return;
    if (!A.concederVarios) return;
    var res = await A.concederVarios(alvos.elegiveis.map(function (r) { return r.email; }), minutos);
    if (res !== false) estado.sel = {};
  }
  async function loteMensal(m, A) {
    var alvos = alvosMensal(m.todos, selecionados(), m.eu, m.agora);
    if (!alvos.elegiveis.length || !A.mensalVarios) return;
    var ign = textoIgnoradasMensal(alvos.ignoradas);
    var metodo = await dialogo({
      titulo: 'Liberar o plano mensal para ' + plural(alvos.elegiveis.length, 'conta', 'contas') + '?',
      html: '<p>Só confirme se <b>todos os pagamentos foram recebidos</b>: cada conta ganha <b>30 dias de acesso</b>' +
        (m.preco > 0 ? ' e ' + esc(moeda(m.preco)) + ' entra no livro de pagamentos por conta' : ' e o valor entra no livro de pagamentos por conta') + '. Quem já está em dia fica de fora.</p>' +
        selectMetodos('pix') + listaNomes(alvos.elegiveis) +
        (ign ? '<p class="adm-nota">Ignoradas: ' + esc(ign) + '.</p>' : ''),
      ok: 'Liberar mensal', foco: '#asDlgMetodo',
      coletar: function (el) { var s = el.querySelector('#asDlgMetodo'); return s ? s.value : 'pix'; }
    });
    if (!metodo) return;
    var res = await A.mensalVarios(alvos.elegiveis.map(function (r) { return r.email; }), metodo);
    if (res !== false) estado.sel = {};
  }
  async function loteExpirar(m, A) {
    var alvos = Adm.alvosExpirar(m.todos, selecionados(), m.eu);
    if (!alvos.elegiveis.length) return;
    var ign = Adm.textoIgnoradas(alvos.ignoradas);
    var ok = await dialogo({
      titulo: 'Expirar a assinatura de ' + plural(alvos.elegiveis.length, 'conta', 'contas') + '?',
      html: '<p>Cada uma perde o acesso <b>agora</b> e só volta depois de um novo pagamento.</p>' + listaNomes(alvos.elegiveis) +
        (ign ? '<p class="adm-nota">Ignoradas, por não terem assinatura ativa para expirar: ' + esc(ign) + '.</p>' : ''),
      ok: 'Expirar assinaturas', perigo: true
    });
    if (!ok || !A.expirarVarios) return;
    var res = await A.expirarVarios(alvos.elegiveis.map(function (r) { return r.email; }));
    if (res !== false) estado.sel = {};
  }
  function mostrarErro(msg) {
    var e = doc().getElementById('asErro');
    if (!e) { toast(msg); return; }
    e.textContent = msg; e.hidden = !msg;
  }

  async function executar(acao, el) {
    var ctx = contexto(), A = ctx.acoes || {};
    var m = calcular(ctx);
    var email = String((el && el.getAttribute('data-email')) || '').toLowerCase();
    var r = email ? achar(m, email) : null;
    switch (acao) {
      case 'fechar': fecharDetalhe(); return;
      case 'expandir': alternarCheia(); return;
      case 'ant': vizinho(email, -1); return;
      case 'prox': vizinho(email, 1); return;
      case 'limpar': estado.busca = ''; estado.sit = 'todas'; estado.pagina = 1; var b = doc().getElementById('asBusca'); if (b) b.value = ''; repintar(); return;
      case 'sincronizar': if (A.sincronizar) await A.sincronizar(); return;
      case 'exportar': baixarArquivo(nomeArquivo(), csv(m.ordenados, m.agora)); toast('Lista exportada: ' + plural(m.ordenados.length, 'conta', 'contas') + '.'); return;
      case 'sel-filtrados': m.ordenados.forEach(function (x) { if (x.email !== m.eu) estado.sel[x.email] = true; }); repintar(); return;
      case 'lote-limpar': estado.sel = {}; repintar(); return;
      case 'lote-exportar': {
        var s = selecionados(); var regs = m.ordenados.filter(function (x) { return s.indexOf(x.email) >= 0; });
        baixarArquivo(nomeArquivo(), csv(regs, m.agora)); toast('Seleção exportada: ' + plural(regs.length, 'conta', 'contas') + '.'); return;
      }
      case 'lote-conceder': await loteConceder(m, A); repintar(); return;
      case 'lote-mensal': await loteMensal(m, A); repintar(); return;
      case 'lote-expirar': await loteExpirar(m, A); repintar(); return;
      case 'copiar':
        if (r && root.navigator && root.navigator.clipboard) root.navigator.clipboard.writeText(r.email).then(function () { toast('E-mail copiado.'); }, function () { toast('Não foi possível copiar.'); });
        return;
      default: break;
    }
    if (!r || r.admin || r.email === m.eu) return;
    if (estado.ocupado) return;
    estado.ocupado = true;
    try {
      switch (acao) {
        case 'mensal': await liberarMensal(r, A, m.preco); break;
        case 'conceder': await conceder(r, parseInt(el.getAttribute('data-min'), 10), A); break;
        case 'vitalicio': await vitalicio(r, A); break;
        case 'custom': {
          var q = doc().getElementById('asQtd'), u = doc().getElementById('asUnid');
          var v = minutosDe(q ? q.value : '', u ? u.value : '');
          if (!v.ok) { mostrarErro(v.erro); if (q) q.focus(); break; }
          mostrarErro('');
          await conceder(r, v.minutos, A);
          if (q) q.value = '';
          break;
        }
        case 'bloquear': await bloquear(r, A); break;
        case 'teste': await reiniciarTeste(r, A); break;
        case 'boleto': fecharDetalhe(); if (A.segundaVia) A.segundaVia(r); break;
        case 'cadastro': fecharDetalhe(); if (A.abrirCadastro) A.abrirCadastro(r.email); break;
        default: break;
      }
    } finally { estado.ocupado = false; }
    if (paginaAtiva()) repintar();
  }

  function ligarOuvintes() {
    if (ligado || !doc()) return;
    ligado = true;
    var d = doc();
    d.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest || !paginaAtiva()) return;
      var ac = t.closest('[data-as-a]');
      if (ac && !ac.disabled) {
        ev.preventDefault();
        var r = executar(ac.getAttribute('data-as-a'), ac);
        if (r && r.catch) r.catch(function () { estado.ocupado = false; toast('⚠️ Não foi possível concluir a ação.'); });
        return;
      }
      var kpi = t.closest('[data-as-kpi]');
      if (kpi) { var id = kpi.getAttribute('data-as-kpi'); estado.sit = estado.sit === id ? 'todas' : id; estado.pagina = 1; repintar(); return; }
      var chip = t.closest('[data-as-chip]');
      if (chip) { if (chip.getAttribute('data-as-chip') === 'busca') { estado.busca = ''; var b = d.getElementById('asBusca'); if (b) b.value = ''; } else estado.sit = 'todas'; estado.pagina = 1; repintar(); return; }
      var pg = t.closest('[data-as-pag]');
      if (pg && !pg.disabled) { estado.pagina = parseInt(pg.getAttribute('data-as-pag'), 10) || 1; repintar(); return; }
      var ab = t.closest('[data-as-abrir]');
      if (ab && !t.closest('input,select,textarea,a,label')) { abrirDetalhe(ab.getAttribute('data-as-abrir')); }
    });
    d.addEventListener('change', function (ev) {
      var t = ev.target;
      if (!t || !t.matches || !paginaAtiva()) return;
      if (t.matches('[data-as-filtro]')) { estado[t.getAttribute('data-as-filtro')] = t.value; estado.pagina = 1; repintar(); return; }
      if (t.matches('[data-as-ordem]')) { estado.ordem = t.value; estado.pagina = 1; repintar(); return; }
      if (t.matches('[data-as-pp]')) { estado.porPagina = parseInt(t.value, 10) || 25; estado.pagina = 1; gravarPrefs(); repintar(); return; }
      if (t.matches('[data-as-sel]')) {
        var e = t.getAttribute('data-as-sel');
        if (t.checked) estado.sel[e] = true; else delete estado.sel[e];
        repintar();
        var novo = d.querySelector('[data-as-sel="' + String(e).replace(/"/g, '') + '"]');
        if (novo) novo.focus({ preventScroll: true });
        return;
      }
      if (t.matches('[data-as-sel-pagina]')) {
        var m = calcular(contexto());
        m.pag.itens.forEach(function (r) { if (r.email === m.eu) return; if (t.checked) estado.sel[r.email] = true; else delete estado.sel[r.email]; });
        repintar();
      }
    });
    d.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.matches || !paginaAtiva()) return;
      if (t.matches('[data-as-busca]')) {
        clearTimeout(tempoBusca);
        tempoBusca = setTimeout(function () { estado.busca = t.value; estado.pagina = 1; repintar(); }, 140);
      }
    });
    // Alça de largura do painel: arrastar com o mouse ou o dedo; duplo clique volta ao tamanho padrão
    d.addEventListener('pointerdown', function (ev) {
      var a = ev.target && ev.target.closest && ev.target.closest('[data-as-alca]');
      if (!a || !paginaAtiva() || (ev.button != null && ev.button > 0)) return;
      arrastarAlca(ev);
    });
    d.addEventListener('dblclick', function (ev) {
      if (ev.target && ev.target.closest && ev.target.closest('[data-as-alca]') && paginaAtiva()) aplicarLargura(LARG_PADRAO, true);
    });
    root.addEventListener('resize', function () { if (estado.detalhe) sincronizarLargura(); });
    // Relógio da página: repinta os prazos ("vence em X") mesmo sem nenhuma ação, para nunca mostrar tempo velho
    if (!relTimer) relTimer = setInterval(function () { if (paginaAtiva()) repintar(); }, 60000);
    // Atalho de teclado: "/" foca a busca de qualquer lugar da aba (fora de campos de texto)
    d.addEventListener('keydown', function (ev) {
      if (ev.key !== '/' || !paginaAtiva() || d.getElementById('asDialogo')) return;
      var tag = ev.target && ev.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      var bs = d.getElementById('asBusca');
      if (bs) { ev.preventDefault(); bs.focus(); if (bs.select) bs.select(); }
    });
    d.addEventListener('keydown', function (ev) {
      if (!paginaAtiva() || !estado.detalhe || d.getElementById('asDialogo')) return;
      var tag = ev.target && ev.target.tagName;
      if (ev.key === 'Escape') { ev.preventDefault(); fecharDetalhe(); return; }
      if (ev.target && ev.target.closest && ev.target.closest('[data-as-alca]')) { teclaAlca(ev); return; }
      if ((ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        ev.preventDefault(); vizinho(estado.detalhe, ev.key === 'ArrowRight' ? 1 : -1);
      }
    });
  }

  /* ============================================================ API pública ============================================================ */
  function html(fn) {
    if (fn) ctxFn = fn;
    // O app acabou de refazer a página inteira: o que eu tinha pintado antes não vale mais (só a gaveta, que fica fora da página, continua)
    var g = ultimo.asGaveta; ultimo = {}; if (g) ultimo.asGaveta = g;
    lerPrefs();
    ligarOuvintes();
    return paginaHTML(contexto());
  }
  // Depois de cada desenho da página pelo app: mantém a gaveta em dia ou a fecha se a pessoa saiu da aba
  function aoRenderizar() {
    if (!ctxFn || !doc()) return;
    if (paginaAtiva()) { if (estado.detalhe) { var c = contexto(); atualizarGaveta(c, calcular(c)); } }
    else if (estado.detalhe) fecharDetalhe();
  }

  return {
    // modelo
    SIT: SIT, situacaoDe: situacaoDe, registro: registro, vencendo: vencendo, textoVenc: textoVenc, filtrar: filtrar, ordenar: ordenar, resumo: resumo, paginar: paginar,
    limitarLargura: limitarLargura, LARG_MIN: LARG_MIN, LARG_PADRAO: LARG_PADRAO, minutosDe: minutosDe, textoMinutos: textoMinutos, alvosConceder: alvosConceder, textoIgnoradasConceder: textoIgnoradasConceder, alvosMensal: alvosMensal, textoIgnoradasMensal: textoIgnoradasMensal, csv: csv, acaoRapida: acaoRapida, venceHoje: venceHoje,
    // telas
    paginaHTML: paginaHTML, htmlResumo: htmlResumo, htmlLista: htmlLista, htmlSelecao: htmlSelecao, htmlLinha: linhaTabela, htmlCartao: cartao, detalheHTML: detalheHTML,
    // integração com o app
    html: html, aoRenderizar: aoRenderizar, abrirDetalhe: abrirDetalhe, fecharDetalhe: fecharDetalhe, calcular: calcular, estado: estado
  };
});
