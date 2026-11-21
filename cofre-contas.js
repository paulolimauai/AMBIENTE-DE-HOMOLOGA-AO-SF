'use strict';
// ============================================================================
// Cofre de contas: a última versão de TODA conta (e-mail, hash da senha, perfil, carimbos) fica guardada em um arquivo próprio que
// nenhuma sincronização, reinício ou reset de banco apaga. Só a EXCLUSÃO DE PROPÓSITO (lápide) tira uma conta de circulação.
//
// Por quê (21/11/2026): "cadastro a senha certinho e quando volto diz que o usuário não possui conta criada". O cadastro do site vive num arquivo
// (local_users.json) que pode vir vazio (disco novo no redeploy, espelho zerado por um banco recém-criado, sincronização que devolve uma lista
// menor). Sem a conta no arquivo o login e a recuperação respondem "não possui conta criada" mesmo com a senha certa.
//
// O que este módulo garante (a ligação com o servidor está em server.js: saveLocalUsers, removeLocalUser, login, recuperação, subida):
//   1. registrar(lista)   a cada gravação da lista de contas, guarda a versão mais nova de cada uma (nunca troca uma senha válida por vazia).
//   2. faltantes(...)     contas do cofre que sumiram da lista e NÃO têm lápide: voltam sozinhas (subida do servidor, login, recuperação).
//   3. excluir(email)     exclusão de propósito: sai de circulação, mas a última versão fica em "excluidas" (recuperável à mão).
//   4. datasSanas(...)    data impossível (futura) em created_at/last_login nunca é gravada: usa a anterior (ver a deriva de +3 h do espelho).
// Nunca lança: o cofre é uma rede de proteção e não pode derrubar o servidor.
// ============================================================================
const fs = require('fs');
const path = require('path');

const ARQUIVO = 'cofre_contas.json';
const ARQUIVO_ANTERIOR = 'cofre_contas.anterior.json';
const PASTA_DIARIA = 'backups_contas';
const DIAS_GUARDADOS = 30;
const VERSAO = 1;
const FOLGA_FUTURO_MS = 36 * 60 * 60 * 1000;   // relógios e fusos erram por horas; mais de 36 h à frente de agora não é data real
const CAMPOS_DATA_SANEADOS = ['created_at', 'last_login'];

const lower = (v) => String(v === undefined || v === null ? '' : v).toLowerCase().trim();
const temSenhaValida = (u) => typeof (u && u.password) === 'string' && u.password.startsWith('scrypt:');
const copia = (o) => JSON.parse(JSON.stringify(o));

// Estável: a ordem dos campos não conta (evita regravar o arquivo à toa)
function estavel(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(estavel).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + estavel(v[k])).join(',') + '}';
}

/** Data (texto/Date) no futuro além da folga, ou antes de 2000, não é data real. Vazio/ilegível => false (quem decide é o chamador). */
function dataImpossivel(valor, agoraMs) {
  if (valor === null || valor === undefined || valor === '') return false;
  const ms = valor instanceof Date ? valor.getTime() : Date.parse(String(valor));
  if (!Number.isFinite(ms)) return false;
  return ms > (agoraMs === undefined ? Date.now() : agoraMs) + FOLGA_FUTURO_MS || ms < Date.UTC(2000, 0, 1);
}

/**
 * Devolve uma CÓPIA do cadastro sem datas impossíveis: created_at/last_login "do futuro" (efeito da deriva de fuso do espelho) são trocados pelo valor
 * anterior da mesma conta quando ele é real; sem anterior real, last_login vira null e created_at cai para trial_started_at (se real) ou fica como está.
 */
function datasSanas(registro, anterior, agoraMs) {
  if (!registro || typeof registro !== 'object') return registro;
  let out = registro;
  for (const campo of CAMPOS_DATA_SANEADOS) {
    if (!dataImpossivel(registro[campo], agoraMs)) continue;
    if (out === registro) out = Object.assign({}, registro);
    if (anterior && anterior[campo] && !dataImpossivel(anterior[campo], agoraMs)) out[campo] = anterior[campo];
    else if (campo === 'last_login') out[campo] = null;
    else if (registro.trial_started_at && !dataImpossivel(registro.trial_started_at, agoraMs)) out[campo] = registro.trial_started_at;
  }
  return out;
}

function criarCofre(opcoes) {
  const dir = opcoes && opcoes.dir;
  const agora = (opcoes && opcoes.agora) || (() => new Date());
  const log = (opcoes && opcoes.log) || console;
  const caminho = () => path.join(dir, ARQUIVO);
  let memoria = null;   // { versao, contas: { email: { registro, visto_em, primeira_vez } }, excluidas: { email: { registro, excluida_em } } }

  function vazio() { return { versao: VERSAO, contas: {}, excluidas: {} }; }
  function lerArquivo(arq) {
    try {
      const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
      if (j && typeof j === 'object' && j.contas && typeof j.contas === 'object') { if (!j.excluidas || typeof j.excluidas !== 'object') j.excluidas = {}; return j; }
    } catch (e) { /* ausente ou ilegível */ }
    return null;
  }
  function carregar() {
    if (memoria) return memoria;
    memoria = lerArquivo(caminho()) || lerArquivo(path.join(dir, ARQUIVO_ANTERIOR)) || vazio();
    return memoria;
  }
  function gravar() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const atual = caminho();
      try { if (fs.existsSync(atual) && lerArquivo(atual)) fs.copyFileSync(atual, path.join(dir, ARQUIVO_ANTERIOR)); } catch (e) { /* a cópia anterior é um extra */ }
      const tmp = atual + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(memoria, null, 2));
      fs.renameSync(tmp, atual);
      copiaDoDia();
    } catch (e) { try { log.warn('[COFRE] Não foi possível gravar ' + ARQUIVO + ': ' + e.message); } catch (e2) {} }
  }
  // Uma cópia por dia (as últimas 30): protege de um arquivo principal danificado por algo que gravou lixo
  function copiaDoDia() {
    try {
      const pasta = path.join(dir, PASTA_DIARIA);
      const nome = agora().toISOString().slice(0, 10) + '.json';
      fs.mkdirSync(pasta, { recursive: true });
      fs.copyFileSync(caminho(), path.join(pasta, nome));
      const antigos = fs.readdirSync(pasta).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      antigos.slice(0, Math.max(0, antigos.length - DIAS_GUARDADOS)).forEach(f => { try { fs.unlinkSync(path.join(pasta, f)); } catch (e) {} });
    } catch (e) { /* extra */ }
  }

  /** Guarda a versão mais nova de cada conta da lista. Devolve quantas contas entraram ou mudaram. */
  function registrar(lista) {
    try {
      const m = carregar();
      let mudou = 0;
      const iso = agora().toISOString();
      for (const u of Array.isArray(lista) ? lista : []) {
        const email = lower(u && u.email);
        if (!email || !email.includes('@')) continue;
        const reg = copia(u);
        reg.email = email;
        const ja = m.contas[email];
        // Nunca troca uma senha válida guardada por uma vazia/ilegível (cadastro que chegou sem a senha)
        if (ja && temSenhaValida(ja.registro) && !temSenhaValida(reg)) reg.password = ja.registro.password;
        // Nunca guarda data impossível (deriva de fuso): mantém a que já era real
        const limpo = datasSanas(reg, ja && ja.registro);
        if (ja && estavel(ja.registro) === estavel(limpo)) continue;
        m.contas[email] = { registro: limpo, visto_em: iso, primeira_vez: ja ? ja.primeira_vez : iso };
        delete m.excluidas[email];   // quem foi recriado (lápide limpa pelo cadastro novo) deixa de ser "excluído"
        mudou++;
      }
      if (mudou) gravar();
      return mudou;
    } catch (e) { return 0; }
  }

  /** Contas do cofre que não estão na lista e não têm lápide. `lapides`: Set de e-mails excluídos de propósito. Cópias, prontas para voltar à lista. */
  function faltantes(lista, lapides) {
    try {
      const m = carregar();
      const tem = new Set((Array.isArray(lista) ? lista : []).map(u => lower(u && u.email)).filter(Boolean));
      const gone = lapides instanceof Set ? lapides : new Set(Array.from(lapides || []).map(lower));
      return Object.keys(m.contas).filter(e => !tem.has(e) && !gone.has(e)).map(e => copia(m.contas[e].registro));
    } catch (e) { return []; }
  }

  /** Cadastro guardado de UMA conta (cópia) ou null. Ignora excluídas. */
  function buscar(email) {
    try { const c = carregar().contas[lower(email)]; return c ? copia(c.registro) : null; } catch (e) { return null; }
  }
  function buscarPorCpf(cpf) {
    try {
      const d = String(cpf || '').replace(/\D/g, '');
      if (d.length !== 11) return null;
      const ach = Object.values(carregar().contas).filter(c => String(c.registro.cpf || '').replace(/\D/g, '') === d);
      return ach.length === 1 ? copia(ach[0].registro) : null;
    } catch (e) { return null; }
  }

  /** Exclusão DE PROPÓSITO (a lápide já foi gravada): sai de circulação, a última versão fica em "excluidas". */
  function excluir(email) {
    try {
      const m = carregar(); const e = lower(email);
      if (!m.contas[e]) return false;
      m.excluidas[e] = { registro: m.contas[e].registro, excluida_em: agora().toISOString() };
      delete m.contas[e];
      gravar();
      return true;
    } catch (e) { return false; }
  }

  const total = () => { try { return Object.keys(carregar().contas).length; } catch (e) { return 0; } };
  const resumo = () => { try { const m = carregar(); return { contas: Object.keys(m.contas).length, excluidas: Object.keys(m.excluidas).length, arquivo: ARQUIVO }; } catch (e) { return { contas: 0, excluidas: 0, arquivo: ARQUIVO }; } };

  return { registrar, faltantes, buscar, buscarPorCpf, excluir, total, resumo, _recarregar: () => { memoria = null; } };
}

module.exports = { criarCofre, datasSanas, dataImpossivel, ARQUIVO, ARQUIVO_ANTERIOR, PASTA_DIARIA };
