'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./pagamentos.js');
const { qrSvg } = require('./qr-svg.js');

const AGORA = Date.parse('2026-11-15T15:00:00Z'); // 12:00 em Brasília
const DIA = P.DIA;
const PRECO = 18;
const eu = { nome: 'Paulo', email: 'admin@nexus.com' };

function usuario(extra) {
  return Object.assign({ email: 'ana@x.com', name: 'Ana Souza', role: 'Usuário', phone: '(62) 99999-0000' }, extra || {});
}

/* ---------------------------------------------------------------- registros e prazo */
test('criarCobranca grava o valor cobrado, uma referência de Pix válida e o primeiro evento', () => {
  const r = P.criarCobranca({ usuario: usuario(), valor: 18, vencimento: '2026-11-18', agora: AGORA, por: eu });
  assert.equal(r.status, 'emitida');
  assert.equal(r.valor, 18);
  assert.match(r.ref, /^NX[A-Z0-9]{4,23}$/);
  assert.ok(r.ref.length <= 25);
  assert.equal(r.vencimento, '2026-11-18');
  assert.equal(r.historico.length, 1);
  assert.equal(r.historico[0].acao, 'emitida');
});

test('criarCobranca recusa valor inválido ou sem e-mail e ignora data de vencimento impossível', () => {
  assert.throws(() => P.criarCobranca({ usuario: usuario(), valor: 0, agora: AGORA }));
  assert.throws(() => P.criarCobranca({ usuario: usuario(), valor: 999999, agora: AGORA }));
  assert.throws(() => P.criarCobranca({ usuario: { name: 'x' }, valor: 18, agora: AGORA }));
  assert.equal(P.criarCobranca({ usuario: usuario(), valor: 18, vencimento: '2026-02-31', agora: AGORA }).vencimento, null);
});

test('referências não se repetem entre cobranças existentes', () => {
  const vistos = new Set();
  for (let i = 0; i < 200; i++) {
    const ref = P.novaReferencia(AGORA, vistos);
    assert.ok(!vistos.has(ref));
    vistos.add(ref);
  }
});

test('situacao: emitida vence depois da data; informada fica aguardando; estados finais não mudam', () => {
  const r = P.criarCobranca({ usuario: usuario(), valor: 18, vencimento: '2026-11-14', agora: AGORA });
  assert.equal(P.situacao(r, AGORA), 'vencida');
  r.vencimento = '2026-11-15';
  assert.equal(P.situacao(r, AGORA), 'emitida');
  P.marcarInformada(r, { agora: AGORA, comprovante: 'abc123' });
  assert.equal(P.situacao(r, AGORA), 'aguardando');
  assert.equal(r.comprovante, 'abc123');
  P.marcarPaga(r, { agora: AGORA, por: eu });
  assert.equal(P.situacao(r, AGORA + 40 * DIA), 'paga');
});

test('calcularPeriodo soma ao que ainda resta e começa do zero quando já venceu', () => {
  const resta = AGORA + 10 * DIA;
  const a = P.calcularPeriodo({ plano: 'mensal', expiraAtualMs: resta, agora: AGORA });
  assert.equal(a.inicio, resta);
  assert.equal(a.fim, resta + 30 * DIA);
  const b = P.calcularPeriodo({ plano: 'mensal', expiraAtualMs: AGORA - DIA, agora: AGORA });
  assert.equal(b.inicio, AGORA);
  assert.equal(b.fim, AGORA + 30 * DIA);
  const c = P.calcularPeriodo({ plano: 'mensal', expiraAtualMs: NaN, agora: AGORA });
  assert.equal(c.fim, AGORA + 30 * DIA);
  assert.equal(P.calcularPeriodo({ plano: 'anual', agora: AGORA }).dias, 365);
  assert.equal(P.calcularPeriodo({ plano: 'vitalicio', agora: AGORA }).fim, P.FIM_VITALICIO);
});

test('marcarPaga registra valor recebido, quem confirmou e o período coberto', () => {
  const r = P.criarCobranca({ usuario: usuario(), valor: 18, agora: AGORA });
  P.marcarPaga(r, { agora: AGORA, por: eu, valor: 20, expiraAtualMs: AGORA + 5 * DIA, nota: 'Pix' });
  assert.equal(r.status, 'paga');
  assert.equal(r.valor, 20);
  assert.equal(r.confirmado_por.email, 'admin@nexus.com');
  assert.equal(Date.parse(r.periodo_inicio), AGORA + 5 * DIA);
  assert.equal(Date.parse(r.periodo_fim), AGORA + 35 * DIA);
  assert.equal(r.dias, 30);
});

test('valorConfirmado: padrão, vírgula brasileira, e recusa de zero, negativo e absurdo', () => {
  assert.equal(P.valorConfirmado(undefined, 18), 18);
  assert.equal(P.valorConfirmado('18,00', 18), 18);
  assert.equal(P.valorConfirmado('1.234,50', 18), 1234.5);
  assert.equal(P.valorConfirmado('18.00', 18), 18, 'ponto decimal não pode virar 1800');
  assert.equal(P.valorConfirmado('R$ 18,00', 18), 18);
  assert.ok(Number.isNaN(P.valorConfirmado(0, 18)));
  assert.ok(Number.isNaN(P.valorConfirmado(-5, 18)));
  assert.ok(Number.isNaN(P.valorConfirmado(1e9, 18)));
  assert.ok(Number.isNaN(P.valorConfirmado('abc', 18)));
});

test('cancelar só vale para aberta; estornar só para paga', () => {
  const r = P.criarCobranca({ usuario: usuario(), valor: 18, agora: AGORA });
  assert.equal(P.estornar(r, eu, '', AGORA), false);
  assert.equal(P.cancelar(r, eu, 'duplicada', AGORA), true);
  assert.equal(r.status, 'cancelada');
  assert.equal(P.cancelar(r, eu, '', AGORA), false);
  const p = P.criarCobranca({ usuario: usuario(), valor: 18, agora: AGORA });
  P.marcarPaga(p, { agora: AGORA, por: eu });
  assert.equal(P.cancelar(p, eu, '', AGORA), false);
  assert.equal(P.estornar(p, eu, 'devolvido', AGORA), true);
  assert.equal(p.status, 'estornada');
});

test('o histórico de um registro é limitado (não cresce sem fim)', () => {
  const r = P.criarCobranca({ usuario: usuario(), valor: 18, agora: AGORA });
  for (let i = 0; i < 100; i++) P.evento(r, 'nota', eu, 'n' + i, AGORA);
  assert.ok(r.historico.length <= 40);
});

test('sincronizarLegado importa o aviso de pagamento antigo uma vez só', () => {
  const us = [
    usuario({ email: 'a@x.com', subscription_status: 'pending_payment', subscription_payment_id: 'NEXUS-SUB-111-AB-REF-XYZ9' }),
    usuario({ email: 'b@x.com', subscription_status: 'trial', subscription_payment_id: 'NEXUS-SUB-222-CD' }),
    usuario({ email: 'c@x.com', subscription_status: 'active', subscription_payment_id: 'NEXUS-SUB-333-EF' }),
    usuario({ email: 'adm@x.com', role: 'Administrador', subscription_status: 'pending_payment', subscription_payment_id: 'NEXUS-SUB-444' })
  ];
  const novos = P.sincronizarLegado(us, [], AGORA, PRECO);
  assert.equal(novos.length, 2);
  assert.ok(novos.every((n) => n.status === 'informada' && n.valor === 18 && n.origem === 'legado'));
  assert.equal(novos[0].comprovante, 'XYZ9');
  assert.equal(P.sincronizarLegado(us, novos, AGORA, PRECO).length, 0);
});

/* ---------------------------------------------------------------- resumo */
test('classificarUsuario usa a data (status "active" vencido é expirado)', () => {
  assert.equal(P.classificarUsuario(usuario({ subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA + DIA).toISOString() }), AGORA).chave, 'ativo');
  assert.equal(P.classificarUsuario(usuario({ subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA - DIA).toISOString() }), AGORA).chave, 'expirado');
  assert.equal(P.classificarUsuario(usuario({ subscription_plan: 'vitalicio' }), AGORA).chave, 'vitalicio');
  assert.equal(P.classificarUsuario(usuario({ role: 'Administrador' }), AGORA).chave, 'admin');
  assert.equal(P.classificarUsuario(usuario({ subscription_status: 'trial', trial_started_at: new Date(AGORA - 2 * DIA).toISOString() }), AGORA).chave, 'teste_fim');
  assert.equal(P.classificarUsuario(usuario({ subscription_status: 'trial', trial_started_at: new Date(AGORA - 3600000).toISOString() }), AGORA).chave, 'teste');
});

test('resumo: receita do mês e do anterior, série de 6 meses, MRR e listas', () => {
  const mk = (email, quando, valor) => { const r = P.criarCobranca({ usuario: usuario({ email }), valor, agora: quando }); P.marcarPaga(r, { agora: quando, por: eu }); return r; };
  const pags = [
    mk('a@x.com', Date.parse('2026-11-02T15:00:00Z'), 18),
    mk('b@x.com', Date.parse('2026-11-10T15:00:00Z'), 18),
    mk('a@x.com', Date.parse('2026-10-05T15:00:00Z'), 18),
    mk('c@x.com', Date.parse('2026-06-05T15:00:00Z'), 18)
  ];
  const estornada = mk('d@x.com', Date.parse('2026-11-03T15:00:00Z'), 18);
  P.estornar(estornada, eu, '', AGORA);
  const aberta = P.criarCobranca({ usuario: usuario({ email: 'e@x.com' }), valor: 18, vencimento: '2026-11-10', agora: AGORA - 5 * DIA });
  const inf = P.criarCobranca({ usuario: usuario({ email: 'f@x.com' }), valor: 18, agora: AGORA }); P.marcarInformada(inf, { agora: AGORA });
  const us = [
    usuario({ email: 'a@x.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(AGORA + 3 * DIA).toISOString() }),
    usuario({ email: 'b@x.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: new Date(AGORA + 20 * DIA).toISOString() }),
    usuario({ email: 'g@x.com', subscription_status: 'active', subscription_plan: 'cortesia_admin', subscription_method: 'admin_cortesia', subscription_expires_at: new Date(AGORA + 2 * DIA).toISOString() }),
    usuario({ email: 'h@x.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: new Date(AGORA - 4 * DIA).toISOString() }),
    usuario({ email: 'i@x.com', subscription_plan: 'vitalicio' }),
    usuario({ email: 'adm@x.com', role: 'Administrador' })
  ];
  const r = P.resumo({ pagamentos: pags.concat([estornada, aberta, inf]), usuarios: us, agora: AGORA, preco: PRECO });
  assert.equal(r.receita.mes, 36);
  assert.equal(r.receita.qtd_mes, 2);
  assert.equal(r.receita.mes_anterior, 18);
  assert.equal(r.receita.variacao_pct, 100);
  assert.equal(r.receita.novos_no_mes, 1, 'só b@x.com é cliente novo no mês');
  assert.equal(r.receita.total, 72, 'só contam as pagas: a estornada, a aberta e a informada ficam de fora');
  assert.equal(r.serie.length, 6);
  assert.deepEqual(r.serie.map((s) => s.rotulo), ['jun/26', 'jul/26', 'ago/26', 'set/26', 'out/26', 'nov/26']);
  assert.equal(r.serie[0].total, 18);
  assert.equal(r.serie[5].total, 36);
  assert.equal(r.pagantes, 2);
  assert.equal(r.cortesias, 1);
  assert.equal(r.vitalicios, 1);
  assert.equal(r.mrr, 36);
  assert.equal(r.expirados.qtd, 1);
  assert.equal(r.expirados.lista[0].email, 'h@x.com');
  assert.equal(r.expirados.lista[0].dias_atraso, 4);
  assert.equal(r.a_vencer_7d.qtd, 2);
  assert.equal(r.a_vencer_7d.valor_previsto, 18, 'cortesia não conta como receita prevista');
  assert.equal(r.aguardando.qtd, 1);
  assert.equal(r.emitidas.qtd, 1);
  assert.equal(r.emitidas.vencidas, 1);
  assert.equal(r.estornos_mes.qtd, 1);
});

test('resumo sem nada não quebra e devolve zeros', () => {
  const r = P.resumo({ pagamentos: [], usuarios: [], agora: AGORA, preco: 18 });
  assert.equal(r.receita.mes, 0);
  assert.equal(r.receita.variacao_pct, null);
  assert.equal(r.serie.length, 6);
  assert.equal(r.mrr, 0);
});

/* ---------------------------------------------------------------- CSV */
test('csv: separador ;, vírgula decimal, BOM e proteção contra fórmula', () => {
  const r = P.criarCobranca({ usuario: usuario({ name: '=HYPERLINK("x")' }), valor: 18, agora: AGORA });
  const c = P.csv([r], AGORA);
  assert.ok(c.startsWith('﻿'));
  assert.match(c, /18,00/);
  assert.ok(!/;=HYPERLINK/.test(c));
  assert.match(c, /'=HYPERLINK/);
  assert.equal(c.split('\r\n').length, 2);
});

/* ---------------------------------------------------------------- Pix */
test('crc16 confere o vetor CCITT-FALSE conhecido', () => {
  assert.equal(P.crc16('123456789'), '29B1');
});

test('pixPayload: campos, valor, txid e CRC válidos; nome e cidade sem acento', () => {
  const p = P.pixPayload({ chave: '+5562992345372', nome: 'Paulo Lima', cidade: 'Goiânia', valor: 18, txid: 'nx-abc123' });
  const l = P.pixLer(p);
  assert.ok(l.crcOk);
  assert.equal(l.campos['00'], '01');
  assert.equal(l.campos['53'], '986');
  assert.equal(l.campos['54'], '18.00');
  assert.equal(l.campos['58'], 'BR');
  assert.equal(l.campos['59'], 'PAULO LIMA');
  assert.equal(l.campos['60'], 'GOIANIA');
  assert.match(l.campos['26'], /BR\.GOV\.BCB\.PIX/);
  assert.match(l.campos['26'], /\+5562992345372/);
  assert.equal(l.campos['62'], '0508NXABC123'); // tag 05 (txid), 8 caracteres: "nx-abc123" sem o hífen e em maiúsculas
});

test('pixPayload sem valor omite o campo 54 e sem txid usa ***', () => {
  const l = P.pixLer(P.pixPayload({ chave: 'a@b.com', nome: 'X', cidade: 'Y' }));
  assert.ok(l.crcOk);
  assert.equal(l.campos['54'], undefined);
  assert.equal(l.campos['62'], '0503***');
});

test('qrSvg gera SVG local e recusa conteúdo vazio ou enorme', () => {
  const svg = qrSvg(P.pixPayload({ chave: '+5562992345372', nome: 'Paulo Lima', cidade: 'Goiania', valor: 18, txid: 'NXTESTE1' }));
  assert.match(svg, /^<svg /);
  assert.match(svg, /<path d="M/);
  assert.ok(!/https?:\/\//.test(svg.replace('http://www.w3.org/2000/svg', '')), 'o SVG não aponta para fora');
  assert.throws(() => qrSvg(''));
  assert.throws(() => qrSvg('x'.repeat(701)));
});

/* ---------------------------------------------------------------- extrato e conciliação */
const OFX = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261114120000[-3:BRT]<TRNAMT>18.00<FITID>AAA1<MEMO>PIX RECEBIDO ANA SOUZA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261114130000[-3:BRT]<TRNAMT>-50.00<FITID>AAA2<MEMO>COMPRA</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261115090000[-3:BRT]<TRNAMT>18,00<FITID>AAA3<MEMO>PIX NXREFCODE9 JOAO</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

test('lerExtrato lê OFX (tags sem fechamento, vírgula decimal) e guarda débito para ignorar depois', () => {
  const e = P.lerExtrato(OFX);
  assert.equal(e.formato, 'ofx');
  assert.equal(e.lancamentos.length, 3);
  assert.equal(e.lancamentos[0].data, '2026-11-14');
  assert.equal(e.lancamentos[0].valor, 18);
  assert.equal(e.lancamentos[1].valor, -50);
  assert.equal(e.lancamentos[2].valor, 18);
  assert.ok(e.lancamentos.every((l) => l.hash && l.hash.length === 16));
});

test('lerExtrato lê CSV com cabeçalho, ponto e vírgula e valores brasileiros', () => {
  const csv = 'Extrato\r\nData;Descrição;Valor;Saldo\r\n14/11/2026;"PIX RECEBIDO ANA SOUZA";18,00;100,00\r\n14/11/2026;COMPRA;-1.234,56;0,00\r\n';
  const e = P.lerExtrato(csv);
  assert.equal(e.formato, 'csv');
  assert.equal(e.lancamentos.length, 2);
  assert.equal(e.lancamentos[0].valor, 18);
  assert.equal(e.lancamentos[0].descricao, 'PIX RECEBIDO ANA SOUZA');
  assert.equal(e.lancamentos[1].valor, -1234.56);
});

test('lerExtrato com texto que não é extrato devolve lista vazia', () => {
  assert.equal(P.lerExtrato('olá mundo').lancamentos.length, 0);
  assert.equal(P.lerExtrato('').lancamentos.length, 0);
});

test('conciliar: código da cobrança e nome dão sugestão forte; débito é ignorado; cada cobrança casa uma vez', () => {
  const ana = P.criarCobranca({ usuario: usuario({ email: 'ana@x.com', name: 'Ana Souza' }), valor: 18, agora: AGORA - 2 * DIA });
  const joao = P.criarCobranca({ usuario: usuario({ email: 'joao@x.com', name: 'João Pereira' }), valor: 18, agora: AGORA - 2 * DIA, referencia: 'NXREFCODE9' });
  const { lancamentos } = P.lerExtrato(OFX);
  const r = P.conciliar(lancamentos, [ana, joao], AGORA);
  assert.equal(r.creditos, 2);
  assert.equal(r.sugestoes.length, 2);
  const porId = Object.fromEntries(r.sugestoes.map((s) => [s.pagamento.id, s]));
  assert.equal(porId[joao.id].forca, 'forte');
  assert.match(porId[joao.id].motivo, /NXREFCODE9/);
  assert.equal(porId[ana.id].forca, 'forte');
  assert.match(porId[ana.id].motivo, /ANA|SOUZA/);
  assert.equal(r.sem_par.length, 0);
});

test('conciliar: só o valor igual com várias cobranças abertas não gera sugestão (ambíguo)', () => {
  const a = P.criarCobranca({ usuario: usuario({ email: 'a@x.com', name: 'Aaa Bbb' }), valor: 18, agora: AGORA - DIA });
  const b = P.criarCobranca({ usuario: usuario({ email: 'b@x.com', name: 'Ccc Ddd' }), valor: 18, agora: AGORA - DIA });
  const l = P.lerExtrato('Data;Descrição;Valor\n14/11/2026;PIX DE FULANO;18,00').lancamentos;
  const r = P.conciliar(l, [a, b], AGORA);
  assert.equal(r.sugestoes.length, 0);
  assert.equal(r.sem_par.length, 1);
});

test('conciliar: com uma única cobrança aberta, valor igual vira sugestão fraca; dinheiro anterior à cobrança é ignorado', () => {
  const a = P.criarCobranca({ usuario: usuario({ email: 'a@x.com', name: 'Aaa Bbb' }), valor: 18, agora: AGORA - DIA });
  const ok = P.conciliar(P.lerExtrato('Data;Descrição;Valor\n14/11/2026;PIX DE FULANO;18,00').lancamentos, [a], AGORA);
  assert.equal(ok.sugestoes.length, 1);
  assert.equal(ok.sugestoes[0].forca, 'fraca');
  const antigo = P.conciliar(P.lerExtrato('Data;Descrição;Valor\n01/11/2026;PIX DE FULANO;18,00').lancamentos, [a], AGORA);
  assert.equal(antigo.sugestoes.length, 0);
});

test('conciliar: lançamento já usado em outra confirmação não aparece de novo', () => {
  const a = P.criarCobranca({ usuario: usuario({ email: 'a@x.com', name: 'Ana Souza' }), valor: 18, agora: AGORA - 2 * DIA });
  const { lancamentos } = P.lerExtrato(OFX);
  const paga = P.criarCobranca({ usuario: usuario({ email: 'z@x.com', name: 'Zed' }), valor: 18, agora: AGORA - 3 * DIA });
  P.marcarPaga(paga, { agora: AGORA, por: eu, extratoId: lancamentos[0].hash });
  const r = P.conciliar(lancamentos, [a, paga], AGORA);
  assert.equal(r.ja_conciliados, 1);
  assert.ok(r.sugestoes.every((s) => s.lancamento.hash !== lancamentos[0].hash));
});
