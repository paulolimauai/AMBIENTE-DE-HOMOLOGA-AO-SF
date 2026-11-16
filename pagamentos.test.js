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


/* ---------------------------------------------------------------- cobrança mensal automática (todo dia 5) */
const DIA5 = Date.parse('2026-12-05T15:00:00Z'); // 05/12/2026, 12:00 em Brasília
const ativa = (extra) => usuario(Object.assign({ subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix', subscription_expires_at: '2026-12-20T12:00:00.000Z' }, extra || {}));
const gerar = (usuarios, pagamentos, extra) => P.gerarCobrancasMensais(Object.assign({ usuarios, pagamentos: pagamentos || [], agora: DIA5, preco: PRECO }, extra || {}));

test('cobrança mensal: no dia 5 cada assinatura paga e ativa recebe uma cobrança Pix de R$ 18 com vencimento 3 dias depois', () => {
  const r = gerar([ativa({ email: 'ana@x.com' }), ativa({ email: 'bia@x.com', name: 'Bia Lima' })]);
  assert.equal(r.competencia, '2026-12');
  assert.equal(r.novas.length, 2);
  assert.equal(r.elegiveis, 2);
  const c = r.novas[0];
  assert.equal(c.valor, 18);
  assert.equal(c.plano, 'mensal');
  assert.equal(c.status, 'emitida');
  assert.equal(c.origem, 'automatica');
  assert.equal(c.competencia, '2026-12');
  assert.equal(c.vencimento, '2026-12-08');
  assert.equal(c.historico[0].por, 'sistema');
  assert.match(c.ref, /^NXA202612[0-9A-F]{8}$/);
  assert.match(c.id, /^PG-AUTO-202612-[0-9A-F]{8}$/);
  assert.notEqual(r.novas[0].ref, r.novas[1].ref);
  // O Pix da cobrança é válido e leva a referência como identificador
  const pix = P.pixLer(P.pixPayload({ chave: '+5562999990000', nome: 'Nexus', cidade: 'Goiania', valor: c.valor, txid: c.ref }));
  assert.ok(pix.crcOk);
});

test('cobrança mensal: a mesma conta e o mesmo mês dão sempre o mesmo identificador (dois servidores não geram cobranças diferentes)', () => {
  const a = gerar([ativa()]).novas[0];
  const b = gerar([ativa()], [], { agora: DIA5 + 3 * 3600000 }).novas[0];
  assert.equal(a.id, b.id);
  assert.equal(a.ref, b.ref);
  const outroMes = gerar([ativa({ subscription_expires_at: '2027-02-10T12:00:00.000Z' })], [], { agora: Date.parse('2027-01-05T15:00:00Z') }).novas[0];
  assert.notEqual(a.id, outroMes.id);
});

test('cobrança mensal: não recebem teste, expirado, vitalício, administrador, cortesia nem plano anual', () => {
  const r = gerar([
    usuario({ email: 'teste@x.com', subscription_status: 'trial', trial_started_at: new Date(DIA5 - 3600000).toISOString() }),
    usuario({ email: 'exp@x.com', subscription_status: 'active', subscription_plan: 'mensal', subscription_expires_at: '2026-12-01T12:00:00.000Z' }),
    usuario({ email: 'vit@x.com', subscription_status: 'active', subscription_plan: 'vitalicio' }),
    usuario({ email: 'adm@x.com', role: 'Administrador' }),
    ativa({ email: 'cort@x.com', subscription_method: 'admin_cortesia' }),
    ativa({ email: 'cort2@x.com', subscription_plan: 'cortesia_admin' }),
    ativa({ email: 'ano@x.com', subscription_plan: 'anual', subscription_expires_at: '2027-09-01T12:00:00.000Z' }),
    ativa({ email: 'ok@x.com' })
  ]);
  assert.deepEqual(r.novas.map((c) => c.email), ['ok@x.com']);
  assert.equal(r.elegiveis, 1);
});

test('cobrança mensal: rodar de novo não repete, e uma cobrança cancelada à mão não volta no mesmo mês', () => {
  const us = [ativa()];
  const livro = [];
  const um = gerar(us, livro);
  livro.push(...um.novas);
  const dois = gerar(us, livro);
  assert.equal(dois.novas.length, 0);
  assert.equal(dois.puladas.ja_gerada, 1);
  P.cancelar(livro[0], eu, 'gerada por engano', DIA5);
  assert.equal(gerar(us, livro).novas.length, 0, 'cancelada não é gerada outra vez');
});

test('cobrança mensal: antes do dia 5 não gera; o botão do administrador (forcar) gera o mês corrente em qualquer dia', () => {
  const dia4 = Date.parse('2026-12-04T15:00:00Z');
  const antes = gerar([ativa()], [], { agora: dia4 });
  assert.equal(antes.novas.length, 0);
  assert.equal(antes.motivo, 'antes_do_dia');
  const forcada = gerar([ativa()], [], { agora: dia4, forcar: true });
  assert.equal(forcada.novas.length, 1);
  assert.equal(forcada.competencia, '2026-12');
});

test('cobrança mensal: servidor desligado no dia 5 completa nos dias seguintes, mas a primeira vez não gera cobrança retroativa', () => {
  const dia9 = Date.parse('2026-12-09T15:00:00Z');
  const primeira = gerar([ativa()], [], { agora: dia9 });
  assert.equal(primeira.novas.length, 0);
  assert.equal(primeira.motivo, 'sem_retroativo');
  const jaRodouAntes = P.criarCobranca({ usuario: ativa({ email: 'outra@x.com' }), valor: 18, origem: 'automatica', competencia: '2026-11', agora: Date.parse('2026-11-05T15:00:00Z') });
  const completa = gerar([ativa()], [jaRodouAntes], { agora: dia9 });
  assert.equal(completa.novas.length, 1);
  assert.equal(completa.novas[0].vencimento, '2026-12-12', 'vence 3 dias depois de gerada');
});

test('cobrança mensal: quem já pagou do dia 5 em diante está em dia; quem pagou antes do dia 5 recebe a do mês', () => {
  const paga = (email, dia) => { const c = P.criarCobranca({ usuario: ativa({ email }), valor: 18, agora: Date.parse(dia) }); return P.marcarPaga(c, { agora: Date.parse(dia), por: eu }); };
  const livro = [paga('em-dia@x.com', '2026-12-05T10:00:00Z'), paga('antes@x.com', '2026-12-02T15:00:00Z')];
  const r = gerar([ativa({ email: 'em-dia@x.com' }), ativa({ email: 'antes@x.com' })], livro);
  assert.deepEqual(r.novas.map((c) => c.email), ['antes@x.com']);
  assert.equal(r.puladas.pagou_no_ciclo, 1);
  // pagamento estornado não conta como pago
  P.estornar(livro[0], eu, 'devolvido', DIA5);
  assert.equal(gerar([ativa({ email: 'em-dia@x.com' })], livro).novas.length, 1);
});

test('cobrança mensal: aviso de pagamento e cobrança emitida pelo administrador ficam como estão (não empilha outra)', () => {
  const informada = P.marcarInformada(P.criarCobranca({ usuario: ativa({ email: 'inf@x.com' }), valor: 18, agora: DIA5 - DIA }), { agora: DIA5 - 3600000 });
  const manual = P.criarCobranca({ usuario: ativa({ email: 'man@x.com' }), valor: 18, origem: 'admin', vencimento: '2026-12-10', agora: DIA5 - DIA });
  const r = gerar([ativa({ email: 'inf@x.com' }), ativa({ email: 'man@x.com' })], [informada, manual]);
  assert.equal(r.novas.length, 0);
  assert.equal(r.puladas.em_aberto, 2);
});

test('cobrança mensal: a automática de mês anterior ainda não paga é substituída pela do mês (fica cancelada, com histórico)', () => {
  const velha = P.criarCobranca({ usuario: ativa(), valor: 18, origem: 'automatica', competencia: '2026-11', agora: Date.parse('2026-11-05T15:00:00Z') });
  const r = gerar([ativa()], [velha]);
  assert.equal(r.novas.length, 1);
  assert.equal(r.substituidas.length, 1);
  assert.equal(velha.status, 'cancelada');
  assert.match(velha.historico[velha.historico.length - 1].nota, /dez\/26/);
  assert.equal(r.novas[0].competencia, '2026-12');
  assert.equal(P.emAberto(velha), false);
});

test('cobrança mensal: proximaGeracao diz o próximo dia 5 (hoje conta se ainda for o dia)', () => {
  assert.equal(P.proximaGeracao(Date.parse('2026-11-15T15:00:00Z'), 5), '2026-12-05');
  assert.equal(P.proximaGeracao(Date.parse('2026-11-05T15:00:00Z'), 5), '2026-11-05');
  assert.equal(P.proximaGeracao(Date.parse('2026-11-04T15:00:00Z'), 5), '2026-11-05');
  assert.equal(P.proximaGeracao(Date.parse('2026-12-20T15:00:00Z'), 5), '2027-01-05');
  // 02:00 de 06/12 em UTC ainda é dia 05 à noite em Brasília
  assert.equal(P.proximaGeracao(Date.parse('2026-12-06T02:00:00Z'), 5), '2026-12-05');
});


/* ---------------------------------------------------------------- configuração financeira (preço, Pix, cobrança) */
const CONFIG_OK = () => ({ preco: '18,00', pix: { tipo: 'telefone', chave: '(62) 99234-5372', nome: 'Paulo Lima', cidade: 'Goiânia' }, whatsapp: '(62) 99234-5372', cobranca: { dia: 5, prazo_dias: 3 } });

test('config: valida e normaliza a configuração atual do sistema (celular vira +55, nome e cidade sem acento e em maiúsculas)', () => {
  const r = P.validarConfig(CONFIG_OK());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.config, { preco: 18, pix: { tipo: 'telefone', chave: '+5562992345372', nome: 'PAULO LIMA', cidade: 'GOIANIA' }, whatsapp: '62992345372', cobranca: { dia: 5, prazo_dias: 3 } });
  const a = P.apresentarConfig(r.config);
  assert.equal(a.chave_exibicao, '(62) 99234-5372');
  assert.equal(a.chave_copiar, '62992345372');
  assert.equal(a.chave_tipo_rotulo, 'celular');
  assert.equal(a.preco_texto, 'R$ 18,00');
  assert.equal(a.whatsapp_exibicao, '(62) 99234-5372');
});

test('config: o preço aceita vírgula e ponto, recusa vazio, zero, acima do teto e o "1.500" ambíguo', () => {
  const com = (preco) => { const c = CONFIG_OK(); c.preco = preco; return P.validarConfig(c); };
  assert.equal(com('20,50').config.preco, 20.5);
  assert.equal(com('R$ 25,00').config.preco, 25);
  assert.equal(com(19.9).config.preco, 19.9);
  assert.equal(com('1.234,50').config.preco, 1234.5);
  for (const ruim of ['', '0', '0,50', '-5', 'abc', '5000,01', 999999, null, undefined]) {
    const r = com(ruim);
    assert.equal(r.ok, false, 'deveria recusar ' + String(ruim));
    assert.equal(r.campo, 'preco');
  }
  assert.equal(com('1.500').ok, false, '"1.500" pode ser 1,5 ou 1500: pede a vírgula');
  assert.equal(com('1.500').campo, 'preco');
});

test('config: cada tipo de chave Pix confere o formato (CPF e CNPJ com dígitos verificadores)', () => {
  const com = (tipo, chave) => { const c = CONFIG_OK(); c.pix = { tipo, chave, nome: 'Loja', cidade: 'Goiania' }; return P.validarConfig(c); };
  assert.equal(com('cpf', '529.982.247-25').config.pix.chave, '52998224725');
  assert.equal(com('cpf', '111.111.111-11').ok, false, 'todos os dígitos iguais');
  assert.equal(com('cpf', '529.982.247-24').ok, false, 'dígito verificador errado');
  assert.equal(com('cnpj', '11.222.333/0001-81').config.pix.chave, '11222333000181');
  assert.equal(com('cnpj', '11.222.333/0001-80').ok, false);
  assert.equal(com('email', ' Financeiro@Empresa.COM.br ').config.pix.chave, 'financeiro@empresa.com.br');
  assert.equal(com('email', 'sem-arroba').ok, false);
  assert.equal(com('aleatoria', '123E4567-E89B-12D3-A456-426614174000').config.pix.chave, '123e4567-e89b-12d3-a456-426614174000');
  assert.equal(com('aleatoria', '123e4567').ok, false);
  assert.equal(com('telefone', '+55 62 99999-0000').config.pix.chave, '+5562999990000');
  assert.equal(com('telefone', '62 3333-4444').config.pix.chave, '+556233334444', 'fixo (10 dígitos) também é chave válida');
  assert.equal(com('telefone', '(62) 89999-0000').ok, false, 'celular de 11 dígitos começa com 9 depois do DDD');
  assert.equal(com('telefone', '(02) 99999-0000').ok, false, 'DDD inexistente');
  assert.equal(com('telefone', '').ok, false);
  assert.equal(com('', '62999990000').campo, 'pix.tipo');
  assert.equal(com('pix-magico', 'x').campo, 'pix.tipo');
});

test('config: o QR gerado com a chave nova leva a chave, o nome e a cidade normalizados e o CRC confere', () => {
  const c = CONFIG_OK();
  c.pix = { tipo: 'email', chave: 'Cobranca@Nexus.com', nome: 'Nexus Serviços Digitais Ltda', cidade: 'São Paulo' };
  const cfg = P.validarConfig(c).config;
  const payload = P.pixPayload({ chave: cfg.pix.chave, nome: cfg.pix.nome, cidade: cfg.pix.cidade, valor: cfg.preco, txid: 'NXTESTE1' });
  const lido = P.pixLer(payload);
  assert.equal(lido.crcOk, true);
  assert.equal(lido.campos['59'], 'NEXUS SERVICOS DIGITAIS L');
  assert.equal(lido.campos['59'].length, 25);
  assert.equal(lido.campos['60'], 'SAO PAULO');
  assert.ok(payload.includes('cobranca@nexus.com'));
  assert.equal(lido.campos['54'], '18.00');
});

test('config: nome e cidade precisam ter ao menos 2 letras depois de limpos; WhatsApp precisa de DDD; dia 1-28 e prazo 1-30 dias', () => {
  const com = (f) => { const c = CONFIG_OK(); f(c); return P.validarConfig(c); };
  assert.equal(com((c) => { c.pix.nome = '@#$'; }).campo, 'pix.nome');
  assert.equal(com((c) => { c.pix.cidade = 'X'; }).campo, 'pix.cidade');
  assert.equal(com((c) => { c.whatsapp = '99234-5372'; }).campo, 'whatsapp');
  assert.equal(com((c) => { c.whatsapp = ''; }).campo, 'whatsapp');
  assert.equal(com((c) => { c.cobranca.dia = 0; }).campo, 'cobranca.dia');
  assert.equal(com((c) => { c.cobranca.dia = 29; }).campo, 'cobranca.dia', 'dia 29-31 não existe em todo mês');
  assert.equal(com((c) => { c.cobranca.dia = 2.5; }).campo, 'cobranca.dia');
  assert.equal(com((c) => { c.cobranca.dia = 28; }).ok, true);
  assert.equal(com((c) => { c.cobranca.prazo_dias = 0; }).campo, 'cobranca.prazo_dias');
  assert.equal(com((c) => { c.cobranca.prazo_dias = 31; }).campo, 'cobranca.prazo_dias');
  assert.equal(com((c) => { c.cobranca.prazo_dias = '7'; }).config.cobranca.prazo_dias, 7, 'vindo de um formulário, o número chega como texto');
  assert.equal(P.validarConfig(null).ok, false);
  assert.equal(P.validarConfig('lixo').ok, false);
  assert.equal(P.validarConfig({}).campo, 'preco');
});

test('config: o nome de quem recebe tem no máximo 25 caracteres e a cidade 15 (limite do BR Code)', () => {
  const c = CONFIG_OK();
  c.pix.nome = 'Maria das Dores Fernandes de Albuquerque Neto';
  c.pix.cidade = 'Santa Rita do Passa Quatro';
  const r = P.validarConfig(c).config.pix;
  assert.ok(r.nome.length <= 25 && r.cidade.length <= 15);
  assert.equal(r.nome, 'MARIA DAS DORES FERNANDES');
  assert.equal(r.cidade, 'SANTA RITA DO P');
});

test('config: diferencasConfig lista só o que mudou (e tudo na primeira gravação)', () => {
  const antes = P.validarConfig(CONFIG_OK()).config;
  assert.deepEqual(P.diferencasConfig(antes, antes), []);
  const c = CONFIG_OK(); c.preco = '20,00'; c.cobranca.dia = 10;
  const depois = P.validarConfig(c).config;
  assert.deepEqual(P.diferencasConfig(antes, depois), ['Preço mensal: R$ 18,00 → R$ 20,00', 'Dia da cobrança mensal: 5 → 10']);
  const c2 = CONFIG_OK(); c2.pix = { tipo: 'cpf', chave: '52998224725', nome: 'Outra Pessoa', cidade: 'Goiania' };
  const d2 = P.diferencasConfig(antes, P.validarConfig(c2).config);
  assert.equal(d2.length, 2);
  assert.equal(d2[0], 'Chave Pix: celular +55…372 → CPF 529…725', 'a chave aparece mascarada na auditoria');
  assert.ok(!d2.join(' ').includes('52998224725') && !d2.join(' ').includes('992345372'), 'nem o CPF nem o celular inteiros vão para o histórico');
  assert.match(d2[1], /^Favorecido do Pix: PAULO LIMA → OUTRA PESSOA$/);
  assert.ok(P.diferencasConfig(null, antes).length >= 6, 'sem configuração anterior tudo conta como novo');
});