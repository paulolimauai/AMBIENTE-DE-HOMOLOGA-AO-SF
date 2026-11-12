const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const get = k => {
  const m = env.match(new RegExp('^' + k + '=(.+)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
};
const out = [
  'SUPABASE_URL=' + get('SUPABASE_URL'),
  'SUPABASE_SERVICE_ROLE_KEY=' + get('SUPABASE_SERVICE_ROLE_KEY'),
  'SUPABASE_ANON_KEY=' + get('SUPABASE_ANON_KEY')
].join('\r\n') + '\r\n';
fs.writeFileSync('.nexus_supabase', out);
console.log('ok');
