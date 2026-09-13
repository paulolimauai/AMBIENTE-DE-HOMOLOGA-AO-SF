const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function testUnicode() {
  const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
  const req = pool.request();
  req.input('testStr', mssql.NVarChar, 'Alimentação 🍔');
  const res = await req.query("SELECT @testStr as result");
  console.log('Resultado NVarChar:', res.recordset[0].result);
  await pool.close();
}

testUnicode().catch(console.error);
