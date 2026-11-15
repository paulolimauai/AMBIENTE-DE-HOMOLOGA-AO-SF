const mssql = require('mssql/msnodesqlv8');
const crypto = require('crypto');
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt}:${derivedKey.toString('hex')}`;
}
(async () => {
  const p = await new mssql.ConnectionPool({ connectionString: 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;' }).connect();
  await p.request().query("DELETE FROM usuarios WHERE email='devin.teste@nexus.local'");
  await p.request().query(`INSERT INTO usuarios (name,email,password,role,active,must_change_password,created_at) VALUES ('Devin Teste','devin.teste@nexus.local','${hashPassword('Teste@12345')}','Administrador',1,0,GETDATE())`);
  console.log('admin teste recriado');
  await p.close();
})().catch(e => console.log('ERR', e.message));
