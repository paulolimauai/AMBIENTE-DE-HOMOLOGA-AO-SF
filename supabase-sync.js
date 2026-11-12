// ============================================================
// Supabase Sync — "Meus Dados" no Supabase
// Espelha os dados financeiros de cada usuário (dados_financeiros)
// para o Supabase (Postgres) sem tirar a soberania do banco local.
//
// Configuração (.env):
//   SUPABASE_URL=https://<projeto>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=...   (recomendado no servidor)
//   SUPABASE_ANON_KEY=...           (fallback)
//
// Tabela esperada (ver supabase/schema.sql):
//   nexus_dados_financeiros (email text pk, dados jsonb, updated_at timestamptz)
// ============================================================

const { createClient } = require('@supabase/supabase-js');

const fs = require('fs');
const path = require('path');

// Credencial compartilhada versionada (mesmo padrão do .nexus_sync_token): o Render não recebe env vars
// novas sem painel, então URL+chave viajam no repositório privado para os dois lados falarem com o mesmo projeto.
function loadCommittedSupabaseCredentials() {
  try {
    const file = process.env.NEXUS_SUPABASE_FILE || path.join(__dirname, '.nexus_supabase');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const kv = {};
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) kv[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return kv;
  } catch (e) { return {}; }
}
const committedCreds = loadCommittedSupabaseCredentials();
const SUPABASE_URL = String(process.env.SUPABASE_URL || committedCreds.SUPABASE_URL || '').trim();
const SUPABASE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || committedCreds.SUPABASE_SERVICE_ROLE_KEY || committedCreds.SUPABASE_ANON_KEY || '').trim();
const TABLE = 'nexus_dados_financeiros';
// Espelho de credenciais/contas: tabela jsonb já existente no projeto (usuarios do SQL são soberanos localmente;
// o Supabase guarda uma cópia por e-mail para o site oficial nunca perder os logins em redeploy/restart).
const USERS_TABLE = 'dados_financeiros';

let client = null;
let clientInitTried = false;
let enabled = false;
let consecutiveFailures = 0;
const MAX_FAILURES = 5;

function registerFailure(context, message) {
  consecutiveFailures++;
  if (consecutiveFailures === 1 || consecutiveFailures % MAX_FAILURES === 0) {
    console.warn(`[SUPABASE] ${context}: ${message} (falhas seguidas: ${consecutiveFailures})`);
  }
  if (consecutiveFailures >= MAX_FAILURES) {
    enabled = false;
    console.warn('[SUPABASE] Muitas falhas seguidas — sincronização pausada por 10 min. Verifique SUPABASE_URL/chaves no .env e a tabela nexus_dados_financeiros.');
    setTimeout(() => { enabled = true; consecutiveFailures = 0; console.log('[SUPABASE] Retomando tentativas de sincronização.'); }, 10 * 60 * 1000).unref?.();
  }
}

function registerSuccess() { consecutiveFailures = 0; }

function getClient() {
  if (clientInitTried) return client;
  clientInitTried = true;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[SUPABASE] SUPABASE_URL ou chave não configurados — sincronização desativada.');
    return null;
  }
  try {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    enabled = true;
    console.log('[SUPABASE] Cliente inicializado:', SUPABASE_URL);
  } catch (e) {
    console.warn('[SUPABASE] Falha ao inicializar cliente:', e.message);
    client = null;
  }
  return client;
}

function isEnabled() { getClient(); return enabled && Boolean(client); }

// Fila com debounce por e-mail: muitas gravações seguidas viram um único upsert
const pendingPush = new Map();
const pendingTimers = new Map();
const PUSH_DEBOUNCE_MS = 1500;

async function upsertRow(email, data) {
  const sb = getClient();
  if (!sb || !enabled) return false;
  const key = String(email || '').toLowerCase().trim();
  if (!key || !data) return false;
  const updatedAt = data.updated_at || data.updated_at_ms || new Date().toISOString();
  const { error } = await sb.from(TABLE).upsert(
    { email: key, dados: data, updated_at: updatedAt },
    { onConflict: 'email' }
  );
  if (error) {
    registerFailure('Falha ao gravar dados de ' + key, error.message);
    return false;
  }
  registerSuccess();
  return true;
}

/** Enfileira envio dos dados de um usuário (chamado a cada saveLocalData). */
function pushFinancialData(email, data) {
  if (!isEnabled()) return;
  const key = String(email || '').toLowerCase().trim();
  if (!key || !data) return;
  pendingPush.set(key, data);
  if (pendingTimers.has(key)) return;
  const timer = setTimeout(async () => {
    pendingTimers.delete(key);
    const payload = pendingPush.get(key);
    pendingPush.delete(key);
    if (payload) await upsertRow(key, payload).catch(() => {});
  }, PUSH_DEBOUNCE_MS);
  if (timer.unref) timer.unref();
  pendingTimers.set(key, timer);
}

/** Envia todos os dados financeiros locais (migração inicial / autocura). */
async function pushAllFinancialData(allData) {
  const sb = getClient();
  if (!sb || !enabled || !allData || typeof allData !== 'object') return 0;
  const rows = Object.entries(allData)
    .filter(([em, d]) => em && d)
    .map(([em, d]) => ({
      email: String(em).toLowerCase().trim(),
      dados: d,
      updated_at: d.updated_at || d.updated_at_ms || new Date().toISOString()
    }));
  if (!rows.length) return 0;
  const { error } = await sb.from(TABLE).upsert(rows, { onConflict: 'email' });
  if (error) {
    registerFailure('Falha no envio em lote', error.message);
    return 0;
  }
  registerSuccess();
  return rows.length;
}

/** Lê os dados de um usuário no Supabase (null se não houver). */
async function pullFinancialData(email) {
  const sb = getClient();
  if (!sb || !enabled) return null;
  const key = String(email || '').toLowerCase().trim();
  if (!key) return null;
  const { data, error } = await sb.from(TABLE).select('dados, updated_at').eq('email', key).maybeSingle();
  if (error || !data) return null;
  return data.dados || null;
}

/** Baixa todos os dados do Supabase para comparação de timestamp. */
async function pullAllFinancialData() {
  const sb = getClient();
  if (!sb || !enabled) return {};
  const { data, error } = await sb.from(TABLE).select('email, dados, updated_at');
  if (error) {
    registerFailure('Falha ao baixar dados', error.message);
    return {};
  }
  registerSuccess();
  if (!Array.isArray(data)) return {};
  const map = {};
  for (const row of data) {
    if (row && row.email) map[String(row.email).toLowerCase().trim()] = row;
  }
  return map;
}

/** Remove os dados de um usuário no Supabase (conta excluída). */
async function deleteFinancialData(email) {
  const sb = getClient();
  if (!sb || !enabled) return;
  const key = String(email || '').toLowerCase().trim();
  if (!key) return;
  await sb.from(TABLE).delete().eq('email', key).then(() => {});
}

// ==================== Espelho de credenciais (tabela dados_financeiros) ====================
// Cada usuário vira uma linha { email, dados: <objeto do usuário>, updated_at }.
// O campo updated_at do objeto (carimbado no saveLocalUsers quando o cadastro muda) resolve conflitos:
// na leitura, só adota o remoto quando ele é mais novo que o local.

const pendingUsersPush = new Map();
let usersPushTimer = null;
const USERS_PUSH_DEBOUNCE_MS = 2000;

async function upsertUserRow(email, userObj) {
  const sb = getClient();
  if (!sb || !enabled) return false;
  const key = String(email || '').toLowerCase().trim();
  if (!key || !userObj) return false;
  const stamp = userObj.updated_at || userObj.last_login || new Date().toISOString();
  const { error } = await sb.from(USERS_TABLE).upsert(
    { email: key, dados: userObj, updated_at: stamp },
    { onConflict: 'email' }
  );
  if (error) {
    registerFailure('Falha ao gravar credencial de ' + key, error.message);
    return false;
  }
  registerSuccess();
  return true;
}

/** Enfileira envio das credenciais (chamado a cada saveLocalUsers). */
function pushUsersDebounced(users) {
  if (!isEnabled() || !Array.isArray(users)) return;
  for (const u of users) {
    const key = String((u && u.email) || '').toLowerCase().trim();
    if (key) pendingUsersPush.set(key, u);
  }
  if (usersPushTimer) return;
  usersPushTimer = setTimeout(async () => {
    usersPushTimer = null;
    const rows = Array.from(pendingUsersPush.entries());
    pendingUsersPush.clear();
    for (const [key, obj] of rows) await upsertUserRow(key, obj).catch(() => {});
  }, USERS_PUSH_DEBOUNCE_MS);
  if (usersPushTimer.unref) usersPushTimer.unref();
}

/** Baixa todas as credenciais espelhadas no Supabase: { email: { dados, updated_at } }. */
async function pullAllUsers() {
  const sb = getClient();
  if (!sb || !enabled) return {};
  const { data, error } = await sb.from(USERS_TABLE).select('email, dados, updated_at');
  if (error) {
    registerFailure('Falha ao baixar credenciais', error.message);
    return {};
  }
  registerSuccess();
  if (!Array.isArray(data)) return {};
  const map = {};
  for (const row of data) {
    if (row && row.email) map[String(row.email).toLowerCase().trim()] = row;
  }
  return map;
}

/** Remove a credencial espelhada de um usuário excluído. */
async function deleteUserData(email) {
  const sb = getClient();
  if (!sb || !enabled) return;
  const key = String(email || '').toLowerCase().trim();
  if (!key) return;
  await sb.from(USERS_TABLE).delete().eq('email', key).then(() => {});
}

module.exports = {
  isEnabled,
  pushFinancialData,
  pushAllFinancialData,
  pullFinancialData,
  pullAllFinancialData,
  deleteFinancialData,
  pushUsersDebounced,
  pullAllUsers,
  deleteUserData
};
