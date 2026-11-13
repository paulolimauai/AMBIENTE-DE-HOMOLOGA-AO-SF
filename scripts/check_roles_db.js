const mssql = require('mssql/msnodesqlv8');
(async () => {
  const p = await new mssql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;' }).connect();
  const r = await p.request().query("SELECT id,email,role,active,must_change_password FROM usuarios ORDER BY id");
  r.recordset.forEach(u => console.log(u.id, '|', u.email, '| role=' + u.role, '| active=' + u.active, '| must_change=' + u.must_change_password));
  await p.close();
})().catch(e => console.log('ERR', e.message));
