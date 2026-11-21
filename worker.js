// Worker de entrada (Cloudflare Workers / Workers Builds).
// O Nexus é uma aplicação Node.js server-rendered: todas as telas e APIs (/api/*)
// são geradas pelo server.js hospedado no Render. Este Worker faz proxy transparente
// de todas as requisições que não correspondem a arquivos estáticos do dist/.
// Para trocar o backend, basta definir a variável APP_ORIGIN no painel do Cloudflare.

const DEFAULT_ORIGIN = 'https://ambiente-de-homologa-ao-sf.onrender.com';

// Keep-alive do Render. O Render dorme o serviço após 15 min sem requisição e a primeira visita espera ~10-50 s ele subir de novo.
// O Cron Trigger (wrangler.jsonc → triggers.crons, de 5 em 5 min) chama /ping de fora: é ele que ACORDA o serviço se já estiver dormindo
// (o auto-ping de dentro do servidor, keepalive.js, só funciona com o processo acordado). O cron do GitHub Actions não serve: rodou 14 vezes em 4 dias.
// Até 3 tentativas porque o 1º ping pode pegar o Render ainda subindo; se as 3 falharem a execução é marcada como falha no painel do Cloudflare.
const PING_TENTATIVAS = 3;
const PING_TIMEOUT_MS = 60000;
const PING_ESPERA_MS = 5000;

async function pingarRender(env) {
  const origin = (env && env.APP_ORIGIN) || DEFAULT_ORIGIN;
  const alvo = origin + '/ping';
  let ultimo = 'sem resposta';
  for (let tentativa = 1; tentativa <= PING_TENTATIVAS; tentativa++) {
    try {
      const resp = await fetch(alvo, {
        headers: { 'user-agent': 'Nexus-KeepAlive/1.0 (cloudflare-cron)', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(PING_TIMEOUT_MS)
      });
      try { await resp.body?.cancel(); } catch (e) { /* o corpo não importa */ }
      if (resp.ok) return { ok: true, status: resp.status, tentativa };
      ultimo = 'HTTP ' + resp.status;
    } catch (err) {
      ultimo = String((err && err.message) || err);
    }
    console.warn('[keep-alive] tentativa ' + tentativa + '/' + PING_TENTATIVAS + ' falhou em ' + alvo + ': ' + ultimo);
    if (tentativa < PING_TENTATIVAS) await new Promise((r) => setTimeout(r, PING_ESPERA_MS));
  }
  throw new Error('Render não respondeu ao /ping depois de ' + PING_TENTATIVAS + ' tentativas (' + ultimo + ')');
}

export default {
  // Cron Trigger: ver pingarRender()
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingarRender(env));
  },

  async fetch(request, env) {
    const origin = (env && env.APP_ORIGIN) || DEFAULT_ORIGIN;
    const url = new URL(request.url);
    const target = origin + url.pathname + url.search;

    const headers = new Headers(request.headers);
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    headers.set('x-forwarded-host', url.host);
    headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

    const init = {
      method: request.method,
      headers,
      redirect: 'manual'
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
    }

    try {
      const resp = await fetch(target, init);
      const outHeaders = new Headers(resp.headers);
      outHeaders.delete('content-encoding');
      outHeaders.delete('content-length');
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: outHeaders });
    } catch (err) {
      return new Response(
        JSON.stringify({ success: false, error: 'Backend indisponível. Tente novamente em instantes.' }),
        { status: 502, headers: { 'content-type': 'application/json; charset=utf-8' } }
      );
    }
  }
};
