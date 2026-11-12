/**
 * exportar_banco_dados.js
 * Exporta TODOS os registros de TODAS as tabelas do Microsoft SQL Server
 * (banco "AMBIENTE DE HOMOLOGAÇAO SF") para arquivos CSV + JSON dentro de
 * ./analise_banco_dados/ para fins de análise.
 *
 * Uso: node scripts/exportar_banco_dados.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '..', 'analise_banco_dados');
const BATCH_SIZE = 5000; // linhas por query paginada (OFFSET/FETCH)

let mssql;
try {
  mssql = require('mssql/msnodesqlv8');
} catch (e) {
  mssql = require('mssql');
}

// ---------- Conexão (mesma lógica resiliente do server.js) ----------
async function connectDatabase() {
  const dbName = process.env.MSSQL_DATABASE || 'AMBIENTE DE HOMOLOGAÇAO SF';
  const remoteServer = process.env.MSSQL_SERVER || process.env.MSSQL_HOST;

  // 1) SQL Server remoto/túnel via TDS nativo (tedious)
  if (remoteServer && remoteServer !== 'localhost' && remoteServer !== '127.0.0.1') {
    try {
      const tedious = require('mssql');
      const pool = await new tedious.ConnectionPool({
        server: remoteServer,
        port: parseInt(process.env.MSSQL_PORT || '1433'),
        user: process.env.MSSQL_USER || 'sa',
        password: process.env.MSSQL_PASSWORD || '',
        database: dbName,
        connectionTimeout: 8000,
        requestTimeout: 30000,
        options: { encrypt: process.env.MSSQL_ENCRYPT === 'true', trustServerCertificate: true }
      }).connect();
      console.log(`[BANCO] Conectado via TDS remoto: ${remoteServer}/${dbName}`);
      return pool;
    } catch (err) {
      console.warn(`[BANCO] Remoto indisponível (${err.message}); tentando local...`);
    }
  }

  // 2) SQL Server local via ODBC (Trusted Connection)
  const drivers = [
    process.env.MSSQL_DRIVER,
    'ODBC Driver 17 for SQL Server',
    'ODBC Driver 18 for SQL Server',
    'SQL Server'
  ].filter(Boolean);
  const servers = ['localhost', '.', '(local)', process.env.COMPUTERNAME || 'LIMA', '127.0.0.1'];

  for (const driver of drivers) {
    for (const server of servers) {
      try {
        const connStr = `Driver={${driver}};Server=${server};Database=${dbName};Trusted_Connection=yes;TrustServerCertificate=yes;`;
        const pool = await new mssql.ConnectionPool({
          connectionString: connStr,
          connectionTimeout: 6000,
          requestTimeout: 60000
        }).connect();
        console.log(`[BANCO] Conectado via ODBC local: ${driver} @ ${server}/${dbName}`);
        return pool;
      } catch (err) {
        // tenta próximo host/driver
      }
    }
  }
  throw new Error('Não foi possível conectar ao Microsoft SQL Server.');
}

// ---------- Utilitários ----------
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  let s;
  if (value instanceof Date) {
    s = value.toISOString();
  } else if (Buffer.isBuffer(value)) {
    s = value.toString('base64');
  } else if (typeof value === 'object') {
    s = JSON.stringify(value);
  } else {
    s = String(value);
  }
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function rowsToCsv(rows, columns) {
  const header = columns.map(c => csvEscape(c.name)).join(',');
  const lines = [header];
  for (const row of rows) {
    lines.push(columns.map(c => csvEscape(row[c.name])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

function valueToJson(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { __buffer_base64: value.toString('base64') };
  return value;
}

// ---------- Exportação ----------
async function listTables(pool) {
  const result = await pool.request().query(`
    SELECT s.name AS schema_name, t.name AS table_name
    FROM sys.tables t
    JOIN sys.schemas s ON s.schema_id = t.schema_id
    WHERE t.is_ms_shipped = 0
    ORDER BY s.name, t.name
  `);
  const rows = result.recordsets[0] || result.recordset || [];
  return rows;
}

async function exportTable(pool, schema, table, outDir) {
  const safe = `[${schema.replace(/]/g, ']]')}].[${table.replace(/]/g, ']]')}]`;
  const baseName = `${schema}__${table}`.replace(/[^\w\-.]+/g, '_');
  const csvPath = path.join(outDir, `${baseName}.csv`);
  const jsonPath = path.join(outDir, `${baseName}.json`);

  // Colunas (para header CSV mesmo em tabelas vazias)
  const colRes = await pool.request()
    .input('schema', mssql.NVarChar, schema)
    .input('table', mssql.NVarChar, table)
    .query(`
      SELECT COLUMN_NAME AS name
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `);
  const columns = (colRes.recordsets[0] || []).map(c => ({ name: c.name }));

  // Paginação por linha para não estourar memória
  let offset = 0;
  let total = 0;
  const jsonArray = [];
  const fd = fs.openSync(csvPath, 'w');
  try {
    fs.writeSync(fd, columns.map(c => csvEscape(c.name)).join(',') + '\r\n');
    while (true) {
      const res = await pool.request()
        .input('off', mssql.Int, offset)
        .input('fetch', mssql.Int, BATCH_SIZE)
        .query(`SELECT * FROM ${safe} ORDER BY (SELECT NULL) OFFSET @off ROWS FETCH NEXT @fetch ROWS ONLY`);
      const rows = res.recordsets[0] || res.recordset || [];
      if (rows.length === 0) break;

      total += rows.length;
      const chunk = rows.map(r => Object.keys(r).map(k => csvEscape(r[k])).join(','));
      fs.writeSync(fd, chunk.join('\r\n') + '\r\n');

      for (const r of rows) {
        const obj = {};
        for (const k of Object.keys(r)) obj[k] = valueToJson(r[k]);
        jsonArray.push(obj);
      }

      process.stdout.write(`\r  ${schema}.${table}: ${total} linhas...`);
      if (rows.length < BATCH_SIZE) break;
      offset += BATCH_SIZE;
    }
  } finally {
    fs.closeSync(fd);
  }

  fs.writeFileSync(jsonPath, JSON.stringify(jsonArray, null, 0), 'utf8');
  return total;
}

// ---------- Main ----------
(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const pool = await connectDatabase();

  const tables = await listTables(pool);
  console.log(`\n[EXPORT] ${tables.length} tabelas encontradas. Destino: ${OUTPUT_DIR}\n`);

  const manifest = [];
  const errors = [];

  for (const t of tables) {
    const schema = t.schema_name || t[Object.keys(t)[0]];
    const table = t.table_name || t[Object.keys(t)[1]];
    process.stdout.write(`\n[EXPORT] ${schema}.${table} ...`);
    try {
      const n = await exportTable(pool, schema, table, OUTPUT_DIR);
      manifest.push({ schema, table, registros: n });
      console.log(` OK (${n} registros)`);
    } catch (err) {
      console.log(` ERRO: ${err.message}`);
      errors.push({ schema, table, erro: err.message });
      manifest.push({ schema, table, registros: null, erro: err.message });
    }
  }

  fs.writeFileSync(
    path.join(OUTPUT_DIR, '_manifest.json'),
    JSON.stringify({ gerado_em: new Date().toISOString(), banco: process.env.MSSQL_DATABASE || 'AMBIENTE DE HOMOLOGAÇAO SF', total_tabelas: tables.length, tabelas: manifest, erros: errors }, null, 2),
    'utf8'
  );

  // Relatório resumido CSV
  const resumo = [['schema', 'tabela', 'registros']]
    .concat(manifest.map(m => [m.schema, m.table, m.registros === null ? 'ERRO' : m.registros]));
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '_resumo_registros.csv'),
    resumo.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n',
    'utf8'
  );

  await pool.close();
  console.log(`\n[EXPORT] Concluído. ${manifest.filter(m => m.registros !== null).length}/${tables.length} tabelas exportadas em ${OUTPUT_DIR}`);
  if (errors.length) console.log(`[EXPORT] ${errors.length} tabela(s) com erro — ver _manifest.json`);
  process.exit(0);
})().catch(err => {
  console.error('[EXPORT] Falha fatal:', err);
  process.exit(1);
});
