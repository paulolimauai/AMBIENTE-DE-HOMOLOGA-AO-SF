'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const K = require('./keepalive');

// Relógio falso: guarda o que foi agendado e só dispara quando o teste manda
function relogioFalso() {
  const fila = [];
  return {
    fila,
    setTimeoutFn: (fn, ms) => { const t = { fn, ms, cancelado: false, unref() {} }; fila.push(t); return t; },
    clearTimeoutFn: (t) => { if (t) t.cancelado = true; },
    pendentes: () => fila.filter((t) => !t.cancelado),
    ultimo: () => fila[fila.length - 1]
  };
}
const logFalso = () => { const l = { linhas: [], log: (m) => l.linhas.push(['log', m]), warn: (m) => l.linhas.push(['warn', m]) }; return l; };
const resp = (status) => ({ ok: status >= 200 && status < 300, status, body: null });

test('resolverConfig: fora do Render fica desligado', () => {
  assert.equal(K.resolverConfig({}).ativo, false);
  assert.equal(K.resolverConfig(undefined).ativo, false);
  assert.match(K.resolverConfig({}).motivo, /fora do Render/);
});

test('resolverConfig: no Render liga, chama /ping na raiz e usa 4 min', () => {
  const c = K.resolverConfig({ RENDER_EXTERNAL_URL: 'https://ambiente-de-homologa-ao-sf.onrender.com' });
  assert.equal(c.ativo, true);
  assert.equal(c.url, 'https://ambiente-de-homologa-ao-sf.onrender.com/ping');
  assert.equal(c.intervaloMs, 240000);
  // caminho na URL base não desloca o /ping
  assert.equal(K.resolverConfig({ RENDER_EXTERNAL_URL: 'https://x.onrender.com/app/' }).url, 'https://x.onrender.com/ping');
});

test('resolverConfig: NEXUS_KEEPALIVE=0 desliga mesmo no Render; NEXUS_KEEPALIVE_URL tem prioridade', () => {
  for (const v of ['0', 'false', 'OFF']) {
    assert.equal(K.resolverConfig({ NEXUS_KEEPALIVE: v, RENDER_EXTERNAL_URL: 'https://x.onrender.com' }).ativo, false);
  }
  const c = K.resolverConfig({ NEXUS_KEEPALIVE_URL: 'https://www.exemplo.com.br', RENDER_EXTERNAL_URL: 'https://x.onrender.com' });
  assert.equal(c.url, 'https://www.exemplo.com.br/ping');
});

test('resolverConfig: endereço inválido ou de outro protocolo não liga', () => {
  assert.equal(K.resolverConfig({ NEXUS_KEEPALIVE_URL: 'isto nao e url' }).ativo, false);
  assert.equal(K.resolverConfig({ NEXUS_KEEPALIVE_URL: 'ftp://x.com' }).ativo, false);
  assert.equal(K.resolverConfig({ NEXUS_KEEPALIVE_URL: 'javascript:alert(1)' }).ativo, false);
});

test('resolverConfig: o intervalo fica entre 30 s e 600 s (acima disso o Render dormiria)', () => {
  const base = { RENDER_EXTERNAL_URL: 'https://x.onrender.com' };
  assert.equal(K.resolverConfig({ ...base, NEXUS_KEEPALIVE_INTERVAL_S: '5' }).intervaloMs, 30000);
  assert.equal(K.resolverConfig({ ...base, NEXUS_KEEPALIVE_INTERVAL_S: '99999' }).intervaloMs, 600000);
  assert.equal(K.resolverConfig({ ...base, NEXUS_KEEPALIVE_INTERVAL_S: '120' }).intervaloMs, 120000);
  assert.equal(K.resolverConfig({ ...base, NEXUS_KEEPALIVE_INTERVAL_S: 'abc' }).intervaloMs, 240000);
  assert.equal(K.resolverConfig({ ...base, NEXUS_KEEPALIVE_INTERVAL_S: '-3' }).intervaloMs, 240000);
  assert.ok(K.INTERVALO_MAX_S < 15 * 60, 'o teto precisa ficar abaixo dos 15 min de ociosidade do Render');
});

test('deveLogarFalha: 1ª, 3ª e depois de 10 em 10', () => {
  const logadas = [];
  for (let i = 1; i <= 41; i++) if (K.deveLogarFalha(i)) logadas.push(i);
  assert.deepEqual(logadas, [1, 3, 10, 20, 30, 40]);
});

test('ciclo: agenda o primeiro ping, repete no intervalo e não acumula timers', async () => {
  const rel = relogioFalso(); const log = logFalso(); const chamadas = [];
  const ka = K.createKeepAlive({ url: 'https://x.onrender.com/ping', intervaloMs: 240000, primeiroPingMs: 5000, aleatorio: () => 0.5, log,
    fetchFn: async (url, init) => { chamadas.push({ url, ua: init.headers['User-Agent'] }); return resp(200); }, ...rel });
  assert.equal(ka.estado().ativo, false);
  ka.iniciar(); ka.iniciar();   // iniciar duas vezes não duplica
  assert.equal(rel.pendentes().length, 1);
  assert.equal(rel.pendentes()[0].ms, 5000);
  await rel.pendentes()[0].fn();
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].url, 'https://x.onrender.com/ping');
  assert.equal(chamadas[0].ua, K.USER_AGENT);
  const e = ka.estado();
  assert.equal(e.total_ok, 1); assert.equal(e.falhas_seguidas, 0); assert.equal(e.ultimo_status, 200); assert.ok(e.ultimo_ok_em);
  assert.equal(rel.pendentes().length, 1, 'só o próximo ping fica agendado');
  assert.equal(rel.pendentes()[0].ms, 240000, 'aleatorio=0.5 dá exatamente o intervalo (±10% em torno dele)');
  assert.match(log.linhas[0][1], /Primeiro ping ok/);
  await rel.pendentes()[0].fn();
  assert.equal(ka.estado().total_ok, 2);
  assert.equal(log.linhas.length, 1, 'pings normais seguintes não escrevem no log');
});

test('ciclo: a variação do intervalo fica dentro de ±10%', async () => {
  for (const [alea, esperado] of [[0, 216000], [0.999999, 263999], [0.5, 240000]]) {
    const rel = relogioFalso();
    const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 240000, primeiroPingMs: 1, aleatorio: () => alea, log: logFalso(), fetchFn: async () => resp(200), ...rel });
    ka.iniciar(); await rel.pendentes()[0].fn();
    assert.ok(Math.abs(rel.pendentes()[0].ms - esperado) <= 1, 'esperado ~' + esperado + ', veio ' + rel.pendentes()[0].ms);
  }
});

test('falha: tenta de novo em 1 min, conta falhas seguidas e avisa quando volta', async () => {
  const rel = relogioFalso(); const log = logFalso(); let status = 502;
  const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 240000, primeiroPingMs: 1, aleatorio: () => 0.5, log, fetchFn: async () => resp(status), ...rel });
  ka.iniciar();
  await rel.pendentes()[0].fn();
  let e = ka.estado();
  assert.equal(e.falhas_seguidas, 1); assert.equal(e.total_falhas, 1); assert.equal(e.ultimo_status, 502); assert.equal(e.ultimo_erro, 'HTTP 502');
  assert.equal(rel.pendentes()[0].ms, 60000, 'após falha repete em 1 min, não em 4');
  assert.equal(log.linhas.filter(([t]) => t === 'warn').length, 1);
  await rel.pendentes()[0].fn();                 // 2ª falha: não loga
  assert.equal(log.linhas.filter(([t]) => t === 'warn').length, 1);
  status = 200;
  await rel.pendentes()[0].fn();
  e = ka.estado();
  assert.equal(e.falhas_seguidas, 0); assert.equal(e.total_ok, 1); assert.equal(e.total_falhas, 2);
  assert.equal(rel.pendentes()[0].ms, 240000);
  assert.match(log.linhas[log.linhas.length - 1][1], /voltou ao normal depois de 2 falha/);
});

test('falha: o intervalo de repetição nunca passa do intervalo normal', async () => {
  const rel = relogioFalso();
  const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 30000, primeiroPingMs: 1, aleatorio: () => 0.5, log: logFalso(), fetchFn: async () => resp(500), ...rel });
  ka.iniciar(); await rel.pendentes()[0].fn();
  assert.equal(rel.pendentes()[0].ms, 30000);
});

test('falha de rede (fetch lança) vira falha registrada, nunca exceção', async () => {
  const rel = relogioFalso();
  const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 240000, primeiroPingMs: 1, log: logFalso(), fetchFn: async () => { throw new Error('ECONNRESET'); }, ...rel });
  ka.iniciar();
  await assert.doesNotReject(rel.pendentes()[0].fn());
  assert.equal(ka.estado().ultimo_erro, 'ECONNRESET');
  assert.equal(ka.estado().ultimo_status, 0);
  assert.equal(rel.pendentes().length, 1, 'continua agendado');
});

test('timeout: ping que não responde é abortado e conta como falha', async () => {
  const rel = relogioFalso();
  const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 240000, primeiroPingMs: 1, timeoutMs: 40, log: logFalso(), ...rel,
    fetchFn: (url, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); }) });
  ka.iniciar();
  await rel.pendentes()[0].fn();
  assert.match(ka.estado().ultimo_erro, /tempo esgotado/);
  assert.equal(ka.estado().falhas_seguidas, 1);
});

test('nunca roda dois pings ao mesmo tempo', async () => {
  const rel = relogioFalso(); let soltar; let n = 0;
  const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 240000, primeiroPingMs: 1, log: logFalso(), ...rel,
    fetchFn: () => { n++; return new Promise((r) => { soltar = () => r(resp(200)); }); } });
  ka.iniciar();
  const primeiro = ka.pingarAgora();
  await ka.pingarAgora();            // segundo pedido com o primeiro ainda em voo: ignorado
  assert.equal(n, 1);
  soltar(); await primeiro;
  assert.equal(ka.estado().total_ok, 1);
});

test('parar cancela o agendamento e um ping em voo não reagenda', async () => {
  const rel = relogioFalso(); let soltar;
  const ka = K.createKeepAlive({ url: 'https://x/ping', intervaloMs: 240000, primeiroPingMs: 1, log: logFalso(), ...rel, fetchFn: () => new Promise((r) => { soltar = () => r(resp(200)); }) });
  ka.iniciar();
  const voo = ka.pingarAgora();
  ka.parar();
  soltar(); await voo;
  assert.equal(rel.pendentes().length, 0);
  assert.equal(ka.estado().ativo, false);
});

test('ping de verdade contra um servidor HTTP local: manda o user-agent e lê o 200', async () => {
  const vistos = [];
  const srv = http.createServer((req, res) => { vistos.push({ url: req.url, ua: req.headers['user-agent'] }); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const cfg = K.resolverConfig({ NEXUS_KEEPALIVE_URL: 'http://127.0.0.1:' + srv.address().port });
    assert.equal(cfg.ativo, true);
    const ka = K.createKeepAlive({ url: cfg.url, intervaloMs: cfg.intervaloMs, primeiroPingMs: 60000, log: logFalso() });
    ka.iniciar();
    await ka.pingarAgora();
    ka.parar();
    assert.deepEqual(vistos, [{ url: '/ping', ua: K.USER_AGENT }]);
    assert.equal(ka.estado().total_ok, 1);
  } finally { srv.close(); }
});

test('ping de verdade: servidor que responde 503 vira falha; porta fechada também', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(503); res.end(); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  const ka = K.createKeepAlive({ url: 'http://127.0.0.1:' + porta + '/ping', intervaloMs: 240000, primeiroPingMs: 60000, log: logFalso() });
  ka.iniciar();
  await ka.pingarAgora();
  assert.equal(ka.estado().ultimo_status, 503);
  assert.equal(ka.estado().falhas_seguidas, 1);
  await new Promise((r) => srv.close(r));
  await ka.pingarAgora();            // porta agora fechada
  assert.equal(ka.estado().falhas_seguidas, 2);
  assert.equal(ka.estado().ultimo_status, 0);
  ka.parar();
});

test('iniciarSeConfigurado: desligado devolve null e explica; ligado agenda e estadoAtual reflete', () => {
  const log = logFalso();
  assert.equal(K.iniciarSeConfigurado({}, { log }), null);
  assert.match(log.linhas[0][1], /Desligado: fora do Render/);
  assert.deepEqual(K.estadoAtual(), { ativo: false });
  const rel = relogioFalso();
  const ka = K.iniciarSeConfigurado({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' }, { log, opcoes: { ...rel, fetchFn: async () => resp(200) } });
  assert.ok(ka);
  assert.equal(K.estadoAtual().ativo, true);
  assert.equal(K.estadoAtual().url, 'https://x.onrender.com/ping');
  assert.match(log.linhas[log.linhas.length - 1][1], /Ligado: ping em https:\/\/x\.onrender\.com\/ping a cada ~240 s/);
  K.pararTudo();
  assert.deepEqual(K.estadoAtual(), { ativo: false });
});
