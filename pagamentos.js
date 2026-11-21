'use strict';
/* Nexus - Pagamentos e cobranças (regras puras; testadas em pagamentos.test.js).
   O server.js só faz o HTTP e a gravação (local_pagamentos.json + SQL das contas); aqui ficam as regras que não dependem de rede nem de disco:

   - LIVRO DE PAGAMENTOS: cada cobrança/pagamento é um registro que nunca é sobrescrito (antes só o último protocolo ficava na conta).
       status: emitida (cobrança gerada, 2ª via) -> informada (cliente avisou que pagou) -> paga (admin confirmou)
               ou cancelada / estornada. "vencida" e "aguardando" são derivados (situacao()).
   - PRAZO: o pagamento confirmado fixa o vencimento em "confirmação + 30 dias" (o primeiro dia é gratuito; não acumula o que restava).
   - PIX: payload copia-e-cola (EMV/BR Code) com CRC16, no servidor, para o QR sair daqui e não de um site de terceiros.
   - RESUMO FINANCEIRO: receita, MRR (estimativa), vencimentos, expirados, série dos últimos 6 meses.
   - CONCILIAÇÃO: lê extrato OFX/CSV e SUGERE quais cobranças abertas foram pagas (quem confirma é sempre o administrador).
   O valor da assinatura NÃO mora aqui: o servidor passa o preço (SUBSCRIPTION_MONTHLY_PRICE). Cada registro guarda o valor cobrado na época. */

const crypto = require('crypto');

const DIA = 86400000;
const HORA = 3600000;
const STATUS = Object.freeze({ EMITIDA: 'emitida', INFORMADA: 'informada', PAGA: 'paga', CANCELADA: 'cancelada', ESTORNADA: 'estornada' });
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const FIM_VITALICIO = Date.UTC(2099, 11, 31, 23, 59, 59);
const VALOR_MAXIMO = 5000; // teto de segurança para um valor digitado/confirmado à mão

/* ============================================================ utilitários ============================================================ */
function texto(v, max) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return max ? s.slice(0, max) : s;
}
function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function arredondar(v) { return Math.round((Number(v) + Number.EPSILON) * 100) / 100; }

// Aceita ISO, "AAAA-MM-DD HH:mm:ss" (horário de Brasília, como o SQL guarda) e número
function paraMs(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.getTime();
  const s = String(v).trim();
  let t = Date.parse(s);
  if (isNaN(t) && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) t = Date.parse(s.replace(' ', 'T') + (s.length <= 19 ? '-03:00' : ''));
  return t;
}
// Mês/dia no horário de Brasília (sem horário de verão desde 2019: UTC-3 fixo)
function brt(ms) { return new Date(ms - 3 * HORA); }
function mesDe(ms) { return brt(ms).toISOString().slice(0, 7); }
function diaDe(ms) { return brt(ms).toISOString().slice(0, 10); }
function rotuloMes(chave) { const m = /^(\d{4})-(\d{2})$/.exec(chave); return m ? MESES[parseInt(m[2], 10) - 1] + '/' + m[1].slice(2) : chave; }
function somarMeses(chave, n) {
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  const t = (parseInt(m[1], 10) * 12 + (parseInt(m[2], 10) - 1)) + n;
  return String(Math.floor(t / 12)).padStart(4, '0') + '-' + String((t % 12) + 1).padStart(2, '0');
}
function dataIsoValida(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : '';
}
function brl(v) { return 'R$ ' + Number(v || 0).toFixed(2).replace('.', ','); }

/* ============================================================ identificação ============================================================ */
function novoId(agora) { return 'PG-' + Math.floor(agora || Date.now()).toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase(); }
// Referência que vai no Pix (txid): só letras e números, até 25 caracteres; única entre as cobranças existentes
function novaReferencia(agora, existentes) {
  const usados = existentes instanceof Set ? existentes : new Set((existentes || []).map((p) => p && p.ref));
  for (let i = 0; i < 20; i++) {
    const ref = ('NX' + Math.floor(agora || Date.now()).toString(36).toUpperCase().slice(-8) + crypto.randomBytes(2).toString('hex').toUpperCase()).slice(0, 25);
    if (!usados.has(ref)) return ref;
  }
  return ('NX' + crypto.randomBytes(10).toString('hex').toUpperCase()).slice(0, 25);
}
function limparReferencia(v) { return String(v == null ? '' : v).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 25); }

/* ============================================================ registros ============================================================ */
function evento(reg, acao, por, nota, agora) {
  if (!Array.isArray(reg.historico)) reg.historico = [];
  reg.historico.push({ em: new Date(agora || Date.now()).toISOString(), por: por ? (por.email || por.nome || '') : 'sistema', acao, nota: texto(nota, 200) });
  if (reg.historico.length > 40) reg.historico = reg.historico.slice(-40);
  return reg;
}

function criarCobranca(o) {
  const agora = o.agora || Date.now();
  const u = o.usuario || {};
  const email = texto(u.email, 160).toLowerCase();
  const valor = arredondar(o.valor);
  if (!email) throw new Error('E-mail do cliente é obrigatório.');
  // permitirZero: liberação manual (ex.: anual/vitalício) em que o administrador não informou quanto foi recebido
  if (!(valor > 0 || (o.permitirZero && valor === 0)) || valor > VALOR_MAXIMO) throw new Error('Valor inválido para a cobrança.');
  const reg = {
    id: novoId(agora),
    ref: limparReferencia(o.referencia) || novaReferencia(agora, o.existentes),
    email, nome: texto(u.name || u.nome || email.split('@')[0], 120),
    plano: o.plano === 'anual' ? 'anual' : (o.plano === 'vitalicio' ? 'vitalicio' : 'mensal'),
    metodo: 'pix',
    valor,
    status: STATUS.EMITIDA,
    origem: texto(o.origem || 'admin', 20),
    competencia: /^\d{4}-\d{2}$/.test(String(o.competencia || '')) ? String(o.competencia) : null, // mês da cobrança automática (AAAA-MM)
    emitida_em: new Date(agora).toISOString(),
    vencimento: dataIsoValida(o.vencimento) || null,
    informada_em: null, paga_em: null,
    comprovante: texto(o.comprovante, 80),
    txid_legado: texto(o.txidLegado, 80),
    extrato_id: '',
    periodo_inicio: null, periodo_fim: null, dias: 0,
    confirmado_por: null,
    obs: texto(o.obs, 300),
    historico: []
  };
  evento(reg, 'emitida', o.por, o.obs || '', agora);
  return reg;
}

function situacao(reg, agora) {
  if (!reg) return '';
  if (reg.status === STATUS.PAGA || reg.status === STATUS.CANCELADA || reg.status === STATUS.ESTORNADA) return reg.status;
  if (reg.status === STATUS.INFORMADA) return 'aguardando';
  if (reg.vencimento && reg.vencimento < diaDe(agora || Date.now())) return 'vencida';
  return STATUS.EMITIDA;
}
function emAberto(reg) { return !!reg && (reg.status === STATUS.EMITIDA || reg.status === STATUS.INFORMADA); }

// O cliente avisou que pagou (tela de assinatura). Cobrança emitida vira "informada"; o prazo da conta ainda não muda.
function marcarInformada(reg, o) {
  const agora = (o && o.agora) || Date.now();
  if (!emAberto(reg)) return reg;
  reg.status = STATUS.INFORMADA;
  reg.informada_em = new Date(agora).toISOString();
  if (o && o.comprovante) reg.comprovante = texto(o.comprovante, 80);
  evento(reg, 'informada', o && o.por, o && o.comprovante ? 'Comprovante ' + texto(o.comprovante, 40) : '', agora);
  return reg;
}

// O pagamento confirmado vale sempre o prazo do plano (30 dias no mensal) contado DA CONFIRMAÇÃO:
// quem paga na janela de renovação tem o vencimento fixado em "pagamento + 30 dias", sem acumular os dias que restavam.
// Vitalício vai a 2099.
function calcularPeriodo(o) {
  const agora = o.agora || Date.now();
  if (o.plano === 'vitalicio') return { inicio: agora, fim: FIM_VITALICIO, dias: 36500 };
  const dias = o.plano === 'anual' ? 365 : 30;
  return { inicio: agora, fim: agora + dias * DIA, dias };
}

function valorConfirmado(v, padrao) {
  if (v === undefined || v === null || v === '') return arredondar(padrao);
  // "18,00" e "18.00" valem 18; "1.234,50" vale 1234,5 (nunca "18.00" como 1800)
  const n = typeof v === 'number' ? v : numeroBR(v);
  if (!Number.isFinite(n) || n <= 0 || n > VALOR_MAXIMO) return NaN;
  return arredondar(n);
}

// Confirma o recebimento: grava quem confirmou, o valor realmente recebido e o período que o pagamento cobre
function marcarPaga(reg, o) {
  const agora = o.agora || Date.now();
  const periodo = o.periodo || calcularPeriodo({ plano: reg.plano, expiraAtualMs: o.expiraAtualMs, agora });
  reg.status = STATUS.PAGA;
  reg.paga_em = new Date(agora).toISOString();
  if (o.valor !== undefined && Number.isFinite(o.valor) && o.valor > 0) reg.valor = arredondar(o.valor);
  if (o.metodo) reg.metodo = texto(o.metodo, 20);
  if (o.comprovante) reg.comprovante = texto(o.comprovante, 80);
  if (o.extratoId) reg.extrato_id = texto(o.extratoId, 80);
  reg.periodo_inicio = new Date(periodo.inicio).toISOString();
  reg.periodo_fim = new Date(periodo.fim).toISOString();
  reg.dias = periodo.dias;
  reg.confirmado_por = o.por ? { nome: texto(o.por.nome || o.por.name, 80), email: texto(o.por.email, 160).toLowerCase() } : null;
  if (o.obs) reg.obs = texto(o.obs, 300);
  evento(reg, 'paga', o.por, 'Recebido ' + brl(reg.valor) + (o.nota ? ' · ' + o.nota : ''), agora);
  return reg;
}
function cancelar(reg, por, nota, agora) {
  if (!emAberto(reg)) return false;
  reg.status = STATUS.CANCELADA;
  evento(reg, 'cancelada', por, nota, agora);
  return true;
}
function estornar(reg, por, nota, agora) {
  if (!reg || reg.status !== STATUS.PAGA) return false;
  reg.status = STATUS.ESTORNADA;
  reg.estornada_em = new Date(agora || Date.now()).toISOString();
  evento(reg, 'estornada', por, nota, agora);
  return true;
}

// Pagamento que o cliente já tinha avisado (protocolo NEXUS-SUB-...) antes de existir o livro: entra como "informada", uma vez só
function sincronizarLegado(usuarios, pagamentos, agora, preco) {
  const conhecidos = new Set((pagamentos || []).map((p) => p && p.txid_legado).filter(Boolean));
  const novos = [];
  for (const u of usuarios || []) {
    if (!u || !u.email || u.role === 'Administrador') continue;
    const id = String(u.subscription_payment_id || '');
    const pendente = u.subscription_status === 'pending_payment' || (u.subscription_status === 'trial' && id.indexOf('NEXUS-SUB-') === 0);
    if (!pendente || !id || conhecidos.has(id)) continue;
    const ref = limparReferencia(id.split('-REF-')[1] || '') || '';
    const reg = criarCobranca({ usuario: u, valor: preco, plano: 'mensal', origem: 'legado', txidLegado: id, comprovante: ref, agora, existentes: pagamentos.concat(novos) });
    reg.status = STATUS.INFORMADA;
    reg.informada_em = reg.emitida_em;
    evento(reg, 'informada', null, 'Importado do aviso de pagamento anterior ao livro', agora);
    conhecidos.add(id);
    novos.push(reg);
  }
  return novos;
}

function publico(reg, agora) {
  return Object.assign({}, reg, { situacao: situacao(reg, agora) });
}

/* ============================================================ situação da conta (espelha o servidor e administracao.js) ============================================================ */
function classificarUsuario(u, agora) {
  agora = agora || Date.now();
  const plano = String(u.subscription_plan || '').toLowerCase();
  const st = String(u.subscription_status || '').toLowerCase();
  if (u.role === 'Administrador') return { chave: 'admin', expira: null };
  if (plano === 'vitalicio') return { chave: 'vitalicio', expira: null };
  const exp = paraMs(u.subscription_expires_at);
  if (st === 'active' && exp > agora) return { chave: 'ativo', expira: exp, cortesia: u.subscription_method === 'admin_cortesia' || plano === 'cortesia_admin', plano };
  const pendente = st === 'pending_payment' || (st === 'trial' && String(u.subscription_payment_id || '').indexOf('NEXUS-SUB-') === 0);
  if (pendente) return { chave: 'pendente', expira: null };
  if (st === 'expired' || (exp > 0 && exp <= agora)) return { chave: 'expirado', expira: exp > 0 ? exp : null };
  const ini = paraMs(u.trial_started_at);
  if (!isNaN(ini) && agora - ini >= DIA) return { chave: 'teste_fim', expira: null };
  return { chave: 'teste', expira: null };
}

/* ============================================================ cobrança mensal automática (todo dia 5) ============================================================ */
const COBRANCA_DIA_PADRAO = 5;
const PRAZO_COBRANCA_MINIMO = 5; // a cobrança fica disponível para pagamento 5 dias antes do vencimento

function numeroDoDia(ms) { return parseInt(diaDe(ms).slice(8, 10), 10); }
// Meia-noite (Brasília) do dia `dia` do mês `chave` (AAAA-MM), em ms
function inicioDoDia(chave, dia) {
  const m = /^(\d{4})-(\d{2})$/.exec(chave);
  return Date.UTC(+m[1], +m[2] - 1, dia, 3, 0, 0);
}
// Próximo dia `dia` a partir de hoje (hoje conta, se ainda for o dia), no formato AAAA-MM-DD
function proximaGeracao(agora, dia) {
  dia = dia || COBRANCA_DIA_PADRAO;
  const mes = mesDe(agora);
  const alvo = numeroDoDia(agora) <= dia ? mes : somarMeses(mes, 1);
  return alvo + '-' + String(dia).padStart(2, '0');
}
// Quem recebe a cobrança do mês: assinatura PAGA e ativa. Fora: teste, expirado, vitalício, administrador, cortesia e plano anual (já pagou o ano).
function recebeCobrancaMensal(u, agora) {
  if (!u || !u.email) return false;
  const c = classificarUsuario(u, agora);
  return c.chave === 'ativo' && !c.cortesia && c.plano !== 'anual';
}
// Identificador e referência Pix fixos por conta e mês: se dois servidores gerarem a mesma cobrança, os dois registros saem iguais (e o Pix também)
function chaveAutomatica(email, competencia) {
  const h = crypto.createHash('sha1').update(String(email).toLowerCase()).digest('hex').slice(0, 8).toUpperCase();
  const mes = competencia.replace('-', '');
  return { id: 'PG-AUTO-' + mes + '-' + h, ref: 'NXA' + mes + h };
}

/* Gera a cobrança do mês de cada assinatura ativa (a rotina do servidor chama isto de hora em hora; só age a partir do dia 5).
   Regras:
   - uma cobrança por conta e por mês (campo `competencia`): rodar de novo não repete, e uma cobrança cancelada à mão não volta;
   - quem já avisou que pagou (informada) ou tem uma cobrança emitida pelo administrador fica como está;
   - a cobrança automática emitida em mês anterior e ainda não paga é substituída pela do mês (vira "cancelada", o histórico fica);
   - quem pagou do dia 5 em diante neste mês já está em dia e não recebe outra.
   Se o servidor ficou desligado no dia 5, completa nos dias seguintes, menos na primeira vez em que a rotina existe (sem cobrança retroativa);
   `forcar` ignora o dia (botão do administrador). Não grava nada: devolve as cobranças novas e as substituídas (estas já alteradas dentro de `pagamentos`). */
function gerarCobrancasMensais(o) {
  const agora = o.agora || Date.now();
  const dia = o.dia || COBRANCA_DIA_PADRAO;
  // Toda conta fica disponível para pagamento a partir de 5 dias antes do vencimento: a cobrança só vence PRAZO_COBRANCA_MINIMO dias depois de emitida
  const prazoDias = Math.max(PRAZO_COBRANCA_MINIMO, Number.isFinite(o.prazoDias) ? o.prazoDias : PRAZO_COBRANCA_MINIMO);
  const comp = mesDe(agora);
  const pagamentos = o.pagamentos || [];
  const r = { competencia: comp, dia, novas: [], substituidas: [], elegiveis: 0, puladas: { ja_gerada: 0, em_aberto: 0, pagou_no_ciclo: 0 }, motivo: '' };
  if (!o.forcar) {
    const hoje = numeroDoDia(agora);
    if (hoje < dia) { r.motivo = 'antes_do_dia'; return r; }
    if (hoje > dia && !pagamentos.some((p) => p && p.origem === 'automatica')) { r.motivo = 'sem_retroativo'; return r; }
  }
  const inicioCiclo = inicioDoDia(comp, dia);
  const vencimento = diaDe(agora + prazoDias * DIA);
  const porEmail = new Map();
  for (const p of pagamentos) { if (p && p.email) { if (!porEmail.has(p.email)) porEmail.set(p.email, []); porEmail.get(p.email).push(p); } }
  const existentes = pagamentos.slice();
  for (const u of o.usuarios || []) {
    if (!recebeCobrancaMensal(u, agora)) continue;
    r.elegiveis++;
    const email = String(u.email).toLowerCase();
    const dela = porEmail.get(email) || [];
    if (dela.some((p) => p.competencia === comp)) { r.puladas.ja_gerada++; continue; }
    if (dela.some((p) => p.status === STATUS.PAGA && paraMs(p.paga_em) >= inicioCiclo)) { r.puladas.pagou_no_ciclo++; continue; }
    const abertas = dela.filter(emAberto);
    const velhas = abertas.filter((p) => p.origem === 'automatica' && p.status === STATUS.EMITIDA && p.competencia && p.competencia < comp);
    if (abertas.length > velhas.length) { r.puladas.em_aberto++; continue; }
    const k = chaveAutomatica(email, comp);
    if (existentes.some((p) => p && (p.id === k.id || p.ref === k.ref))) { r.puladas.ja_gerada++; continue; }
    for (const v of velhas) { cancelar(v, null, 'Substituída pela cobrança de ' + rotuloMes(comp), agora); r.substituidas.push(v); }
    const reg = criarCobranca({ usuario: u, valor: o.preco, plano: 'mensal', vencimento, referencia: k.ref, origem: 'automatica', competencia: comp, agora, existentes, obs: 'Cobrança automática de ' + rotuloMes(comp) + ' (todo dia ' + dia + ')' });
    reg.id = k.id;
    existentes.push(reg);
    r.novas.push(reg);
  }
  return r;
}

/* ============================================================ resumo financeiro ============================================================ */
function resumo(o) {
  const agora = o.agora || Date.now();
  const preco = Number(o.preco) || 0;
  const pagamentos = (o.pagamentos || []).filter(Boolean);
  const usuarios = (o.usuarios || []).filter((u) => u && u.email);
  const mesAtual = mesDe(agora);
  const mesAnt = somarMeses(mesAtual, -1);

  const porMes = {};
  let total = 0;
  const visto = new Set();
  const pagos = pagamentos.filter((p) => p.status === STATUS.PAGA && Number.isFinite(paraMs(p.paga_em))).sort((a, b) => paraMs(a.paga_em) - paraMs(b.paga_em));
  let novosNoMes = 0;
  for (const p of pagos) {
    const m = mesDe(paraMs(p.paga_em));
    porMes[m] = porMes[m] || { total: 0, qtd: 0 };
    porMes[m].total += Number(p.valor) || 0;
    porMes[m].qtd += 1;
    total += Number(p.valor) || 0;
    if (!visto.has(p.email)) { visto.add(p.email); if (m === mesAtual) novosNoMes++; }
  }
  const serie = [];
  for (let i = 5; i >= 0; i--) {
    const m = somarMeses(mesAtual, -i);
    const v = porMes[m] || { total: 0, qtd: 0 };
    serie.push({ mes: m, rotulo: rotuloMes(m), total: arredondar(v.total), qtd: v.qtd });
  }
  const recMes = (porMes[mesAtual] || { total: 0 }).total;
  const recAnt = (porMes[mesAnt] || { total: 0 }).total;

  let pagantes = 0, cortesias = 0, vitalicios = 0, testes = 0;
  const aVencer = [], expirados = [];
  for (const u of usuarios) {
    const c = classificarUsuario(u, agora);
    const basico = { email: String(u.email).toLowerCase(), nome: texto(u.name || u.email.split('@')[0], 120), telefone: String(u.phone || '').replace(/\D/g, '') };
    if (c.chave === 'ativo') {
      if (c.cortesia) cortesias++; else pagantes++;
      const dias = Math.ceil((c.expira - agora) / DIA);
      if (dias <= 7) aVencer.push(Object.assign(basico, { expira: new Date(c.expira).toISOString(), dias, cortesia: !!c.cortesia }));
    } else if (c.chave === 'vitalicio') vitalicios++;
    else if (c.chave === 'teste') testes++;
    else if (c.chave === 'expirado' || c.chave === 'teste_fim') {
      expirados.push(Object.assign(basico, { situacao: c.chave, expirou_em: c.expira ? new Date(c.expira).toISOString() : null, dias_atraso: c.expira ? Math.max(0, Math.floor((agora - c.expira) / DIA)) : null }));
    }
  }
  aVencer.sort((a, b) => a.dias - b.dias);
  expirados.sort((a, b) => (a.dias_atraso == null ? 9e9 : a.dias_atraso) - (b.dias_atraso == null ? 9e9 : b.dias_atraso));

  const aguardando = pagamentos.filter((p) => situacao(p, agora) === 'aguardando');
  const emitidas = pagamentos.filter((p) => p.status === STATUS.EMITIDA);
  const vencidas = emitidas.filter((p) => situacao(p, agora) === 'vencida');
  const estornosMes = pagamentos.filter((p) => p.status === STATUS.ESTORNADA && p.estornada_em && mesDe(paraMs(p.estornada_em)) === mesAtual);
  const aVencerPagantes = aVencer.filter((x) => !x.cortesia);

  return {
    gerado_em: new Date(agora).toISOString(),
    preco,
    receita: {
      mes: arredondar(recMes), mes_anterior: arredondar(recAnt), total: arredondar(total), qtd_total: pagos.length, qtd_mes: (porMes[mesAtual] || { qtd: 0 }).qtd,
      variacao_pct: recAnt > 0 ? Math.round(((recMes - recAnt) / recAnt) * 100) : null,
      novos_no_mes: novosNoMes
    },
    mrr: arredondar(pagantes * preco),
    pagantes, cortesias, vitalicios, testes,
    aguardando: { qtd: aguardando.length, valor: arredondar(aguardando.reduce((s, p) => s + (Number(p.valor) || 0), 0)) },
    emitidas: { qtd: emitidas.length, vencidas: vencidas.length, valor: arredondar(emitidas.reduce((s, p) => s + (Number(p.valor) || 0), 0)) },
    expirados: { qtd: expirados.length, lista: expirados.slice(0, 300) },
    a_vencer_7d: { qtd: aVencer.length, valor_previsto: arredondar(aVencerPagantes.length * preco), lista: aVencer.slice(0, 300) },
    estornos_mes: { qtd: estornosMes.length, valor: arredondar(estornosMes.reduce((s, p) => s + (Number(p.valor) || 0), 0)) },
    serie
  };
}

/* ============================================================ CSV ============================================================ */
function celulaCsv(v) {
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // planilha não executa fórmula vinda de dado
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function dataHoraBR(v) {
  const t = paraMs(v);
  if (isNaN(t)) return '';
  const d = brt(t).toISOString();
  return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) + ' ' + d.slice(11, 16);
}
function csv(pagamentos, agora) {
  const cab = ['Referência', 'Cliente', 'E-mail', 'Plano', 'Valor (R$)', 'Situação', 'Emitida em', 'Vencimento', 'Informada em', 'Paga em', 'Período até', 'Confirmado por', 'Comprovante', 'Origem'];
  const linhas = [cab.map(celulaCsv).join(';')];
  for (const p of pagamentos || []) {
    linhas.push([
      p.ref, p.nome, p.email, p.plano, Number(p.valor || 0).toFixed(2).replace('.', ','), situacao(p, agora), dataHoraBR(p.emitida_em),
      p.vencimento ? p.vencimento.split('-').reverse().join('/') : '', dataHoraBR(p.informada_em), dataHoraBR(p.paga_em), dataHoraBR(p.periodo_fim),
      p.confirmado_por ? (p.confirmado_por.nome || p.confirmado_por.email) : '', p.comprovante, p.origem
    ].map(celulaCsv).join(';'));
  }
  return '﻿' + linhas.join('\r\n');
}

/* ============================================================ Pix (BR Code estático) ============================================================ */
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
function pixPayload(o) {
  const f = (id, val) => id + String(val.length).padStart(2, '0') + val;
  const limpa = (s, n) => semAcento(s).replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, n);
  const txid = limparReferencia(o.txid) || '***';
  const valor = Number(o.valor);
  const conta = f('00', 'BR.GOV.BCB.PIX') + f('01', String(o.chave));
  let p = f('00', '01') + f('26', conta) + f('52', '0000') + f('53', '986') +
    (valor > 0 ? f('54', valor.toFixed(2)) : '') + f('58', 'BR') + f('59', limpa(o.nome, 25)) + f('60', limpa(o.cidade, 15)) + f('62', f('05', txid));
  p += '6304';
  return p + crc16(p);
}
// Lê o payload de volta (campos de primeiro nível) e confere o CRC: usado nos testes e para validar o que vai ao QR
function pixLer(payload) {
  const campos = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.substr(i, 2), n = parseInt(payload.substr(i + 2, 2), 10);
    if (!(n >= 0)) break;
    campos[id] = payload.substr(i + 4, n);
    i += 4 + n;
  }
  const corpo = payload.slice(0, -4);
  return { campos, crcOk: crc16(corpo) === payload.slice(-4) };
}

/* ============================================================ extrato (OFX/CSV) e conciliação ============================================================ */
function numeroBR(v) {
  let s = String(v == null ? '' : v).trim().replace(/[R$\s]/g, '');
  if (!s) return NaN;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-') || s.endsWith('-');
  s = s.replace(/[()\-+]/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}
function dataExtrato(v) {
  const s = String(v == null ? '' : v).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (m) return dataIsoValida(m[3] + '-' + m[2] + '-' + m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return dataIsoValida(m[1] + '-' + m[2] + '-' + m[3]);
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX: 20261115 ou 20261115120000[-3:BRT]
  if (m) return dataIsoValida(m[1] + '-' + m[2] + '-' + m[3]);
  return '';
}
function hashLancamento(l) { return crypto.createHash('sha1').update([l.data, l.valor.toFixed(2), semAcento(l.descricao).toUpperCase().replace(/\s+/g, ' '), l.id || ''].join('|')).digest('hex').slice(0, 16); }

function lerOfx(t) {
  const out = [];
  const blocos = t.split(/<STMTTRN>/i).slice(1);
  for (const b of blocos) {
    const pega = (tag) => { const m = new RegExp('<' + tag + '>\\s*([^<\\r\\n]*)', 'i').exec(b); return m ? m[1].trim() : ''; };
    const valor = numeroBR(pega('TRNAMT'));
    const data = dataExtrato(pega('DTPOSTED'));
    if (!Number.isFinite(valor) || !data) continue;
    out.push({ data, valor: arredondar(valor), descricao: texto([pega('NAME'), pega('MEMO')].filter(Boolean).join(' '), 200), id: texto(pega('FITID'), 60) });
  }
  return out;
}
function lerCsv(t) {
  const linhas = t.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const cont = (c) => (linhas.slice(0, 15).join('\n').split(c).length - 1);
  const sep = [';', '\t', ','].sort((a, b) => cont(b) - cont(a))[0];
  const partir = (l) => {
    const r = []; let cur = '', asp = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (asp && l[i + 1] === '"') { cur += '"'; i++; } else asp = !asp; }
      else if (ch === sep && !asp) { r.push(cur); cur = ''; }
      else cur += ch;
    }
    r.push(cur);
    return r.map((c) => c.trim());
  };
  const norm = (s) => semAcento(s).toLowerCase();
  let ih = -1, col = {};
  for (let i = 0; i < Math.min(linhas.length, 30); i++) {
    const cs = partir(linhas[i]).map(norm);
    const d = cs.findIndex((c) => /^(data|date|dt|data lancamento|data movimento|data do lancamento)/.test(c));
    const v = cs.findIndex((c) => /^(valor|amount|value|credito|valor \(r\$\)|valor r\$)/.test(c));
    if (d >= 0 && v >= 0) {
      ih = i;
      col = {
        d, v,
        desc: cs.findIndex((c) => /(descri|historico|lancamento|memo|nome|favorecido|identifica|origem|detalhe)/.test(c) && c !== cs[d] && c !== cs[v]),
        id: cs.findIndex((c) => /(^id$|identificador|documento|codigo|fitid|autentic)/.test(c))
      };
      break;
    }
  }
  if (ih < 0) return [];
  const out = [];
  for (let i = ih + 1; i < linhas.length; i++) {
    const cs = partir(linhas[i]);
    const valor = numeroBR(cs[col.v]);
    const data = dataExtrato(cs[col.d]);
    if (!Number.isFinite(valor) || !data) continue;
    out.push({ data, valor: arredondar(valor), descricao: texto(col.desc >= 0 ? cs[col.desc] : cs.filter((_, k) => k !== col.d && k !== col.v).join(' '), 200), id: texto(col.id >= 0 ? cs[col.id] : '', 60) });
  }
  return out;
}
function lerExtrato(conteudo) {
  const t = String(conteudo == null ? '' : conteudo).slice(0, 2 * 1024 * 1024);
  const formato = /<STMTTRN>/i.test(t) ? 'ofx' : 'csv';
  let lista = formato === 'ofx' ? lerOfx(t) : lerCsv(t);
  lista = lista.slice(0, 5000).map((l) => Object.assign(l, { hash: hashLancamento(l) }));
  return { formato, lancamentos: lista };
}

function palavras(s) { return semAcento(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3); }
const IGNORADAS = new Set(['PIX', 'RECEBIDO', 'RECEBIDA', 'TRANSF', 'TRANSFERENCIA', 'CREDITO', 'DE', 'DA', 'DO', 'DAS', 'DOS', 'LTDA', 'EIRELI']);

function conciliar(lancamentos, pagamentos, agora) {
  agora = agora || Date.now();
  const abertas = (pagamentos || []).filter((p) => emAberto(p));
  const usados = new Set((pagamentos || []).map((p) => p && p.extrato_id).filter(Boolean));
  const creditos = (lancamentos || []).filter((l) => l && l.valor > 0);
  const pares = [];
  let jaConciliados = 0;
  const livres = [];
  for (const l of creditos) {
    if (usados.has(l.hash) || (l.id && usados.has(l.id))) { jaConciliados++; continue; }
    livres.push(l);
    const alvo = semAcento(l.descricao + ' ' + (l.id || '')).toUpperCase().replace(/[^A-Z0-9]/g, '');
    for (const p of abertas) {
      if (Math.abs(p.valor - l.valor) > 0.005) continue;
      const emitida = paraMs(p.emitida_em);
      if (!isNaN(emitida) && l.data < diaDe(emitida - DIA)) continue; // dinheiro que entrou antes da cobrança não é desta cobrança
      let pontos = 1, motivo = 'Mesmo valor', forca = 'fraca';
      if (p.ref && alvo.indexOf(p.ref) >= 0) { pontos = 100; motivo = 'Código da cobrança (' + p.ref + ') no extrato'; forca = 'forte'; }
      else {
        const nomes = palavras(p.nome).filter((w) => !IGNORADAS.has(w));
        const desc = new Set(palavras(l.descricao));
        const bate = nomes.filter((w) => desc.has(w));
        if (bate.length >= 2 || (nomes.length === 1 && bate.length === 1)) { pontos = 50 + bate.length; motivo = 'Mesmo valor e nome: ' + bate.join(' '); forca = 'forte'; }
        else if (bate.length === 1) { pontos = 10; motivo = 'Mesmo valor e parte do nome (' + bate[0] + ')'; forca = 'fraca'; }
      }
      pares.push({ l, p, pontos, motivo, forca });
    }
  }
  pares.sort((a, b) => b.pontos - a.pontos || a.l.data.localeCompare(b.l.data));
  const lUsado = new Set(), pUsado = new Set();
  const sugestoes = [];
  for (const x of pares) {
    if (lUsado.has(x.l.hash) || pUsado.has(x.p.id)) continue;
    // Só valor igual, e mais de uma cobrança aberta com esse valor: não dá para saber de quem é, então não sugere
    if (x.forca === 'fraca' && x.pontos === 1) {
      const rivais = pares.filter((y) => y.l.hash === x.l.hash && y.pontos === 1).length;
      if (rivais > 1) continue;
    }
    lUsado.add(x.l.hash); pUsado.add(x.p.id);
    sugestoes.push({
      lancamento: { data: x.l.data, valor: x.l.valor, descricao: x.l.descricao, hash: x.l.hash },
      pagamento: { id: x.p.id, ref: x.p.ref, nome: x.p.nome, email: x.p.email, valor: x.p.valor, emitida_em: x.p.emitida_em, situacao: situacao(x.p, agora) },
      forca: x.forca, motivo: x.motivo
    });
  }
  const semPar = livres.filter((l) => !lUsado.has(l.hash)).slice(0, 200).map((l) => ({ data: l.data, valor: l.valor, descricao: l.descricao, hash: l.hash }));
  return { creditos: creditos.length, ja_conciliados: jaConciliados, sugestoes, sem_par: semPar };
}

/* ============================================================ configuração financeira (preço, Pix, cobrança mensal) ============================================================ */
/* O administrador altera aqui o que antes era constante no código. Esta função só VALIDA e NORMALIZA (não grava): o servidor guarda,
   aplica e registra quem mudou. Tudo que sai daqui já está no formato que o BR Code e as telas esperam. */
const CHAVE_TIPOS = Object.freeze({ telefone: 'celular', cpf: 'CPF', cnpj: 'CNPJ', email: 'e-mail', aleatoria: 'aleatória' });
const PRECO_MINIMO = 1;

function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += +d[i] * (n + 1 - i);
    if (((soma * 10) % 11) % 10 !== +d[n]) return false;
  }
  return true;
}
function cnpjValido(d) {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false;
  for (const n of [12, 13]) {
    let soma = 0, peso = n - 7;
    for (let i = 0; i < n; i++) { soma += +d[i] * peso; peso = peso === 2 ? 9 : peso - 1; }
    const dv = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (dv !== +d[n]) return false;
  }
  return true;
}
// Celular/fixo brasileiro com DDD (aceita +55, parênteses, traço); devolve só os dígitos ou ''
function telefoneBR(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length >= 12 && d.indexOf('55') === 0) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return '';
  if (d.length === 11 && d[2] !== '9') return '';
  const ddd = +d.slice(0, 2);
  return ddd >= 11 && ddd <= 99 ? d : '';
}
function formatarTelefone(d) {
  return d.length === 11 ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7) : '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
}
// Nome e cidade do BR Code: sem acento, só letras/números/espaço, maiúsculas (o banco do pagador mostra isto antes de confirmar)
function limparPix(s, max) { return semAcento(s).replace(/[^A-Za-z0-9 ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, max).trim(); }

function normalizarChavePix(tipo, valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  const digitos = bruto.replace(/\D/g, '');
  if (!bruto) return { ok: false, erro: 'Informe a chave Pix.' };
  if (tipo === 'telefone') {
    const t = telefoneBR(bruto);
    if (!t) return { ok: false, erro: 'Celular inválido. Informe o DDD e o número (ex.: (62) 99999-0000).' };
    return { ok: true, chave: '+55' + t, exibicao: formatarTelefone(t), copiar: t };
  }
  if (tipo === 'cpf') {
    if (!cpfValido(digitos)) return { ok: false, erro: 'CPF inválido. Confira os 11 dígitos.' };
    return { ok: true, chave: digitos, exibicao: digitos.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4'), copiar: digitos };
  }
  if (tipo === 'cnpj') {
    if (!cnpjValido(digitos)) return { ok: false, erro: 'CNPJ inválido. Confira os 14 dígitos.' };
    return { ok: true, chave: digitos, exibicao: digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'), copiar: digitos };
  }
  if (tipo === 'email') {
    const e = bruto.toLowerCase();
    if (e.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, erro: 'E-mail inválido para a chave Pix.' };
    return { ok: true, chave: e, exibicao: e, copiar: e };
  }
  if (tipo === 'aleatoria') {
    const u = bruto.toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u)) return { ok: false, erro: 'Chave aleatória inválida: ela tem o formato 00000000-0000-0000-0000-000000000000.' };
    return { ok: true, chave: u, exibicao: u, copiar: u };
  }
  return { ok: false, erro: 'Escolha o tipo da chave Pix.' };
}

function validarConfig(entrada) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const pix = e.pix && typeof e.pix === 'object' ? e.pix : {};
  const cob = e.cobranca && typeof e.cobranca === 'object' ? e.cobranca : {};
  const falha = (campo, erro) => ({ ok: false, campo, erro });

  const bruto = typeof e.preco === 'string' ? e.preco.trim() : e.preco;
  // "1.500" (só ponto, três casas) é ambíguo: pode ser 1,5 ou 1500. Pede a vírgula para não adivinhar.
  if (typeof bruto === 'string' && /^(R\$\s*)?\d{1,3}\.\d{3}$/.test(bruto)) return falha('preco', 'Use vírgula nos centavos (ex.: 18,00).');
  const preco = typeof bruto === 'number' ? bruto : numeroBR(bruto);
  if (!Number.isFinite(preco) || preco < PRECO_MINIMO || preco > VALOR_MAXIMO) return falha('preco', 'O preço mensal deve ficar entre ' + brl(PRECO_MINIMO) + ' e ' + brl(VALOR_MAXIMO) + '.');

  const tipo = String(pix.tipo || '').toLowerCase().trim();
  if (!CHAVE_TIPOS[tipo]) return falha('pix.tipo', 'Escolha o tipo da chave Pix.');
  const k = normalizarChavePix(tipo, pix.chave);
  if (!k.ok) return falha('pix.chave', k.erro);
  const nome = limparPix(pix.nome, 25);
  if (nome.length < 2) return falha('pix.nome', 'Informe o nome do favorecido, como aparece no banco (mínimo 2 letras).');
  const cidade = limparPix(pix.cidade, 15);
  if (cidade.length < 2) return falha('pix.cidade', 'Informe a cidade do favorecido (mínimo 2 letras).');

  const whatsapp = telefoneBR(e.whatsapp);
  if (!whatsapp) return falha('whatsapp', 'Informe o WhatsApp de suporte com DDD (10 ou 11 dígitos).');

  const dia = Number(cob.dia), prazo = Number(cob.prazo_dias);
  if (!Number.isInteger(dia) || dia < 1 || dia > 28) return falha('cobranca.dia', 'O dia da cobrança mensal deve ser de 1 a 28.');
  if (!Number.isInteger(prazo) || prazo < PRAZO_COBRANCA_MINIMO || prazo > 30) return falha('cobranca.prazo_dias', 'O prazo da cobrança deve ser de ' + PRAZO_COBRANCA_MINIMO + ' a 30 dias: toda conta fica disponível para pagamento 5 dias antes do vencimento.');

  return { ok: true, config: { preco: arredondar(preco), pix: { tipo, chave: k.chave, nome, cidade }, whatsapp, cobranca: { dia, prazo_dias: prazo } } };
}
// Textos prontos para as telas e para o cliente (chave como aparece, o que copiar, WhatsApp formatado)
function apresentarConfig(c) {
  const k = normalizarChavePix(c.pix.tipo, c.pix.chave);
  return {
    preco_texto: brl(c.preco),
    chave_tipo_rotulo: CHAVE_TIPOS[c.pix.tipo] || '',
    chave_exibicao: k.ok ? k.exibicao : String(c.pix.chave),
    chave_copiar: k.ok ? k.copiar : String(c.pix.chave),
    whatsapp_exibicao: formatarTelefone(c.whatsapp)
  };
}
// Chave parcialmente escondida (CPF, e-mail e celular são dados pessoais e o histórico/auditoria pode ser visto por quem recebeu a permissão de logs)
function mascararChave(c) { const s = String(c || ''); return s.length <= 8 ? '***' : s.slice(0, 3) + '…' + s.slice(-3); }
// Lista legível do que mudou entre duas configurações (vai para o histórico e para a auditoria)
function diferencasConfig(antes, depois) {
  const a = antes || {}, d = depois;
  const m = [];
  if (!a.preco || Math.abs(a.preco - d.preco) > 0.004) m.push('Preço mensal: ' + (a.preco ? brl(a.preco) : '—') + ' → ' + brl(d.preco));
  const pa = a.pix || {}, pd = d.pix;
  if (pa.tipo !== pd.tipo || pa.chave !== pd.chave) m.push('Chave Pix: ' + (pa.chave ? CHAVE_TIPOS[pa.tipo] + ' ' + mascararChave(pa.chave) : '—') + ' → ' + CHAVE_TIPOS[pd.tipo] + ' ' + mascararChave(pd.chave));
  if (pa.nome !== pd.nome) m.push('Favorecido do Pix: ' + (pa.nome || '—') + ' → ' + pd.nome);
  if (pa.cidade !== pd.cidade) m.push('Cidade do Pix: ' + (pa.cidade || '—') + ' → ' + pd.cidade);
  if (a.whatsapp !== d.whatsapp) m.push('WhatsApp de suporte: ' + (a.whatsapp ? formatarTelefone(a.whatsapp) : '—') + ' → ' + formatarTelefone(d.whatsapp));
  const ca = a.cobranca || {}, cd = d.cobranca;
  if (ca.dia !== cd.dia) m.push('Dia da cobrança mensal: ' + (ca.dia || '—') + ' → ' + cd.dia);
  if (ca.prazo_dias !== cd.prazo_dias) m.push('Prazo da cobrança: ' + (ca.prazo_dias ? ca.prazo_dias + ' dia(s)' : '—') + ' → ' + cd.prazo_dias + ' dia(s)');
  return m;
}

module.exports = {
  CHAVE_TIPOS, PRECO_MINIMO, cpfValido, cnpjValido, telefoneBR, formatarTelefone, limparPix, normalizarChavePix, validarConfig, apresentarConfig, diferencasConfig,
  STATUS, DIA, FIM_VITALICIO, VALOR_MAXIMO,
  paraMs, mesDe, diaDe, rotuloMes, somarMeses, dataIsoValida, arredondar, brl, texto,
  novoId, novaReferencia, limparReferencia,
  criarCobranca, situacao, emAberto, marcarInformada, calcularPeriodo, valorConfirmado, marcarPaga, cancelar, estornar, evento,
  sincronizarLegado, publico, classificarUsuario, resumo, csv,
  COBRANCA_DIA_PADRAO, PRAZO_COBRANCA_MINIMO, gerarCobrancasMensais, proximaGeracao, recebeCobrancaMensal,
  crc16, pixPayload, pixLer,
  numeroBR, lerExtrato, conciliar
};
