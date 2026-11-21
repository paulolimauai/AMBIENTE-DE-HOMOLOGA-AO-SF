'use strict';

/**
 * Trava a causa raiz do "mudei o código e some tudo" (20–21/11/2026): o espelho durável, quando aponta para o SQL Server interno, gravava a cópia do
 * CADASTRO do usuário na tabela dados_financeiros — que no banco interno é a tabela do app com o FINANCEIRO da conta (mesma chave: e-mail).
 * Rodar com: node --test mssql-sync-client.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createClient, TABELA_FISICA } = require('./mssql-sync-client');

function poolFalso() {
  const consultas = [];
  return { consultas, async query(sql, params) { consultas.push({ sql, params }); return { rows: [] }; } };
}

test('o espelho NUNCA usa a tabela dados_financeiros do aplicativo: grava em espelho_dados_financeiros', async () => {
  const pool = poolFalso(); const c = createClient(pool);
  await c.from('dados_financeiros').upsert([{ email: 'a@x.com', dados: { id: 1, password: 'scrypt:x' } }], { onConflict: 'email' });
  await c.from('dados_financeiros').select('email,dados').eq('email', 'a@x.com').range(0, 0);
  await c.from('dados_financeiros').delete().in('email', ['a@x.com']);
  assert.ok(pool.consultas.length >= 3);
  for (const q of pool.consultas) {
    if (/sys\.columns/.test(q.sql)) {   // consulta de catálogo (colunas de data): o alvo vai no parâmetro e tem de ser a tabela do espelho
      assert.deepEqual(q.params, ['espelho_dados_financeiros']);
      continue;
    }
    assert.ok(!/\[dados_financeiros\]/.test(q.sql), 'tocou a tabela do aplicativo: ' + q.sql);
    assert.match(q.sql, /\[espelho_dados_financeiros\]/);
  }
});

// ---------------------------------------------------------------------------------------------------------------------------------
// Deriva de +3 h (21/11/2026): o literal DATETIME2 do SQL é horário de Brasília; o motor gravava instantes UTC e o app lia o literal como Brasília.
// ---------------------------------------------------------------------------------------------------------------------------------
const { paraLiteralBrasilia, deLiteralBrasilia } = require('./mssql-sync-client');

// SQL Server de mentira: uma tabela `usuarios` com colunas de data; guarda o LITERAL (texto) e devolve Date "em UTC", como o driver faz
function sqlComDatas() {
  const linhas = new Map();
  const pool = {
    linhas,
    async query(sql, params) {
      if (/sys\.columns/.test(sql)) return { rows: [{ coluna: 'created_at' }, { coluna: 'last_login' }] };
      if (/^SELECT \[email\] AS k/.test(sql)) return { rows: params.filter(p => linhas.has(p)).map(p => ({ k: p })) };
      if (/^SELECT/.test(sql)) return { rows: Array.from(linhas.values()).map(l => ({ email: l.email, created_at: l.created_at ? new Date(l.created_at.replace(' ', 'T') + 'Z') : null, last_login: l.last_login ? new Date(l.last_login.replace(' ', 'T') + 'Z') : null })) };
      const mUp = /^UPDATE \[usuarios\] SET (.+) WHERE/.exec(sql);
      if (mUp) {
        const cols = mUp[1].split(', ').map(s => /\[(\w+)\]/.exec(s)[1]);
        const email = params[params.length - 1]; const l = linhas.get(email);
        cols.forEach((c, i) => { l[c] = params[i]; });
        return { rows: [] };
      }
      const mIns = /^INSERT INTO \[usuarios\] \((.+?)\) VALUES/.exec(sql);
      if (mIns) {
        const cols = mIns[1].split(',').map(s => /\[(\w+)\]/.exec(s)[1]);
        const l = {}; cols.forEach((c, i) => { l[c] = params[i]; });
        linhas.set(l.email, l);
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  return pool;
}

test('datas: o instante UTC vira o literal de Brasília na escrita e volta idêntico na leitura (ida e volta sem deriva)', async () => {
  const pool = sqlComDatas(); const c = createClient(pool);
  const instante = '2026-11-19T14:08:14.000Z';   // 11:08:14 em Brasília
  const r = await c.from('usuarios').upsert([{ email: 'a@x.com', created_at: instante, last_login: instante }], { onConflict: 'email' });
  assert.equal(r.error, null);
  assert.equal(pool.linhas.get('a@x.com').created_at, '2026-11-19 11:08:14.000', 'o literal gravado tem de ser o horário de Brasília');
  const lido = await c.from('usuarios').select('email,created_at,last_login');
  assert.equal(lido.data[0].created_at, instante, 'a leitura tem de devolver o mesmo instante');
  assert.equal(lido.data[0].last_login, instante);
});

test('datas: 50 voltas escrever -> ler -> escrever NÃO mudam o valor (antes somava 3 h por volta)', async () => {
  const pool = sqlComDatas(); const c = createClient(pool);
  let valor = '2026-11-19T14:08:14.000Z';
  for (let i = 0; i < 50; i++) {
    await c.from('usuarios').upsert([{ email: 'a@x.com', created_at: valor, last_login: valor }], { onConflict: 'email' });
    valor = (await c.from('usuarios').select('email,created_at')).data[0].created_at;
  }
  assert.equal(valor, '2026-11-19T14:08:14.000Z');
  assert.equal(pool.linhas.get('a@x.com').created_at, '2026-11-19 11:08:14.000');
});

test('datas: offset -03:00 (o formato do espelho local_users.json) também vira literal de Brasília', () => {
  assert.equal(paraLiteralBrasilia('2026-11-19T11:08:14-03:00'), '2026-11-19 11:08:14.000');
  assert.equal(paraLiteralBrasilia('2026-11-19T14:08:14.250Z'), '2026-11-19 11:08:14.250');
  assert.equal(deLiteralBrasilia(new Date('2026-11-19T11:08:14.000Z')), '2026-11-19T14:08:14.000Z');
});

test('datas: texto que não é ISO com fuso, nulo e números passam como vieram (nada é inventado)', () => {
  for (const v of [null, undefined, '', 'Cliente', '2026-11-19 11:08:14', '2026-11-19', 42, true]) assert.equal(paraLiteralBrasilia(v), v);
  assert.equal(paraLiteralBrasilia('2026-13-45T99:99:99Z'), '2026-13-45T99:99:99Z');
});

test('datas: colunas que NÃO são de data não são tocadas, mesmo que o texto pareça uma data ISO', async () => {
  const consultas = [];
  const pool = { async query(sql, params) { consultas.push({ sql, params }); if (/sys\.columns/.test(sql)) return { rows: [{ coluna: 'created_at' }] }; return { rows: [] }; } };
  await createClient(pool).from('usuarios').insert([{ email: 'a@x.com', created_at: '2026-11-19T14:08:14.000Z', nome: '2026-11-19T14:08:14.000Z' }]);
  const ins = consultas.find(q => /^INSERT/.test(q.sql));
  assert.deepEqual(ins.params, ['a@x.com', '2026-11-19 11:08:14.000', '2026-11-19T14:08:14.000Z']);
});

test('datas: se a consulta de catálogo falhar, a escrita segue como antes (não trava o espelho)', async () => {
  const consultas = [];
  const pool = { async query(sql, params) { consultas.push({ sql, params }); if (/sys\.columns/.test(sql)) throw new Error('sem permissão'); return { rows: [] }; } };
  const r = await createClient(pool).from('usuarios').insert([{ email: 'a@x.com', created_at: '2026-11-19T14:08:14.000Z' }]);
  assert.equal(r.error, null);
  assert.equal(consultas.find(q => /^INSERT/.test(q.sql)).params[1], '2026-11-19T14:08:14.000Z');
});

test('as demais tabelas do espelho seguem com o próprio nome (nexus_dados_financeiros, usuarios, transacoes...)', async () => {
  const pool = poolFalso(); const c = createClient(pool);
  for (const t of ['nexus_dados_financeiros', 'usuarios', 'transacoes', 'contas_bancarias', 'categorias', 'system_logs']) await c.from(t).select('*').range(0, 0);
  assert.deepEqual(pool.consultas.map((q) => (q.sql.match(/FROM \[([A-Za-z0-9_]+)\]/) || [])[1]), ['nexus_dados_financeiros', 'usuarios', 'transacoes', 'contas_bancarias', 'categorias', 'system_logs']);
});

test('o mapeamento é exatamente este (mudar exige decisão consciente)', () => {
  assert.deepEqual(TABELA_FISICA, { dados_financeiros: 'espelho_dados_financeiros' });
});

test('identificador inválido continua recusado', () => {
  assert.throws(() => createClient(poolFalso()).from('x; DROP TABLE usuarios'), /tabela inválida/);
});
