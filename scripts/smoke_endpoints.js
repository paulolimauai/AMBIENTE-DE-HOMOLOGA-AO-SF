// Smoke test: bate em todas as rotas do server.js com cenários variados e reporta 5xx/erros inesperados.
const BASE = 'http://localhost:3000';

async function api(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  let payload;
  if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  if (raw) payload = raw;
  try {
    const res = await fetch(BASE + path, { method, headers, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { status: res.status, json, text: text.slice(0, 200) };
  } catch (e) {
    return { status: -1, error: e.message };
  }
}

(async () => {
  const adminLogin = await api('POST', '/api/login', { body: { email: 'admin@teste.nexus', password: 'Admin@12345' } });
  const userLogin = await api('POST', '/api/login', { body: { email: 'ana@teste.nexus', password: 'Ana@12345' } });
  const admin = adminLogin.json && adminLogin.json.token;
  const user = userLogin.json && userLogin.json.token;
  console.log('admin token:', !!admin, '| user token:', !!user);
  if (!admin || !user) { console.log('LOGIN FALHOU'); process.exit(1); }

  const results = [];
  const t = (name, r, expect) => {
    const ok = expect ? expect(r) : (r.status < 500);
    results.push({ name, status: r.status, ok, detail: ok ? '' : (r.text || r.error || '').slice(0, 160) });
  };

  // --- público / auth ---
  t('GET /api/health', await api('GET', '/api/health'), r => r.status === 200);
  t('POST /api/login senha errada', await api('POST', '/api/login', { body: { email: 'ana@teste.nexus', password: 'errada' } }), r => r.status === 401 || r.status === 403);
  t('POST /api/login email inexistente', await api('POST', '/api/login', { body: { email: 'ninguem@x.com', password: 'x' } }), r => r.status === 401 || r.status === 403 || r.status === 404);
  t('POST /api/login body inválido', await api('POST', '/api/login', { raw: '{invalid' }), r => r.status < 500);
  t('POST /api/register duplicado', await api('POST', '/api/register', { body: { name: 'X', email: 'ana@teste.nexus', password: 'Ana@12345', cpf: '52998224725' } }), r => r.status < 500);
  t('GET /api/cpf/consultar sem params', await api('GET', '/api/cpf/consultar'), r => r.status < 500);
  t('POST /api/send-password inexistente', await api('POST', '/api/send-password', { body: { email: 'ninguem@x.com' } }), r => r.status < 500);

  // --- rotas autenticadas (admin) ---
  const adminGets = ['/api/users', '/api/data?email=admin@teste.nexus', '/api/logs', '/api/ordens', '/api/ordens/minhas', '/api/tecnicos', '/api/filas', '/api/admin/usage', '/api/admin/boletos', '/api/subscription/status?email=admin@teste.nexus', '/api/sync/logins'];
  for (const p of adminGets) t('GET ' + p + ' [admin]', await api('GET', p, { token: admin }), r => r.status === 200);

  // --- rotas autenticadas (user comum) ---
  const userGets = ['/api/users', '/api/data?email=ana@teste.nexus', '/api/subscription/status?email=ana@teste.nexus'];
  for (const p of userGets) t('GET ' + p + ' [user]', await api('GET', p, { token: user }), r => r.status === 200);

  // user comum NÃO deve acessar admin
  t('GET /api/admin/usage [user]', await api('GET', '/api/admin/usage', { token: user }), r => r.status === 401 || r.status === 403);
  t('GET /api/admin/boletos [user]', await api('GET', '/api/admin/boletos', { token: user }), r => r.status === 401 || r.status === 403);
  t('GET /api/logs [user]', await api('GET', '/api/logs', { token: user }), r => r.status === 401 || r.status === 403);
  t('GET /api/data de outro [user]', await api('GET', '/api/data?email=admin@teste.nexus', { token: user }), r => r.status === 401 || r.status === 403);
  t('GET /api/backup [user]', await api('GET', '/api/backup', { token: user }), r => r.status === 401 || r.status === 403);

  // --- POSTs variados ---
  t('POST /api/data payload vazio', await api('POST', '/api/data', { token: user, body: {} }), r => r.status === 400);
  t('POST /api/data JSON quebrado', await api('POST', '/api/data', { token: user, raw: '{bad' }), r => r.status < 500);
  t('POST /api/data email de outro [user]', await api('POST', '/api/data', { token: user, body: { email: 'admin@teste.nexus', data: { transactions: [] } } }), r => r.status === 401 || r.status === 403);
  t('POST /api/user/profile [user]', await api('POST', '/api/user/profile', { token: user, body: { name: 'Ana Teste' } }), r => r.status < 500);
  t('POST /api/user/login-ping [user]', await api('POST', '/api/user/login-ping', { token: user, body: {} }), r => r.status < 500);
  t('POST /api/logs [admin]', await api('POST', '/api/logs', { token: admin, body: { action: 'Teste', entity: 'X', details: 'smoke' } }), r => r.status < 500);
  t('POST /api/ordens/acao inválido', await api('POST', '/api/ordens/acao', { token: admin, body: { acao: 'inexistente' } }), r => r.status < 500);
  t('POST /api/ordens body vazio', await api('POST', '/api/ordens', { token: user, body: {} }), r => r.status < 500);
  t('GET /api/ordens/consultar', await api('GET', '/api/ordens/consultar'), r => r.status < 500);
  t('POST /api/subscription/pay [user]', await api('POST', '/api/subscription/pay', { token: user, body: { plan: 'mensal' } }), r => r.status < 500);
  t('POST /api/subscription/confirm-payment sem dados', await api('POST', '/api/subscription/confirm-payment', { token: user, body: {} }), r => r.status < 500);
  t('POST /api/subscription/admin-grant-time [user]', await api('POST', '/api/subscription/admin-grant-time', { token: user, body: { email: 'ana@teste.nexus', days: 30 } }), r => r.status === 401 || r.status === 403);
  t('POST /api/database/reset [user]', await api('POST', '/api/database/reset', { token: user, body: {} }), r => r.status === 401 || r.status === 403);
  t('DELETE /api/users [user]', await api('DELETE', '/api/users', { token: user, body: { email: 'ana@teste.nexus' } }), r => r.status === 401 || r.status === 403);
  t('POST /api/tecnicos [user]', await api('POST', '/api/tecnicos', { token: user, body: {} }), r => r.status === 401 || r.status === 403);
  t('POST /api/filas [user]', await api('POST', '/api/filas', { token: user, body: {} }), r => r.status === 401 || r.status === 403);

  // estáticos
  t('GET / (página)', await api('GET', '/'), r => r.status === 200 && (r.text || '').includes('<'));
  t('GET /login', await api('GET', '/login'), r => r.status === 200);
  t('GET /glpi', await api('GET', '/glpi'), r => r.status === 200);
  t('GET /administracao.js', await api('GET', '/administracao.js'), r => r.status === 200);
  t('GET /dashboard-financeiro.js', await api('GET', '/dashboard-financeiro.js'), r => r.status === 200);
  t('GET /local_users.json (protegido)', await api('GET', '/local_users.json'), r => r.status === 404 || r.status === 401);
  t('GET /.env (protegido)', await api('GET', '/.env'), r => r.status === 404);
  t('GET /api/inexistente', await api('GET', '/api/inexistente'), r => r.status === 404);
  t('GET /images/../server.js traversal', await api('GET', '/images/..%2Fserver.js'), r => r.status !== 200);

  const fails = results.filter(r => !r.ok);
  console.log('\n===== RESULTADO: ' + (results.length - fails.length) + '/' + results.length + ' OK =====');
  fails.forEach(f => console.log('FALHOU:', f.name, '=>', f.status, f.detail));
})();
