/* Menu do topo em cascata (Nexus Financeiro Hub).
 *
 * No computador (>= 861 px) o menu lateral dá lugar a uma barra logo abaixo do cabeçalho: um botão por grupo (Visão Geral, Planejamento,
 * Ferramentas, Preferências) que abre a lista de telas do grupo. A barra é só uma VISTA do menu lateral: os grupos, os rótulos, os ícones, a
 * visibilidade por perfil e a tela ativa vêm dos botões de #menu (que continuam no DOM, escondidos por CSS); clicar chama navigate(), a mesma
 * função de sempre. Assim nenhuma regra de perfil existe em dois lugares e o menu do topo nunca diverge do lateral.
 * Celular/tablet em pé (< 861 px) seguem com a barra inferior e a gaveta. A escolha "topo" x "lateral" fica em localStorage (nexus_menu_pos).
 *
 * O CSS é menu-topo.css. As funções puras (agrupar, assinatura, indiceAtivo, ...) são testadas em menu-topo.test.js sem navegador.
 */
(function (raiz) {
  'use strict';

  var CHAVE_MODO = 'nexus_menu_pos';   // 'side' = menu lateral; qualquer outro valor (ou vazio) = menu no topo

  // Cor de cada grupo (r,g,b): as mesmas do hover dos ícones do menu lateral
  var CORES = { visao: '52, 211, 153', planejamento: '56, 189, 248', ferramentas: '167, 139, 250', 'minha-conta': '244, 114, 182', liberacoes: '251, 191, 36' };
  // Uma linha de apoio para cada tela (aparece sob o nome na lista do grupo)
  var DESCRICOES = {
    dashboard: 'Resumo das suas finanças',
    transacoes: 'Receitas e despesas do período',
    cartoes: 'Limites, faturas e saldos',
    orcamentos: 'Limites mensais por categoria',
    metas: 'Objetivos e progresso',
    relatorios: 'Gráficos e análises',
    recorrentes: 'Contas e receitas que se repetem',
    importar: 'Traga o extrato do banco',
    anexos: 'Comprovantes e arquivos',
    config: 'Perfil, aparência e segurança',
    menuAdminAssinaturasBtn: 'Pagamentos e acessos'
  };

  /* ---------------------------------------------------------------------------------------------------------------------------------
   * Funções puras
   * ------------------------------------------------------------------------------------------------------------------------------- */

  // "menu-section-header menu-section-visao" -> "visao" (ignora header/title/line)
  function chaveDoGrupo(nomesDeClasse) {
    var partes = String(nomesDeClasse || '').split(/\s+/);
    for (var i = 0; i < partes.length; i++) {
      if (partes[i].indexOf('menu-section-') !== 0) continue;
      var k = partes[i].slice('menu-section-'.length);
      if (k && k !== 'header' && k !== 'title' && k !== 'line') return k;
    }
    return '';
  }

  // entradas (na ordem do menu lateral): {tipo:'titulo', chave, titulo, oculto} e {tipo:'item', pagina, id, rotulo, icone, oculto, ativo}
  // -> grupos [{chave, titulo, itens[]}], sem títulos escondidos, itens escondidos ou grupos vazios
  function agrupar(entradas) {
    var grupos = [];
    var atual = null;
    (entradas || []).forEach(function (e) {
      if (!e) return;
      if (e.tipo === 'titulo') {
        atual = e.oculto ? null : { chave: e.chave || '', titulo: String(e.titulo || '').trim(), itens: [] };
        if (atual && atual.titulo) grupos.push(atual); else atual = null;
        return;
      }
      if (e.tipo === 'item' && atual && !e.oculto && String(e.rotulo || '').trim()) atual.itens.push(e);
    });
    return grupos.filter(function (g) { return g.itens.length > 0; });
  }

  // Texto que muda só quando muda a estrutura (grupos, telas, rótulos); trocar a tela ativa NÃO muda e não reconstrói a barra
  function assinatura(grupos) {
    return (grupos || []).map(function (g) {
      return g.chave + ':' + g.titulo + '=' + g.itens.map(function (i) { return (i.pagina || i.id || '') + '|' + i.rotulo; }).join(',');
    }).join(';');
  }

  function indiceAtivo(grupos) {
    for (var g = 0; g < (grupos || []).length; g++) {
      for (var i = 0; i < grupos[g].itens.length; i++) if (grupos[g].itens[i].ativo) return g;
    }
    return -1;
  }

  function corDoGrupo(chave) { return CORES[chave] || ''; }
  function descricaoDoItem(item) { return (item && (DESCRICOES[item.pagina] || DESCRICOES[item.id])) || ''; }

  var api = { CHAVE_MODO: CHAVE_MODO, CORES: CORES, DESCRICOES: DESCRICOES, chaveDoGrupo: chaveDoGrupo, agrupar: agrupar, assinatura: assinatura, indiceAtivo: indiceAtivo, corDoGrupo: corDoGrupo, descricaoDoItem: descricaoDoItem };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined' || !raiz) return;   // Node (testes): só as funções puras

  /* ---------------------------------------------------------------------------------------------------------------------------------
   * Navegador
   * ------------------------------------------------------------------------------------------------------------------------------- */
  var doc = document;
  var html = doc.documentElement;

  // O modo vale antes da primeira pintura (este script roda no <head>): sem piscar o menu lateral antes de virar barra
  function modoTopo() {
    try { return raiz.localStorage.getItem(CHAVE_MODO) !== 'side'; } catch (e) { return true; }
  }
  html.classList.toggle('nx-menu-topo', modoTopo());

  var ICONE_CARET = '<svg class="nx-mt-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  var ICONE_LATERAL = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/></svg>';
  var ICONE_TOPO = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 10h18"/></svg>';

  function criar(tag, classe, texto) {
    var e = doc.createElement(tag);
    if (classe) e.className = classe;
    if (texto != null) e.textContent = texto;
    return e;
  }

  // Lê o menu lateral (fonte da verdade): títulos de seção e botões .menu-btn-user, na ordem
  function lerMenu() {
    var trilho = doc.getElementById('menuTrack');
    var saida = [];
    if (!trilho) return saida;
    Array.prototype.forEach.call(trilho.children, function (el) {
      if (el.classList.contains('menu-section-header')) {
        var t = el.querySelector('.menu-section-title');
        // oculto = escondido pelo JS do app (style inline); o CSS do menu recolhido também esconde os títulos e não conta
        saida.push({ tipo: 'titulo', chave: chaveDoGrupo(el.className), titulo: t ? t.textContent : '', oculto: el.style.display === 'none' });
      } else if (el.tagName === 'BUTTON' && el.classList.contains('menu-btn-user')) {
        var rot = el.querySelector('.label');
        var ic = el.querySelector('.ic svg');
        var oculto = el.style.display === 'none';
        if (!oculto) { try { oculto = raiz.getComputedStyle(el).display === 'none'; } catch (e2) { /* sem estilo: vale o inline */ } }
        saida.push({ tipo: 'item', id: el.id || '', pagina: el.getAttribute('data-page') || '', rotulo: rot ? rot.textContent.trim() : '', icone: ic ? ic.outerHTML : '', oculto: oculto, ativo: el.classList.contains('active'), el: el });
      }
    });
    return saida;
  }

  var nav, lista, dir, contaBtn, contaNome, contaPlano, contaAvatar;
  var grupos = [];
  var assin = null;
  var aberto = -1;          // índice do grupo aberto
  var modoAbertura = '';    // 'hover' (fecha ao sair) ou 'fixo' (clique/teclado: fecha fora, Esc ou ao escolher)
  var tAbrir = 0, tFechar = 0, agendado = false;
  var seq = 0;

  function escolher(entrada) {
    fechar(false);
    if (entrada.pagina && typeof raiz.navigate === 'function') raiz.navigate(entrada.pagina);
    else if (entrada.el) entrada.el.click();   // itens sem data-page (ex.: Assinaturas & Acessos) têm o próprio onclick
  }

  function botaoItem(entrada, gi, ii) {
    var b = criar('button', 'nx-mt-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('data-g', gi);
    b.setAttribute('data-i', ii);
    b._nx = entrada;
    var ic = criar('span', 'nx-mt-ic');
    ic.setAttribute('aria-hidden', 'true');
    ic.innerHTML = entrada.icone;
    var tt = criar('span', 'nx-mt-tt');
    tt.appendChild(criar('b', '', entrada.rotulo));
    var d = descricaoDoItem(entrada);
    if (d) tt.appendChild(criar('small', '', d));
    b.appendChild(ic);
    b.appendChild(tt);
    return b;
  }

  function renderizar() {
    fechar(false);
    lista.textContent = '';
    grupos.forEach(function (g, gi) {
      var wrap = criar('div', 'nx-mt-g');
      var cor = corDoGrupo(g.chave);
      if (cor) wrap.style.setProperty('--nx-g', cor);
      wrap.setAttribute('data-g', gi);
      if (g.itens.length === 1) {
        // grupo com uma tela só: vai direto, sem lista (ex.: Preferências para quem só tem Minha Conta)
        var unico = g.itens[0];
        var d = criar('button', 'nx-mt-grupo nx-mt-direto');
        d.type = 'button';
        d.setAttribute('data-g', gi);
        d.setAttribute('data-i', 0);
        d._nx = unico;
        var ic = criar('span', 'nx-mt-dic');
        ic.setAttribute('aria-hidden', 'true');
        ic.innerHTML = unico.icone;
        d.appendChild(ic);
        d.appendChild(criar('span', 'nx-mt-tx', unico.rotulo));
        wrap.appendChild(d);
      } else {
        var id = 'nxMtPainel' + (++seq);
        var bg = criar('button', 'nx-mt-grupo');
        bg.type = 'button';
        bg.setAttribute('aria-haspopup', 'menu');
        bg.setAttribute('aria-expanded', 'false');
        bg.setAttribute('aria-controls', id);
        bg.setAttribute('data-g', gi);
        bg.appendChild(criar('span', 'nx-mt-pt'));
        bg.appendChild(criar('span', 'nx-mt-tx', g.titulo));
        var caret = criar('span', 'nx-mt-cr');
        caret.setAttribute('aria-hidden', 'true');
        caret.innerHTML = ICONE_CARET;
        bg.appendChild(caret);
        var painel = criar('div', 'nx-mt-painel');
        painel.id = id;
        painel.setAttribute('role', 'menu');
        painel.setAttribute('aria-label', g.titulo);
        var caixa = criar('div', 'nx-mt-caixa');
        g.itens.forEach(function (it, ii) { caixa.appendChild(botaoItem(it, gi, ii)); });
        painel.appendChild(caixa);
        wrap.appendChild(bg);
        wrap.appendChild(painel);
        ligarHover(wrap, gi);
      }
      lista.appendChild(wrap);
    });
    marcarAtivos();
  }

  // Marca a tela ativa e o grupo dela (sem reconstruir a barra)
  function marcarAtivos() {
    var ag = indiceAtivo(grupos);
    Array.prototype.forEach.call(lista.querySelectorAll('.nx-mt-g'), function (wrap, gi) {
      var ativoNoGrupo = (gi === ag);
      wrap.classList.toggle('is-ativo', ativoNoGrupo);
      var direto = wrap.querySelector('.nx-mt-direto');
      if (direto) {
        direto._nx = grupos[gi].itens[0];
        if (ativoNoGrupo) direto.setAttribute('aria-current', 'page'); else direto.removeAttribute('aria-current');
      }
      Array.prototype.forEach.call(wrap.querySelectorAll('.nx-mt-item'), function (b) {
        var it = grupos[gi] && grupos[gi].itens[Number(b.getAttribute('data-i'))];
        if (!it) return;
        b._nx = it;
        b.classList.toggle('is-ativo', !!it.ativo);
        if (it.ativo) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
    });
  }

  function atualizar() {
    agendado = false;
    var novos = agrupar(lerMenu());
    var nova = assinatura(novos);
    grupos = novos;
    if (nova !== assin) { assin = nova; renderizar(); } else { marcarAtivos(); }
  }
  function agendarAtualizacao() {
    if (agendado) return;
    agendado = true;
    (raiz.requestAnimationFrame || raiz.setTimeout)(atualizar);
  }

  /* ---- abrir e fechar ---- */
  function wrapDe(gi) { return lista.querySelector('.nx-mt-g[data-g="' + gi + '"]'); }

  function abrir(gi, modo) {
    var wrap = wrapDe(gi);
    var botao = wrap && wrap.querySelector('.nx-mt-grupo[aria-haspopup]');
    if (!botao) return;
    raiz.clearTimeout(tAbrir); raiz.clearTimeout(tFechar);
    if (aberto >= 0 && aberto !== gi) fechar(false);
    aberto = gi;
    modoAbertura = modo || 'fixo';
    wrap.classList.add('is-aberto');
    botao.setAttribute('aria-expanded', 'true');
    // perto da borda direita a lista abre para a esquerda (medido já com o zoom do app, em px da janela)
    var painel = wrap.querySelector('.nx-mt-painel');
    painel.classList.remove('nx-mt-esq');
    var r = painel.getBoundingClientRect();
    if (r.right > (raiz.innerWidth || 0) - 12) painel.classList.add('nx-mt-esq');
  }

  function fechar(devolverFoco) {
    raiz.clearTimeout(tAbrir); raiz.clearTimeout(tFechar);
    if (aberto < 0) return;
    var wrap = wrapDe(aberto);
    aberto = -1; modoAbertura = '';
    if (!wrap) return;
    wrap.classList.remove('is-aberto');
    var botao = wrap.querySelector('.nx-mt-grupo[aria-haspopup]');
    if (botao) { botao.setAttribute('aria-expanded', 'false'); if (devolverFoco) { try { botao.focus(); } catch (e) { /* sem foco */ } } }
  }

  // Mouse: abre ao passar (rápido se já há outra aberta, como numa barra de menus) e fecha ao sair; clique "fixa" a lista aberta
  function ligarHover(wrap, gi) {
    wrap.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      raiz.clearTimeout(tFechar);
      if (aberto === gi) return;
      raiz.clearTimeout(tAbrir);
      tAbrir = raiz.setTimeout(function () { abrir(gi, 'hover'); }, aberto >= 0 ? 0 : 110);
    });
    wrap.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      raiz.clearTimeout(tAbrir);
      if (aberto === gi && modoAbertura === 'hover') {
        raiz.clearTimeout(tFechar);
        tFechar = raiz.setTimeout(function () { if (aberto === gi && modoAbertura === 'hover') fechar(false); }, 260);
      }
    });
  }

  function itensDoPainel(gi) {
    var wrap = wrapDe(gi);
    return wrap ? Array.prototype.slice.call(wrap.querySelectorAll('.nx-mt-item')) : [];
  }
  function botoesDeTopo() { return Array.prototype.slice.call(lista.querySelectorAll('.nx-mt-grupo')); }
  function foco(el) { if (el) { try { el.focus(); } catch (e) { /* sem foco */ } } }

  function aoClicar(ev) {
    var alvo = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!alvo || !nav.contains(alvo)) return;
    if (alvo.classList.contains('nx-mt-item') || alvo.classList.contains('nx-mt-direto')) { if (alvo._nx) escolher(alvo._nx); return; }
    if (alvo.classList.contains('nx-mt-grupo')) {
      var gi = Number(alvo.getAttribute('data-g'));
      if (aberto === gi) { if (modoAbertura === 'hover') modoAbertura = 'fixo'; else fechar(false); } else abrir(gi, 'fixo');
      return;
    }
    if (alvo.classList.contains('nx-mt-conta')) { if (typeof raiz.navigate === 'function') raiz.navigate('config'); return; }
    if (alvo.classList.contains('nx-mt-lateral')) aplicarModo(false);
  }

  function aoTeclar(ev) {
    var alvo = ev.target && ev.target.closest ? ev.target.closest('button') : null;
    if (!alvo || !nav.contains(alvo)) return;
    var k = ev.key;
    if (alvo.classList.contains('nx-mt-item')) {
      var gi = Number(alvo.getAttribute('data-g'));
      var itens = itensDoPainel(gi);
      var pos = itens.indexOf(alvo);
      if (k === 'ArrowDown') { ev.preventDefault(); foco(itens[(pos + 1) % itens.length]); }
      else if (k === 'ArrowUp') { ev.preventDefault(); foco(itens[(pos - 1 + itens.length) % itens.length]); }
      else if (k === 'Home') { ev.preventDefault(); foco(itens[0]); }
      else if (k === 'End') { ev.preventDefault(); foco(itens[itens.length - 1]); }
      else if (k === 'Escape') { ev.preventDefault(); fechar(true); }
      else if (k === 'ArrowLeft' || k === 'ArrowRight') {
        ev.preventDefault();
        var tops = botoesDeTopo();
        var atual = tops.indexOf(wrapDe(gi).querySelector('.nx-mt-grupo'));
        var prox = tops[(atual + (k === 'ArrowRight' ? 1 : tops.length - 1)) % tops.length];
        fechar(false);
        if (prox.hasAttribute('aria-haspopup')) { abrir(Number(prox.getAttribute('data-g')), 'fixo'); foco(itensDoPainel(Number(prox.getAttribute('data-g')))[0]); } else foco(prox);
      } else if (k === 'Tab') fechar(false);
      return;
    }
    if (alvo.classList.contains('nx-mt-grupo')) {
      var tops2 = botoesDeTopo();
      var p2 = tops2.indexOf(alvo);
      if (k === 'ArrowRight') { ev.preventDefault(); foco(tops2[(p2 + 1) % tops2.length]); }
      else if (k === 'ArrowLeft') { ev.preventDefault(); foco(tops2[(p2 - 1 + tops2.length) % tops2.length]); }
      else if (alvo.hasAttribute('aria-haspopup') && (k === 'ArrowDown' || k === 'Enter' || k === ' ')) {
        ev.preventDefault();
        var g2 = Number(alvo.getAttribute('data-g'));
        abrir(g2, 'fixo');
        foco(itensDoPainel(g2)[0]);
      } else if (k === 'Escape') fechar(true);
    }
  }

  /* ---- conta (nome, plano e foto, copiados do rodapé do menu lateral) ---- */
  function sincConta() {
    if (!contaBtn) return;
    var n = doc.getElementById('sidebarAccountName');
    var p = doc.getElementById('sidebarAccountPlan');
    var a = doc.getElementById('sidebarAccountAvatar');
    contaNome.textContent = n ? n.textContent.trim() : '';
    contaPlano.textContent = p ? p.textContent.trim() : '';
    contaPlano.hidden = !contaPlano.textContent;
    contaAvatar.innerHTML = a ? a.innerHTML : '';
    contaBtn.setAttribute('aria-label', 'Minha conta' + (contaNome.textContent ? ': ' + contaNome.textContent : ''));
  }

  /* ---- modo topo x lateral ---- */
  function botaoVoltarAoTopo() {
    var rodape = doc.querySelector('#menu .sidebar-footer');
    if (!rodape || rodape.querySelector('.nx-mt-voltar')) return;
    var b = criar('button', 'nx-mt-voltar');
    b.type = 'button';
    b.title = 'Mover o menu para o topo';
    b.setAttribute('aria-label', 'Mover o menu para o topo');
    b.innerHTML = ICONE_TOPO;
    b.addEventListener('click', function () { aplicarModo(true); });
    rodape.appendChild(b);
  }

  function aplicarModo(topo) {
    try { raiz.localStorage.setItem(CHAVE_MODO, topo ? 'top' : 'side'); } catch (e) { /* sem armazenamento: vale só nesta visita */ }
    fechar(false);
    html.classList.toggle('nx-menu-topo', !!topo);
    if (topo) agendarAtualizacao();
  }

  function iniciar() {
    var cab = doc.querySelector('.topheader');
    var trilho = doc.getElementById('menuTrack');
    if (!cab || !trilho || doc.getElementById('nxTopNav')) return;

    nav = criar('nav', 'nx-mt');
    nav.id = 'nxTopNav';
    nav.setAttribute('aria-label', 'Menu principal');
    lista = criar('div', 'nx-mt-lista');
    dir = criar('div', 'nx-mt-dir');

    contaBtn = criar('button', 'nx-mt-conta');
    contaBtn.type = 'button';
    contaBtn.title = 'Abrir Minha Conta';
    contaAvatar = criar('span', 'nx-mt-av');
    contaAvatar.setAttribute('aria-hidden', 'true');
    var copia = criar('span', 'nx-mt-cc');
    contaNome = criar('strong');
    contaPlano = criar('small');
    copia.appendChild(contaNome);
    copia.appendChild(contaPlano);
    contaBtn.appendChild(contaAvatar);
    contaBtn.appendChild(copia);

    var lateral = criar('button', 'nx-mt-lateral');
    lateral.type = 'button';
    lateral.title = 'Usar o menu lateral';
    lateral.setAttribute('aria-label', 'Usar o menu lateral');
    lateral.innerHTML = ICONE_LATERAL;

    dir.appendChild(contaBtn);
    dir.appendChild(lateral);
    nav.appendChild(lista);
    nav.appendChild(dir);
    cab.insertAdjacentElement('afterend', nav);

    nav.addEventListener('click', aoClicar);
    nav.addEventListener('keydown', aoTeclar);
    doc.addEventListener('pointerdown', function (ev) { if (aberto >= 0 && !nav.contains(ev.target)) fechar(false); });
    doc.addEventListener('focusin', function (ev) { if (aberto >= 0 && !nav.contains(ev.target)) fechar(false); });
    raiz.addEventListener('resize', function () { fechar(false); });

    if (typeof raiz.MutationObserver === 'function') {
      new raiz.MutationObserver(agendarAtualizacao).observe(trilho, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
      var rodapeConta = doc.querySelector('#menu .sidebar-account-footer');
      if (rodapeConta) new raiz.MutationObserver(sincConta).observe(rodapeConta, { subtree: true, childList: true, characterData: true });
    }
    botaoVoltarAoTopo();
    atualizar();
    sincConta();
  }

  raiz.NexusMenuTopo = { atualizar: atualizar, aplicarModo: aplicarModo, abrir: abrir, fechar: fechar, estado: function () { return { grupos: grupos, aberto: aberto, topo: html.classList.contains('nx-menu-topo') }; } };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})(typeof window !== 'undefined' ? window : null);
