'use strict';

/**
 * Coloca no HISTÓRICO local (backups_financeiros/) os dados financeiros de uma conta tirados de um arquivo antigo (ex.: um snapshot em dist/ ou um
 * local_database_data.backup.json guardado), para que a recuperação automática do servidor os devolva à conta que estiver zerada.
 * Não altera nenhum dado em uso: só acrescenta uma cópia ao histórico. Quem restaura é o servidor (ao subir, em /api/data e a cada 5 minutos),
 * e só quando a conta de destino está sem nenhum lançamento/conta/meta.
 *
 *   node scripts/importar_snapshot_financeiro.js <arquivo.json> <email-de-origem> <email-de-destino>
 */
const fs = require('node:fs');
const path = require('node:path');
const BackupFinanceiro = require('../backup-financeiro');

const [arquivo, origem, destino] = process.argv.slice(2);
if (!arquivo || !origem || !destino) { console.error('uso: node scripts/importar_snapshot_financeiro.js <arquivo.json> <email-de-origem> <email-de-destino>'); process.exit(2); }

const mask = (e) => String(e).replace(/^([^@]{1,3})[^@]*@/, '$1***@');
const todos = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const chave = Object.keys(todos).find((k) => k.toLowerCase().trim() === origem.toLowerCase().trim());
if (!chave) { console.error('a conta ' + mask(origem) + ' não existe em ' + arquivo); process.exit(1); }
const dados = todos[chave];
if (BackupFinanceiro.isBlank(dados)) { console.error('a conta ' + mask(origem) + ' está zerada nesse arquivo: nada a importar'); process.exit(1); }

const dir = path.join(process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '..'), 'backups_financeiros');
const store = BackupFinanceiro.createStore({ dir });
const gravado = store.save(destino, dados, { force: true, motivo: 'importado de ' + path.basename(arquivo) });
const l = (k) => (Array.isArray(dados[k]) ? dados[k].length : 0);
console.log(gravado
  ? 'Importado para ' + mask(destino) + ': ' + l('transactions') + ' lançamento(s), ' + l('accounts') + ' conta(s)/cartão(ões), ' + l('budgets') + ' orçamento(s), ' + l('goals') + ' meta(s) (versão de ' + String(dados.updated_at || '?').slice(0, 10) + ').'
  : 'Já havia uma cópia idêntica no histórico de ' + mask(destino) + ': nada a fazer.');
