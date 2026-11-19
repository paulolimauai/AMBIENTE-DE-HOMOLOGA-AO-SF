require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
(async () => {
  let mssql;
  try { mssql = require('mssql/msnodesqlv8'); } catch (e) { try { mssql = require('mssql'); } catch (e2) { console.log('SEM_PACOTE_MSSQL'); return; } }
  const dbName = process.env.MSSQL_DATABASE || 'AMBIENTE DE HOMOLOGAÇAO SF';
  const connStr = `Driver={${process.env.MSSQL_DRIVER || 'ODBC Driver 17 for SQL Server'}};Server=${process.env.MSSQL_SERVER || 'localhost'};Database=${dbName};Trusted_Connection=yes;TrustServerCertificate=yes;Connection Timeout=5`;
  const pool = await new mssql.ConnectionPool({ connectionString: connStr, connectionTimeout: 5000, requestTimeout: 8000 }).connect();
  for (const t of ['usuarios', 'transacoes', 'contas_bancarias', 'ordens_servico', 'tecnicos_suporte', 'system_logs', 'cpf_registry', 'dados_financeiros', 'categorias']) {
    try { const c = await pool.request().query(`SELECT COUNT(*) AS c FROM [${t}]`); console.log(t + ': ' + c.recordset[0].c); } catch (e) { console.log(t + ': ERRO ' + e.message.slice(0, 60)); }
  }
  // timestamps recentes em system_logs e ordens_servico
  for (const t of ['system_logs', 'ordens_servico', 'usuarios']) {
    try {
      const cols = await pool.request().query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}' AND (COLUMN_NAME LIKE '%data%' OR COLUMN_NAME LIKE '%date%' OR COLUMN_NAME LIKE '%criado%' OR COLUMN_NAME LIKE '%atualiz%' OR COLUMN_NAME LIKE '%time%')`);
      console.log(t + ' colunas-data: ' + cols.recordset.map(x => x.COLUMN_NAME).join(','));
    } catch (e) {}
  }
  await pool.close();
})().catch(e => console.log('ERRO:', e.message));
