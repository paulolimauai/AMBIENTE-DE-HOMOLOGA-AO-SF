'use strict';
// Testes do espelho Supabase com um Supabase falso (sem rede). Rodar: node --test supabase-sync.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSync, DOC_PREFIX, ARCHIVE_PREFIX, STATE_FILE } = require('./supabase-sync');

// ---------------------------------------------------------------- Supabase falso (mesma API encadeada do supabase-js)
function createFake() {
  const fake = { online: true, authFail: false, tables: {}, calls: [], missingTables: new Set(), missingColumns: {}, noUnique: new Set(), reject: null };
  const seq = {};
  const T = (name) => (fake.tables[name] = fake.tables[name] || []);
  // como no postgrest-js: o status HTTP fica AO LADO de "error" (não dentro); rede fora = status 0
  const err = (code, message, status) => ({ data: null, error: { code, message }, status: status === undefined ? 400 : status });

  function exec(q) {
    fake.calls.push({ table: q.table, op: q.op });
    if (!fake.online) return err('', 'TypeError: fetch failed', 0);
    if (fake.authFail) return err('', 'Invalid API key', 401);
    if (fake.gateway) return err('', '<html>Bad gateway</html>', fake.gateway);   // proxy/CDN: sem código SQL
    if (fake.missingTables.has(q.table)) return err('PGRST205', "Could not find the table 'public." + q.table + "' in the schema cache", 404);
    const rows = T(q.table);
    const missing = fake.missingColumns[q.table];
    const badColumn = (list) => { if (missing) for (const r of list) for (const c of Object.keys(r)) if (missing.has(c)) return err('PGRST204', "Could not find the '" + c + "' column of '" + q.table + "' in the schema cache"); return null; };
    const rejectIn = (list) => { if (fake.reject) for (const r of list) { const m = fake.reject(q.table, r); if (m) return err('23505', m, 409); } return null; };
    const match = (r) => q.filters.every(f => f(r));
    const add = (r) => { seq[q.table] = (seq[q.table] || 0) + 1; rows.push(Object.assign({ id: seq[q.table] }, JSON.parse(JSON.stringify(r)))); };

    if (q.op === 'insert') {
      const e = badColumn(q.rows) || rejectIn(q.rows); if (e) return e;
      q.rows.forEach(add); return { data: null, error: null };
    }
    if (q.op === 'upsert') {
      if (fake.noUnique.has(q.table)) return err('42P10', 'there is no unique or exclusion constraint matching the ON CONFLICT specification');
      const e = badColumn(q.rows) || rejectIn(q.rows); if (e) return e;
      const col = q.opts.onConflict;
      for (const r of q.rows) { const ex = rows.find(x => x[col] === r[col]); if (ex) Object.assign(ex, JSON.parse(JSON.stringify(r))); else add(r); }
      return { data: null, error: null };
    }
    if (q.op === 'update') {
      const e = badColumn([q.values]); if (e) return e;
      rows.filter(match).forEach(r => Object.assign(r, q.values)); return { data: null, error: null };
    }
    if (q.op === 'delete') {
      for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i])) rows.splice(i, 1);
      return { data: null, error: null };
    }
    let out = rows.filter(match);
    for (const c of q.orders.slice().reverse()) out = out.slice().sort((a, b) => String(a[c]).localeCompare(String(b[c]), undefined, { numeric: true }));
    if (q.rangeTo !== null) out = out.slice(q.rangeFrom, q.rangeTo + 1);
    const cols = q.cols === '*' ? null : String(q.cols).split(',').map(s => s.trim());
    return { data: out.map(r => { if (!cols) return JSON.parse(JSON.stringify(r)); const o = {}; cols.forEach(c => { o[c] = r[c]; }); return JSON.parse(JSON.stringify(o)); }), error: null };
  }

  fake.client = {
    from(table) {
      const q = { table, op: null, rows: null, values: null, opts: {}, filters: [], orders: [], rangeFrom: 0, rangeTo: null, cols: '*' };
      const api = {
        select(c) { if (!q.op) q.op = 'select'; q.cols = c; return api; },
        insert(r) { q.op = 'insert'; q.rows = [].concat(r); return api; },
        upsert(r, o) { q.op = 'upsert'; q.rows = [].concat(r); q.opts = o || {}; return api; },
        update(v) { q.op = 'update'; q.values = v; return api; },
        delete() { q.op = 'delete'; return api; },
        eq(c, v) { q.filters.push(r => String(r[c]) === String(v)); return api; },
        in(c, a) { q.filters.push(r => a.map(String).includes(String(r[c]))); return api; },
        gte(c, v) { q.filters.push(r => new Date(r[c]) >= new Date(v)); return api; },
        lte(c, v) { q.filters.push(r => new Date(r[c]) <= new Date(v)); return api; },
        like(c, p) { q.filters.push(r => String(r[c]).startsWith(p.replace(/%$/, ''))); return api; },
        not(c, op, p) { q.filters.push(r => !String(r[c]).startsWith(p.replace(/%$/, ''))); return api; },
        order(c) { q.orders.push(c); return api; },
        range(a, b) { q.rangeFrom = a; q.rangeTo = b; return api; },
        then(res, rej) { return Promise.resolve(exec(q)).then(res, rej); }
      };
      return api;
    }
  };
  return fake;
}

// ---------------------------------------------------------------- dados de exemplo
const silent = () => { const l = { lines: [] }; ['log', 'warn', 'error'].forEach(k => { l[k] = (m) => l.lines.push(k + ': ' + m); }); return l; };
function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-sb-')); }
function put(dir, name, value) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2)); }
function read(dir, name) { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }

const ANA = { id: '1', name: 'Ana', email: 'Ana@Exemplo.com', password: 'scrypt:aa:bb', role: 'Usuário', active: true, created_at: '2026-11-01T10:00:00.000Z', last_login: '2026-11-10T10:00:00.000Z', cpf: '11144477735', phone: '62999990000', birth_date: '1990-01-01', terms_accepted: true, device_type: 'Computador', must_change_password: false, subscription_status: 'trial', subscription_expires_at: '2026-11-30T18:24:34-03:00' };
const ADM = { id: '2', name: 'Admin', email: 'admin@exemplo.com', password: 'scrypt:cc:dd', role: 'Administrador', active: true, created_at: '2026-10-01T10:00:00.000Z' };
const FIN = {
  'ana@exemplo.com': {
    categories: [{ id: 1, name: 'Alimentação', type: 'despesa', icon: 'x', color: '#fff' }, { id: 2, name: 'alimentação', type: 'despesa' }],
    accounts: [{ id: 1, name: 'Carteira', balance: 100.5, type: 'Conta Corrente', color: '#000' }],
    transactions: [{ id: 1, desc: 'Café', val: 5, type: 'out', date: '2026-11-01', cat: 'Alimentação', acc: 'Carteira', status: 'Pago' }, { id: 2, description: 'Salário', amount: 3000, type: 'receita', date: '2026-11-05' }],
    nextTxId: 3, updated_at: '2026-11-14T10:00:00.000Z'
  },
  'vazio@exemplo.com': { categories: [], accounts: [], transactions: [] }
};
const ORDEM = { id: 'OS-1', protocol: 'NX-1', client_name: 'Ana', client_email: 'ana@exemplo.com', title: 'Erro', description: 'Detalhe', status: 'Novo', timeline: [{ a: 1 }], created_at: '14/11/2026 10:00', updated_at: '2026-11-14T10:00:00Z', time_spent: 2, ticket_type: 'incidente', fila: 'N2' };
const TEC = { id: 't1', name: 'Téc', email: 'Tec@Exemplo.com', specialty: 'Suporte', active: true, created_at: '2026-11-01T10:00:00.000Z' };
const CPF = { '11144477735': { cpf: '11144477735', nome: 'Ana', data_nascimento: '01/01/1990', situacao: 'REGULAR', updated_at: '2026-11-01T10:00:00.000Z' } };
const logs = (n, start = 0) => Array.from({ length: n }, (_, i) => ({ id: 1000 + start + i, timestamp: new Date(Date.UTC(2026, 10, 14, 12, 0, start + i)).toISOString(), user_name: 'Ana', user_email: 'ana@exemplo.com', action: 'Login', entity: 'Sessão', details: 'evento ' + (start + i) })).reverse();

function seedAll(dir) {
  put(dir, 'local_users.json', [ANA, ADM]);
  put(dir, 'local_database_data.json', FIN);
  put(dir, 'local_ordens_servico.json', [ORDEM]);
  put(dir, 'local_tecnicos.json', [TEC]);
  put(dir, 'cpf_registry.json', CPF);
  put(dir, 'system_logs.json', logs(5));
  put(dir, 'local_filas.json', [{ id: 'f1', nome: 'Suporte N2', categorias: ['a'], tecnicos: ['t1'], ativa: true, criada_em: '2026-11-01T10:00:00Z' }]);
  put(dir, 'local_os_sequencia.json', { ultimo: 5, atualizado_em: '2026-11-14T10:00:00Z' });
  put(dir, 'deleted_accounts.json', [{ email: 'x@y.com', deleted_at: '2026-11-02T10:00:00Z' }]);
  put(dir, 'local_avatars.json', { 'ana@exemplo.com': 'data:image/png;base64,AAAA' });
}
function make(fake, dir, extra) {
  const s = createSync();
  const log = silent();
  s.init(Object.assign({ dataDir: dir, client: fake.client, timers: false, log, projectRef: 'proj-a' }, extra || {}));
  s._log = log;
  return s;
}

// ================================================================ testes
test('envia cada arquivo de estado para as tabelas certas (relacional + cópia fiel)', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  const st = await s.syncEverythingNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  const t = fake.tables;

  assert.equal(t.usuarios.length, 2);
  const ana = t.usuarios.find(u => u.email === 'ana@exemplo.com');
  assert.equal(ana.password, 'scrypt:aa:bb'); assert.equal(ana.active, true); assert.equal(ana.subscription_status, 'trial');
  assert.equal(ana.subscription_expires_at, '2026-11-30T21:24:34.000Z');
  assert.equal(t.dados_financeiros.length, 2);
  assert.equal(t.dados_financeiros.find(r => r.email === 'ana@exemplo.com').dados.id, '1');   // cópia fiel do usuário

  const fin = t.nexus_dados_financeiros.find(r => r.email === 'ana@exemplo.com');
  assert.equal(fin.dados.transactions.length, 2);
  assert.equal(t.transacoes.length, 2);
  const cafe = t.transacoes.find(x => x.tx_id === 1);
  assert.deepEqual([cafe.descricao, cafe.valor, cafe.tipo, cafe.categoria, cafe.conta, cafe.status], ['Café', 5, 'Despesa', 'Alimentação', 'Carteira', 'Pago']);
  const sal = t.transacoes.find(x => x.tx_id === 2);
  assert.deepEqual([sal.descricao, sal.valor, sal.tipo, sal.status], ['Salário', 3000, 'Receita', 'Pendente']);
  assert.equal(t.contas_bancarias.length, 1); assert.equal(t.contas_bancarias[0].saldo, 100.5);
  assert.equal(t.categorias.length, 1);                                                          // 'Alimentação' e 'alimentação' = 1 (mesma regra do SQL Server)

  assert.equal(t.ordens_servico[0].protocol, 'NX-1');
  assert.equal(t.ordens_servico[0].timeline, JSON.stringify([{ a: 1 }]));
  assert.equal(t.ordens_servico[0].created_at, '2026-11-14T13:00:00.000Z');                    // dd/mm/aaaa hh:mm (Brasília) -> ISO
  assert.equal(t.tecnicos_suporte[0].email, 'tec@exemplo.com');
  assert.equal(t.cpf_registry[0].cpf, '11144477735');
  assert.equal(t.system_logs.length, 5);

  const docs = t.nexus_dados_financeiros.map(r => r.email).filter(k => k.startsWith(DOC_PREFIX));
  for (const k of ['ordens/NX-1', 'tecnicos/tec@exemplo.com', 'cpf/11144477735', 'filas/f1', 'os_seq/_', 'deleted/x@y.com', 'avatars/ana@exemplo.com']) assert.ok(docs.includes(DOC_PREFIX + k), 'falta ' + k);
  const av = t.nexus_dados_financeiros.find(r => r.email === DOC_PREFIX + 'avatars/ana@exemplo.com');
  assert.deepEqual(av.dados, { __valor: 'data:image/png;base64,AAAA' });
});

test('NADA é descartado em silêncio: registros sem chave utilizável (e-mail vazio) vão como documentos fiéis e voltam na restauração', async () => {
  const dir = tmpDir(); seedAll(dir);
  // caso real encontrado: conjunto financeiro antigo salvo sob a chave "" (sem e-mail) e usuário sem e-mail
  put(dir, 'local_database_data.json', Object.assign({}, FIN, { '': { categories: [{ name: 'X' }], accounts: [{ id: 1, name: 'Antiga', balance: 1 }], transactions: [], updated_at: '2026-10-17T21:07:58.810Z' } }));
  put(dir, 'local_users.json', [ANA, ADM, { id: '8', name: 'Sem email', password: 'scrypt:x:y', role: 'Usuário' }]);
  const fake = createFake(); const s = make(fake, dir);
  const st = await s.syncEverythingNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  const keys = fake.tables.nexus_dados_financeiros.map(r => r.email);
  assert.ok(keys.includes(DOC_PREFIX + 'sem-chave/local_database_data.json/(vazio)'), 'conjunto sem dono guardado');
  assert.ok(keys.includes(DOC_PREFIX + 'sem-chave/local_users.json/2'), 'usuário sem e-mail guardado');
  assert.equal(fake.tables.usuarios.length, 2, 'o relacional só recebe quem tem e-mail');

  const dirB = tmpDir(); const s2 = make(fake, dirB);
  await s2.restoreMissingFiles();
  assert.equal(read(dirB, 'local_database_data.json')[''].accounts[0].name, 'Antiga', 'volta na restauração, sob a mesma chave');
  assert.ok(read(dirB, 'local_users.json').some(u => u.id === '8'));
  assert.equal(Object.keys(read(dirB, 'local_database_data.json')).length, 3);
});

test('invariante: todo registro de cada arquivo local tem correspondente no Supabase', async () => {
  const dir = tmpDir(); seedAll(dir);
  const fin = Object.assign({}, FIN, { '': { accounts: [] }, 'default': { transactions: [] }, 'nulo': null });
  put(dir, 'local_database_data.json', fin);
  const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  const keys = new Set(fake.tables.nexus_dados_financeiros.map(r => r.email));
  for (const k of Object.keys(fin)) {
    if (fin[k] === null) continue;                                    // null não tem conteúdo a guardar
    const lcKey = k.toLowerCase().trim();
    assert.ok(keys.has(lcKey) || keys.has(DOC_PREFIX + 'sem-chave/local_database_data.json/' + (encodeURIComponent(k) || '(vazio)')), 'sem correspondente: ' + JSON.stringify(k));
  }
});

test('o que já foi confirmado não é reenviado', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  const before = fake.calls.length;
  await s.syncEverythingNow();
  assert.equal(fake.calls.length, before, 'segunda passada sem mudanças não deve falar com o Supabase');
});

test('QUEDA DE CONEXÃO: nada se perde, e tudo chega quando a internet volta (mesmo após reiniciar o servidor)', async () => {
  const dir = tmpDir(); seedAll(dir);
  const fake = createFake(); fake.online = false;
  const s1 = make(fake, dir);
  let st = await s1.syncEverythingNow();
  assert.equal(st.inSync, false);
  assert.ok(st.consecutiveFailures >= 1);
  assert.match(st.lastError.message, /fetch failed/);
  assert.equal(Object.keys(fake.tables).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')).acked && Object.keys(JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')).acked).length, 0, 'nada pode ser dado como enviado');

  // o servidor cai e volta com a internet de volta: outra instância, mesmo disco
  const fake2 = createFake();
  fake2.tables = fake.tables; // (vazio) — Supabase novo
  const s2 = make(fake2, dir);
  st = await s2.syncEverythingNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake2.tables.usuarios.length, 2);
  assert.equal(fake2.tables.system_logs.length, 5);
  assert.equal(fake2.tables.transacoes.length, 2);
});

test('gravação feita DURANTE a queda é entregue depois, só ela', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();

  fake.online = false;
  const fin = read(dir, 'local_database_data.json');
  fin['ana@exemplo.com'].transactions.push({ id: 3, desc: 'Mercado', val: 80, type: 'out', date: '2026-11-14', cat: 'Alimentação', acc: 'Carteira', status: 'Pago' });
  put(dir, 'local_database_data.json', fin);
  s.noteWrite(path.join(dir, 'local_database_data.json'));
  let st = await s.flushNow();
  assert.equal(st.inSync, false);
  assert.equal(fake.tables.transacoes.length, 2, 'offline: o remoto continua como estava');

  fake.online = true;
  st = await s.flushNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.transacoes.length, 3);
  assert.equal(fake.tables.transacoes.filter(t => t.tx_id === 3).length, 1, 'sem duplicar');
  assert.equal(fake.tables.nexus_dados_financeiros.find(r => r.email === 'ana@exemplo.com').dados.transactions.length, 3);
});

test('se o processo cair no meio, a próxima inicialização reenvia o que faltou (ack só depois da confirmação)', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake();
  // derruba a rede no meio do ciclo: depois de 6 chamadas bem-sucedidas
  let n = 0; const orig = fake.client.from;
  fake.client.from = (t) => { if (++n > 6) fake.online = false; return orig(t); };
  const s1 = make(fake, dir);
  await s1.syncEverythingNow();
  const partial = Object.keys(JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')).acked).length;
  assert.ok(partial > 0, 'parte foi confirmada');

  fake.online = true; fake.client.from = orig;
  const s2 = make(fake, dir);
  const st = await s2.syncEverythingNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.usuarios.length, 2);
  assert.equal(fake.tables.system_logs.length, 5);
  assert.equal(fake.tables.transacoes.length, 2);
  assert.equal(fake.tables.categorias.length, 1);
});

test('chave inválida (401) segura tudo e não perde nada; corrigida, entrega', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); fake.authFail = true; const s = make(fake, dir);
  let st = await s.syncEverythingNow();
  assert.equal(st.lastError.kind, 'auth'); assert.equal(st.inSync, false);
  fake.authFail = false;
  st = await s.flushNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.usuarios.length, 2);
});

test('resposta de proxy (502, 400 ou 429 sem código SQL) é tentada de novo — nunca vira "linha recusada"', async () => {
  for (const status of [502, 400, 404, 429, 503]) {
    const dir = tmpDir(); seedAll(dir); const fake = createFake(); fake.gateway = status; const s = make(fake, dir);
    let st = await s.syncEverythingNow();
    assert.equal(st.rejected.length, 0, 'status ' + status + ' não pode causar quarentena');
    assert.equal(st.inSync, false); assert.ok(st.consecutiveFailures >= 1);
    fake.gateway = 0;
    st = await s.flushNow();
    assert.equal(st.inSync, true, 'status ' + status + ': ' + JSON.stringify(st));
    assert.equal(fake.tables.usuarios.length, 2);
  }
});

test('exclusão de um usuário apaga no Supabase (e os dados dele); exclusão em massa fica retida', async () => {
  const dir = tmpDir(); seedAll(dir);
  put(dir, 'local_users.json', [ANA, ADM, { ...ANA, id: '3', email: 'b@x.com', cpf: '22' }, { ...ANA, id: '4', email: 'c@x.com', cpf: '33' }, { ...ANA, id: '5', email: 'd@x.com', cpf: '44' }]);
  const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  assert.equal(fake.tables.usuarios.length, 5);

  put(dir, 'local_users.json', [ANA, ADM, { ...ANA, id: '4', email: 'c@x.com', cpf: '33' }, { ...ANA, id: '5', email: 'd@x.com', cpf: '44' }]);
  s.noteWrite('local_users.json');
  await s.flushNow();
  assert.equal(fake.tables.usuarios.length, 4, 'uma exclusão isolada vale');
  assert.ok(!fake.tables.dados_financeiros.some(r => r.email === 'b@x.com'));

  // "reset": o arquivo volta com 1 usuário só — apagaria 3 de 4 de uma vez
  put(dir, 'local_users.json', [ADM]);
  s.noteWrite('local_users.json');
  const st = await s.flushNow();
  assert.equal(fake.tables.usuarios.length, 4, 'nada pode ser apagado em massa');
  assert.equal(st.heldDeletes, 3);
  assert.equal(st.inSync, true, 'nada local ficou sem enviar: o Supabase só retém MAIS do que o arquivo local (isso não é perda)');

  // arquivo zerado de vez ([]): idem
  put(dir, 'local_users.json', []);
  s.noteWrite('local_users.json');
  await s.flushNow();
  assert.equal(fake.tables.usuarios.length, 4);
});

test('exclusão em lote com tombstone (deleted_accounts) é considerada legítima', async () => {
  const dir = tmpDir(); seedAll(dir);
  const many = ['a', 'b', 'c', 'd', 'e'].map((x, i) => ({ ...ANA, id: String(10 + i), email: x + '@x.com', cpf: String(100 + i) }));
  put(dir, 'local_users.json', many);
  const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  put(dir, 'deleted_accounts.json', [{ email: 'a@x.com' }, { email: 'b@x.com' }, { email: 'c@x.com' }]);
  put(dir, 'local_users.json', many.slice(3));
  s.noteWrite('deleted_accounts.json'); s.noteWrite('local_users.json');
  await s.flushNow();
  assert.deepEqual(fake.tables.usuarios.map(u => u.email).sort(), ['d@x.com', 'e@x.com']);
});

test('logs são só-acréscimo: o que sai da janela local continua no Supabase, e nada duplica', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  assert.equal(fake.tables.system_logs.length, 5);

  put(dir, 'system_logs.json', logs(5, 3));            // janela deslizou: perdeu os 3 mais antigos, ganhou 3 novos
  s.noteWrite('system_logs.json');
  const st = await s.flushNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.system_logs.length, 8, 'os 3 que saíram da janela continuam lá');
  assert.equal(new Set(fake.tables.system_logs.map(l => l.details)).size, 8, 'sem duplicatas');
});

test('logs não duplicam mesmo se o ack se perder (queda entre o envio e o registro)', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s1 = make(fake, dir);
  await s1.syncEverythingNow();
  fs.unlinkSync(path.join(dir, STATE_FILE));           // simula perder o arquivo de estado
  const s2 = make(fake, dir);
  await s2.syncEverythingNow();
  assert.equal(fake.tables.system_logs.length, 5);
  assert.equal(fake.tables.transacoes.length, 2);
  assert.equal(fake.tables.usuarios.length, 2);
});

test('tabela ausente no projeto não trava as demais; quando criada, os dados seguem', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); fake.missingTables.add('categorias'); const s = make(fake, dir);
  let st = await s.syncEverythingNow();
  assert.equal(fake.tables.usuarios.length, 2);
  assert.equal(fake.tables.transacoes.length, 2);
  assert.ok(st.degradedTables.categorias);
  assert.equal(st.inSync, false);
  fake.missingTables.clear();
  const st2 = s.status(); assert.ok(st2.pending >= 1);
  // vence a espera de 10 min: força nova avaliação
  const sa = s._state(); assert.ok(Object.keys(sa.acked).length > 0);
});

test('coluna que não existe no banco remoto é omitida e o resto da linha é gravado', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); fake.missingColumns.usuarios = new Set(['subscription_method', 'must_change_password']); const s = make(fake, dir);
  const st = await s.syncEverythingNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.usuarios.length, 2);
  assert.equal(fake.tables.usuarios[0].name.length > 0, true);
  assert.ok(!('subscription_method' in fake.tables.usuarios[0]));
  assert.deepEqual(st.omittedColumns.usuarios.sort(), ['must_change_password', 'subscription_method']);
  // a cópia fiel (jsonb) não perde nenhum campo
  assert.equal(fake.tables.dados_financeiros.find(r => r.email === 'ana@exemplo.com').dados.must_change_password, false);
});

test('tabela sem UNIQUE no e-mail (esquema diferente): usa inserir/atualizar manual, sem duplicar', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); fake.noUnique.add('usuarios'); const s = make(fake, dir);
  await s.syncEverythingNow();
  assert.equal(fake.tables.usuarios.length, 2);
  const users = read(dir, 'local_users.json'); users[0].name = 'Ana Maria';
  put(dir, 'local_users.json', users); s.noteWrite('local_users.json');
  const st = await s.flushNow();
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.usuarios.length, 2, 'atualizou em vez de duplicar');
  assert.equal(fake.tables.usuarios.find(u => u.email === 'ana@exemplo.com').name, 'Ana Maria');
});

test('linha recusada pelo banco (ex.: CPF duplicado) é isolada: as demais entram e o dado fica na cópia fiel', async () => {
  const dir = tmpDir(); seedAll(dir);
  put(dir, 'local_users.json', [ANA, { ...ADM, cpf: ANA.cpf }, { ...ANA, id: '9', email: 'ok@x.com', cpf: '99999999999' }]);
  const fake = createFake();
  fake.reject = (table, row) => (table === 'usuarios' && row.email === 'admin@exemplo.com') ? 'duplicate key value violates unique constraint "usuarios_cpf_key"' : null;
  const s = make(fake, dir);
  const st = await s.syncEverythingNow();
  assert.deepEqual(fake.tables.usuarios.map(u => u.email).sort(), ['ana@exemplo.com', 'ok@x.com']);
  assert.equal(st.rejected.length, 1); assert.equal(st.rejected[0].key, 'admin@exemplo.com');
  assert.ok(fake.tables.dados_financeiros.some(r => r.email === 'admin@exemplo.com'), 'cópia fiel do usuário recusado foi gravada');
  assert.equal(st.inSync, false);
});

test('versão remota diferente (vista pela 1ª vez) é arquivada antes de ser sobrescrita; senha não vai para o arquivo', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake();
  fake.tables.usuarios = [{ id: 1, email: 'ana@exemplo.com', name: 'Nome Antigo', password: '86266049', role: 'Usuário' }];
  fake.tables.nexus_dados_financeiros = [{ email: 'ana@exemplo.com', dados: { transactions: [{ id: 99 }] }, updated_at: 'x' }];
  const s = make(fake, dir);
  await s.syncEverythingNow();
  assert.equal(fake.tables.usuarios.find(u => u.email === 'ana@exemplo.com').name, 'Ana');
  const arquivados = fake.tables.nexus_dados_financeiros.filter(r => r.email.startsWith(ARCHIVE_PREFIX));
  assert.equal(arquivados.length, 2);
  const u = arquivados.find(r => r.dados.tabela === 'usuarios');
  assert.equal(u.dados.versao_remota.name, 'Nome Antigo');
  assert.ok(!('password' in u.dados.versao_remota));
  const f = arquivados.find(r => r.dados.tabela === 'nexus_dados_financeiros');
  assert.deepEqual(f.dados.versao_remota.dados, { transactions: [{ id: 99 }] });
});

test('autocura: linha apagada à mão no painel do Supabase volta no próximo conferimento', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  fake.tables.usuarios.splice(0, 1);                    // alguém apagou uma linha no Table Editor
  await s.verifyRemote();
  await s.flushNow();
  assert.equal(fake.tables.usuarios.length, 2);
});

test('trocar o projeto de destino reenvia tudo para o novo projeto', async () => {
  const dir = tmpDir(); seedAll(dir);
  const a = createFake(); await make(a, dir, { projectRef: 'proj-a' }).syncEverythingNow();
  const b = createFake(); const sb = make(b, dir, { projectRef: 'proj-b' });
  assert.match(sb._log.lines.join('\n'), /projeto de destino mudou/);
  const st = await sb.syncEverythingNow();
  assert.equal(st.project, 'proj-b'); assert.equal(st.inSync, true);
  assert.equal(b.tables.usuarios.length, 2); assert.equal(b.tables.system_logs.length, 5);
});

test('disco novo/vazio: restaura os arquivos a partir do Supabase', async () => {
  const dirA = tmpDir(); seedAll(dirA); const fake = createFake();
  await make(fake, dirA).syncEverythingNow();

  const dirB = tmpDir();                                // disco novo (ex.: redeploy no Render)
  const s = make(fake, dirB);
  const r = await s.restoreMissingFiles();
  assert.ok(r.restored.includes('local_users.json') && r.restored.includes('local_database_data.json'));
  const users = read(dirB, 'local_users.json');
  assert.deepEqual(users.map(u => u.email).sort(), ['admin@exemplo.com', 'ana@exemplo.com'].map(e => users.find(u => u.email.toLowerCase() === e).email).sort());
  assert.equal(users.find(u => u.id === '1').password, 'scrypt:aa:bb');
  assert.deepEqual(read(dirB, 'local_database_data.json')['ana@exemplo.com'].transactions.length, 2);
  assert.equal(read(dirB, 'local_ordens_servico.json')[0].protocol, 'NX-1');
  assert.deepEqual(read(dirB, 'local_os_sequencia.json'), { ultimo: 5, atualizado_em: '2026-11-14T10:00:00Z' });
  assert.deepEqual(read(dirB, 'cpf_registry.json'), CPF);
  assert.equal(read(dirB, 'local_avatars.json')['ana@exemplo.com'], 'data:image/png;base64,AAAA');
  assert.equal(read(dirB, 'local_filas.json')[0].id, 'f1');
  assert.deepEqual(read(dirB, 'deleted_accounts.json'), [{ email: 'x@y.com', deleted_at: '2026-11-02T10:00:00Z' }]);
  // o que foi restaurado já conta como confirmado: nada é reenviado
  const before = fake.calls.length;
  await s.syncEverythingNow();
  assert.equal(fake.calls.filter((c, i) => i >= before && c.op !== 'select').length, 0, 'restaurar não deve regravar o que já está lá');
});

test('restauração NÃO acontece em disco que já tem dados (nunca sobrescreve o local)', async () => {
  const dirA = tmpDir(); seedAll(dirA); const fake = createFake();
  await make(fake, dirA).syncEverythingNow();
  const dirB = tmpDir(); put(dirB, 'local_users.json', [ADM]);
  fs.writeFileSync(path.join(dirB, STATE_FILE), JSON.stringify({ version: 1, project: 'proj-a', acked: { 'x|y|z': '1' }, rejected: {} }));
  const s = make(fake, dirB);
  const r = await s.restoreMissingFiles();
  assert.deepEqual(r.restored, [], 'disco já sincronizado antes: não restaura (evita ressuscitar dado apagado de propósito)');
  assert.equal(read(dirB, 'local_users.json').length, 1);
});

test('arquivo local corrompido ou vazio não apaga nada no Supabase', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  fs.writeFileSync(path.join(dir, 'local_users.json'), '{ quebrado');
  s.noteWrite('local_users.json'); await s.flushNow();
  fs.writeFileSync(path.join(dir, 'local_database_data.json'), '');
  s.noteWrite('local_database_data.json'); await s.flushNow();
  assert.equal(fake.tables.usuarios.length, 2);
  assert.equal(fake.tables.transacoes.length, 2);
});

test('desligado por variável de ambiente: não toca no Supabase', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake();
  process.env.NEXUS_DISABLE_SUPABASE = '1';
  try {
    const s = make(fake, dir);
    s.noteWrite('local_users.json');
    const st = await s.syncEverythingNow();
    assert.equal(st.enabled, false); assert.equal(fake.calls.length, 0);
  } finally { delete process.env.NEXUS_DISABLE_SUPABASE; }
});

test('writeJsonFile → noteWrite envia sozinho pelo temporizador (debounce curto)', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake();
  const s = createSync(); s.init({ dataDir: dir, client: fake.client, timers: true, log: silent(), projectRef: 'p', firstSyncDelayMs: 0 });
  const t0 = Date.now();
  while (Date.now() - t0 < 4000 && !(s.status().inSync && fake.tables.usuarios)) await new Promise(r => setTimeout(r, 50));
  assert.equal(s.status().inSync, true, JSON.stringify(s.status()));
  const users = read(dir, 'local_users.json'); users.push({ ...ANA, id: '7', email: 'novo@x.com', cpf: '77' });
  put(dir, 'local_users.json', users); s.noteWrite(path.join(dir, 'local_users.json'));
  const t1 = Date.now();
  while (Date.now() - t1 < 4000 && !fake.tables.usuarios.some(u => u.email === 'novo@x.com')) await new Promise(r => setTimeout(r, 25));
  assert.ok(fake.tables.usuarios.some(u => u.email === 'novo@x.com'), 'chegou ao Supabase');
  assert.ok(Date.now() - t1 < 2500, 'em menos de ~2,5 s');
  await s.flushAndStop(2000);
});

test('flushAndStop envia o que está na fila antes de encerrar', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake();
  const s = make(fake, dir);
  const st = await s.flushAndStop(3000);
  assert.equal(st.inSync, true, JSON.stringify(st));
  assert.equal(fake.tables.usuarios.length, 2);
});

// ================================================================ credenciais: o login puxa a senha direto do Supabase
test('fetchUserRecord: devolve a cópia fiel da conta (senha em hash + relógio da troca) para o login puxar do Supabase', async () => {
  const dir = tmpDir(); seedAll(dir);
  put(dir, 'local_users.json', [{ ...ANA, password: 'scrypt:aa:bb', password_changed_at: '2026-11-15T10:00:00.000Z' }, ADM]);
  const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  const rec = await s.fetchUserRecord('ANA@exemplo.com ');                     // e-mail em qualquer caixa, com espaço
  assert.equal(rec.email, 'ana@exemplo.com');
  assert.equal(rec.password, 'scrypt:aa:bb');
  assert.equal(rec.password_changed_at, '2026-11-15T10:00:00.000Z');
  assert.equal(rec.role, 'Usuário');
  assert.equal(await s.fetchUserRecord('ninguem@exemplo.com'), null);
  assert.equal(await s.fetchUserRecord(''), null);
});

test('fetchUserRecord: sem a cópia fiel usa a linha de "usuarios" (tem a senha, não tem o relógio)', async () => {
  const dir = tmpDir(); const fake = createFake(); const s = make(fake, dir);
  fake.tables.usuarios = [{ id: 9, name: 'Só Relacional', email: 'rel@exemplo.com', password: 'scrypt:ee:ff', role: 'Usuário', active: true, must_change_password: false }];
  const rec = await s.fetchUserRecord('rel@exemplo.com');
  assert.equal(rec.password, 'scrypt:ee:ff');
  assert.equal(rec.password_changed_at, undefined);
});

test('fetchUserRecord: nunca lança e nunca trava o login (sem rede, desligado ou lento devolve null)', async () => {
  const dir = tmpDir(); seedAll(dir); const fake = createFake(); const s = make(fake, dir);
  await s.syncEverythingNow();
  fake.online = false;
  assert.equal(await s.fetchUserRecord('ana@exemplo.com'), null, 'sem rede');
  fake.online = true;

  const off = createSync(); off.init({ dataDir: tmpDir(), disabled: true, log: silent() });
  assert.equal(await off.fetchUserRecord('ana@exemplo.com'), null, 'módulo desligado');

  const lento = createFake(); const dir2 = tmpDir(); seedAll(dir2);
  const slowClient = { from: (t) => ({ select() { return this; }, eq() { return this; }, range() { return this; }, then() { /* nunca responde */ } }) };
  const s2 = createSync(); s2.init({ dataDir: dir2, client: slowClient, timers: false, log: silent(), projectRef: 'p', firstSyncDelayMs: 99999999 });
  const t0 = Date.now();
  assert.equal(await s2.fetchUserRecord('ana@exemplo.com', { timeoutMs: 600 }), null, 'Supabase que não responde');
  assert.ok(Date.now() - t0 < 2500, 'voltou perto do limite de tempo, sem esperar o Supabase');
});
