const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function testAll() {
  console.log('================================================================');
  console.log('🔬 DIAGNÓSTICO E AUDITORIA COMPLETA DE CADASTROS NO SQL SERVER');
  console.log('================================================================\n');

  // 1. Testa a conexão direta com o SQL Server
  let pool;
  try {
    pool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
    console.log('✅ 1. CONEXÃO COM O SQL SERVER: Estabelecida com sucesso.');
  } catch (err) {
    console.error('❌ Falha ao conectar no SQL Server:', err.message);
    return;
  }

  // 2. Testa a API em execução na porta 3000
  try {
    const healthRes = await fetch('http://localhost:3000/api/health');
    const health = await healthRes.json();
    console.log('✅ 2. CONEXÃO COM O SERVIDOR HTTP (PORTA 3000): Ativa e saudável.');
    console.log(`   - Status do banco na API: ${health.database}`);
    console.log(`   - Nome do banco na API: ${health.database_name}`);
    console.log(`   - Total de usuários ativos: ${health.active_users_count}`);
  } catch (err) {
    console.error('❌ Servidor HTTP não está respondendo:', err.message);
  }

  // 3. TESTE DE CADASTRO DE USUÁRIO: Dispositivo Celular (Equipamento Mobile) via Rede 5G (Internet Móvel)
  console.log('\n--- 3. TESTANDO CADASTRO DE USUÁRIO VIA INTERNET MÓVEL (EQUIPAMENTO CELULAR) ---');
  const mobileEmail = 'cliente.celular5g@teste.com';
  
  // Limpa teste anterior se existir
  await pool.request().query(`DELETE FROM system_logs WHERE LOWER(user_email) = LOWER('${mobileEmail}')`);
  await pool.request().query(`DELETE FROM transacoes WHERE LOWER(user_email) = LOWER('${mobileEmail}')`);
  await pool.request().query(`DELETE FROM contas_bancarias WHERE LOWER(user_email) = LOWER('${mobileEmail}')`);
  await pool.request().query(`DELETE FROM categorias WHERE LOWER(user_email) = LOWER('${mobileEmail}')`);
  await pool.request().query(`DELETE FROM dados_financeiros WHERE LOWER(email) = LOWER('${mobileEmail}')`);
  await pool.request().query(`DELETE FROM usuarios WHERE LOWER(email) = LOWER('${mobileEmail}')`);

  const regMobileRes = await fetch('http://localhost:3000/api/register', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
      'X-Forwarded-For': '177.100.20.5' // IP de internet externa / celular
    },
    body: JSON.stringify({
      name: 'Cliente Celular iPhone',
      email: mobileEmail,
      password: 'senhaSegura123',
      cpf: '04023326199',
      birth_date: '10/10/1990',
      phone: '62988880001',
      device_type: 'Mobile'
    })
  });
  const regMobileData = await regMobileRes.json();
  console.log('   Resposta da API /api/register (Mobile):', regMobileData.success ? '✅ SUCESSO' : '❌ ERRO: ' + regMobileData.error);

  // Consulta no SQL Server
  const checkMobileSql = await pool.request().query(`
    SELECT id, name, email, role, device_type, last_ip, created_at 
    FROM usuarios 
    WHERE LOWER(email) = LOWER('${mobileEmail}')
  `);
  console.log('   Registro gravado no SQL Server (Tabela usuarios):');
  console.table(checkMobileSql.recordset);

  // 4. TESTE DE CADASTRO FINANCEIRO: Despesa de INTERNET e Compra de EQUIPAMENTO
  console.log('\n--- 4. TESTANDO CADASTRO DE DESPESA DE INTERNET E EQUIPAMENTO NAS TRANSAÇÕES ---');
  const txPayload = {
    email: mobileEmail,
    data: {
      accounts: [
        { id: 1, name: 'Conta Corrente', type: 'Conta Corrente', balance: 5000, color: '#4a90e2' }
      ],
      categories: [
        { id: 1, name: 'Internet Fibra', type: 'despesa', icon: '📶', color: '#6b7fd7' },
        { id: 2, name: 'Equipamentos', type: 'despesa', icon: '💻', color: '#4a90e2' }
      ],
      transactions: [
        {
          id: 1,
          desc: 'Mensalidade Internet Fibra 500 Mega',
          val: 129.90,
          date: '2026-09-16',
          cat: 'Internet Fibra',
          type: 'out',
          acc: 'Conta Corrente',
          status: 'Efetivado'
        },
        {
          id: 2,
          desc: 'Compra Equipamento Notebook Dell',
          val: 3450.00,
          date: '2026-09-16',
          cat: 'Equipamentos',
          type: 'out',
          acc: 'Conta Corrente',
          status: 'Efetivado'
        }
      ]
    }
  };

  const dataRes = await fetch('http://localhost:3000/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(txPayload)
  });
  const dataJson = await dataRes.json();
  console.log('   Resposta da API /api/data:', dataJson.success ? '✅ SUCESSO' : '❌ ERRO');

  // Consulta transações no SQL Server
  const checkTxSql = await pool.request().query(`
    SELECT id, user_email, tx_id, descricao, valor, categoria, tipo, conta, status, data_transacao
    FROM transacoes 
    WHERE LOWER(user_email) = LOWER('${mobileEmail}')
  `);
  console.log('   Transações gravadas no SQL Server (Tabela transacoes):');
  console.table(checkTxSql.recordset);

  // Consulta dados_financeiros no SQL Server
  const checkFinSql = await pool.request().query(`
    SELECT id, email, LEN(dados) as bytes_json, updated_at
    FROM dados_financeiros 
    WHERE LOWER(email) = LOWER('${mobileEmail}')
  `);
  console.log('   JSON completo gravado no SQL Server (Tabela dados_financeiros):');
  console.table(checkFinSql.recordset);

  // 5. TESTE DE ORDEM DE SERVIÇO (O.S.) DE INTERNET / EQUIPAMENTO
  console.log('\n--- 5. TESTANDO CADASTRO DE ORDEM DE SERVIÇO (EQUIPAMENTO / INTERNET) ---');
  const osPayload = {
    client_name: 'Cliente Celular iPhone',
    client_email: mobileEmail,
    client_phone: '62988880001',
    client_cpf: '04023326199',
    service_type: 'Instalação / Configuração de Equipamento',
    priority: 'Alta',
    title: 'Configuração de Roteador e Equipamento Wi-Fi',
    description: 'Solicito a configuração do equipamento de roteador e teste do link de internet fibra.',
    canal_atendimento: 'App Mobile'
  };

  const osRes = await fetch('http://localhost:3000/api/ordens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(osPayload)
  });
  const osJson = await osRes.json();
  console.log('   Resposta da API /api/ordens:', osJson.success ? '✅ SUCESSO' : '❌ ERRO: ' + osJson.message);

  // Consulta ordens_servico no SQL Server
  const checkOsSql = await pool.request().query(`
    SELECT TOP 5 id, protocol, client_name, client_email, service_type, title, status, canal_atendimento, created_at
    FROM ordens_servico
    WHERE LOWER(client_email) = LOWER('${mobileEmail}')
  `);
  console.log('   Ordem de Serviço gravada no SQL Server (Tabela ordens_servico):');
  console.table(checkOsSql.recordset);

  // 6. TESTE DE LOGS DE AUDITORIA NO BANCO
  console.log('\n--- 6. CONFERÊNCIA DE LOGS DE AUDITORIA NO SQL SERVER ---');
  const checkLogSql = await pool.request().query(`
    SELECT TOP 5 id, timestamp, user_name, user_email, action, entity, details
    FROM system_logs
    WHERE LOWER(user_email) = LOWER('${mobileEmail}')
    ORDER BY id DESC
  `);
  console.log('   Logs de auditoria gravados no SQL Server (Tabela system_logs):');
  console.table(checkLogSql.recordset);

  await pool.close();
  console.log('\n================================================================');
  console.log('🏁 TESTES E AUDITORIA CONCLUÍDOS!');
  console.log('================================================================');
}

testAll().catch(console.error);
