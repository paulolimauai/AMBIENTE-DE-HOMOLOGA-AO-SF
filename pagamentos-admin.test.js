'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('./pagamentos-admin.js');
const P = require('./pagamentos.js');

const AGORA = Date.parse('2026-11-15T15:00:00Z');
const DIA = 86400000;
const eu = { nome: 'Paulo', email: 'admin@nexus.com' };

function reg(extra, pago) {
  const r = P.criarCobranca({ usuario: { email: (extra && extra.email) || 'ana@x.com', name: (extra && extra.nome) || 'Ana Souza' }, valor: 18, vencimento: '2026-11-18', agora: AGORA - 2 * DIA, por: eu });
  if (pago) P.marcarPaga(r, { agora: AGORA - DIA, por: eu });
  return P.publico(r, AGORA);
}
function dados(pagamentos, usuarios) {
  return { success: true, preco: 18, pix: { chave: '(62) 99234-5372', favorecido: 'PAULO LIMA' }, pagamentos, resumo: P.resumo({ pagamentos, usuarios: usuarios || [], agora: AGORA, preco: 18 }) };
}

test('moeda e telefone: formato brasileiro e WhatsApp com 55', () => {
  assert.equal(N.moeda(18), 'R$ 18,00');
  assert.equal(N.moeda(1234.5), 'R$ 1.234,50');
  assert.equal(N.telefoneWhats('(62) 99234-5372'), '5562992345372');
  assert.equal(N.telefoneWhats('+55 62 99234-5372'), '5562992345372');
  assert.equal(N.telefoneWhats('62 3234-5372'), '556232345372');
  assert.equal(N.telefoneWhats('123'), '');
  assert.equal(N.telefoneWhats(''), '');
});

test('filtrar: por situação, mês e busca sem acento', () => {
  const a = reg({ email: 'ana@x.com', nome: 'Ana Souza' });
  const b = reg({ email: 'joao@x.com', nome: 'João Pereira' }, true);
  const lista = [a, b];
  assert.equal(N.filtrar(lista, { situacao: 'todas' }).length, 2);
  assert.deepEqual(N.filtrar(lista, { situacao: 'paga' }).map((p) => p.email), ['joao@x.com']);
  assert.deepEqual(N.filtrar(lista, { situacao: 'abertas' }).map((p) => p.email), ['ana@x.com']);
  assert.deepEqual(N.filtrar(lista, { busca: 'joao pereira' }).map((p) => p.email), ['joao@x.com']);
  assert.deepEqual(N.filtrar(lista, { busca: 'JOAO' }).map((p) => p.email), ['joao@x.com']);
  assert.deepEqual(N.filtrar(lista, { busca: a.ref.toLowerCase() }).map((p) => p.email), ['ana@x.com']);
  assert.equal(N.filtrar(lista, { mes: '2026-11' }).length, 2);
  assert.equal(N.filtrar(lista, { mes: '2026-10' }).length, 0);
});

test('paginar limita a página e corrige números fora do intervalo', () => {
  const l = Array.from({ length: 53 }, (_, i) => i);
  const p = N.paginar(l, 3, 25);
  assert.equal(p.itens.length, 3);
  assert.equal(p.paginas, 3);
  assert.equal(N.paginar(l, 99, 25).pagina, 3);
  assert.equal(N.paginar(l, -4, 25).pagina, 1);
  assert.equal(N.paginar([], 1, 25).paginas, 1);
});

test('mensagemWhats leva o Pix copia e cola, o valor e a referência (não só a chave)', () => {
  const payload = P.pixPayload({ chave: '+5562992345372', nome: 'Paulo Lima', cidade: 'Goiania', valor: 18, txid: 'NXABC123' });
  const m = N.mensagemWhats({ tipo: 'cobranca', nome: 'Ana Souza', valor: 18, vencimento: '18/11/2026', payload, ref: 'NXABC123', chave: '(62) 99234-5372', favorecido: 'PAULO LIMA' });
  assert.match(m, /^Olá, Ana!/);
  assert.match(m, /R\$ 18,00/);
  assert.match(m, /18\/11\/2026/);
  assert.ok(m.includes(payload), 'o código copia e cola está inteiro na mensagem');
  assert.match(m, /Referência: NXABC123/);
  const l = N.mensagemWhats({ tipo: 'lembrete', nome: 'Ana', valor: 18, dias: 3, expira: '18/11/2026', payload });
  assert.match(l, /vence em 3 dias/);
  assert.match(N.mensagemWhats({ tipo: 'lembrete', nome: 'Ana', valor: 18, dias: 0, payload }), /vence hoje/);
  assert.match(N.mensagemWhats({ tipo: 'vencido', nome: 'Ana', valor: 18, expira: '10/11/2026', payload }), /expirou em 10\/11\/2026/);
});

test('linkWhats só existe com telefone válido e codifica a mensagem', () => {
  assert.equal(N.linkWhats('', 'oi'), '');
  const l = N.linkWhats('(62) 99234-5372', 'olá & tchau');
  assert.match(l, /^https:\/\/wa\.me\/5562992345372\?text=/);
  assert.ok(l.includes(encodeURIComponent('olá & tchau')));
});

test('resumoHTML mostra receita, MRR e listas sem quebrar com dados vazios', () => {
  const html = N.resumoHTML(dados([]));
  assert.match(html, /Receita do mês/);
  assert.match(html, /R\$ 0,00/);
  assert.match(html, /Nenhum pagamento esperando confirmação/);
  assert.match(html, /Nenhuma assinatura vence nos próximos 7 dias/);
  const com = N.resumoHTML(dados([reg({ email: 'a@x.com' }), reg({ email: 'b@x.com' }, true)]));
  assert.match(com, /data-pg-ir="cobrancas:aguardando"/);
  assert.match(com, /pg-barras/);
  assert.equal((com.match(/class="pg-barra( |")/g) || []).length, 6);
});

test('cobrancasHTML: linha com ações certas por situação e checkbox só nas abertas', () => {
  const aberta = reg({ email: 'a@x.com' });
  const paga = reg({ email: 'b@x.com' }, true);
  const html = N.cobrancasHTML({ filtro: { busca: '', situacao: 'todas', mes: 'todos' }, pagina: 1, porPagina: 25, sel: {}, nova: {}, conc: {} }, dados([aberta, paga]));
  assert.match(html, /data-pg-a="confirmar"/);
  assert.match(html, /data-pg-a="pix"/);
  assert.match(html, /data-pg-a="cancelar"/);
  assert.match(html, /data-pg-a="recibo"/);
  assert.match(html, /data-pg-a="estornar"/);
  assert.equal((html.match(/data-pg-a="historico"/g) || []).length, 2);
  const caixas = html.match(/<input type="checkbox" class="adm-chk" data-pg-sel="[^"]+"[^>]*>/g) || [];
  assert.equal(caixas.length, 2);
  assert.equal(caixas.filter((c) => / disabled/.test(c)).length, 1, 'a paga não pode ser selecionada para confirmar em lote');
});

test('cobrancasHTML com seleção mostra a barra de lote', () => {
  const a = reg({ email: 'a@x.com' });
  const html = N.cobrancasHTML({ filtro: { busca: '', situacao: 'todas', mes: 'todos' }, pagina: 1, porPagina: 25, sel: { [a.id]: true }, nova: {}, conc: {} }, dados([a]));
  assert.match(html, /1 selecionada/);
  assert.match(html, /data-pg-a="confirmar-lote"/);
});

test('todo texto vindo de cliente é escapado nas telas (nome com HTML não executa)', () => {
  const ruim = reg({ email: 'x@y.com', nome: '<img src=x onerror=alert(1)>' });
  const html = N.cobrancasHTML({ filtro: { busca: '', situacao: 'todas', mes: 'todos' }, pagina: 1, porPagina: 25, sel: {}, nova: {}, conc: {} }, dados([ruim]));
  assert.ok(!html.includes('<img src=x'));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const acessos = N.acessosHTML(dados([], [{ email: 'a@x.com', name: '<script>1</script>', subscription_status: 'expired', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA - 3 * DIA).toISOString() }]));
  assert.ok(!acessos.includes('<script>1'));
  assert.match(acessos, /Expirou há 3 dias/);
});

test('acessosHTML lista vencimentos e expirados com os botões de cobrança', () => {
  const us = [
    { email: 'v@x.com', name: 'Vence Logo', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(AGORA + 2 * DIA).toISOString() },
    { email: 'e@x.com', name: 'Já Expirou', subscription_status: 'expired', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA - 9 * DIA).toISOString() }
  ];
  const html = N.acessosHTML(dados([], us));
  assert.match(html, /Enviar lembrete/);
  assert.match(html, /data-tipo="lembrete" data-dias="2"/);
  assert.match(html, /Recebi o pagamento/);
  assert.match(html, /Cobrar \(2ª via\)/);
  assert.match(html, /Expirou há 9 dias/);
});

test('novaHTML lista só contas de usuário e não oferece administrador', () => {
  const html = N.novaHTML({ nova: { email: '', cliente: '', venc: '', obs: '', resultado: null, erro: '', enviando: false }, dados: { preco: 18 } }, { usuarios: [{ email: 'a@x.com', name: 'Ana', role: 'Usuário' }, { email: 'adm@x.com', name: 'Chefe', role: 'Administrador' }] });
  assert.match(html, /Ana — a@x\.com/);
  assert.ok(!/Chefe/.test(html));
  assert.match(html, /R\$ 18,00/);
});

test('cobrancaResultadoHTML traz QR local, copia e cola e botão de WhatsApp', () => {
  const payload = P.pixPayload({ chave: '+5562992345372', nome: 'Paulo Lima', cidade: 'Goiania', valor: 18, txid: 'NXABC123' });
  const html = N.cobrancaResultadoHTML({ reutilizada: true, pagamento: { id: 'PG-1', nome: 'Ana', email: 'a@x.com', valor: 18, vencimento: '2026-11-18', ref: 'NXABC123' }, pix: { payload, qr_url: '/api/pix/qr.svg?data=' + encodeURIComponent(payload), chave: '(62) 99234-5372', favorecido: 'PAULO LIMA' } }, { phone: '(62) 99234-5372' });
  assert.match(html, /src="\/api\/pix\/qr\.svg\?data=/);
  assert.ok(!/qrserver/.test(html));
  assert.ok(html.includes(payload));
  assert.match(html, /wa\.me\/5562992345372/);
  assert.match(html, /2ª via da mesma cobrança/);
  assert.match(html, /não um boleto bancário registrado/);
});

test('documentos para imprimir: cobrança e recibo são HTML completo e escapado', () => {
  const doc = N.cobrancaDocumento({ pagamento: { nome: '<b>X</b>', email: 'a@x.com', valor: 18, vencimento: '2026-11-18', ref: 'NXABC123' }, pix: { payload: '000201', qr_url: '/api/pix/qr.svg?data=000201', chave: '(62) 99234-5372', favorecido: 'PAULO LIMA' } }, 'http://localhost:3000');
  assert.match(doc, /^<!doctype html>/);
  assert.ok(!doc.includes('<b>X</b>'));
  assert.match(doc, /src="http:\/\/localhost:3000\/api\/pix\/qr\.svg/);
  assert.match(doc, /não é um boleto bancário registrado/);
  const rec = N.reciboDocumento(Object.assign({}, reg({ email: 'a@x.com' }, true), { confirmado_por: { nome: 'Paulo', email: 'p@x.com' } }));
  assert.match(rec, /Recibo de pagamento/);
  assert.match(rec, /R\$ 18,00/);
  assert.match(rec, /Não é documento fiscal/);
});

test('conciliarHTML mostra sugestões com força e ação de confirmar', () => {
  const resultado = { formato: 'ofx', lancamentos: 3, creditos: 2, ja_conciliados: 0, sem_par: [{ data: '2026-11-14', valor: 50, descricao: 'PIX DE FULANO', hash: 'h1' }], sugestoes: [
    { lancamento: { data: '2026-11-14', valor: 18, descricao: 'PIX ANA SOUZA', hash: 'h2' }, pagamento: { id: 'PG-1', ref: 'NXA', nome: 'Ana Souza', email: 'a@x.com', valor: 18 }, forca: 'forte', motivo: 'Mesmo valor e nome: ANA SOUZA' }
  ] };
  const html = N.conciliarHTML({ conc: { resultado, enviando: false, nome: 'extrato.ofx', erro: '' } });
  assert.match(html, /Confirmar todas as fortes/);
  assert.match(html, /data-pg-a="conc-confirmar" data-i="0"/);
  assert.match(html, /Entradas do extrato sem cobrança correspondente \(1\)/);
  assert.match(html, /apenas sugere/);
});

test('solicitacoesHTML mostra o aviso vazio e as linhas com abrir/gerar Pix', () => {
  assert.match(N.solicitacoesHTML({ ordens: [] }), /Nenhuma solicitação de boleto pendente/);
  const h = N.solicitacoesHTML({ ordens: [{ id: 7, protocol: 'OS-0007', nome: 'Ana', email: 'a@x.com', titulo: '2ª via de boleto', status: 'Novo' }] });
  assert.match(h, /OS-0007/);
  assert.match(h, /data-pg-a="abrir-os" data-id="7"/);
  assert.match(h, /data-pg-a="cobrar" data-email="a@x\.com"/);
});

test('navHTML marca a seção ativa e mostra o contador de aguardando', () => {
  const h = N.navHTML('cobrancas', { aguardando: 4, solicitacoes: 0 });
  assert.match(h, /data-pg-aba="cobrancas" aria-selected="true"/);
  assert.match(h, /data-pg-aba="resumo" aria-selected="false"/);
  assert.match(h, /adm-tab-warn">4</);
});


test('cobrança mensal automática: o resumo explica a regra do dia 5 e a lista marca a cobrança gerada sozinha', () => {
  const auto = P.publico(P.criarCobranca({ usuario: { email: 'a@x.com', name: 'Ana Souza' }, valor: 18, vencimento: '2026-11-08', origem: 'automatica', competencia: '2026-11', agora: AGORA }), AGORA);
  const d = Object.assign(dados([auto]), { cobranca_mensal: { dia: 5, prazo_dias: 3, proxima: '2026-12-05' } });
  const resumo = N.resumoHTML(d);
  assert.match(resumo, /Todo dia 5 o sistema gera sozinho a cobrança Pix de R\$ 18,00/);
  assert.match(resumo, /vence 3 dias depois/);
  assert.match(resumo, /Próxima geração: <b>05\/12\/2026<\/b>/);
  const lista = N.cobrancasHTML({ filtro: { busca: '', situacao: 'todas', mes: 'todos' }, pagina: 1, porPagina: 25, sel: {}, nova: {}, conc: {} }, d);
  assert.match(lista, /gerada sozinha · nov\/2026/);
  assert.match(lista, /data-pg-a="gerar-mensal"/);
  assert.match(lista, /todo dia 5/);
  // servidor antigo, sem a configuração: nada quebra e o botão continua com o dia padrão
  assert.ok(!/Todo dia/.test(N.resumoHTML(dados([auto]))));
  assert.match(N.cobrancasHTML({ filtro: { busca: '', situacao: 'todas', mes: 'todos' }, pagina: 1, porPagina: 25, sel: {}, nova: {}, conc: {} }, dados([auto])), /data-pg-a="gerar-mensal"/);
});
