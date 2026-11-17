'use strict';
// Testes do modelo e do HTML de administracao.js (menus no topo + Cadastros & Contas). Rodam com: node --test administracao.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./administracao.js');

const AGORA = Date.parse('2026-11-10T12:00:00-03:00');
const HORA = 3600000;
const DIA = 86400000;

function usuario(extra) {
  return Object.assign({ id: 7, name: 'Maria Teste Silva', email: 'Maria.Teste@Example.com', role: 'Usuário', active: true, cpf: '52998224725', phone: '11987654321',
    created_at: '2026-11-01T10:00:00-03:00', last_login: '2026-11-10T09:00:00-03:00', device_type: 'Mobile', subscription_status: 'trial', trial_started_at: '2026-11-10T08:00:00-03:00' }, extra || {});
}
const norm = (u, uso) => A.normalizarUsuario(u, uso || null, AGORA);

/* ----------------------------------------------------------------- formatação ----------------------------------------------------------------- */
test('formatarCpf e formatarTelefone: só formatam o que tem o tamanho certo', () => {
  assert.equal(A.formatarCpf('52998224725'), '529.982.247-25');
  assert.equal(A.formatarCpf('123'), '123');
  assert.equal(A.formatarTelefone('11987654321'), '(11) 98765-4321');
  assert.equal(A.formatarTelefone('1133334444'), '(11) 3333-4444');
  assert.equal(A.formatarTelefone('5511987654321'), '(11) 98765-4321');
  assert.equal(A.formatarTelefone('abc'), 'abc');
});

test('iniciais: primeira e última palavra; nome vazio vira US', () => {
  assert.equal(A.iniciais('Maria Teste Silva'), 'MS');
  assert.equal(A.iniciais('  ana  '), 'A');
  assert.equal(A.iniciais(''), 'US');
});

test('nascimentoBR/ISO: aceita DD/MM/AAAA e AAAA-MM-DD sem trocar o dia por fuso horário', () => {
  assert.equal(A.nascimentoBR('05/03/1990'), '05/03/1990');
  assert.equal(A.nascimentoBR('1990-03-05'), '05/03/1990');
  assert.equal(A.nascimentoBR('1990-03-05T00:00:00.000Z'), '05/03/1990');
  assert.equal(A.nascimentoBR('lixo'), '');
  assert.equal(A.nascimentoISO('05/03/1990'), '1990-03-05');
  assert.equal(A.nascimentoISO(''), '');
});

test('dataBR usa o fuso de Brasília e relativo descreve o tempo em português', () => {
  assert.equal(A.dataBR('2026-11-10T01:30:00Z', true), '09/11/2026 22:30');
  assert.equal(A.dataBR(null), '—');
  assert.equal(A.relativo(AGORA - 30 * 1000, AGORA), 'agora mesmo');
  assert.equal(A.relativo(AGORA - 5 * 60000, AGORA), 'há 5 min');
  assert.equal(A.relativo(AGORA - 3 * HORA, AGORA), 'há 3 h');
  assert.equal(A.relativo(AGORA - 30 * HORA, AGORA), 'ontem');
  assert.equal(A.relativo(AGORA - 12 * DIA, AGORA), 'há 12 dias');
  assert.equal(A.relativo(AGORA - 70 * DIA, AGORA), 'há 2 meses');
  assert.equal(A.relativo(null, AGORA), 'Nunca acessou');
});

/* ----------------------------------------------------------------- senha ----------------------------------------------------------------- */
test('gerarSenha: sempre forte, sem caracteres ambíguos e diferente a cada chamada', () => {
  const vistas = new Set();
  for (let i = 0; i < 200; i++) {
    const s = A.gerarSenha(14);
    assert.equal(s.length, 14);
    assert.ok(A.senhaForte(s), 'senha fraca: ' + s);
    assert.ok(!/[01OIl]/.test(s), 'caractere ambíguo: ' + s);
    vistas.add(s);
  }
  assert.ok(vistas.size > 190);
  assert.equal(A.gerarSenha(3).length, 10, 'tamanho mínimo de 10');
});

test('senhaForte: mesma regra do cadastro (8+, maiúscula, minúscula, número e símbolo)', () => {
  assert.ok(A.senhaForte('Nova#Senha9'));
  assert.ok(!A.senhaForte('novasenha9#'));
  assert.ok(!A.senhaForte('Ab#1'));
  assert.ok(!A.senhaForte('SemSimbolo123'));
});

/* ----------------------------------------------------------------- assinatura (espelha o servidor) ----------------------------------------------------------------- */
test('classificarAssinatura: administrador e vitalício nunca expiram', () => {
  assert.equal(A.classificarAssinatura({ role: 'Administrador' }, AGORA).chave, 'admin');
  assert.equal(A.classificarAssinatura({ role: 'Usuário', subscription_plan: 'vitalicio', subscription_status: 'active' }, AGORA).chave, 'vitalicio');
});

test('classificarAssinatura: "active" só vale com vencimento no futuro', () => {
  const futuro = new Date(AGORA + 10 * DIA).toISOString();
  const passado = new Date(AGORA - 2 * DIA).toISOString();
  const ok = A.classificarAssinatura({ subscription_status: 'active', subscription_plan: 'anual', subscription_expires_at: futuro }, AGORA);
  assert.equal(ok.chave, 'ativo'); assert.equal(ok.rotulo, 'Anual'); assert.equal(ok.diasRestantes, 10); assert.equal(ok.acesso, true);
  assert.equal(A.classificarAssinatura({ subscription_status: 'active', subscription_expires_at: passado }, AGORA).chave, 'expirado');
  // "active" sem vencimento não é assinatura para o servidor: cai no teste
  assert.equal(A.classificarAssinatura({ subscription_status: 'active', trial_started_at: new Date(AGORA - HORA).toISOString() }, AGORA).chave, 'teste');
});

test('classificarAssinatura: pagamento informado, expirado e teste de 1 dia', () => {
  assert.equal(A.classificarAssinatura({ subscription_status: 'pending_payment' }, AGORA).chave, 'pendente');
  assert.equal(A.classificarAssinatura({ subscription_status: 'trial', subscription_payment_id: 'NEXUS-SUB-123' }, AGORA).chave, 'pendente');
  assert.equal(A.classificarAssinatura({ subscription_status: 'expired' }, AGORA).chave, 'expirado');
  const emTeste = A.classificarAssinatura({ subscription_status: 'trial', trial_started_at: new Date(AGORA - 2 * HORA).toISOString() }, AGORA);
  assert.equal(emTeste.chave, 'teste'); assert.equal(emTeste.detalhe, '22 h restantes'); assert.equal(emTeste.acesso, true);
  const fim = A.classificarAssinatura({ subscription_status: 'trial', trial_started_at: new Date(AGORA - 30 * HORA).toISOString() }, AGORA);
  assert.equal(fim.chave, 'teste_fim'); assert.equal(fim.acesso, false);
});

/* ----------------------------------------------------------------- normalização ----------------------------------------------------------------- */
test('normalizarUsuario: e-mail em minúsculas, CPF/telefone só com dígitos e conta ativa por padrão', () => {
  const r = norm(usuario());
  assert.equal(r.email, 'maria.teste@example.com');
  assert.equal(r.cpf, '52998224725'); assert.equal(r.cpfFmt, '529.982.247-25');
  assert.equal(r.telFmt, '(11) 98765-4321');
  assert.equal(r.disp, 'Mobile'); assert.equal(r.ativo, true); assert.equal(r.perfil, 'user'); assert.equal(r.iniciais, 'MS');
  assert.equal(norm(usuario({ active: false })).ativo, false);
  assert.equal(norm(usuario({ active: 0 })).ativo, false);
  assert.equal(norm(usuario({ role: 'Administrador' })).perfil, 'admin');
});

test('normalizarUsuario: cadastro quase vazio não quebra', () => {
  const r = norm({ email: 'x@y.com' });
  assert.equal(r.nome, 'x'); assert.equal(r.cpfFmt, ''); assert.equal(r.disp, 'Desktop');
  assert.ok(isNaN(r.ultimoLogin)); assert.ok(isNaN(r.criadoEm));
});

/* ----------------------------------------------------------------- filtros, ordem e página ----------------------------------------------------------------- */
const LISTA = [
  usuario({ id: 1, name: 'Ana Admin', email: 'ana@x.com', role: 'Administrador', cpf: '', phone: '', last_login: '2026-11-10T11:00:00-03:00', created_at: '2026-10-01T10:00:00-03:00' }),
  usuario({ id: 2, name: 'Bruno Souza', email: 'bruno@x.com', cpf: '11122233344', phone: '21999990000', active: false, subscription_status: 'expired', last_login: null, created_at: '2026-10-15T10:00:00-03:00' }),
  usuario({ id: 3, name: 'Çarla Pereira', email: 'carla@x.com', cpf: '55566677788', phone: '', subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA + 5 * DIA).toISOString(), last_login: '2026-11-05T10:00:00-03:00', created_at: '2026-11-09T10:00:00-03:00', device_type: 'Desktop' }),
  usuario({ id: 4, name: 'Davi Lima', email: 'davi@x.com', cpf: '99988877766', phone: '31988887777', subscription_status: 'pending_payment', last_login: '2026-11-09T10:00:00-03:00', created_at: '2026-11-02T10:00:00-03:00', device_type: 'Desktop' })
].map((u) => norm(u));

test('filtrar: busca ignora acento/maiúscula e acha por nome, e-mail, CPF, telefone e código', () => {
  const nomes = (f) => A.filtrar(LISTA, f).map((r) => r.nome);
  assert.deepEqual(nomes({ busca: 'carla' }), ['Çarla Pereira']);
  assert.deepEqual(nomes({ busca: 'ÇARLA' }), ['Çarla Pereira']);
  assert.deepEqual(nomes({ busca: 'bruno@x' }), ['Bruno Souza']);
  assert.deepEqual(nomes({ busca: '111.222.333-44' }), ['Bruno Souza']);
  assert.deepEqual(nomes({ busca: '(31) 98888' }), ['Davi Lima']);
  assert.deepEqual(nomes({ busca: '55566677788' }), ['Çarla Pereira'], 'CPF só com dígitos');
  assert.deepEqual(nomes({ busca: 'davi.667@x' }), [], 'com letras, os dígitos não casam com o CPF de outra pessoa (o CPF de Çarla tem 667)');
  assert.deepEqual(nomes({ busca: 'davi' }), ['Davi Lima']);
  assert.deepEqual(nomes({ busca: 'ana admin' }), ['Ana Admin'], 'várias palavras: todas precisam aparecer');
  assert.deepEqual(nomes({ busca: 'nao existe' }), []);
});

test('filtrar: perfil, conta, assinatura e dispositivo combinam', () => {
  const n = (f) => A.filtrar(LISTA, f).length;
  assert.equal(n({ perfil: 'admin' }), 1);
  assert.equal(n({ perfil: 'user' }), 3);
  assert.equal(n({ status: 'inativo' }), 1);
  assert.equal(n({ status: 'ativo' }), 3);
  assert.equal(n({ plano: 'assinantes' }), 1);
  assert.equal(n({ plano: 'pendente' }), 1);
  assert.equal(n({ plano: 'sem_acesso' }), 1);
  assert.equal(n({ disp: 'Desktop' }), 2);
  assert.equal(n({ perfil: 'user', status: 'ativo', plano: 'pendente' }), 1);
  assert.equal(n({}), 4);
});

test('ordenar: por nome sem acento, por data com vazios no fim nos dois sentidos, e sem alterar a lista original', () => {
  const copia = LISTA.map((r) => r.email);
  assert.deepEqual(A.ordenar(LISTA, { col: 'nome', dir: 'asc' }).map((r) => r.nome), ['Ana Admin', 'Bruno Souza', 'Çarla Pereira', 'Davi Lima']);
  assert.deepEqual(A.ordenar(LISTA, { col: 'nome', dir: 'desc' }).map((r) => r.nome), ['Davi Lima', 'Çarla Pereira', 'Bruno Souza', 'Ana Admin']);
  assert.deepEqual(A.ordenar(LISTA, { col: 'login', dir: 'desc' }).map((r) => r.nome), ['Ana Admin', 'Davi Lima', 'Çarla Pereira', 'Bruno Souza']);
  assert.deepEqual(A.ordenar(LISTA, { col: 'login', dir: 'asc' }).map((r) => r.nome), ['Çarla Pereira', 'Davi Lima', 'Ana Admin', 'Bruno Souza']);
  assert.deepEqual(A.ordenar(LISTA, { col: 'criado', dir: 'desc' }).map((r) => r.nome)[0], 'Çarla Pereira');
  assert.deepEqual(A.ordenar(LISTA, { col: 'assinatura', dir: 'asc' }).map((r) => r.ass.chave), ['admin', 'ativo', 'pendente', 'expirado']);
  assert.deepEqual(A.ordenar(LISTA, { col: 'coluna-inexistente', dir: 'asc' }).map((r) => r.nome)[0], 'Ana Admin');
  assert.deepEqual(LISTA.map((r) => r.email), copia);
});

test('paginar: recorta, limita a página pedida e informa o intervalo mostrado', () => {
  const lista = Array.from({ length: 53 }, (_, i) => ({ i }));
  const p1 = A.paginar(lista, 1, 25);
  assert.equal(p1.itens.length, 25); assert.equal(p1.paginas, 3); assert.equal(p1.de, 1); assert.equal(p1.ate, 25);
  const p3 = A.paginar(lista, 3, 25);
  assert.equal(p3.itens.length, 3); assert.equal(p3.de, 51); assert.equal(p3.ate, 53);
  assert.equal(A.paginar(lista, 99, 25).pagina, 3);
  assert.equal(A.paginar(lista, 0, 25).pagina, 1);
  const vazio = A.paginar([], 1, 25);
  assert.equal(vazio.total, 0); assert.equal(vazio.de, 0); assert.equal(vazio.paginas, 1);
});

test('resumo: conta perfis, contas, assinaturas e quem acessou hoje', () => {
  const r = A.resumo(LISTA);
  assert.equal(r.total, 4); assert.equal(r.admins, 1); assert.equal(r.usuarios, 3);
  assert.equal(r.ativos, 3); assert.equal(r.bloqueados, 1);
  assert.equal(r.assinantes, 1); assert.equal(r.pendentes, 1); assert.equal(r.semAcesso, 1);
  assert.equal(r.semCpf, 1);
});

/* ----------------------------------------------------------------- CSV ----------------------------------------------------------------- */
test('csv: cabeçalho, ponto e vírgula, BOM para o Excel e proteção contra fórmula', () => {
  const lista = [norm(usuario({ name: '=HYPERLINK("http://x")', email: 'a@b.com' })), norm(usuario({ name: 'Nome; com "aspas"', email: 'c@d.com' }))];
  const texto = A.csv(lista);
  assert.ok(texto.startsWith('﻿Nome;E-mail;CPF;Telefone;Nascimento;Perfil;Conta;Assinatura;'));
  const linhas = texto.split('\r\n');
  assert.equal(linhas.length, 3);
  assert.ok(linhas[1].startsWith("\"'=HYPERLINK(\"\"http://x\"\")\";a@b.com;"), 'fórmula neutralizada: ' + linhas[1]);
  assert.ok(linhas[2].startsWith('"Nome; com ""aspas""";c@d.com;'));
  assert.ok(linhas[1].includes(';529.982.247-25;(11) 98765-4321;'));
});

/* ----------------------------------------------------------------- HTML ----------------------------------------------------------------- */
test('shellHTML: quatro abas no topo, a ativa marcada, contadores e identidade do administrador', () => {
  const h = A.shellHTML('pagamentos', { contagens: { usuarios: 12, pagamentos: 3, logs: 529 }, eu: { nome: 'Ana Admin Teste', email: 'ana@x.com' }, corpo: '<p id="x">corpo</p>' });
  assert.equal((h.match(/role="tab"/g) || []).length, 4);
  assert.ok(h.includes('data-adm-ir="usuarios"') && h.includes('data-adm-ir="assinaturas"') && h.includes('data-adm-ir="pagamentos"') && h.includes('data-adm-ir="logs"'));
  assert.ok(/data-adm-ir="pagamentos" aria-selected="true" aria-current="page"/.test(h));
  assert.ok(/data-adm-ir="usuarios" aria-selected="false"/.test(h));
  assert.ok(h.includes('3 pend.'), 'o contador de Pagamentos pede ação');
  assert.ok(!h.includes('>12<') && !h.includes('>529<'), 'totais neutros (cadastros e eventos) não repetem na aba');
  assert.equal((h.match(/adm-tab-n/g) || []).length, 1, 'só a aba Pagamentos tem contador');
  assert.ok(h.includes('Ana Admin Teste') && h.includes('id="admCorpo"') && h.includes('<p id="x">corpo</p>'));
  assert.ok(!A.shellHTML('usuarios', { contagens: { usuarios: 1, pagamentos: 0, logs: 0 }, eu: {} }).includes('pend.'), 'sem pendências não mostra o aviso');
  assert.ok(!h.includes('data-adm-acao="novo"'), '"Novo cadastro" mora no cabeçalho da tela de Cadastros, não na barra global');
});

test('cadastrosHTML: "Novo cadastro" fica ao lado de Exportar CSV, no cabeçalho da tela', () => {
  const h = A.html(() => ({ agora: AGORA, usuarios: [usuario()], acoes: {} }));
  assert.equal((h.match(/data-adm-acao="novo"/g) || []).length, 1);
  assert.ok(h.indexOf('data-adm-acao="exportar"') < h.indexOf('data-adm-acao="novo"') && h.indexOf('data-adm-acao="novo"') < h.indexOf('id="admResumo"'));
});

test('resumo: dois grupos (Pessoas e Assinatura), % do total, cartão zerado apagado e cartões que pedem atenção', () => {
  const us = [
    usuario({ email: 'a@x.com', role: 'Administrador' }),
    usuario({ email: 'b@x.com', subscription_status: 'pending_payment' }),
    usuario({ email: 'c@x.com', subscription_status: 'expired' }),
    usuario({ email: 'd@x.com' })
  ];
  const h = A.htmlResumo(A.calcular({ agora: AGORA, usuarios: us }));
  assert.ok(h.includes('>Pessoas<') && h.includes('>Assinatura<'), 'os dois grupos têm título');
  assert.equal((h.match(/class="adm-kpi-grupo/g) || []).length, 2);
  assert.equal((h.match(/data-adm-kpi=/g) || []).length, 8);
  assert.ok(h.indexOf('data-adm-kpi="inativo"') < h.indexOf('>Assinatura<') && h.indexOf('>Assinatura<') < h.indexOf('data-adm-kpi="assinantes"'), 'Pessoas vem antes de Assinatura');
  const cartao = (id) => (h.match(new RegExp('<button[^>]*data-adm-kpi="' + id + '"[\\s\\S]*?</button>')) || [''])[0];
  assert.ok(cartao('admin').includes('25%') && cartao('admin').includes('de 4 cadastros'), 'proporção do total no próprio cartão');
  assert.ok(!cartao('todos').includes('adm-kpi-p'), 'o Total não repete a porcentagem');
  assert.ok(/class="adm-kpi [^"]*is-zero/.test(cartao('inativo')) && !cartao('inativo').includes('adm-kpi-p'), 'zero fica apagado e sem porcentagem');
  assert.ok(/is-atencao/.test(cartao('pendente')) && cartao('pendente').includes('adm-kpi-al'), 'pagamento aguardando > 0 pede atenção');
  assert.ok(/is-atencao/.test(cartao('sem_acesso')) && cartao('sem_acesso').includes('Acesso encerrado') && cartao('sem_acesso').includes('teste ou plano vencido'), 'rótulo novo e significado na linha pequena');
  assert.ok(!h.includes('>Sem acesso<'), 'o nome antigo saiu');
  assert.ok(!/is-atencao/.test(cartao('inativo')) && !/is-atencao/.test(cartao('ativo')), 'só Aguardando pagamento e Acesso encerrado pedem atenção');
  const zero = A.htmlResumo(A.calcular({ agora: AGORA, usuarios: [usuario({ email: 'z@x.com', role: 'Administrador' })] }));
  assert.ok(!/is-atencao/.test(zero), 'sem pendência e sem acesso encerrado nada pede atenção');
  assert.ok(/class="adm-kpi [^"]*is-zero[^"]*"[^>]*data-adm-kpi="pendente"/.test(zero));
  assert.ok(A.htmlResumo(A.calcular({ agora: AGORA, usuarios: [] })).includes('data-adm-kpi="todos"'), 'sem cadastros não divide por zero');
});

test('barra: uma linha (busca, Filtros, ordem, contador, vista) e o painel com grupos de botões', () => {
  A.estado.busca = ''; A.estado.perfil = 'todos'; A.estado.status = 'todos'; A.estado.plano = 'todos'; A.estado.disp = 'todos';
  const h = A.html(() => ({ agora: AGORA, usuarios: [usuario(), usuario({ id: 9, email: 'o@y.com' })], acoes: {} }));
  const barra = h.slice(h.indexOf('class="adm-barra"'), h.indexOf('id="admChips"'));
  assert.ok(barra.includes('id="admFtog"') && barra.includes('class="adm-fbtn"') && barra.includes('data-adm-ordem-sel') && barra.includes('id="admCont"') && barra.includes('data-adm-vista="tabela"'));
  assert.ok(barra.indexOf('id="admBusca"') < barra.indexOf('class="adm-fbtn"') && barra.indexOf('class="adm-fbtn"') < barra.indexOf('data-adm-ordem-sel') && barra.indexOf('data-adm-ordem-sel') < barra.indexOf('id="admCont"') && barra.indexOf('id="admCont"') < barra.indexOf('class="adm-fpainel"'));
  assert.ok(barra.includes('<b>2</b> de 2 cadastros'), 'contador na linha da busca');
  for (const v of ['perfil:todos', 'perfil:admin', 'perfil:user', 'status:todos', 'status:ativo', 'status:inativo', 'disp:todos', 'disp:Desktop', 'disp:Mobile']) assert.ok(barra.includes('data-adm-seg="' + v + '"'), 'falta o botão ' + v);
  assert.ok(/data-adm-seg="perfil:todos" aria-pressed="true"/.test(barra) && /data-adm-seg="perfil:admin" aria-pressed="false"/.test(barra));
  assert.ok(barra.includes('data-adm-filtro="plano"') && !barra.includes('data-adm-filtro="perfil"'), 'só Assinatura continua em lista (tem 10 opções)');
  assert.ok(barra.includes('data-adm-fn hidden'), 'sem filtros ligados o selo de contagem fica escondido');
  assert.ok(h.includes('id="admChips"></div>'), 'sem filtros a faixa de etiquetas fica vazia (e some)');
  A.estado.perfil = 'admin'; A.estado.plano = 'pendente';
  const filtrado = A.html(() => ({ agora: AGORA, usuarios: [usuario()], acoes: {} }));
  assert.ok(/data-adm-seg="perfil:admin" aria-pressed="true"/.test(filtrado) && /class="adm-fn" data-adm-fn>2</.test(filtrado), 'selo mostra quantos filtros estão ligados');
  assert.ok(filtrado.includes('data-adm-chip="perfil"') && filtrado.includes('data-adm-chip="plano"') && filtrado.includes('Limpar tudo'));
  A.estado.perfil = 'todos'; A.estado.plano = 'todos';
});

test('cadastrosHTML: monta resumo, filtros e a lista; nomes com HTML são escapados', () => {
  const ctx = { agora: AGORA, usuarios: [usuario({ name: '<img src=x onerror=alert(1)>', email: 'x@y.com' }), usuario({ id: 8, name: 'Outra Pessoa', email: 'o@y.com' })], eu: { email: 'o@y.com' }, acoes: {} };
  const h = A.html(() => ctx);
  assert.ok(h.includes('id="admResumo"') && h.includes('id="admLista"') && h.includes('data-adm-busca'));
  assert.ok(!h.includes('<img src=x'), 'HTML do nome precisa ser escapado');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(h.includes('Você'), 'a própria conta aparece marcada');
  assert.ok(/data-adm-sel="o@y.com" disabled/.test(h), 'não dá para selecionar a própria conta');
  assert.ok(h.includes('<table class="adm-tabela">') && h.includes('adm-cartoes adm-auto'), 'tabela e cartões automáticos para telas estreitas');
});

test('cadastrosHTML: lista vazia e busca sem resultado mostram avisos diferentes', () => {
  A.estado.busca = ''; A.estado.perfil = 'todos'; A.estado.status = 'todos'; A.estado.plano = 'todos'; A.estado.disp = 'todos';
  const vazio = A.html(() => ({ agora: AGORA, usuarios: [], acoes: {} }));
  assert.ok(vazio.includes('Nenhum cadastro ainda'));
  A.estado.busca = 'zzzz';
  const semResultado = A.html(() => ({ agora: AGORA, usuarios: [usuario()], acoes: {} }));
  assert.ok(semResultado.includes('Nenhum cadastro encontrado') && semResultado.includes('data-adm-acao="limpar"'), 'o aviso oferece limpar a busca');
  assert.ok(!semResultado.includes('data-adm-chip="busca"'), 'a busca não vira etiqueta: o texto já está no campo');
  A.estado.busca = '';
});

/* ----------------------------------------------------------------- melhorias de 17/11: repetições, seleção, KPIs e menu da linha ----------------------------------------------------------------- */
function zerarEstado() {
  Object.assign(A.estado, { busca: '', perfil: 'todos', status: 'todos', plano: 'todos', disp: 'todos', pagina: 1, porPagina: 25, sel: {}, detalhe: null });
}

test('caixa "selecionar todos": a própria conta (caixa desativada) não conta como marcada', () => {
  zerarEstado();
  const so = { agora: AGORA, eu: { email: 'ana@x.com' }, acoes: {}, usuarios: [usuario({ email: 'ana@x.com', name: 'Ana', role: 'Administrador' })] };
  const th = (h) => h.slice(h.indexOf('data-adm-sel-pagina') - 40, h.indexOf('data-adm-sel-pagina') + 220);
  let h = A.htmlTabela(A.calcular(so));
  assert.ok(!/data-adm-sel-pagina checked/.test(h), 'com só a própria conta nada pode vir marcado');
  assert.ok(/data-adm-sel-pagina [^>]*disabled/.test(th(h)), 'e a caixa do cabeçalho fica desativada');
  const tres = { agora: AGORA, eu: { email: 'ana@x.com' }, acoes: {}, usuarios: [so.usuarios[0], usuario({ email: 'b@x.com', name: 'B' }), usuario({ email: 'c@x.com', name: 'C' })] };
  h = A.htmlTabela(A.calcular(tres));
  assert.ok(!/data-adm-sel-pagina checked/.test(h) && !/data-adm-parcial/.test(h) && !/data-adm-sel-pagina [^>]*disabled/.test(th(h)), 'nada selecionado: desmarcada, sem traço, ativa');
  A.estado.sel = { 'b@x.com': true };
  h = A.htmlTabela(A.calcular(tres));
  assert.ok(/data-adm-parcial/.test(h) && !/data-adm-sel-pagina checked/.test(h), 'parte selecionada: caixa com traço (indeterminada)');
  A.estado.sel = { 'b@x.com': true, 'c@x.com': true };
  h = A.htmlTabela(A.calcular(tres));
  assert.ok(/data-adm-sel-pagina checked/.test(h) && !/data-adm-parcial/.test(h), 'todas as selecionáveis marcadas: caixa marcada');
  zerarEstado();
});

test('linha: "Administrador" só aparece onde ainda não está, e a assinatura do admin diz "Sem cobrança"', () => {
  zerarEstado();
  const ctx = { agora: AGORA, eu: { email: 'zz@x.com' }, acoes: {}, usuarios: [usuario({ email: 'ana@x.com', name: 'Ana', role: 'Administrador' }), usuario()] };
  const m = A.calcular(ctx);
  const adm = A.htmlLinha(m.todos.find((r) => r.email === 'ana@x.com'), m);
  const com = A.htmlLinha(m.todos.find((r) => r.email === 'maria.teste@example.com'), m);
  assert.ok(adm.includes('<span class="adm-sub-perfil">Administrador · </span>Computador') || adm.includes('<span class="adm-sub-perfil">Administrador · </span>Celular'), 'o perfil fica no subtítulo (o CSS o esconde quando a coluna Perfil está visível)');
  assert.ok(!com.includes('adm-sub-perfil'), 'usuário comum não tem perfil no subtítulo');
  const ass = adm.slice(adm.indexOf('adm-c-ass'), adm.indexOf('adm-c-acc'));
  assert.ok(ass.includes('Ilimitado') && ass.includes('Sem cobrança') && !ass.includes('>Administrador<'), 'a linha pequena da assinatura não repete o perfil');
  const cartao = A.htmlCartao(m.todos.find((r) => r.email === 'ana@x.com'), m);
  assert.ok(cartao.includes('adm-sub-perfil') && cartao.includes('Administrador'), 'o cartão traz o texto e o CSS o esconde (o selo já diz o perfil)');
});

test('etiquetas de filtro: a busca não vira etiqueta; o campo ganha um "x" que só aparece com texto', () => {
  zerarEstado();
  A.estado.busca = 'maria';
  assert.equal(A.htmlChips(), '', 'só a busca ligada: nenhuma etiqueta');
  A.estado.perfil = 'admin';
  const c = A.htmlChips();
  assert.ok(c.includes('data-adm-chip="perfil"') && !c.includes('data-adm-chip="busca"') && c.includes('Limpar tudo'), 'filtro escolhido vira etiqueta; busca continua só no campo');
  const barra = A.htmlBarra();
  assert.ok(barra.includes('class="adm-busca-x" data-adm-acao="limpar-busca"'), 'o "x" dispara a ação de limpar só a busca');
  assert.ok(!/class="adm-busca-x"[^>]*hidden/.test(barra), 'com texto o "x" aparece');
  zerarEstado();
  assert.ok(/class="adm-busca-x"[^>]*hidden/.test(A.htmlBarra()), 'sem texto o "x" fica escondido');
});

test('rodapé: some quando tudo cabe em 1 página pequena; sem páginas não mostra os botões de página', () => {
  zerarEstado();
  const gente = (n) => Array.from({ length: n }, (_, i) => usuario({ id: 100 + i, email: 'p' + i + '@x.com', name: 'Pessoa ' + String(i).padStart(3, '0') }));
  const rodape = (n) => A.htmlRodape(A.calcular({ agora: AGORA, acoes: {}, usuarios: gente(n) }));
  assert.equal(rodape(1), '', '1 cadastro: sem rodapé');
  assert.equal(rodape(25), '', '25 cabem na 1ª página: sem rodapé');
  const dois = rodape(26);
  assert.ok(dois.includes('adm-pags') && dois.includes('Mostrando <b>1–25</b> de <b>26</b>') && dois.includes('data-adm-pp'), '26 viram 2 páginas: rodapé completo');
  A.estado.porPagina = 100;
  const uma = rodape(40);
  assert.ok(!uma.includes('adm-pags') && uma.includes('Mostrando <b>1–40</b> de <b>40</b>') && uma.includes('data-adm-pp'), '1 página com mais de 25: sem botões de página, mas com o seletor');
  zerarEstado();
});

test('cartões do resumo que pedem atenção mostram "Ver →" (ou "Limpar ×" com o filtro ligado); os outros não', () => {
  zerarEstado();
  const velho = new Date(AGORA - 40 * HORA).toISOString();
  const ctx = { agora: AGORA, acoes: {}, usuarios: [usuario({ email: 'a@x.com', trial_started_at: velho }), usuario({ email: 'b@x.com', role: 'Administrador' })] };
  let h = A.htmlResumo(A.calcular(ctx));
  const cartao = (id) => h.slice(h.indexOf('data-adm-kpi="' + id + '"'), h.indexOf('</button>', h.indexOf('data-adm-kpi="' + id + '"')));
  assert.ok(cartao('sem_acesso').includes('adm-kpi-ver" aria-hidden="true">Ver →<'), 'acesso encerrado > 0: convite para filtrar');
  assert.ok(!cartao('pendente').includes('adm-kpi-ver'), 'sem pendência não há convite (cartão apagado)');
  for (const id of ['todos', 'admin', 'ativo', 'inativo', 'assinantes', 'teste']) assert.ok(!cartao(id).includes('adm-kpi-ver'), id + ' não pede atenção');
  A.estado.plano = 'sem_acesso';
  h = A.htmlResumo(A.calcular(ctx));
  assert.ok(cartao('sem_acesso').includes('>Limpar ×<') && /data-adm-kpi="sem_acesso" aria-pressed="true"/.test(h), 'filtro ligado: o texto vira "Limpar ×"');
  zerarEstado();
});

test('menu "⋯" da linha: ações do dia a dia por situação da conta; a própria conta não tem menu e o espelho saiu da linha', () => {
  zerarEstado();
  const ctx = { agora: AGORA, eu: { email: 'ana@x.com' }, acoes: {}, usuarios: [usuario({ email: 'ana@x.com', name: 'Ana', role: 'Administrador' }), usuario({ email: 'bia@x.com', name: 'Bia', role: 'Administrador' }),
    usuario(), usuario({ id: 12, email: 'blo@x.com', name: 'Bloqueada', active: false })] };
  const m = A.calcular(ctx);
  const por = (e) => m.todos.find((r) => r.email === e);
  const itens = (h) => (h.match(/data-adm-a="([a-z]+)"/g) || []).map((s) => s.slice(12, -1));
  assert.deepEqual(itens(A.htmlMenuLinha(por('maria.teste@example.com'))), ['senha', 'bloquear', 'promover', 'assinatura', 'espelho', 'copiar'], 'usuário ativo');
  assert.deepEqual(itens(A.htmlMenuLinha(por('blo@x.com'))), ['senha', 'ativar', 'promover', 'assinatura', 'espelho', 'copiar'], 'conta bloqueada oferece Ativar em vez de Bloquear');
  assert.deepEqual(itens(A.htmlMenuLinha(por('bia@x.com'))), ['senha', 'bloquear', 'rebaixar', 'espelho', 'copiar'], 'administrador: rebaixar e sem aba Assinaturas (acesso ilimitado)');
  assert.ok(!A.htmlMenuLinha(por('bia@x.com')).includes('data-adm-a="excluir"'), 'excluir continua só na gaveta (zona de risco)');
  assert.ok(A.htmlMenuLinha(por('maria.teste@example.com')).includes('role="menuitem"'));
  const linhaOutra = A.htmlLinha(por('bia@x.com'), m);
  assert.ok(linhaOutra.includes('data-adm-menu="bia@x.com"') && linhaOutra.includes('aria-haspopup="menu"') && linhaOutra.includes('aria-expanded="false"'));
  assert.ok(!linhaOutra.includes('data-adm-a="espelho"') && linhaOutra.includes('data-adm-abrir=') && linhaOutra.includes('data-adm-a="editar"'), 'o espelho saiu da linha; olho e lápis ficam');
  const linhaEu = A.htmlLinha(por('ana@x.com'), m);
  assert.ok(!linhaEu.includes('data-adm-menu') && linhaEu.includes('Você'), 'a própria conta mostra "Você" e não tem menu');
  assert.ok(A.htmlCartao(por('bia@x.com'), m).includes('data-adm-menu="bia@x.com"'), 'o cartão tem o mesmo menu');
});

test('detalheHTML: ações do administrador sobre outra conta e bloqueio das ações sobre si mesmo', () => {
  const ctx = { agora: AGORA, usuarios: [usuario({ email: 'ana@x.com', name: 'Ana', role: 'Administrador' }), usuario()], eu: { email: 'ana@x.com' }, acoes: {}, eventos: () => [{ action: 'Login', details: 'entrou', timestamp: '2026-11-10T10:00:00-03:00' }] };
  const m = A.calcular(ctx);
  const outra = A.detalheHTML(m.todos.find((r) => r.email === 'maria.teste@example.com'), m, ctx);
  for (const a of ['editar', 'bloquear', 'promover', 'senha', 'espelho', 'pagar', 'tempo', 'boleto', 'excluir', 'copiar']) assert.ok(outra.includes('data-adm-a="' + a + '"'), 'falta a ação ' + a);
  assert.ok(outra.includes('wa.me/5511987654321'));
  assert.ok(outra.includes('Login') && outra.includes('entrou'));
  const propria = A.detalheHTML(m.todos.find((r) => r.email === 'ana@x.com'), m, ctx);
  for (const a of ['bloquear', 'promover', 'rebaixar', 'senha', 'excluir', 'pagar']) assert.ok(!propria.includes('data-adm-a="' + a + '"'), 'não pode oferecer ' + a + ' sobre a própria conta');
  assert.ok(propria.includes('data-adm-a="editar"') && propria.includes('não pode bloqueá-la'));
  const adm = A.calcular({ agora: AGORA, usuarios: [usuario({ email: 'ana@x.com', role: 'Administrador' }), usuario({ email: 'bia@x.com', role: 'Administrador', name: 'Bia' })], eu: { email: 'ana@x.com' } });
  const dBia = A.detalheHTML(adm.todos.find((r) => r.email === 'bia@x.com'), adm, { eventos: () => [] });
  assert.ok(dBia.includes('data-adm-a="rebaixar"') && !dBia.includes('data-adm-a="promover"') && !dBia.includes('data-adm-a="pagar"'), 'administrador não paga assinatura');
  assert.ok(!dBia.includes('data-adm-a="boleto"') && !dBia.includes('data-adm-a="tempo"') && dBia.includes('acesso ilimitado'), 'nem 2ª via de boleto nem liberar tempo para administrador');
});

test('detalheHTML: corpo em duas colunas (dados | permissões, ações e eventos), com os blocos bem fechados e na ordem de leitura no celular', () => {
  const ctx = { agora: AGORA, usuarios: [usuario({ email: 'ana@x.com', name: 'Ana', role: 'Administrador' }), usuario()], eu: { email: 'ana@x.com' }, acoes: {}, eventos: () => [] };
  const m = A.calcular(ctx);
  for (const email of ['maria.teste@example.com', 'ana@x.com']) {
    const h = A.detalheHTML(m.todos.find((r) => r.email === email), m, ctx);
    assert.equal((h.match(/<div[\s>]/g) || []).length, (h.match(/<\/div>/g) || []).length, 'divs abertas e fechadas em igual número (' + email + ')');
    const c1 = h.indexOf('class="adm-dr-c1"'), c2 = h.indexOf('class="adm-dr-c2"');
    assert.ok(c1 > 0 && c2 > c1, 'a coluna de dados vem antes da de ações');
    const em = (titulo) => h.indexOf('<h4>' + titulo + '</h4>');
    for (const t of ['Identificação', 'Acesso', 'Assinatura', 'Uso do sistema']) assert.ok(em(t) > c1 && em(t) < c2, t + ' fica na coluna dos dados');
    for (const t of ['Ações', 'Eventos recentes']) assert.ok(em(t) > c2, t + ' fica na coluna das ações');
    assert.ok(h.indexOf('class="adm-dr-corpo"') < c1);
  }
  const outra = A.detalheHTML(m.todos.find((r) => r.email === 'maria.teste@example.com'), m, ctx);
  assert.ok(outra.indexOf('<h4>Permissões</h4>') > outra.indexOf('class="adm-dr-c2"'), 'Permissões abre a coluna das ações');
  assert.ok(!A.detalheHTML(m.todos.find((r) => r.email === 'ana@x.com'), m, ctx).includes('<h4>Permissões</h4>'), 'a própria conta continua sem Permissões');
});

test('alvosExpirar: só assinatura ativa de usuário comum; o resto é ignorado e contado por motivo', () => {
  const futuro = new Date(AGORA + 20 * DIA).toISOString();
  const ativa = (email) => usuario({ email, name: email, subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: futuro });
  const ctx = {
    agora: AGORA, eu: { email: 'ana@x.com' },
    usuarios: [usuario({ email: 'ana@x.com', role: 'Administrador' }), usuario({ email: 'bia@x.com', role: 'Administrador' }), ativa('c1@x.com'), ativa('c2@x.com'),
      usuario({ email: 'vit@x.com', subscription_status: 'active', subscription_plan: 'vitalicio' }), usuario({ email: 'teste@x.com' }),
      usuario({ email: 'velha@x.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA - DIA).toISOString() }), usuario({ email: 'fora@x.com' })]
  };
  const m = A.calcular(ctx);
  const r = A.alvosExpirar(m.todos, ['C1@x.com', 'c2@x.com', 'vit@x.com', 'teste@x.com', 'velha@x.com', 'bia@x.com', 'ana@x.com', 'nao@existe.com'], m.eu);
  assert.deepEqual(r.elegiveis.map((x) => x.email).sort(), ['c1@x.com', 'c2@x.com']);
  assert.deepEqual(r.ignoradas, { voce: 1, admin: 1, vitalicio: 1, semAssinatura: 2 });
  assert.equal(A.textoIgnoradas(r.ignoradas), '2 sem assinatura ativa, 1 vitalícia, 1 administrador, a sua conta');
  assert.equal(A.textoIgnoradas({ voce: 0, admin: 0, vitalicio: 0, semAssinatura: 0 }), '');
  assert.deepEqual(A.alvosExpirar(m.todos, [], m.eu).elegiveis, [], 'seleção vazia não alcança ninguém');
});

test('barra de lote: o botão "Expirar assinaturas" mostra quantas contas serão afetadas e fica desligado sem assinatura ativa', () => {
  const futuro = new Date(AGORA + 20 * DIA).toISOString();
  const ativa = (email) => usuario({ email, name: email, subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: futuro });
  const ctx = { agora: AGORA, eu: { email: 'ana@x.com' }, acoes: {}, usuarios: [usuario({ email: 'ana@x.com', role: 'Administrador' }), ativa('c1@x.com'), ativa('c2@x.com'), usuario({ email: 'teste@x.com' })] };
  const salvo = Object.assign({}, A.estado.sel);
  A.estado.sel = { 'c1@x.com': true, 'c2@x.com': true, 'teste@x.com': true };
  let h = A.html(() => ctx);
  assert.ok(h.includes('data-adm-acao="lote-expirar"') && h.includes('Expirar assinaturas (2)'), 'conta só as 2 com assinatura ativa');
  assert.ok(!/data-adm-acao="lote-expirar"[^>]*disabled/.test(h));
  A.estado.sel = { 'teste@x.com': true };
  h = A.html(() => ctx);
  assert.ok(/data-adm-acao="lote-expirar" disabled title="Nenhuma conta selecionada tem assinatura ativa"/.test(h), 'sem assinatura ativa na seleção o botão fica desligado');
  A.estado.sel = {};
  assert.ok(!A.html(() => ctx).includes('lote-expirar'), 'sem seleção não há barra de lote');
  A.estado.sel = salvo;
});

test('permissões delegadas: a gaveta mostra uma caixa por permissão só para outra conta de usuário', () => {
  const cat = [{ id: 'assinatura.liberar', label: 'Liberar assinatura manual', desc: 'Conceder tempo.' }, { id: 'logs.ver', label: 'Ver auditoria e logs', desc: 'Somente leitura.' }];
  const base = [usuario({ email: 'ana@x.com', name: 'Ana', role: 'Administrador' }), usuario({ permissions: ['assinatura.liberar'] }), usuario({ email: 'bia@x.com', name: 'Bia', role: 'Administrador' })];
  const ctx = { agora: AGORA, usuarios: base, eu: { email: 'ana@x.com' }, permissoes: { catalogo: cat }, eventos: () => [] };
  const m = A.calcular(ctx);
  const doUsuario = m.todos.find((r) => r.email === 'maria.teste@example.com');
  assert.deepEqual(doUsuario.permissoes, ['assinatura.liberar']);
  assert.deepEqual(norm(usuario()).permissoes, [], 'sem o campo, nenhuma permissão');
  const d = A.detalheHTML(doUsuario, m, ctx);
  assert.ok(d.includes('<h4>Permissões</h4>') && d.includes('Liberar assinatura manual') && d.includes('Ver auditoria e logs'));
  assert.ok(/data-perm="assinatura\.liberar"[^>]*checked/.test(d), 'a permissão que a conta tem vem marcada');
  assert.ok(!/data-perm="logs\.ver"[^>]*checked/.test(d), 'a que ela não tem vem desmarcada');
  assert.equal((d.match(/data-adm-a="perm"/g) || []).length, 2, 'uma caixa por permissão do catálogo');
  // outro administrador: sem caixas (já tem tudo); a própria conta: sem a seção
  const dAdmin = A.detalheHTML(m.todos.find((r) => r.email === 'bia@x.com'), m, ctx);
  assert.ok(dAdmin.includes('já tem todas as permissões') && !dAdmin.includes('data-adm-a="perm"'));
  assert.ok(!A.detalheHTML(m.todos.find((r) => r.email === 'ana@x.com'), m, ctx).includes('<h4>Permissões</h4>'));
  // catálogo ainda não chegou do servidor (ou falhou): avisa em vez de mostrar caixas vazias
  const semCat = A.detalheHTML(doUsuario, m, Object.assign({}, ctx, { permissoes: { catalogo: null } }));
  assert.ok(semCat.includes('Carregando as permissões') && !semCat.includes('data-adm-a="perm"'));
  assert.ok(A.detalheHTML(doUsuario, m, Object.assign({}, ctx, { permissoes: { catalogo: null, erro: 'Não foi possível carregar as permissões.' } })).includes('Não foi possível carregar as permissões.'));
  // HTML no nome/descrição do catálogo não vira marcação
  const sujo = A.detalheHTML(doUsuario, m, Object.assign({}, ctx, { permissoes: { catalogo: [{ id: 'x"><img src=x onerror=alert(1)>', label: '<b>negrito</b>', desc: '<i>d</i>' }] } }));
  assert.ok(!sujo.includes('<img src=x') && !sujo.includes('<b>negrito</b>'));
});
