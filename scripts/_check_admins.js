const mssql = require('mssql/msnodesqlv8');
(async () => {
  const p = await new mssql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;' }).connect();
  const r = await p.request().query("SELECT COUNT(*) AS total FROM usuarios");
  console.log('total usuarios:', JSON.stringify(r.recordset));
  const r2 = await p.request().query("SELECT TOP 15 id,name,email,role,active FROM usuarios ORDER BY id");
  console.log(JSON.stringify(r2.recordset, null, 1));
  await p.close();
})().catch(e => console.log('ERR', e.message));
