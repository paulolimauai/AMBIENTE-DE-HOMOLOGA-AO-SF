'use strict';
/**
 * Acesso: quando a MESMA conta existe na nuvem (Render) e no PC (SQL Server), qual versão do "bloqueado / ativo" vale — regras puras,
 * testadas em acesso.test.js.
 *
 * O problema que isto resolve: o administrador bloqueava uma conta no site (nuvem) e, em até 10 s, o PC reenviava a linha antiga do SQL Server
 * (active = 1) com overwrite e DESFAZIA o bloqueio — a pessoa voltava a entrar. A senha (credenciais.js) e a assinatura (assinatura.js) já
 * tinham um relógio para isso; o "bloqueado" não tinha.
 *
 * A regra é a mesma delas: cada mudança INTENCIONAL (o administrador bloqueia ou ativa a conta) carimba `active_updated_at`; entre duas versões vale
 * a de carimbo mais novo. Sem carimbo em nenhum dos lados, decide `opts.noClock` ('incoming' = quem envia é soberano, o comportamento antigo).
 * Nada derivado de relógio (vencimento, teste que acabou) mexe aqui: isso é da assinatura.
 */

const RELOGIO = 'active_updated_at';

const paraMs = (v) => { const t = v === null || v === undefined || v === '' ? NaN : Date.parse(v); return Number.isFinite(t) ? t : NaN; };
const relogioMs = (u) => (u ? paraMs(u[RELOGIO]) : NaN);

/** active como o sistema sempre leu: só false, 0 e '0' bloqueiam; ausente = ativo */
const ativo = (v) => !(v === false || v === 0 || v === '0');

/**
 * Qual lado vale. `existing` = o que este servidor tem; `incoming` = o que chegou.
 * Relógio nos dois: o mais novo; igual = 'same' (fica o que já está). Só um lado com relógio: esse lado. Nenhum: `opts.noClock`.
 * Devolve { source, active (boolean), active_updated_at }; se o lado escolhido não trouxe o campo, vale o do outro.
 */
function pickActive(existing, incoming, opts) {
  const noClock = (opts && opts.noClock) === 'existing' ? 'existing' : 'incoming';
  const a = relogioMs(existing);
  const b = relogioMs(incoming);
  let source;
  if (Number.isFinite(a) && Number.isFinite(b)) source = b > a ? 'incoming' : (b < a ? 'existing' : 'same');
  else if (Number.isFinite(b)) source = 'incoming';
  else if (Number.isFinite(a)) source = 'existing';
  else source = noClock;
  const doExistente = existing && existing.active !== undefined ? ativo(existing.active) : true;
  const active = source === 'incoming'
    ? (incoming && incoming.active !== undefined ? ativo(incoming.active) : doExistente)
    : doExistente;
  const clock = source === 'incoming'
    ? (incoming && incoming[RELOGIO] !== undefined ? incoming[RELOGIO] : (existing ? existing[RELOGIO] : undefined))
    : (existing ? existing[RELOGIO] : undefined);
  return { source, active, active_updated_at: clock };
}

/**
 * O "ativo" que vale para o LOGIN no PC: o da linha do SQL, a menos que o espelho local tenha uma mudança CARIMBADA (bloqueio/ativação do
 * administrador) que o SQL ainda não recebeu (UPDATE que falhou ou que ainda não chegou). Sem isto a pessoa recém-bloqueada entrava nessa janela.
 */
function ativoEfetivo(linhaSql, espelho) {
  if (espelho && Number.isFinite(relogioMs(espelho)) && espelho.active !== undefined) return ativo(espelho.active);
  return linhaSql ? ativo(linhaSql.active) : true;
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

/** Copia o resultado de pickActive (valor + carimbo) para um usuário. */
function aplicar(user, pick) {
  if (!user || !pick) return user;
  user.active = pick.active;
  if (pick.active_updated_at !== undefined) user[RELOGIO] = pick.active_updated_at;
  return user;
}

module.exports = { RELOGIO, ativo, relogioMs, pickActive, ativoEfetivo, stamp, aplicar };
