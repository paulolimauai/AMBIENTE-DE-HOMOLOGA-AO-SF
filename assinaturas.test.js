'use strict';
// Testes do modelo e do HTML de assinaturas.js (aba "Assinaturas" do painel do administrador). Rodam com: node --test assinaturas.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const Adm = require('./administracao.js');
const S = require('./assinaturas.js');

const AGORA = Date.parse('2026-11-17T12:00:00-03:00');
const HORA = 3600000;
const DIA = 86400000;
const iso = (ms) => new Date(ms).toISOString();

function usuario(extra) {
  return Object.assign({ id: 1, name: 'Maria Teste', email: 'maria@example.com', role: 'Usuário', active: true, cpf: '52998224725', phone: '11987654321',
    created_at: iso(AGORA - 10 * DIA), subscription_status: 'trial', trial_started_at: iso(AGORA - 2 * HORA) }, extra || {});
}
const paga = (extra, dias) => usuario(Object.assign({ subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: iso(AGORA + (dias == null ? 20 : dias) * DIA) }, extra || {}));
const reg = (u) => S.registro(u, AGORA);
const ctx = (usuarios, extra) => Object.assign({ agora: AGORA, usuarios, eu: { email: 'admin@example.com', nome: 'Admin' }, preco: { numero: 18 }, acoes: {} }, extra || {});

/* ----------------------------------------------------------------- situação e vencimento ----------------------------------------------------------------- */
test('situacaoDe: separa quem paga, cortesia, vitalício, teste, pendente e encerrado (e admin fica de fora)', () => {
  assert.equal(reg(paga()).sit, 'paga');
  assert.equal(reg(paga({ subscription_plan: 'cortesia_admin', subscription_method: 'admin_cortesia' })).sit, 'cortesia');
  assert.equal(reg(usuario({ subscription_status: 'active', subscription_plan: 'vitalicio', subscription_expires_at: '2099-12-31T23:59:59Z' })).sit, 'vitalicia');
  assert.equal(reg(usuario()).sit, 'teste');
  assert.equal(reg(usuario({ subscription_status: 'pending_payment' })).sit, 'pendente');
  assert.equal(reg(usuario({ subscription_status: 'trial', subscription_payment_id: 'NEXUS-SUB-123' })).sit, 'pendente', 'informou o Pix ainda no teste');
  assert.equal(reg(usuario({ subscription_status: 'expired', subscription_expires_at: iso(AGORA - 3 * DIA) })).sit, 'encerrada');
  assert.equal(reg(usuario({ trial_started_at: iso(AGORA - 3 * DIA) })).sit, 'encerrada', 'teste de 1 dia que acabou');
  assert.equal(reg(usuario({ role: 'Administrador' })).sit, 'admin');
});

test('assinatura "active" com vencimento no passado é encerrada (mesma regra do servidor)', () => {
  assert.equal(reg(paga({}, -1)).sit, 'encerrada');
});

test('vencimento: da assinatura, ou o fim do dia grátis; vitalício não tem', () => {
  const p = reg(paga({}, 5));
  assert.equal(p.venc, AGORA + 5 * DIA);
  const t = reg(usuario({ trial_started_at: iso(AGORA - 2 * HORA) }));
  assert.equal(t.venc, AGORA - 2 * HORA + DIA);
  const fim = reg(usuario({ trial_started_at: iso(AGORA - 3 * DIA) }));
  assert.equal(fim.venc, AGORA - 3 * DIA + DIA, 'o dia grátis acabou há 2 dias');
  assert.equal(reg(usuario({ subscription_status: 'active', subscription_plan: 'vitalicio' })).venc, null);
});

test('vencendo: só assinatura paga ou cortesia ainda válida, dentro de 7 dias', () => {
  assert.equal(S.vencendo(reg(paga({}, 3)), AGORA), true);
  assert.equal(S.vencendo(reg(paga({}, 7)), AGORA), true);
  assert.equal(S.vencendo(reg(paga({}, 8)), AGORA), false);
  assert.equal(S.vencendo(reg(paga({}, -1)), AGORA), false, 'já venceu: é encerrada, não "vencendo"');
  assert.equal(S.vencendo(reg(usuario()), AGORA), false, 'teste não conta');
  assert.equal(S.vencendo(reg(paga({ subscription_plan: 'cortesia_admin', subscription_method: 'admin_cortesia' }, 2)), AGORA), true);
});

test('textoVenc: prazo em palavras e cor pela urgência', () => {
  assert.deepEqual(S.textoVenc(reg(paga({}, 20)), AGORA), { texto: 'vence em 20 dias', tom: 'ok' });
  assert.deepEqual(S.textoVenc(reg(paga({}, 1)), AGORA), { texto: 'vence em 1 dia', tom: 'aviso' });
  assert.equal(S.textoVenc(reg(paga({ subscription_expires_at: iso(AGORA + 5 * HORA) })), AGORA).texto, 'vence em 5 h');
  assert.equal(S.textoVenc(reg(paga({ subscription_expires_at: iso(AGORA + 20 * 60000) })), AGORA).texto, 'vence em menos de 1 h');
  assert.deepEqual(S.textoVenc(reg(usuario({ subscription_status: 'expired', subscription_expires_at: iso(AGORA - 3 * DIA) })), AGORA), { texto: 'venceu há 3 dias', tom: 'ruim' });
  assert.equal(S.textoVenc(reg(usuario({ trial_started_at: iso(AGORA - 3 * DIA) })), AGORA).texto, 'terminou há 2 dias');
  assert.equal(S.textoVenc(reg(usuario()), AGORA).texto, 'termina em 22 h');
  assert.equal(S.textoVenc(reg(usuario({ subscription_status: 'active', subscription_plan: 'vitalicio' })), AGORA).texto, 'sem vencimento');
});

/* ----------------------------------------------------------------- filtro, ordem e resumo ----------------------------------------------------------------- */
function massa() {
  return [
    usuario({ id: 1, name: 'Ana Paga', email: 'ana@example.com', cpf: '11122233344', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: iso(AGORA + 3 * DIA) }),
    usuario({ id: 2, name: 'Bruno Longe', email: 'bruno@example.com', cpf: '22233344455', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: iso(AGORA + 25 * DIA) }),
    usuario({ id: 3, name: 'Cíntia Pendente', email: 'cintia@example.com', cpf: '33344455566', subscription_status: 'pending_payment' }),
    usuario({ id: 4, name: 'Davi Encerrado', email: 'davi@example.com', cpf: '44455566677', subscription_status: 'expired', subscription_expires_at: iso(AGORA - 2 * DIA) }),
    usuario({ id: 5, name: 'Eva Teste', email: 'eva@example.com', cpf: '55566677788' }),
    usuario({ id: 6, name: 'Fábio Cortesia', email: 'fabio@example.com', cpf: '66677788899', subscription_status: 'active', subscription_plan: 'cortesia_admin', subscription_method: 'admin_cortesia', subscription_expires_at: iso(AGORA + 10 * DIA) }),
    usuario({ id: 7, name: 'Gabi Vitalicia', email: 'gabi@example.com', cpf: '77788899900', subscription_status: 'active', subscription_plan: 'vitalicio' }),
    usuario({ id: 8, name: 'Chefe Admin', email: 'admin@example.com', role: 'Administrador' })
  ];
}
const regs = () => massa().map(reg);

test('filtrar: administrador nunca entra; situação, vencendo e busca sem acento/CPF funcionam', () => {
  const r = regs();
  assert.equal(S.filtrar(r, {}, AGORA).length, 7, 'o administrador fica de fora');
  assert.deepEqual(S.filtrar(r, { sit: 'paga' }, AGORA).map((x) => x.nome), ['Ana Paga', 'Bruno Longe']);
  assert.deepEqual(S.filtrar(r, { sit: 'vencendo' }, AGORA).map((x) => x.nome), ['Ana Paga']);
  assert.deepEqual(S.filtrar(r, { sit: 'pendente' }, AGORA).map((x) => x.nome), ['Cíntia Pendente']);
  assert.deepEqual(S.filtrar(r, { sit: 'encerrada' }, AGORA).map((x) => x.nome), ['Davi Encerrado']);
  assert.deepEqual(S.filtrar(r, { busca: 'cintia' }, AGORA).map((x) => x.nome), ['Cíntia Pendente'], 'sem acento');
  assert.deepEqual(S.filtrar(r, { busca: '44455566677' }, AGORA).map((x) => x.nome), ['Davi Encerrado'], 'por CPF');
  assert.deepEqual(S.filtrar(r, { busca: 'eva example' }, AGORA).map((x) => x.nome), ['Eva Teste'], 'vários termos');
  assert.deepEqual(S.filtrar(r, { sit: 'paga', busca: 'longe' }, AGORA).map((x) => x.nome), ['Bruno Longe']);
});

test('ordenar: por padrão quem precisa de atenção vem primeiro; vencimento põe datas ausentes no fim', () => {
  const r = S.filtrar(regs(), {}, AGORA);
  const nomes = (o) => S.ordenar(r, o, AGORA).map((x) => x.nome);
  assert.deepEqual(nomes('prioridade'), ['Cíntia Pendente', 'Ana Paga', 'Davi Encerrado', 'Eva Teste', 'Bruno Longe', 'Fábio Cortesia', 'Gabi Vitalicia']);
  assert.deepEqual(nomes('venc:asc').slice(0, 3), ['Davi Encerrado', 'Eva Teste', 'Ana Paga'], 'vencido, teste que acaba hoje, vence em 3 dias');
  assert.equal(nomes('venc:asc').slice(-2).join(), 'Cíntia Pendente,Gabi Vitalicia', 'sem data: fim da lista, por nome');
  assert.equal(nomes('venc:desc')[0], 'Bruno Longe');
  assert.deepEqual(nomes('nome:asc')[0], 'Ana Paga');
  assert.equal(S.ordenar(r, 'nome:asc', AGORA).length, r.length, 'não perde nem repete ninguém');
});

test('resumo: conta cada situação, quem vence logo e a receita estimada', () => {
  const o = S.resumo(regs(), AGORA, 18);
  assert.deepEqual({ total: o.total, paga: o.paga, vencendo: o.vencendo, pendente: o.pendente, encerrada: o.encerrada, teste: o.teste, cortesia: o.cortesia, vitalicia: o.vitalicia, admins: o.admins },
    { total: 7, paga: 2, vencendo: 1, pendente: 1, encerrada: 1, teste: 1, cortesia: 1, vitalicia: 1, admins: 1 });
  assert.equal(o.receita, 36, 'só assinante pago entra na receita (cortesia e vitalício não)');
  assert.equal(S.resumo(regs(), AGORA, 0).receita, 0);
});

/* ----------------------------------------------------------------- tempo e lote ----------------------------------------------------------------- */
test('minutosDe: converte a unidade, recusa vazio, zero e mais de 10 anos', () => {
  assert.deepEqual(S.minutosDe('2', 'hours'), { ok: true, minutos: 120, texto: '2 horas' });
  assert.equal(S.minutosDe('1', 'days').minutos, 1440);
  assert.equal(S.minutosDe('3', 'months').minutos, 3 * 43200);
  assert.equal(S.minutosDe('1', 'years').minutos, 525600);
  assert.equal(S.minutosDe('90', 'minutes').texto, '90 minutos');
  assert.equal(S.minutosDe('', 'hours').ok, false);
  assert.equal(S.minutosDe('0', 'hours').ok, false);
  assert.equal(S.minutosDe('-4', 'days').ok, false);
  assert.equal(S.minutosDe('abc', 'days').ok, false);
  assert.equal(S.minutosDe('5', 'século').ok, false);
  assert.equal(S.minutosDe('10', 'years').ok, true);
  assert.equal(S.minutosDe('11', 'years').ok, false, 'o servidor recusa mais de 10 anos');
  assert.match(S.minutosDe('11', 'years').erro, /10 anos/);
});

test('textoMinutos usa a maior unidade exata', () => {
  assert.equal(S.textoMinutos(60), '1 hora');
  assert.equal(S.textoMinutos(1440), '1 dia');
  assert.equal(S.textoMinutos(10080), '7 dias');
  assert.equal(S.textoMinutos(43200), '1 mês (30 dias)');
  assert.equal(S.textoMinutos(525600), '1 ano');
  assert.equal(S.textoMinutos(1500), '25 horas');
  assert.equal(S.textoMinutos(61), '61 minutos');
});

test('alvosConceder: ignora administrador, a própria conta e vitalício (somar tempo a vitalício viraria prazo de 2099)', () => {
  const r = regs();
  const todos = r.map((x) => x.email);
  const a = S.alvosConceder(r, todos, 'admin@example.com');
  assert.equal(a.elegiveis.length, 6);
  assert.deepEqual(a.ignoradas, { voce: 1, admin: 0, vitalicio: 1 });
  const b = S.alvosConceder(r, todos, 'outro@example.com');
  assert.deepEqual(b.ignoradas, { voce: 0, admin: 1, vitalicio: 1 });
  assert.equal(S.textoIgnoradasConceder(b.ignoradas), '1 vitalícia, 1 administrador');
  assert.equal(S.alvosConceder(r, ['ANA@example.com'], 'x').elegiveis.length, 1, 'e-mail sem diferença de caixa');
});

/* ----------------------------------------------------------------- CSV ----------------------------------------------------------------- */
test('csv: cabeçalho, ponto e vírgula, aspas e proteção contra fórmula do Excel', () => {
  const r = regs().filter((x) => !x.admin);
  const linhas = S.csv(r, AGORA).split('\r\n');
  assert.equal(linhas.length, 8);
  assert.equal(linhas[0], 'Nome;E-mail;CPF;Telefone;Conta;Situação;Plano;Forma de pagamento;Vencimento;Prazo');
  assert.ok(linhas[1].startsWith('Ana Paga;ana@example.com;111.222.333-44;'));
  assert.ok(linhas[1].includes(';Assinante;Mensal;Pix;'));
  const perigosa = S.registro(usuario({ name: '=HYPERLINK("http://x")', email: 'x@example.com' }), AGORA);
  const l = S.csv([perigosa], AGORA).split('\r\n')[1];
  assert.ok(l.startsWith('"\'=HYPERLINK(""http://x"")";'), l);
});

/* ----------------------------------------------------------------- HTML ----------------------------------------------------------------- */
test('paginaHTML: KPIs com os números certos, só contas de usuário na lista e receita estimada', () => {
  const h = S.paginaHTML(ctx(massa()));
  assert.ok(h.includes('id="asRaiz"') && h.includes('id="asLista"') && h.includes('id="asResumo"'));
  assert.ok(/data-as-kpi="paga"[^>]*>(?:(?!<\/button>).)*<span class="adm-kpi-n">2<\/span>/s.test(h));
  assert.ok(/data-as-kpi="vencendo"[^>]*is-atencao|is-atencao[^>]*data-as-kpi="vencendo"/.test(h), 'vence em 7 dias pede atenção');
  assert.ok(h.includes('R$ 36,00'), 'receita estimada = 2 assinantes × R$ 18,00');
  assert.equal((h.match(/<tr class="adm-lin as-lin/g) || []).length, 7, 'administrador não aparece');
  assert.ok(!h.includes('chefe') && !h.includes('Chefe Admin'));
  assert.ok(h.includes('Assinaturas') && h.includes('data-as-a="exportar"') && h.includes('data-as-a="sincronizar"'));
});

test('paginaHTML sem preço não mostra a receita; sem contas mostra o estado vazio', () => {
  assert.ok(!S.paginaHTML(ctx(massa(), { preco: { numero: 0 } })).includes('Receita mensal estimada'));
  const vazio = S.paginaHTML(ctx([usuario({ role: 'Administrador' })]));
  assert.ok(vazio.includes('Nenhuma conta de usuário ainda'));
});

test('cada situação mostra o próximo passo certo na linha', () => {
  const por = (u) => S.acaoRapida(reg(u), AGORA);
  assert.equal(por(usuario({ subscription_status: 'pending_payment' })).rotulo, 'Confirmar pagamento');
  assert.equal(por(usuario({ subscription_status: 'expired', subscription_expires_at: iso(AGORA - DIA) })).rotulo, 'Liberar mensal');
  assert.equal(por(usuario()).rotulo, 'Liberar mensal');
  assert.equal(por(paga({}, 3)).rotulo, 'Liberar mensal', 'vence logo: renovar');
  assert.equal(por(paga({}, 25)), null, 'assinante em dia: sem atalho (dar tempo a quem paga troca o plano para cortesia)');
  const cortesia = por(paga({ subscription_plan: 'cortesia_admin', subscription_method: 'admin_cortesia' }, 25));
  assert.equal(cortesia.a, 'conceder'); assert.equal(cortesia.min, 43200);
  assert.equal(por(usuario({ subscription_status: 'active', subscription_plan: 'vitalicio' })), null, 'vitalício não tem o que fazer');
});

test('a linha da própria conta não oferece ação nem seleção', () => {
  const eu = usuario({ email: 'admin@example.com', name: 'Eu Mesmo', subscription_status: 'expired', subscription_expires_at: iso(AGORA - DIA) });
  const h = S.paginaHTML(ctx([eu]));
  assert.ok(/data-as-sel="admin@example.com" disabled/.test(h));
  assert.ok(!/data-as-a="mensal"/.test(h));
});

test('nomes e e-mails com HTML são escapados (lista, cartões e gaveta)', () => {
  const mau = usuario({ name: '<img src=x onerror=alert(1)>', email: 'mau"@example.com' });
  const c = ctx([mau]);
  const h = S.paginaHTML(c);
  assert.ok(!h.includes('<img src=x'), 'sem tag solta na lista');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  const m = S.calcular(c);
  const g = S.detalheHTML(m.todos[0], m, c);
  assert.ok(!g.includes('<img src=x') && !g.includes('mau"@'));
});

test('barra de lote: contadores só das contas que a ação alcança', () => {
  const c = ctx(massa());
  const m = S.calcular(c);
  S.estado.sel = { 'ana@example.com': true, 'gabi@example.com': true, 'cintia@example.com': true };
  try {
    const h = S.htmlSelecao(m);
    assert.ok(h.includes('3 selecionadas'));
    assert.ok(h.includes('Dar tempo (2)'), 'vitalícia fica de fora');
    assert.ok(h.includes('Expirar (1)'), 'só a assinatura ativa (Ana) pode expirar');
    assert.ok(h.includes('id="asLoteTempo"'));
    S.estado.sel = { 'gabi@example.com': true };
    const so = S.htmlSelecao(m);
    assert.ok(so.includes('data-as-a="lote-conceder" disabled') && so.includes('data-as-a="lote-expirar" disabled'));
    S.estado.sel = {};
    assert.equal(S.htmlSelecao(m), '');
  } finally { S.estado.sel = {}; }
});

test('gaveta: ações de liberar, dar tempo, bloquear e reiniciar; desabilita bloquear em conta já encerrada', () => {
  const c = ctx(massa(), { eventos: () => [{ action: 'Assinatura', details: 'Administrador concedeu 7 dia(s) grátis', timestamp: iso(AGORA - HORA) }] });
  const m = S.calcular(c);
  const ana = m.todos.find((x) => x.email === 'ana@example.com');
  const h = S.detalheHTML(ana, m, c);
  assert.ok(h.includes('Liberar mensal (R$ 18,00)'));
  for (const min of [60, 1440, 10080, 43200, 525600]) assert.ok(h.includes('data-as-a="conceder" data-min="' + min + '"'), 'atalho ' + min);
  assert.ok(h.includes('data-as-a="vitalicio"') && h.includes('data-as-a="custom"'));
  assert.ok(h.includes('id="asQtd"') && h.includes('id="asUnid"'));
  assert.ok(h.includes('data-as-a="teste"') && h.includes('data-as-a="boleto"') && h.includes('data-as-a="cadastro"'));
  assert.ok(/data-as-a="bloquear"[^>]*>/.test(h) && !/data-as-a="bloquear"[^>]* disabled/.test(h));
  assert.ok(h.includes('Administrador concedeu 7 dia(s) grátis'), 'histórico');
  assert.ok(h.includes('vence em 3 dias'));
  assert.ok(h.includes('as-aviso') && h.includes('passa a constar como <b>cortesia</b>'), 'quem paga é avisado de que dar tempo vira cortesia');
  const davi = m.todos.find((x) => x.email === 'davi@example.com');
  assert.ok(/data-as-a="bloquear"[^>]* disabled/.test(S.detalheHTML(davi, m, c)), 'já está sem acesso');
  assert.ok(!S.detalheHTML(davi, m, c).includes('as-aviso'), 'o aviso é só para quem paga');
  const fabio = m.todos.find((x) => x.email === 'fabio@example.com');
  assert.ok(!S.detalheHTML(fabio, m, c).includes('as-aviso'), 'cortesia já é cortesia');
});

test('gaveta da própria conta não tem ações de assinatura', () => {
  const c = ctx([usuario({ email: 'admin@example.com' })]);
  const m = S.calcular(c);
  const h = S.detalheHTML(m.todos[0], m, c);
  assert.ok(h.includes('Esta é a sua conta'));
  assert.ok(!h.includes('data-as-a="mensal"') && !h.includes('data-as-a="conceder"'));
});

test('limitarLargura: respeita o mínimo, deixa uma faixa da tela e cai no padrão com valor inválido', () => {
  assert.equal(S.LARG_PADRAO, 1040, 'janela no meio da tela: larga o bastante para situação e ações lado a lado');
  assert.equal(S.limitarLargura(700, 1440), 700);
  assert.equal(S.limitarLargura(100, 1440), S.LARG_MIN, 'não fica menor que o mínimo');
  assert.equal(S.limitarLargura(5000, 1440), 1400, 'deixa 20 px de cada lado de fundo clicável para fechar');
  assert.equal(S.limitarLargura(5000, 1000), 960);
  assert.equal(S.limitarLargura(S.LARG_PADRAO, 1000), 960, 'o padrão nunca passa da tela');
  assert.equal(S.limitarLargura('abc', 1440), S.LARG_PADRAO);
  assert.equal(S.limitarLargura(null, 1440), S.LARG_PADRAO);
  assert.equal(S.limitarLargura(undefined, 1440), S.LARG_PADRAO);
  assert.equal(S.limitarLargura('', 1440), S.LARG_PADRAO);
  assert.equal(S.limitarLargura(NaN, 1440), S.LARG_PADRAO);
  assert.equal(S.limitarLargura(0, 1440), S.LARG_MIN, 'arrastou até a borda: fica no mínimo, não volta ao padrão');
  assert.equal(S.limitarLargura(-250, 1440), S.LARG_MIN, 'arrastou para além da borda direita');
  assert.equal(S.limitarLargura(612.7, 1440), 613, 'arredonda');
  assert.equal(S.limitarLargura(900, 420), S.LARG_MIN, 'tela menor que o mínimo: o mínimo vale (no celular o CSS usa a tela toda)');
});

test('gaveta: tem a alça de largura (acessível por teclado) e o botão de tela cheia', () => {
  const c = ctx(massa());
  const m = S.calcular(c);
  const h = S.detalheHTML(m.todos[0], m, c);
  assert.ok(/id="asDrAlca" data-as-alca role="separator" aria-orientation="vertical" tabindex="0"/.test(h));
  assert.ok(/aria-valuemin="520" aria-valuenow="1040"/.test(h));
  assert.ok(/data-as-a="expandir" aria-pressed="false"/.test(h) && h.includes('Ocupar a tela toda'));
  assert.ok(h.includes('as-dr-a') && h.includes('as-dr-b') && h.includes('as-dr-c'), 'blocos para o painel largo ficar em duas colunas');
  const ordem = ['as-dr-a', 'as-dr-b', 'as-dr-c'].map((k) => h.indexOf('class="' + k + '"'));
  assert.ok(ordem[0] < ordem[1] && ordem[1] < ordem[2], 'em painel estreito a ordem continua situação, ações, histórico');
});

test('o nome da pessoa é um botão que abre o painel (lista e cartões), com o nome escapado', () => {
  const c = ctx(massa());
  const h = S.paginaHTML(c);
  assert.ok(/<button type="button" class="adm-nome as-nome" data-as-abrir="ana@example.com" title="Abrir a assinatura de Ana Paga">Ana Paga<\/button>/.test(h));
  assert.equal((h.match(/class="adm-nome as-nome"/g) || []).length, 14, '7 contas na tabela + 7 nos cartões');
  const mau = ctx([usuario({ name: '"><script>x</script>', email: 'm@example.com' })]);
  assert.ok(!S.paginaHTML(mau).includes('<script>x</script>'));
});

test('a aba entra no menu do topo do painel, na segunda posição', () => {
  const h = Adm.shellHTML('assinaturas', { contagens: {}, eu: { email: 'a@a', nome: 'A' }, corpo: '' });
  const ids = (h.match(/data-adm-ir="([a-z]+)"/g) || []).map((x) => x.slice(13, -1));
  assert.deepEqual(ids, ['usuarios', 'assinaturas', 'pagamentos', 'logs']);
  assert.ok(/data-adm-ir="assinaturas" aria-selected="true" aria-current="page"/.test(h));
});

test('filtro "Vencem hoje": só paga ou cortesia que vence nas próximas 24 h', () => {
  const hoje = usuario({ id: 10, name: 'Hoje Paga', email: 'hoje@example.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: iso(AGORA + 5 * HORA) });
  const amanha = usuario({ id: 11, name: 'Amanha Paga', email: 'amanha@example.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: iso(AGORA + 30 * HORA) });
  const r = [hoje, amanha].map(reg);
  assert.deepEqual(S.filtrar(r, { sit: 'hoje' }, AGORA).map((x) => x.nome), ['Hoje Paga']);
  assert.equal(S.venceHoje(r[0], AGORA), true);
  assert.equal(S.venceHoje(r[1], AGORA), false, '30 h é "vencendo", não "hoje"');
  assert.deepEqual(S.filtrar(r, { sit: 'vencendo' }, AGORA).map((x) => x.nome), ['Hoje Paga', 'Amanha Paga']);
});

test('ordenar por último acesso: datas ausentes ficam no fim', () => {
  const r = regs();
  r[0].ultimoLogin = AGORA - HORA;
  r[1].ultimoLogin = AGORA - 2 * DIA;
  const nomes = S.ordenar(r, 'login:desc', AGORA).map((x) => x.nome);
  assert.deepEqual(nomes.slice(0, 2), ['Ana Paga', 'Bruno Longe']);
  assert.equal(nomes[nomes.length - 1], 'Gabi Vitalicia', 'sem login vai para o fim (desempate por nome)');
});

test('alvosMensal: pendente, encerrada, teste e quem vence entram; em dia, vitalício e admin ficam de fora', () => {
  const r = regs();
  const todos = r.map((x) => x.email);
  const a = S.alvosMensal(r, todos, 'admin@example.com', AGORA);
  // Ana vence em 3 dias (renovação), Bruno em 25 (em dia), Cíntia pendente, Davi encerrado, Eva teste, Fábio cortesia em 10d (em dia), Gabi vitalícia
  // o admin do teste é o próprio eu: conta como "sua conta", não como administrador
  assert.deepEqual(a.elegiveis.map((x) => x.nome).sort(), ['Ana Paga', 'Cíntia Pendente', 'Davi Encerrado', 'Eva Teste']);
  assert.deepEqual(a.ignoradas, { voce: 1, admin: 0, vitalicio: 1, emDia: 2 });
  const b = S.alvosMensal(r, todos, 'ana@example.com', AGORA);
  assert.equal(b.ignoradas.voce, 1);
  assert.equal(S.textoIgnoradasMensal(b.ignoradas), '2 contas já em dia, 1 vitalícia, 1 administrador, a sua conta');
});

test('barra de lote mostra "Liberar mensal" com a contagem certa', () => {
  const c = ctx(massa());
  const m = S.calcular(c);
  S.estado.sel = { 'ana@example.com': true, 'bruno@example.com': true, 'cintia@example.com': true };
  try {
    const h = S.htmlSelecao(m);
    assert.ok(h.includes('Liberar mensal (2)'), 'Ana (vence logo) e Cíntia (pendente); Bruno em dia fica de fora');
    S.estado.sel = { 'bruno@example.com': true };
    assert.ok(S.htmlSelecao(m).includes('data-as-a="lote-mensal" disabled'), 'só quem está em dia: botão desabilitado');
  } finally { S.estado.sel = {}; }
});

test('gaveta: dados da conta (CPF, telefone, nascimento, acesso, cadastro) e barra de progresso do período', () => {
  const c = ctx(massa(), { eventos: () => [] });
  const m = S.calcular(c);
  const ana = m.todos.find((x) => x.email === 'ana@example.com');
  const h = S.detalheHTML(ana, m, c);
  assert.ok(h.includes('<h4>Dados da conta</h4>'));
  assert.ok(h.includes('111.222.333-44'), 'CPF formatado');
  assert.ok(h.includes('class="as-prog"'), 'assinante pago tem a barra do período');
  assert.ok(/aria-valuenow="\d+"/.test(h));
  const eva = m.todos.find((x) => x.email === 'eva@example.com');
  assert.ok(!S.detalheHTML(eva, m, c).includes('class="as-prog"'), 'teste não tem barra de período mensal');
});
