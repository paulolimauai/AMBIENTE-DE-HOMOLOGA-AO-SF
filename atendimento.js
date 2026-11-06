'use strict';

/**
 * Central de Atendimento: regras de negócio dos chamados (O.S.).
 *
 * Só funções puras (sem banco, sem HTTP, sem relógio escondido): o server.js cuida das rotas e da gravação
 * (arquivo local + SQL Server) e chama este módulo para validar, normalizar, atualizar e decidir o que cada
 * pessoa pode ver. Assim as regras ficam num lugar só e têm testes (atendimento.test.js).
 */

const crypto = require('crypto');

// ---------- Catálogos ----------
const STATUS = Object.freeze(['Pendente', 'Em Andamento', 'Concluído', 'Cancelado']);
const PRIORIDADES = Object.freeze(['Normal', 'Alta', 'Urgente']);
const CATEGORIAS = Object.freeze([
  'Reset de Senha',
  'Pagamento Não Reconhecido',
  '2ª Via de Boleto',
  'Correção de Dados',
  'Suporte Técnico',
  'Atendimento Geral',
  'Relato de Bug',
  'Melhoria no Sistema',
  'Instalação / Configuração'
]);
const CATEGORIA_PADRAO = 'Atendimento Geral';
const CANAL_PADRAO = 'Portal Web';
// Quem não é administrador só pode abrir chamado por estes canais (os demais, como "Telefone", são de atendimento interno)
const CANAIS_PUBLICOS = Object.freeze(['Tela de Login', 'Portal Web', 'App Mobile']);

const LIMITES = Object.freeze({ nome: 120, email: 254, telefone: 40, titulo: 200, descricao: 5000, notas: 2000, tecnico: 150, canal: 60, categoria: 100 });
// Mínimos de texto: o público precisa descrever o pedido; a recepção (administrador) pode registrar anotações curtas
const MINIMOS_PUBLICO = Object.freeze({ nome: 2, titulo: 3, descricao: 10 });
const MINIMOS_ADMIN = Object.freeze({ nome: 2, titulo: 3, descricao: 3 });

// ---------- Texto ----------
const CARACTERES_DE_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function limparTexto(valor, max, { multilinha = false } = {}) {
  let texto = String(valor == null ? '' : valor).normalize('NFC').replace(/\r\n?/g, '\n').replace(CARACTERES_DE_CONTROLE, '');
  texto = multilinha
    ? texto.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    : texto.replace(/\s+/g, ' ');
  // Não corta no meio de um par substituto (emoji): sobraria um caractere inválido
  return texto.trim().slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

// Textos livres do público são exibidos pelo painel via innerHTML: viram entidades antes de gravar (evita XSS armazenado)
function escaparHtml(valor) {
  return String(valor == null ? '' : valor).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function soDigitos(valor) {
  return String(valor == null ? '' : valor).replace(/\D/g, '');
}

function acharNaLista(lista, valor) {
  const alvo = String(valor == null ? '' : valor).trim().toLowerCase();
  return lista.find((item) => item.toLowerCase() === alvo) || null;
}

// ---------- Datas ----------
const MESES_SQL = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// Converte qualquer data do chamado para ISO 8601. Reconhece também o texto que o SQL Server grava quando a coluna
// NVARCHAR recebe GETDATE() ("Nov  2 2026 12:24PM"), que é horário de Brasília (UTC-3).
function paraIso(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor.toISOString();
  const texto = String(valor).trim();
  const sql = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(texto);
  if (sql && MESES_SQL[sql[1].toLowerCase()] !== undefined) {
    let hora = Number(sql[4]) % 12;
    if (sql[6].toUpperCase() === 'PM') hora += 12;
    return new Date(Date.UTC(Number(sql[3]), MESES_SQL[sql[1].toLowerCase()], Number(sql[2]), hora + 3, Number(sql[5]))).toISOString();
  }
  const ms = Date.parse(texto);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function dataOuOriginal(valor) {
  const iso = paraIso(valor);
  if (iso) return iso;
  return valor == null || valor === '' ? null : String(valor);
}

// ---------- Protocolo ----------
// Formato: OS-AAMMDD-XXXX (data de Brasília + 4 caracteres sem ambiguidade: sem 0/O nem 1/I). Ex.: OS-261106-K7QX.
// Protocolos antigos (OS-12345678, só números) continuam válidos para consulta.
const ALFABETO_PROTOCOLO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RE_PROTOCOLO = /^OS-?(\d{6})-?([A-HJ-NP-Z2-9]{4})$/;
const RE_PROTOCOLO_LEGADO = /^OS-?(\d{6,10})$/;

function normalizarProtocolo(valor) {
  const texto = String(valor == null ? '' : valor).trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
  const novo = RE_PROTOCOLO.exec(texto);
  if (novo) return 'OS-' + novo[1] + '-' + novo[2];
  const legado = RE_PROTOCOLO_LEGADO.exec(texto);
  if (legado) return 'OS-' + legado[1];
  return null;
}

function prefixoDeData(agora) {
  const brasilia = new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString();
  return brasilia.slice(2, 4) + brasilia.slice(5, 7) + brasilia.slice(8, 10);
}

function sufixoAleatorio(tamanho = 4) {
  let saida = '';
  for (let i = 0; i < tamanho; i++) saida += ALFABETO_PROTOCOLO[crypto.randomInt(0, ALFABETO_PROTOCOLO.length)];
  return saida;
}

// jaExiste(protocolo) pode ser síncrona ou assíncrona (confere o arquivo local e o banco): o protocolo é único por construção
async function gerarProtocolo(jaExiste, agora = new Date()) {
  for (let tentativa = 0; tentativa < 20; tentativa++) {
    const protocolo = 'OS-' + prefixoDeData(agora) + '-' + sufixoAleatorio();
    if (!(await jaExiste(protocolo))) return protocolo;
  }
  throw new Error('Não foi possível gerar um protocolo único.');
}

function mesmaReferencia(ordem, referencia) {
  if (!ordem) return false;
  const ref = String(referencia == null ? '' : referencia).trim();
  if (!ref) return false;
  if (String(ordem.id) === ref) return true;
  const a = normalizarProtocolo(ordem.protocol) || String(ordem.protocol || '').trim().toUpperCase();
  const b = normalizarProtocolo(ref) || ref.toUpperCase();
  return Boolean(a) && a === b;
}

// ---------- Telefone e CPF ----------
function telefoneNacional(digitos) {
  return digitos.length > 11 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
}

function formatarTelefone(digitos) {
  const nacional = telefoneNacional(digitos);
  const prefixo = nacional !== digitos ? '+55 ' : '';
  if (nacional.length === 11) return prefixo + '(' + nacional.slice(0, 2) + ') ' + nacional.slice(2, 7) + '-' + nacional.slice(7);
  if (nacional.length === 10) return prefixo + '(' + nacional.slice(0, 2) + ') ' + nacional.slice(2, 6) + '-' + nacional.slice(6);
  return digitos;
}

function mesmoNumero(armazenado, digitosBuscados) {
  const a = telefoneNacional(soDigitos(armazenado));
  const b = telefoneNacional(digitosBuscados);
  return Boolean(a) && Boolean(b) && a === b;
}

function validarCpf(valor) {
  const cpf = soDigitos(valor);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) soma += Number(cpf[i]) * (posicao + 1 - i);
    let digito = 11 - (soma % 11);
    if (digito >= 10) digito = 0;
    if (digito !== Number(cpf[posicao])) return false;
  }
  return true;
}

// ---------- Abertura de chamado ----------
const EMAIL_PADRAO = /^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,190}\.[A-Za-z]{2,24}$/;

/**
 * Valida e normaliza o pedido de abertura.
 * - Público: status, técnico e notas internas são ignorados; categoria, prioridade e canal só aceitam valores conhecidos.
 * - Administrador (recepção): pode definir status, técnico, notas e canal.
 * Retorna { ok: true, dados } ou { ok: false, mensagem, erros } (mensagem = primeiro problema, por campo em erros).
 * Os textos livres já saem escapados para HTML (ver escaparHtml).
 */
function validarAbertura(payload, { admin = false, isEmail } = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const emailValido = typeof isEmail === 'function' ? isEmail : (e) => e.length <= 254 && EMAIL_PADRAO.test(e) && !e.includes('..');
  const minimos = admin ? MINIMOS_ADMIN : MINIMOS_PUBLICO;
  const erros = {};

  const nome = limparTexto(p.client_name, LIMITES.nome);
  if (nome.length < minimos.nome) erros.client_name = 'Informe seu nome.';

  const email = limparTexto(p.client_email, LIMITES.email).toLowerCase();
  if (!email || !emailValido(email)) erros.client_email = 'Informe um e-mail válido.';

  let telefone = '';
  const telefoneBruto = limparTexto(p.client_phone, LIMITES.telefone);
  if (telefoneBruto) {
    const digitos = soDigitos(telefoneBruto);
    const nacional = telefoneNacional(digitos);
    if (nacional.length === 10 || nacional.length === 11) telefone = formatarTelefone(digitos);
    else erros.client_phone = 'Informe o telefone com DDD (ex.: (62) 99999-9999).';
  }

  // CPF é opcional: se vier inválido, é descartado em vez de barrar o chamado
  const cpfDigitos = soDigitos(p.client_cpf);
  const cpf = validarCpf(cpfDigitos) ? cpfDigitos : '';

  const categoriaBruta = limparTexto(p.service_type, LIMITES.categoria);
  let categoria = CATEGORIA_PADRAO;
  if (categoriaBruta) {
    categoria = acharNaLista(CATEGORIAS, categoriaBruta);
    if (!categoria) erros.service_type = 'Selecione uma categoria válida.';
  }

  const prioridadeBruta = limparTexto(p.priority, 30);
  let prioridade = 'Normal';
  if (prioridadeBruta) {
    prioridade = acharNaLista(PRIORIDADES, prioridadeBruta);
    if (!prioridade) erros.priority = 'Prioridade inválida.';
  }

  const titulo = limparTexto(p.title, LIMITES.titulo);
  if (titulo.length < minimos.titulo) erros.title = 'Informe o assunto do chamado.';

  const descricao = limparTexto(p.description, LIMITES.descricao, { multilinha: true });
  if (descricao.length < minimos.descricao) {
    erros.description = admin
      ? 'Descreva a demanda.'
      : 'Descreva o que você precisa com um pouco mais de detalhes (mínimo de ' + minimos.descricao + ' caracteres).';
  }

  const canalBruto = limparTexto(p.canal_atendimento, LIMITES.canal);
  let canal = CANAL_PADRAO;
  if (admin) canal = canalBruto || CANAL_PADRAO;
  else if (canalBruto) canal = acharNaLista(CANAIS_PUBLICOS, canalBruto) || CANAL_PADRAO;

  let tecnico = null;
  let status = 'Pendente';
  let notas = '';
  if (admin) {
    tecnico = limparTexto(p.tecnico_responsavel, LIMITES.tecnico) || null;
    notas = limparTexto(p.admin_notes, LIMITES.notas, { multilinha: true });
    const statusBruto = limparTexto(p.status, 30);
    if (statusBruto) {
      status = acharNaLista(STATUS, statusBruto);
      if (!status) erros.status = 'Status inválido.';
    } else {
      status = tecnico ? 'Em Andamento' : 'Pendente';
    }
  }

  const campos = Object.keys(erros);
  if (campos.length) return { ok: false, mensagem: erros[campos[0]], erros };

  return {
    ok: true,
    dados: {
      client_name: escaparHtml(nome),
      client_email: email,
      client_phone: escaparHtml(telefone),
      client_cpf: cpf,
      service_type: categoria,
      priority: prioridade,
      title: escaparHtml(titulo),
      description: escaparHtml(descricao),
      canal_atendimento: escaparHtml(canal),
      status,
      tecnico_responsavel: tecnico,
      admin_notes: notas
    }
  };
}

function montarOrdem(dados, { protocolo, id, agoraIso }) {
  return {
    id,
    protocol: protocolo,
    client_name: dados.client_name,
    client_email: dados.client_email,
    client_phone: dados.client_phone,
    client_cpf: dados.client_cpf,
    service_type: dados.service_type,
    priority: dados.priority,
    title: dados.title,
    description: dados.description,
    status: dados.status,
    admin_notes: dados.admin_notes,
    tecnico_responsavel: dados.tecnico_responsavel,
    assumido_em: dados.tecnico_responsavel ? agoraIso : null,
    canal_atendimento: dados.canal_atendimento,
    concluido_em: dados.status === 'Concluído' ? agoraIso : null,
    created_at: agoraIso,
    updated_at: agoraIso
  };
}

// Mesma pessoa reenviando o mesmo chamado em poucos minutos (duplo clique, "voltar e enviar de novo"): devolve o já aberto
function encontrarDuplicada(lista, dados, { agora = Date.now(), janelaMs = 10 * 60 * 1000 } = {}) {
  const chave = (t) => String(t == null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
  return (Array.isArray(lista) ? lista : []).find((o) => {
    if (!o || o.status === 'Cancelado') return false;
    if (String(o.client_email || '').toLowerCase().trim() !== dados.client_email) return false;
    if (chave(o.title) !== chave(dados.title) || chave(o.description) !== chave(dados.description)) return false;
    const criadoEm = Date.parse(o.created_at);
    return Number.isFinite(criadoEm) && agora - criadoEm >= 0 && agora - criadoEm <= janelaMs;
  }) || null;
}

// ---------- Atualização (administrador) ----------
/**
 * Aplica as mudanças do administrador sobre um chamado existente.
 * Só altera o que veio no pedido (antes, enviar apenas as notas devolvia o chamado para "Pendente").
 * Retorna { ok: true, ordem, mudancas } ou { ok: false, mensagem }.
 */
function aplicarAtualizacao(ordem, payload, { agoraIso }) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const novo = { ...ordem };
  const mudancas = [];

  if (p.status !== undefined && String(p.status).trim() !== '') {
    const status = acharNaLista(STATUS, p.status);
    if (!status) return { ok: false, mensagem: 'Status inválido. Use: ' + STATUS.join(', ') + '.' };
    if (status !== ordem.status) mudancas.push('status: ' + (ordem.status || '—') + ' → ' + status);
    novo.status = status;
  }

  if (p.priority !== undefined && String(p.priority).trim() !== '') {
    const prioridade = acharNaLista(PRIORIDADES, p.priority);
    if (!prioridade) return { ok: false, mensagem: 'Prioridade inválida. Use: ' + PRIORIDADES.join(', ') + '.' };
    if (prioridade !== ordem.priority) mudancas.push('prioridade: ' + (ordem.priority || '—') + ' → ' + prioridade);
    novo.priority = prioridade;
  }

  if (p.service_type !== undefined && String(p.service_type).trim() !== '') {
    const bruta = limparTexto(p.service_type, LIMITES.categoria);
    // Chamados antigos podem ter categorias que já não estão no catálogo: mantê-las não é erro
    const categoria = acharNaLista(CATEGORIAS, bruta) || (bruta === ordem.service_type ? bruta : null);
    if (!categoria) return { ok: false, mensagem: 'Categoria inválida.' };
    if (categoria !== ordem.service_type) mudancas.push('categoria: ' + (ordem.service_type || '—') + ' → ' + categoria);
    novo.service_type = categoria;
  }

  if (p.canal_atendimento !== undefined && String(p.canal_atendimento).trim() !== '') {
    novo.canal_atendimento = limparTexto(p.canal_atendimento, LIMITES.canal);
  }

  if (p.admin_notes !== undefined) {
    novo.admin_notes = limparTexto(p.admin_notes, LIMITES.notas, { multilinha: true });
    if (novo.admin_notes !== (ordem.admin_notes || '')) mudancas.push('parecer atualizado');
  }

  if (p.tecnico_responsavel !== undefined) {
    const tecnico = limparTexto(p.tecnico_responsavel, LIMITES.tecnico) || null;
    if (tecnico !== (ordem.tecnico_responsavel || null)) mudancas.push('técnico: ' + (ordem.tecnico_responsavel || '—') + ' → ' + (tecnico || '—'));
    novo.tecnico_responsavel = tecnico;
    if (tecnico && !novo.assumido_em) novo.assumido_em = agoraIso;
    else if (!tecnico) novo.assumido_em = null;
  }

  if (novo.status === 'Concluído') novo.concluido_em = paraIso(ordem.concluido_em) || agoraIso;
  else novo.concluido_em = null;

  novo.updated_at = agoraIso;
  return { ok: true, ordem: novo, mudancas };
}

// ---------- Leitura ----------
// Padroniza o que vem do SQL Server e do arquivo local: textos nunca nulos, datas sempre em ISO 8601
function normalizarOrdem(linha) {
  if (!linha || typeof linha !== 'object') return null;
  const texto = (v) => (v == null ? '' : String(v));
  return {
    ...linha,
    protocol: texto(linha.protocol).trim(),
    client_name: texto(linha.client_name),
    client_email: texto(linha.client_email).toLowerCase().trim(),
    client_phone: texto(linha.client_phone),
    client_cpf: texto(linha.client_cpf),
    service_type: texto(linha.service_type) || CATEGORIA_PADRAO,
    priority: texto(linha.priority) || 'Normal',
    title: texto(linha.title),
    description: texto(linha.description),
    status: texto(linha.status) || 'Pendente',
    admin_notes: texto(linha.admin_notes),
    tecnico_responsavel: linha.tecnico_responsavel ? String(linha.tecnico_responsavel) : null,
    assumido_em: dataOuOriginal(linha.assumido_em),
    canal_atendimento: texto(linha.canal_atendimento) || CANAL_PADRAO,
    concluido_em: dataOuOriginal(linha.concluido_em),
    created_at: dataOuOriginal(linha.created_at),
    updated_at: dataOuOriginal(linha.updated_at)
  };
}

// Une as listas pelo protocolo; os itens de "preferidas" (banco) valem mais, mas o que só existe nas "outras"
// (arquivo local, por exemplo quando o banco estava fora do ar na abertura) não se perde. Mais recentes primeiro.
function mesclarOrdens(preferidas, outras) {
  const porChave = new Map();
  const chaveDe = (o) => normalizarProtocolo(o.protocol) || String(o.protocol || '').trim().toUpperCase() || 'id:' + o.id;
  for (const lista of [outras, preferidas]) {
    for (const bruta of Array.isArray(lista) ? lista : []) {
      const ordem = normalizarOrdem(bruta);
      if (ordem) porChave.set(chaveDe(ordem), ordem);
    }
  }
  const instante = (o) => {
    const ms = Date.parse(o.created_at);
    return Number.isFinite(ms) ? ms : 0;
  };
  return [...porChave.values()].sort((a, b) => instante(b) - instante(a));
}

// ---------- Consulta pública ----------
/**
 * Descobre o que a pessoa digitou. Consulta pública exige correspondência exata:
 * protocolo, e-mail, ou número (telefone/CPF). Qualquer outra coisa é inválida.
 */
function classificarConsulta(valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  if (!bruto) return { tipo: 'invalida' };
  const protocolo = normalizarProtocolo(bruto);
  if (protocolo) return { tipo: 'protocolo', valor: protocolo };
  if (bruto.includes('@')) {
    const email = bruto.toLowerCase();
    return email.length <= 254 && EMAIL_PADRAO.test(email) ? { tipo: 'email', valor: email } : { tipo: 'invalida' };
  }
  const digitos = soDigitos(bruto);
  if (digitos.length >= 10 && digitos.length <= 13 && /^[\d\s().+\-]+$/.test(bruto)) return { tipo: 'numero', valor: digitos };
  return { tipo: 'invalida' };
}

function ordemCorresponde(ordem, consulta) {
  if (!ordem || !consulta) return false;
  switch (consulta.tipo) {
    case 'protocolo':
      return (normalizarProtocolo(ordem.protocol) || String(ordem.protocol || '').toUpperCase()) === consulta.valor;
    case 'email':
      return String(ordem.client_email || '').toLowerCase().trim() === consulta.valor;
    case 'numero':
      return mesmoNumero(ordem.client_phone, consulta.valor) || (soDigitos(ordem.client_cpf) === consulta.valor && consulta.valor.length === 11);
    default:
      return false;
  }
}

/**
 * O que a pessoa sem login enxerga:
 * - por protocolo (que só quem abriu conhece): andamento completo, sem dados pessoais nem parecer interno;
 * - por e-mail/telefone/CPF (que outras pessoas podem saber): só um resumo para identificar o chamado.
 */
function visaoPublica(ordem, { detalhada = false } = {}) {
  const resumo = {
    protocol: ordem.protocol,
    status: ordem.status || 'Pendente',
    service_type: ordem.service_type || CATEGORIA_PADRAO,
    created_at: paraIso(ordem.created_at),
    updated_at: paraIso(ordem.updated_at),
    concluido_em: paraIso(ordem.concluido_em)
  };
  if (!detalhada) return resumo;
  return {
    ...resumo,
    priority: ordem.priority || 'Normal',
    title: ordem.title || '',
    description: ordem.description || '',
    tecnico_responsavel: ordem.tecnico_responsavel || null,
    assumido_em: paraIso(ordem.assumido_em),
    canal_atendimento: ordem.canal_atendimento || CANAL_PADRAO
  };
}

module.exports = {
  STATUS, PRIORIDADES, CATEGORIAS, CANAIS_PUBLICOS, CATEGORIA_PADRAO, CANAL_PADRAO, LIMITES,
  limparTexto, escaparHtml, paraIso,
  gerarProtocolo, normalizarProtocolo, mesmaReferencia,
  formatarTelefone, mesmoNumero, validarCpf, soDigitos,
  validarAbertura, montarOrdem, encontrarDuplicada, aplicarAtualizacao,
  normalizarOrdem, mesclarOrdens,
  classificarConsulta, ordemCorresponde, visaoPublica
};
