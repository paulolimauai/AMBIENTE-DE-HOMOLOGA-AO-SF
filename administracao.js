/* Nexus - Administração (perfil Administrador): menus no topo e a aba "Cadastros & Contas" reformulada.
   Mesmo padrão do dashboard-financeiro.js e do transacoes.js: este arquivo tem o MODELO puro (testado em administracao.test.js),
   o HTML e os eventos; o server.js só liga as ações do app pelo contexto (ctx) e não há nenhuma variável global do app aqui.

   ctx = função que devolve { agora, usuarios, eu:{email,nome}, uso:{email:{mov,contas,orc,metas,ultimaMov}}|null,
         contagens:{usuarios,pagamentos,logs}, eventos(email):[...], acoes:{...}, toast(msg), irPara(pagina) }

   Perfil e assinatura seguem as regras do servidor (getUserSubscriptionInfo): administrador = ilimitado; plano "vitalicio" = vitalício;
   "active" só vale com expiração futura; "pending_payment" (ou teste com protocolo NEXUS-SUB-) = aguardando pagamento;
   expirado = sem acesso até pagar; senão está no teste de 1 dia. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.NexusAdm = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var G = typeof globalThis !== 'undefined' ? globalThis : root;
  var DIA = 86400000;

  /* ============================================================ utilitários ============================================================ */
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function soDigitos(s) { return String(s == null ? '' : s).replace(/\D/g, ''); }
  function formatarCpf(v) {
    var d = soDigitos(v);
    return d.length === 11 ? d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9) : String(v == null ? '' : v);
  }
  function formatarTelefone(v) {
    var d = soDigitos(v);
    if ((d.length === 12 || d.length === 13) && d.indexOf('55') === 0) d = d.slice(2);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return String(v == null ? '' : v);
  }
  function iniciais(nome) {
    var p = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return 'US';
    return (p[0].charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase();
  }
  function paraMs(v) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    var t = Date.parse(s);
    if (isNaN(t) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) t = Date.parse(s.replace(' ', 'T') + (s.length <= 19 ? '-03:00' : ''));
    return t;
  }
  function dataBR(v, comHora) {
    var t = paraMs(v);
    if (isNaN(t)) return '—';
    var o = { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' };
    if (comHora) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return new Date(t).toLocaleString('pt-BR', o).replace(',', '');
  }
  // Nascimento fica gravado como DD/MM/AAAA (ou AAAA-MM-DD em cadastros antigos): converte sem passar por fuso horário
  function nascimentoBR(v) {
    var s = String(v == null ? '' : v).trim();
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }
  function nascimentoISO(v) {
    var s = nascimentoBR(v);
    var m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }
  function relativo(v, agora) {
    var t = paraMs(v);
    if (isNaN(t)) return 'Nunca acessou';
    var d = Math.max(0, (agora || Date.now()) - t);
    var m = Math.floor(d / 60000);
    if (m < 1) return 'agora mesmo';
    if (m < 60) return 'há ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'há ' + h + ' h';
    var dias = Math.floor(h / 24);
    if (dias === 1) return 'ontem';
    if (dias < 30) return 'há ' + dias + ' dias';
    var meses = Math.floor(dias / 30);
    if (meses < 12) return 'há ' + meses + (meses === 1 ? ' mês' : ' meses');
    var anos = Math.floor(dias / 365);
    return 'há ' + anos + (anos === 1 ? ' ano' : ' anos');
  }
  function plural(n, um, varios) { return n + ' ' + (n === 1 ? um : varios); }

  /* ============================================================ senha forte ============================================================ */
  function sorteio(n) {
    if (G.crypto && G.crypto.getRandomValues) {
      var a = new Uint32Array(1);
      G.crypto.getRandomValues(a);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }
  // Mesma regra do cadastro e da troca de senha: 8+ caracteres com maiúscula, minúscula, número e símbolo
  function senhaForte(p) {
    p = String(p == null ? '' : p);
    return p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
  }
  // Sem caracteres que se confundem (0/O, 1/l/I) para quem digita a senha a partir de uma mensagem
  function gerarSenha(tamanho) {
    var n = Math.max(10, tamanho || 14);
    var grupos = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnpqrstuvwxyz', '23456789', '!@#$%&*?'];
    var todos = grupos.join('');
    var out = grupos.map(function (g) { return g.charAt(sorteio(g.length)); });
    while (out.length < n) out.push(todos.charAt(sorteio(todos.length)));
    for (var i = out.length - 1; i > 0; i--) { var j = sorteio(i + 1); var t = out[i]; out[i] = out[j]; out[j] = t; }
    return out.join('');
  }

  /* ============================================================ modelo ============================================================ */
  // Situação da assinatura/acesso de uma conta (espelha o servidor)
  function classificarAssinatura(u, agora) {
    agora = agora || Date.now();
    var plano = String(u.subscription_plan || '').toLowerCase();
    var st = String(u.subscription_status || '').toLowerCase();
    if (u.role === 'Administrador') return { chave: 'admin', rotulo: 'Ilimitado', detalhe: 'Administrador', acesso: true, expira: null };
    if (plano === 'vitalicio') return { chave: 'vitalicio', rotulo: 'Vitalício', detalhe: 'Sem vencimento', acesso: true, expira: null };
    var exp = paraMs(u.subscription_expires_at);
    var rotuloPlano = plano === 'anual' ? 'Anual' : (plano === 'cortesia_admin' ? 'Liberado' : 'Mensal');
    if (st === 'active' && exp > agora) {
      return { chave: 'ativo', rotulo: rotuloPlano, detalhe: 'até ' + dataBR(exp), acesso: true, expira: exp, diasRestantes: Math.ceil((exp - agora) / DIA) };
    }
    var pendente = st === 'pending_payment' || (st === 'trial' && String(u.subscription_payment_id || '').indexOf('NEXUS-SUB-') === 0);
    if (pendente) return { chave: 'pendente', rotulo: 'Aguardando pagamento', detalhe: 'Pagamento informado', acesso: false, expira: null };
    if (st === 'expired' || (exp > 0 && exp <= agora)) {
      return { chave: 'expirado', rotulo: 'Expirado', detalhe: exp > 0 ? 'desde ' + dataBR(exp) : 'Exige pagamento', acesso: false, expira: exp > 0 ? exp : null };
    }
    var ini = paraMs(u.trial_started_at);
    if (!isNaN(ini) && agora - ini >= DIA) return { chave: 'teste_fim', rotulo: 'Teste encerrado', detalhe: 'Exige pagamento', acesso: false, expira: null };
    var resta = isNaN(ini) ? DIA : Math.max(0, DIA - (agora - ini));
    var horas = Math.ceil(resta / 3600000);
    return { chave: 'teste', rotulo: 'Em teste', detalhe: horas <= 1 ? 'menos de 1 h restante' : horas + ' h restantes', acesso: true, expira: null };
  }

  var ROTULO_ASSINATURA = {
    admin: 'Ilimitado (administrador)', vitalicio: 'Vitalício', ativo: 'Assinatura ativa', pendente: 'Aguardando pagamento',
    expirado: 'Expirado', teste: 'Em teste', teste_fim: 'Teste encerrado'
  };

  function normalizarUsuario(u, uso, agora) {
    agora = agora || Date.now();
    var email = String(u.email || '').toLowerCase().trim();
    var cpf = soDigitos(u.cpf);
    var tel = soDigitos(u.phone);
    var admin = u.role === 'Administrador';
    var ass = classificarAssinatura(u, agora);
    var r = {
      email: email,
      nome: String(u.name || email.split('@')[0] || 'Usuário').trim(),
      id: u.id == null ? '' : String(u.id),
      iniciais: iniciais(u.name || email),
      admin: admin,
      perfil: admin ? 'admin' : 'user',
      ativo: !(u.active === false || u.active === 0 || u.active === '0'),
      cpf: cpf,
      cpfFmt: cpf ? formatarCpf(cpf) : '',
      tel: tel,
      telFmt: tel ? formatarTelefone(tel) : '',
      nasc: nascimentoBR(u.birth_date || u.birthDate),
      disp: (u.device_type === 'Mobile' || u.device === 'Mobile') ? 'Mobile' : 'Desktop',
      criadoEm: paraMs(u.created_at),
      ultimoLogin: paraMs(u.last_login),
      termos: u.terms_accepted !== false && u.terms_accepted !== 0,
      trocarSenha: u.must_change_password === true || u.must_change_password === 1,
      metodo: String(u.subscription_method || ''),
      protocolo: String(u.subscription_payment_id || ''),
      plano: String(u.subscription_plan || ''),
      ass: ass,
      uso: uso || null
    };
    r.busca = semAcento([r.nome, r.email, r.cpf, r.tel, r.id].join(' '));
    return r;
  }

  function passa(r, f) {
    if (f.perfil && f.perfil !== 'todos' && r.perfil !== f.perfil) return false;
    if (f.status === 'ativo' && !r.ativo) return false;
    if (f.status === 'inativo' && r.ativo) return false;
    if (f.plano && f.plano !== 'todos') {
      if (f.plano === 'assinantes') { if (r.ass.chave !== 'ativo' && r.ass.chave !== 'vitalicio') return false; }
      else if (f.plano === 'sem_acesso') { if (r.ass.chave !== 'expirado' && r.ass.chave !== 'teste_fim') return false; }
      else if (r.ass.chave !== f.plano) return false;
    }
    if (f.disp && f.disp !== 'todos' && r.disp !== f.disp) return false;
    var q = semAcento(f.busca || '').trim();
    if (q) {
      // CPF/telefone digitados com pontuação ("111.222.333-44", "(31) 98888-7777") só casam pelos dígitos quando a busca é só número;
      // com letras (um e-mail como "ana.123@x") os dígitos soltos não podem casar com o CPF de outra pessoa
      var qd = /[a-z]/.test(q) ? '' : soDigitos(q);
      var achou = q.split(/\s+/).every(function (p) { return r.busca.indexOf(p) >= 0; });
      if (!achou && !(qd.length >= 3 && (r.cpf.indexOf(qd) >= 0 || r.tel.indexOf(qd) >= 0))) return false;
    }
    return true;
  }
  function filtrar(regs, f) { return regs.filter(function (r) { return passa(r, f || {}); }); }

  var COLUNAS = {
    nome: function (r) { return semAcento(r.nome); },
    email: function (r) { return r.email; },
    perfil: function (r) { return r.admin ? 0 : 1; },
    status: function (r) { return r.ativo ? 0 : 1; },
    assinatura: function (r) { return ['admin', 'vitalicio', 'ativo', 'teste', 'pendente', 'teste_fim', 'expirado'].indexOf(r.ass.chave); },
    login: function (r) { return r.ultimoLogin; },
    criado: function (r) { return r.criadoEm; },
    uso: function (r) { return r.uso ? r.uso.mov : null; }
  };
  // Datas e números vazios ficam sempre no fim, qualquer que seja o sentido da ordem
  function ordenar(regs, ordem) {
    var col = ordem && COLUNAS[ordem.col] ? ordem.col : 'nome';
    var dir = ordem && ordem.dir === 'desc' ? -1 : 1;
    var f = COLUNAS[col];
    return regs.slice().sort(function (a, b) {
      var x = f(a), y = f(b);
      var xv = x == null || (typeof x === 'number' && isNaN(x));
      var yv = y == null || (typeof y === 'number' && isNaN(y));
      if (xv && yv) return a.email < b.email ? -1 : 1;
      if (xv) return 1;
      if (yv) return -1;
      var c = typeof x === 'string' ? x.localeCompare(y, 'pt-BR') : x - y;
      if (c === 0) c = semAcento(a.nome).localeCompare(semAcento(b.nome), 'pt-BR');
      return c * dir;
    });
  }

  function paginar(lista, pagina, porPagina) {
    var pp = Math.max(1, porPagina || 25);
    var total = lista.length;
    var paginas = Math.max(1, Math.ceil(total / pp));
    var pag = Math.min(Math.max(1, pagina || 1), paginas);
    var ini = (pag - 1) * pp;
    return { itens: lista.slice(ini, ini + pp), total: total, paginas: paginas, pagina: pag, de: total ? ini + 1 : 0, ate: Math.min(total, ini + pp), porPagina: pp };
  }

  function resumo(regs) {
    var r = { total: regs.length, admins: 0, usuarios: 0, ativos: 0, bloqueados: 0, teste: 0, assinantes: 0, pendentes: 0, semAcesso: 0, hoje: 0, semCpf: 0 };
    var ini = new Date(); ini.setHours(0, 0, 0, 0);
    regs.forEach(function (x) {
      if (x.admin) r.admins++; else r.usuarios++;
      if (x.ativo) r.ativos++; else r.bloqueados++;
      var c = x.ass.chave;
      if (c === 'teste') r.teste++;
      if (c === 'ativo' || c === 'vitalicio') r.assinantes++;
      if (c === 'pendente') r.pendentes++;
      if (c === 'expirado' || c === 'teste_fim') r.semAcesso++;
      if (!isNaN(x.ultimoLogin) && x.ultimoLogin >= ini.getTime()) r.hoje++;
      if (!x.cpf) r.semCpf++;
    });
    return r;
  }

  function csvCelula(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;      // planilha não pode executar o conteúdo como fórmula
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function csv(regs) {
    var cab = ['Nome', 'E-mail', 'CPF', 'Telefone', 'Nascimento', 'Perfil', 'Conta', 'Assinatura', 'Vencimento', 'Último acesso', 'Cadastro', 'Dispositivo', 'Movimentações', 'Contas'];
    var linhas = [cab].concat(regs.map(function (r) {
      return [r.nome, r.email, r.cpfFmt, r.telFmt, r.nasc, r.admin ? 'Administrador' : 'Usuário', r.ativo ? 'Ativa' : 'Bloqueada',
        ROTULO_ASSINATURA[r.ass.chave] + (r.ass.chave === 'ativo' ? ' (' + r.ass.rotulo + ')' : ''), r.ass.expira ? dataBR(r.ass.expira) : '',
        isNaN(r.ultimoLogin) ? '' : dataBR(r.ultimoLogin, true), isNaN(r.criadoEm) ? '' : dataBR(r.criadoEm), r.disp,
        r.uso ? r.uso.mov : '', r.uso ? r.uso.contas : ''];
    }));
    return '﻿' + linhas.map(function (l) { return l.map(csvCelula).join(';'); }).join('\r\n');
  }

  /* ============================================================ estado da tela ============================================================ */
  var PREFS = 'nexus_adm_prefs';
  var estado = {
    busca: '', perfil: 'todos', status: 'todos', plano: 'todos', disp: 'todos',
    ordem: { col: 'nome', dir: 'asc' }, vista: 'tabela', porPagina: 25, pagina: 1,
    sel: {}, detalhe: null, ocupado: false
  };
  var ctxFn = null;
  var tempoBusca = null;
  var uso = { dados: null, quando: 0, carregando: false };

  function lerPrefs() {
    try {
      var p = JSON.parse(root.localStorage.getItem(PREFS) || 'null');
      if (!p) return;
      if (p.vista === 'tabela' || p.vista === 'cartoes') estado.vista = p.vista;
      if ([25, 50, 100].indexOf(p.porPagina) >= 0) estado.porPagina = p.porPagina;
      if (p.ordem && COLUNAS[p.ordem.col]) estado.ordem = { col: p.ordem.col, dir: p.ordem.dir === 'desc' ? 'desc' : 'asc' };
    } catch (e) {}
  }
  function gravarPrefs() {
    try { root.localStorage.setItem(PREFS, JSON.stringify({ vista: estado.vista, porPagina: estado.porPagina, ordem: estado.ordem })); } catch (e) {}
  }
  function limparFiltros() {
    estado.busca = ''; estado.perfil = 'todos'; estado.status = 'todos'; estado.plano = 'todos'; estado.disp = 'todos'; estado.pagina = 1;
  }
  // Limpar de propósito: o campo esvazia mesmo com o cursor nele (a sincronização normal não mexe no campo em uso)
  function limparCampoBusca() {
    var b = root.document && root.document.getElementById('admBusca');
    if (b) b.value = '';
    clearTimeout(tempoBusca);
  }
  function contarFiltros() {
    return (estado.busca ? 1 : 0) + ['perfil', 'status', 'plano', 'disp'].filter(function (k) { return estado[k] !== 'todos'; }).length;
  }

  function contexto() { return ctxFn ? ctxFn() : { usuarios: [], acoes: {} }; }

  function calcular(ctx) {
    var agora = ctx.agora || Date.now();
    var mapa = (ctx.uso || uso.dados) || null;
    var visto = {};
    var regs = [];
    // Com o mapa de uso carregado, conta sem registro de dados = nenhum uso (e não "ainda carregando")
    var SEM_USO = { mov: 0, contas: 0, orc: 0, metas: 0, ultimaMov: null };
    (ctx.usuarios || []).forEach(function (u) {
      if (!u || !u.email) return;
      var k = String(u.email).toLowerCase().trim();
      if (visto[k]) return;
      visto[k] = true;
      regs.push(normalizarUsuario(u, mapa ? (mapa[k] || SEM_USO) : null, agora));
    });
    var filtrados = filtrar(regs, estado);
    var ordenados = ordenar(filtrados, estado.ordem);
    var pag = paginar(ordenados, estado.pagina, estado.porPagina);
    estado.pagina = pag.pagina;
    return { todos: regs, filtrados: filtrados, ordenados: ordenados, pag: pag, resumo: resumo(regs), agora: agora, eu: String((ctx.eu && ctx.eu.email) || '').toLowerCase() };
  }

  /* ============================================================ ícones ============================================================ */
  function svg(d, t) {
    return '<svg width="' + (t || 16) + '" height="' + (t || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }
  var IC = {
    usuarios: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    cartao: svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><path d="M6 15h4"/>'),
    doc: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
    casa: svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
    mais: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
    busca: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
    x: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
    olho: svg('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
    lapis: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
    lixeira: svg('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
    cadeado: svg('<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
    chave: svg('<circle cx="8" cy="15" r="4"/><path d="m10.85 12.15 8.9-8.9"/><path d="m16 7 3 3"/>'),
    copiar: svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
    whats: svg('<path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5Z"/>'),
    baixar: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
    sinc: svg('<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M3 21v-5h5"/>'),
    escudo: svg('<path d="M12 3 4 6v6c0 5 3.4 8 8 9 4.6-1 8-4 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>'),
    coroa: svg('<path d="m3 8 4 4 5-7 5 7 4-4-2 11H5Z"/>'),
    relogio: svg('<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>'),
    ant: svg('<polyline points="15 18 9 12 15 6"/>'),
    prox: svg('<polyline points="9 18 15 12 9 6"/>'),
    tabela: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="9" y1="10" x2="9" y2="20"/>'),
    grade: svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
    ok: svg('<polyline points="20 6 9 17 4 12"/>'),
    bloq: svg('<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/>')
  };

  /* ============================================================ HTML: menus no topo ============================================================ */
  var ABAS = [
    { id: 'usuarios', rotulo: 'Cadastros & Contas', ic: 'usuarios' },
    { id: 'pagamentos', rotulo: 'Pagamentos & Boletos', ic: 'cartao' },
    { id: 'logs', rotulo: 'Auditoria & Logs', ic: 'doc' }
  ];
  function shellHTML(pagina, d) {
    d = d || {};
    var c = d.contagens || {};
    var eu = d.eu || {};
    var contador = function (id) {
      if (id === 'usuarios') return c.usuarios == null ? '' : '<span class="adm-tab-n">' + esc(c.usuarios) + '</span>';
      if (id === 'pagamentos') return c.pagamentos > 0 ? '<span class="adm-tab-n adm-tab-warn" title="Pagamentos aguardando ou acessos expirados">' + esc(c.pagamentos) + ' pend.</span>' : '';
      return c.logs == null ? '' : '<span class="adm-tab-n">' + esc(c.logs) + '</span>';
    };
    return '<div class="adm-shell" data-adm-pagina="' + esc(pagina) + '">' +
      '<nav class="adm-tabs" aria-label="Painel administrativo">' +
        '<div class="adm-tabs-lista" role="tablist">' + ABAS.map(function (a) {
          var on = a.id === pagina;
          return '<button type="button" role="tab" class="adm-tab' + (on ? ' is-on' : '') + '" data-adm-ir="' + a.id + '" aria-selected="' + on + '"' + (on ? ' aria-current="page"' : '') + '>' +
            IC[a.ic] + '<span class="adm-tab-t">' + esc(a.rotulo) + '</span>' + contador(a.id) + '</button>';
        }).join('') + '</div>' +
        '<div class="adm-tabs-dir">' +
          '<button type="button" class="adm-btn" data-adm-ir="dashboard" title="Voltar ao painel: aqui o administrador tem as mesmas funções do usuário comum">' + IC.casa + '<span>Painel</span></button>' +
          '<button type="button" class="adm-btn adm-btn-pri" data-adm-acao="novo" title="Cadastrar um usuário ou administrador">' + IC.mais + '<span>Novo cadastro</span></button>' +
          '<div class="adm-eu" title="' + esc(eu.email || '') + '"><span class="adm-av adm-av-admin adm-av-sm">' + esc(iniciais(eu.nome || eu.email)) + '</span>' +
            '<span class="adm-eu-t"><b>' + esc(eu.nome || 'Administrador') + '</b><small>Administrador</small></span></div>' +
        '</div>' +
      '</nav>' +
      '<div class="adm-corpo" id="admCorpo">' + (d.corpo || '') + '</div>' +
    '</div>';
  }

  /* ============================================================ HTML: Cadastros & Contas ============================================================ */
  var KPIS = [
    { id: 'todos', rotulo: 'Total de cadastros', campo: 'total', filtro: null, cor: 'neutro' },
    { id: 'admin', rotulo: 'Administradores', campo: 'admins', filtro: { perfil: 'admin' }, cor: 'ouro' },
    { id: 'ativo', rotulo: 'Contas ativas', campo: 'ativos', filtro: { status: 'ativo' }, cor: 'ok' },
    { id: 'inativo', rotulo: 'Bloqueadas', campo: 'bloqueados', filtro: { status: 'inativo' }, cor: 'ruim' },
    { id: 'assinantes', rotulo: 'Assinantes', campo: 'assinantes', filtro: { plano: 'assinantes' }, cor: 'ok' },
    { id: 'teste', rotulo: 'Em teste', campo: 'teste', filtro: { plano: 'teste' }, cor: 'aviso' },
    { id: 'pendente', rotulo: 'Aguardando pagamento', campo: 'pendentes', filtro: { plano: 'pendente' }, cor: 'info' },
    { id: 'sem_acesso', rotulo: 'Sem acesso', campo: 'semAcesso', filtro: { plano: 'sem_acesso' }, cor: 'ruim' }
  ];
  function kpiAtivo(k) {
    if (!k.filtro) return contarFiltros() === 0;
    return Object.keys(k.filtro).every(function (c) { return estado[c] === k.filtro[c]; }) && contarFiltros() === Object.keys(k.filtro).length;
  }
  function htmlResumo(m) {
    var r = m.resumo;
    return '<div class="adm-kpis" role="list">' + KPIS.map(function (k) {
      var n = r[k.campo];
      var on = kpiAtivo(k);
      return '<button type="button" role="listitem" class="adm-kpi adm-k-' + k.cor + (on ? ' is-on' : '') + '" data-adm-kpi="' + k.id + '" aria-pressed="' + on + '" title="Filtrar: ' + esc(k.rotulo) + '">' +
        '<span class="adm-kpi-n">' + n + '</span><span class="adm-kpi-t">' + esc(k.rotulo) + '</span></button>';
    }).join('') + '</div>';
  }

  var NOME_FILTRO = {
    perfil: { admin: 'Administradores', user: 'Usuários' },
    status: { ativo: 'Contas ativas', inativo: 'Contas bloqueadas' },
    plano: { admin: 'Ilimitado (administrador)', vitalicio: 'Vitalício', ativo: 'Assinatura ativa', teste: 'Em teste', teste_fim: 'Teste encerrado', pendente: 'Aguardando pagamento', expirado: 'Expirado', assinantes: 'Assinantes', sem_acesso: 'Sem acesso' },
    disp: { Desktop: 'Computador', Mobile: 'Celular' }
  };
  function htmlChips(m) {
    var chips = [];
    if (estado.busca) chips.push(['busca', 'Busca: "' + estado.busca + '"']);
    ['perfil', 'status', 'plano', 'disp'].forEach(function (k) { if (estado[k] !== 'todos') chips.push([k, NOME_FILTRO[k][estado[k]] || estado[k]]); });
    var cont = '<span class="adm-cont" aria-live="polite"><b>' + m.pag.total + '</b> de ' + m.todos.length + ' cadastro' + (m.todos.length === 1 ? '' : 's') + '</span>';
    if (!chips.length) return cont;
    return cont + chips.map(function (c) {
      return '<button type="button" class="adm-chip" data-adm-chip="' + c[0] + '" title="Remover este filtro">' + esc(c[1]) + IC.x + '</button>';
    }).join('') + '<button type="button" class="adm-link" data-adm-acao="limpar">Limpar tudo</button>';
  }

  function opcoes(lista, atual) {
    return lista.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(atual) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('');
  }
  var ORDENS = [['nome:asc', 'Nome (A a Z)'], ['nome:desc', 'Nome (Z a A)'], ['login:desc', 'Último acesso (mais recente)'], ['login:asc', 'Último acesso (mais antigo)'],
    ['criado:desc', 'Cadastro (mais recente)'], ['criado:asc', 'Cadastro (mais antigo)'], ['assinatura:asc', 'Assinatura'], ['uso:desc', 'Mais movimentações']];
  function htmlBarra() {
    return '<div class="adm-barra">' +
      '<label class="adm-busca">' + IC.busca + '<input type="search" id="admBusca" data-adm-busca autocomplete="off" spellcheck="false" placeholder="Buscar nome, e-mail, CPF…" value="' + esc(estado.busca) + '" aria-label="Buscar cadastros"><kbd title="Atalho: tecla /">/</kbd></label>' +
      '<label class="adm-sel"><span>Perfil</span><select data-adm-filtro="perfil">' + opcoes([['todos', 'Todos'], ['admin', 'Administradores'], ['user', 'Usuários']], estado.perfil) + '</select></label>' +
      '<label class="adm-sel"><span>Conta</span><select data-adm-filtro="status">' + opcoes([['todos', 'Todas'], ['ativo', 'Ativas'], ['inativo', 'Bloqueadas']], estado.status) + '</select></label>' +
      '<label class="adm-sel"><span>Assinatura</span><select data-adm-filtro="plano">' + opcoes([['todos', 'Todas'], ['assinantes', 'Assinantes (ativa + vitalícia)'], ['admin', 'Ilimitado (administrador)'], ['vitalicio', 'Vitalício'], ['ativo', 'Assinatura ativa'], ['teste', 'Em teste'], ['pendente', 'Aguardando pagamento'], ['expirado', 'Expirado'], ['teste_fim', 'Teste encerrado'], ['sem_acesso', 'Sem acesso (expirado ou teste encerrado)']], estado.plano) + '</select></label>' +
      '<label class="adm-sel"><span>Dispositivo</span><select data-adm-filtro="disp">' + opcoes([['todos', 'Todos'], ['Desktop', 'Computador'], ['Mobile', 'Celular']], estado.disp) + '</select></label>' +
      '<label class="adm-sel"><span>Ordenar por</span><select data-adm-ordem-sel>' + opcoes(ORDENS, estado.ordem.col + ':' + estado.ordem.dir) + '</select></label>' +
      '<div class="adm-vista" role="group" aria-label="Forma de exibir">' +
        '<button type="button" data-adm-vista="tabela" aria-pressed="' + (estado.vista === 'tabela') + '" title="Tabela">' + IC.tabela + '</button>' +
        '<button type="button" data-adm-vista="cartoes" aria-pressed="' + (estado.vista === 'cartoes') + '" title="Cartões">' + IC.grade + '</button></div>' +
    '</div>';
  }

  function pill(classe, texto, titulo) { return '<span class="adm-pill ' + classe + '"' + (titulo ? ' title="' + esc(titulo) + '"' : '') + '>' + esc(texto) + '</span>'; }
  var CLASSE_ASS = { admin: 'adm-p-ouro', vitalicio: 'adm-p-ok', ativo: 'adm-p-ok', pendente: 'adm-p-info', expirado: 'adm-p-ruim', teste: 'adm-p-aviso', teste_fim: 'adm-p-ruim' };
  function pillConta(r) { return r.ativo ? pill('adm-p-ok', 'Ativa') : pill('adm-p-ruim', 'Bloqueada'); }
  function pillPerfil(r) { return r.admin ? pill('adm-p-ouro', 'Administrador') : pill('adm-p-neutro', 'Usuário'); }
  function pillAssinatura(r) { return pill(CLASSE_ASS[r.ass.chave] || 'adm-p-neutro', r.ass.chave === 'ativo' ? 'Ativa · ' + r.ass.rotulo : r.ass.rotulo, ROTULO_ASSINATURA[r.ass.chave]); }
  function textoUso(r) { return r.uso ? plural(r.uso.mov, 'movimentação', 'movimentações') + ' · ' + plural(r.uso.contas, 'conta', 'contas') : '—'; }
  function textoUsoCurto(r) { return r.uso ? r.uso.mov + ' mov. · ' + plural(r.uso.contas, 'conta', 'contas') : '—'; }
  // O código (#id) é longo e só interessa na gaveta; aqui vai o essencial para reconhecer a conta mesmo com a coluna Perfil escondida
  function subTitular(r) { return (r.admin ? 'Administrador · ' : '') + (r.disp === 'Mobile' ? 'Celular' : 'Computador'); }
  function avatar(r, extra) {
    return '<span class="adm-av' + (r.admin ? ' adm-av-admin' : '') + (extra ? ' ' + extra : '') + '" aria-hidden="true">' + esc(r.iniciais) + '<i class="adm-dot' + (r.ativo ? '' : ' is-off') + '"></i></span>';
  }
  function checkbox(r, m) {
    var eu = r.email === m.eu;
    return '<input type="checkbox" class="adm-chk" data-adm-sel="' + esc(r.email) + '"' + (estado.sel[r.email] ? ' checked' : '') + (eu ? ' disabled title="Você não pode agir sobre a própria conta"' : '') + ' aria-label="Selecionar ' + esc(r.nome) + '">';
  }
  function botoesLinha(r, m) {
    var eu = r.email === m.eu;
    return '<button type="button" class="adm-ib" data-adm-abrir="' + esc(r.email) + '" title="Ver detalhes e todas as ações" aria-label="Detalhes de ' + esc(r.nome) + '">' + IC.olho + '</button>' +
      '<button type="button" class="adm-ib" data-adm-a="editar" data-email="' + esc(r.email) + '" title="Editar cadastro" aria-label="Editar ' + esc(r.nome) + '">' + IC.lapis + '</button>' +
      (eu ? '<span class="adm-pill adm-p-ouro">Você</span>' : '<button type="button" class="adm-ib" data-adm-a="espelho" data-email="' + esc(r.email) + '" title="Ver a conta como o usuário vê (modo espelho)" aria-label="Modo espelho de ' + esc(r.nome) + '">' + IC.usuarios + '</button>');
  }

  function linhaTabela(r, m) {
    return '<tr class="adm-lin' + (r.ativo ? '' : ' is-off') + (estado.sel[r.email] ? ' is-sel' : '') + (estado.detalhe === r.email ? ' is-aberto' : '') + '" data-adm-abrir="' + esc(r.email) + '">' +
      '<td class="adm-c-sel">' + checkbox(r, m) + '</td>' +
      '<td class="adm-c-tit"><div class="adm-tit">' + avatar(r) + '<div class="adm-tit-t"><b class="adm-nome" title="' + esc(r.nome) + '">' + esc(r.nome) + '</b><small>' + esc(subTitular(r)) + '</small></div></div></td>' +
      '<td class="adm-c-ct"><span class="adm-mail" title="' + esc(r.email) + '">' + esc(r.email) + '</span><small>' + (r.cpfFmt ? esc(r.cpfFmt) : 'Sem CPF') + (r.telFmt ? ' · ' + esc(r.telFmt) : '') + '</small></td>' +
      '<td class="adm-c-perf">' + pillPerfil(r) + '</td>' +
      '<td class="adm-c-conta">' + pillConta(r) + '</td>' +
      '<td class="adm-c-ass">' + pillAssinatura(r) + '<small>' + esc(r.ass.detalhe) + '</small></td>' +
      '<td class="adm-c-acc"><b>' + esc(relativo(r.ultimoLogin, m.agora)) + '</b><small>' + (isNaN(r.ultimoLogin) ? '—' : esc(dataBR(r.ultimoLogin, true))) + '</small></td>' +
      '<td class="adm-c-cad">' + esc(isNaN(r.criadoEm) ? '—' : dataBR(r.criadoEm)) + '</td>' +
      '<td class="adm-c-uso" title="' + esc(textoUso(r)) + '">' + esc(textoUsoCurto(r)) + '</td>' +
      '<td class="adm-c-acoes"><div class="adm-acoes">' + botoesLinha(r, m) + '</div></td>' +
    '</tr>';
  }
  function cabecalho(col, rotulo, classe) {
    var on = estado.ordem.col === col;
    var dir = on ? estado.ordem.dir : '';
    return '<th scope="col" class="' + classe + '"' + (on ? ' aria-sort="' + (dir === 'asc' ? 'ascending' : 'descending') + '"' : '') + '>' +
      '<button type="button" class="adm-th" data-adm-ordem="' + col + '">' + esc(rotulo) + '<i class="adm-seta' + (on ? ' is-on' : '') + '">' + (on ? (dir === 'asc' ? '▲' : '▼') : '↕') + '</i></button></th>';
  }
  function htmlTabela(m) {
    var todosNaPagina = m.pag.itens.length > 0 && m.pag.itens.every(function (r) { return r.email === m.eu || estado.sel[r.email]; });
    return '<div class="adm-tabela-wrap"><table class="adm-tabela">' +
      '<colgroup><col class="adm-c-sel"><col class="adm-c-tit"><col class="adm-c-ct"><col class="adm-c-perf"><col class="adm-c-conta"><col class="adm-c-ass"><col class="adm-c-acc"><col class="adm-c-cad"><col class="adm-c-uso"><col class="adm-c-acoes"></colgroup><thead><tr>' +
      '<th scope="col" class="adm-c-sel"><input type="checkbox" class="adm-chk" data-adm-sel-pagina ' + (todosNaPagina ? 'checked ' : '') + 'aria-label="Selecionar todos desta página"></th>' +
      cabecalho('nome', 'Titular', 'adm-c-tit') + cabecalho('email', 'Contato', 'adm-c-ct') + cabecalho('perfil', 'Perfil', 'adm-c-perf') + cabecalho('status', 'Conta', 'adm-c-conta') +
      cabecalho('assinatura', 'Assinatura', 'adm-c-ass') + cabecalho('login', 'Último acesso', 'adm-c-acc') + cabecalho('criado', 'Cadastro', 'adm-c-cad') + cabecalho('uso', 'Uso', 'adm-c-uso') +
      '<th scope="col" class="adm-c-acoes"><span class="adm-sr">Ações</span></th></tr></thead><tbody>' +
      m.pag.itens.map(function (r) { return linhaTabela(r, m); }).join('') + '</tbody></table></div>';
  }
  function cartao(r, m) {
    return '<article class="adm-card' + (r.ativo ? '' : ' is-off') + (estado.sel[r.email] ? ' is-sel' : '') + (estado.detalhe === r.email ? ' is-aberto' : '') + '" data-adm-abrir="' + esc(r.email) + '">' +
      '<header class="adm-card-cab">' + checkbox(r, m) + avatar(r) + '<div class="adm-tit-t"><b class="adm-nome" title="' + esc(r.nome) + '">' + esc(r.nome) + '</b><small>' + esc(subTitular(r)) + '</small></div></header>' +
      '<div class="adm-card-pills">' + pillPerfil(r) + pillConta(r) + pillAssinatura(r) + '</div>' +
      '<div class="adm-card-ct"><span class="adm-mail" title="' + esc(r.email) + '">' + esc(r.email) + '</span><small>' + (r.cpfFmt ? esc(r.cpfFmt) : 'Sem CPF') + (r.telFmt ? ' · ' + esc(r.telFmt) : '') + '</small></div>' +
      '<dl class="adm-card-meta"><div><dt>Último acesso</dt><dd>' + esc(relativo(r.ultimoLogin, m.agora)) + '</dd></div><div><dt>Cadastro</dt><dd>' + esc(isNaN(r.criadoEm) ? '—' : dataBR(r.criadoEm)) + '</dd></div><div><dt>Uso</dt><dd>' + esc(textoUsoCurto(r)) + '</dd></div></dl>' +
      '<footer class="adm-card-acoes">' + botoesLinha(r, m) + '</footer></article>';
  }
  function htmlCartoes(m, auto) {
    return '<div class="adm-cartoes' + (auto ? ' adm-auto' : '') + '">' + m.pag.itens.map(function (r) { return cartao(r, m); }).join('') + '</div>';
  }

  function htmlVazio(m) {
    if (!m.todos.length) {
      return '<div class="adm-vazio"><div class="adm-vazio-ic">' + IC.usuarios + '</div><h3>Nenhum cadastro ainda</h3><p>Cadastre o primeiro usuário ou administrador para começar.</p>' +
        '<button type="button" class="adm-btn adm-btn-pri" data-adm-acao="novo">' + IC.mais + '<span>Novo cadastro</span></button></div>';
    }
    return '<div class="adm-vazio"><div class="adm-vazio-ic">' + IC.busca + '</div><h3>Nenhum cadastro encontrado</h3><p>Nenhum cadastro combina com a busca e os filtros escolhidos.</p>' +
      '<button type="button" class="adm-btn" data-adm-acao="limpar">Limpar busca e filtros</button></div>';
  }

  function htmlSelecao(m) {
    var emails = Object.keys(estado.sel).filter(function (e) { return estado.sel[e]; });
    if (!emails.length) return '';
    var naoSel = m.ordenados.filter(function (r) { return r.email !== m.eu && !estado.sel[r.email]; }).length;
    return '<div class="adm-selbar" role="region" aria-label="Ações em lote"><b>' + plural(emails.length, 'selecionado', 'selecionados') + '</b>' +
      (naoSel > 0 ? '<button type="button" class="adm-link" data-adm-acao="sel-filtrados">Selecionar todos os ' + m.ordenados.filter(function (r) { return r.email !== m.eu; }).length + ' da lista</button>' : '') +
      '<span class="adm-selbar-sp"></span>' +
      '<button type="button" class="adm-btn adm-btn-sm" data-adm-acao="lote-ativar">' + IC.ok + '<span>Ativar contas</span></button>' +
      '<button type="button" class="adm-btn adm-btn-sm" data-adm-acao="lote-bloquear">' + IC.bloq + '<span>Bloquear contas</span></button>' +
      '<button type="button" class="adm-btn adm-btn-sm" data-adm-acao="lote-exportar">' + IC.baixar + '<span>Exportar seleção</span></button>' +
      '<button type="button" class="adm-btn adm-btn-sm adm-btn-perigo" data-adm-acao="lote-excluir">' + IC.lixeira + '<span>Excluir</span></button>' +
      '<button type="button" class="adm-ib" data-adm-acao="lote-limpar" title="Limpar seleção" aria-label="Limpar seleção">' + IC.x + '</button></div>';
  }

  function htmlRodape(m) {
    var p = m.pag;
    if (!p.total) return '';
    var botoes = '';
    var ini = Math.max(1, Math.min(p.pagina - 2, p.paginas - 4)), fim = Math.min(p.paginas, ini + 4);
    for (var i = ini; i <= fim; i++) botoes += '<button type="button" class="adm-pg' + (i === p.pagina ? ' is-on' : '') + '" data-adm-pag="' + i + '"' + (i === p.pagina ? ' aria-current="page"' : '') + '>' + i + '</button>';
    return '<div class="adm-rodape"><span class="adm-rodape-t">Mostrando <b>' + p.de + '–' + p.ate + '</b> de <b>' + p.total + '</b></span>' +
      '<div class="adm-pags" role="navigation" aria-label="Páginas">' +
        '<button type="button" class="adm-pg" data-adm-pag="' + (p.pagina - 1) + '"' + (p.pagina <= 1 ? ' disabled' : '') + ' aria-label="Página anterior">' + IC.ant + '</button>' + botoes +
        '<button type="button" class="adm-pg" data-adm-pag="' + (p.pagina + 1) + '"' + (p.pagina >= p.paginas ? ' disabled' : '') + ' aria-label="Próxima página">' + IC.prox + '</button></div>' +
      '<label class="adm-sel adm-sel-pp"><span>Por página</span><select data-adm-pp>' + opcoes([[25, '25'], [50, '50'], [100, '100']], estado.porPagina) + '</select></label></div>';
  }

  function htmlLista(m) {
    if (!m.pag.total) return htmlVazio(m);
    var corpo = estado.vista === 'cartoes' ? htmlCartoes(m, false) : htmlTabela(m) + htmlCartoes(m, true);
    return htmlSelecao(m) + corpo + htmlRodape(m);
  }

  function htmlCabecalhoPagina(ctx) {
    var hora = ctx.sincronizadoEm ? new Date(ctx.sincronizadoEm).toLocaleTimeString('pt-BR') : '';
    return '<header class="adm-cab"><div class="adm-cab-t"><span class="adm-cab-ic">' + IC.usuarios + '</span><div><h1>Cadastros &amp; Contas</h1>' +
      '<p>Todos os usuários do Nexus e do GLPI: acesso, assinatura e atividade em um só lugar.</p></div></div>' +
      '<div class="adm-cab-acoes">' + (hora ? '<span class="adm-sinc" id="admSinc">Atualizado às ' + esc(hora) + '</span>' : '<span class="adm-sinc" id="admSinc"></span>') +
      '<button type="button" class="adm-btn" data-adm-acao="sincronizar">' + IC.sinc + '<span>Sincronizar</span></button>' +
      '<button type="button" class="adm-btn" data-adm-acao="exportar" title="Baixar a lista filtrada em CSV (abre no Excel)">' + IC.baixar + '<span>Exportar CSV</span></button>' +
      '<button type="button" class="adm-btn adm-btn-pri" data-adm-acao="novo">' + IC.mais + '<span>Novo cadastro</span></button></div></header>';
  }

  // Cabeçalho e cartões de resumo (sem filtro) para as outras telas do painel (Pagamentos e Auditoria): mesma cara da aba de cadastros
  function cabecalhoHTML(o) {
    return '<header class="adm-cab"><div class="adm-cab-t"><span class="adm-cab-ic">' + (IC[o.icone] || IC.escudo) + '</span><div><h1>' + esc(o.titulo) + '</h1><p>' + esc(o.subtitulo) + '</p></div></div>' +
      '<div class="adm-cab-acoes">' + (o.acoes || '') + '</div></header>';
  }
  function kpisFixosHTML(lista) {
    return '<div class="adm-kpis">' + lista.map(function (k) {
      return '<div class="adm-kpi adm-kpi-fixo adm-k-' + esc(k.cor || 'neutro') + '"><span class="adm-kpi-n">' + esc(k.n) + '</span><span class="adm-kpi-t">' + esc(k.rotulo) + '</span>' + (k.sub ? '<small>' + esc(k.sub) + '</small>' : '') + '</div>';
    }).join('') + '</div>';
  }

  // Página inteira da aba (sem o menu do topo). As regiões #admResumo/#admChips/#admLista são repintadas sem refazer a barra de busca
  function cadastrosHTML(ctx) {
    var m = calcular(ctx);
    return htmlCabecalhoPagina(ctx) +
      '<section id="admResumo" aria-label="Resumo">' + htmlResumo(m) + '</section>' +
      '<section class="adm-ferr" aria-label="Busca e filtros">' + htmlBarra() + '<div class="adm-chips" id="admChips">' + htmlChips(m) + '</div></section>' +
      '<section class="adm-lista" id="admLista" aria-label="Lista de cadastros">' + htmlLista(m) + '</section>';
  }

  /* ============================================================ HTML: detalhe (gaveta) ============================================================ */
  function linhaDl(t, v, extra) { return '<div class="adm-dl-l"><dt>' + esc(t) + '</dt><dd' + (extra ? ' class="' + extra + '"' : '') + '>' + (v === '' || v == null ? '<span class="adm-nd">—</span>' : v) + '</dd></div>'; }
  function botaoAcao(a, email, ic, rotulo, dica, classe) {
    return '<button type="button" class="adm-ac ' + (classe || '') + '" data-adm-a="' + a + '" data-email="' + esc(email) + '"' + (dica ? ' title="' + esc(dica) + '"' : '') + '>' + IC[ic] + '<span>' + esc(rotulo) + '</span></button>';
  }
  function detalheHTML(r, m, ctx) {
    var eu = r.email === m.eu;
    var idx = m.ordenados.findIndex(function (x) { return x.email === r.email; });
    var eventos = (ctx.eventos ? ctx.eventos(r.email) : []) || [];
    var assinante = r.ass.chave === 'ativo' || r.ass.chave === 'vitalicio';
    var acoes = '';
    acoes += '<div class="adm-ac-grupo"><h5>Cadastro</h5><div class="adm-ac-grade">' +
      botaoAcao('editar', r.email, 'lapis', 'Editar cadastro', 'Nome, CPF, telefone, nascimento, perfil e senha') +
      botaoAcao('copiar', r.email, 'copiar', 'Copiar e-mail') +
      (r.tel ? '<a class="adm-ac" href="https://wa.me/55' + esc(r.tel) + '" target="_blank" rel="noopener noreferrer">' + IC.whats + '<span>WhatsApp</span></a>' : '') +
      '</div></div>';
    if (!eu) {
      acoes += '<div class="adm-ac-grupo"><h5>Acesso</h5><div class="adm-ac-grade">' +
        (r.ativo ? botaoAcao('bloquear', r.email, 'bloq', 'Bloquear conta', 'Impede o login até ser ativada de novo') : botaoAcao('ativar', r.email, 'ok', 'Ativar conta', 'Libera o login desta conta', 'adm-ac-ok')) +
        (r.admin ? botaoAcao('rebaixar', r.email, 'usuarios', 'Tornar usuário comum', 'Remove o acesso de administrador (Nexus e GLPI)') : botaoAcao('promover', r.email, 'coroa', 'Tornar administrador', 'Administra o Nexus e atende no GLPI')) +
        botaoAcao('senha', r.email, 'chave', 'Redefinir senha', 'Gera uma senha forte nova; as sessões abertas dessa conta caem') +
        botaoAcao('espelho', r.email, 'olho', 'Modo espelho', 'Ver o Nexus como esta pessoa vê') +
        '</div></div>';
      acoes += '<div class="adm-ac-grupo"><h5>Assinatura e pagamento</h5><div class="adm-ac-grade">' +
        (!r.admin && !assinante ? botaoAcao('pagar', r.email, 'ok', 'Liberar pagamento', 'Reconhece o pagamento e libera o acesso', 'adm-ac-ok') : '') +
        (!r.admin && assinante && r.ass.chave === 'ativo' ? botaoAcao('revogar', r.email, 'cadeado', 'Exigir pagamento', 'Bloqueia o acesso até um novo pagamento') : '') +
        (!r.admin ? botaoAcao('tempo', r.email, 'relogio', 'Liberar tempo / vitalício', 'Abre o cadastro na parte de assinatura') : '') +
        (!r.admin ? botaoAcao('boleto', r.email, 'doc', '2ª via de boleto', 'Gera a cobrança para enviar ao usuário') : '') +
        (r.admin ? '<p class="adm-nota">Administrador tem acesso ilimitado: não há assinatura nem cobrança.</p>' : '') +
        '</div></div>';
      acoes += '<div class="adm-ac-grupo adm-ac-perigo"><h5>Zona de risco</h5><div class="adm-ac-grade">' +
        botaoAcao('excluir', r.email, 'lixeira', 'Excluir conta e dados', 'Apaga o cadastro e tudo o que está ligado a ele', 'adm-ac-perigo') + '</div></div>';
    } else {
      acoes += '<p class="adm-nota">Esta é a sua conta: por segurança você não pode bloqueá-la, rebaixá-la nem excluí-la por aqui.</p>';
    }
    var ev = eventos.length
      ? '<ul class="adm-eventos">' + eventos.slice(0, 6).map(function (e) {
        return '<li><b>' + esc(e.action || 'Evento') + '</b><span>' + esc(String(e.details || '').slice(0, 140)) + '</span><small>' + esc(dataBR(e.timestamp, true)) + '</small></li>';
      }).join('') + '</ul>'
      : '<p class="adm-nd">Nenhum evento recente na trilha de auditoria.</p>';
    var u = r.uso;
    return '<div class="adm-dr-fundo" data-adm-a="fechar"></div>' +
      '<div class="adm-dr-painel" role="document">' +
      '<header class="adm-dr-cab">' +
        '<div class="adm-dr-id">' + avatar(r, 'adm-av-lg') + '<div class="adm-dr-nome"><h3 id="admDrTitulo">' + esc(r.nome) + '</h3><span class="adm-mail">' + esc(r.email) + '</span>' +
          '<div class="adm-dr-pills">' + pillPerfil(r) + pillConta(r) + pillAssinatura(r) + '</div></div></div>' +
        '<div class="adm-dr-nav">' +
          '<button type="button" class="adm-ib" data-adm-a="ant" data-email="' + esc(r.email) + '" title="Cadastro anterior da lista (←)" aria-label="Cadastro anterior"' + (idx <= 0 ? ' disabled' : '') + '>' + IC.ant + '</button>' +
          '<span class="adm-dr-pos">' + (idx >= 0 ? (idx + 1) + ' de ' + m.ordenados.length : '') + '</span>' +
          '<button type="button" class="adm-ib" data-adm-a="prox" data-email="' + esc(r.email) + '" title="Próximo cadastro da lista (→)" aria-label="Próximo cadastro"' + (idx < 0 || idx >= m.ordenados.length - 1 ? ' disabled' : '') + '>' + IC.prox + '</button>' +
          '<button type="button" class="adm-ib" data-adm-a="fechar" id="admDrFechar" title="Fechar (Esc)" aria-label="Fechar detalhes">' + IC.x + '</button></div>' +
      '</header>' +
      '<div class="adm-dr-corpo">' +
        '<section><h4>Identificação</h4><dl class="adm-dl">' + linhaDl('Nome completo', esc(r.nome)) + linhaDl('E-mail (login)', esc(r.email)) + linhaDl('CPF', esc(r.cpfFmt)) + linhaDl('Telefone', esc(r.telFmt)) +
          linhaDl('Nascimento', esc(r.nasc)) + linhaDl('Código', r.id ? '#' + esc(r.id) : '') + linhaDl('Dispositivo', r.disp === 'Mobile' ? 'Celular' : 'Computador') + linhaDl('Termos aceitos', r.termos ? 'Sim' : 'Não') + '</dl></section>' +
        '<section><h4>Acesso</h4><dl class="adm-dl">' + linhaDl('Perfil', r.admin ? 'Administrador (Nexus + GLPI)' : 'Usuário') + linhaDl('Conta', r.ativo ? 'Ativa' : 'Bloqueada') +
          linhaDl('Último acesso', isNaN(r.ultimoLogin) ? 'Nunca acessou' : esc(dataBR(r.ultimoLogin, true)) + ' (' + esc(relativo(r.ultimoLogin, m.agora)) + ')') +
          linhaDl('Cadastrado em', isNaN(r.criadoEm) ? '' : esc(dataBR(r.criadoEm, true))) + (r.trocarSenha ? linhaDl('Senha', 'Troca obrigatória no próximo acesso') : '') + '</dl></section>' +
        '<section><h4>Assinatura</h4><dl class="adm-dl">' + linhaDl('Situação', esc(ROTULO_ASSINATURA[r.ass.chave]) + (r.ass.chave === 'ativo' ? ' · ' + esc(r.ass.rotulo) : '')) + linhaDl('Detalhe', esc(r.ass.detalhe)) +
          linhaDl('Vencimento', r.ass.expira ? esc(dataBR(r.ass.expira)) : '') + linhaDl('Forma de pagamento', esc(r.metodo)) + linhaDl('Protocolo', esc(r.protocolo)) + '</dl></section>' +
        '<section><h4>Uso do sistema</h4>' + (u
          ? '<div class="adm-uso"><div><b>' + u.mov + '</b><span>movimentações</span></div><div><b>' + u.contas + '</b><span>contas e cartões</span></div><div><b>' + u.orc + '</b><span>orçamentos</span></div><div><b>' + u.metas + '</b><span>metas</span></div></div>' +
            '<p class="adm-nota">' + (u.ultimaMov ? 'Última movimentação em ' + esc(dataBR(u.ultimaMov)) + '.' : 'Ainda não há movimentações.') + '</p>'
          : '<p class="adm-nd">Carregando o uso desta conta…</p>') + '</section>' +
        '<section><h4>Ações</h4>' + acoes + '</section>' +
        '<section><h4>Eventos recentes</h4>' + ev + '</section>' +
      '</div></div>';
  }

  /* ============================================================ DOM: pintura, gaveta e janelas ============================================================ */
  var ultimo = {};
  function pintar(id, html) {
    var el = root.document && root.document.getElementById(id);
    if (!el) return false;
    if (ultimo[id] === html && el.innerHTML) return true;
    ultimo[id] = html;
    el.innerHTML = html;
    return true;
  }
  function sincronizarBarra() {
    var d = root.document;
    if (!d) return;
    var b = d.getElementById('admBusca');
    if (b && b !== d.activeElement && b.value !== estado.busca) b.value = estado.busca;
    ['perfil', 'status', 'plano', 'disp'].forEach(function (k) {
      var s = d.querySelector('[data-adm-filtro="' + k + '"]');
      if (s && s.value !== estado[k]) s.value = estado[k];
    });
    var o = d.querySelector('[data-adm-ordem-sel]');
    if (o) o.value = estado.ordem.col + ':' + estado.ordem.dir;
    d.querySelectorAll('[data-adm-vista]').forEach(function (bt) { bt.setAttribute('aria-pressed', String(bt.getAttribute('data-adm-vista') === estado.vista)); });
  }

  function limparSelecaoInvalida(m) {
    var existe = {};
    m.todos.forEach(function (r) { existe[r.email] = true; });
    Object.keys(estado.sel).forEach(function (e) { if (!existe[e] || e === m.eu) delete estado.sel[e]; });
  }

  function repintar() {
    var ctx = contexto();
    var m = calcular(ctx);
    limparSelecaoInvalida(m);
    pintar('admResumo', htmlResumo(m));
    pintar('admChips', htmlChips(m));
    pintar('admLista', htmlLista(m));
    sincronizarBarra();
    atualizarGaveta(ctx, m);
    var t = root.document && root.document.getElementById('admSinc');
    if (t && ctx.sincronizadoEm) t.textContent = 'Atualizado às ' + new Date(ctx.sincronizadoEm).toLocaleTimeString('pt-BR');
    atualizarAbas();
  }

  var gaveta = { retorno: null };
  function elementoGaveta() {
    var d = root.document;
    var el = d.getElementById('admGaveta');
    if (!el) {
      el = d.createElement('aside');
      el.id = 'admGaveta';
      el.className = 'adm-dr';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'admDrTitulo');
      el.hidden = true;
      d.body.appendChild(el);
    }
    return el;
  }
  function atualizarGaveta(ctx, m) {
    var d = root.document;
    var el = d && d.getElementById('admGaveta');
    if (!el || el.hidden || !estado.detalhe) return;
    var r = m.todos.find(function (x) { return x.email === estado.detalhe; });
    if (!r) { fecharDetalhe(); return; }
    var foco = d.activeElement && el.contains(d.activeElement) ? d.activeElement.getAttribute('data-adm-a') : null;
    var rolagem = el.querySelector('.adm-dr-corpo') ? el.querySelector('.adm-dr-corpo').scrollTop : 0;
    var html = detalheHTML(r, m, ctx);
    if (el.getAttribute('data-ultimo') !== html) {
      el.setAttribute('data-ultimo', html);
      el.innerHTML = html;
      var c = el.querySelector('.adm-dr-corpo');
      if (c) c.scrollTop = rolagem;
      if (foco) { var b = el.querySelector('[data-adm-a="' + foco + '"]'); if (b) b.focus(); }
    }
  }
  function abrirDetalhe(email) {
    var d = root.document;
    var ctx = contexto();
    estado.detalhe = String(email || '').toLowerCase();
    var el = elementoGaveta();
    if (el.hidden) { gaveta.retorno = d.activeElement; }
    el.hidden = false;
    el.removeAttribute('data-ultimo');
    d.documentElement.classList.add('adm-gaveta-aberta');
    atualizarGaveta(ctx, calcular(ctx));
    requestAnimationFrame(function () { el.classList.add('is-aberta'); var f = d.getElementById('admDrFechar'); if (f) f.focus(); });
    carregarUso(false);
    if (ctx.carregarEventos) { Promise.resolve(ctx.carregarEventos()).then(function () { repintar(); }).catch(function () {}); }
    var linhas = d.querySelectorAll('.adm-lin,.adm-card');
    linhas.forEach(function (l) { l.classList.toggle('is-aberto', l.getAttribute('data-adm-abrir') === estado.detalhe); });
  }
  function fecharDetalhe() {
    var d = root.document;
    var el = d && d.getElementById('admGaveta');
    estado.detalhe = null;
    if (!el) return;
    el.classList.remove('is-aberta');
    d.documentElement.classList.remove('adm-gaveta-aberta');
    d.querySelectorAll('.adm-lin.is-aberto,.adm-card.is-aberto').forEach(function (l) { l.classList.remove('is-aberto'); });
    setTimeout(function () { if (!estado.detalhe) { el.hidden = true; el.innerHTML = ''; el.removeAttribute('data-ultimo'); } }, 220);
    if (gaveta.retorno && gaveta.retorno.focus && d.contains(gaveta.retorno)) { try { gaveta.retorno.focus(); } catch (e) {} }
    gaveta.retorno = null;
  }

  // Janela de confirmação própria (a do app só confirma ações de erro e fecha ao clicar fora)
  function dialogo(o) {
    var d = root.document;
    return new Promise(function (resolve) {
      var antigo = d.getElementById('admDialogo');
      if (antigo) antigo.remove();
      var el = d.createElement('div');
      el.id = 'admDialogo';
      el.className = 'adm-dlg';
      el.setAttribute('role', 'alertdialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'admDlgT');
      el.innerHTML = '<div class="adm-dlg-fundo"></div><div class="adm-dlg-cx"><h3 id="admDlgT">' + esc(o.titulo) + '</h3><div class="adm-dlg-tx">' + (o.html || '<p>' + esc(o.texto || '') + '</p>') + '</div>' +
        '<div class="adm-dlg-bt">' + (o.semCancelar ? '' : '<button type="button" class="adm-btn" data-r="0">' + esc(o.cancelar || 'Cancelar') + '</button>') +
        '<button type="button" class="adm-btn ' + (o.perigo ? 'adm-btn-perigo-cheio' : 'adm-btn-pri') + '" data-r="1">' + esc(o.ok || 'Confirmar') + '</button></div></div>';
      var anterior = d.activeElement;
      var fim = function (v) { el.remove(); d.removeEventListener('keydown', tecla, true); if (anterior && anterior.focus) { try { anterior.focus(); } catch (e) {} } resolve(v); };
      var tecla = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); fim(false); } };
      el.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('[data-r]') : null;
        if (b) fim(b.getAttribute('data-r') === '1');
      });
      d.addEventListener('keydown', tecla, true);
      d.body.appendChild(el);
      var alvo = el.querySelector('[data-r="1"]');
      if (alvo) alvo.focus();
    });
  }
  function mostrarSenha(nome, senha) {
    return dialogo({
      titulo: 'Senha nova de ' + nome,
      html: '<p>Anote ou copie agora: <b>esta senha não será mostrada de novo</b>. As sessões abertas dessa conta já foram encerradas.</p>' +
        '<div class="adm-senha"><code id="admSenhaTxt">' + esc(senha) + '</code><button type="button" class="adm-btn adm-btn-sm" id="admSenhaCopiar">' + IC.copiar + '<span>Copiar</span></button></div>',
      ok: 'Entendi', semCancelar: true
    });
  }

  /* ============================================================ ações ============================================================ */
  function baixarArquivo(nome, texto, tipo) {
    var d = root.document;
    var blob = new Blob([texto], { type: tipo || 'text/csv;charset=utf-8' });
    var url = root.URL.createObjectURL(blob);
    var a = d.createElement('a');
    a.href = url; a.download = nome; d.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { root.URL.revokeObjectURL(url); }, 4000);
  }
  function nomeArquivo() {
    var h = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return 'cadastros-nexus-' + h.getFullYear() + p(h.getMonth() + 1) + p(h.getDate()) + '-' + p(h.getHours()) + p(h.getMinutes()) + '.csv';
  }
  function selecionados() { return Object.keys(estado.sel).filter(function (e) { return estado.sel[e]; }); }
  function registro(email) {
    var m = calcular(contexto());
    return { r: m.todos.find(function (x) { return x.email === email; }), m: m };
  }

  function carregarUso(forcar) {
    var ctx = contexto();
    if (!ctx.acoes || !ctx.acoes.carregarUso) return;
    if (uso.carregando) return;
    if (!forcar && uso.dados && Date.now() - uso.quando < 60000) return;
    uso.carregando = true;
    Promise.resolve(ctx.acoes.carregarUso()).then(function (dados) {
      if (dados && typeof dados === 'object') { uso.dados = dados; uso.quando = Date.now(); }
    }).catch(function () {}).then(function () { uso.carregando = false; repintar(); });
  }

  async function executar(acao, email) {
    var ctx = contexto();
    var A = ctx.acoes || {};
    var t = ctx.toast || function () {};
    var par = registro(email);
    var r = par.r;
    if (!r && email) return;               // ação sobre um cadastro que já não existe; as ações sem cadastro (novo, limpar, lote…) vêm com e-mail vazio
    var nome = r ? r.nome : email;
    var ok;
    switch (acao) {
      case 'fechar': fecharDetalhe(); return;
      case 'ant': case 'prox': {
        var i = par.m.ordenados.findIndex(function (x) { return x.email === email; });
        var alvo = par.m.ordenados[i + (acao === 'ant' ? -1 : 1)];
        if (alvo) abrirDetalhe(alvo.email);
        return;
      }
      case 'editar': case 'tempo': fecharDetalhe(); if (A.editar) A.editar(email); return;
      case 'espelho': fecharDetalhe(); if (A.espelho) A.espelho(email); return;
      case 'boleto': fecharDetalhe(); if (A.segundaVia) A.segundaVia(r); return;
      case 'copiar':
        try { await root.navigator.clipboard.writeText(email); t('E-mail copiado: ' + email); } catch (e) { t('Não foi possível copiar. Selecione o e-mail e copie com Ctrl+C.'); }
        return;
      case 'bloquear':
        if (!await dialogo({ titulo: 'Bloquear a conta de ' + nome + '?', texto: 'Essa pessoa não consegue mais entrar no Nexus nem no GLPI até você ativar a conta de novo. Os dados dela são mantidos.', ok: 'Bloquear conta', perigo: true })) return;
        if (A.alternarAtivo) await A.alternarAtivo(email);
        break;
      case 'ativar': if (A.alternarAtivo) await A.alternarAtivo(email); break;
      case 'promover':
        if (!await dialogo({ titulo: 'Tornar ' + nome + ' administrador?', texto: 'Terá acesso total: cadastros, pagamentos e auditoria do Nexus, e o atendimento de chamados no GLPI, com acesso ilimitado.', ok: 'Tornar administrador' })) return;
        if (A.mudarPerfil) await A.mudarPerfil(email, 'Administrador');
        break;
      case 'rebaixar':
        if (!await dialogo({ titulo: 'Tornar ' + nome + ' usuário comum?', texto: 'Perde o acesso ao painel administrativo do Nexus e ao atendimento do GLPI. O acesso ao próprio Nexus passa a seguir o teste ou a assinatura.', ok: 'Tornar usuário', perigo: true })) return;
        if (A.mudarPerfil) await A.mudarPerfil(email, 'Usuário');
        break;
      case 'senha': {
        if (!await dialogo({ titulo: 'Redefinir a senha de ' + nome + '?', texto: 'Uma senha forte nova será criada e mostrada uma única vez. A senha atual deixa de valer e as sessões abertas dessa conta são encerradas.', ok: 'Redefinir senha', perigo: true })) return;
        var senha = A.redefinirSenha ? await A.redefinirSenha(email) : null;
        if (senha) await mostrarSenha(nome, senha);
        break;
      }
      case 'pagar': if (A.liberarPagamento) await A.liberarPagamento(r); break;
      case 'revogar':
        if (!await dialogo({ titulo: 'Exigir novo pagamento de ' + nome + '?', texto: 'O acesso é bloqueado até um novo pagamento ser confirmado.', ok: 'Exigir pagamento', perigo: true })) return;
        if (A.bloquearPagamento) await A.bloquearPagamento(email);
        break;
      case 'excluir': fecharDetalhe(); if (A.excluir) await A.excluir(email); break;
      case 'novo': if (A.novo) A.novo(); return;
      case 'sincronizar':
        if (A.sincronizar) { await A.sincronizar(); uso.quando = 0; carregarUso(true); }
        break;
      case 'exportar': {
        var lista = calcular(ctx).ordenados;
        baixarArquivo(nomeArquivo(), csv(lista));
        t(plural(lista.length, 'cadastro exportado', 'cadastros exportados') + ' em CSV.');
        return;
      }
      case 'limpar': limparFiltros(); limparCampoBusca(); break;
      case 'sel-filtrados': par.m.ordenados.forEach(function (x) { if (x.email !== par.m.eu) estado.sel[x.email] = true; }); break;
      case 'lote-limpar': estado.sel = {}; break;
      case 'lote-exportar': {
        var sel = selecionados();
        var regs = par.m.todos.filter(function (x) { return sel.indexOf(x.email) >= 0; });
        baixarArquivo(nomeArquivo(), csv(regs));
        t(plural(regs.length, 'cadastro exportado', 'cadastros exportados') + ' em CSV.');
        return;
      }
      case 'lote-ativar': case 'lote-bloquear': {
        var emails = selecionados();
        if (!emails.length) return;
        var ativar = acao === 'lote-ativar';
        if (!ativar && !await dialogo({ titulo: 'Bloquear ' + plural(emails.length, 'conta', 'contas') + '?', texto: 'Essas pessoas não conseguem mais entrar até você ativar as contas de novo.', ok: 'Bloquear contas', perigo: true })) return;
        if (A.definirAtivos) ok = await A.definirAtivos(emails, ativar);
        estado.sel = {};
        break;
      }
      case 'lote-excluir': {
        var lista2 = selecionados();
        if (!lista2.length) return;
        if (!await dialogo({ titulo: 'Excluir ' + plural(lista2.length, 'cadastro', 'cadastros') + ' e todos os dados?', texto: 'Cadastro, finanças, transações, contas, CPF, ordens de serviço e registros ligados a eles serão apagados de vez. Esta ação não pode ser desfeita.', ok: 'Excluir definitivamente', perigo: true })) return;
        if (A.excluirVarios) await A.excluirVarios(lista2);
        estado.sel = {};
        break;
      }
      default: return;
    }
    repintar();
  }

  /* ============================================================ eventos (um só ouvinte por tipo) ============================================================ */
  var ligado = false;
  function paginaAtiva() { return !!(root.document && root.document.getElementById('admLista')); }

  function ligarOuvintes() {
    if (ligado || !root.document) return;
    ligado = true;
    var d = root.document;

    d.addEventListener('click', function (ev) {
      var alvo = ev.target;
      if (!alvo || !alvo.closest) return;
      if (alvo.closest('#admSenhaCopiar')) {
        var tx = d.getElementById('admSenhaTxt');
        try { root.navigator.clipboard.writeText(tx ? tx.textContent : ''); var b = alvo.closest('#admSenhaCopiar'); b.querySelector('span').textContent = 'Copiada'; } catch (e) {}
        return;
      }
      var ir = alvo.closest('[data-adm-ir]');
      if (ir) { var c0 = contexto(); if (c0.irPara) c0.irPara(ir.getAttribute('data-adm-ir')); return; }
      var a = alvo.closest('[data-adm-a]');
      if (a && (a.closest('#admGaveta') || a.closest('#admLista'))) {
        if (a.tagName === 'A') return;
        ev.preventDefault();
        if (a.disabled) return;
        executar(a.getAttribute('data-adm-a'), String(a.getAttribute('data-email') || '').toLowerCase());
        return;
      }
      var ac = alvo.closest('[data-adm-acao]');
      if (ac && ac.closest('.adm-shell')) { ev.preventDefault(); executar(ac.getAttribute('data-adm-acao'), ''); return; }
      if (!paginaAtiva()) return;
      var kpi = alvo.closest('[data-adm-kpi]');
      if (kpi) {
        var k = KPIS.find(function (x) { return x.id === kpi.getAttribute('data-adm-kpi'); });
        var ligadoAntes = k && kpiAtivo(k);
        limparFiltros();
        if (k && k.filtro && !ligadoAntes) Object.keys(k.filtro).forEach(function (c) { estado[c] = k.filtro[c]; });
        repintar();
        return;
      }
      var chip = alvo.closest('[data-adm-chip]');
      if (chip) { var f = chip.getAttribute('data-adm-chip'); estado[f] = f === 'busca' ? '' : 'todos'; if (f === 'busca') limparCampoBusca(); estado.pagina = 1; repintar(); return; }
      var th = alvo.closest('[data-adm-ordem]');
      if (th) {
        var col = th.getAttribute('data-adm-ordem');
        estado.ordem = estado.ordem.col === col ? { col: col, dir: estado.ordem.dir === 'asc' ? 'desc' : 'asc' } : { col: col, dir: col === 'login' || col === 'criado' || col === 'uso' ? 'desc' : 'asc' };
        estado.pagina = 1; gravarPrefs(); repintar(); return;
      }
      var vista = alvo.closest('[data-adm-vista]');
      if (vista) { estado.vista = vista.getAttribute('data-adm-vista'); gravarPrefs(); repintar(); return; }
      var pg = alvo.closest('[data-adm-pag]');
      if (pg && !pg.disabled) {
        estado.pagina = parseInt(pg.getAttribute('data-adm-pag'), 10) || 1;
        repintar();
        var atual = d.querySelector('.adm-pg.is-on');
        if (atual) atual.focus({ preventScroll: true });
        var l = d.getElementById('admLista');
        if (l && l.scrollIntoView) l.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
      }
      if (alvo.closest('[data-adm-sel],[data-adm-sel-pagina]')) return;       // a caixa de seleção cuida do próprio evento (change)
      var abrir = alvo.closest('[data-adm-abrir]');
      if (abrir) { abrirDetalhe(abrir.getAttribute('data-adm-abrir')); }
    });

    d.addEventListener('change', function (ev) {
      var alvo = ev.target;
      if (!alvo || !alvo.matches || !paginaAtiva()) return;
      if (alvo.matches('[data-adm-filtro]')) { estado[alvo.getAttribute('data-adm-filtro')] = alvo.value; estado.pagina = 1; repintar(); return; }
      if (alvo.matches('[data-adm-ordem-sel]')) { var p = alvo.value.split(':'); if (COLUNAS[p[0]]) { estado.ordem = { col: p[0], dir: p[1] === 'desc' ? 'desc' : 'asc' }; estado.pagina = 1; gravarPrefs(); repintar(); } return; }
      if (alvo.matches('[data-adm-pp]')) { estado.porPagina = parseInt(alvo.value, 10) || 25; estado.pagina = 1; gravarPrefs(); repintar(); return; }
      if (alvo.matches('[data-adm-sel]')) {
        var em = alvo.getAttribute('data-adm-sel');
        if (alvo.checked) estado.sel[em] = true; else delete estado.sel[em];
        repintar();
        var novo = d.querySelector('[data-adm-sel="' + em.replace(/"/g, '') + '"]');     // o foco do teclado volta para a mesma caixa
        if (novo) novo.focus({ preventScroll: true });
        return;
      }
      if (alvo.matches('[data-adm-sel-pagina]')) {
        var m = calcular(contexto());
        m.pag.itens.forEach(function (r) { if (r.email === m.eu) return; if (alvo.checked) estado.sel[r.email] = true; else delete estado.sel[r.email]; });
        repintar();
      }
    });

    d.addEventListener('input', function (ev) {
      var alvo = ev.target;
      if (!alvo || !alvo.matches || !alvo.matches('[data-adm-busca]')) return;
      clearTimeout(tempoBusca);
      tempoBusca = setTimeout(function () { estado.busca = alvo.value; estado.pagina = 1; repintar(); }, 140);
    });

    d.addEventListener('keydown', function (ev) {
      var alvo = ev.target;
      var digitando = alvo && alvo.matches && alvo.matches('input,textarea,select,[contenteditable="true"]');
      if (ev.key === 'Escape' && estado.detalhe && !d.getElementById('admDialogo')) { fecharDetalhe(); return; }
      if (!paginaAtiva()) return;
      if (ev.key === '/' && !digitando && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        var b = d.getElementById('admBusca');
        if (b) { ev.preventDefault(); b.focus(); b.select(); }
        return;
      }
      if (estado.detalhe && !digitando && !d.getElementById('admDialogo') && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) {
        ev.preventDefault();
        executar(ev.key === 'ArrowLeft' ? 'ant' : 'prox', estado.detalhe);
        return;
      }
      if ((ev.key === 'Enter' || ev.key === ' ') && alvo && alvo.matches && alvo.matches('tr.adm-lin,article.adm-card')) {
        ev.preventDefault();
        abrirDetalhe(alvo.getAttribute('data-adm-abrir'));
      }
    });
  }

  /* ============================================================ API pública ============================================================ */
  // Avisa o CSS do shell que as abas do topo existem (só então o menu lateral do administrador some)
  if (root.document && root.document.documentElement) root.document.documentElement.classList.add('adm-topo');

  function html(fn) {
    ctxFn = fn;
    lerPrefs();
    ligarOuvintes();
    return cadastrosHTML(contexto());
  }
  function shell(pagina, corpo, fn) {
    if (fn) ctxFn = fn;
    ligarOuvintes();
    var ctx = contexto();
    return shellHTML(pagina, { contagens: ctx.contagens, eu: ctx.eu, corpo: corpo });
  }
  // Depois de cada desenho da página pelo app: refaz a gaveta e busca o uso real (movimentações/contas) no servidor
  function aoRenderizar() {
    if (!ctxFn) return;
    if (paginaAtiva()) { carregarUso(false); if (estado.detalhe) { var c = contexto(); atualizarGaveta(c, calcular(c)); } }
    else if (estado.detalhe) fecharDetalhe();
  }
  function atualizarTudo() { if (paginaAtiva()) repintar(); else atualizarAbas(); }
  // Contadores das abas do topo (usuários, pagamentos pendentes, eventos de auditoria): valem em qualquer uma das três telas
  function atualizarAbas() {
    var d = root.document;
    if (!d || !ctxFn) return;
    var c = (contexto().contagens) || {};
    d.querySelectorAll('.adm-tab').forEach(function (tb) {
      var id = tb.getAttribute('data-adm-ir');
      var n = tb.querySelector('.adm-tab-n');
      var valor = id === 'usuarios' ? c.usuarios : id === 'logs' ? c.logs : c.pagamentos;
      var texto = id === 'pagamentos' ? (valor > 0 ? valor + ' pend.' : '') : (valor == null ? '' : String(valor));
      if (!texto) { if (n) n.remove(); return; }
      if (!n) { n = d.createElement('span'); n.className = 'adm-tab-n' + (id === 'pagamentos' ? ' adm-tab-warn' : ''); tb.appendChild(n); }
      if (n.textContent !== texto) n.textContent = texto;
    });
  }

  return {
    // modelo
    esc: esc, semAcento: semAcento, soDigitos: soDigitos, formatarCpf: formatarCpf, formatarTelefone: formatarTelefone, iniciais: iniciais,
    dataBR: dataBR, nascimentoBR: nascimentoBR, nascimentoISO: nascimentoISO, relativo: relativo,
    senhaForte: senhaForte, gerarSenha: gerarSenha,
    classificarAssinatura: classificarAssinatura, normalizarUsuario: normalizarUsuario, filtrar: filtrar, ordenar: ordenar, paginar: paginar, resumo: resumo, csv: csv,
    // telas
    shellHTML: shellHTML, cadastrosHTML: cadastrosHTML, detalheHTML: detalheHTML, cabecalhoHTML: cabecalhoHTML, kpisFixosHTML: kpisFixosHTML, htmlLinha: linhaTabela, htmlCartao: cartao, htmlResumo: htmlResumo,
    // integração com o app
    html: html, shell: shell, aoRenderizar: aoRenderizar, atualizarTudo: atualizarTudo, atualizarAbas: atualizarAbas, abrirDetalhe: abrirDetalhe, fecharDetalhe: fecharDetalhe,
    estado: estado, calcular: calcular
  };
});
