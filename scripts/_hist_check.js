const m = require('mssql/msnodesqlv8');
const c = 'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=AMBIENTE DE HOMOLOGAÇAO SF;Trusted_Connection=yes;TrustServerCertificate=yes;';

async function q(p, sql) {
  const r = await p.request().query(sql);
  return r.recordset;
}

(async () => {
  const p = await new m.ConnectionPool({ connectionString: c }).connect();
  console.log('=== HISTÓRICO DE GRAVAÇÃO NO BANCO (SQL Server) ===\n');

  // system_logs
  const logCols = await q(p, "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='system_logs' ORDER BY ORDINAL_POSITION");
  console.log('COLUNAS system_logs:', logCols.map(r => r.COLUMN_NAME).join(', '));
  const logs = await q(p, 'SELECT TOP 25 * FROM system_logs');
  console.table(logs);

  // timestamps por tabela
  const tables = ['usuarios', 'transacoes', 'dados_financeiros', 'contas_bancarias', 'categorias', 'ordens_servico', 'tecnicos_suporte', 'cpf_registry'];
  for (const t of tables) {
    const cols = await q(p, `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${t}'`);
    const names = cols.map(r => r.COLUMN_NAME.toLowerCase());
    const tsCol = names.find(n => ['updated_at','last_login','created_at','data_transacao'].includes(n));
    if (tsCol) {
      try {
        const rows = await q(p, `SELECT TOP 3 * FROM ${t} ORDER BY ${tsCol} DESC`);
        console.log(`\n--- ${t} (ordem por ${tsCol}) ---`);
        console.table(rows.map(r => {
          const out = { ...r };
          for (const k of Object.keys(out)) {
            if (out[k] instanceof Date) out[k] = out[k].toISOString();
            else if (typeof out[k] === 'string' && out[k].length > 80) out[k] = out[k].slice(0, 77) + '...';
          }
          return out;
        }));
      } catch (e) { console.log(`\n--- ${t}: erro ${e.message}`); }
    } else {
      console.log(`\n--- ${t}: sem coluna de timestamp (cols: ${names.join(', ')})`);
    }
  }

  await p.close();
})().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
