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
    assert.ok(!/\[dados_financeiros\]/.test(q.sql), 'tocou a tabela do aplicativo: ' + q.sql);
    assert.match(q.sql, /\[espelho_dados_financeiros\]/);
  }
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
