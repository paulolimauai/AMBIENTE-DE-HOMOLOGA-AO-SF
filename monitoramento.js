'use strict';

/**
 * Monitoramento de desvios do Nexus.
 *
 * Regras puras (sem banco, sem HTTP, sem relógio escondido): o server.js monta o contexto
 * ({ usuarios, ordens }) e chama executarVerificacoes(). Cada desvio encontrado vira uma
 * O.S. automática — uma por desvio, e só enquanto não houver chamado aberto com a mesma
 * marca (ver marcador()). O chamado fica na fila da categoria "Atendimento Técnico"
 * (Suporte Técnico N2), como qualquer outro incidente.
 */

const A = require('./atendimento');

const MARCA = '[MON:';
const SEVERIDADES = Object.freeze({ alta: 'Alta', media: 'Média', baixa: 'Baixa' });

const texto = (v) => String(v == null ? '' : v).trim();
const digitos = (v) => texto(v).replace(/\D/g, '');
const lower = (v) => texto(v).toLowerCase();
const paraMs = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

// Conta que é dono/proprietária ou administradora não entra nas verificações de assinatura
function ehPrivilegiado(u) {
  return !!u && (u.is_owner === true || lower(u.role) === 'administrador');
}
function contaAtiva(u) {
  return !!u && u.active !== false && u.active !== 0 && u.active !== '0';
}

/** Marca gravada no chamado automático: permite achar a O.S. do desvio sem tabela nova. */
function marcador(desvio) {
  return MARCA + desvio.codigo + ':' + desvio.chave + ']';
}

// O desvio já tem chamado em aberto? Procura a marca em admin_notes, descrição e timeline.
function osDoDesvio(ordens, desvio) {
  const marca = marcador(desvio);
  return (Array.isArray(ordens) ? ordens : []).find((o) => {
    if (!o || A.statusEncerrado(o.status)) return false;
    const alvo = [o.admin_notes, o.description, JSON.stringify(o.timeline || '')].join('\n');
    return alvo.includes(marca);
  }) || null;
}

function desvio(codigo, chave, titulo, descricao, severidade) {
  return { codigo, chave: texto(chave), titulo: texto(titulo).slice(0, 200), descricao: texto(descricao).slice(0, 4000), severidade: SEVERIDADES[severidade] || SEVERIDADES.media };
}

// ---------- Verificações ----------

// Assinatura vencida (ou teste de 24 h estourado) mas a conta continua liberada
function verificarAssinaturasVencidas(usuarios, agora) {
  const achados = [];
  usuarios.forEach((u) => {
    if (!u || !u.email || !contaAtiva(u) || ehPrivilegiado(u)) return;
    const expira = paraMs(u.subscription_expires_at);
    const status = lower(u.subscription_status);
    const plano = lower(u.subscription_plan);
    const vitalicio = plano === 'vitalicio' || plano === 'lifetime';
    let motivo = null;
    if (expira !== null && expira < agora && status !== 'active') {
      // vencida e o status já virou "expired": a conta devia estar bloqueada pela rotina
      motivo = 'Assinatura vencida em ' + new Date(expira).toLocaleDateString('pt-BR') + ' (status: ' + (u.subscription_status || '—') + '), mas o acesso continua liberado.';
    } else if (expira !== null && expira < agora && status === 'active') {
      motivo = 'Assinatura venceu em ' + new Date(expira).toLocaleDateString('pt-BR') + ', mas o status ainda consta como ativo e o acesso segue liberado.';
    } else if (expira === null && !vitalicio) {
      const teste = paraMs(u.trial_started_at);
      if (teste !== null && agora - teste > 24 * 60 * 60 * 1000 && !status) {
        motivo = 'Período de teste (24 h) encerrado em ' + new Date(teste + 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR') + ', mas o acesso continua liberado sem assinatura.';
      }
    }
    if (motivo) {
      achados.push(desvio('assinatura_vencida', lower(u.email),
        'Acesso liberado com assinatura vencida: ' + (u.name || u.email),
        'Conta ' + u.email + '. ' + motivo + ' Verificar se a rotina de assinaturas rodou e se o acesso deve ser bloqueado.',
        'alta'));
    }
  });
  return achados;
}

// Status "active" sem data de vencimento e sem plano vitalício: estado inconsistente
function verificarAssinaturasSemValidade(usuarios) {
  const achados = [];
  usuarios.forEach((u) => {
    if (!u || !u.email || !contaAtiva(u) || ehPrivilegiado(u)) return;
    if (lower(u.subscription_status) !== 'active') return;
    const plano = lower(u.subscription_plan);
    if (plano === 'vitalicio' || plano === 'lifetime') return;
    if (paraMs(u.subscription_expires_at) !== null) return;
    achados.push(desvio('assinatura_sem_validade', lower(u.email),
      'Assinatura ativa sem data de vencimento: ' + (u.name || u.email),
      'Conta ' + u.email + ' está com subscription_status "active" mas não tem subscription_expires_at nem plano vitalício. Revisar a assinatura no cadastro.',
      'media'));
  });
  return achados;
}

// Mesmo CPF em duas ou mais contas: cadastro duplicado ou fraude
function verificarCpfDuplicado(usuarios) {
  const porCpf = new Map();
  usuarios.forEach((u) => {
    if (!u || !u.email || !contaAtiva(u)) return;
    const cpf = digitos(u.cpf);
    if (cpf.length !== 11) return;
    if (!porCpf.has(cpf)) porCpf.set(cpf, []);
    porCpf.get(cpf).push(u);
  });
  const achados = [];
  porCpf.forEach((lista, cpf) => {
    if (lista.length < 2) return;
    const nomes = lista.map((u) => (u.name || u.email) + ' <' + u.email + '>').join(', ');
    achados.push(desvio('cpf_duplicado', cpf, 'CPF duplicado em ' + lista.length + ' contas',
      'O CPF ' + cpf + ' aparece em mais de uma conta ativa: ' + nomes + '. Conferir se são cadastros duplicados e unificar ou excluir.',
      'media'));
  });
  return achados;
}

// O.S. abertas paradas: "Novo" há mais de 2 dias ou qualquer status aberto há mais de 7 dias
function verificarOrdensAtrasadas(ordens, agora) {
  const abertas = (Array.isArray(ordens) ? ordens : []).filter((o) => o && !A.statusEncerrado(o.status));
  const novasParadas = [];
  const atrasadas = [];
  const DOIS_DIAS = 2 * 24 * 60 * 60 * 1000;
  const SETE_DIAS = 7 * 24 * 60 * 60 * 1000;
  abertas.forEach((o) => {
    const criado = paraMs(o.created_at);
    if (criado === null) return;
    const idade = agora - criado;
    if (idade < 0) return;
    if (o.status === 'Novo' && idade > DOIS_DIAS) novasParadas.push(o);
    else if (idade > SETE_DIAS) atrasadas.push(o);
  });
  const achados = [];
  const listaTxt = (l) => l.map((o) => o.protocol + ' (' + o.status + ', ' + Math.floor((agora - paraMs(o.created_at)) / 86400000) + 'd)').join(', ');
  if (novasParadas.length) {
    achados.push(desvio('os_nova_parada', 'todas',
      novasParadas.length + (novasParadas.length > 1 ? ' chamados novos parados' : ' chamado novo parado'),
      'Chamados em "Novo" há mais de 2 dias sem atribuição: ' + listaTxt(novasParadas) + '. Verificar a fila de atendimento.',
      'media'));
  }
  if (atrasadas.length) {
    achados.push(desvio('os_atrasada', 'todas',
      atrasadas.length + (atrasadas.length > 1 ? ' chamados abertos há mais de 7 dias' : ' chamado aberto há mais de 7 dias'),
      'Chamados fora do prazo de atendimento (5 dias úteis): ' + listaTxt(atrasadas) + '. Revisar e dar andamento ou escalar.',
      'alta'));
  }
  return achados;
}

/**
 * Executa todas as verificações. ctx: { usuarios, ordens, agora? }.
 * Devolve a lista de desvios (cada um com codigo/chave únicos para deduplicar o chamado).
 */
function executarVerificacoes(ctx) {
  const c = ctx || {};
  const usuarios = Array.isArray(c.usuarios) ? c.usuarios : [];
  const ordens = Array.isArray(c.ordens) ? c.ordens : [];
  const agora = Number.isFinite(c.agora) ? c.agora : Date.now();
  return [
    ...verificarAssinaturasVencidas(usuarios, agora),
    ...verificarAssinaturasSemValidade(usuarios),
    ...verificarCpfDuplicado(usuarios),
    ...verificarOrdensAtrasadas(ordens, agora)
  ];
}

module.exports = { MARCA, marcador, osDoDesvio, executarVerificacoes };
