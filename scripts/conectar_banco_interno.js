// Conexão com o banco de dados interno (Microsoft SQL Server local, localhost)
// Autenticação: Windows (Trusted_Connection) — usuário DESKTOP-PAULOLI\PAULO LIMA
// Uso: node scripts/conectar_banco_interno.js

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DATABASE = process.env.MSSQL_DATABASE || 'AMBIENTE DE HOMOLOGAÇAO SF';
const DRIVER = process.env.MSSQL_DRIVER || 'ODBC Driver 17 for SQL Server';
const SERVER = process.env.MSSQL_SERVER || 'localhost';

function connString(database) {
  return `Driver={${DRIVER}};Server=${SERVER};Database=${database};Trusted_Connection=yes;TrustServerCertificate=yes;`;
}

async function main() {
  let mssql;
  try {
    mssql = require('mssql/msnodesqlv8');
  } catch (e) {
    mssql = require('mssql');
  }

  // 1) Conexão no banco "master" para listar os bancos disponíveis no servidor
  const masterPool = await new mssql.ConnectionPool({ connectionString: connString('master'), connectionTimeout: 5000, requestTimeout: 10000 }).connect();
  console.log('=== CONEXÃO ESTABELECIDA COM O SQL SERVER INTERNO ===');
  console.log(`Servidor : ${SERVER}`);
  console.log(`Driver   : ${DRIVER}`);
  console.log(`Auth     : Windows (Trusted_Connection) — usuário atual do Windows`);

  const dbs = await masterPool.request().query('SELECT name FROM sys.databases ORDER BY name');
  console.log('\n--- Bancos de dados no servidor ---');
  for (const d of dbs.recordset) console.log(` - ${d.name}`);
  await masterPool.close();

  // 2) Conexão no banco do sistema
  const pool = await new mssql.ConnectionPool({ connectionString: connString(DATABASE), connectionTimeout: 5000, requestTimeout: 10000 }).connect();
  console.log(`\n=== BANCO DO SISTEMA: ${DATABASE} ===`);

  const tables = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME");
  console.log('\n--- Tabelas ---');
  for (const t of tables.recordset) {
    const cnt = await pool.request().query(`SELECT COUNT(*) AS total FROM [${t.TABLE_NAME}]`);
    console.log(` - ${t.TABLE_NAME}: ${cnt.recordset[0].total} registros`);
  }

  await pool.close();
  console.log('\nConexão encerrada com sucesso.');
}

main().catch((err) => {
  console.error('ERRO ao conectar ao banco interno:', err.message);
  process.exit(1);
});
