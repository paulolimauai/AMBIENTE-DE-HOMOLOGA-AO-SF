/* Sessão única do Nexus: site principal (/login.html), Nexus Financeiro (/), GLPI (/glpi.html) e
   área do administrador (/admin-site.html, /admin-assinaturas-glpi.html).

   O login oficial é /login.html. Quem chega a uma tela do administrador sem sessão válida é levado até
   lá com ?next=<tela de origem> e volta para ela depois de entrar; não existe mais formulário de login
   dentro da área do administrador. Quem entra com conta que não é administradora vê "Acesso restrito".

   A sessão é a mesma das outras telas: token em localStorage (nexus_token), usuário em nexus_cached_user,
   marca da aba em sessionStorage (nexus_session_active). O servidor é quem decide se a conta é
   administradora (GET /api/auth/session); o navegador não decide nada sozinho. */
(function (w) {
  'use strict';

  var CHAVES_LOCAIS = ['nexus_session', 'nexus_cached_user', 'nexus_token', 'nexus_auth_token',
    'nexus_viewing_user', 'nexus_login_v5', 'glpi_10_session'];
  var CHAVES_ABA = ['nexus_session_active', 'nexus_last_activity', 'nexus_session_expired_reason'];
  var observando = false;
  var acompanhando = false;

  function lerLocal(chave) {
    try { return w.localStorage.getItem(chave) || ''; } catch (e) { return ''; }
  }

  function token() {
    return lerLocal('nexus_token') || lerLocal('nexus_auth_token');
  }

  function usuario() {
    try {
      var u = JSON.parse(lerLocal('nexus_cached_user') || 'null');
      return u && u.email ? u : null;
    } catch (e) { return null; }
  }

  function destinoAtual() {
    return w.location.pathname + w.location.search + w.location.hash;
  }

  /* Endereços curtos: o painel do administrador vira /login.html?next=admin (o login entende o mesmo apelido) */
  var ATALHOS = { '/admin-assinaturas-glpi': 'admin', '/admin-assinaturas-glpi.html': 'admin' };

  function urlLogin(destino) {
    if (!destino) return '/login.html';
    return '/login.html?next=' + (ATALHOS[destino] || encodeURIComponent(destino));
  }

  /* destino: texto = volta para essa tela depois do login; null/'' = login simples; omitido = a tela atual */
  function irParaLogin(destino) {
    w.location.replace(urlLogin(destino === undefined ? destinoAtual() : destino));
  }

  function limparSessao() {
    CHAVES_LOCAIS.forEach(function (k) { try { w.localStorage.removeItem(k); } catch (e) {} });
    CHAVES_ABA.forEach(function (k) { try { w.sessionStorage.removeItem(k); } catch (e) {} });
  }

  /* Faz desta aba uma sessão do Nexus de verdade: o app em "/" só aceita o login guardado quando a aba
     tem esta marca; sem ela, "Voltar ao Nexus" cairia na tela de login. */
  function marcarAbaAtiva() {
    try {
      w.sessionStorage.setItem('nexus_session_active', 'true');
      w.sessionStorage.setItem('nexus_last_activity', String(Date.now()));
      w.sessionStorage.removeItem('nexus_session_expired_reason');
    } catch (e) {}
  }

  /* O app em "/" encerra a sessão depois de 2 h sem atividade; quem trabalha só na administração não pode
     voltar ao Nexus e encontrar a sessão vencida. */
  function acompanharAtividade() {
    if (acompanhando) return;
    acompanhando = true;
    var ultimo = 0;
    function tocar() {
      var agora = Date.now();
      if (agora - ultimo < 30000) return;
      ultimo = agora;
      try {
        if (w.sessionStorage.getItem('nexus_session_active') === 'true') {
          w.sessionStorage.setItem('nexus_last_activity', String(agora));
        }
      } catch (e) {}
    }
    ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(function (nome) {
      w.addEventListener(nome, tocar, { passive: true, capture: true });
    });
    w.document.addEventListener('visibilitychange', function () { if (!w.document.hidden) tocar(); });
  }

  /* Se outra aba sair (ou o login for apagado), esta também volta ao login e depois retorna para cá. */
  function observarSaida() {
    if (observando) return;
    observando = true;
    w.addEventListener('storage', function (ev) {
      if (ev.storageArea !== w.localStorage) return;
      if (ev.key === null || (ev.key === 'nexus_token' && !ev.newValue)) irParaLogin();
    });
  }

  function consultarSessao() {
    return w.fetch('/api/auth/session', {
      headers: { 'Authorization': 'Bearer ' + token() },
      cache: 'no-store'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { status: r.status, dados: d };
      });
    });
  }

  /* Pergunta ao servidor quem é a conta da sessão atual.
     estado: 'admin' | 'usuario' (conta comum) | 'sem-sessao' (token ausente, vencido ou conta bloqueada) | 'erro' (sem rede) */
  function verificar() {
    if (!token()) return Promise.resolve({ estado: 'sem-sessao' });
    return consultarSessao().then(function (r) {
      /* um 401 isolado (servidor reiniciando) não derruba a sessão: confirma uma segunda vez */
      if (r.status !== 401) return r;
      return new Promise(function (ok) { setTimeout(ok, 1200); }).then(consultarSessao);
    }).then(function (r) {
      var u = r.dados && r.dados.user;
      if (r.status === 200 && r.dados && r.dados.success && u) {
        return { estado: u.isAdmin ? 'admin' : 'usuario', user: u };
      }
      return { estado: r.status === 401 ? 'sem-sessao' : 'erro' };
    }, function () { return { estado: 'erro' }; });
  }

  /* Porteiro das telas do administrador.
     ret: { admin(user), naoAdmin(user), erro() }. Sem sessão válida vai para o login oficial e volta para esta tela. */
  function exigirAdmin(ret) {
    ret = ret || {};
    verificar().then(function (r) {
      if (r.estado === 'sem-sessao') { irParaLogin(); return; }
      if (r.estado === 'erro') { if (ret.erro) ret.erro(); return; }
      if (r.estado === 'usuario') { if (ret.naoAdmin) ret.naoAdmin(r.user); return; }
      marcarAbaAtiva();
      acompanharAtividade();
      observarSaida();
      if (ret.admin) ret.admin(r.user);
    });
  }

  /* Sair de tudo: Nexus, GLPI e administração usam o mesmo login. */
  function sair(depois) {
    limparSessao();
    w.location.replace(urlLogin(depois));
  }

  w.NexusSSO = {
    token: token,
    usuario: usuario,
    urlLogin: urlLogin,
    irParaLogin: irParaLogin,
    limparSessao: limparSessao,
    marcarAbaAtiva: marcarAbaAtiva,
    verificar: verificar,
    exigirAdmin: exigirAdmin,
    sair: sair
  };
})(window);
