// Teste ponta a ponta das rotas de administração de assinatura (homologação)
const fs = require('fs');
const tok = fs.readFileSync('.tmp_tok.txt', 'utf8').trim();
const BASE = 'http://localhost:3000';
const ALVO = 'lucasano2010@gmail.com';
const ADM = 'paulolp0101@gmail.com';

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
    body: body ? JSON.stringify(body) : undefined
  });
  const d = await r.json().catch(() => ({}));
  return { status: r.status, d };
}
async function status(email) {
  const r = await j('GET', '/api/subscription/status?email=' + encodeURIComponent(email));
  return r.d;
}
function resumo(s) {
  return s ? `${s.status}|plan=${s.subscription_plan}|exp=${s.subscription_expires_at}` : 'null';
}
(async () => {
  console.log('== inicial ==', resumo(await status(ALVO)));

  // 1. admin-grant-time (60 min)
  let r = await j('POST', '/api/subscription/admin-grant-time', { admin_email: ADM, target_email: ALVO, duration_minutes: 60 });
  console.log('grant-time 60min:', r.status, JSON.stringify(r.d).slice(0, 200));
  console.log('  ->', resumo(await status(ALVO)));

  // 2. admin-grant-time vitalício
  r = await j('POST', '/api/subscription/admin-grant-time', { admin_email: ADM, target_email: ALVO, is_lifetime: true });
  console.log('grant-time vitalicio:', r.status, JSON.stringify(r.d).slice(0, 200));
  console.log('  ->', resumo(await status(ALVO)));

  // 3. reset-trial
  r = await j('POST', '/api/subscription/reset-trial', { email: ALVO, admin_email: ADM });
  console.log('reset-trial:', r.status, JSON.stringify(r.d).slice(0, 200));
  console.log('  ->', resumo(await status(ALVO)));

  // 4. confirm-payment (sem cobrança aberta -> cria e confirma)
  r = await j('POST', '/api/subscription/confirm-payment', { admin_email: ADM, target_email: ALVO, plan: 'mensal', method: 'pix' });
  console.log('confirm-payment:', r.status, JSON.stringify(r.d).slice(0, 300));
  console.log('  ->', resumo(await status(ALVO)));

  // 5. confirm-payment de novo (idempotência)
  r = await j('POST', '/api/subscription/confirm-payment', { admin_email: ADM, target_email: ALVO, plan: 'mensal', method: 'pix' });
  console.log('confirm-payment 2x:', r.status, JSON.stringify(r.d).slice(0, 300));

  // 6. revoke-payment
  r = await j('POST', '/api/subscription/revoke-payment', { admin_email: ADM, target_email: ALVO });
  console.log('revoke-payment:', r.status, JSON.stringify(r.d).slice(0, 200));
  console.log('  ->', resumo(await status(ALVO)));

  // 7. revoke-payment-bulk (assinatura ativa de novo via grant)
  await j('POST', '/api/subscription/admin-grant-time', { admin_email: ADM, target_email: ALVO, duration_minutes: 10080 });
  r = await j('POST', '/api/subscription/revoke-payment-bulk', { target_emails: [ALVO, 'naoexiste@x.com', ADM] });
  console.log('revoke-bulk:', r.status, JSON.stringify(r.d).slice(0, 400));
  console.log('  ->', resumo(await status(ALVO)));

  // 8. sem permissão: usuário comum tentando grant
  // (pula - precisaria de token de usuário)

  // 9. admin/pagamentos
  r = await j('GET', '/api/admin/pagamentos');
  console.log('admin/pagamentos:', r.status, 'success=' + r.d.success, 'total=' + r.d.total, 'preco=' + r.d.preco);

  // 10. gerar-mensal
  r = await j('POST', '/api/admin/pagamentos/gerar-mensal', {});
  console.log('gerar-mensal:', r.status, JSON.stringify(r.d).slice(0, 250));
})().catch(e => { console.error('FALHA', e); process.exit(1); });
