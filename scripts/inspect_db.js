const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function inspect() {
  try {
    const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
    console.log('✅ CONECTADO AO SQL SERVER');

    const tables = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
    console.log('\n--- TABELAS E TOTAL DE REGISTROS ---');
    for (const t of tables.recordset) {
      const count = await pool.request().query(`SELECT COUNT(*) as c FROM [${t.TABLE_NAME}]`);
      console.log(` - ${t.TABLE_NAME}: ${count.recordset[0].c} linhas`);
    }

    console.log('\n--- COLUNAS DA TABELA usuarios ---');
    const userCols = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'usuarios'");
    console.table(userCols.recordset);

    console.log('\n--- ULTIMOS USUARIOS CADASTRADOS ---');
    const users = await pool.request().query("SELECT TOP 10 id, name, email, role, active, created_at, last_login, cpf, phone, device_type, last_ip FROM usuarios ORDER BY id DESC");
    console.table(users.recordset);

    console.log('\n--- TRANSACOES COM INTERNET / EQUIPAMENTO ---');
    const tx = await pool.request().query("SELECT TOP 20 id, user_email, descricao, valor, categoria, conta, status, data_transacao FROM transacoes WHERE LOWER(descricao) LIKE '%internet%' OR LOWER(descricao) LIKE '%equipamento%' OR LOWER(categoria) LIKE '%internet%' OR LOWER(categoria) LIKE '%equipamento%'");
    console.table(tx.recordset);

    console.log('\n--- ORDENS DE SERVICO ---');
    const osCols = await pool.request().query("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ordens_servico'");
    console.table(osCols.recordset);
    const os = await pool.request().query("SELECT TOP 10 * FROM ordens_servico");
    console.table(os.recordset);

    await pool.close();
  } catch (err) {
    console.error('❌ ERRO:', err);
  }
}

inspect();
