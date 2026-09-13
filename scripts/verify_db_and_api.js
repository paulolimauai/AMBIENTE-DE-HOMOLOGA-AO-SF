const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

const SYSTEM_BASE_CATEGORIES = [
  { name: 'Alimentação', color: '#e8974b', type: 'despesa', icon: '🍔' },
  { name: 'Supermercado', color: '#d8a34b', type: 'despesa', icon: '🛒' },
  { name: 'Moradia', color: '#c98a3f', type: 'despesa', icon: '🏠' },
  { name: 'Contas da Casa', color: '#f0a63a', type: 'despesa', icon: '💡' },
  { name: 'Transporte', color: '#ef5a5a', type: 'despesa', icon: '🚗' },
  { name: 'Saúde', color: '#5ac57e', type: 'despesa', icon: '⚕️' },
  { name: 'Educação', color: '#4a90e2', type: 'despesa', icon: '📚' },
  { name: 'Lazer', color: '#9b6bd8', type: 'despesa', icon: '🎮' },
  { name: 'Vestuário', color: '#d85bb0', type: 'despesa', icon: '👕' },
  { name: 'Assinaturas', color: '#6b7fd7', type: 'despesa', icon: '📺' },
  { name: 'Cartão de Crédito', color: '#e8b04b', type: 'despesa', icon: '💳' },
  { name: 'Pix Enviado', color: '#f0a63a', type: 'despesa', icon: '📤' },
  { name: 'Cuidados Pessoais', color: '#e07bb0', type: 'despesa', icon: '💆' },
  { name: 'Outros', color: '#8a93a3', type: 'despesa', icon: '📦' },
  { name: 'Salário', color: '#e8b04b', type: 'receita', icon: '💼' },
  { name: 'Freelance', color: '#4a90e2', type: 'receita', icon: '💻' },
  { name: 'Investimentos', color: '#5ac57e', type: 'receita', icon: '📈' },
  { name: 'Pix Recebido', color: '#3ec7c7', type: 'receita', icon: '📥' },
  { name: 'Reembolso', color: '#6bcf9e', type: 'receita', icon: '💵' },
  { name: 'Bônus / 13º', color: '#d8a34b', type: 'receita', icon: '🎉' },
  { name: 'Outras Receitas', color: '#8a93a3', type: 'receita', icon: '💰' }
];

const SYSTEM_DEFAULT_ACCOUNTS = [
  { id: 1, name: 'Conta Principal', type: 'Conta Corrente', balance: 0, saldo: 0, color: '#4a90e2' }
];

async function runVerification() {
  console.log('===============================================================');
  console.log('🚀 INICIANDO AUDITORIA E TESTES DE INTEGRIDADE DO BANCO DE DADOS');
  console.log('===============================================================');

  const pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
  console.log('✅ Conexão estabelecida com Microsoft SQL Server: AMBIENTE DE HOMOLOGAÇAO SF');

  // 1. Migração de colunas
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')
    BEGIN
      ALTER TABLE usuarios ADD last_ip NVARCHAR(50) NULL;
      PRINT 'Coluna last_ip adicionada com sucesso!';
    END
  `);

  // 2. Auto-configurar todos os usuários existentes
  const allUsersRes = await pool.request().query('SELECT id, name, email, cpf, phone, birth_date, device_type FROM usuarios ORDER BY id ASC');
  console.log(`\n📋 Usuários cadastrados encontrados: ${allUsersRes.recordset.length}`);

  for (const u of allUsersRes.recordset) {
    const email = (u.email || '').toLowerCase().trim();
    const accCnt = await pool.request().query(`SELECT COUNT(*) as cnt FROM contas_bancarias WHERE LOWER(user_email) = LOWER('${email}')`);
    const catCnt = await pool.request().query(`SELECT COUNT(*) as cnt FROM categorias WHERE LOWER(user_email) = LOWER('${email}')`);

    if (accCnt.recordset[0].cnt === 0) {
      for (const a of SYSTEM_DEFAULT_ACCOUNTS) {
        const req = pool.request();
        req.input('em', mssql.NVarChar, email);
        req.input('aid', a.id);
        req.input('nm', mssql.NVarChar, a.name);
        req.input('tp', mssql.NVarChar, a.type);
        req.input('sl', a.balance || 0);
        req.input('cr', mssql.NVarChar, a.color);
        await req.query(`
          INSERT INTO contas_bancarias (user_email, account_id, nome, tipo, saldo, cor, created_at, updated_at)
          VALUES (@em, @aid, @nm, @tp, @sl, @cr, GETDATE(), GETDATE())
        `);
      }
      console.log(`  ➕ [CONFIGURADO] Conta bancária padrão gerada para ${u.name} (${email})`);
    }

    if (catCnt.recordset[0].cnt === 0) {
      for (const c of SYSTEM_BASE_CATEGORIES) {
        const req = pool.request();
        req.input('em', mssql.NVarChar, email);
        req.input('nm', mssql.NVarChar, c.name);
        req.input('tp', mssql.NVarChar, c.type);
        req.input('ic', mssql.NVarChar, c.icon);
        req.input('cr', mssql.NVarChar, c.color);
        await req.query(`
          INSERT INTO categorias (user_email, nome, tipo, icone, cor, created_at)
          VALUES (@em, @nm, @tp, @ic, @cr, GETDATE())
        `);
      }
      console.log(`  ➕ [CONFIGURADO] 21 Categorias padrão geradas para ${u.name} (${email})`);
    }
  }

  // 3. Teste de criação de conta de dispositivo móvel e rede externa
  const testEmail = 'cliente.mobile.teste@nexusfinanceiro.com';
  console.log(`\n🧪 Testando simulação de abertura de conta de qualquer aparelho / rede: ${testEmail}...`);

  // Deleta anterior se houver
  await pool.request().query(`DELETE FROM transacoes WHERE LOWER(user_email) = LOWER('${testEmail}')`);
  await pool.request().query(`DELETE FROM contas_bancarias WHERE LOWER(user_email) = LOWER('${testEmail}')`);
  await pool.request().query(`DELETE FROM categorias WHERE LOWER(user_email) = LOWER('${testEmail}')`);
  await pool.request().query(`DELETE FROM dados_financeiros WHERE LOWER(email) = LOWER('${testEmail}')`);
  await pool.request().query(`DELETE FROM usuarios WHERE LOWER(email) = LOWER('${testEmail}')`);

  // Inserção da conta
  const testReq = pool.request();
  testReq.input('nm', mssql.NVarChar, 'Cliente Mobile 5G');
  testReq.input('em', mssql.NVarChar, testEmail);
  testReq.input('pw', mssql.NVarChar, 'scrypt:test_salt:test_key');
  testReq.input('cpf', mssql.NVarChar, '11122233344');
  testReq.input('ph', mssql.NVarChar, '(62) 99887-7665');
  testReq.input('bd', mssql.NVarChar, '15/08/1995');
  testReq.input('dev', mssql.NVarChar, 'Mobile (iPhone 5G)');
  testReq.input('ip', mssql.NVarChar, '187.55.120.44');

  const insRes = await testReq.query(`
    INSERT INTO usuarios (name, email, password, role, active, cpf, phone, birth_date, terms_accepted, device_type, last_ip, created_at)
    OUTPUT INSERTED.id
    VALUES (@nm, @em, @pw, 'Usuário', 1, @cpf, @ph, @bd, 1, @dev, @ip, GETDATE())
  `);
  const createdUserId = insRes.recordset[0].id;
  console.log(`  ✅ Usuário inserido na tabela 'usuarios' com ID #${createdUserId}`);

  // Inserção das contas bancárias
  for (const a of SYSTEM_DEFAULT_ACCOUNTS) {
    const r = pool.request();
    r.input('em', mssql.NVarChar, testEmail);
    r.input('aid', a.id);
    r.input('nm', mssql.NVarChar, a.name);
    r.input('tp', mssql.NVarChar, a.type);
    r.input('sl', a.balance || 0);
    r.input('cr', mssql.NVarChar, a.color);
    await r.query(`
      INSERT INTO contas_bancarias (user_email, account_id, nome, tipo, saldo, cor, created_at, updated_at)
      VALUES (@em, @aid, @nm, @tp, @sl, @cr, GETDATE(), GETDATE())
    `);
  }
  console.log(`  ✅ Conta 'Conta Principal' vinculada na tabela 'contas_bancarias'`);

  // Inserção das categorias
  for (const c of SYSTEM_BASE_CATEGORIES) {
    const r = pool.request();
    r.input('em', mssql.NVarChar, testEmail);
    r.input('nm', mssql.NVarChar, c.name);
    r.input('tp', mssql.NVarChar, c.type);
    r.input('ic', mssql.NVarChar, c.icon);
    r.input('cr', mssql.NVarChar, c.color);
    await r.query(`
      INSERT INTO categorias (user_email, nome, tipo, icone, cor, created_at)
      VALUES (@em, @nm, @tp, @ic, @cr, GETDATE())
    `);
  }
  console.log(`  ✅ 21 Categorias financeiras vinculadas na tabela 'categorias'`);

  // Inserção de dados_financeiros
  const finJson = JSON.stringify({
    categories: SYSTEM_BASE_CATEGORIES.map((c, i) => ({ id: i + 1, ...c })),
    accounts: SYSTEM_DEFAULT_ACCOUNTS,
    transactions: [],
    updated_at: new Date().toISOString()
  });
  const finR = pool.request();
  finR.input('em', mssql.NVarChar, testEmail);
  finR.input('dados', mssql.NVarChar, finJson);
  await finR.query(`
    INSERT INTO dados_financeiros (email, dados, updated_at)
    VALUES (@em, @dados, GETDATE())
  `);
  console.log(`  ✅ Estrutura JSON configurada na tabela 'dados_financeiros'`);

  // Log do sistema
  const logR = pool.request();
  logR.input('em', mssql.NVarChar, testEmail);
  await logR.query(`
    INSERT INTO system_logs (timestamp, user_name, user_email, action, entity, details)
    VALUES (GETDATE(), 'Cliente Mobile 5G', @em, 'Cadastro Financeiro', 'Autenticação', 'Conta criada via Celular (IP: 187.55.120.44)')
  `);
  console.log(`  ✅ Auditoria registrada na tabela 'system_logs'`);

  // 4. Verificação final de todas as tabelas
  console.log('\n===============================================================');
  console.log('📊 CONFERÊNCIA FINAL DAS TABELAS NO SQL SERVER APÓS MIGRACÃO:');
  console.log('===============================================================');

  const tables = ['usuarios', 'contas_bancarias', 'categorias', 'dados_financeiros', 'system_logs', 'cpf_registry', 'transacoes', 'ordens_servico', 'tecnicos_suporte'];
  for (const t of tables) {
    const cnt = await pool.request().query(`SELECT COUNT(*) as total FROM [${t}]`);
    console.log(` • [${t}]: ${cnt.recordset[0].total} registros`);
  }

  const checkTestUser = await pool.request().query(`SELECT id, name, email, role, device_type, last_ip, created_at FROM usuarios WHERE LOWER(email) = LOWER('${testEmail}')`);
  console.log('\nRegistro do novo cliente criado:');
  console.table(checkTestUser.recordset);

  const checkAcc = await pool.request().query(`SELECT id, user_email, nome, tipo, saldo FROM contas_bancarias WHERE LOWER(user_email) = LOWER('${testEmail}')`);
  console.log('Contas bancárias do novo cliente:');
  console.table(checkAcc.recordset);

  const checkCat = await pool.request().query(`SELECT COUNT(*) as total_cat FROM categorias WHERE LOWER(user_email) = LOWER('${testEmail}')`);
  console.log(`Categorias configuradas para o novo cliente: ${checkCat.recordset[0].total_cat} categorias.`);

  await pool.close();
  console.log('\n🎉 AUDITORIA E VERIFICAÇÃO CONCLUÍDAS COM SUCESSO TOTAL!');
}

runVerification().catch(console.error);
