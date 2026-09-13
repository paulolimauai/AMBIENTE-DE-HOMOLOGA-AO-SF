const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function test() {
  try {
    const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
    console.log('=== CONEXÃO BEM-SUCEDIDA COM O MICROSOFT SQL SERVER ===');
    
    const tablesRes = await pool.request().query("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'");
    console.log('\nTabelas encontradas:');
    for (const t of tablesRes.recordset) {
      const cntRes = await pool.request().query(`SELECT COUNT(*) as total FROM [${t.TABLE_NAME}]`);
      console.log(` - ${t.TABLE_NAME}: ${cntRes.recordset[0].total} registros`);
    }

    console.log('\n--- Usuários Cadastrados ---');
    const usersRes = await pool.request().query('SELECT id, name, email, role, active, created_at, last_login, cpf, phone, device_type FROM usuarios ORDER BY id ASC');
    console.table(usersRes.recordset);

    console.log('\n--- Resumo de Dados Financeiros por Usuário ---');
    const finSummary = await pool.request().query('SELECT email, updated_at, LEN(dados) as bytes_length FROM dados_financeiros');
    console.table(finSummary.recordset);

    await pool.close();
    return;


    console.log('\n--- Dados Financeiros ---');
    const finRes = await pool.request().query('SELECT id, email, updated_at FROM dados_financeiros');
    console.table(finRes.recordset);

    console.log('\n--- Transações ---');
    const txRes = await pool.request().query('SELECT TOP 10 id, user_email, tx_id, descricao, valor, data_transacao, categoria, tipo, conta, status FROM transacoes ORDER BY id DESC');
    console.table(txRes.recordset);

    console.log('\n--- Contas Bancárias ---');
    const accRes = await pool.request().query('SELECT id, user_email, account_id, nome, tipo, saldo, cor FROM contas_bancarias');
    console.table(accRes.recordset);

    console.log('\n--- Categorias ---');
    const catRes = await pool.request().query('SELECT id, user_email, nome, tipo, icone, cor FROM categorias');
    console.table(catRes.recordset);

    console.log('\n--- Ordens de Serviço ---');
    const osRes = await pool.request().query('SELECT TOP 5 id, protocol, client_name, client_email, status, created_at FROM ordens_servico ORDER BY id DESC');
    console.table(osRes.recordset);

    console.log('\n--- Técnicos de Suporte ---');
    const tecRes = await pool.request().query('SELECT id, name, email, phone, specialty, active FROM tecnicos_suporte');
    console.table(tecRes.recordset);

    console.log('\n--- CPF Registry ---');
    const cpfRes = await pool.request().query('SELECT TOP 5 id, cpf, nome, data_nascimento, situacao, origem FROM cpf_registry');
    console.table(cpfRes.recordset);

    await pool.close();
  } catch (err) {
    console.error('Erro na verificação do banco:', err);
  }
}

test();
