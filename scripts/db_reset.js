const mssql = require('mssql/msnodesqlv8');

const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function performCleanReset() {
  const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
  console.log('Conectado ao SQL Server [AMBIENTE DE HOMOLOGAÇAO SF]');

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
    "IF EXISTS (SELECT * FROM sys.tables WHERE name = 'tecnicos_suporte') DBCC CHECKIDENT ('tecnicos_suporte', RESEED, 0);",
    `INSERT INTO usuarios (name, email, password, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted)
     VALUES ('Administrador', 'admin@nexusfinanceiro.com', 'scrypt:a39223e1d3ba839ffdc78561b27efc13:f446527daf61034b57bccd91f9c8fb8ec07a3c69b5f4dd0bc0e1dc2e8af2e8876536c0711eeee51aa89ecc9739e21f869ab2e552265b49832583d9c333b91189', 'Administrador', 1, GETDATE(), NULL, NULL, NULL, NULL, 1);`,
    `INSERT INTO usuarios (name, email, password, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted)
     VALUES ('PAULO DE LIMA PEREIRA', 'paulolp0101@gmail.com', 'scrypt:7aacf3b6d15a47f878de65d64c16d690:27ac55d742b8dc5e67c00e9350a17b6fe1d11418a6037c4ee7b3dc2a38b1b454de097d7de9481d73a0c518881917461a179e404a9ab3a2d8c73020c5e3c2986b', 'Administrador', 1, GETDATE(), NULL, '040.233.261-00', '(62) 99234-5372', NULL, 1);`
  ];

  for (const q of cleanupQueries) {
    try {
      await pool.request().query(q);
    } catch(e) {
      console.warn('Erro query:', q.slice(0, 40), e.message);
    }
  }

  const u = await pool.request().query('SELECT id, name, email, role, active, created_at, cpf, phone FROM usuarios ORDER BY id ASC');
  console.log('Tabela usuarios redefinida com sucesso (Iniciando do 0):');
  console.table(u.recordset);

  const tables = ['dados_financeiros', 'transacoes', 'contas_bancarias', 'categorias', 'system_logs', 'ordens_servico'];
  for (const t of tables) {
    const c = await pool.request().query('SELECT COUNT(*) as cnt FROM ' + t);
    console.log(`Tabela ${t}: ${c.recordset[0].cnt} registros`);
  }

  await pool.close();
}

performCleanReset().catch(console.error);
