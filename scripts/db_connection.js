// ============================================================
// CONEXÃO PRÓPRIA COM O BANCO DE DADOS INTERNO (Microsoft SQL Server)
// ============================================================
// Como usar em qualquer script seu:
//
//   const db = require('./db_connection');
//   const pool = await db.connect();
//   const res = await pool.request().query('SELECT * FROM usuarios');
//   await pool.close();
//
// Ou manualmente:
//   const pool = await db.getPool('AMBIENTE DE HOMOLOGAÇAO SF');
//
// Configuração (variáveis de ambiente ou .env):
//   MSSQL_SERVER    = localhost            (servidor/instância)
//   MSSQL_PORT      = 1433                 (opcional)
//   MSSQL_DATABASE  = AMBIENTE DE HOMOLOGAÇAO SF
//   MSSQL_DRIVER    = ODBC Driver 17 for SQL Server
//   MSSQL_ENCRYPT   = false
//
//   Autenticação Windows (padrão, igual à tela de conexão do SSMS):
//     MSSQL_TRUSTED_CONNECTION=true   (ou não definir usuário/senha)
//
//   Autenticação SQL (usuário e senha):
//     MSSQL_USER=sa
//     MSSQL_PASSWORD=sua_senha
// ============================================================

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DRIVER = process.env.MSSQL_DRIVER || 'ODBC Driver 17 for SQL Server';
const SERVER = process.env.MSSQL_SERVER || 'localhost';
const PORT = process.env.MSSQL_PORT || '';
const ENCRYPT = process.env.MSSQL_ENCRYPT === 'true';
const TRUSTED = process.env.MSSQL_TRUSTED_CONNECTION !== 'false' && !process.env.MSSQL_USER;
const USER = process.env.MSSQL_USER || 'sa';
const PASSWORD = process.env.MSSQL_PASSWORD || '';

function buildConnectionString(database) {
  const db = database || process.env.MSSQL_DATABASE || 'AMBIENTE DE HOMOLOGAÇAO SF';
  const serverPart = PORT ? `${SERVER},${PORT}` : SERVER;
  const authPart = TRUSTED
    ? 'Trusted_Connection=yes'
    : `UID=${USER};PWD=${PASSWORD}`;
  return `Driver={${DRIVER}};Server=${serverPart};Database=${db};${authPart};Encrypt=${ENCRYPT ? 'yes' : 'no'};TrustServerCertificate=yes;`;
}

let mssqlDriver = null;
function getDriver() {
  if (mssqlDriver) return mssqlDriver;
  try {
    mssqlDriver = require('mssql/msnodesqlv8');
  } catch (e) {
    mssqlDriver = require('mssql');
  }
  return mssqlDriver;
}

// Abre uma conexão (pool) com o banco informado.
// Retorna um objeto compatível com mssql.ConnectionPool: pool.request().query(...)
async function connect(database) {
  const mssql = getDriver();
  const connStr = buildConnectionString(database);
  const pool = await new mssql.ConnectionPool({
    connectionString: connStr,
    connectionTimeout: 8000,
    requestTimeout: 30000
  }).connect();
  console.log(`[DB] Conectado: ${SERVER} / ${database || process.env.MSSQL_DATABASE} (${TRUSTED ? 'Windows Auth' : 'SQL Auth: ' + USER})`);
  return pool;
}

module.exports = { connect, buildConnectionString, TRUSTED, SERVER, DRIVER };
