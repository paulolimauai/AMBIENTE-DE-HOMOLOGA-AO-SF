'use strict';
/**
 * Vigia do SQL Server: edição feita DIRETO no banco (SSMS, script, sqlcmd) passa a valer em todo lugar.
 *
 * O problema: o app só enxerga o SQL Server de duas formas — na inicialização e no ciclo de 10 s com a nuvem (Render). Nesse ciclo o
 * passo A (nuvem → SQL) regrava nome/CPF/telefone/nascimento com o valor da nuvem, e o passo D reconcilia assinatura e bloqueio com o espelho
 * local quando o espelho tem carimbo (acesso.js / assinatura.js / credenciais.js). Resultado: o que o dono alterava no SQL era DESFEITO em
 * até 10 s, e nunca chegava à nuvem nem ao Supabase (que recebe o que o espelho local `local_users.json` tem).
 *
 * A regra daqui: uma coluna foi alterada POR FORA do app quando o SQL difere do que o vigia viu na leitura anterior E difere do espelho.
 *   - se o SQL difere da leitura anterior mas é igual ao espelho, foi o próprio app que gravou (só atualiza o que foi visto);
 *   - se o SQL é igual à leitura anterior e difere do espelho, o app gravou o espelho e o UPDATE ainda não chegou (o espelho continua valendo);
 *   - se o SQL difere dos dois, a mudança foi de fora — e só é adotada quando se repete igual em duas leituras seguidas (ESTAVEL_MS), o que
 *     descarta o intervalo de milissegundos entre "SQL gravado" e "espelho gravado" do próprio app.
 * Adotar = copiar o valor do SQL para o espelho e CARIMBAR (o carimbo é o que faz a mudança vencer a nuvem). Daí em diante tudo segue o
 * caminho que já existia: espelho → Supabase (supabase-sync) e passo D → nuvem.
 *
 * Regras puras (foto/detectar/aplicar) e o vigia com dependências injetadas: testados em sql-vigia.test.js sem banco, sem rede.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Assinatura = require('./assinatura');
const Acesso = require('./acesso');
const Credenciais = require('./credenciais');

const COLUNAS_USUARIOS = 'id, name, email, password, role, active, created_at, last_login, cpf, phone, birth_date, terms_accepted, device_type, must_change_password, trial_started_at, subscription_plan, subscription_status, subscription_expires_at, subscription_method, subscription_payment_id';
const INTERVALO_MS = 3000;       // de quanto em quanto tempo o SQL é lido
const ESTAVEL_MS = 2000;         // quanto tempo uma diferença precisa se manter igual para valer como edição de fora
const PROTECAO_MAX_MS = 10 * 60 * 1000; // o perfil adotado fica protegido do passo A até a nuvem confirmar (ou, no máximo, por este tempo)
const PERFIL = ['name', 'cpf', 'phone', 'birth_date', 'device_type'];

const lower = (v) => String(v == null ? '' : v).toLowerCase().trim();
const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const digitos = (v) => texto(v).replace(/\D/g, '');
const sha1 = (v) => crypto.createHash('sha1').update(String(v == null ? '' : v)).digest('hex');
const paraMs = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/**
 * Retrato comparável de um usuário: só o que o vigia acompanha, em forma canônica (datas em ms, texto aparado, senha só pela impressão digital).
 * `paraIso` converte a data crua do SQL Server (DATETIME2 = hora de Brasília marcada como UTC) para ISO; o espelho já guarda ISO e não precisa.
 */
function foto(u, paraIso) {
  const iso = (v) => (v ? (paraIso ? paraIso(v) : v) : null);
  const usuario = u || {};
  return {
    ativo: Acesso.ativo(usuario.active),
    sub: {
      status: texto(usuario.subscription_status),
      plano: texto(usuario.subscription_plan),
      metodo: texto(usuario.subscription_method),
      pagamento: texto(usuario.subscription_payment_id),
      expira: paraMs(iso(usuario.subscription_expires_at)),
      teste: paraMs(iso(usuario.trial_started_at))
    },
    senha: sha1(texto(usuario.password)),
    perfil: { name: texto(usuario.name), cpf: digitos(usuario.cpf), phone: texto(usuario.phone), birth_date: texto(usuario.birth_date), device_type: texto(usuario.device_type) }
  };
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * O que mudou POR FORA do app: compara o SQL agora (`sql`) com a leitura anterior (`visto`) e com o espelho (`espelho`).
 * Sem leitura anterior (primeira vez que a conta aparece) ou sem espelho, não há como saber: devolve {}.
 */
function detectar(sql, visto, espelho) {
  const r = {};
  if (!sql || !visto || !espelho) return r;
  if (sql.ativo !== visto.ativo && sql.ativo !== espelho.ativo) r.acesso = true;
  if (!igual(sql.sub, visto.sub) && !igual(sql.sub, espelho.sub)) r.assinatura = true;
  if (sql.senha !== visto.senha && sql.senha !== espelho.senha) r.senha = true;
  if (!igual(sql.perfil, visto.perfil) && !igual(sql.perfil, espelho.perfil)) r.perfil = true;
  return r;
}

/**
 * Copia a edição de fora para o espelho e carimba (nunca recua o carimbo). `linha` é a linha crua do SQL.
 * Devolve { usuario, avisos } — `usuario` é uma cópia; o espelho recebido não é alterado.
 */
function aplicar(espelho, linha, mud, opts) {
  const o = opts || {};
  const paraIso = o.paraIso || ((v) => v);
  const agora = Number.isFinite(o.agora) ? o.agora : Date.now();
  const usuario = { ...espelho };
  const avisos = [];
  if (mud.acesso) {
    usuario.active = Acesso.ativo(linha.active);
    Acesso.stamp(usuario, agora);
  }
  if (mud.assinatura) {
    Assinatura.CAMPOS.forEach((k) => {
      const ehData = k === 'subscription_expires_at' || k === 'trial_started_at';
      usuario[k] = linha[k] === undefined || linha[k] === null || linha[k] === '' ? null : (ehData ? paraIso(linha[k]) : linha[k]);
    });
    Assinatura.stamp(usuario, agora);
  }
  if (mud.senha) {
    // Só um hash do sistema (scrypt:...) pode ser a senha de uma conta: texto puro no SQL não é propagado (a nuvem o recusaria e vazaria a senha)
    if (Credenciais.isHash(linha.password)) {
      usuario.password = texto(linha.password);
      const anterior = Credenciais.clockMs(usuario);
      usuario.password_changed_at = new Date(anterior >= agora ? anterior + 1 : agora).toISOString();
    } else {
      avisos.push('senha_sem_hash');
    }
  }
  if (mud.perfil) {
    PERFIL.forEach((k) => { if (linha[k] !== undefined) usuario[k] = linha[k]; });
  }
  return { usuario, avisos };
}

/**
 * O vigia. Dependências (todas injetadas, para testar sem banco nem disco):
 *   getPool()            → pool do SQL Server (ou null)
 *   getLocalUsers()      → espelho local (lista)
 *   saveLocalUsers(l,b)  → grava o espelho (e, por ele, o Supabase)
 *   paraIso(v)           → data crua do SQL → ISO de Brasília
 *   nuvemOcupada()       → true enquanto o ciclo de 10 s com a nuvem está rodando (o vigia não adota nada no meio dele)
 *   aoEditar(info)       → avisa o servidor (encerrar sessões, empurrar para a nuvem, log)
 *   estadoPath           → arquivo onde o vigia guarda o que viu (sobrevive a reinício; só impressões digitais, nunca a senha)
 *   agora()              → relógio (ms), trocável nos testes
 */
function createVigia(deps) {
  const d = deps || {};
  const agora = typeof d.agora === 'function' ? d.agora : () => Date.now();
  const log = typeof d.log === 'function' ? d.log : () => {};
  let estado = null;                 // { usuarios: { email: foto } }
  let sujo = false;
  const pendentes = new Map();       // email -> { chave, desde }  diferença vista, esperando ficar estável
  const protegidos = new Map();      // email -> até quando (ms): perfil adotado que a nuvem ainda não recebeu
  let timer = null;
  let ocupado = false;
  let ultimoErroLog = 0;

  function carregar() {
    if (estado) return estado;
    estado = { usuarios: {} };
    try {
      if (d.estadoPath && fs.existsSync(d.estadoPath)) {
        const lido = JSON.parse(fs.readFileSync(d.estadoPath, 'utf8'));
        if (lido && typeof lido === 'object' && lido.usuarios && typeof lido.usuarios === 'object') estado = { usuarios: lido.usuarios };
      }
    } catch (e) { /* estado ilegível: recomeça (a primeira leitura só inicializa, nunca adota) */ }
    return estado;
  }
  function salvar() {
    if (!sujo || !d.estadoPath) return;
    sujo = false;
    try {
      const tmp = d.estadoPath + '.tmp';
      fs.mkdirSync(path.dirname(d.estadoPath), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(estado));
      fs.renameSync(tmp, d.estadoPath);
    } catch (e) { /* sem disco: segue em memória */ }
  }

  /** Processa as linhas de `usuarios` lidas do SQL. Síncrono: nada pode se intercalar entre ler o espelho e gravá-lo. */
  function processarUsuarios(linhas) {
    const est = carregar();
    const t = agora();
    const adotados = [];
    const lista = typeof d.getLocalUsers === 'function' ? d.getLocalUsers() : [];
    const porEmail = new Map();
    lista.forEach((u, i) => { if (u && u.email) porEmail.set(lower(u.email), i); });
    let novoEspelho = null;

    (Array.isArray(linhas) ? linhas : []).forEach((linha) => {
      if (!linha || !linha.email) return;
      const email = lower(linha.email);
      const sql = foto(linha, d.paraIso);
      const visto = est.usuarios[email];
      if (!visto) { est.usuarios[email] = sql; sujo = true; return; }
      const idx = porEmail.get(email);
      const espelho = idx === undefined ? null : foto(lista[idx]);
      const mud = detectar(sql, visto, espelho);
      const algum = mud.acesso || mud.assinatura || mud.senha || mud.perfil;
      if (!algum) {
        pendentes.delete(email);
        if (!igual(sql, visto)) { est.usuarios[email] = sql; sujo = true; }   // gravação do próprio app: só atualiza o que foi visto
        return;
      }
      const chave = JSON.stringify([mud, sql]);
      const p = pendentes.get(email);
      if (!p || p.chave !== chave) { pendentes.set(email, { chave, desde: t }); return; }
      if (t - p.desde < ESTAVEL_MS) return;
      // Estável: é uma edição feita por fora
      const r = aplicar(lista[idx], linha, mud, { paraIso: d.paraIso, agora: t });
      if (!novoEspelho) novoEspelho = lista.map((u) => (u ? { ...u } : u));
      novoEspelho[idx] = r.usuario;
      est.usuarios[email] = sql; sujo = true;
      pendentes.delete(email);
      if (mud.perfil) protegidos.set(email, t + PROTECAO_MAX_MS);
      adotados.push({ email, mud, avisos: r.avisos, bloqueou: !!mud.acesso && !sql.ativo, senha: !!mud.senha && !r.avisos.length });
    });

    if (novoEspelho && typeof d.saveLocalUsers === 'function') d.saveLocalUsers(novoEspelho, true);
    salvar();
    adotados.forEach((info) => { try { if (typeof d.aoEditar === 'function') d.aoEditar(info); } catch (e) { /* o aviso nunca derruba o vigia */ } });
    return adotados;
  }

  /** Lê `usuarios` no SQL e processa. `dentroDoCiclo` = chamado pelo próprio ciclo com a nuvem (que já marcou "ocupado"). */
  async function tickUsuarios(opts) {
    if (process.env.NEXUS_DISABLE_SQL_VIGIA === '1') return [];   // interruptor: com 1 o vigia não lê nem adota nada
    const pool = typeof d.getPool === 'function' ? d.getPool() : null;
    if (!pool) return [];
    const dentro = !!(opts && opts.dentroDoCiclo);
    if (!dentro && typeof d.nuvemOcupada === 'function' && d.nuvemOcupada()) return [];
    const res = await pool.query('SELECT ' + COLUNAS_USUARIOS + ' FROM usuarios ORDER BY id ASC');
    if (!dentro && typeof d.nuvemOcupada === 'function' && d.nuvemOcupada()) return [];   // o ciclo começou durante a leitura: fica para a próxima
    return processarUsuarios(res && res.rows);
  }

  function iniciar() {
    if (timer) return;
    carregar();
    timer = setInterval(() => {
      if (ocupado) return;
      ocupado = true;
      tickUsuarios().catch((e) => {
        const t = agora();
        if (t - ultimoErroLog > 5 * 60 * 1000) { ultimoErroLog = t; log('[VIGIA SQL] Leitura do SQL Server falhou (tenta de novo em instantes): ' + (e && e.message)); }
      }).finally(() => { ocupado = false; });
    }, INTERVALO_MS);
    if (timer.unref) timer.unref();
  }
  function parar() { if (timer) { clearInterval(timer); timer = null; } salvar(); }

  return {
    iniciar, parar, tickUsuarios, processarUsuarios,
    /** Há uma diferença do SQL esperando ficar estável: o ciclo com a nuvem não pode reconciliar/sobrescrever esta conta agora. */
    emEdicao: (email) => pendentes.has(lower(email)),
    /** Perfil (nome, CPF, telefone, nascimento): protegido do passo A enquanto pendente ou até a nuvem confirmar o recebimento. */
    perfilProtegido: (email) => {
      const e = lower(email);
      if (pendentes.has(e)) return true;
      const ate = protegidos.get(e);
      if (ate === undefined) return false;
      if (agora() >= ate) { protegidos.delete(e); return false; }
      return true;
    },
    /** A nuvem recebeu o envio completo do passo D: acaba a proteção. */
    confirmarEnvio: () => { protegidos.clear(); },
    _estado: () => carregar()
  };
}

module.exports = { COLUNAS_USUARIOS, INTERVALO_MS, ESTAVEL_MS, PERFIL, foto, detectar, aplicar, createVigia };
