'use strict';

/**
 * Rede de proteção dos dados financeiros (lançamentos, contas/cartões, orçamentos, metas...).
 *
 * Por que existe: o "backup" que o servidor mantinha (local_database_data.backup.json) é um ESPELHO gravado junto com o arquivo principal;
 * quando um retrato zerado chegava (disco novo do Render, restore vazio, cliente antigo), os dois eram zerados no mesmo instante, o SQL Server
 * e o Supabase recebiam o zero em seguida e não sobrava cópia nenhuma. Aqui cada versão COM conteúdo vira uma cópia HISTÓRICA, em pasta própria
 * (backups_financeiros/, fora do Git), que nada sobrescreve: só a poda por idade apaga.
 *
 *  - save(email, dados)            guarda a versão (ignora retrato zerado, ignora conteúdo idêntico ao da última cópia, no máximo 1 por 30 s)
 *  - save(..., { force: true })    ignora o intervalo (usado ANTES de uma gravação que reduz o conteúdo)
 *  - latest(email)                 a cópia mais recente com conteúdo
 *  - pickBest(candidatos)          escolhe de qual fonte restaurar (SQL, Supabase, cópia local): a de conteúdo mais recente
 *
 * Só depende do Node (fs/path/crypto); o server.js injeta a pasta.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LISTAS = ['transactions', 'accounts', 'budgets', 'goals', 'recurringList', 'alerts', 'attachments', 'notifications'];

// Mesma regra do server.js (isBlankFinancialData): "zerado" = nenhuma das listas de conteúdo tem item (só as categorias padrão não contam).
function isBlank(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return true;
  return LISTAS.every(k => !Array.isArray(data[k]) || data[k].length === 0);
}

function contentCount(data) {
  if (!data || typeof data !== 'object') return 0;
  return LISTAS.reduce((n, k) => n + (Array.isArray(data[k]) ? data[k].length : 0), 0);
}

function parse(value) {
  if (typeof value === 'string') { try { return JSON.parse(value); } catch (e) { return null; } }
  return value;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

// Assinatura do CONTEÚDO (carimbos de data não entram: salvar o mesmo conteúdo duas vezes não gera duas cópias)
function signature(data) {
  const base = {};
  LISTAS.forEach(k => { base[k] = Array.isArray(data && data[k]) ? data[k] : []; });
  base.categories = Array.isArray(data && data.categories) ? data.categories : [];
  return crypto.createHash('sha1').update(stableStringify(base)).digest('hex');
}

function timeOf(candidate) {
  const d = candidate && candidate.dados;
  const t = d && d.updated_at ? new Date(d.updated_at).getTime() : NaN;
  if (Number.isFinite(t)) return t;
  return Number.isFinite(candidate && candidate.ts) ? candidate.ts : 0;
}

/**
 * Escolhe a melhor fonte para restaurar. Candidatos: [{ fonte, dados, ts? }]. Zerados e ilegíveis são descartados;
 * entre os que sobram vence o de conteúdo mais recente (updated_at) e, no empate, o que tem mais itens.
 */
function pickBest(candidates) {
  const ok = (candidates || [])
    .map(c => (c ? { ...c, dados: parse(c.dados) } : null))
    .filter(c => c && c.dados && typeof c.dados === 'object' && !Array.isArray(c.dados) && !isBlank(c.dados));
  if (!ok.length) return null;
  ok.sort((a, b) => (timeOf(b) - timeOf(a)) || (contentCount(b.dados) - contentCount(a.dados)));
  return ok[0];
}

function createStore(opts) {
  opts = opts || {};
  const dir = opts.dir;
  const keepRecent = opts.keepRecent || 30;        // as N cópias mais novas ficam todas
  const keepDays = opts.keepDays || 30;            // das mais antigas, 1 por dia durante N dias
  const minGapMs = opts.minGapMs === undefined ? 30000 : opts.minGapMs;
  const maxBytes = opts.maxBytes || 25 * 1024 * 1024;
  const now = opts.now || Date.now;
  const log = opts.log || console;
  const lastAt = new Map();                         // e-mail -> instante da última cópia
  const lastSig = new Map();                        // e-mail -> assinatura da última cópia

  const keyOf = email => String(email || '').toLowerCase().trim();
  const folderOf = email => path.join(dir, crypto.createHash('sha1').update(keyOf(email)).digest('hex').slice(0, 16));

  // nome: <epoch ms, 13 dígitos>-<itens>-<assinatura 10>.json  (a ordem do nome é a ordem do tempo)
  function files(email) {
    let names;
    try { names = fs.readdirSync(folderOf(email)); } catch (e) { return []; }
    return names
      .map(n => { const m = n.match(/^(\d{13})-(\d+)-([0-9a-f]{10})\.json$/); return m ? { name: n, ts: Number(m[1]), count: Number(m[2]), sig: m[3] } : null; })
      .filter(Boolean)
      .sort((a, b) => b.ts - a.ts);
  }

  function prune(email) {
    const all = files(email);
    const seenDay = new Set();
    const limitTs = now() - keepDays * 86400000;
    all.forEach((f, i) => {
      if (i < keepRecent) { seenDay.add(new Date(f.ts).toISOString().slice(0, 10)); return; }
      const day = new Date(f.ts).toISOString().slice(0, 10);
      const keep = f.ts >= limitTs && !seenDay.has(day);
      if (keep) { seenDay.add(day); return; }
      try { fs.unlinkSync(path.join(folderOf(email), f.name)); } catch (e) { /* já saiu */ }
    });
  }

  function save(email, data, o) {
    o = o || {};
    try {
      const key = keyOf(email);
      data = parse(data);
      if (!dir || !key || isBlank(data)) return null;
      const t = now();
      if (!o.force && lastAt.has(key) && t - lastAt.get(key) < minGapMs) return null;
      const sig = signature(data).slice(0, 10);
      if (!lastSig.has(key)) { const f = files(key)[0]; if (f) lastSig.set(key, f.sig); }
      if (lastSig.get(key) === sig) { lastAt.set(key, t); return null; }
      const body = JSON.stringify({ email: key, saved_at: new Date(t).toISOString(), motivo: o.motivo || 'salvamento', dados: data });
      if (body.length > maxBytes) { log.warn && log.warn('[BACKUP FINANCEIRO] Cópia de ' + body.length + ' bytes passou do limite (' + maxBytes + '); não guardada.'); return null; }
      const folder = folderOf(key);
      fs.mkdirSync(folder, { recursive: true });
      let ts = t;
      const newest = files(key)[0];
      if (newest && ts <= newest.ts) ts = newest.ts + 1;   // duas cópias no mesmo milissegundo
      const name = String(ts).padStart(13, '0') + '-' + contentCount(data) + '-' + sig + '.json';
      const full = path.join(folder, name);
      fs.writeFileSync(full + '.tmp', body);
      fs.renameSync(full + '.tmp', full);
      lastAt.set(key, t); lastSig.set(key, sig);
      prune(key);
      return full;
    } catch (e) {
      log.warn && log.warn('[BACKUP FINANCEIRO] Não foi possível guardar a cópia: ' + e.message);
      return null;
    }
  }

  function read(email, f) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(folderOf(email), f.name), 'utf8'));
      return j && j.dados && typeof j.dados === 'object' ? { dados: j.dados, ts: f.ts, saved_at: j.saved_at, motivo: j.motivo, file: f.name, count: f.count } : null;
    } catch (e) { return null; }
  }

  function latest(email) {
    for (const f of files(email)) { const r = read(email, f); if (r && !isBlank(r.dados)) return r; }
    return null;
  }

  function list(email) { return files(email).map(f => ({ file: f.name, ts: f.ts, count: f.count })); }

  return { save, latest, list, folderOf };
}

module.exports = { isBlank, contentCount, signature, pickBest, createStore, LISTAS };
