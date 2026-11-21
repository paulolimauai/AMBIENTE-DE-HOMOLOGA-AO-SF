'use strict';
// Menu do topo em cascata: funções puras do menu-topo.js (sem navegador) e conferências do CSS e do registro no server.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const M = require('./menu-topo');

const lerArquivo = (n) => fs.readFileSync(path.join(__dirname, n), 'utf8');
const t = (chave, titulo, oculto) => ({ tipo: 'titulo', chave, titulo, oculto: !!oculto });
const i = (pagina, rotulo, extra) => Object.assign({ tipo: 'item', pagina, id: '', rotulo, icone: '<svg></svg>', oculto: false, ativo: false }, extra || {});

test('carregar o módulo no Node não toca no DOM (só expõe as funções puras)', () => {
  assert.equal(typeof M.agrupar, 'function');
  assert.equal(typeof M.assinatura, 'function');
  assert.equal(typeof M.indiceAtivo, 'function');
  assert.equal(M.CHAVE_MODO, 'nexus_menu_pos');
});

test('chaveDoGrupo: pega a seção e ignora header/title/line', () => {
  assert.equal(M.chaveDoGrupo('menu-section-header menu-section-visao'), 'visao');
  assert.equal(M.chaveDoGrupo('menu-section-header menu-section-minha-conta'), 'minha-conta');
  assert.equal(M.chaveDoGrupo('menu-section-header'), '');
  assert.equal(M.chaveDoGrupo('menu-section-title'), '');
  assert.equal(M.chaveDoGrupo(''), '');
  assert.equal(M.chaveDoGrupo(undefined), '');
});

test('agrupar: itens ficam no grupo do título anterior, na ordem do menu lateral', () => {
  const g = M.agrupar([
    t('visao', 'Visão Geral'), i('dashboard', 'Dashboard Financeiro'), i('transacoes', 'Transações'), i('cartoes', 'Contas e Cartões'),
    t('planejamento', 'Planejamento'), i('orcamentos', 'Orçamentos'), i('metas', 'Metas')
  ]);
  assert.deepEqual(g.map((x) => x.titulo), ['Visão Geral', 'Planejamento']);
  assert.deepEqual(g[0].itens.map((x) => x.pagina), ['dashboard', 'transacoes', 'cartoes']);
  assert.deepEqual(g[1].itens.map((x) => x.pagina), ['orcamentos', 'metas']);
});

test('agrupar: título escondido pelo app derruba o grupo; item escondido some; grupo vazio some', () => {
  const g = M.agrupar([
    t('visao', 'Visão Geral'), i('dashboard', 'Dashboard'), i('transacoes', 'Transações', { oculto: true }),
    t('liberacoes', 'Liberações', true), i('liberacoesBtn', 'Liberações do admin'),            // seção escondida: o item dela NÃO vaza para o grupo anterior
    t('ferramentas', 'Ferramentas'), i('recorrentes', 'Despesas Fixas', { oculto: true }),    // todos os itens escondidos: grupo vazio
    t('minha-conta', 'Preferências'), i('config', 'Minha Conta')
  ]);
  assert.deepEqual(g.map((x) => x.titulo), ['Visão Geral', 'Preferências']);
  assert.deepEqual(g[0].itens.map((x) => x.pagina), ['dashboard']);
  assert.ok(!JSON.stringify(g).includes('liberacoesBtn'));
});

test('agrupar: item sem rótulo, antes de qualquer título ou entrada inválida é ignorado', () => {
  const g = M.agrupar([i('solto', 'Solto'), null, undefined, t('visao', 'Visão Geral'), i('x', '   '), i('dashboard', 'Dashboard'), t('vazio', '  ')]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].itens.map((x) => x.pagina), ['dashboard']);
  assert.deepEqual(M.agrupar(undefined), []);
});

test('assinatura: muda quando muda a estrutura, não muda quando só a tela ativa muda', () => {
  const base = () => [t('visao', 'Visão Geral'), i('dashboard', 'Dashboard'), i('transacoes', 'Transações'), t('minha-conta', 'Preferências'), i('config', 'Minha Conta')];
  const a = M.assinatura(M.agrupar(base()));
  const b = base(); b[1].ativo = true;
  assert.equal(M.assinatura(M.agrupar(b)), a, 'trocar a tela ativa não reconstrói a barra');
  const c = base(); c[2].oculto = true;
  assert.notEqual(M.assinatura(M.agrupar(c)), a, 'esconder uma tela reconstrói');
  const d = base(); d[2].rotulo = 'Extrato';
  assert.notEqual(M.assinatura(M.agrupar(d)), a, 'mudar um rótulo reconstrói');
});

test('indiceAtivo: grupo da tela ativa, ou -1', () => {
  const g = M.agrupar([t('visao', 'A'), i('a', 'a'), t('plan', 'B'), i('b', 'b', { ativo: true })]);
  assert.equal(M.indiceAtivo(g), 1);
  assert.equal(M.indiceAtivo(M.agrupar([t('visao', 'A'), i('a', 'a')])), -1);
  assert.equal(M.indiceAtivo(undefined), -1);
});

test('toda tela do menu lateral tem uma linha de apoio e os grupos do usuário têm cor', () => {
  const fonte = lerArquivo('server.js');
  const ini = fonte.indexOf('<aside class="menu sidebar-menu" id="menu">');
  const fim = fonte.indexOf('</aside>', ini);
  assert.ok(ini > 0 && fim > ini, 'menu lateral não encontrado no server.js');
  const menu = fonte.slice(ini, fim);
  const paginas = [...menu.matchAll(/<button data-page="([a-z]+)" class="menu-btn-user"/g)].map((m) => m[1]);
  assert.ok(paginas.length >= 10, 'esperava as 10 telas do usuário, achei ' + paginas.length);
  for (const p of paginas) assert.ok(M.descricaoDoItem({ pagina: p }), 'sem descrição para ' + p);
  assert.ok(M.descricaoDoItem({ id: 'menuAdminAssinaturasBtn' }));
  for (const k of ['visao', 'planejamento', 'ferramentas', 'minha-conta']) assert.match(M.corDoGrupo(k), /^\d+, \d+, \d+$/);
  assert.equal(M.corDoGrupo('qualquer-outro'), '', 'grupo sem cor cai na cor da paleta (var(--nx-sh-acc))');
});

test('o menu lateral ainda é a fonte: título de seção e itens com as classes que o menu-topo.js lê', () => {
  const fonte = lerArquivo('server.js');
  for (const k of ['menu-section-visao', 'menu-section-planejamento', 'menu-section-ferramentas', 'menu-section-minha-conta']) assert.ok(fonte.includes(k), k);
  assert.ok(fonte.includes('id="menuTrack"') && fonte.includes('class="menu-section-title"') && fonte.includes('id="sidebarAccountName"') && fonte.includes('id="sidebarAccountPlan"') && fonte.includes('id="sidebarAccountAvatar"'));
});

test('server.js serve menu-topo.css e menu-topo.js e os carrega no <head> (CSS logo depois do nexus-shell.css)', () => {
  const fonte = lerArquivo('server.js');
  assert.match(fonte, /'\/menu-topo\.css': 'text\/css'/);
  assert.match(fonte, /'\/menu-topo\.js': 'application\/javascript; charset=utf-8'/);
  const a = fonte.indexOf('<link rel="stylesheet" href="/nexus-shell.css?v=${ASSETS_V}" />');
  const b = fonte.indexOf('<link rel="stylesheet" href="/menu-topo.css?v=${ASSETS_V}" />');
  const c = fonte.indexOf('<script src="/menu-topo.js?v=${ASSETS_V}"></script>');
  const d = fonte.indexOf('<link rel="stylesheet" href="/frontend-polish.css?v=${ASSETS_V}" />');
  assert.ok(a > 0 && b > a && c > b && d > c, 'ordem esperada: nexus-shell.css, menu-topo.css, menu-topo.js, frontend-polish.css');
});

test('CSS: mesma camada do nexus-shell, só no computador, fonte >= 14px e conteúdo na largura toda', () => {
  const css = lerArquivo('menu-topo.css');
  assert.match(css, /@layer nx-shell \{/);
  assert.match(css, /@media \(min-width: 861px\)/);
  assert.match(css, /#nxTopNav \{ display: none !important; \}/, 'sem a classe nx-menu-topo (ou no celular) a barra não aparece');
  const tamanhos = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
  assert.ok(tamanhos.length > 5 && tamanhos.every((n) => n >= 14), 'fonte menor que 14px: ' + tamanhos.join(','));
  // o conteúdo precisa vencer a regra do frontend-polish.css (mesma camada, carregada depois): margin-left 0 com especificidade alta
  assert.match(css, /main\.main \{[^}]*margin-left: 0 !important;[^}]*width: 100% !important;[^}]*margin-top: 126px !important;/);
  assert.match(css, /html\.user-logged-in\.nx-menu-topo #menu \{ display: none !important; \}/);
  // o cabeçalho continua limpo (AGENTS.md seção 6): a barra é um elemento à parte e fica abaixo dele
  assert.match(css, /top: 76px !important;/);
  assert.match(css, /z-index: 99990 !important;/);
});

test('menu-topo.js: rótulos entram por textContent (nunca por innerHTML) e o modo é lido antes da primeira pintura', () => {
  const js = lerArquivo('menu-topo.js');
  const usos = [...js.matchAll(/\.innerHTML\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
  for (const u of usos) assert.match(u, /^(entrada\.icone|unico\.icone|ICONE_[A-Z]+|a \? a\.innerHTML : ''|caret|ICONE_CARET)$/, 'innerHTML com valor inesperado: ' + u);
  assert.match(js, /html\.classList\.toggle\('nx-menu-topo', modoTopo\(\)\)/);
  assert.match(js, /getItem\(CHAVE_MODO\) !== 'side'/);
  assert.match(js, /if \(typeof document === 'undefined' \|\| !raiz\) return;/);
});
