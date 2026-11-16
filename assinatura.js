'use strict';
/**
 * Assinatura: qual versão vale quando a MESMA conta existe na nuvem (Render) e no PC (SQL Server) — regras puras, testadas em assinatura.test.js.
 *
 * O problema que isto resolve: o PC enviava a assinatura do SQL Server para a nuvem a cada 10 s (overwrite) e NÃO importava a da nuvem, e o
 * navegador do administrador reenviava a lista inteira de usuários com a assinatura que tinha lido. Resultado: liberar, bloquear ou informar um
 * pagamento na nuvem durava poucos segundos (o último a gravar ganhava), e liberações seguidas partiam da mesma base antiga.
 *
 * A regra é a mesma da senha (credenciais.js): cada mudança INTENCIONAL (liberar, confirmar pagamento, estornar, bloquear, informar pagamento,
 * zerar o teste) carimba `subscription_updated_at`; entre duas versões vale a de carimbo mais novo. Mudanças derivadas do tempo (vencer,
 * iniciar o teste) NÃO carimbam: se carimbassem, um "expirado" calculado pelo relógio venceria uma liberação feita um minuto antes no outro servidor.
 */

const CAMPOS = ['subscription_status', 'subscription_plan', 'subscription_expires_at', 'subscription_method', 'subscription_payment_id', 'trial_started_at'];
const RELOGIO = 'subscription_updated_at';

const paraMs = (v) => { const t = v === null || v === undefined || v === '' ? NaN : Date.parse(v); return Number.isFinite(t) ? t : NaN; };
const relogioMs = (u) => (u ? paraMs(u[RELOGIO]) : NaN);
const vazio = (v) => v === undefined || v === null || v === '';
const ehData = (campo) => campo === 'subscription_expires_at' || campo === 'trial_started_at';

/**
 * Qual lado vale. `existing` = o que este servidor tem; `incoming` = o que chegou.
 * Relógio nos dois: o mais novo; igual = 'same' (fica o que já está). Só um lado com relógio: esse lado.
 * Nenhum: `opts.noClock` ('incoming' | 'existing'), decisão estável (padrão 'incoming': quem envia é a fonte soberana).
 * Devolve { source, fields, subscription_updated_at }; num envio parcial, o campo que não veio fica com o valor de `existing`.
 */
function pickSubscription(existing, incoming, opts) {
  const noClock = (opts && opts.noClock) === 'existing' ? 'existing' : 'incoming';
  const a = relogioMs(existing);
  const b = relogioMs(incoming);
  let source;
  if (Number.isFinite(a) && Number.isFinite(b)) source = b > a ? 'incoming' : (b < a ? 'existing' : 'same');
  else if (Number.isFinite(b)) source = 'incoming';
  else if (Number.isFinite(a)) source = 'existing';
  else source = noClock;
  const fields = {};
  CAMPOS.forEach((k) => {
    if (source === 'incoming') fields[k] = incoming && incoming[k] !== undefined ? incoming[k] : (existing ? existing[k] : undefined);
    else fields[k] = existing ? existing[k] : undefined;
  });
  const clock = source === 'incoming' ? (incoming && incoming[RELOGIO] !== undefined ? incoming[RELOGIO] : (existing ? existing[RELOGIO] : undefined)) : (existing ? existing[RELOGIO] : undefined);
  return { source, fields, subscription_updated_at: clock };
}

/** As duas assinaturas são a mesma coisa? (texto vazio = nulo; datas comparadas pelo instante, não pelo texto/fuso) */
function mesmaAssinatura(a, b) {
  return CAMPOS.every((k) => {
    const x = a ? a[k] : undefined;
    const y = b ? b[k] : undefined;
    if (vazio(x) && vazio(y)) return true;
    if (vazio(x) || vazio(y)) return false;
    if (ehData(k)) { const mx = paraMs(x); const my = paraMs(y); return Number.isFinite(mx) && Number.isFinite(my) ? mx === my : String(x) === String(y); }
    return String(x) === String(y);
  });
}

/** Carimba uma mudança intencional. Nunca recua: se o relógio da máquina voltou, o carimbo novo ainda é maior que o anterior. */
function stamp(user, agora) {
  if (!user) return user;
  const base = Number.isFinite(agora) ? agora : Date.now();
  const anterior = relogioMs(user);
  const ms = Number.isFinite(anterior) && anterior >= base ? anterior + 1 : base;
  user[RELOGIO] = new Date(ms).toISOString();
  return user;
}

/** Copia o resultado de pickSubscription (campos + carimbo) para um usuário. */
function aplicar(user, pick) {
  if (!user || !pick) return user;
  CAMPOS.forEach((k) => { if (pick.fields[k] !== undefined) user[k] = pick.fields[k]; });
  if (pick.subscription_updated_at !== undefined) user[RELOGIO] = pick.subscription_updated_at;
  return user;
}

/** Só os campos da assinatura (+ carimbo) de um usuário, para comparar/enviar. */
function recortar(user) {
  const out = {};
  CAMPOS.forEach((k) => { out[k] = user ? user[k] : undefined; });
  out[RELOGIO] = user ? user[RELOGIO] : undefined;
  return out;
}

module.exports = { CAMPOS, RELOGIO, relogioMs, pickSubscription, mesmaAssinatura, stamp, aplicar, recortar };
