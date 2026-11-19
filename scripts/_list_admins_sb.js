const fs = require('fs');
const path = require('path');
const env = {};
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach(l => {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
});
const SB = env.SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY };
(async () => {
  const r = await fetch(`${SB}/rest/v1/usuarios?select=name,email,role,active,last_login&order=last_login.desc.nullslast&limit=30`, { headers: H });
  const rows = await r.json();
  console.log('status', r.status, 'total retornado:', Array.isArray(rows) ? rows.length : JSON.stringify(rows).slice(0, 300));
  if (Array.isArray(rows)) rows.forEach(u => console.log('-', u.role, '|', u.name, '|', u.email, '| ativo:', u.active, '| login:', u.last_login));
})().catch(e => console.log('ERR', e.message));
