const mssql = require('mssql/msnodesqlv8');
const connStr = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

class MssqlAdapter {
  constructor(pool) {
    this.pool = pool;
    this.isMssql = true;
  }

  async query(text, params = []) {
    let queryText = text;
    const request = this.pool.request();
    if (Array.isArray(params) && params.length > 0) {
      params.forEach((val, idx) => {
        const paramName = `arg${idx + 1}`;
        let sanitizedVal = val;
        if (sanitizedVal !== null && typeof sanitizedVal === 'object' && !(sanitizedVal instanceof Date)) {
          sanitizedVal = JSON.stringify(sanitizedVal);
        }
        if (typeof sanitizedVal === 'boolean') {
          sanitizedVal = sanitizedVal ? 1 : 0;
        }
        if (typeof sanitizedVal === 'string' && mssql && mssql.NVarChar) {
          request.input(paramName, mssql.NVarChar, sanitizedVal);
        } else {
          request.input(paramName, sanitizedVal);
        }
      });
      queryText = queryText.replace(/\$([0-9]+)/g, '@arg$1');
    }

    console.log('TRANSFORMED QUERY:\n', queryText);
    try {
      const res = await request.query(queryText);
      return res;
    } catch (err) {
      console.error('ERRO EXECUTANDO QUERY:', err);
      throw err;
    }
  }
}

async function run() {
  const rawPool = await new mssql.ConnectionPool({ connectionString: connStr }).connect();
  const adapter = new MssqlAdapter(rawPool);

  const cleanEmail = 'cliente.celular5g@teste.com';
  const txId = 1;
  const desc = 'Mensalidade Internet Fibra 500 Mega';
  const dateVal = '2026-09-16';
  const val = 129.90;
  const cat = 'Internet Fibra';
  const tipo = 'Despesa';
  const conta = 'Conta Corrente';
  const status = 'Efetivado';

  try {
    await adapter.query(`
      IF EXISTS (SELECT 1 FROM transacoes WHERE LOWER(user_email) = LOWER($1) AND ((tx_id IS NOT NULL AND tx_id = $2) OR (descricao = $3 AND data_transacao = $4 AND valor = $5)))
      BEGIN
        UPDATE transacoes SET
          tx_id = COALESCE($2, tx_id),
          descricao = $3,
          valor = $5,
          data_transacao = $4,
          categoria = $6,
          tipo = $7,
          conta = $8,
          status = $9,
          updated_at = GETDATE()
        WHERE LOWER(user_email) = LOWER($1) AND ((tx_id IS NOT NULL AND tx_id = $2) OR (descricao = $3 AND data_transacao = $4 AND valor = $5));
      END
      ELSE
      BEGIN
        INSERT INTO transacoes (user_email, tx_id, descricao, valor, data_transacao, categoria, tipo, conta, status, created_at, updated_at)
        VALUES ($1, $2, $3, $5, $4, $6, $7, $8, $9, GETDATE(), GETDATE());
      END
    `, [cleanEmail, txId, desc, dateVal, val, cat, tipo, conta, status]);
    console.log('✅ Query executada com sucesso!');
  } catch (e) {
    console.error('Falhou:', e.message);
  }

  await rawPool.close();
}

run().catch(console.error);
