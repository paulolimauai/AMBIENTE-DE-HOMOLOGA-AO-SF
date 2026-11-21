'use strict';
// ============================================================================
// Supabase — gravação direta e durável de TODOS os dados do sistema
//
// O que faz
//   Cada vez que o servidor grava um arquivo de estado (writeJsonFile), este módulo envia a diferença ao Supabase em
//   ~0,4 s. O que o Supabase ainda não confirmou fica registrado em disco (supabase_sync_state.json) e é reenviado até
//   ser aceito: queda de internet, queda do processo, erro 5xx ou reinício do servidor não perdem nenhum dado.
//
// Garantias
//   1. Nada é "dado como enviado" antes da confirmação do Supabase (ack por registro, gravado em disco de forma atômica).
//   2. Falha transitória → nova tentativa com espera crescente (2 s … 2 min), para sempre. Não há pausa longa nem desistência.
//   3. Uma linha recusada pelo banco (CPF duplicado, tipo inválido…) não trava as demais e não perde dado: a cópia fiel em
//      jsonb continua sendo enviada e a recusa aparece em status().
//   4. Nunca apaga em massa: se o arquivo local "esvaziou" (reset, arquivo corrompido, bug), as exclusões remotas ficam retidas.
//   5. system_logs é só-acréscimo (o arquivo local guarda só os 1000 mais recentes; o histórico remoto não é cortado).
//   6. Versão remota diferente da local, vista pela primeira vez, é arquivada antes de ser sobrescrita.
//   7. Disco novo/vazio (ex.: redeploy no Render): restoreMissingFiles() recompõe os arquivos a partir do Supabase.
//
// Onde grava (todas as tabelas já existem no projeto; nenhuma precisa ser criada)
//   usuarios, transacoes, contas_bancarias, categorias, ordens_servico, tecnicos_suporte, cpf_registry, system_logs  (visão relacional)
//   dados_financeiros            → objeto completo de cada usuário (cópia fiel)
//   nexus_dados_financeiros      → dados financeiros completos de cada usuário (chave = e-mail)
//                                   + documentos do sistema com chave "__sis__/<arquivo>/<id>" (chamados, filas, avatares…)
//
// Configuração: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (.env) ou o arquivo versionado .nexus_supabase.
// Desligar: NEXUS_DISABLE_SUPABASE=1 (também desligado com NEXUS_DISABLE_DB=1, usado nos testes).
// ============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOC_PREFIX = '__sis__/';
const ARCHIVE_PREFIX = DOC_PREFIX + '_substituidos/';
const STATE_FILE = 'supabase_sync_state.json';
const STATE_VERSION = 1;
const REQUEST_TIMEOUT_MS = 20000;
const CHUNK_ROWS = 100;
const CHUNK_BYTES = 1500000;
const MAX_BACKOFF_MS = 120000;
const AUTH_BACKOFF_MS = 300000;
const MAX_WAIT_MS = 5000;               // sob escrita contínua, o envio sai no máximo a cada 5 s
const POLL_MS = 5000;
const RECHECK_MS = 10 * 60 * 1000;      // reavalia pendências recusadas / tabelas ausentes
const VERIFY_MS = 30 * 60 * 1000;       // confere se o remoto ainda tem o que foi confirmado
const REJECT_RETRY_MS = 30 * 60 * 1000;
const AUDIT_MS = 6 * 60 * 60 * 1000;      // conferência de conteúdo (audit)
const DEGRADED_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------- utilidades
function sha(text) { return crypto.createHash('sha1').update(String(text)).digest('hex'); }

// JSON com chaves ordenadas: o mesmo conteúdo gera sempre o mesmo hash, independentemente da ordem dos campos
function stable(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).filter(k => value[k] !== undefined).sort()
    .map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
}

function lc(v) { return String(v === undefined || v === null ? '' : v).toLowerCase().trim(); }
function text(v) { return v === undefined || v === null ? null : String(v); }
function numberOr(v, d) { const n = parseFloat(v); return Number.isFinite(n) ? n : d; }

// Datas do sistema chegam em ISO, em milissegundos ou no formato brasileiro dd/mm/aaaa; o Postgres só aceita ISO.
function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return isNaN(value) ? null : value.toISOString();
  if (typeof value === 'number') { const d = new Date(value); return isNaN(d) ? null : d.toISOString(); }
  const s = String(value).trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (br) {
    const d = new Date(Date.UTC(+br[3], +br[2] - 1, +br[1], +(br[4] || 0) + 3, +(br[5] || 0), +(br[6] || 0))); // horário de Brasília
    return isNaN(d) ? null : d.toISOString();
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

function omit(row, skip) {
  const out = {};
  for (const k of Object.keys(row)) if (!skip.has(k)) out[k] = row[k];
  return out;
}
function approxSize(v) { try { return JSON.stringify(v).length; } catch (e) { return 1000; } }
function chunkBy(list, sizeOf) {
  const parts = []; let cur = []; let bytes = 0;
  for (const item of list) {
    const s = sizeOf(item);
    if (cur.length && (cur.length >= CHUNK_ROWS || bytes + s > CHUNK_BYTES)) { parts.push(cur); cur = []; bytes = 0; }
    cur.push(item); bytes += s;
  }
  if (cur.length) parts.push(cur);
  return parts;
}
function chunkArr(list, n) { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; }
function splitId(id) { const i = id.indexOf('|'); const j = id.indexOf('|', i + 1); return { file: id.slice(0, i), table: id.slice(i + 1, j), key: id.slice(j + 1) }; }

// ---------------------------------------------------------------- tabelas
const TABLES = {
  usuarios:                { kind: 'upsert',  keyCol: 'email' },
  dados_financeiros:       { kind: 'upsert',  keyCol: 'email', json: true },
  nexus_dados_financeiros: { kind: 'upsert',  keyCol: 'email', json: true },
  ordens_servico:          { kind: 'upsert',  keyCol: 'protocol' },
  tecnicos_suporte:        { kind: 'upsert',  keyCol: 'email' },
  cpf_registry:            { kind: 'upsert',  keyCol: 'cpf' },
  transacoes:              { kind: 'replace', ownerCol: 'user_email' },
  contas_bancarias:        { kind: 'replace', ownerCol: 'user_email' },
  categorias:              { kind: 'replace', ownerCol: 'user_email' },
  system_logs:             { kind: 'append' }
};

// ---------------------------------------------------------------- planos (arquivo local → linhas remotas)
function unitUpsert(table, key, row) { return { table, key, kind: 'upsert', row, hash: sha(stable(row)) }; }
function unitReplace(table, owner, rows) { return { table, key: owner, kind: 'replace', rows, hash: sha(stable(rows)) }; }

function docKey(short, key) { return DOC_PREFIX + short + '/' + key; }

// Cópia fiel de um arquivo de estado em nexus_dados_financeiros (uma linha por registro)
function docUnits(short, mode, json, pick) {
  const units = [];
  const used = new Set();
  const wrap = (v) => (v !== null && typeof v === 'object') ? v : { __valor: v };
  const add = (rawKey, value) => {
    let key = String(rawKey); let n = 1;
    while (used.has(key)) key = rawKey + '#' + (++n);
    used.add(key);
    const k = docKey(short, key);
    units.push(unitUpsert('nexus_dados_financeiros', k, { email: k, dados: wrap(value) }));
  };
  let m = mode;
  if (m === 'auto') {
    if (Array.isArray(json)) m = 'array';
    else { const vals = Object.values(json || {}); m = (vals.length && vals.every(v => v && typeof v === 'object')) ? 'map' : 'single'; }
  }
  if (m === 'single') add('_', json);
  else if (m === 'map') { for (const [k, v] of Object.entries(json || {})) add(k, v); }
  else (Array.isArray(json) ? json : []).forEach((item, i) => {
    if (item === null || item === undefined) return;
    const k = pick ? pick(item, i) : (item && (item.id !== undefined ? item.id : (item.email || item.protocol || item.cpf || item.key))) ;
    add(k === undefined || k === null || k === '' ? i : k, item);
  });
  return units;
}

// Nada é descartado em silêncio: registro sem chave utilizável (e-mail vazio…) vai como documento fiel em __sis__/sem-chave/<arquivo>/<chave>
const ORPHAN = 'sem-chave/';
const orphanKey = (file, key) => DOC_PREFIX + ORPHAN + file + '/' + (encodeURIComponent(String(key)) || '(vazio)');
function orphanUnit(file, key, value) {
  const k = orphanKey(file, key);
  return unitUpsert('nexus_dados_financeiros', k, { email: k, dados: (value !== null && typeof value === 'object') ? value : { __valor: value } });
}

function planUsers(json) {
  if (!Array.isArray(json)) return null;
  const units = [];
  json.forEach((u, i) => {
    if (u && typeof u === 'object' && !lc(u.email)) units.push(orphanUnit('local_users.json', i, u));
  });
  for (const u of json) {
    const email = lc(u && u.email);
    if (!email) continue;
    units.push(unitUpsert('dados_financeiros', email, { email, dados: u }));
    units.push(unitUpsert('usuarios', email, {
      name: text(u.name) || '', email, password: text(u.password) || '', role: text(u.role) || 'Usuário',
      active: u.active !== false, created_at: iso(u.created_at), last_login: iso(u.last_login),
      cpf: text(u.cpf), phone: text(u.phone), birth_date: text(u.birth_date),
      terms_accepted: u.terms_accepted !== false, device_type: text(u.device_type) || 'Computador',
      must_change_password: Boolean(u.must_change_password), trial_started_at: iso(u.trial_started_at),
      subscription_plan: text(u.subscription_plan), subscription_status: text(u.subscription_status) || 'trial',
      subscription_expires_at: iso(u.subscription_expires_at), subscription_method: text(u.subscription_method),
      subscription_payment_id: text(u.subscription_payment_id)
    }));
  }
  return units;
}

// Mesmas regras de conversão que o app já usa para gravar no SQL Server (syncUserTransactionsToTable & cia.)
function buildTransacoes(email, list) {
  const rows = [];
  const today = new Date().toISOString().slice(0, 10);
  (Array.isArray(list) ? list : []).forEach((t, i) => {
    if (!t) return;
    const id = parseInt(t.id, 10);
    rows.push({
      user_email: email,
      tx_id: Number.isFinite(id) ? id : i + 1,
      descricao: String(t.desc || t.description || 'Transação').trim(),
      valor: numberOr(t.val !== undefined ? t.val : t.amount, 0),
      data_transacao: String(t.date || today).trim(),
      categoria: String(t.cat || t.category || 'Geral').trim(),
      tipo: (t.type === 'in' || t.type === 'receita') ? 'Receita' : 'Despesa',
      conta: String(t.acc || t.account || 'Principal').trim(),
      status: String(t.status || 'Pendente').trim()
    });
  });
  return rows;
}
function buildContas(email, list) {
  const rows = [];
  (Array.isArray(list) ? list : []).forEach((a, i) => {
    if (!a || !a.name) return;
    const id = parseInt(a.id, 10);
    rows.push({
      user_email: email, account_id: Number.isFinite(id) ? id : i + 1, nome: String(a.name).trim(),
      tipo: a.type || 'Conta Corrente', saldo: numberOr(a.balance !== undefined ? a.balance : a.saldo, 0), cor: a.color || null
    });
  });
  return rows;
}
function buildCategorias(email, list) {
  const rows = []; const seen = new Set();
  for (const c of (Array.isArray(list) ? list : [])) {
    if (!c || !c.name) continue;
    const nome = String(c.name).trim();
    if (seen.has(nome.toLowerCase())) continue;
    seen.add(nome.toLowerCase());
    rows.push({ user_email: email, nome, tipo: c.type || 'despesa', icone: c.icon || null, cor: c.color || null });
  }
  return rows;
}

function planFinanceiro(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const units = [];
  for (const [rawEmail, data] of Object.entries(json)) {
    const email = lc(rawEmail);
    if (data === null || data === undefined) continue;
    if (!email || typeof data !== 'object') { units.push(orphanUnit('local_database_data.json', rawEmail, data)); continue; }   // ex.: conjunto antigo salvo sem e-mail
    units.push(unitUpsert('nexus_dados_financeiros', email, { email, dados: data }));
    units.push(unitReplace('transacoes', email, buildTransacoes(email, data.transactions)));
    units.push(unitReplace('contas_bancarias', email, buildContas(email, data.accounts)));
    units.push(unitReplace('categorias', email, buildCategorias(email, data.categories)));
  }
  return units;
}

function planOrdens(json) {
  if (!Array.isArray(json)) return null;
  const units = [];
  for (const o of json) {
    const protocol = text(o && o.protocol);
    if (!protocol) continue;
    units.push(unitUpsert('ordens_servico', protocol, {
      protocol, client_name: text(o.client_name) || '', client_email: text(o.client_email) || '', client_phone: text(o.client_phone),
      client_cpf: text(o.client_cpf), service_type: text(o.service_type) || 'Melhoria no Sistema', priority: text(o.priority) || 'Normal',
      title: text(o.title) || '', description: text(o.description) || '', status: text(o.status) || 'Pendente',
      admin_notes: text(o.admin_notes) || '', tecnico_responsavel: text(o.tecnico_responsavel), assumido_em: text(o.assumido_em),
      canal_atendimento: text(o.canal_atendimento) || 'Portal Web', concluido_em: text(o.concluido_em), sla: text(o.sla),
      asset: text(o.asset), time_spent: numberOr(o.time_spent, 0), solution: text(o.solution),
      timeline: o.timeline === undefined || o.timeline === null ? null : (typeof o.timeline === 'string' ? o.timeline : JSON.stringify(o.timeline)),
      ticket_type: text(o.ticket_type), fila: text(o.fila), created_at: iso(o.created_at), updated_at: iso(o.updated_at)
    }));
  }
  return units.concat(docUnits('ordens', 'array', json, o => o.protocol || o.id));
}

function planTecnicos(json) {
  if (!Array.isArray(json)) return null;
  const units = [];
  for (const t of json) {
    const email = lc(t && t.email);
    if (!email) continue;
    units.push(unitUpsert('tecnicos_suporte', email, {
      name: text(t.name) || 'Técnico', email, phone: text(t.phone), specialty: text(t.specialty) || 'Suporte Geral',
      active: t.active !== false, created_at: iso(t.created_at)
    }));
  }
  return units.concat(docUnits('tecnicos', 'array', json, t => lc(t.email) || t.id));
}

function planCpf(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const units = [];
  for (const [rawCpf, r] of Object.entries(json)) {
    const cpf = String(rawCpf).replace(/\D/g, '');
    if (!cpf || !r || typeof r !== 'object') continue;
    units.push(unitUpsert('cpf_registry', cpf, {
      cpf, nome: text(r.nome), data_nascimento: text(r.data_nascimento), phone: text(r.phone), email: text(r.email),
      situacao: text(r.situacao) || 'REGULAR', regiao_fiscal: text(r.regiao_fiscal), origem: text(r.origem), updated_at: iso(r.updated_at)
    }));
  }
  return units.concat(docUnits('cpf', 'map', json));
}

function logSig(timestampIso, email, action, entity, details) {
  return sha(Date.parse(timestampIso) + '|' + (email || '') + '|' + action + '|' + entity + '|' + details);
}
function planLogs(json) {
  if (!Array.isArray(json)) return null;
  const units = []; const seen = new Set();
  for (const l of json) {
    if (!l || typeof l !== 'object') continue;
    const timestamp = iso(l.timestamp) || iso(l.id);
    if (!timestamp) continue;
    const row = {
      timestamp, user_name: text(l.user_name), user_email: text(l.user_email),
      action: text(l.action) || 'Ação', entity: text(l.entity) || 'Sistema', details: text(l.details) || ''
    };
    const sig = logSig(timestamp, row.user_email, row.action, row.entity, row.details);
    if (seen.has(sig)) continue;
    seen.add(sig);
    units.push({ table: 'system_logs', key: sig, kind: 'append', row, hash: sig });
  }
  return units;
}

function docSource(short, mode, restoreMode) {
  return { plan: json => (json !== null && typeof json === 'object') ? docUnits(short, mode, json) : null, debounce: 400, restore: { kind: 'doc', short, mode: restoreMode || mode } };
}

const SOURCES = {
  'deleted_accounts.json':     docSource('deleted', 'array'),
  'local_users.json':          { plan: planUsers, debounce: 400, restore: { kind: 'users' } },
  'local_database_data.json':  { plan: planFinanceiro, debounce: 400, restore: { kind: 'financeiro' } },
  'local_ordens_servico.json': { plan: planOrdens, debounce: 400, restore: { kind: 'doc', short: 'ordens', mode: 'array' } },
  'local_tecnicos.json':       { plan: planTecnicos, debounce: 400, restore: { kind: 'doc', short: 'tecnicos', mode: 'array' } },
  'cpf_registry.json':         { plan: planCpf, debounce: 400, restore: { kind: 'doc', short: 'cpf', mode: 'map' } },
  'system_logs.json':          { plan: planLogs, debounce: 3000 },
  'local_filas.json':          docSource('filas', 'array'),
  'local_os_sequencia.json':   docSource('os_seq', 'single'),
  // fila TRANSITÓRIA de logins feitos na nuvem esperando o PC (os eventos e o último login ficam em system_logs e em usuarios.last_login,
  // conferidos um a um): o espelho por posição repete eventos e dois servidores o reescrevem, então a conferência de conteúdo só a conta à parte
  'pending_logins.json':       Object.assign(docSource('pending', 'array'), { volatile: true }),
  'local_avatars.json':        docSource('avatars', 'map'),
  'local_permissions.json':    docSource('permissions', 'map'),  // e-mail -> lista de permissões
  'local_pagamentos.json':     docSource('pagamentos', 'array'), // livro de pagamentos e cobranças (pagamentos.js): um documento por registro (id)
  'local_boletos.json':        docSource('boletos', 'array'),    // boletos legados (tinham ficado de fora do envio: 1 registro só no disco)
  'local_financeiro_config.json': docSource('fin_config', 'single') // preço, chave Pix e cobrança mensal definidos pelo administrador (+ histórico de alterações)
};

// ---------------------------------------------------------------- classificação de erros
// Só vira "linha recusada" (quarentena de 30 min) o que o Postgres/PostgREST diz explicitamente ser problema do dado.
// Qualquer outra coisa — rede, timeout, 5xx, 429, resposta de proxy sem código — é tentada de novo com espera crescente,
// para nunca atrasar nem perder um envio por causa de uma falha de conexão.
function classify(err) {
  const code = String(err.code || ''); const msg = String(err.message || ''); const status = Number(err.status || 0);
  if (!code && /fetch failed|network|timed? ?out|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|aborted|terminated|UND_ERR|getaddrinfo/i.test(msg)) return 'transient';
  if (code === '42P10') return 'noconstraint';
  if (code === 'PGRST204' || code === '42703') return 'nocolumn';
  if (code === '42P01' || code === 'PGRST205') return 'notable';
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501' || status === 401 || status === 403 || /invalid api key|\bjwt\b|permission denied|row-level security/i.test(msg)) return 'auth';
  if (/^(21|22|23)/.test(code) || /^PGRST1\d\d$/.test(code)) return 'row';
  return 'transient';
}
function toError(kind, err, table) {
  const e = new Error((table ? table + ': ' : '') + (err.message || 'erro do Supabase'));
  e.kind = kind; e.code = err.code || '';
  return e;
}
function missingColumn(err) {
  const m = String(err.message || '');
  const a = m.match(/'([^']+)' column/i) || m.match(/column "?([A-Za-z0-9_]+)"?/i);
  return a ? a[1] : null;
}

// ---------------------------------------------------------------- credenciais
function loadCommittedCredentials(dir) {
  try {
    const file = process.env.NEXUS_SUPABASE_FILE || path.join(dir, '.nexus_supabase');
    const kv = {};
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (m) kv[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return kv;
  } catch (e) { return {}; }
}
function keyRole(key) {
  try { return JSON.parse(Buffer.from(String(key).split('.')[1], 'base64').toString()).role || 'jwt'; }
  catch (e) { return /^sb_secret_/.test(key) ? 'service_role' : /^sb_publishable_/.test(key) ? 'anon' : 'desconhecido'; }
}
function projectRefOf(url) { const m = String(url || '').match(/^https?:\/\/([a-z0-9-]+)\./i); return m ? m[1] : String(url || ''); }

function fetchWithTimeout(input, init) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  const opts = Object.assign({}, init || {});
  if (!opts.signal) opts.signal = ctl.signal;
  return fetch(input, opts).finally(() => clearTimeout(timer));
}

// ============================================================================
function createSync() {
  let enabled = false;
  let started = false;
  let disabledReason = 'não iniciado';
  let sb = null;
  let projectRef = '';
  let role = '';
  let dataDir = __dirname;
  let log = console;
  let timersOn = true;
  let state = null;

  const dirty = new Map();            // arquivo -> quando enviar
  const firstDirty = new Map();       // arquivo -> quando ficou sujo pela primeira vez
  const lastSig = new Map();          // arquivo -> assinatura (mtime:size) vista pelo vigia
  const pendingByFile = new Map();    // arquivo -> unidades ainda não confirmadas
  const heldByFile = new Map();       // arquivo -> exclusões retidas pela trava
  const skipCols = {};                // tabela -> Set de colunas que o banco remoto não tem
  const degraded = {};                // tabela -> { message, until }
  const lastLogAt = {};
  let running = null;
  let retryAt = 0;
  let failures = 0;
  let lastError = null;
  let lastSuccessAt = null;
  let lastFullPass = 0;
  let lastVerify = 0;
  let lastHeartbeat = 0;
  let timer = null;
  let poller = null;
  let stopped = false;
  let restoredFiles = [];
  let verifying = false;
  let credentialGuards = 0;           // quantas vezes uma senha MAIS NOVA que já estava no Supabase foi preservada
  let sequenceGuards = 0;             // idem para o contador de protocolo (vale sempre o maior)
  let blankGuards = 0;                // quantas vezes um retrato financeiro ZERADO deixou de sobrescrever conteúdo que o destino já tinha
  let staleHealed = 0;                // registros reenviados porque o Supabase tinha uma versão mais antiga (cura)
  let lastAudit = null;               // resultado da última conferência de conteúdo
  let lastAuditAt = 0;

  const statePath = () => path.join(dataDir, STATE_FILE);

  function say(level, key, message) {            // registro com limite: a mesma mensagem no máximo a cada 5 min
    const now = Date.now();
    if (lastLogAt[key] && now - lastLogAt[key] < 300000) return;
    lastLogAt[key] = now;
    try { (log[level] || log.log).call(log, '[SUPABASE] ' + message); } catch (e) {}
  }

  // ---------------------------------------------------------------- estado em disco
  function freshState() { return { version: STATE_VERSION, project: projectRef, acked: {}, rejected: {}, fresh: true }; }
  function loadState() {
    state = freshState();
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
      if (parsed && parsed.version === STATE_VERSION && parsed.acked) {
        if (parsed.project === projectRef) {
          state = Object.assign(freshState(), parsed, { fresh: Object.keys(parsed.acked).length === 0 });
        } else {
          log.warn('[SUPABASE] O projeto de destino mudou (' + parsed.project + ' → ' + projectRef + '): todos os dados serão reenviados ao novo projeto.');
        }
      }
    } catch (e) {}
  }
  function saveState() {
    try {
      const tmp = statePath() + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, statePath());
    } catch (e) { say('warn', 'state', 'Não foi possível gravar ' + STATE_FILE + ': ' + e.message); }
  }
  const ack = (u) => { state.acked[u.id] = u.hash; delete state.rejected[u.id]; };
  const reject = (u, message) => { state.rejected[u.id] = { hash: u.hash, at: Date.now(), table: u.table, key: u.key, message: String(message).slice(0, 300) }; };

  // ---------------------------------------------------------------- leitura dos arquivos locais
  function readSource(file) {
    let raw;
    try { raw = fs.readFileSync(path.join(dataDir, file), 'utf8'); } catch (e) { return {}; }
    if (!raw.trim()) return {};
    try { return { json: JSON.parse(raw) }; } catch (e) { return { corrupt: true }; }
  }
  function deletedEmails() {
    const set = new Set();
    const r = readSource('deleted_accounts.json');
    if (Array.isArray(r.json)) r.json.forEach(x => { const e = lc(typeof x === 'string' ? x : x && x.email); if (e) set.add(e); });
    return set;
  }

  // ---------------------------------------------------------------- chamadas ao Supabase
  async function call(fn) {
    try {
      const res = (await fn()) || {};
      // no postgrest-js o status HTTP vem ao lado de "error", não dentro dele
      if (res.error && res.error.status === undefined && res.status !== undefined) { try { res.error.status = res.status; } catch (e) {} }
      return res;
    } catch (e) { return { error: { message: String((e && e.message) || e), code: '', status: 0 } }; }
  }

  async function withStrip(table, rows, exec, keyCol) {
    for (let i = 0; i < 12; i++) {
      const skip = skipCols[table];
      const payload = skip && skip.size ? rows.map(r => omit(r, skip)) : rows;
      const res = await call(() => exec(payload));
      if (!res.error) return res;
      if (classify(res.error) === 'nocolumn') {
        const col = missingColumn(res.error);
        if (col && col !== keyCol) {
          (skipCols[table] = skipCols[table] || new Set()).add(col);
          say('warn', 'col:' + table + col, 'A tabela ' + table + ' do Supabase não tem a coluna "' + col + '": ela será omitida (o dado continua na cópia fiel).');
          continue;
        }
      }
      return res;
    }
    return { error: { message: 'colunas ausentes demais em ' + table, code: '' } };
  }

  async function manualUpsert(table, keyCol, rows) {
    for (const part of chunkArr(rows, 50)) {
      const found = await call(() => sb.from(table).select(keyCol).in(keyCol, part.map(r => r[keyCol])));
      if (found.error) return found;
      const existing = new Set((found.data || []).map(x => String(x[keyCol])));
      const toInsert = part.filter(r => !existing.has(String(r[keyCol])));
      if (toInsert.length) { const r = await withStrip(table, toInsert, p => sb.from(table).insert(p), keyCol); if (r.error) return r; }
      for (const row of part.filter(r => existing.has(String(r[keyCol])))) {
        const r = await withStrip(table, [row], p => sb.from(table).update(p[0]).eq(keyCol, row[keyCol]), keyCol);
        if (r.error) return r;
      }
    }
    return {};
  }
  async function rawUpsert(table, keyCol, rows) {
    const res = await withStrip(table, rows, p => sb.from(table).upsert(p, { onConflict: keyCol }), keyCol);
    if (res.error && classify(res.error) === 'noconstraint') return manualUpsert(table, keyCol, rows);
    return res;
  }
  async function rawInsert(table, rows) { return withStrip(table, rows, p => sb.from(table).insert(p), null); }

  // Envia em lote; se o banco recusar o lote por causa de dados, isola linha a linha para só recusar quem está errado
  async function writeRows(table, rows, raw) {
    const res = await raw(rows);
    if (!res.error) return { rejected: [] };
    const kind = classify(res.error);
    if (kind === 'row' && rows.length > 1) {
      const rejected = [];
      for (let i = 0; i < rows.length; i++) {
        const one = await raw([rows[i]]);
        if (!one.error) continue;
        const k = classify(one.error);
        if (k === 'row') rejected.push({ index: i, message: one.error.message });
        else throw toError(k, one.error, table);
      }
      return { rejected };
    }
    if (kind === 'row') return { rejected: [{ index: 0, message: res.error.message }] };
    throw toError(kind, res.error, table);
  }
  const upsertRows = (table, keyCol, rows) => writeRows(table, rows, r => rawUpsert(table, keyCol, r));
  const insertRows = (table, rows) => writeRows(table, rows, r => rawInsert(table, r));

  async function selectAll(table, cols, apply, orderCols) {
    const out = []; const page = 1000;
    const order = Array.isArray(orderCols) ? orderCols : [orderCols];
    for (let from = 0; ; from += page) {
      const res = await call(() => {
        let q = sb.from(table).select(cols);
        if (apply) q = apply(q);
        for (const c of order) q = q.order(c);          // ordem total (com desempate), senão a paginação pode pular linhas
        return q.range(from, from + page - 1);
      });
      if (res.error) throw toError(classify(res.error), res.error, table);
      const rows = res.data || [];
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  }

  function finalizeRow(table, row) {
    const out = Object.assign({}, row);
    if (TABLES[table].json) out.updated_at = new Date().toISOString();
    if (table === 'usuarios' && !out.created_at) out.created_at = new Date().toISOString();
    return out;
  }

  const degradedActive = (table) => degraded[table] && degraded[table].until > Date.now();
  function markDegraded(table, message) {
    degraded[table] = { message, until: Date.now() + DEGRADED_MS };
    say('warn', 'deg:' + table, 'Tabela "' + table + '" indisponível no Supabase (' + message + '). Os dados seguem seguros localmente e serão enviados quando a tabela existir.');
  }

  // ---------------------------------------------------------------- envio por tipo de tabela
  // 6. Versão remota diferente da local, vista pela primeira vez: guarda uma cópia antes de sobrescrever
  async function archiveExisting(table, keyCol, list) {
    const fresh = list.filter(u => state.acked[u.id] === undefined);
    if (!fresh.length) return;
    const found = [];
    for (const part of chunkArr(fresh, 50)) {
      const res = await call(() => sb.from(table).select('*').in(keyCol, part.map(u => u.key)));
      if (res.error) {
        const kind = classify(res.error);
        if (kind === 'transient' || kind === 'auth') throw toError(kind, res.error, table);
        return; // sem como ler (tabela/colunas diferentes): segue sem arquivar
      }
      for (const row of (res.data || [])) {
        const mine = part.find(u => String(u.key) === String(row[keyCol]));
        if (mine) found.push({ remote: row, unit: mine });
      }
    }
    const docs = [];
    for (const { remote, unit } of found) {
      if (String(unit.key).startsWith(ARCHIVE_PREFIX)) continue;
      let differs;
      if (TABLES[table].json) differs = stable(remote.dados) !== stable(unit.row.dados);
      else differs = Object.keys(unit.row).some(c => !/_at$/.test(c) && unit.row[c] !== null && remote[c] !== undefined && String(remote[c] === null ? '' : remote[c]) !== String(unit.row[c]));
      if (!differs) continue;
      const copy = Object.assign({}, remote); delete copy.password;       // senhas não são copiadas para o arquivo
      const key = ARCHIVE_PREFIX + table + '/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + sha(table + unit.key).slice(0, 8);
      docs.push({ email: key, dados: { tabela: table, chave: unit.key, arquivado_em: new Date().toISOString(), versao_remota: copy }, updated_at: new Date().toISOString() });
    }
    if (docs.length) {
      const r = await rawUpsert('nexus_dados_financeiros', 'email', docs);
      if (r.error) throw toError(classify(r.error), r.error, 'nexus_dados_financeiros');
      say('log', 'archive:' + table, docs.length + ' registro(s) de "' + table + '" já existiam no Supabase com conteúdo diferente; a versão anterior foi arquivada em ' + ARCHIVE_PREFIX + '.');
    }
  }

  async function pushUpserts(table, list) {
    if (degradedActive(table)) return;
    const meta = TABLES[table];
    try {
      await archiveExisting(table, meta.keyCol, list);
      for (const part of chunkBy(list, u => approxSize(u.row))) {
        const rows = part.map(u => finalizeRow(table, u.row));
        const result = await upsertRows(table, meta.keyCol, rows);
        const bad = new Map(result.rejected.map(r => [r.index, r.message]));
        part.forEach((u, i) => { if (bad.has(i)) reject(u, bad.get(i)); else ack(u); });
      }
    } catch (e) { if (e.kind === 'notable') { markDegraded(table, e.message); return; } throw e; }
  }

  async function pushReplace(u) {
    const meta = TABLES[u.table];
    if (degradedActive(u.table)) return;
    try {
      const old = await selectAll(u.table, 'id', q => q.eq(meta.ownerCol, u.key), 'id');
      let rejected = 0;
      for (const part of chunkBy(u.rows, r => approxSize(r))) rejected += (await insertRows(u.table, part)).rejected.length;
      if (rejected) { reject(u, rejected + ' linha(s) recusada(s) pelo banco'); return; }   // mantém as antigas: nada some
      for (const part of chunkArr(old.map(r => r.id), 100)) {
        const r = await call(() => sb.from(u.table).delete().in('id', part));
        if (r.error) throw toError(classify(r.error), r.error, u.table);
      }
      ack(u);
    } catch (e) { if (e.kind === 'notable') { markDegraded(u.table, e.message); return; } throw e; }
  }

  async function pushAppend(table, list) {
    if (degradedActive(table)) return;
    try {
      const stamps = list.map(u => Date.parse(u.row.timestamp));
      const lo = new Date(Math.min(...stamps)).toISOString(); const hi = new Date(Math.max(...stamps)).toISOString();
      const existing = await selectAll(table, 'timestamp,user_email,action,entity,details', q => q.gte('timestamp', lo).lte('timestamp', hi), ['timestamp', 'id']);
      const seen = new Set(existing.map(r => logSig(iso(r.timestamp), r.user_email === null ? '' : r.user_email, r.action, r.entity, r.details)));
      const already = list.filter(u => seen.has(u.hash)); already.forEach(ack);
      const toSend = list.filter(u => !seen.has(u.hash));
      for (const part of chunkBy(toSend, u => approxSize(u.row))) {
        const result = await insertRows(table, part.map(u => u.row));
        const bad = new Map(result.rejected.map(r => [r.index, r.message]));
        part.forEach((u, i) => { if (bad.has(i)) reject(u, bad.get(i)); else ack(u); });
      }
    } catch (e) { if (e.kind === 'notable') { markDegraded(table, e.message); return; } throw e; }
  }

  // ---------------------------------------------------------------- guardas contra escritor DESATUALIZADO
  // Dois servidores (o PC e a nuvem) gravam nas mesmas linhas do Supabase e o último a gravar ganha. O ack só diz "o envio foi aceito",
  // não que ninguém trocou a linha depois. Antes de enviar, estas guardas olham o que já está lá e não deixam uma versão ANTIGA
  // apagar uma MAIS NOVA: a senha mais nova (relógio password_changed_at) e o contador de protocolo (sempre o maior).
  const maskEmail = (e) => { const s = String(e || ''); const i = s.indexOf('@'); return i > 1 ? s.slice(0, 2) + '***' + s.slice(i) : '***'; };
  const isScrypt = (p) => typeof p === 'string' && p.startsWith('scrypt:');

  async function guardCredentials(todo, json) {
    const units = todo.filter(u => u.table === 'usuarios' || u.table === 'dados_financeiros');
    if (!units.length) return;
    const emails = Array.from(new Set(units.map(u => String(u.key))));
    const remote = new Map();
    for (const part of chunkArr(emails, 50)) {
      const res = await call(() => sb.from('dados_financeiros').select('email,dados').in('email', part));
      if (res.error) {
        const kind = classify(res.error);
        if (kind === 'transient' || kind === 'auth') throw toError(kind, res.error, 'dados_financeiros');   // sem conexão: tenta de novo depois (nada se perde)
        return;                                                                                                 // sem como ler (esquema diferente): segue como antes
      }
      for (const r of (res.data || [])) remote.set(lc(r.email), r.dados);
    }
    const local = new Map((Array.isArray(json) ? json : []).filter(x => x && lc(x.email)).map(x => [lc(x.email), x]));
    for (const email of emails) {
      const r = remote.get(email); const mine = local.get(email);
      if (!r || typeof r !== 'object' || !mine) continue;
      const rClock = Date.parse(r.password_changed_at);
      if (!Number.isFinite(rClock)) continue;                                  // o Supabase não tem relógio da senha: nada a preservar
      const lClock = Date.parse(mine.password_changed_at);
      if (Number.isFinite(lClock) && lClock >= rClock) continue;               // a versão local é igual ou mais nova: vale a local
      if (!isScrypt(r.password) || r.password === mine.password) continue;    // só adota hash válido e diferente
      for (const u of units.filter(x => String(x.key) === email)) {
        if (u.table === 'dados_financeiros') u.row = Object.assign({}, u.row, { dados: Object.assign({}, u.row.dados, { password: r.password, password_changed_at: r.password_changed_at, must_change_password: Boolean(r.must_change_password) }) });
        else u.row = Object.assign({}, u.row, { password: r.password, must_change_password: Boolean(r.must_change_password) });
      }
      credentialGuards++;
      say('warn', 'credguard:' + sha(email), 'O Supabase já tinha uma senha MAIS NOVA para ' + maskEmail(email) + ' do que a deste servidor: a mais nova foi preservada (a versão antiga não a sobrescreveu).');
    }
  }

  async function guardSequence(todo) {
    const u = todo.find(x => x.table === 'nexus_dados_financeiros' && x.key === docKey('os_seq', '_'));
    if (!u) return;
    const res = await call(() => sb.from('nexus_dados_financeiros').select('email,dados').eq('email', u.key));
    if (res.error) {
      const kind = classify(res.error);
      if (kind === 'transient' || kind === 'auth') throw toError(kind, res.error, 'nexus_dados_financeiros');
      return;
    }
    const remote = ((res.data || [])[0] || {}).dados;
    const rUlt = Number(remote && remote.ultimo); const mine = Number(u.row.dados && u.row.dados.ultimo);
    if (Number.isFinite(rUlt) && rUlt > (Number.isFinite(mine) ? mine : 0)) {
      u.row = Object.assign({}, u.row, { dados: Object.assign({}, u.row.dados, { ultimo: rUlt, atualizado_em: remote.atualizado_em || u.row.dados.atualizado_em }) });
      sequenceGuards++;
      say('warn', 'seqguard', 'O contador de protocolo do Supabase (' + rUlt + ') é maior que o deste servidor (' + (Number.isFinite(mine) ? mine : '?') + '): o maior foi mantido.');
    }
  }
  // Retrato financeiro ZERADO neste servidor (disco novo, restore vazio, arquivo zerado por uma sincronização antiga) nunca substitui um que já
  // tem conteúdo no destino: sem esta guarda o destino (Supabase ou, no PC, o banco interno) recebia o zero em ~1,5 s depois da subida e a
  // única cópia boa era arquivada em __sis__/_substituidos, de onde ninguém a puxava de volta. A linha e as tabelas relacionais da conta
  // (transacoes, contas_bancarias, categorias — o "replace" apagaria as linhas antigas) ficam de fora desta rodada.
  const FIN_LISTS = ['transactions', 'accounts', 'budgets', 'goals', 'recurringList', 'alerts', 'attachments', 'notifications'];
  const isBlankFin = (d) => !d || typeof d !== 'object' || Array.isArray(d) || FIN_LISTS.every(k => !Array.isArray(d[k]) || d[k].length === 0);
  async function guardBlankFinancial(todo) {
    const blanks = todo.filter(u => u.table === 'nexus_dados_financeiros' && u.kind === 'upsert' && !String(u.key).startsWith(DOC_PREFIX) && isBlankFin(u.row && u.row.dados));
    if (!blanks.length) return;
    const remote = new Map();
    for (const part of chunkArr(Array.from(new Set(blanks.map(u => String(u.key)))), 50)) {
      const res = await call(() => sb.from('nexus_dados_financeiros').select('email,dados').in('email', part));
      if (res.error) {
        const kind = classify(res.error);
        if (kind === 'transient' || kind === 'auth') throw toError(kind, res.error, 'nexus_dados_financeiros');
        return;                                                      // sem como ler (esquema diferente): segue como antes
      }
      for (const r of (res.data || [])) remote.set(lc(r.email), r.dados);
    }
    for (const u of blanks) {
      let r = remote.get(lc(u.key));
      if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
      if (!r || isBlankFin(r)) continue;                             // o destino também está vazio (conta nova): pode enviar
      for (let i = todo.length - 1; i >= 0; i--) {
        const x = todo[i];
        if (String(x.key) === String(u.key) && (x === u || x.table === 'transacoes' || x.table === 'contas_bancarias' || x.table === 'categorias')) { state.acked[x.id] = x.hash; todo.splice(i, 1); }
      }
      blankGuards++;
      say('warn', 'blankguard:' + sha(u.key), 'Os dados financeiros de ' + maskEmail(u.key) + ' estão ZERADOS neste servidor, mas o destino tem conteúdo: o zerado NÃO foi enviado e o conteúdo do destino foi preservado.');
    }
  }
  const GUARDS = { 'local_users.json': guardCredentials, 'local_os_sequencia.json': guardSequence, 'local_database_data.json': guardBlankFinancial };

  // Cura do ponto cego do ack ("enviei" ≠ "está lá"): se outro servidor gravou depois uma versão MAIS ANTIGA, reenvia a nossa. Só nos dois
  // casos em que qual é a mais nova é inequívoco (relógio da senha e contador de protocolo); o resto não é "curado" para os dois
  // servidores não ficarem trocando a mesma linha de lugar. O reenvio passa pelas guardas acima.
  async function healStale() {
    let healed = 0;
    const users = readSource('local_users.json').json;
    if (Array.isArray(users) && users.length) {
      const emails = users.map(u => lc(u && u.email)).filter(Boolean);
      const remote = new Map();
      for (const part of chunkArr(emails, 50)) {
        const res = await call(() => sb.from('dados_financeiros').select('email,dados').in('email', part));
        if (res.error) return healed;
        for (const r of (res.data || [])) remote.set(lc(r.email), r.dados);
      }
      let users_n = 0;
      for (const u of users) {
        const email = lc(u && u.email); const r = remote.get(email);
        if (!email || !r || typeof r !== 'object' || !isScrypt(u.password)) continue;
        const lClock = Date.parse(u.password_changed_at);
        if (!Number.isFinite(lClock)) continue;                                     // sem relógio local não há como saber qual é a mais nova
        const rClock = Date.parse(r.password_changed_at);
        if (r.password !== u.password && (!Number.isFinite(rClock) || rClock < lClock)) {
          for (const t of ['usuarios', 'dados_financeiros']) delete state.acked['local_users.json|' + t + '|' + email];
          users_n++;
        }
      }
      if (users_n) { healed += users_n; markDirty('local_users.json', 0); }
    }
    const seq = readSource('local_os_sequencia.json').json;
    const mine = Number(seq && seq.ultimo);
    if (Number.isFinite(mine) && mine > 0) {
      const res = await call(() => sb.from('nexus_dados_financeiros').select('email,dados').eq('email', docKey('os_seq', '_')));
      if (!res.error) {
        const rUlt = Number(((res.data || [])[0] || {}).dados && ((res.data || [])[0]).dados.ultimo);
        if (!(rUlt >= mine)) { delete state.acked['local_os_sequencia.json|nexus_dados_financeiros|' + docKey('os_seq', '_')]; markDirty('local_os_sequencia.json', 0); healed++; }
      }
    }
    if (healed) { staleHealed += healed; say('warn', 'healstale', healed + ' registro(s) estavam MAIS ANTIGOS no Supabase do que neste servidor (outro servidor gravou depois): reenviados.'); }
    return healed;
  }

  // 4. Exclusões: nunca em massa
  async function applyRemovals(file, removed, totalBefore) {
    if (!removed.length) { heldByFile.set(file, 0); return; }
    const real = removed.filter(id => TABLES[splitId(id).table].kind !== 'append');
    removed.filter(id => TABLES[splitId(id).table].kind === 'append').forEach(id => { delete state.acked[id]; delete state.rejected[id]; });
    if (!real.length) { heldByFile.set(file, 0); return; }
    const tomb = deletedEmails();
    const legit = real.every(id => tomb.has(splitId(id).key));
    // conta registros lógicos (um e-mail = um registro, mesmo que apareça em várias tabelas)
    const logical = new Set(real.map(id => splitId(id).key)).size;
    if (!(logical <= 1 || logical <= Math.ceil(totalBefore * 0.25) || legit)) {
      heldByFile.set(file, logical);
      say('warn', 'held:' + file, logical + ' exclusão(ões) em ' + file + ' foram RETIDAS (apagariam mais de 25% dos registros do Supabase de uma vez). Nada foi apagado remotamente.');
      return;
    }
    heldByFile.set(file, 0);
    const groups = new Map();
    for (const id of real) { const { table, key } = splitId(id); if (!groups.has(table)) groups.set(table, []); groups.get(table).push({ id, key }); }
    for (const [table, items] of groups) {
      if (degradedActive(table)) continue;
      const meta = TABLES[table];
      try {
        if (meta.kind === 'upsert') {
          for (const part of chunkArr(items, 50)) {
            const r = await call(() => sb.from(table).delete().in(meta.keyCol, part.map(x => x.key)));
            if (r.error) throw toError(classify(r.error), r.error, table);
            part.forEach(x => { delete state.acked[x.id]; delete state.rejected[x.id]; });
          }
        } else {
          for (const x of items) {
            const r = await call(() => sb.from(table).delete().eq(meta.ownerCol, x.key));
            if (r.error) throw toError(classify(r.error), r.error, table);
            delete state.acked[x.id]; delete state.rejected[x.id];
          }
        }
      } catch (e) { if (e.kind === 'notable') { markDegraded(table, e.message); continue; } throw e; }
    }
  }

  // ---------------------------------------------------------------- um arquivo
  async function syncFile(file) {
    const src = SOURCES[file];
    const read = readSource(file);
    if (read.json === undefined) return;                 // ausente, vazio ou ilegível agora: não decide nada com base nisso
    let units = src.plan(read.json);
    if (!units) return;
    const prefix = file + '|';
    const byId = new Map();
    for (const u of units) { u.id = prefix + u.table + '|' + u.key; byId.set(u.id, u); }  // chave repetida: vale a última
    units = Array.from(byId.values());

    const now = Date.now();
    const todo = [];
    for (const u of units) {
      if (state.acked[u.id] === u.hash) continue;
      if (u.kind === 'replace' && u.rows.length === 0 && state.acked[u.id] === undefined) { state.acked[u.id] = u.hash; continue; } // nada a apagar que nós tenhamos enviado
      const rej = state.rejected[u.id];
      if (rej && rej.hash === u.hash && now - rej.at < REJECT_RETRY_MS) continue;
      todo.push(u);
    }
    const ackedHere = Object.keys(state.acked).filter(id => id.startsWith(prefix));
    const removed = ackedHere.filter(id => !byId.has(id));
    const logicalTotal = new Set(ackedHere.filter(id => TABLES[splitId(id).table].kind !== 'append').map(id => splitId(id).key)).size;

    try {
      if (GUARDS[file] && todo.length) await GUARDS[file](todo, read.json);
      const by = (kind) => { const m = new Map(); for (const u of todo) if (TABLES[u.table].kind === kind) { if (!m.has(u.table)) m.set(u.table, []); m.get(u.table).push(u); } return m; };
      for (const [table, list] of by('upsert')) await pushUpserts(table, list);
      for (const [, list] of by('replace')) for (const u of list) await pushReplace(u);
      for (const [table, list] of by('append')) await pushAppend(table, list);
      await applyRemovals(file, removed, logicalTotal);
    } finally {
      saveState();
      pendingByFile.set(file, units.filter(u => state.acked[u.id] !== u.hash).length);
    }
  }

  // ---------------------------------------------------------------- ciclo de envio
  const backoff = (n) => Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.min(n, 7)));

  async function cycle(force) {
    if (running) { await running; if (!force) return; }
    running = (async () => {
      const now = Date.now();
      const files = Array.from(dirty.keys()).filter(f => force || dirty.get(f) <= now);
      files.forEach(f => { dirty.delete(f); firstDirty.delete(f); });
      let blocked = null;
      for (const file of files) {
        if (blocked) { dirty.set(file, now); continue; }
        try { await syncFile(file); }
        catch (e) {
          if (e && (e.kind === 'transient' || e.kind === 'auth')) { blocked = e; dirty.set(file, now); }
          else { dirty.set(file, now + 60000); say('error', 'int:' + file, 'Erro ao sincronizar ' + file + ': ' + ((e && e.message) || e)); }
        }
      }
      if (blocked) {
        failures++;
        lastError = { message: blocked.message, kind: blocked.kind, at: new Date().toISOString() };
        retryAt = Date.now() + (blocked.kind === 'auth' ? AUTH_BACKOFF_MS : backoff(failures));
        say('warn', 'net:' + blocked.kind, (blocked.kind === 'auth' ? 'Chave recusada pelo Supabase' : 'Sem conexão com o Supabase') + ' (' + blocked.message + '). Os dados ficam guardados e serão reenviados automaticamente (falhas seguidas: ' + failures + ').');
      } else if (files.length) {
        if (failures > 0) log.log('[SUPABASE] Conexão restabelecida: pendências reenviadas.');
        failures = 0; retryAt = 0; lastSuccessAt = new Date().toISOString();
      }
    })();
    try { await running; } finally { running = null; }
  }

  function arm() {
    if (!timersOn || stopped) return;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty.size) return;
    const next = Math.max(Math.min(...dirty.values()), retryAt);
    timer = setTimeout(() => { timer = null; cycle(false).catch(() => {}).finally(arm); }, Math.max(0, next - Date.now()));
    if (timer.unref) timer.unref();
  }

  function markDirty(file, delay) {
    if (!enabled || stopped || !SOURCES[file]) return;
    const now = Date.now();
    if (!firstDirty.has(file)) firstDirty.set(file, now);
    const wait = delay === undefined ? SOURCES[file].debounce : delay;
    dirty.set(file, Math.min(now + wait, firstDirty.get(file) + MAX_WAIT_MS));
    arm();
  }
  function markAllDirty(delay) { Object.keys(SOURCES).forEach(f => markDirty(f, delay)); lastFullPass = Date.now(); }

  // ---------------------------------------------------------------- vigia (pega gravações que não passaram por writeJsonFile)
  function sigOf(file) { try { const s = fs.statSync(path.join(dataDir, file)); return s.mtimeMs + ':' + s.size; } catch (e) { return 'x'; } }
  function pollTick() {
    if (!enabled || stopped) return;
    for (const file of Object.keys(SOURCES)) {
      const sig = sigOf(file);
      if (lastSig.get(file) !== sig) { lastSig.set(file, sig); if (sig !== 'x') markDirty(file); }
    }
    const now = Date.now();
    if (now - lastFullPass >= RECHECK_MS && (pendingTotal() > 0 || failures > 0)) markAllDirty();
    if (now - lastVerify >= VERIFY_MS) verifyRemote().catch(() => {});
    if (now - lastAuditAt >= AUDIT_MS && !running && !verifying) {          // conferência de conteúdo a cada 6 h (a 1ª, ~2 min após o início)
      lastAuditAt = now;
      audit().then(a => {
        if (!a || !a.enabled) return;
        const msg = 'Conferência de conteúdo: ' + a.planned + ' registro(s) planejados, ' + a.ok + ' idênticos, ' + a.missing + ' ausentes, ' + a.different + ' diferentes' + (a.moving ? ' (' + a.moving + ' em movimento)' : '') + '.';
        if (a.consistent) log.log('[SUPABASE] ' + msg); else { log.warn('[SUPABASE] ' + msg + ' Detalhes: GET /api/admin/supabase-status?audit=1'); if (a.missing) markAllDirty(0); }
      }).catch(() => {});
    }
    if (now - lastHeartbeat >= 300000) {
      lastHeartbeat = now;
      const st = status();
      if (st.pending > 0 || st.consecutiveFailures > 0) log.log('[SUPABASE] Pendente de confirmação: ' + st.pending + ' registro(s)' + (st.lastError ? ' — último erro: ' + st.lastError.message : '') + '.');
    }
  }

  // Autocura: se alguém apagar linhas no painel do Supabase, o que já foi confirmado é reenviado
  async function verifyRemote() {
    if (verifying || !enabled || running) return;
    verifying = true; lastVerify = Date.now();
    try {
      for (const [table, meta] of Object.entries(TABLES)) {
        if (meta.kind !== 'upsert' || degradedActive(table)) continue;
        const ids = Object.keys(state.acked).filter(id => splitId(id).table === table);
        if (!ids.length) continue;
        const have = new Set((await selectAll(table, meta.keyCol, null, meta.keyCol)).map(r => String(r[meta.keyCol])));
        for (const id of ids) {
          const { file, key } = splitId(id);
          if (!have.has(String(key))) { delete state.acked[id]; markDirty(file, 0); }
        }
      }
      try { await healStale(); } catch (e) { /* sem como ler agora: fica para o próximo conferimento */ }
      saveState();
    } catch (e) { /* sem conexão: o ciclo normal cuida disso */ }
    finally { verifying = false; }
  }

  // ---------------------------------------------------------------- restauração em disco novo
  function isLocalEmpty(file) {
    const r = readSource(file);
    if (r.corrupt) return false;
    if (r.json === undefined) return !fs.existsSync(path.join(dataDir, file)) || (fs.statSync(path.join(dataDir, file)).size === 0);
    if (Array.isArray(r.json)) return r.json.length === 0;
    return r.json !== null && typeof r.json === 'object' && Object.keys(r.json).length === 0;
  }
  function atomicWrite(file, content) {
    const full = path.join(dataDir, file);
    const tmp = full + '.tmp';
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, full);
  }
  async function fetchRestore(spec) {
    const orphans = async (file) => {
      const prefix = DOC_PREFIX + ORPHAN + file + '/';
      return (await selectAll('nexus_dados_financeiros', 'email,dados', q => q.like('email', prefix + '%'), 'email'))
        .map(r => ({ key: (() => { const k = String(r.email).slice(prefix.length); try { return k === '(vazio)' ? '' : decodeURIComponent(k); } catch (e) { return k; } })(), dados: r.dados }))
        .map(o => ({ key: o.key, dados: (o.dados && typeof o.dados === 'object' && !Array.isArray(o.dados) && Object.keys(o.dados).length === 1 && '__valor' in o.dados) ? o.dados.__valor : o.dados }));
    };
    if (spec.kind === 'users') {
      const rows = await selectAll('dados_financeiros', 'email,dados', null, 'email');
      const users = rows.filter(r => !String(r.email).startsWith('__') && r.dados && typeof r.dados === 'object').map(r => r.dados);
      users.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));
      const gone = deletedEmails();
      const list = users.filter(u => !gone.has(lc(u.email)));
      (await orphans('local_users.json')).forEach(o => { if (o.dados && typeof o.dados === 'object') list.push(o.dados); });
      return list;
    }
    if (spec.kind === 'financeiro') {
      const rows = await selectAll('nexus_dados_financeiros', 'email,dados', q => q.not('email', 'like', DOC_PREFIX + '%'), 'email');
      const out = {};
      rows.forEach(r => { if (r.dados && typeof r.dados === 'object') out[r.email] = r.dados; });
      (await orphans('local_database_data.json')).forEach(o => { out[o.key] = o.dados; });
      return out;
    }
    const prefix = docKey(spec.short, '');
    const rows = await selectAll('nexus_dados_financeiros', 'email,dados', q => q.like('email', prefix + '%'), 'email');
    const unwrap = (d) => (d && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length === 1 && '__valor' in d) ? d.__valor : d;
    const when = (d) => String((d && (d.created_at || d.criada_em || d.timestamp || d.deleted_at)) || '');
    const mode = spec.mode;
    if (!rows.length) return null;
    if (mode === 'single') return unwrap(rows[0].dados);
    if (mode === 'map') { const o = {}; rows.forEach(r => { o[String(r.email).slice(prefix.length)] = unwrap(r.dados); }); return o; }
    const list = rows.map(r => unwrap(r.dados));
    list.sort((a, b) => when(b).localeCompare(when(a)));
    return list;
  }
  async function restoreMissingFiles(opts) {
    if (!enabled || !state || !state.fresh) return { restored: [] };
    const files = Object.keys(SOURCES).filter(f => SOURCES[f].restore && isLocalEmpty(f));
    if (!files.length) return { restored: [] };
    const deadline = Date.now() + ((opts && opts.timeoutMs) || 8000);
    const restored = [];
    for (const file of files) {                          // 'deleted_accounts.json' vem primeiro (ordem de SOURCES)
      if (Date.now() > deadline) { say('warn', 'restore-timeout', 'Restauração a partir do Supabase interrompida por tempo; segue o que já foi restaurado.'); break; }
      try {
        const content = await fetchRestore(SOURCES[file].restore);
        const empty = content === null || (Array.isArray(content) && !content.length) || (typeof content === 'object' && !Array.isArray(content) && !Object.keys(content).length);
        if (empty) continue;
        atomicWrite(file, JSON.stringify(content, null, 2));
        const units = SOURCES[file].plan(content) || [];
        units.forEach(u => { u.id = file + '|' + u.table + '|' + u.key; ack(u); });
        lastSig.set(file, sigOf(file));
        restored.push(file);
      } catch (e) { say('warn', 'restore:' + file, 'Não foi possível restaurar ' + file + ' do Supabase: ' + e.message); }
    }
    if (restored.length) { state.fresh = false; saveState(); log.log('[SUPABASE] Disco sem dados: restaurado do Supabase → ' + restored.join(', ')); }
    restoredFiles = restored;
    return { restored };
  }

  // ---------------------------------------------------------------- conferência de CONTEÚDO (somente leitura)
  // Compara, linha a linha, o que os arquivos locais dizem que deveria estar no Supabase com o que está lá agora. O ack não prova isso:
  // outro servidor pode ter trocado a linha depois. Só conta como diferença o que ficou igual durante a conferência (arquivos que mudam o
  // tempo todo, como a fila de logins, não geram falso alarme). Nunca devolve e-mail, CPF nem senha: só contagens e nomes de campo.
  const canon = (v) => Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object') ? Object.fromEntries(Object.keys(v).filter(k => v[k] !== null && v[k] !== undefined).map(k => [k, canon(v[k])])) : v;
  function sameValue(a, b) {
    const nul = (x) => x === undefined || x === null || x === '';
    if (nul(a) && nul(b)) return true;
    if (nul(a) || nul(b)) return false;
    if (typeof a === 'object' || typeof b === 'object') return stable(canon(a)) === stable(canon(b));
    if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d\d-\d\d[T ]/.test(a) && /^\d{4}-\d\d-\d\d[T ]/.test(b)) return Date.parse(a) === Date.parse(b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
    const na = Number(a); const nb = Number(b);
    if (String(a).trim() !== '' && String(b).trim() !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    return String(a) === String(b);
  }
  function planEverything() {
    const out = new Map();
    for (const [file, src] of Object.entries(SOURCES)) {
      const read = readSource(file);
      if (read.json === undefined) continue;
      const units = src.plan(read.json) || [];
      for (const u of units) { u.id = file + '|' + u.table + '|' + u.key; out.set(u.id, Object.assign(u, { file })); }
    }
    return out;
  }
  async function audit(opts) {                       // audit({ flush: false }) = zero escrita (só lê)
    if (!enabled || !sb) return { enabled: false, reason: disabledReason };
    if (!opts || opts.flush !== false) { try { await flushNow(); } catch (e) { /* conferir mesmo assim */ } }
    const first = planEverything();
    const tables = new Set(); for (const u of first.values()) if (TABLES[u.table].kind !== 'append') tables.add(u.table);
    const remoteRows = {}; const replaceCount = {};
    for (const t of tables) {
      const meta = TABLES[t];
      if (meta.kind === 'upsert') remoteRows[t] = new Map((await selectAll(t, '*', null, meta.keyCol)).map(r => [String(r[meta.keyCol]), r]));
      else { const m = new Map(); (await selectAll(t, meta.ownerCol, null, [meta.ownerCol, 'id'])).forEach(r => { const k = lc(r[meta.ownerCol]); m.set(k, (m.get(k) || 0) + 1); }); replaceCount[t] = m; }
    }
    const second = planEverything();
    const byTable = {}; const samples = []; let transient = 0;
    const bump = (t, k) => { (byTable[t] = byTable[t] || { planned: 0, ok: 0, missing: 0, different: 0, moving: 0 })[k]++; };
    const label = (u) => String(u.key).replace(/[^\x20-\x7e]/g, '?').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, maskEmail).slice(0, 60);   // e-mail nunca sai em claro
    for (const u of first.values()) {
      if (TABLES[u.table].kind === 'append') continue;
      if (SOURCES[u.file] && SOURCES[u.file].volatile) { transient++; continue; }          // fila transitória: fora da consistência
      bump(u.table, 'planned');
      const again = second.get(u.id);
      if (!again || again.hash !== u.hash) { bump(u.table, 'moving'); continue; }
      if (TABLES[u.table].kind === 'upsert') {
        const r = remoteRows[u.table].get(String(u.key));
        if (!r) { bump(u.table, 'missing'); if (samples.length < 20) samples.push({ table: u.table, file: u.file, key: label(u), problem: 'ausente no Supabase' }); continue; }
        const fields = Object.keys(u.row).filter(c => !sameValue(u.row[c], r[c]));
        if (fields.length) { bump(u.table, 'different'); if (samples.length < 20) samples.push({ table: u.table, file: u.file, key: label(u), problem: 'conteúdo diferente', fields }); }
        else bump(u.table, 'ok');
      } else {
        const have = replaceCount[u.table].get(lc(u.key)) || 0;
        if (have === u.rows.length) bump(u.table, 'ok');
        else { bump(u.table, have === 0 ? 'missing' : 'different'); if (samples.length < 20) samples.push({ table: u.table, file: u.file, key: label(u), problem: 'linhas: local ' + u.rows.length + ' × Supabase ' + have }); }
      }
    }
    const sum = (k) => Object.values(byTable).reduce((s, v) => s + v[k], 0);
    lastAuditAt = Date.now();
    lastAudit = { enabled: true, checkedAt: new Date().toISOString(), project: projectRef, files: new Set(Array.from(first.values()).map(u => u.file)).size,
      planned: sum('planned'), ok: sum('ok'), missing: sum('missing'), different: sum('different'), moving: sum('moving'), transient,
      consistent: sum('missing') === 0 && sum('different') === 0, byTable, samples };
    return lastAudit;
  }

  // ---------------------------------------------------------------- API pública
  function pendingTotal() { let n = 0; for (const v of pendingByFile.values()) n += v; return n; }

  function status() {
    const rejected = Object.values(state ? state.rejected : {}).slice(0, 20).map(r => ({ table: r.table, key: r.key, message: r.message }));
    let held = 0; for (const v of heldByFile.values()) held += v;
    const pending = pendingTotal();
    return {
      enabled, disabledReason: enabled ? null : disabledReason, project: projectRef || null, keyRole: role || null,
      inSync: enabled && !running && dirty.size === 0 && pending === 0 && failures === 0,
      pending, waitingFiles: Array.from(dirty.keys()), consecutiveFailures: failures,
      lastSuccessAt, lastError, rejected, heldDeletes: held,
      degradedTables: Object.fromEntries(Object.entries(degraded).filter(([, d]) => d.until > Date.now()).map(([t, d]) => [t, d.message])),
      omittedColumns: Object.fromEntries(Object.entries(skipCols).map(([t, s]) => [t, Array.from(s)])),
      confirmedRecords: state ? Object.keys(state.acked).length : 0, restoredFiles,
      guards: { credentials: credentialGuards, sequence: sequenceGuards, blankFinancial: blankGuards, staleHealed },
      lastAudit: lastAudit ? { checkedAt: lastAudit.checkedAt, planned: lastAudit.planned, ok: lastAudit.ok, missing: lastAudit.missing, different: lastAudit.different, moving: lastAudit.moving, consistent: lastAudit.consistent } : null
    };
  }

  function init(opts) {
    opts = opts || {};
    if (started) {
      // Já existe um espelho ativo, mas chegou um cliente novo (ex.: o SQL Server interno substituindo o Supabase):
      // troca o destino. O projeto mudou, então loadState() zera o ack e TUDO é reenviado ao novo backend (nada fica para trás).
      if (opts.client && opts.client !== sb) {
        sb = opts.client;
        if (opts.projectRef) projectRef = opts.projectRef;
        if (opts.role) role = opts.role;
        loadState();
        markAllDirty(0);
        log.log('[SUPABASE] Espelho redirecionado para "' + projectRef + '" (' + role + '): todo o conteúdo confirmado será reenviado ao novo destino.');
      }
      return api;
    }
    dataDir = opts.dataDir || __dirname;
    log = opts.log || console;
    timersOn = opts.timers !== false;
    if (opts.disabled || process.env.NEXUS_DISABLE_DB === '1' || process.env.NEXUS_DISABLE_SUPABASE === '1') { disabledReason = 'desligado por variável de ambiente'; return api; }
    let url = ''; let key = '';
    if (opts.client) { sb = opts.client; projectRef = opts.projectRef || 'teste'; role = opts.role || 'service_role'; }
    else {
      const committed = loadCommittedCredentials(__dirname);
      url = String(process.env.SUPABASE_URL || committed.SUPABASE_URL || '').trim();
      key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || committed.SUPABASE_SERVICE_ROLE_KEY || committed.SUPABASE_ANON_KEY || '').trim();
      if (!url || !key) { disabledReason = 'SUPABASE_URL/chave não configurados'; log.warn('[SUPABASE] ' + disabledReason + ' — gravação no Supabase desativada.'); return api; }
      try {
        const { createClient } = require('@supabase/supabase-js');
        sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchWithTimeout } });
      } catch (e) { disabledReason = 'pacote @supabase/supabase-js indisponível'; log.warn('[SUPABASE] ' + disabledReason + ': ' + e.message); return api; }
      projectRef = projectRefOf(url); role = keyRole(key);
    }
    enabled = true; started = true; disabledReason = null;
    loadState();
    if (role !== 'service_role' && role !== 'mssql') log.warn('[SUPABASE] A chave configurada é "' + role + '", não "service_role": com RLS ligado o Supabase vai recusar as gravações. Use SUPABASE_SERVICE_ROLE_KEY.');
    log.log('[SUPABASE] Gravação direta ativa → projeto ' + projectRef + ' (chave ' + role + '). Confirmados: ' + Object.keys(state.acked).length + ' registro(s).');
    markAllDirty(opts.firstSyncDelayMs === undefined ? 1500 : opts.firstSyncDelayMs);   // reconciliação inicial: o que não está confirmado é enviado
    lastHeartbeat = Date.now();   // (lastVerify fica em 0: o 1º conferimento do que o Supabase ainda tem roda logo após o primeiro envio)
    lastAuditAt = Date.now() - AUDIT_MS + 120000;   // 1ª conferência de conteúdo ~2 min depois do início
    if (timersOn) { poller = setInterval(pollTick, POLL_MS); if (poller.unref) poller.unref(); }
    return api;
  }

  function noteWrite(file) {
    if (!enabled) return;
    const name = path.basename(String(file || ''));
    if (!SOURCES[name]) return;
    lastSig.set(name, sigOf(name));
    markDirty(name);
  }

  async function flushNow() {
    if (!enabled) return status();
    for (let i = 0; i < 3 && dirty.size; i++) {                     // processa o que está sujo (inclusive o que falhou antes)
      const before = failures;
      await cycle(true);
      if (failures > before) break;                                   // sem conexão: não insiste; o backoff cuida do reenvio
    }
    return status();
  }
  // markAllDirty + flush, para testes e para o desligamento
  async function syncEverythingNow() { markAllDirty(0); return flushNow(); }

  // Cadastro de UMA conta como o Supabase guarda (senha em hash, relógio da troca de senha, perfil), lido na hora, para o login
  // "puxar do banco" quando o servidor local não tem a conta ou tem uma senha mais antiga. Nunca lança: sem Supabase, sem rede ou
  // acima do tempo devolve null e o login segue só com o que o servidor tem.
  async function fetchUserRecord(email, opts) {
    const key = lc(email);
    if (!enabled || !sb || !key) return null;
    const maxMs = Math.max(500, (opts && opts.timeoutMs) || 3000);
    let timer;
    const limit = new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), maxMs); if (timer.unref) timer.unref(); });
    // Login não espera repetições: o postgrest-js tenta de novo (1 s, 2 s, 4 s) em 503/520 e erro de rede, e a pessoa ficaria olhando a tela
    const noRetry = (q) => (q && typeof q.retry === 'function') ? q.retry(false) : q;
    const work = (async () => {
      const full = await call(() => noRetry(sb.from('dados_financeiros').select('email,dados').eq('email', key).range(0, 0)));
      if (!full.error) {
        const row = (full.data || [])[0];
        if (row && row.dados && typeof row.dados === 'object' && !Array.isArray(row.dados) && lc(row.dados.email || key) === key) return { record: Object.assign({}, row.dados, { email: key }) };
      } else { return { error: full.error }; }
      // Sem a cópia fiel (ex.: conta só na visão relacional): usa a linha de "usuarios" (tem a senha, não tem o relógio da troca)
      const rel = await call(() => noRetry(sb.from('usuarios').select('name,email,password,role,active,must_change_password,cpf,phone,birth_date').eq('email', key).range(0, 0)));
      if (rel.error) return { error: rel.error };
      const r = (rel.data || [])[0];
      return r ? { record: Object.assign({}, r, { email: key }) } : { record: null };
    })();
    try {
      const out = await Promise.race([work, limit]);
      if (!out || out.timeout) { say('warn', 'cred-timeout', 'Supabase demorou mais de ' + maxMs + ' ms para devolver o cadastro de uma conta; o login seguiu só com os dados do servidor.'); return null; }
      if (out.error) { say('warn', 'cred-read', 'Não foi possível ler o cadastro da conta no Supabase: ' + (out.error.message || out.error)); return null; }
      return out.record || null;
    } catch (e) { return null; }
    finally { clearTimeout(timer); }
  }

  // Dados financeiros de UMA conta como o espelho durável (Supabase ou, no PC, o SQL Server interno) os guarda, lidos na hora. É a fonte de
  // "puxar de volta" quando o arquivo local e o SQL principal vieram zerados. Nunca lança: sem espelho, sem rede ou acima do tempo devolve null.
  async function fetchFinancialRecord(email, opts) {
    const key = lc(email);
    if (!enabled || !sb || !key) return null;
    const maxMs = Math.max(500, (opts && opts.timeoutMs) || 3000);
    let timer;
    const limit = new Promise(resolve => { timer = setTimeout(() => resolve({ timeout: true }), maxMs); if (timer.unref) timer.unref(); });
    const noRetry = (q) => (q && typeof q.retry === 'function') ? q.retry(false) : q;
    try {
      const out = await Promise.race([
        call(() => noRetry(sb.from('nexus_dados_financeiros').select('email,dados,updated_at').eq('email', key).range(0, 0))),
        limit
      ]);
      if (!out || out.timeout) { say('warn', 'fin-timeout', 'O espelho demorou mais de ' + maxMs + ' ms para devolver os dados financeiros de uma conta.'); return null; }
      if (out.error) { say('warn', 'fin-read', 'Não foi possível ler os dados financeiros da conta no espelho: ' + (out.error.message || out.error)); return null; }
      const row = (out.data || [])[0];
      let dados = row && row.dados;
      if (typeof dados === 'string') { try { dados = JSON.parse(dados); } catch (e) { dados = null; } }
      return dados && typeof dados === 'object' && !Array.isArray(dados) ? dados : null;
    } catch (e) { return null; }
    finally { clearTimeout(timer); }
  }

  async function flushAndStop(maxMs) {
    if (!enabled || stopped) return status();
    const limit = new Promise(resolve => { const t = setTimeout(resolve, maxMs || 4000); if (t.unref) t.unref(); });
    try { await Promise.race([syncEverythingNow(), limit]); } catch (e) {}
    stopped = true;
    if (timer) clearTimeout(timer);
    if (poller) clearInterval(poller);
    return status();
  }

  const api = { init, noteWrite, restoreMissingFiles, flushNow, syncEverythingNow, flushAndStop, status, isEnabled: () => enabled, verifyRemote, fetchUserRecord, fetchFinancialRecord, audit, _state: () => state };
  return api;
}

const instance = createSync();
module.exports = instance;
module.exports.createSync = createSync;
module.exports.DOC_PREFIX = DOC_PREFIX;
module.exports.ARCHIVE_PREFIX = ARCHIVE_PREFIX;
module.exports.STATE_FILE = STATE_FILE;
