const mssql = require('mssql/msnodesqlv8');
const crypto = require('crypto');
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}
(async () => {
  const p = await new mssql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;' }).connect();
  const cols = await p.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='usuarios' ORDER BY ORDINAL_POSITION");
  console.log('COLUNAS:', cols.recordset.map(c=>c.COLUMN_NAME).join(', '));
  const del = await p.request().query("DELETE FROM usuarios WHERE email='devin.teste@nexus.local'");
  const r = await p.request().query(`INSERT INTO usuarios (name,email,password,role,active,must_change_password,created_at) VALUES ('Devin Teste','devin.teste@nexus.local','${hashPassword('Teste@12345')}','Administrador',1,0,GETDATE()); SELECT @@ROWCOUNT AS n`);
  console.log('insert:', JSON.stringify(r.recordset));
  await p.close();
})().catch(e => console.log('ERR', e.message));
