'use strict';

/**
 * Utilitários puros do backend (server.js). Ficam num arquivo próprio para serem testados (backend-utils.test.js) sem
 * subir o servidor. Nada aqui conhece rotas, banco ou variáveis globais do server.js.
 *
 * Por que cada um existe (todos corrigem falhas reais encontradas na revisão do backend de 08/11/2026):
 *  - decodeBodyChunk: os handlers faziam "body += chunk.toString()"; um caractere acentuado dividido entre dois pedaços do
 *    corpo (pedaços de 16-64 KB) virava "�" e corrompia os dados financeiros salvos em silêncio.
 *  - atomicWriteFileSync: gravar o JSON direto no arquivo deixa o arquivo pela metade se o processo cair no meio.
 *  - createJsonFileCache: cada requisição autenticada relia e reparseava local_users.json inteiro; agora só relê se o arquivo mudou.
 *  - mergeUsersMirror: GET /api/users gravava no espelho local linhas do SQL SEM a coluna password (apagando as senhas do
 *    espelho e a marca de sessões revogadas).
 *  - deriveSyncToken: o token de sincronização era o próprio JWT_SECRET, enviado a cada 10 s para o servidor da nuvem.
 */
const fs = require('fs');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');

// ---------------------------------------------------------------- corpo da requisição
/** Decodifica um pedaço do corpo sem quebrar caracteres UTF-8 multibyte que cruzam a fronteira entre pedaços. */
function decodeBodyChunk(req, chunk) {
  if (typeof chunk === 'string') return chunk;
  if (!req.__nxDecoder) req.__nxDecoder = new StringDecoder('utf8');
  return req.__nxDecoder.write(chunk);
}

// ---------------------------------------------------------------- arquivos
/** Grava em arquivo temporário e troca pelo definitivo (rename é atômico). Se o rename falhar (ex.: antivírus segurando o arquivo), grava direto. */
function atomicWriteFileSync(file, data) {
  const tmp = file + '.' + process.pid + '.' + Date.now().toString(36) + '.tmp';
  try {
    fs.writeFileSync(tmp, data, 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* nada a limpar */ }
    fs.writeFileSync(file, data, 'utf8');
  }
}

/** Cache de arquivos JSON: só relê e reparseia quando mtime ou tamanho mudam. O valor devolvido é COMPARTILHADO: trate como somente leitura. */
function createJsonFileCache() {
  const entries = new Map();
  return {
    /** { exists, value } ; propaga o erro de parse (o chamador decide o fallback) */
    read(file, parse) {
      let st;
      try { st = fs.statSync(file); } catch (e) { entries.delete(file); return { exists: false, value: undefined }; }
      const hit = entries.get(file);
      if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return { exists: true, value: hit.value };
      const value = (parse || JSON.parse)(fs.readFileSync(file, 'utf8'));
      entries.set(file, { mtimeMs: st.mtimeMs, size: st.size, value });
      return { exists: true, value };
    },
    invalidate(file) { entries.delete(file); },
    clear() { entries.clear(); }
  };
}

// ---------------------------------------------------------------- segurança
/** Token de sincronização derivado do segredo: o JWT_SECRET nunca precisa sair deste servidor. */
function deriveSyncToken(secret) {
  return crypto.createHmac('sha256', String(secret || '')).update('nexus-sync-token-v1').digest('hex');
}

// ---------------------------------------------------------------- usuários
const lower = (v) => String(v == null ? '' : v).toLowerCase().trim();
// Campos que só existem no espelho local (não há coluna no SQL Server)
const LOCAL_ONLY_USER_FIELDS = ['password_changed_at'];

/**
 * Mescla linhas vindas do SQL Server no espelho local de usuários sem perder o que só o espelho tem:
 * a senha (quando a consulta não trouxe a coluna) e os campos locais (ex.: password_changed_at, que invalida sessões antigas).
 * Quando o SQL traz o valor, o SQL vence (é a fonte soberana).
 */
function mergeUsersMirror(existing, incoming) {
  const prevByEmail = new Map();
  (Array.isArray(existing) ? existing : []).forEach((u) => { if (u && u.email) prevByEmail.set(lower(u.email), u); });
  return (Array.isArray(incoming) ? incoming : []).map((row) => {
    if (!row || !row.email) return row;
    const prev = prevByEmail.get(lower(row.email));
    if (!prev) return row;
    const merged = { ...row };
    if (!merged.password && prev.password) merged.password = prev.password;
    LOCAL_ONLY_USER_FIELDS.forEach((f) => { if (merged[f] === undefined && prev[f] !== undefined) merged[f] = prev[f]; });
    return merged;
  });
}

// ---------------------------------------------------------------- validação de entrada
/** Tipo de dispositivo: texto curto e comum, senão o padrão (o campo vai para NVARCHAR(50) e para o painel do administrador). */
function sanitizeDeviceType(value, fallback) {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return /^[\p{L}\p{N} ._-]{1,40}$/u.test(s) ? s : fallback;
}

/** Celular brasileiro: vazio => null; 10/11 dígitos (aceita +55) => "(DD) 9XXXX-XXXX"; qualquer outra coisa => inválido. */
function normalizePhoneInput(value) {
  if (value == null || String(value).trim() === '') return { ok: true, value: null };
  let digits = String(value).replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  if (digits.length === 11) return { ok: true, value: '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 7) + '-' + digits.slice(7) };
  if (digits.length === 10) return { ok: true, value: '(' + digits.slice(0, 2) + ') ' + digits.slice(2, 6) + '-' + digits.slice(6) };
  return { ok: false, value: null };
}

/** Nascimento: vazio => null; aceita AAAA-MM-DD e DD/MM/AAAA, confere se a data existe e não é futura; devolve DD/MM/AAAA. */
function normalizeBirthDateInput(value, now) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return { ok: true, value: null };
  let y, m, d;
  let r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw))) { d = +r[1]; m = +r[2]; y = +r[3]; }
  else return { ok: false, value: null };
  const dt = new Date(Date.UTC(y, m - 1, d));
  const valid = dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 1900 && dt.getTime() <= (now || Date.now());
  if (!valid) return { ok: false, value: null };
  return { ok: true, value: String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') + '/' + y };
}

/** Senha: limite de tamanho (o scrypt processa a entrada inteira; um corpo de MBs vira trabalho à toa) */
const PASSWORD_MAX_LENGTH = 128;

/** Violação de chave única/duplicada (SQL Server 2627/2601 ou mensagem equivalente) */
function isUniqueViolation(err) {
  const n = Number(err && (err.number || err.code));
  return n === 2627 || n === 2601 || /violation of (unique|primary) key|cannot insert duplicate key|duplicate key|unique constraint/i.test(String(err && err.message || ''));
}

// ---------------------------------------------------------------- concorrência
/**
 * Executa worker(chave, carga) em série por chave e junta os pedidos que chegam enquanto ele roda: só a ÚLTIMA carga é processada.
 * Usado na gravação relacional do SQL Server: cada salvamento disparava N consultas sequenciais; salvamentos em rajada empilhavam
 * trabalho sem limite. Devolve uma Promise que resolve quando a chave fica ociosa.
 */
function createLatestWinsRunner(worker) {
  const states = new Map();
  return function schedule(key, payload) {
    let st = states.get(key);
    if (!st) { st = { running: false, pending: null, has: false, finished: null }; states.set(key, st); }
    st.pending = payload;
    st.has = true;
    if (st.running) return st.finished;
    st.running = true;
    st.finished = (async () => {
      try {
        while (st.has) {
          const p = st.pending;
          st.pending = null;
          st.has = false;
          try { await worker(key, p); } catch (e) { /* o worker registra os próprios erros */ }
        }
      } finally {
        st.running = false;
        if (!st.has) states.delete(key);
      }
    })();
    return st.finished;
  };
}

module.exports = {
  decodeBodyChunk, atomicWriteFileSync, createJsonFileCache, deriveSyncToken, mergeUsersMirror,
  sanitizeDeviceType, normalizePhoneInput, normalizeBirthDateInput, PASSWORD_MAX_LENGTH,
  isUniqueViolation, createLatestWinsRunner, LOCAL_ONLY_USER_FIELDS
};
