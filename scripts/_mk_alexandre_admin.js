// Injeta o administrador "Alexandre" na API de sincronizacao do Render e prova o login real.
const fs = require('fs');
const path = require('path');

const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(l => {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});
const SYNC = env.NEXUS_SYNC_TOKEN;
const CLOUD = 'https://nexusfinanceirohub.com.br';
const EMAIL = 'admin@nexusfinanceirohub.com.br';
const SENHA = 'Alexandre@2026';
if (!SYNC) { console.log('NEXUS_SYNC_TOKEN ausente no .env'); process.exit(1); }

(async () => {
  // 1) cria/atualiza o usuario na nuvem (sync interna: aceita role Administrador e grava senha com hash)
  const up = await fetch(CLOUD + '/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Nexus-Sync-Token': SYNC },
    body: JSON.stringify({ users: [{
      name: 'Alexandre',
      email: EMAIL,
      password: SENHA,
      role: 'Administrador',
      active: true,
      terms_accepted: true,
      device_type: 'Computador',
      must_change_password: false,
      subscription_status: 'active',
      subscription_plan: 'administrador_ilimitado'
    }] })
  });
  const uj = await up.json().catch(() => ({}));
  console.log('POST /api/users:', up.status, JSON.stringify(uj).slice(0, 300));

  // 2) login real na API publica
  await new Promise(r => setTimeout(r, 1500));
  const login = await fetch(CLOUD + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: SENHA })
  });
  const lj = await login.json();
  console.log('login:', login.status, JSON.stringify({ success: lj.success, name: lj.user && lj.user.name, role: lj.user && lj.user.role, error: lj.error, must_change: lj.must_change_password }));
  if (!(lj.success && lj.token)) return;

  // 3) prova de admin: lista os arquivos do site e os dados do painel
  const adm = await fetch(CLOUD + '/api/admin/site/files', { headers: { 'Authorization': 'Bearer ' + lj.token } });
  const aj = await adm.json();
  console.log('admin site/files:', adm.status, aj.files ? aj.files.map(f => f.name).join(', ') : aj.error);

  const users = await fetch(CLOUD + '/api/users', { headers: { 'Authorization': 'Bearer ' + lj.token } });
  const us = await users.json();
  const lista = Array.isArray(us) ? us : (us.users || []);
  const alex = lista.find(u => String(u.email || '').toLowerCase() === EMAIL);
  console.log('GET /api/users:', users.status, '-> Alexandre:', alex ? JSON.stringify({ name: alex.name, role: alex.role, active: alex.active }) : 'nao encontrado (' + lista.length + ' contas)');
})().catch(e => console.log('ERR', e.message));
