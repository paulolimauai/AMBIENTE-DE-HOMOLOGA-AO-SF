const mssql = require('mssql/msnodesqlv8');
(async () => {
  const p = await new mssql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;' }).connect();
  const r = await p.request().query("DELETE FROM usuarios WHERE email='devin.teste@nexus.local'");
  console.log('removidos:', r.rowsAffected[0]);
  await p.close();
})().catch(e => console.log('ERR', e.message));
