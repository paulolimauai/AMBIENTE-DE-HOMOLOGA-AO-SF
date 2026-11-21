'use strict';
// Reinicia o banco do zero (APAGA TUDO: usuários, dados financeiros, chamados, logs) e cria o administrador inicial.
//
// Nenhum e-mail, senha, hash, CPF ou telefone fica neste arquivo (ele é versionado e o repositório pode ser público). Tudo vem do SEU computador:
//   NEXUS_RESET_CONFIRMA=APAGAR-TUDO-<nome do banco>   (confirmação obrigatória; protege contra rodar por engano)
//   NEXUS_RESET_ADMIN_EMAIL=...   NEXUS_RESET_ADMIN_PASSWORD=...   (senha com 8+ caracteres, maiúscula, minúscula, número e símbolo)
//   opcionais: NEXUS_RESET_ADMIN_NAME, NEXUS_RESET_ADMIN_CPF, NEXUS_RESET_ADMIN_PHONE
//   banco: MSSQL_DATABASE (padrão nexus_app)
// A senha é gravada como hash scrypt (mesmo formato do servidor), nunca em texto puro.
// Exemplo (PowerShell):  $env:NEXUS_RESET_CONFIRMA='APAGAR-TUDO-nexus_app'; $env:NEXUS_RESET_ADMIN_EMAIL='...'; $env:NEXUS_RESET_ADMIN_PASSWORD='...'; node scripts/db_reset.js
require('dotenv').config();
const crypto = require('crypto');
const mssql = require('mssql/msnodesqlv8');

const BANCO = process.env.MSSQL_DATABASE || 'nexus_app';
const connStr = `Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=${BANCO};Trusted_Connection=yes;TrustServerCertificate=yes;`;

function hashScrypt(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt:' + salt + ':' + crypto.scryptSync(senha, salt, 64).toString('hex');
}
function senhaForte(s) {
  return typeof s === 'string' && s.length >= 8 && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && /[^A-Za-z0-9]/.test(s);
}

async function performCleanReset() {
  const email = String(process.env.NEXUS_RESET_ADMIN_EMAIL || '').toLowerCase().trim();
  const senha = process.env.NEXUS_RESET_ADMIN_PASSWORD || '';
  if (process.env.NEXUS_RESET_CONFIRMA !== 'APAGAR-TUDO-' + BANCO) {
    console.error('Recusado: isto APAGA TUDO do banco "' + BANCO + '". Defina NEXUS_RESET_CONFIRMA=APAGAR-TUDO-' + BANCO + ' para confirmar.');
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !senhaForte(senha)) {
    console.error('Recusado: informe NEXUS_RESET_ADMIN_EMAIL (válido) e NEXUS_RESET_ADMIN_PASSWORD (8+ caracteres com maiúscula, minúscula, número e símbolo).');
    process.exit(1);
  }
  const nome = process.env.NEXUS_RESET_ADMIN_NAME || 'Administrador';
  const cpf = process.env.NEXUS_RESET_ADMIN_CPF ? String(process.env.NEXUS_RESET_ADMIN_CPF).replace(/\D/g, '') : null;
  const fone = process.env.NEXUS_RESET_ADMIN_PHONE || null;

  const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
  console.log('Conectado ao SQL Server [' + BANCO + ']');

  const cleanupQueries = [
    'DELETE FROM dados_financeiros;',
    'DELETE FROM transacoes;',
    'DELETE FROM contas_bancarias;',
    'DELETE FROM categorias;',
    'DELETE FROM system_logs;',
    'DELETE FROM ordens_servico;',
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'tecnicos_suporte') DELETE FROM tecnicos_suporte;",
    'DELETE FROM usuarios;',
    "DBCC CHECKIDENT ('usuarios', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'dados_financeiros') DBCC CHECKIDENT ('dados_financeiros', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'transacoes') DBCC CHECKIDENT ('transacoes', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'contas_bancarias') DBCC CHECKIDENT ('contas_bancarias', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'categorias') DBCC CHECKIDENT ('categorias', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'system_logs') DBCC CHECKIDENT ('system_logs', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'ordens_servico') DBCC CHECKIDENT ('ordens_servico', RESEED, 0);",
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'tecnicos_suporte') DBCC CHECKIDENT ('tecnicos_suporte', RESEED, 0);"
  ];
  for (const q of cleanupQueries) {
    try {
      await pool.request().query(q);
    } catch (e) {
      console.warn('Erro query:', q.slice(0, 40), e.message);
    }
  }

  await pool.request()
    .input('nome', mssql.NVarChar, nome).input('email', mssql.NVarChar, email).input('senha', mssql.NVarChar, hashScrypt(senha))
    .input('cpf', mssql.NVarChar, cpf).input('fone', mssql.NVarChar, fone)
    .query("INSERT INTO usuarios (name, email, password, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted) VALUES (@nome, @email, @senha, 'Administrador', 1, GETDATE(), NULL, @cpf, @fone, NULL, 1);");

  const u = await pool.request().query('SELECT id, name, email, role, active, created_at FROM usuarios ORDER BY id ASC');
  console.log('Tabela usuarios redefinida com sucesso (iniciando do 0):');
  console.table(u.recordset);

  const tables = ['dados_financeiros', 'transacoes', 'contas_bancarias', 'categorias', 'system_logs', 'ordens_servico'];
  for (const t of tables) {
    const c = await pool.request().query('SELECT COUNT(*) as cnt FROM ' + t);
    console.log(`Tabela ${t}: ${c.recordset[0].cnt} registros`);
  }

  await pool.close();
}

performCleanReset().catch(console.error);
