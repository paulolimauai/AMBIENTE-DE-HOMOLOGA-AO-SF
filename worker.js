// Worker de entrada (Cloudflare Workers / Workers Builds).
// O Nexus é uma aplicação Node.js server-rendered: todas as telas e APIs (/api/*)
// são geradas pelo server.js hospedado no Render. Este Worker faz proxy transparente
// de todas as requisições que não correspondem a arquivos estáticos do dist/.
// Para trocar o backend, basta definir a variável APP_ORIGIN no painel do Cloudflare.

const DEFAULT_ORIGIN = 'https://ambiente-de-homologa-ao-sf.onrender.com';

export default {
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
