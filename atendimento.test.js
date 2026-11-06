'use strict';

// Testes das regras da Central de Atendimento. Rodar com: npm test  (ou: node --test atendimento.test.js)
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('./atendimento');

const AGORA = '2026-11-06T15:00:00.000Z';
const pedidoValido = () => ({
  client_name: '  Maria   da Silva ',
  client_email: 'Maria@Exemplo.com',
  client_phone: '62992345372',
  client_cpf: '529.982.247-25',
  service_type: 'reset de senha',
  priority: 'alta',
  title: 'Não consigo entrar',
  description: 'Esqueci a senha e o e-mail de recuperação não chega.',
  canal_atendimento: 'Tela de Login'
});

// ---------- Protocolo ----------
test('gerarProtocolo cria OS-AAMMDD-XXXX com data de Brasília e alfabeto sem ambiguidade', async () => {
  // 02:00 UTC de 07/11 ainda é 06/11 (23:00) em Brasília
  const protocolo = await A.gerarProtocolo(() => false, new Date('2026-11-07T02:00:00.000Z'));
  assert.match(protocolo, /^OS-261106-[A-HJ-NP-Z2-9]{4}$/);
});

test('gerarProtocolo tenta de novo quando o protocolo já existe e falha se não achar um livre', async () => {
  let chamadas = 0;
  const protocolo = await A.gerarProtocolo(async () => ++chamadas < 3);
  assert.equal(chamadas, 3);
  assert.match(protocolo, /^OS-\d{6}-[A-Z2-9]{4}$/);
  await assert.rejects(() => A.gerarProtocolo(() => true), /protocolo único/);
});

test('gerarProtocolo não repete em 5 mil geracoes seguidas', async () => {
  const vistos = new Set();
  for (let i = 0; i < 5000; i++) {
    const p = await A.gerarProtocolo((x) => vistos.has(x));
    assert.ok(!vistos.has(p));
    vistos.add(p);
  }
});

test('normalizarProtocolo aceita #, minúsculas, espaços e protocolos antigos', () => {
  assert.equal(A.normalizarProtocolo('#os-261106-k7qx'), 'OS-261106-K7QX');
  assert.equal(A.normalizarProtocolo(' OS 261106 K7QX '), 'OS-261106-K7QX');
  assert.equal(A.normalizarProtocolo('os261106k7qx'), 'OS-261106-K7QX');
  assert.equal(A.normalizarProtocolo('OS-24448467'), 'OS-24448467');
  assert.equal(A.normalizarProtocolo('OS-261106-K0QX'), null); // 0 não existe no alfabeto
  assert.equal(A.normalizarProtocolo('maria@exemplo.com'), null);
  assert.equal(A.normalizarProtocolo(''), null);
});

test('mesmaReferencia compara por id ou por protocolo normalizado', () => {
  const ordem = { id: '6', protocol: 'OS-24448467' };
  assert.ok(A.mesmaReferencia(ordem, 6));
  assert.ok(A.mesmaReferencia(ordem, '#os-24448467'));
  assert.ok(!A.mesmaReferencia(ordem, 'OS-24448468'));
  assert.ok(!A.mesmaReferencia(ordem, ''));
  assert.ok(!A.mesmaReferencia(null, '6'));
});

// ---------- Abertura ----------
test('validarAbertura normaliza e escapa o pedido do público', () => {
  const r = A.validarAbertura({ ...pedidoValido(), title: 'Erro <b>grave</b> & "urgente"' });
  assert.equal(r.ok, true);
  const d = r.dados;
  assert.equal(d.client_name, 'Maria da Silva');
  assert.equal(d.client_email, 'maria@exemplo.com');
  assert.equal(d.client_phone, '(62) 99234-5372');
  assert.equal(d.client_cpf, '52998224725');
  assert.equal(d.service_type, 'Reset de Senha');
  assert.equal(d.priority, 'Alta');
  assert.equal(d.title, 'Erro &lt;b&gt;grave&lt;/b&gt; &amp; &quot;urgente&quot;');
  assert.equal(d.status, 'Pendente');
  assert.equal(d.tecnico_responsavel, null);
  assert.equal(d.canal_atendimento, 'Tela de Login');
});

test('validarAbertura do público ignora status, técnico, notas e canal interno', () => {
  const r = A.validarAbertura({
    ...pedidoValido(), status: 'Concluído', tecnico_responsavel: 'Fulano', admin_notes: 'nota', canal_atendimento: 'Telefone'
  });
  assert.equal(r.ok, true);
  assert.equal(r.dados.status, 'Pendente');
  assert.equal(r.dados.tecnico_responsavel, null);
  assert.equal(r.dados.admin_notes, '');
  assert.equal(r.dados.canal_atendimento, 'Portal Web');
});

test('validarAbertura recusa pedido incompleto com mensagem específica', () => {
  const casos = [
    [{ client_name: '' }, 'Informe seu nome.'],
    [{ client_email: 'sem-arroba' }, 'Informe um e-mail válido.'],
    [{ client_email: '<img onerror=x>@x.com' }, 'Informe um e-mail válido.'],
    [{ client_phone: '123' }, 'Informe o telefone com DDD (ex.: (62) 99999-9999).'],
    [{ service_type: 'Hackear o sistema' }, 'Selecione uma categoria válida.'],
    [{ priority: 'Crítica máxima' }, 'Prioridade inválida.'],
    [{ title: 'ab' }, 'Informe o assunto do chamado.'],
    [{ description: 'curta' }, 'Descreva o que você precisa com um pouco mais de detalhes (mínimo de 10 caracteres).']
  ];
  for (const [troca, mensagem] of casos) {
    const r = A.validarAbertura({ ...pedidoValido(), ...troca });
    assert.equal(r.ok, false, JSON.stringify(troca));
    assert.equal(r.mensagem, mensagem, JSON.stringify(troca));
  }
});

test('validarAbertura descarta CPF inválido sem barrar o chamado e telefone é opcional', () => {
  const r = A.validarAbertura({ ...pedidoValido(), client_cpf: '111.111.111-11', client_phone: '' });
  assert.equal(r.ok, true);
  assert.equal(r.dados.client_cpf, '');
  assert.equal(r.dados.client_phone, '');
});

test('validarAbertura aceita telefone com +55 e formata', () => {
  const r = A.validarAbertura({ ...pedidoValido(), client_phone: '+55 (62) 99234-5372' });
  assert.equal(r.dados.client_phone, '+55 (62) 99234-5372');
  const fixo = A.validarAbertura({ ...pedidoValido(), client_phone: '6232345372' });
  assert.equal(fixo.dados.client_phone, '(62) 3234-5372');
});

test('validarAbertura limita tamanhos e remove caracteres de controle', () => {
  const r = A.validarAbertura({ ...pedidoValido(), title: 'T\u0000í\u0007tulo ' + 'x'.repeat(400), description: 'a'.repeat(9000) });
  assert.equal(r.ok, true);
  assert.ok(r.dados.title.length <= 200);
  assert.ok(!/[\u0000-\u0008]/.test(r.dados.title));
  assert.equal(r.dados.description.length, 5000);
});

test('validarAbertura como administrador define status, técnico e notas e aceita descrição curta', () => {
  const r = A.validarAbertura({
    ...pedidoValido(), description: 'bug', canal_atendimento: 'Telefone', tecnico_responsavel: 'Carlos', admin_notes: 'Cliente ligou'
  }, { admin: true });
  assert.equal(r.ok, true);
  assert.equal(r.dados.status, 'Em Andamento'); // técnico definido => em andamento
  assert.equal(r.dados.tecnico_responsavel, 'Carlos');
  assert.equal(r.dados.admin_notes, 'Cliente ligou');
  assert.equal(r.dados.canal_atendimento, 'Telefone');
  const invalido = A.validarAbertura({ ...pedidoValido(), status: 'Qualquer coisa' }, { admin: true });
  assert.equal(invalido.ok, false);
  assert.equal(invalido.mensagem, 'Status inválido.');
});

test('validarAbertura usa o validador de e-mail do servidor quando informado', () => {
  const r = A.validarAbertura(pedidoValido(), { isEmail: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.erros.client_email, 'Informe um e-mail válido.');
});

test('montarOrdem preenche datas e marca assumido/concluído conforme o status', () => {
  const dados = A.validarAbertura({ ...pedidoValido(), status: 'Concluído', tecnico_responsavel: 'Ana' }, { admin: true }).dados;
  const ordem = A.montarOrdem(dados, { protocolo: 'OS-261106-K7QX', id: 99, agoraIso: AGORA });
  assert.equal(ordem.assumido_em, AGORA);
  assert.equal(ordem.concluido_em, AGORA);
  assert.equal(ordem.created_at, AGORA);
  const aberta = A.montarOrdem(A.validarAbertura(pedidoValido()).dados, { protocolo: 'OS-261106-K7QY', id: 100, agoraIso: AGORA });
  assert.equal(aberta.assumido_em, null);
  assert.equal(aberta.concluido_em, null);
});

test('encontrarDuplicada acha o mesmo pedido recente e ignora antigos, cancelados e de outro e-mail', () => {
  const dados = A.validarAbertura(pedidoValido()).dados;
  const agora = Date.parse(AGORA);
  const base = { client_email: dados.client_email, title: dados.title, description: dados.description, status: 'Pendente' };
  const recente = { ...base, protocol: 'A', created_at: new Date(agora - 60 * 1000).toISOString() };
  assert.equal(A.encontrarDuplicada([recente], dados, { agora }).protocol, 'A');
  assert.equal(A.encontrarDuplicada([{ ...recente, created_at: new Date(agora - 3600 * 1000).toISOString() }], dados, { agora }), null);
  assert.equal(A.encontrarDuplicada([{ ...recente, status: 'Cancelado' }], dados, { agora }), null);
  assert.equal(A.encontrarDuplicada([{ ...recente, client_email: 'outro@exemplo.com' }], dados, { agora }), null);
  assert.equal(A.encontrarDuplicada([], dados, { agora }), null);
});

// ---------- Atualização ----------
const ordemBase = () => A.montarOrdem(A.validarAbertura(pedidoValido()).dados, { protocolo: 'OS-261106-K7QX', id: 1, agoraIso: '2026-11-06T12:00:00.000Z' });

test('aplicarAtualizacao só com notas não muda o status (antes voltava para Pendente)', () => {
  const concluida = { ...ordemBase(), status: 'Concluído', concluido_em: '2026-11-06T13:00:00.000Z' };
  const r = A.aplicarAtualizacao(concluida, { id: 1, admin_notes: 'Resolvido por telefone.' }, { agoraIso: AGORA });
  assert.equal(r.ok, true);
  assert.equal(r.ordem.status, 'Concluído');
  assert.equal(r.ordem.concluido_em, '2026-11-06T13:00:00.000Z');
  assert.equal(r.ordem.admin_notes, 'Resolvido por telefone.');
  assert.deepEqual(r.mudancas, ['parecer atualizado']);
});

test('aplicarAtualizacao assume e conclui com carimbos de data corretos', () => {
  const assumida = A.aplicarAtualizacao(ordemBase(), { status: 'em andamento', tecnico_responsavel: 'Carlos' }, { agoraIso: AGORA });
  assert.equal(assumida.ordem.status, 'Em Andamento');
  assert.equal(assumida.ordem.assumido_em, AGORA);
  assert.equal(assumida.ordem.concluido_em, null);
  const concluida = A.aplicarAtualizacao(assumida.ordem, { status: 'Concluído' }, { agoraIso: '2026-11-06T16:00:00.000Z' });
  assert.equal(concluida.ordem.concluido_em, '2026-11-06T16:00:00.000Z');
  assert.equal(concluida.ordem.assumido_em, AGORA);
  const reaberta = A.aplicarAtualizacao(concluida.ordem, { status: 'Pendente', tecnico_responsavel: '' }, { agoraIso: '2026-11-06T17:00:00.000Z' });
  assert.equal(reaberta.ordem.concluido_em, null);
  assert.equal(reaberta.ordem.assumido_em, null);
  assert.equal(reaberta.ordem.tecnico_responsavel, null);
});

test('aplicarAtualizacao recusa status, prioridade e categoria inválidos mas mantém categoria antiga do histórico', () => {
  assert.equal(A.aplicarAtualizacao(ordemBase(), { status: 'Sumiu' }, { agoraIso: AGORA }).ok, false);
  assert.equal(A.aplicarAtualizacao(ordemBase(), { priority: 'Imediata' }, { agoraIso: AGORA }).ok, false);
  assert.equal(A.aplicarAtualizacao(ordemBase(), { service_type: 'Outra coisa' }, { agoraIso: AGORA }).ok, false);
  const antiga = { ...ordemBase(), service_type: 'Categoria Antiga' };
  assert.equal(A.aplicarAtualizacao(antiga, { service_type: 'Categoria Antiga', status: 'Concluído' }, { agoraIso: AGORA }).ok, true);
});

test('aplicarAtualizacao não altera o chamado original (imutável)', () => {
  const original = ordemBase();
  const copia = JSON.stringify(original);
  A.aplicarAtualizacao(original, { status: 'Concluído', admin_notes: 'x' }, { agoraIso: AGORA });
  assert.equal(JSON.stringify(original), copia);
});

// ---------- Leitura ----------
test('paraIso converte o texto de data do SQL Server (Brasília) e datas comuns', () => {
  assert.equal(A.paraIso('Nov  2 2026 12:24PM'), '2026-11-02T15:24:00.000Z');
  assert.equal(A.paraIso('Nov  2 2026 12:05AM'), '2026-11-02T03:05:00.000Z');
  assert.equal(A.paraIso('2026-09-16T01:45:53.306Z'), '2026-09-16T01:45:53.306Z');
  assert.equal(A.paraIso(new Date('2026-01-01T00:00:00Z')), '2026-01-01T00:00:00.000Z');
  assert.equal(A.paraIso(''), null);
  assert.equal(A.paraIso('isso não é data'), null);
});

test('normalizarOrdem troca nulos por texto vazio e padroniza datas', () => {
  const o = A.normalizarOrdem({ id: 1, protocol: ' OS-1234567 ', client_email: 'A@B.COM', client_phone: null, status: null, concluido_em: 'Nov  2 2026 12:24PM', created_at: '2026-11-02T15:10:44.484Z' });
  assert.equal(o.client_phone, '');
  assert.equal(o.status, 'Pendente');
  assert.equal(o.client_email, 'a@b.com');
  assert.equal(o.concluido_em, '2026-11-02T15:24:00.000Z');
  assert.equal(o.tecnico_responsavel, null);
  assert.equal(A.normalizarOrdem(null), null);
});

test('mesclarOrdens: banco vence, o que só existe localmente é mantido, mais recentes primeiro', () => {
  const banco = [{ id: 5, protocol: 'OS-261106-AAAA', status: 'Concluído', created_at: '2026-11-06T10:00:00Z' }];
  const local = [
    { id: 'x', protocol: 'OS-261106-AAAA', status: 'Pendente', created_at: '2026-11-06T10:00:00Z' },
    { id: 'y', protocol: 'OS-261105-BBBB', status: 'Pendente', created_at: '2026-11-05T10:00:00Z' },
    { id: 'z', protocol: 'OS-261107-CCCC', status: 'Pendente', created_at: '2026-11-07T10:00:00Z' }
  ];
  const r = A.mesclarOrdens(banco, local);
  assert.deepEqual(r.map((o) => o.protocol), ['OS-261107-CCCC', 'OS-261106-AAAA', 'OS-261105-BBBB']);
  assert.equal(r.find((o) => o.protocol === 'OS-261106-AAAA').status, 'Concluído');
});

// ---------- Consulta pública ----------
test('classificarConsulta separa protocolo, e-mail, número e inválido', () => {
  assert.deepEqual(A.classificarConsulta('#OS-261106-K7QX'), { tipo: 'protocolo', valor: 'OS-261106-K7QX' });
  assert.deepEqual(A.classificarConsulta(' Maria@Exemplo.com '), { tipo: 'email', valor: 'maria@exemplo.com' });
  assert.deepEqual(A.classificarConsulta('(62) 99234-5372'), { tipo: 'numero', valor: '62992345372' });
  assert.deepEqual(A.classificarConsulta('040.233.261-00'), { tipo: 'numero', valor: '04023326100' });
  for (const ruim of ['', 'maria', 'ab', '123', 'maria@', "' OR 1=1 --", '%']) {
    assert.equal(A.classificarConsulta(ruim).tipo, 'invalida', ruim);
  }
});

test('ordemCorresponde exige correspondência exata (não aceita pedaço de e-mail, nome ou título)', () => {
  const ordem = { protocol: 'OS-24448467', client_email: 'paulolp0101@gmail.com', client_phone: '(62) 99234-5372', client_cpf: '04023326100', client_name: 'PAULO', title: 'ajuste' };
  assert.ok(A.ordemCorresponde(ordem, A.classificarConsulta('os-24448467')));
  assert.ok(A.ordemCorresponde(ordem, A.classificarConsulta('PauloLP0101@gmail.com')));
  assert.ok(A.ordemCorresponde(ordem, A.classificarConsulta('62992345372')));
  assert.ok(A.ordemCorresponde(ordem, A.classificarConsulta('+55 62 99234-5372')));
  assert.ok(A.ordemCorresponde(ordem, A.classificarConsulta('040.233.261-00')));
  assert.ok(!A.ordemCorresponde(ordem, A.classificarConsulta('paulolp0101@gmail.co')));
  assert.ok(!A.ordemCorresponde(ordem, A.classificarConsulta('99234-5372')));
  assert.ok(!A.ordemCorresponde(ordem, { tipo: 'invalida' }));
});

test('visaoPublica nunca expõe dados pessoais, parecer interno nem id; resumo não mostra título/descrição', () => {
  const ordem = {
    id: 6, protocol: 'OS-24448467', client_name: 'PAULO', client_email: 'p@x.com', client_phone: '62999999999', client_cpf: '04023326100',
    service_type: 'Correção de Dados', priority: 'Alta', title: 'ajuste', description: 'bug no cartão', status: 'Concluído',
    admin_notes: 'Protocolo LIB-ADMIN-PIX interno', tecnico_responsavel: 'Carlos', assumido_em: AGORA, canal_atendimento: 'Tela de Login',
    concluido_em: 'Nov  2 2026 12:24PM', created_at: AGORA, updated_at: AGORA
  };
  const completo = A.visaoPublica(ordem, { detalhada: true });
  const resumo = A.visaoPublica(ordem);
  for (const visao of [completo, resumo]) {
    const texto = JSON.stringify(visao);
    for (const segredo of ['PAULO', 'p@x.com', '62999999999', '04023326100', 'LIB-ADMIN-PIX', '"id"', 'admin_notes', 'client_']) {
      assert.ok(!texto.includes(segredo), 'vazou: ' + segredo);
    }
  }
  assert.equal(completo.title, 'ajuste');
  assert.equal(completo.description, 'bug no cartão');
  assert.equal(completo.concluido_em, '2026-11-02T15:24:00.000Z');
  assert.equal(resumo.title, undefined);
  assert.equal(resumo.description, undefined);
  assert.equal(resumo.tecnico_responsavel, undefined);
  assert.equal(resumo.status, 'Concluído');
});

test('validarCpf', () => {
  assert.ok(A.validarCpf('529.982.247-25'));
  assert.ok(!A.validarCpf('529.982.247-24'));
  assert.ok(!A.validarCpf('11111111111'));
  assert.ok(!A.validarCpf('123'));
});
