'use strict';

/**
 * Central de Atendimento: regras de negócio dos chamados (O.S.).
 *
 * Só funções puras (sem banco, sem HTTP, sem relógio escondido): o server.js cuida das rotas e da gravação
 * (arquivo local + SQL Server) e chama este módulo para validar, normalizar, atualizar e decidir o que cada
 * pessoa pode ver. Assim as regras ficam num lugar só e têm testes (atendimento.test.js).
 */

// ---------- Catálogos ----------
// Fila de chamados: Novo -> Atendimento atribuído (-> Pendente, quando espera retorno) -> Resolvido -> Fechado
const STATUS = Object.freeze(['Novo', 'Pendente', 'Atendimento atribuído', 'Resolvido', 'Fechado']);
// Severidade (antes "prioridade"): quatro níveis. "Normal" e "Urgente" são nomes antigos.
const PRIORIDADES = Object.freeze(['Crítica', 'Alta', 'Média', 'Baixa']);
const PRIORIDADES_ANTIGAS = Object.freeze({ 'normal': 'Média', 'urgente': 'Crítica' });
const PRIORIDADE_PADRAO = 'Média';

// Tipo do chamado: o solicitante escolhe entre pedir algo (requisição) ou relatar algo que parou (incidente)
const TIPOS = Object.freeze(['Requisição', 'Incidente']);
const TIPO_PADRAO = 'Requisição';
const TIPOS_ANTIGOS = Object.freeze({ 'solicitacao': 'Requisição', 'pedido': 'Requisição', 'problema': 'Incidente' });

// Categorias oferecidas na abertura. O valor é o tipo sugerido (o solicitante pode trocar).
const CATEGORIAS_TIPO = Object.freeze({
  'Reset de senha': 'Requisição',
  'Pagamento não reconhecido': 'Incidente',
  'Desbloqueio de usuário': 'Requisição',
  'Conta/Login': 'Incidente',
  'Dados Cadastrais': 'Requisição',
  'Liberação de degustação': 'Requisição',
  '2ª Via de fatura': 'Requisição',
  'Atendimento Técnico': 'Incidente',
  'Falhas/Bugs/Correções': 'Incidente',
  'Outros': 'Requisição'
});
const CATEGORIAS = Object.freeze(Object.keys(CATEGORIAS_TIPO));
const CATEGORIA_PADRAO = 'Outros';
// Nomes de categoria de antes (sem acento e em minúsculas): quem ainda envia um deles (aba antiga aberta) cai na categoria
// nova mais próxima. Os chamados antigos já gravados continuam com o nome que tinham.
const CATEGORIAS_ANTIGAS = Object.freeze({
  'gestao de acessos & reset de senha': 'Reset de senha',
  '2ª via de boleto': '2ª Via de fatura',
  '2a via de fatura': '2ª Via de fatura',
  'segunda via de fatura': '2ª Via de fatura',
  'correcao de dados': 'Dados Cadastrais',
  'suporte tecnico': 'Atendimento Técnico',
  'suporte tecnico & infraestrutura': 'Atendimento Técnico',
  'instalacao / configuracao': 'Atendimento Técnico',
  'relato de bug': 'Falhas/Bugs/Correções',
  'falhas bugs/correcoes': 'Falhas/Bugs/Correções',
  'conta / login': 'Conta/Login',
  'sistema financeiro & erp': 'Outros',
  'projetos & melhorias': 'Outros',
  'melhoria no sistema': 'Outros',
  'atendimento geral': 'Outros',
  'outro suporte': 'Outros'
});
const CANAL_PADRAO = 'Portal Web';
// Quem não é administrador só pode abrir chamado por estes canais (os demais, como "Telefone", são de atendimento interno)
const CANAIS_PUBLICOS = Object.freeze(['Tela de Login', 'Portal Web', 'App Mobile', 'Central GLPI', 'GLPI Tela de Login']);

const LIMITES = Object.freeze({ nome: 120, email: 254, telefone: 40, titulo: 200, descricao: 5000, notas: 2000, tecnico: 150, canal: 60, categoria: 100, sla: 40, asset: 150, solution: 4000, fila: 60 });

// Política de SLA por severidade: Crítica 4 h, Alta 8 h, Média 24 h (corridas), Baixa 5 dias úteis (sáb. e dom. não contam)
const SLA_POLITICA = Object.freeze({ 'Crítica': '4 Horas', 'Alta': '8 Horas', 'Média': '24 Horas', 'Baixa': '5 Dias Úteis' });
// Prazos padrão da política anterior (Crítica 30 min, Alta 1 h): chamado que ainda guarda um deles passa a seguir a política nova
const SLA_ANTIGO_PADRAO = Object.freeze({ 'Crítica': ['30 minutos', '30 minuto'], 'Alta': ['1 hora'] });

// Sem acento, minúsculo e sem espaços nas pontas: chave de comparação dos catálogos
function chaveDe(valor) {
  return String(valor == null ? '' : valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// "alta", "ALTA", "Urgente", "Normal"... -> um dos quatro níveis (ou null se não for nenhum)
function prioridadeCanonica(valor) {
  const chave = chaveDe(valor);
  if (!chave) return null;
  return PRIORIDADES.find((p) => chaveDe(p) === chave) || PRIORIDADES_ANTIGAS[chave] || null;
}

function tipoCanonico(valor) {
  const chave = chaveDe(valor);
  if (!chave) return null;
  return TIPOS.find((t) => chaveDe(t) === chave) || TIPOS_ANTIGOS[chave] || null;
}

function categoriaCanonica(valor) {
  const chave = chaveDe(valor);
  if (!chave) return null;
  return CATEGORIAS.find((c) => chaveDe(c) === chave) || CATEGORIAS_ANTIGAS[chave] || null;
}

// Tipo sugerido para uma categoria (a mesma lista que a tela de abertura usa)
function tipoSugerido(categoria) {
  return CATEGORIAS_TIPO[categoriaCanonica(categoria)] || TIPO_PADRAO;
}

function calcularSlaPorPrioridade(prioridade) {
  return SLA_POLITICA[prioridadeCanonica(prioridade)] || SLA_POLITICA[PRIORIDADE_PADRAO];
}

// Nomes de status de antes (sem acento e em minúsculas). "Pendente" NÃO está aqui: no modelo antigo era o chamado
// recém-aberto e hoje é "aguardando retorno" - normalizarOrdem() sabe distinguir pela marca do tipo do chamado.
const STATUS_ANTIGOS = Object.freeze({
  'em aberto': 'Novo',
  'em andamento': 'Atendimento atribuído',
  'em atendimento': 'Atendimento atribuído',
  'pendente cliente': 'Pendente',
  'aguardando peca': 'Pendente',
  'concluido': 'Resolvido',
  'cancelado': 'Fechado'
});

// Nome do status -> um dos cinco (ou null). "Pendente" vale o novo "Pendente" (aguardando retorno).
function statusCanonico(valor) {
  const chave = chaveDe(valor);
  if (!chave) return null;
  return STATUS.find((s) => chaveDe(s) === chave) || STATUS_ANTIGOS[chave] || null;
}

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
// Formato atual: sequência a partir de OS-0001 (OS-0001, OS-0002, ... OS-9999, OS-10000...). Cada chamado novo pega o número seguinte.
// Os formatos antigos continuam válidos para consulta e atendimento: OS-AAMMDD-XXXX (ex.: OS-261106-K7QX) e OS-12345678 (só números).
const RE_PROTOCOLO_ALEATORIO = /^OS-?(\d{6})-?([A-HJ-NP-Z2-9]{4})$/;
const RE_PROTOCOLO_SEQUENCIAL = /^OS-?(\d{1,5})$/;
const RE_PROTOCOLO_LEGADO = /^OS-?(\d{6,10})$/;
const PROTOCOLO_SEQUENCIAL_MAXIMO = 99999;

const formatarProtocoloSequencial = (numero) => 'OS-' + String(numero).padStart(4, '0');

function normalizarProtocolo(valor) {
  const texto = String(valor == null ? '' : valor).trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
  const aleatorio = RE_PROTOCOLO_ALEATORIO.exec(texto);
  if (aleatorio) return 'OS-' + aleatorio[1] + '-' + aleatorio[2];
  const sequencial = RE_PROTOCOLO_SEQUENCIAL.exec(texto);
  if (sequencial) return Number(sequencial[1]) >= 1 ? formatarProtocoloSequencial(Number(sequencial[1])) : null; // OS-1 = OS-0001
  const legado = RE_PROTOCOLO_LEGADO.exec(texto);
  if (legado) return 'OS-' + legado[1];
  return null;
}

// Número de um protocolo sequencial (OS-0007 -> 7); 0 para qualquer outro formato
function numeroDoProtocolo(protocolo) {
  const m = /^OS-(\d{4,5})$/.exec(normalizarProtocolo(protocolo) || '');
  return m ? Number(m[1]) : 0;
}

/**
 * Próximo protocolo da sequência: o maior número já usado nos chamados (+ o `minimo`, que o servidor alimenta com o contador
 * gravado e com o maior número do banco) mais um. Sem nenhum chamado numerado, começa em OS-0001.
 * É síncrona de propósito: o servidor a chama junto com a gravação do chamado, e assim dois pedidos ao mesmo tempo não repetem número.
 */
function proximoProtocolo(ordens, { minimo = 0 } = {}) {
  let maior = Number.isFinite(Number(minimo)) ? Math.max(0, Math.floor(Number(minimo))) : 0;
  for (const o of Array.isArray(ordens) ? ordens : []) maior = Math.max(maior, numeroDoProtocolo(o && o.protocol));
  if (maior >= PROTOCOLO_SEQUENCIAL_MAXIMO) throw new Error('Limite de protocolos sequenciais atingido.');
  return formatarProtocoloSequencial(maior + 1);
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
function validarAbertura(payload, { admin = false, isEmail, filas } = {}) {
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
    categoria = categoriaCanonica(categoriaBruta);
    if (!categoria) erros.service_type = 'Selecione uma categoria válida.';
  }

  const prioridadeBruta = limparTexto(p.priority, 30);
  let prioridade = PRIORIDADE_PADRAO;
  if (prioridadeBruta) {
    prioridade = prioridadeCanonica(prioridadeBruta);
    if (!prioridade) erros.priority = 'Severidade inválida. Use: ' + PRIORIDADES.join(', ') + '.';
  }

  // Requisição (pedir algo) ou incidente (algo que parou): sem escolha, vale o tipo sugerido pela categoria
  const tipoBruto = limparTexto(p.ticket_type !== undefined ? p.ticket_type : p.tipo, 30);
  let tipo = tipoSugerido(categoria);
  if (tipoBruto) {
    tipo = tipoCanonico(tipoBruto);
    if (!tipo) erros.ticket_type = 'Escolha o tipo do chamado: Requisição ou Incidente.';
  }

  // Fila: quem atende define; o público cai na fila que atende a categoria (se houver uma)
  let fila = null;
  if (admin) {
    const filaBruta = limparTexto(p.fila, LIMITES.fila);
    if (filaBruta) {
      const achada = acharFila(filas, filaBruta);
      if (achada) fila = achada.nome;
      else erros.fila = 'Fila inválida.';
    }
  }
  if (!fila) fila = filaDaCategoria(filas, categoria);

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
  let status = 'Novo';
  let notas = '';
  if (admin) {
    tecnico = limparTexto(p.tecnico_responsavel, LIMITES.tecnico) || null;
    notas = limparTexto(p.admin_notes, LIMITES.notas, { multilinha: true });
    const statusBruto = limparTexto(p.status, 30);
    if (statusBruto) {
      status = statusCanonico(statusBruto);
      if (!status) erros.status = 'Status inválido. Use: ' + STATUS.join(', ') + '.';
    } else {
      status = tecnico ? 'Atendimento atribuído' : 'Novo';
    }
  }

  const campos = Object.keys(erros);
  if (campos.length) return { ok: false, mensagem: erros[campos[0]], erros };

  const slaBruto = limparTexto(p.sla, LIMITES.sla);
  const sla = slaBruto || calcularSlaPorPrioridade(prioridade);
  const asset = limparTexto(p.asset, LIMITES.asset) || 'Nenhum';
  const timeSpentNum = Number(p.time_spent ?? p.timeSpent ?? 0);
  const time_spent = Number.isFinite(timeSpentNum) && timeSpentNum >= 0 ? Math.round(timeSpentNum * 100) / 100 : 0;
  const solution = admin ? limparTexto(p.solution, LIMITES.solution, { multilinha: true }) : '';

  return {
    ok: true,
    dados: {
      client_name: escaparHtml(nome),
      client_email: email,
      client_phone: escaparHtml(telefone),
      client_cpf: cpf,
      service_type: categoria,
      ticket_type: tipo,
      fila,
      priority: prioridade,
      title: escaparHtml(titulo),
      description: escaparHtml(descricao),
      canal_atendimento: escaparHtml(canal),
      status,
      tecnico_responsavel: tecnico,
      admin_notes: notas,
      sla: escaparHtml(sla),
      asset: escaparHtml(asset),
      time_spent,
      solution: escaparHtml(solution),
      timeline: Array.isArray(p.timeline) ? p.timeline : null
    }
  };
}

function montarOrdem(dados, { protocolo, id, agoraIso }) {
  const isResolvido = statusEncerrado(dados.status);
  let timelineInicial = Array.isArray(dados.timeline) && dados.timeline.length > 0
    ? dados.timeline
    : [
        {
          sender: 'Solicitante',
          author: dados.client_name || 'Solicitante',
          text: 'Chamado aberto via GLPI Service Desk (' + (dados.ticket_type || TIPO_PADRAO).toLowerCase() + '). Aguardando atribuição técnica.',
          date: agoraIso,
          internal: false
        }
      ];
  if (dados.fila && !(Array.isArray(dados.timeline) && dados.timeline.length > 0)) {
    timelineInicial = [...timelineInicial, eventoDeSistema('Chamado encaminhado para a fila "' + dados.fila + '".', { agoraIso, autor: 'Sistema' })];
  }
  return {
    id,
    protocol: protocolo,
    client_name: dados.client_name,
    client_email: dados.client_email,
    client_phone: dados.client_phone,
    client_cpf: dados.client_cpf,
    service_type: dados.service_type,
    ticket_type: dados.ticket_type || TIPO_PADRAO,
    fila: dados.fila || null,
    priority: dados.priority,
    title: dados.title,
    description: dados.description,
    status: dados.status,
    admin_notes: dados.admin_notes,
    tecnico_responsavel: dados.tecnico_responsavel,
    assumido_em: dados.tecnico_responsavel ? agoraIso : null,
    canal_atendimento: dados.canal_atendimento,
    sla: dados.sla || calcularSlaPorPrioridade(dados.priority),
    asset: dados.asset || 'Nenhum',
    time_spent: Number(dados.time_spent) || 0,
    solution: dados.solution || '',
    timeline: timelineInicial,
    concluido_em: isResolvido ? agoraIso : null,
    created_at: agoraIso,
    updated_at: agoraIso
  };
}

// Mesma pessoa reenviando o mesmo chamado em poucos minutos (duplo clique, "voltar e enviar de novo"): devolve o já aberto
function encontrarDuplicada(lista, dados, { agora = Date.now(), janelaMs = 10 * 60 * 1000 } = {}) {
  const chave = (t) => String(t == null ? '' : t).toLowerCase().replace(/\s+/g, ' ').trim();
  return (Array.isArray(lista) ? lista : []).find((o) => {
    if (!o || o.status === 'Fechado' || o.status === 'Cancelado') return false;
    if (String(o.client_email || '').toLowerCase().trim() !== dados.client_email) return false;
    if (chave(o.title) !== chave(dados.title) || chave(o.description) !== chave(dados.description)) return false;
    const criadoEm = Date.parse(o.created_at);
    return Number.isFinite(criadoEm) && agora - criadoEm >= 0 && agora - criadoEm <= janelaMs;
  }) || null;
}

// ---------- Filas de atendimento ----------
// Uma fila reúne os técnicos que atendem certos tipos de chamado: { id, nome, descricao, categorias[], tecnicos[] (e-mails), ativa }.
// O chamado guarda o NOME da fila; ao abrir, cai na fila que atende a categoria (se houver uma).
function acharFila(filas, valor) {
  const chave = chaveDe(valor);
  if (!chave) return null;
  return (Array.isArray(filas) ? filas : []).find((f) => f && (chaveDe(f.nome) === chave || chaveDe(f.id) === chave)) || null;
}

function filaDaCategoria(filas, categoria) {
  const chave = chaveDe(categoria);
  if (!chave) return null;
  const fila = (Array.isArray(filas) ? filas : []).find((f) => f && f.ativa !== false && Array.isArray(f.categorias) && f.categorias.some((c) => chaveDe(c) === chave));
  return fila ? fila.nome : null;
}

// A fila que já existe desde o início: o segundo nível de suporte técnico (recebe falhas, bugs e atendimento técnico)
function filasIniciais(agoraIso = new Date().toISOString()) {
  return [{
    id: 'suporte-tecnico-n2',
    nome: 'Suporte Técnico N2',
    descricao: 'Segundo nível de suporte: atendimento técnico, falhas, bugs e correções.',
    categorias: ['Atendimento Técnico', 'Falhas/Bugs/Correções'],
    tecnicos: [],
    ativa: true,
    criada_em: agoraIso
  }];
}

function idDaFila(nome, existentes) {
  const base = chaveDe(nome).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'fila';
  const usados = new Set((Array.isArray(existentes) ? existentes : []).map((f) => String(f.id)));
  let id = base;
  for (let n = 2; usados.has(id); n++) id = base + '-' + n;
  return id;
}

const NOME_FILA_VALIDO = /^[A-Za-zÀ-ÖØ-öø-ÿ0-9][A-Za-zÀ-ÖØ-öø-ÿ0-9 .,\-_/()&+]*$/;

/**
 * Valida o cadastro/edição de uma fila. `existentes` serve para barrar nome repetido e para achar a fila editada (payload.id).
 * Retorna { ok: true, fila, anterior } (anterior = a fila antes da edição, ou null) ou { ok: false, mensagem, erros }.
 */
function validarFila(payload, { existentes = [], agoraIso = new Date().toISOString(), emailValido } = {}) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const lista = Array.isArray(existentes) ? existentes : [];
  const ehEmail = typeof emailValido === 'function' ? emailValido : (e) => e.length <= 254 && EMAIL_PADRAO.test(e);
  const erros = {};

  const anterior = p.id ? lista.find((f) => String(f.id) === String(p.id)) || null : null;
  if (p.id && !anterior) return { ok: false, mensagem: 'Fila não encontrada.', erros: { id: 'Fila não encontrada.' } };

  const nome = limparTexto(p.nome !== undefined ? p.nome : p.name, LIMITES.fila);
  if (nome.length < 3) erros.nome = 'Informe o nome da fila (mínimo de 3 caracteres).';
  else if (!NOME_FILA_VALIDO.test(nome)) erros.nome = 'Use apenas letras, números e os sinais . , - _ / ( ) & +';
  else if (lista.some((f) => (!anterior || f.id !== anterior.id) && chaveDe(f.nome) === chaveDe(nome))) erros.nome = 'Já existe uma fila com esse nome.';

  const descricao = limparTexto(p.descricao, 200);
  if (/[<>]/.test(descricao)) erros.descricao = 'A descrição não pode ter < ou >.';

  const categorias = [];
  for (const bruta of Array.isArray(p.categorias) ? p.categorias : []) {
    const categoria = categoriaCanonica(limparTexto(bruta, LIMITES.categoria));
    if (!categoria) { erros.categorias = 'Categoria inválida: ' + limparTexto(bruta, 40) + '.'; break; }
    if (!categorias.includes(categoria)) categorias.push(categoria);
  }

  const tecnicos = [];
  for (const bruto of Array.isArray(p.tecnicos) ? p.tecnicos : []) {
    const email = limparTexto(bruto, LIMITES.email).toLowerCase();
    if (!email || !ehEmail(email)) { erros.tecnicos = 'E-mail de técnico inválido: ' + limparTexto(bruto, 40) + '.'; break; }
    if (!tecnicos.includes(email)) tecnicos.push(email);
  }

  const campos = Object.keys(erros);
  if (campos.length) return { ok: false, mensagem: erros[campos[0]], erros };

  const fila = {
    id: anterior ? anterior.id : idDaFila(nome, lista),
    nome,
    descricao,
    categorias,
    tecnicos,
    ativa: p.ativa === undefined ? (anterior ? anterior.ativa !== false : true) : p.ativa !== false,
    criada_em: anterior && anterior.criada_em ? anterior.criada_em : agoraIso,
    atualizada_em: agoraIso
  };
  return { ok: true, fila, anterior };
}

// ---------- Atualização (administrador) ----------
// Linha do histórico gerada pelo sistema ("Status alterado…"): o solicitante vê as públicas; as internas são só da equipe
function eventoDeSistema(texto, { agoraIso, autor, interno = false }) {
  return { sender: 'Sistema', author: limparTexto(autor || '', 120) || 'Equipe TI', text: texto, date: agoraIso, internal: interno, event: true };
}

/**
 * Aplica as mudanças do administrador sobre um chamado existente.
 * Só altera o que veio no pedido (antes, enviar apenas as notas devolvia o chamado para o início da fila).
 * Cada mudança relevante (status, técnico, severidade, tipo, fila) vira uma linha automática no histórico; categoria, ativo e
 * horas viram linhas internas. Se a severidade mudar e o pedido não trouxer o SLA, o prazo é recalculado pela política.
 * Coerência do status: ao atribuir um técnico a um chamado "Novo" ele passa a "Atendimento atribuído"; ao tirar o técnico de
 * um chamado "Atendimento atribuído" ele volta a "Novo" (a menos que o pedido já traga o status).
 * `filas` (opcional) é o catálogo de filas: com ele, só se aceita uma fila cadastrada.
 * Retorna { ok: true, ordem, mudancas } ou { ok: false, mensagem }.
 */
function aplicarAtualizacao(ordemBruta, payload, { agoraIso, ator, filas } = {}) {
  const ordem = normalizarOrdem(ordemBruta) || ordemBruta;
  const p = payload && typeof payload === 'object' ? payload : {};
  const novo = { ...ordem };
  if (Array.isArray(ordem.timeline)) {
    novo.timeline = ordem.timeline.map((item) => ({ ...item }));
  }
  const mudancas = [];
  const eventos = [];
  const autorDoEvento = ator || ordem.tecnico_responsavel || 'Equipe TI';
  const publico = (texto) => eventos.push(eventoDeSistema(texto, { agoraIso, autor: autorDoEvento }));
  const interno = (texto) => eventos.push(eventoDeSistema(texto, { agoraIso, autor: autorDoEvento, interno: true }));
  const veio = (valor) => valor !== undefined && String(valor).trim() !== '';

  let statusPedido = false;
  if (veio(p.status)) {
    const status = statusCanonico(p.status);
    if (!status) return { ok: false, mensagem: 'Status inválido. Use: ' + STATUS.join(', ') + '.' };
    statusPedido = true;
    if (status !== ordem.status) {
      mudancas.push('status: ' + (ordem.status || '—') + ' → ' + status);
      publico('Status alterado de "' + (ordem.status || '—') + '" para "' + status + '".');
    }
    novo.status = status;
  }

  let prioridadeMudou = false;
  if (veio(p.priority)) {
    const prioridade = prioridadeCanonica(p.priority);
    if (!prioridade) return { ok: false, mensagem: 'Severidade inválida. Use: ' + PRIORIDADES.join(', ') + '.' };
    if (prioridade !== ordem.priority) {
      mudancas.push('severidade: ' + (ordem.priority || '—') + ' → ' + prioridade);
      prioridadeMudou = true;
    }
    novo.priority = prioridade;
  }

  if (veio(p.ticket_type !== undefined ? p.ticket_type : p.tipo)) {
    const tipo = tipoCanonico(p.ticket_type !== undefined ? p.ticket_type : p.tipo);
    if (!tipo) return { ok: false, mensagem: 'Tipo inválido. Use: ' + TIPOS.join(' ou ') + '.' };
    if (tipo !== ordem.ticket_type) {
      mudancas.push('tipo: ' + (ordem.ticket_type || '—') + ' → ' + tipo);
      publico('Tipo do chamado alterado de "' + (ordem.ticket_type || '—') + '" para "' + tipo + '".');
    }
    novo.ticket_type = tipo;
  }

  if (veio(p.service_type)) {
    const bruta = limparTexto(p.service_type, LIMITES.categoria);
    // Chamados antigos podem ter categorias que já não estão no catálogo: mantê-las não é erro
    const categoria = categoriaCanonica(bruta) || (bruta === ordem.service_type ? bruta : null);
    if (!categoria) return { ok: false, mensagem: 'Categoria inválida.' };
    if (categoria !== ordem.service_type) {
      mudancas.push('categoria: ' + (ordem.service_type || '—') + ' → ' + categoria);
      interno('Categoria alterada de "' + (ordem.service_type || '—') + '" para "' + categoria + '".');
    }
    novo.service_type = categoria;
  }

  if (p.fila !== undefined) {
    const bruta = limparTexto(p.fila, LIMITES.fila);
    let filaNova = null;
    if (bruta) {
      const cadastrada = acharFila(filas, bruta);
      if (cadastrada) filaNova = cadastrada.nome;
      else if (!Array.isArray(filas) || bruta === ordem.fila) filaNova = bruta; // sem catálogo, ou a fila que o chamado já tinha
      else return { ok: false, mensagem: 'Fila inválida.' };
    }
    const anterior = ordem.fila || null;
    if (filaNova !== anterior) {
      mudancas.push('fila: ' + (anterior || '—') + ' → ' + (filaNova || '—'));
      if (filaNova && anterior) publico('Chamado transferido da fila "' + anterior + '" para a fila "' + filaNova + '".');
      else if (filaNova) publico('Chamado encaminhado para a fila "' + filaNova + '".');
      else publico('Chamado retirado da fila "' + anterior + '".');
    }
    novo.fila = filaNova;
  }

  if (veio(p.canal_atendimento)) {
    novo.canal_atendimento = limparTexto(p.canal_atendimento, LIMITES.canal);
  }

  if (p.admin_notes !== undefined) {
    novo.admin_notes = limparTexto(p.admin_notes, LIMITES.notas, { multilinha: true });
    if (novo.admin_notes !== (ordem.admin_notes || '')) mudancas.push('parecer atualizado');
  }

  if (p.tecnico_responsavel !== undefined) {
    const tecnico = limparTexto(p.tecnico_responsavel, LIMITES.tecnico) || null;
    const anterior = ordem.tecnico_responsavel || null;
    if (tecnico !== anterior) {
      mudancas.push('técnico: ' + (anterior || '—') + ' → ' + (tecnico || '—'));
      if (tecnico && !anterior) publico('Chamado assumido por ' + tecnico + '.');
      else if (tecnico) publico('Chamado reatribuído de ' + anterior + ' para ' + tecnico + '.');
      else publico('Atribuição removida (o responsável era ' + anterior + ').');
    }
    novo.tecnico_responsavel = tecnico;
    if (tecnico && !novo.assumido_em) novo.assumido_em = agoraIso;
    else if (!tecnico) novo.assumido_em = null;
    // Um chamado com técnico não fica "Novo", e sem técnico não fica "Atendimento atribuído"
    if (!statusPedido) {
      if (tecnico && novo.status === 'Novo') {
        novo.status = 'Atendimento atribuído';
        mudancas.push('status: Novo → Atendimento atribuído');
        publico('Status alterado de "Novo" para "Atendimento atribuído".');
      } else if (!tecnico && novo.status === 'Atendimento atribuído') {
        novo.status = 'Novo';
        mudancas.push('status: Atendimento atribuído → Novo');
        publico('Status alterado de "Atendimento atribuído" para "Novo".');
      }
    }
  }

  // O prazo acompanha a severidade, a menos que o pedido já traga um SLA próprio
  if (prioridadeMudou && !veio(p.sla)) {
    novo.sla = calcularSlaPorPrioridade(novo.priority);
  }
  if (prioridadeMudou) {
    publico('Severidade alterada de "' + (ordem.priority || '—') + '" para "' + novo.priority + '". Prazo de atendimento (SLA): ' + (veio(p.sla) ? limparTexto(p.sla, LIMITES.sla) : novo.sla) + '.');
  }

  if (veio(p.sla)) {
    const slaNovo = limparTexto(p.sla, LIMITES.sla);
    if (slaNovo && slaNovo !== (ordem.sla || '')) mudancas.push('SLA: ' + (ordem.sla || '—') + ' → ' + slaNovo);
    novo.sla = slaNovo;
  }

  if (p.asset !== undefined) {
    const assetNovo = limparTexto(p.asset, LIMITES.asset) || 'Nenhum';
    if (assetNovo !== (ordem.asset || 'Nenhum')) {
      mudancas.push('ativo CMDB: ' + (ordem.asset || 'Nenhum') + ' → ' + assetNovo);
      interno('Ativo CMDB vinculado: "' + (ordem.asset || 'Nenhum') + '" → "' + assetNovo + '".');
    }
    novo.asset = assetNovo;
  }

  if (p.time_spent !== undefined || p.timeSpent !== undefined) {
    const tsBruto = Number(p.time_spent ?? p.timeSpent);
    if (Number.isFinite(tsBruto) && tsBruto >= 0) {
      const tsNovo = Math.round(tsBruto * 100) / 100;
      if (tsNovo !== Number(ordem.time_spent || 0)) {
        mudancas.push('horas trabalhadas: ' + (ordem.time_spent || 0) + 'h → ' + tsNovo + 'h');
        interno('Horas trabalhadas: ' + (ordem.time_spent || 0) + 'h → ' + tsNovo + 'h.');
      }
      novo.time_spent = tsNovo;
    }
  }

  if (p.solution !== undefined) {
    const solNova = limparTexto(p.solution, LIMITES.solution, { multilinha: true });
    if (solNova !== (ordem.solution || '')) mudancas.push('solução definitiva registrada');
    novo.solution = solNova;
  }

  if (Array.isArray(p.timeline)) {
    novo.timeline = p.timeline
      .filter((item) => item && typeof item === 'object' && String(item.text || '').trim())
      .map((item) => ({
        sender: limparTexto(item.sender || 'Técnico', 40) || 'Técnico',
        author: limparTexto(item.author || '', 120) || 'Equipe TI',
        text: limparTexto(item.text, LIMITES.notas, { multilinha: true }),
        date: dataOuOriginal(item.date) || agoraIso,
        internal: Boolean(item.internal)
      }));
    mudancas.push('histórico GLPI atualizado');
  } else if (p.timeline_entry && typeof p.timeline_entry === 'object') {
    const txt = limparTexto(p.timeline_entry.text, LIMITES.notas, { multilinha: true });
    if (txt) {
      const listaAtual = Array.isArray(novo.timeline) ? [...novo.timeline] : [];
      const novaMsg = {
        sender: limparTexto(p.timeline_entry.sender || 'Técnico', 40) || 'Técnico',
        author: limparTexto(p.timeline_entry.author || novo.tecnico_responsavel || 'Equipe TI', 120),
        text: txt,
        date: dataOuOriginal(p.timeline_entry.date) || agoraIso,
        internal: Boolean(p.timeline_entry.internal)
      };
      listaAtual.push(novaMsg);
      novo.timeline = listaAtual;
      mudancas.push(novaMsg.internal ? 'nota interna TI adicionada' : 'resposta técnica registrada');
    }
  }

  // As linhas automáticas entram depois da resposta (se vier junto): "respondeu" e em seguida "status alterado"
  if (eventos.length) novo.timeline = [...(Array.isArray(novo.timeline) ? novo.timeline : []), ...eventos];

  // "Resolvido" e "Fechado" têm data de encerramento; Resolvido -> Fechado mantém a data em que foi resolvido
  if (statusEncerrado(novo.status)) {
    novo.concluido_em = paraIso(ordem.concluido_em) || agoraIso;
  } else {
    novo.concluido_em = null;
  }

  novo.updated_at = agoraIso;
  return { ok: true, ordem: novo, mudancas };
}

// ---------- O solicitante acompanha e responde o próprio chamado ----------
const PRAZO_REABERTURA_DIAS = 7;
const LIMITE_INTERACOES = 300;
// Encerrado = o atendimento terminou: "Resolvido" (solução entregue; o solicitante pode reabrir) ou "Fechado" (definitivo)
const STATUS_ENCERRADOS = Object.freeze(['Resolvido', 'Fechado']);
const statusEncerrado = (status) => STATUS_ENCERRADOS.includes(statusCanonico(status) || status);

// Só o chamado "Resolvido" pode ser reaberto (o "Fechado" é definitivo), até 7 dias depois de resolvido
function podeReabrir(ordemBruta, agora = Date.now()) {
  const ordem = normalizarOrdem(ordemBruta) || ordemBruta;
  if (ordem.status !== 'Resolvido') return false;
  const fechadoEm = Date.parse(paraIso(ordem.concluido_em) || paraIso(ordem.updated_at) || '');
  return !Number.isFinite(fechadoEm) || agora - fechadoEm <= PRAZO_REABERTURA_DIAS * 24 * 60 * 60 * 1000;
}

// Cancelar (= fechar) só enquanto o chamado é "Novo" e ninguém o assumiu
function podeCancelar(ordemBruta) {
  const ordem = normalizarOrdem(ordemBruta) || ordemBruta;
  return ordem.status === 'Novo' && !ordem.tecnico_responsavel && !ordem.assumido_em;
}

/**
 * O que o solicitante (dono do chamado, com login) enxerga: andamento completo, SEM o parecer interno, as notas privadas
 * da equipe nem as linhas internas do histórico. Inclui o que ele pode fazer agora (responder, reabrir, cancelar).
 */
function visaoSolicitante(ordemBruta, { agora = Date.now() } = {}) {
  const ordem = normalizarOrdem(ordemBruta) || ordemBruta;
  const status = ordem.status || 'Novo';
  const encerrado = statusEncerrado(status);
  return {
    protocol: ordem.protocol,
    status,
    priority: ordem.priority || PRIORIDADE_PADRAO,
    ticket_type: ordem.ticket_type || TIPO_PADRAO,
    service_type: ordem.service_type || CATEGORIA_PADRAO,
    fila: ordem.fila || null,
    title: ordem.title || '',
    description: ordem.description || '',
    sla: ordem.sla || calcularSlaPorPrioridade(ordem.priority),
    canal_atendimento: ordem.canal_atendimento || CANAL_PADRAO,
    tecnico_responsavel: ordem.tecnico_responsavel || null,
    solution: ordem.solution || '',
    created_at: paraIso(ordem.created_at),
    updated_at: paraIso(ordem.updated_at),
    assumido_em: paraIso(ordem.assumido_em),
    concluido_em: paraIso(ordem.concluido_em),
    timeline: (Array.isArray(ordem.timeline) ? ordem.timeline : [])
      .filter((item) => item && !item.internal)
      .map((item) => ({
        sender: item.sender || 'Técnico',
        author: item.author || '',
        text: item.text || '',
        date: paraIso(item.date),
        event: item.event === true || item.sender === 'Sistema'
      })),
    pode_responder: !encerrado,
    pode_reabrir: podeReabrir(ordem, agora),
    pode_cancelar: podeCancelar(ordem)
  };
}

/**
 * Ação do solicitante sobre o próprio chamado (a rota já conferiu que ele é o dono):
 *  - responder: mensagem na conversa; se a equipe aguardava o retorno ("Pendente"), o chamado volta para atendimento;
 *  - reabrir: só chamado resolvido, até 7 dias depois, com o motivo;
 *  - cancelar: só enquanto ninguém assumiu o chamado (ele fica "Fechado").
 * Retorna { ok: true, ordem, mudancas } ou { ok: false, mensagem, codigo } (400 = pedido inválido, 409 = estado não permite).
 */
function aplicarAcaoSolicitante(ordemBruta, payload, { agoraIso, agora = Date.now() }) {
  const ordem = normalizarOrdem(ordemBruta) || ordemBruta;
  const p = payload && typeof payload === 'object' ? payload : {};
  const acao = String(p.acao || 'responder').trim().toLowerCase();
  const texto = limparTexto(p.texto ?? p.text, LIMITES.notas, { multilinha: true });
  const autor = limparTexto(ordem.client_name || '', 120) || 'Solicitante';
  const recusa = (mensagem, codigo) => ({ ok: false, mensagem, codigo });

  if (!['responder', 'reabrir', 'cancelar'].includes(acao)) return recusa('Ação inválida. Use: responder, reabrir ou cancelar.', 400);

  const novo = { ...ordem, timeline: Array.isArray(ordem.timeline) ? ordem.timeline.map((item) => ({ ...item })) : [] };
  const mensagem = { sender: 'Solicitante', author: autor, text: texto, date: agoraIso, internal: false };
  const evento = (t) => eventoDeSistema(t, { agoraIso, autor });
  const mudancas = [];

  if (novo.timeline.length >= LIMITE_INTERACOES) return recusa('Este chamado atingiu o limite de mensagens. Abra um novo chamado informando o protocolo ' + ordem.protocol + '.', 409);

  if (acao === 'responder') {
    if (texto.length < 2) return recusa('Escreva a sua mensagem.', 400);
    if (ordem.status === 'Fechado') return recusa('Este chamado está fechado. Abra um novo chamado se ainda precisar de ajuda.', 409);
    if (statusEncerrado(ordem.status)) return recusa('Este chamado está resolvido. Use "Reabrir chamado" se o problema voltou.', 409);
    // Mesma mensagem enviada duas vezes seguidas (duplo clique): vale uma só
    // (as linhas automáticas do sistema não contam: a última "mensagem" é a última que não é evento)
    const ultima = [...novo.timeline].reverse().find((item) => item && item.sender !== 'Sistema');
    if (ultima && ultima.sender === 'Solicitante' && ultima.text === texto && Date.parse(ultima.date) && agora - Date.parse(ultima.date) < 60 * 1000) {
      return { ok: true, ordem: novo, mudancas: [] };
    }
    novo.timeline.push(mensagem);
    mudancas.push('resposta do solicitante');
    if (ordem.status === 'Pendente') {
      novo.status = ordem.tecnico_responsavel ? 'Atendimento atribuído' : 'Novo';
      novo.timeline.push(evento('Resposta recebida: o chamado voltou para atendimento.'));
      mudancas.push('status: Pendente → ' + novo.status);
    }
  } else if (acao === 'reabrir') {
    if (ordem.status === 'Fechado') return recusa('Este chamado está fechado e não pode ser reaberto. Abra um novo chamado informando o protocolo ' + ordem.protocol + '.', 409);
    if (ordem.status !== 'Resolvido') return recusa('Só é possível reabrir chamados resolvidos.', 409);
    if (!podeReabrir(ordem, agora)) return recusa('O prazo de ' + PRAZO_REABERTURA_DIAS + ' dias para reabrir terminou. Abra um novo chamado informando o protocolo ' + ordem.protocol + '.', 409);
    if (texto.length < 5) return recusa('Explique o que ainda não foi resolvido (mínimo de 5 caracteres).', 400);
    novo.status = ordem.tecnico_responsavel ? 'Atendimento atribuído' : 'Novo';
    novo.concluido_em = null;
    novo.timeline.push(mensagem, evento('Chamado reaberto pelo solicitante.'));
    mudancas.push('reaberto: ' + (ordem.status || '—') + ' → ' + novo.status);
  } else {
    if (!podeCancelar(ordem)) {
      return recusa(ordem.status === 'Fechado' ? 'Este chamado já foi fechado.' : 'O chamado já está em atendimento e não pode ser cancelado. Envie uma mensagem à equipe.', 409);
    }
    if (texto) novo.timeline.push(mensagem);
    novo.status = 'Fechado';
    novo.concluido_em = agoraIso;
    novo.timeline.push(evento('Chamado cancelado pelo solicitante e fechado.'));
    mudancas.push('cancelado pelo solicitante (fechado)');
  }

  novo.updated_at = agoraIso;
  return { ok: true, ordem: novo, mudancas };
}

// ---------- Leitura ----------
// Padroniza o que vem do SQL Server e do arquivo local: textos nunca nulos, datas sempre em ISO 8601 e os nomes de status,
// severidade e tipo sempre os atuais. Chamado gravado antes de existir o "tipo" (ticket_type vazio) é do modelo antigo, em que
// "Pendente" era o chamado recém-aberto: vira "Novo" (ou "Atendimento atribuído", se já tinha técnico).
function normalizarOrdem(linha) {
  if (!linha || typeof linha !== 'object') return null;
  const texto = (v) => (v == null ? '' : String(v));
  const priority = prioridadeCanonica(linha.priority) || PRIORIDADE_PADRAO;
  const createdAt = dataOuOriginal(linha.created_at);
  let timelineNormalizada = [];
  if (Array.isArray(linha.timeline)) {
    timelineNormalizada = linha.timeline;
  } else if (typeof linha.timeline === 'string' && linha.timeline.trim().startsWith('[')) {
    try { timelineNormalizada = JSON.parse(linha.timeline); } catch (_e) { timelineNormalizada = []; }
  }
  if (!Array.isArray(timelineNormalizada) || timelineNormalizada.length === 0) {
    timelineNormalizada = [
      {
        sender: 'Solicitante',
        author: texto(linha.client_name) || 'Solicitante',
        text: 'Chamado registrado na Central GLPI Service Desk.',
        date: createdAt,
        internal: false
      }
    ];
  }

  const tecnico = linha.tecnico_responsavel ? String(linha.tecnico_responsavel) : null;
  const antigo = !texto(linha.ticket_type).trim();
  const statusBruto = texto(linha.status).trim();
  let status;
  if (!statusBruto) status = 'Novo';
  else if (antigo && chaveDe(statusBruto) === 'pendente') status = tecnico ? 'Atendimento atribuído' : 'Novo';
  else status = statusCanonico(statusBruto) || statusBruto;

  const serviceType = texto(linha.service_type).trim() || CATEGORIA_PADRAO;
  let sla = texto(linha.sla).trim();
  if (!sla || (SLA_ANTIGO_PADRAO[priority] || []).includes(chaveDe(sla))) sla = calcularSlaPorPrioridade(priority);

  return {
    ...linha,
    protocol: texto(linha.protocol).trim(),
    client_name: texto(linha.client_name),
    client_email: texto(linha.client_email).toLowerCase().trim(),
    client_phone: texto(linha.client_phone),
    client_cpf: texto(linha.client_cpf),
    service_type: serviceType,
    ticket_type: tipoCanonico(linha.ticket_type) || tipoSugerido(serviceType),
    fila: texto(linha.fila).trim() || null,
    priority,
    title: texto(linha.title),
    description: texto(linha.description),
    status,
    admin_notes: texto(linha.admin_notes),
    tecnico_responsavel: tecnico,
    assumido_em: dataOuOriginal(linha.assumido_em),
    canal_atendimento: texto(linha.canal_atendimento) || CANAL_PADRAO,
    sla,
    asset: texto(linha.asset) || 'Nenhum',
    time_spent: Number.isFinite(Number(linha.time_spent)) ? Number(linha.time_spent) : 0,
    solution: texto(linha.solution),
    timeline: timelineNormalizada,
    concluido_em: dataOuOriginal(linha.concluido_em),
    created_at: createdAt,
    updated_at: dataOuOriginal(linha.updated_at)
  };
}

// Une as listas pelo protocolo; os itens de "preferidas" (banco) valem mais, mas o que só existe nas "outras"
// (arquivo local, por exemplo quando o banco estava fora do ar na abertura) não se perde. Mais recentes primeiro.
function mesclarOrdens(preferidas, outras) {
  const porChave = new Map();
  const chaveDaOrdem = (o) => normalizarProtocolo(o.protocol) || String(o.protocol || '').trim().toUpperCase() || 'id:' + o.id;
  for (const lista of [outras, preferidas]) {
    for (const bruta of Array.isArray(lista) ? lista : []) {
      const ordem = normalizarOrdem(bruta);
      if (!ordem) continue;
      const chave = chaveDaOrdem(ordem);
      const anterior = porChave.get(chave);
      if (anterior) {
        if ((!ordem.timeline || ordem.timeline.length <= 1) && Array.isArray(anterior.timeline) && anterior.timeline.length > 1) {
          ordem.timeline = anterior.timeline;
        }
        if (!ordem.solution && anterior.solution) ordem.solution = anterior.solution;
        if ((!ordem.asset || ordem.asset === 'Nenhum') && anterior.asset && anterior.asset !== 'Nenhum') ordem.asset = anterior.asset;
        if (!ordem.time_spent && anterior.time_spent) ordem.time_spent = anterior.time_spent;
      }
      porChave.set(chave, ordem);
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
function visaoPublica(ordemBruta, { detalhada = false } = {}) {
  const ordem = normalizarOrdem(ordemBruta) || ordemBruta;
  const resumo = {
    protocol: ordem.protocol,
    status: ordem.status || 'Novo',
    service_type: ordem.service_type || CATEGORIA_PADRAO,
    sla: ordem.sla || calcularSlaPorPrioridade(ordem.priority),
    created_at: paraIso(ordem.created_at),
    updated_at: paraIso(ordem.updated_at),
    concluido_em: paraIso(ordem.concluido_em)
  };
  if (!detalhada) return resumo;
  const timelinePublica = (Array.isArray(ordem.timeline) ? ordem.timeline : [])
    .filter((item) => item && !item.internal && item.sender === 'Técnico')
    .map((item) => ({
      sender: 'Técnico',
      text: item.text || '',
      date: paraIso(item.date)
    }));
  return {
    ...resumo,
    priority: ordem.priority || PRIORIDADE_PADRAO,
    ticket_type: ordem.ticket_type || TIPO_PADRAO,
    fila: ordem.fila || null,
    title: ordem.title || '',
    description: ordem.description || '',
    tecnico_responsavel: ordem.tecnico_responsavel || null,
    assumido_em: paraIso(ordem.assumido_em),
    canal_atendimento: ordem.canal_atendimento || CANAL_PADRAO,
    asset: ordem.asset || 'Nenhum',
    solution: ordem.solution || '',
    timeline: timelinePublica
  };
}

module.exports = {
  STATUS, PRIORIDADES, TIPOS, CATEGORIAS, CATEGORIAS_TIPO, CANAIS_PUBLICOS, CATEGORIA_PADRAO, CANAL_PADRAO, TIPO_PADRAO, PRIORIDADE_PADRAO, SLA_POLITICA, LIMITES,
  calcularSlaPorPrioridade, prioridadeCanonica, statusCanonico, tipoCanonico, categoriaCanonica, tipoSugerido,
  acharFila, filaDaCategoria, filasIniciais, validarFila,
  limparTexto, escaparHtml, paraIso,
  proximoProtocolo, numeroDoProtocolo, normalizarProtocolo, mesmaReferencia,
  formatarTelefone, mesmoNumero, validarCpf, soDigitos,
  validarAbertura, montarOrdem, encontrarDuplicada, aplicarAtualizacao,
  normalizarOrdem, mesclarOrdens,
  classificarConsulta, ordemCorresponde, visaoPublica,
  visaoSolicitante, aplicarAcaoSolicitante, podeReabrir, podeCancelar, statusEncerrado, PRAZO_REABERTURA_DIAS
};
