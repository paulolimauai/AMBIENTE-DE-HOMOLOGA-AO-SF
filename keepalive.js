'use strict';
/**
 * Keep-alive do Render: mantém o serviço acordado enquanto ele está no ar.
 *
 * O problema: o Render derruba (põe para dormir) o serviço que fica 15 min sem receber requisição, e a primeira visita depois disso espera
 * ~10-50 s o processo subir de novo. O ping agendado pelo GitHub Actions (.github/workflows/keep-alive.yml) não segura: o cron do GitHub é
 * "melhor esforço" e rodou de 5 em 5 horas, não de 10 em 10 minutos.
 *
 * A solução em camadas (cada uma cobre a falha da outra):
 *   1. ESTE módulo — o próprio servidor chama o seu endereço público (RENDER_EXTERNAL_URL + /ping) a cada ~4 min. Passa pela borda do Render,
 *      conta como tráfego e a instância não chega perto dos 15 min de silêncio. Só funciona com o processo já acordado.
 *   2. worker.js — Cron Trigger do Cloudflare (a cada 5 min) chama /ping de fora. É ele que ACORDA o serviço se já estiver dormindo.
 *   3. render.yaml (healthCheckPath) — o Render reinicia a instância que parar de responder ao /ping.
 *
 * Só liga no Render (RENDER_EXTERNAL_URL) ou com NEXUS_KEEPALIVE_URL; no PC local e nos testes fica desligado. NEXUS_KEEPALIVE=0 desliga sempre.
 * Funções puras e dependências injetadas (fetch, relógio, temporizador): testado em keepalive.test.js sem rede.
 */

const INTERVALO_PADRAO_S = 240;      // 4 min: folga de sobra sobre os 15 min do Render
const INTERVALO_MIN_S = 30;
const INTERVALO_MAX_S = 600;         // acima disso o ping deixa de segurar a instância
const PRIMEIRO_PING_MS = 20000;      // logo após subir: prova que o ciclo funciona sem disputar CPU com o boot
const REPETICAO_APOS_FALHA_MS = 60000; // falhou: tenta de novo em 1 min (o Render pode estar só voltando de um deploy)
const TIMEOUT_MS = 25000;
const USER_AGENT = 'Nexus-KeepAlive/1.0 (auto-ping)';

const textoOuVazio = (v) => (v === null || v === undefined ? '' : String(v).trim());

// Decide se o keep-alive liga e com que parâmetros, a partir das variáveis de ambiente (puro: não lê process.env sozinho).
function resolverConfig(env) {
  const e = env || {};
  const flag = textoOuVazio(e.NEXUS_KEEPALIVE).toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return { ativo: false, motivo: 'desligado por NEXUS_KEEPALIVE=0' };
  const base = textoOuVazio(e.NEXUS_KEEPALIVE_URL) || textoOuVazio(e.RENDER_EXTERNAL_URL);
  if (!base) return { ativo: false, motivo: 'fora do Render (sem RENDER_EXTERNAL_URL)' };
  let url;
  try { url = new URL('/ping', base); } catch (err) { return { ativo: false, motivo: 'endereço inválido: ' + base }; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ativo: false, motivo: 'endereço inválido: ' + base };
  let seg = Number(textoOuVazio(e.NEXUS_KEEPALIVE_INTERVAL_S));
  if (!Number.isFinite(seg) || seg <= 0) seg = INTERVALO_PADRAO_S;
  seg = Math.min(INTERVALO_MAX_S, Math.max(INTERVALO_MIN_S, Math.round(seg)));
  return { ativo: true, url: url.href, intervaloMs: seg * 1000 };
}

// Quando registrar falha no log: na 1ª, na 3ª e depois de 10 em 10 (um Render fora do ar por horas não pode inundar o log).
const deveLogarFalha = (falhasSeguidas) => falhasSeguidas === 1 || falhasSeguidas === 3 || (falhasSeguidas > 3 && falhasSeguidas % 10 === 0);

function createKeepAlive(opts) {
  const o = opts || {};
  const url = o.url;
  const intervaloMs = o.intervaloMs || INTERVALO_PADRAO_S * 1000;
  const fetchFn = o.fetchFn || (typeof fetch === 'function' ? fetch : null);
  const agora = o.agora || (() => Date.now());
  const log = o.log || { log() {}, warn() {} };
  const setT = o.setTimeoutFn || setTimeout;
  const clearT = o.clearTimeoutFn || clearTimeout;
  const aleatorio = o.aleatorio || Math.random;
  const primeiroPingMs = o.primeiroPingMs === undefined ? PRIMEIRO_PING_MS : o.primeiroPingMs;
  const timeoutMs = o.timeoutMs || TIMEOUT_MS;

  let timer = null;
  let rodando = false;
  let emVoo = false;
  const est = { ativo: false, url: url, intervalo_s: Math.round(intervaloMs / 1000), ultima_tentativa_em: null, ultimo_ok_em: null, ultimo_status: null, ultimo_erro: null, falhas_seguidas: 0, total_ok: 0, total_falhas: 0 };

  // ±10% de variação: vários serviços/instâncias não chamam no mesmo segundo
  const proximoIntervalo = () => Math.round(intervaloMs * (0.9 + aleatorio() * 0.2));

  function agendar(ms) {
    if (!rodando) return;
    if (timer) clearT(timer);
    timer = setT(ciclo, ms);
    if (timer && typeof timer.unref === 'function') timer.unref();   // o servidor HTTP é quem mantém o processo vivo
  }

  async function pingar() {
    if (!fetchFn) throw new Error('fetch indisponível neste Node');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const aborta = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;   // relógio real: o injetado (setT) só controla o agendamento
    if (aborta && typeof aborta.unref === 'function') aborta.unref();
    try {
      const res = await fetchFn(url, { method: 'GET', headers: { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache' }, signal: ctrl ? ctrl.signal : undefined });
      try { if (res && res.body && typeof res.body.cancel === 'function') await res.body.cancel(); } catch (e) { /* corpo é irrelevante */ }
      return { ok: Boolean(res && res.ok), status: res ? res.status : 0 };
    } finally {
      if (aborta) clearTimeout(aborta);
    }
  }

  async function ciclo() {
    if (!rodando || emVoo) return;
    emVoo = true;
    est.ultima_tentativa_em = new Date(agora()).toISOString();
    let resultado;
    try {
      resultado = await pingar();
    } catch (err) {
      resultado = { ok: false, status: 0, erro: (err && err.name === 'AbortError') ? 'tempo esgotado (' + Math.round(timeoutMs / 1000) + ' s)' : String((err && err.message) || err) };
    }
    emVoo = false;
    est.ultimo_status = resultado.status;
    if (resultado.ok) {
      const recuperou = est.falhas_seguidas > 0;
      const primeiro = est.total_ok === 0;
      const falhas = est.falhas_seguidas;
      est.falhas_seguidas = 0;
      est.total_ok += 1;
      est.ultimo_ok_em = est.ultima_tentativa_em;
      est.ultimo_erro = null;
      if (recuperou) log.log('[KEEPALIVE] Ping voltou ao normal depois de ' + falhas + ' falha(s) seguida(s).');   // antes do "primeiro": não esconde as falhas
      else if (primeiro) log.log('[KEEPALIVE] Primeiro ping ok (' + resultado.status + ') em ' + url + ' — repete a cada ~' + est.intervalo_s + ' s.');
      agendar(proximoIntervalo());
    } else {
      est.falhas_seguidas += 1;
      est.total_falhas += 1;
      est.ultimo_erro = resultado.erro || ('HTTP ' + resultado.status);
      if (deveLogarFalha(est.falhas_seguidas)) log.warn('[KEEPALIVE] Ping falhou (' + est.ultimo_erro + '), falha seguida nº ' + est.falhas_seguidas + '. Nova tentativa em ' + Math.round(Math.min(REPETICAO_APOS_FALHA_MS, intervaloMs) / 1000) + ' s.');
      agendar(Math.min(REPETICAO_APOS_FALHA_MS, intervaloMs));
    }
  }

  return {
    iniciar() {
      if (rodando) return;
      rodando = true;
      est.ativo = true;
      agendar(primeiroPingMs);
    },
    parar() {
      rodando = false;
      est.ativo = false;
      if (timer) clearT(timer);
      timer = null;
    },
    // dispara um ciclo já (usado nos testes): resolve quando o ping terminou
    pingarAgora: ciclo,
    estado() { return Object.assign({}, est); }
  };
}

// Liga o keep-alive do processo se o ambiente pedir. Devolve a instância (ou null) e registra o motivo no log.
let instancia = null;
function iniciarSeConfigurado(env, extras) {
  const ex = extras || {};
  const log = ex.log || console;
  const cfg = resolverConfig(env);
  if (!cfg.ativo) { log.log('[KEEPALIVE] Desligado: ' + cfg.motivo + '.'); return null; }
  if (instancia) instancia.parar();
  instancia = createKeepAlive(Object.assign({ url: cfg.url, intervaloMs: cfg.intervaloMs, log }, ex.opcoes || {}));
  instancia.iniciar();
  log.log('[KEEPALIVE] Ligado: ping em ' + cfg.url + ' a cada ~' + Math.round(cfg.intervaloMs / 1000) + ' s (primeiro em ' + Math.round(PRIMEIRO_PING_MS / 1000) + ' s).');
  return instancia;
}
function estadoAtual() { return instancia ? instancia.estado() : { ativo: false }; }
function pararTudo() { if (instancia) { instancia.parar(); instancia = null; } }

module.exports = { INTERVALO_PADRAO_S, INTERVALO_MIN_S, INTERVALO_MAX_S, USER_AGENT, resolverConfig, deveLogarFalha, createKeepAlive, iniciarSeConfigurado, estadoAtual, pararTudo };
