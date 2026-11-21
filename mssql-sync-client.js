'use strict';
// ============================================================================
// Cliente "PostgREST-like" sobre o Microsoft SQL Server interno (MssqlAdapter)
//
// O motor de espelhamento durável (supabase-sync.js) foi escrito para a API do
// Supabase (postgrest-js): from(t).select().eq().in()..., insert, upsert,
// update().eq(), delete().in()/.eq(). Este módulo implementa EXATAMENTE esse
// subconjunto sobre o pool MSSQL do server.js, devolvendo o mesmo formato de
// resultado ({ data, error }) e os mesmos códigos de erro que o classify() do
// motor já entende:
//   42P01 -> tabela ausente ("notable": adia a tabela, nada se perde)
//   42703 -> coluna ausente ("nocolumn": a coluna é omitida e o envio segue)
//   23xxx -> dado recusado ("row": só a linha errada fica retida)
//   42501 -> permissão ("auth": nova tentativa em 5 min)
//   demais -> transitório (rede/timeout: reenvio com espera crescente)
//
// Datas voltam como ISO e colunas "dados" (JSON) já vêm parseadas pelo
// MssqlAdapter — o motor compara conteúdo como se viesse do Postgres.
// ============================================================================

const IDENT_RE = /^[A-Za-z0-9_]+$/;
const MAX_PARAMS_PER_STMT = 1800; // SQL Server aceita 2100 parâmetros por consulta

function qident(name) {
  const s = String(name || '');
  if (!IDENT_RE.test(s)) throw new Error('identificador inválido: ' + s);
  return '[' + s + ']';
}

// Normaliza o erro do tedious/msnodesqlv8 para o formato { message, code, status }
// que o classify() do supabase-sync.js sabe interpretar.
function toError(err, table) {
  const num = Number(err && err.number) || 0;
  const raw = String((err && err.message) || err || 'erro do SQL Server');
  const out = { message: (table ? table + ': ' : '') + raw.slice(0, 400), code: '', status: 0 };
  if (num === 208) { out.code = '42P01'; }                                    // Invalid object name -> tabela ausente
  else if (num === 207) {                                                    // Invalid column name -> coluna ausente
    out.code = '42703';
    const m = raw.match(/Invalid column name '([^']+)'/i) || raw.match(/Nome de coluna '([^']+)'/i) || raw.match(/column "([^"]+)"/i);
    out.message = (table ? table + ': ' : '') + 'column "' + (m ? m[1] : '?') + '" of table does not exist';
  } else if (num === 229 || num === 230 || num === 262 || num === 297) {
    out.code = '42501'; out.status = 403;                                    // permissão -> auth (backoff longo)
  } else if ([191, 245, 2628, 8152, 8153, 8154, 1946, 1934, 515, 547, 2601, 2627].includes(num)) {
    out.code = '23000';                                                      // dado recusado pelo banco -> só a linha fica retida
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fuso das colunas de data. NO APLICATIVO INTEIRO o literal de uma coluna DATETIME2 do SQL Server é HORÁRIO DE BRASÍLIA (GETDATE(), getBrasiliaSqlString,
// getBrasiliaIsoString tratam assim), e o driver devolve esse literal como um Date "em UTC" (literal 14:08:14 => 14:08:14Z).
// O motor de espelho, escrito para o Postgres, fala em instantes UTC (ISO com "Z"). Antes, o "Z" era descartado na conversão para DATETIME2 (o literal virava
// o horário UTC) e a leitura devolvia o literal como se fosse UTC: o motor e o app discordavam por 3 h. O espelho de usuários realimenta o próprio JSON
// a partir do SQL, então cada volta SQL -> arquivo -> SQL somava +3 h em created_at/last_login (≈ 1 dia a cada minuto: contas "criadas em 2028").
// Agora: escrita = instante -> literal de Brasília; leitura = literal de Brasília -> instante. Ida e volta é idêntica, não há deriva possível.
// ---------------------------------------------------------------------------------------------------------------------------------
const BRASILIA_MS = 3 * 60 * 60 * 1000;   // UTC-3 fixo (o app usa "-03:00" em todo lugar; o Brasil não tem horário de verão desde 2019)
const ISO_COM_FUSO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:?\d{2})$/;

// Instante (Date ou texto ISO COM fuso) -> literal de Brasília "AAAA-MM-DD HH:MM:SS.mmm" para a coluna. Qualquer outra coisa volta como veio.
function paraLiteralBrasilia(valor) {
  let ms = NaN;
  if (valor instanceof Date) ms = valor.getTime();
  else if (typeof valor === 'string' && ISO_COM_FUSO_RE.test(valor.trim())) ms = Date.parse(valor.trim().replace(' ', 'T'));
  if (!Number.isFinite(ms)) return valor;
  const d = new Date(ms - BRASILIA_MS);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + '.' + p(d.getUTCMilliseconds(), 3);
}

// Date devolvido pelo driver (literal de Brasília lido como UTC) -> instante verdadeiro em ISO
function deLiteralBrasilia(date) {
  return new Date(date.getTime() + BRASILIA_MS).toISOString();
}

// Converte valores lidos do SQL Server para o formato que o motor espera:
// Date -> ISO do instante verdadeiro, demais valores passam como estão (o adapter já faz JSON.parse em "dados").
function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    out[k] = (v instanceof Date) ? deLiteralBrasilia(v) : v;
  }
  return out;
}

// Colunas de data de cada tabela (consultadas uma vez por pool e guardadas). Se a consulta falhar não converte nada (o comportamento é o de antes).
const colunasDataPorPool = new WeakMap();
async function colunasData(pool, table) {
  let porTabela = colunasDataPorPool.get(pool);
  if (!porTabela) { porTabela = new Map(); colunasDataPorPool.set(pool, porTabela); }
  if (porTabela.has(table)) return porTabela.get(table);
  let cols = new Set();
  try {
    const res = await pool.query(
      "SELECT c.name AS coluna FROM sys.columns c WHERE c.object_id = OBJECT_ID($1) AND TYPE_NAME(c.user_type_id) IN ('datetime','datetime2','smalldatetime')",
      [table]
    );
    cols = new Set((res.rows || []).map(r => String(r.coluna)));
    porTabela.set(table, cols);
  } catch (e) { /* sem acesso ao catálogo: não converte e tenta de novo na próxima escrita */ }
  return cols;
}
function converterDatas(row, cols) {
  if (!cols || !cols.size || !row || typeof row !== 'object') return row;
  let out = row;
  for (const c of cols) {
    if (Object.prototype.hasOwnProperty.call(row, c)) {
      const novo = paraLiteralBrasilia(row[c]);
      if (novo !== row[c]) { if (out === row) out = Object.assign({}, row); out[c] = novo; }
    }
  }
  return out;
}

class Query {
  constructor(pool, table) {
    this.pool = pool;
    this.table = table;
    this.op = 'select';
    this.cols = '*';
    this.filters = [];   // { col, op, val }
    this.orders = [];    // [col]
    this.rangeSpec = null; // { from, to } inclusivo
    this.payload = null; // linhas para insert/upsert ou objeto para update
    this.onConflict = null;
  }

  // ---- cadeia estilo postgrest-js (todos devolvem this; a execução é no await) ----
  select(cols) { this.op = 'select'; this.cols = cols || '*'; return this; }
  eq(col, val) { this.filters.push({ col, op: '=', val }); return this; }
  neq(col, val) { this.filters.push({ col, op: '<>', val }); return this; }
  in(col, vals) { this.filters.push({ col, op: 'IN', val: Array.isArray(vals) ? vals : [vals] }); return this; }
  gte(col, val) { this.filters.push({ col, op: '>=', val }); return this; }
  gt(col, val) { this.filters.push({ col, op: '>', val }); return this; }
  lte(col, val) { this.filters.push({ col, op: '<=', val }); return this; }
  lt(col, val) { this.filters.push({ col, op: '<', val }); return this; }
  like(col, pattern) { this.filters.push({ col, op: 'LIKE', val: pattern }); return this; }
  not(col, op, val) {
    const o = String(op || 'eq').toLowerCase();
    const sqlOp = o === 'like' ? 'NOT LIKE' : (o === 'eq' ? '<>' : o === 'in' ? 'NOT IN' : 'NOT ' + o.toUpperCase());
    this.filters.push({ col, op: sqlOp, val });
    return this;
  }
  order(col) { this.orders.push(col); return this; }
  range(from, to) { this.rangeSpec = { from: Math.max(0, parseInt(from, 10) || 0), to: Math.max(0, parseInt(to, 10) || 0) }; return this; }
  insert(rows) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this; }
  upsert(rows, opts) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.onConflict = (opts && opts.onConflict) || null; return this; }
  update(row) { this.op = 'update'; this.payload = row || {}; return this; }
  delete() { this.op = 'delete'; return this; }
  retry() { return this; } // no-op: o motor chama .retry(false) no login; aqui não há retry interno

  // ---- montagem de SQL ----
  buildWhere(params) {
    const parts = [];
    for (const f of this.filters) {
      const col = qident(f.col);
      if (f.op === 'IN' || f.op === 'NOT IN') {
        const vals = Array.isArray(f.val) ? f.val : [f.val];
        if (!vals.length) { parts.push(f.op === 'IN' ? '1 = 0' : '1 = 1'); continue; }
        const marks = vals.map(v => { params.push(v); return '$' + params.length; });
        parts.push(col + ' ' + f.op + ' (' + marks.join(',') + ')');
      } else {
        params.push(f.val);
        parts.push(col + ' ' + f.op + ' $' + params.length);
      }
    }
    return parts.length ? ' WHERE ' + parts.join(' AND ') : '';
  }

  buildOrder() {
    const cols = this.orders.length ? this.orders : ['(SELECT 0)'];
    return ' ORDER BY ' + cols.map(c => (c === '(SELECT 0)' ? c : qident(c) + ' ASC')).join(', ');
  }

  async runSelect() {
    const params = [];
    const cols = (this.cols === '*') ? '*' : String(this.cols).split(',').map(c => qident(c.trim())).join(', ');
    let sql = 'SELECT ' + cols + ' FROM ' + qident(this.table) + this.buildWhere(params);
    sql += this.buildOrder();
    if (this.rangeSpec) {
      params.push(this.rangeSpec.from);
      const off = '$' + params.length;
      params.push(Math.max(1, this.rangeSpec.to - this.rangeSpec.from + 1));
      sql += ' OFFSET ' + off + ' ROWS FETCH NEXT $' + params.length + ' ROWS ONLY';
    }
    const res = await this.pool.query(sql, params);
    return { data: (res.rows || []).map(normalizeRow), error: null };
  }

  // INSERT em lotes (respeitando o limite de parâmetros do SQL Server)
  async runInsert(rows) {
    if (!rows || !rows.length) return { data: null, error: null };
    const cols = Object.keys(rows[0]).filter(c => IDENT_RE.test(c));
    if (!cols.length) return { data: null, error: { message: this.table + ': linha sem colunas válidas', code: '23000', status: 0 } };
    const maxRows = Math.max(1, Math.floor(MAX_PARAMS_PER_STMT / cols.length));
    for (let i = 0; i < rows.length; i += maxRows) {
      const part = rows.slice(i, i + maxRows);
      const params = [];
      const tuples = part.map(row => '(' + cols.map(c => {
        params.push(row[c] === undefined ? null : row[c]);
        return '$' + params.length;
      }).join(',') + ')').join(',');
      const sql = 'INSERT INTO ' + qident(this.table) + ' (' + cols.map(qident).join(',') + ') VALUES ' + tuples;
      try {
        await this.pool.query(sql, params);
      } catch (e) {
        return { data: null, error: toError(e, this.table) };
      }
    }
    return { data: null, error: null };
  }

  async runUpdate(row) {
    const params = [];
    const sets = Object.keys(row).filter(c => IDENT_RE.test(c)).map(c => {
      params.push(row[c] === undefined ? null : row[c]);
      return qident(c) + ' = $' + params.length;
    });
    if (!sets.length) return { data: null, error: { message: this.table + ': update sem colunas', code: '23000', status: 0 } };
    let sql = 'UPDATE ' + qident(this.table) + ' SET ' + sets.join(', ') + this.buildWhere(params);
    if (!this.filters.length) return { data: null, error: { message: this.table + ': update sem filtro recusado', code: '23000', status: 0 } };
    try {
      await this.pool.query(sql, params);
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: toError(e, this.table) };
    }
  }

  async runDelete() {
    const params = [];
    const sql = 'DELETE FROM ' + qident(this.table) + this.buildWhere(params);
    try {
      await this.pool.query(sql, params);
      return { data: null, error: null };
    } catch (e) {
      return { data: null, error: toError(e, this.table) };
    }
  }

  // Upsert manual: descobre o que já existe pela chave e atualiza/inser o resto
  // (equivale ao upsert(onConflict) do PostgREST sem depender de constraint única no MSSQL).
  async runUpsert(rows) {
    const keyCol = this.onConflict;
    if (!keyCol || !IDENT_RE.test(keyCol)) return this.runInsert(rows);
    const byKey = new Map();
    const keys = [];
    for (const r of rows) {
      const k = String(r[keyCol]);
      if (!byKey.has(k)) { byKey.set(k, []); keys.push(r[keyCol]); }
      byKey.get(k).push(r);
    }
    const existing = new Set();
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      const params = [];
      const marks = part.map(v => { params.push(v); return '$' + params.length; });
      try {
        const res = await this.pool.query('SELECT ' + qident(keyCol) + ' AS k FROM ' + qident(this.table) + ' WHERE ' + qident(keyCol) + ' IN (' + marks.join(',') + ')', params);
        for (const r of (res.rows || [])) existing.add(String(r.k));
      } catch (e) {
        return { data: null, error: toError(e, this.table) };
      }
    }
    const toInsert = [];
    for (const r of rows) {
      if (existing.has(String(r[keyCol]))) {
        const upd = new Query(this.pool, this.table).update(r).eq(keyCol, r[keyCol]);
        const res = await upd.runUpdate(r);
        if (res.error) return res;
      } else {
        toInsert.push(r);
      }
    }
    return this.runInsert(toInsert);
  }

  async execute() {
    try {
      if (this.op === 'select') return await this.runSelect();
      if (this.op === 'insert' || this.op === 'upsert' || this.op === 'update') {
        // Datas em instante UTC (ISO com "Z"/offset) viram o literal de Brasília que o resto do app espera (ver o bloco "Fuso das colunas de data")
        const cols = await colunasData(this.pool, this.table);
        if (cols.size) {
          if (this.op === 'update') this.payload = converterDatas(this.payload, cols);
          else this.payload = (this.payload || []).map(r => converterDatas(r, cols));
        }
      }
      if (this.op === 'insert') return await this.runInsert(this.payload);
      if (this.op === 'upsert') return await this.runUpsert(this.payload);
      if (this.op === 'update') return await this.runUpdate(this.payload);
      if (this.op === 'delete') return await this.runDelete();
      return { data: null, error: { message: 'operação inválida: ' + this.op, code: '', status: 0 } };
    } catch (e) {
      return { data: null, error: toError(e, this.table) };
    }
  }

  then(onFulfilled, onRejected) {
    return this.execute().then(onFulfilled, onRejected);
  }
  catch(onRejected) { return this.execute().catch(onRejected); }
}

// Tabelas do motor cujo nome COLIDE com uma tabela do próprio aplicativo no mesmo banco.
// No Supabase, "dados_financeiros" guarda a cópia fiel do CADASTRO do usuário ({ id, name, email, password... }), mas no banco interno
// "dados_financeiros" é a tabela do aplicativo com o retrato FINANCEIRO da conta ({ transactions, accounts, ... }), com a mesma chave (e-mail).
// Entre 20/11 e 21/11/2026 o espelho gravou o cadastro por cima do financeiro a cada subida do servidor, e a leitura seguinte devolvia o
// cadastro à tela como se fosse o financeiro: "mudei o código e some tudo". Agora o espelho usa a própria tabela física.
const TABELA_FISICA = { dados_financeiros: 'espelho_dados_financeiros' };

// Cria o cliente compatível: { from(tabela) -> Query } — mesma superfície usada pelo supabase-sync.js.
function createClient(pool) {
  if (!pool || typeof pool.query !== 'function') throw new Error('pool MSSQL inválido para o cliente de sincronização');
  return {
    from(table) {
      if (!IDENT_RE.test(String(table || ''))) throw new Error('tabela inválida: ' + table);
      return new Query(pool, TABELA_FISICA[table] || table);
    }
  };
}

module.exports = { createClient, TABELA_FISICA, paraLiteralBrasilia, deLiteralBrasilia };
