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
test('shellHTML: três abas no topo, a ativa marcada, contadores e identidade do administrador', () => {
  const h = A.shellHTML('pagamentos', { contagens: { usuarios: 12, pagamentos: 3, logs: 529 }, eu: { nome: 'Ana Admin Teste', email: 'ana@x.com' }, corpo: '<p id="x">corpo</p>' });
  assert.equal((h.match(/role="tab"/g) || []).length, 3);
  assert.ok(h.includes('data-adm-ir="usuarios"') && h.includes('data-adm-ir="pagamentos"') && h.includes('data-adm-ir="logs"'));
  assert.ok(/data-adm-ir="pagamentos" aria-selected="true" aria-current="page"/.test(h));
  assert.ok(/data-adm-ir="usuarios" aria-selected="false"/.test(h));
  assert.ok(h.includes('>12<') && h.includes('3 pend.') && h.includes('>529<'));
  assert.ok(h.includes('Ana Admin Teste') && h.includes('id="admCorpo"') && h.includes('<p id="x">corpo</p>'));
  assert.ok(!A.shellHTML('usuarios', { contagens: { usuarios: 1, pagamentos: 0, logs: 0 }, eu: {} }).includes('pend.'), 'sem pendências não mostra o aviso');
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
  assert.ok(semResultado.includes('Nenhum cadastro encontrado') && semResultado.includes('data-adm-chip="busca"'));
  A.estado.busca = '';
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
