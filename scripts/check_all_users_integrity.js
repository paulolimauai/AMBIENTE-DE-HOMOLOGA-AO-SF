const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function checkIntegrity() {
  const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
  console.log('=== AUDITORIA COMPLETA DE TODOS OS CLIENTES NO SQL SERVER ===');

  const usersRes = await pool.request().query('SELECT id, name, email, role, active, created_at, last_login, cpf, phone, birth_date, device_type FROM usuarios ORDER BY id ASC');
  const users = usersRes.recordset;
  console.log(`Total de usuários na tabela usuarios: ${users.length}\n`);

  for (const u of users) {
    const email = (u.email || '').toLowerCase().trim();
    const finRes = await pool.request().query(`SELECT id, updated_at, LEN(dados) as len_dados FROM dados_financeiros WHERE LOWER(email) = LOWER('${email}')`);
    const accRes = await pool.request().query(`SELECT COUNT(*) as cnt FROM contas_bancarias WHERE LOWER(user_email) = LOWER('${email}')`);
    const catRes = await pool.request().query(`SELECT COUNT(*) as cnt FROM categorias WHERE LOWER(user_email) = LOWER('${email}')`);
    const txRes = await pool.request().query(`SELECT COUNT(*) as cnt FROM transacoes WHERE LOWER(user_email) = LOWER('${email}')`);

    const hasFin = finRes.recordset.length > 0;
    const accCount = accRes.recordset[0].cnt;
    const catCount = catRes.recordset[0].cnt;
    const txCount = txRes.recordset[0].cnt;

    console.log(`User #${u.id} - ${u.name} (${email}):`);
    console.log(`  Dispositivo: ${u.device_type || 'Não informado'} | CPF: ${u.cpf || 'Nenhum'} | Celular: ${u.phone || 'Nenhum'}`);
    console.log(`  dados_financeiros: ${hasFin ? 'SIM (Bytes: ' + finRes.recordset[0].len_dados + ')' : 'NÃO'}`);
    console.log(`  contas_bancarias: ${accCount} conta(s)`);
    console.log(`  categorias: ${catCount} categoria(s)`);
    console.log(`  transacoes: ${txCount} transação(ões)`);
    console.log('----------------------------------------------------');
  }

  await pool.close();
}

checkIntegrity().catch(console.error);
