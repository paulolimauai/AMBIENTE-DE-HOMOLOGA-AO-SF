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
test('proximoProtocolo começa em REQ-0001 e segue em sequência (INC- para incidente)', () => {
  assert.equal(A.proximoProtocolo([]), 'REQ-0001');
  assert.equal(A.proximoProtocolo(undefined), 'REQ-0001');
  assert.equal(A.proximoProtocolo([], { tipo: 'Incidente' }), 'INC-0001');
  assert.equal(A.proximoProtocolo([], { tipo: 'Requisição' }), 'REQ-0001');
  const lista = [];
  for (let i = 0; i < 12; i++) lista.unshift({ protocol: A.proximoProtocolo(lista) });
  assert.deepEqual(lista.map((o) => o.protocol).reverse().slice(0, 3), ['REQ-0001', 'REQ-0002', 'REQ-0003']);
  assert.equal(lista[0].protocol, 'REQ-0012');
  assert.equal(new Set(lista.map((o) => o.protocol)).size, 12);
});

test('proximoProtocolo ignora protocolos antigos, usa o maior número e respeita o mínimo (contador/banco)', () => {
  const antigos = [{ protocol: 'OS-261107-PJKK' }, { protocol: 'OS-24448467' }, { protocol: 'OS-15330677' }, { protocol: '' }, null];
  assert.equal(A.proximoProtocolo(antigos), 'REQ-0001'); // só os formatos antigos: a sequência começa do zero
  assert.equal(A.proximoProtocolo([...antigos, { protocol: 'OS-0007' }, { protocol: 'REQ-0003' }]), 'REQ-0008');
  assert.equal(A.proximoProtocolo([{ protocol: 'OS-0003' }], { minimo: 41 }), 'REQ-0042'); // contador gravado ou banco à frente do arquivo
  assert.equal(A.proximoProtocolo([{ protocol: 'OS-0003' }], { minimo: 'lixo' }), 'REQ-0004');
  assert.equal(A.proximoProtocolo([{ protocol: 'OS-9999' }]), 'REQ-10000'); // depois do 9999 segue com 5 dígitos
  assert.throws(() => A.proximoProtocolo([{ protocol: 'OS-99999' }]), /Limite/);
  assert.equal(A.numeroDoProtocolo('OS-0042'), 42);
  assert.equal(A.numeroDoProtocolo('REQ-0042'), 42);
  assert.equal(A.numeroDoProtocolo('INC-0007'), 7);
  assert.equal(A.numeroDoProtocolo('OS-261106-K7QX'), 0);
  assert.equal(A.numeroDoProtocolo('OS-24448467'), 0);
});

test('normalizarProtocolo aceita #, minúsculas, espaços, a sequência e protocolos antigos', () => {
  assert.equal(A.normalizarProtocolo('#os-261106-k7qx'), 'OS-261106-K7QX');
  assert.equal(A.normalizarProtocolo(' OS 261106 K7QX '), 'OS-261106-K7QX');
  assert.equal(A.normalizarProtocolo('os261106k7qx'), 'OS-261106-K7QX');
  assert.equal(A.normalizarProtocolo('OS-24448467'), 'OS-24448467');
  assert.equal(A.normalizarProtocolo('OS-261106-K0QX'), null); // 0 não existe no alfabeto
  assert.equal(A.normalizarProtocolo('maria@exemplo.com'), null);
  assert.equal(A.normalizarProtocolo(''), null);
  // sequência: OS-1, os-0001 e "# OS 0001" são o mesmo chamado
  for (const forma of ['OS-0001', 'os-1', 'OS1', '#OS 0001', ' os-00001 ']) assert.equal(A.normalizarProtocolo(forma), 'OS-0001', forma);
  assert.equal(A.normalizarProtocolo('OS-12345'), 'OS-12345');
  assert.equal(A.normalizarProtocolo('OS-0000'), null);
});

test('mesmaReferencia compara por id ou por protocolo normalizado', () => {
  const ordem = { id: '6', protocol: 'OS-24448467' };
  assert.ok(A.mesmaReferencia(ordem, 6));
  assert.ok(A.mesmaReferencia(ordem, '#os-24448467'));
  assert.ok(!A.mesmaReferencia(ordem, 'OS-24448468'));
  assert.ok(!A.mesmaReferencia(ordem, ''));
  assert.ok(!A.mesmaReferencia(null, '6'));
});

test('protocolo sequencial casa por número entre OS-/REQ-/INC- e a troca de tipo muda só a inicial', () => {
  assert.ok(A.mesmoProtocolo('OS-0007', 'REQ-0007'));
  assert.ok(A.mesmoProtocolo('req-7', 'INC-00007'));
  assert.ok(!A.mesmoProtocolo('REQ-0007', 'INC-0008'));
  assert.ok(!A.mesmoProtocolo('OS-261106-K7QX', 'REQ-261106-K7QX'));
  // normalizarOrdem migra OS-NNNN para a inicial do tipo na leitura
  assert.equal(A.normalizarOrdem({ protocol: 'OS-0007', ticket_type: 'Requisição' }).protocol, 'REQ-0007');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-0007', ticket_type: 'Incidente' }).protocol, 'INC-0007');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', service_type: 'Conta/Login' }).protocol, 'INC-0001'); // tipo sugerido pela categoria
  assert.equal(A.normalizarOrdem({ protocol: 'OS-261106-K7QX', ticket_type: 'Incidente' }).protocol, 'OS-261106-K7QX'); // formato antigo não muda
  // trocar o tipo troca só a inicial do protocolo
  const ordem = A.normalizarOrdem({ id: 1, protocol: 'REQ-0007', ticket_type: 'Requisição', client_name: 'A', client_email: 'a@b.com', title: 't', description: 'desc', status: 'Novo', created_at: '2026-11-01T00:00:00Z' });
  const r = A.aplicarAtualizacao(ordem, { ticket_type: 'Incidente' }, { agoraIso: '2026-11-02T00:00:00Z' });
  assert.ok(r.ok);
  assert.equal(r.ordem.protocol, 'INC-0007');
  assert.equal(r.ordem.ticket_type, 'Incidente');
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
  assert.equal(d.service_type, 'Reset de senha');
  assert.equal(d.ticket_type, 'Requisição'); // sem escolha, vale o tipo sugerido pela categoria
  assert.equal(d.priority, 'Média'); // solicitante só abre com Média ou Baixa ("alta" cai na padrão)
  assert.equal(d.sla, '3 Dias Úteis');
  assert.equal(d.title, 'Erro &lt;b&gt;grave&lt;/b&gt; &amp; &quot;urgente&quot;');
  assert.equal(d.status, 'Novo');
  assert.equal(d.tecnico_responsavel, null);
  assert.equal(d.canal_atendimento, 'Tela de Login');
});

test('validarAbertura do público ignora status, técnico, notas e canal interno', () => {
  const r = A.validarAbertura({
    ...pedidoValido(), status: 'Concluído', tecnico_responsavel: 'Fulano', admin_notes: 'nota', canal_atendimento: 'Telefone'
  });
  assert.equal(r.ok, true);
  assert.equal(r.dados.status, 'Novo');
  assert.equal(r.dados.tecnico_responsavel, null);
  assert.equal(r.dados.admin_notes, '');
  assert.equal(r.dados.canal_atendimento, 'Portal Web');
  assert.equal(r.dados.fila, null); // quem não é administrador não escolhe a fila
});

test('validarAbertura recusa pedido incompleto com mensagem específica', () => {
  const casos = [
    [{ client_name: '' }, 'Informe seu nome.'],
    [{ client_email: 'sem-arroba' }, 'Informe um e-mail válido.'],
    [{ client_email: '<img onerror=x>@x.com' }, 'Informe um e-mail válido.'],
    [{ client_phone: '123' }, 'Informe o telefone com DDD (ex.: (62) 99999-9999).'],
    [{ service_type: 'Hackear o sistema' }, 'Selecione uma categoria válida.'],
    [{ priority: 'Crítica máxima' }, 'Prioridade inválida. Use: Crítica, Alta, Média, Baixa.'],
    [{ ticket_type: 'Reclamação' }, 'Escolha o tipo do chamado: Requisição ou Incidente.'],
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
  assert.equal(r.dados.status, 'Atendimento atribuído'); // técnico definido => atendimento atribuído
  assert.equal(r.dados.tecnico_responsavel, 'Carlos');
  assert.equal(r.dados.admin_notes, 'Cliente ligou');
  assert.equal(r.dados.canal_atendimento, 'Telefone');
  const invalido = A.validarAbertura({ ...pedidoValido(), status: 'Qualquer coisa' }, { admin: true });
  assert.equal(invalido.ok, false);
  assert.equal(invalido.mensagem, 'Status inválido. Use: Novo, Pendente, Atendimento atribuído, Resolvido, Fechado.');
  // sem técnico e sem status, o chamado nasce "Novo"; nomes antigos de status ainda são aceitos
  assert.equal(A.validarAbertura(pedidoValido(), { admin: true }).dados.status, 'Novo');
  assert.equal(A.validarAbertura({ ...pedidoValido(), status: 'Concluído' }, { admin: true }).dados.status, 'Resolvido');
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

test('encontrarDuplicada acha o mesmo pedido recente e ignora antigos, fechados e de outro e-mail', () => {
  const dados = A.validarAbertura(pedidoValido()).dados;
  const agora = Date.parse(AGORA);
  const base = { client_email: dados.client_email, title: dados.title, description: dados.description, status: 'Novo' };
  const recente = { ...base, protocol: 'A', created_at: new Date(agora - 60 * 1000).toISOString() };
  assert.equal(A.encontrarDuplicada([recente], dados, { agora }).protocol, 'A');
  assert.equal(A.encontrarDuplicada([{ ...recente, created_at: new Date(agora - 3600 * 1000).toISOString() }], dados, { agora }), null);
  assert.equal(A.encontrarDuplicada([{ ...recente, status: 'Fechado' }], dados, { agora }), null);
  assert.equal(A.encontrarDuplicada([{ ...recente, client_email: 'outro@exemplo.com' }], dados, { agora }), null);
  assert.equal(A.encontrarDuplicada([], dados, { agora }), null);
});

// ---------- Atualização ----------
const ordemBase = () => A.montarOrdem(A.validarAbertura(pedidoValido()).dados, { protocolo: 'OS-261106-K7QX', id: 1, agoraIso: '2026-11-06T12:00:00.000Z' });

test('aplicarAtualizacao só com notas não muda o status (antes voltava para o início da fila)', () => {
  const concluida = { ...ordemBase(), status: 'Resolvido', concluido_em: '2026-11-06T13:00:00.000Z' };
  const r = A.aplicarAtualizacao(concluida, { id: 1, admin_notes: 'Resolvido por telefone.' }, { agoraIso: AGORA });
  assert.equal(r.ok, true);
  assert.equal(r.ordem.status, 'Resolvido');
  assert.equal(r.ordem.concluido_em, '2026-11-06T13:00:00.000Z');
  assert.equal(r.ordem.admin_notes, 'Resolvido por telefone.');
  assert.deepEqual(r.mudancas, ['parecer atualizado']);
});

test('aplicarAtualizacao assume e conclui com carimbos de data corretos', () => {
  const assumida = A.aplicarAtualizacao(ordemBase(), { status: 'atendimento atribuído', tecnico_responsavel: 'Carlos' }, { agoraIso: AGORA });
  assert.equal(assumida.ordem.status, 'Atendimento atribuído');
  assert.equal(assumida.ordem.assumido_em, AGORA);
  assert.equal(assumida.ordem.concluido_em, null);
  const concluida = A.aplicarAtualizacao(assumida.ordem, { status: 'Resolvido' }, { agoraIso: '2026-11-06T16:00:00.000Z' });
  assert.equal(concluida.ordem.concluido_em, '2026-11-06T16:00:00.000Z');
  assert.equal(concluida.ordem.assumido_em, AGORA);
  // Resolvido -> Fechado mantém a data em que foi resolvido
  const fechada = A.aplicarAtualizacao(concluida.ordem, { status: 'Fechado' }, { agoraIso: '2026-11-07T09:00:00.000Z' });
  assert.equal(fechada.ordem.status, 'Fechado');
  assert.equal(fechada.ordem.concluido_em, '2026-11-06T16:00:00.000Z');
  const reaberta = A.aplicarAtualizacao(concluida.ordem, { status: 'Novo', tecnico_responsavel: '' }, { agoraIso: '2026-11-06T17:00:00.000Z' });
  assert.equal(reaberta.ordem.concluido_em, null);
  assert.equal(reaberta.ordem.assumido_em, null);
  assert.equal(reaberta.ordem.tecnico_responsavel, null);
});

test('aplicarAtualizacao recusa status, prioridade e categoria inválidos mas mantém categoria antiga do histórico', () => {
  assert.equal(A.aplicarAtualizacao(ordemBase(), { status: 'Sumiu' }, { agoraIso: AGORA }).ok, false);
  assert.equal(A.aplicarAtualizacao(ordemBase(), { priority: 'Imediata' }, { agoraIso: AGORA }).ok, false);
  assert.equal(A.aplicarAtualizacao(ordemBase(), { service_type: 'Outra coisa' }, { agoraIso: AGORA }).ok, false);
  assert.equal(A.aplicarAtualizacao(ordemBase(), { ticket_type: 'Dúvida' }, { agoraIso: AGORA }).ok, false);
  const antiga = { ...ordemBase(), service_type: 'Categoria Antiga' };
  assert.equal(A.aplicarAtualizacao(antiga, { service_type: 'Categoria Antiga', status: 'Resolvido' }, { agoraIso: AGORA }).ok, true);
});

test('aplicarAtualizacao não altera o chamado original (imutável)', () => {
  const original = ordemBase();
  const copia = JSON.stringify(original);
  A.aplicarAtualizacao(original, { status: 'Resolvido', admin_notes: 'x' }, { agoraIso: AGORA });
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
  assert.equal(o.status, 'Novo');
  assert.equal(o.client_email, 'a@b.com');
  assert.equal(o.concluido_em, '2026-11-02T15:24:00.000Z');
  assert.equal(o.tecnico_responsavel, null);
  assert.equal(A.normalizarOrdem(null), null);
});

test('mesclarOrdens: banco vence, o que só existe localmente é mantido, mais recentes primeiro', () => {
  const banco = [{ id: 5, protocol: 'OS-261106-AAAA', status: 'Resolvido', ticket_type: 'Incidente', created_at: '2026-11-06T10:00:00Z' }];
  const local = [
    { id: 'x', protocol: 'OS-261106-AAAA', status: 'Pendente', created_at: '2026-11-06T10:00:00Z' },
    { id: 'y', protocol: 'OS-261105-BBBB', status: 'Pendente', created_at: '2026-11-05T10:00:00Z' },
    { id: 'z', protocol: 'OS-261107-CCCC', status: 'Pendente', created_at: '2026-11-07T10:00:00Z' }
  ];
  const r = A.mesclarOrdens(banco, local);
  assert.deepEqual(r.map((o) => o.protocol), ['OS-261107-CCCC', 'OS-261106-AAAA', 'OS-261105-BBBB']);
  assert.equal(r.find((o) => o.protocol === 'OS-261106-AAAA').status, 'Resolvido');
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
    service_type: 'Dados Cadastrais', priority: 'Alta', title: 'ajuste', description: 'bug no cartão', status: 'Resolvido',
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
  assert.equal(resumo.status, 'Resolvido');
});

test('validarCpf', () => {
  assert.ok(A.validarCpf('529.982.247-25'));
  assert.ok(!A.validarCpf('529.982.247-24'));
  assert.ok(!A.validarCpf('11111111111'));
  assert.ok(!A.validarCpf('123'));
});

test('política de SLA: Crítica 4 h, Alta 8 h, Média 24 h e Baixa 5 dias úteis (padrão = Média)', () => {
  assert.equal(A.calcularSlaPorPrioridade('Crítica'), '4 Horas');
  assert.equal(A.calcularSlaPorPrioridade('critica'), '4 Horas');
  assert.equal(A.calcularSlaPorPrioridade('Urgente'), '4 Horas');
  assert.equal(A.calcularSlaPorPrioridade('Alta'), '8 Horas');
  assert.equal(A.calcularSlaPorPrioridade('Média'), '3 Dias Úteis');
  assert.equal(A.calcularSlaPorPrioridade('Normal'), '3 Dias Úteis');
  assert.equal(A.calcularSlaPorPrioridade(''), '3 Dias Úteis');
  assert.equal(A.calcularSlaPorPrioridade('Baixa'), '5 Dias Úteis');
  const base = { client_name: 'Ana', client_email: 'ana@empresa.com.br', service_type: 'Dados Cadastrais', title: 'Duvida sobre relatorio', description: 'Gostaria de entender o relatorio de faturamento', canal_atendimento: 'GLPI Tela de Login' };
  const media = A.validarAbertura({ ...base, priority: 'Média' });
  assert.ok(media.ok);
  assert.equal(media.dados.sla, '3 Dias Úteis');
  const baixa = A.validarAbertura({ ...base, priority: 'Baixa' });
  assert.ok(baixa.ok);
  assert.equal(baixa.dados.sla, '5 Dias Úteis');
  assert.equal(A.montarOrdem(baixa.dados, { protocolo: 'OS-261107-GLPI', id: 11, agoraIso: AGORA }).sla, '5 Dias Úteis');
});

test('integração GLPI 10: SLA automático, ativo CMDB, horas, timeline pública/interna e solução', () => {
  const r = A.validarAbertura({
    client_name: 'Ana',
    client_email: 'ana@empresa.com.br',
    service_type: 'Falhas/Bugs/Correções',
    priority: 'Crítica',
    title: 'Erro na conciliação bancária',
    description: 'Falha ao importar arquivo OFX na tela de lançamentos',
    canal_atendimento: 'GLPI Tela de Login'
  }, { admin: true });
  assert.ok(r.ok);
  assert.equal(r.dados.sla, '4 Horas');
  assert.equal(r.dados.ticket_type, 'Incidente');
  const ordem = A.montarOrdem(r.dados, { protocolo: 'OS-261102-GLPI', id: 10, agoraIso: AGORA });
  assert.equal(ordem.sla, '4 Horas');
  assert.equal(ordem.timeline.length, 1);

  const att1 = A.aplicarAtualizacao(ordem, {
    status: 'Atendimento atribuído',
    tecnico_responsavel: 'Eng. Carlos Silva (N2)',
    asset: 'SRV-ERP-01 (Cluster Produção)',
    time_spent: 1.5,
    timeline_entry: { sender: 'Técnico', text: 'Nota privada N2', internal: true }
  }, { agoraIso: AGORA });
  assert.ok(att1.ok);
  assert.equal(att1.ordem.asset, 'SRV-ERP-01 (Cluster Produção)');
  assert.equal(att1.ordem.time_spent, 1.5);
  // 1 abertura + 1 nota interna + 4 linhas automáticas (status, técnico, ativo e horas)
  assert.equal(att1.ordem.timeline.length, 6);
  assert.equal(att1.ordem.timeline.filter((i) => i.event).length, 4);

  const att2 = A.aplicarAtualizacao(att1.ordem, {
    status: 'Resolvido',
    solution: 'Índice do banco reconstruído com sucesso.',
    timeline_entry: { sender: 'Técnico', text: 'Reprocessamento liberado.', internal: false }
  }, { agoraIso: AGORA });
  assert.ok(att2.ok);
  assert.equal(att2.ordem.status, 'Resolvido');
  assert.equal(att2.ordem.concluido_em, AGORA);

  const pub = A.visaoPublica(att2.ordem, { detalhada: true });
  assert.equal(pub.solution, 'Índice do banco reconstruído com sucesso.');
  assert.equal(pub.timeline.length, 1);
  assert.equal(pub.timeline[0].text, 'Reprocessamento liberado.');
  assert.ok(!JSON.stringify(pub).includes('Nota privada N2'));
});

// ---------- Histórico automático, visão e ações do solicitante ----------
const ordemAberta = () => A.montarOrdem(A.validarAbertura({
  client_name: 'Ana Souza', client_email: 'ana@empresa.com.br', service_type: 'Pagamento não reconhecido', priority: 'Média',
  title: 'Boleto não liquidou', description: 'O boleto pago ontem continua em aberto na conciliação.', canal_atendimento: 'Central GLPI'
}).dados, { protocolo: 'OS-261107-ABCD', id: 77, agoraIso: AGORA });

test('aplicarAtualizacao registra no histórico quem assumiu, status e prioridade, e recalcula o SLA', () => {
  const r = A.aplicarAtualizacao(ordemAberta(), { status: 'Atendimento atribuído', tecnico_responsavel: 'Carlos', priority: 'Alta' }, { agoraIso: AGORA, ator: 'Admin Paulo' });
  assert.ok(r.ok);
  assert.equal(r.ordem.sla, '8 Horas');
  const eventos = r.ordem.timeline.filter((i) => i.event);
  assert.deepEqual(eventos.map((e) => e.sender), ['Sistema', 'Sistema', 'Sistema']);
  assert.ok(eventos.some((e) => /de "Novo" para "Atendimento atribuído"/.test(e.text)));
  assert.ok(eventos.some((e) => /assumido por Carlos/.test(e.text)));
  assert.ok(eventos.some((e) => /Prioridade alterada de "Média" para "Alta"/.test(e.text) && /8 Horas/.test(e.text)));
  assert.ok(eventos.every((e) => e.author === 'Admin Paulo' && e.internal === false));
});

test('aplicarAtualizacao: a resposta vem antes das linhas automáticas; sem mudança não cria linha; SLA enviado vale', () => {
  const r = A.aplicarAtualizacao(ordemAberta(), { status: 'Pendente', timeline_entry: { sender: 'Técnico', author: 'Carlos', text: 'Pode enviar o comprovante?' } }, { agoraIso: AGORA });
  const t = r.ordem.timeline;
  assert.equal(r.ordem.status, 'Pendente');
  assert.equal(t[t.length - 2].text, 'Pode enviar o comprovante?');
  assert.equal(t[t.length - 1].event, true);
  const igual = A.aplicarAtualizacao(r.ordem, { status: 'Pendente', priority: 'Média' }, { agoraIso: AGORA });
  assert.equal(igual.ordem.timeline.length, r.ordem.timeline.length);
  const sla = A.aplicarAtualizacao(ordemAberta(), { priority: 'Baixa', sla: '3 Dias Úteis' }, { agoraIso: AGORA });
  assert.equal(sla.ordem.sla, '3 Dias Úteis');
});

test('aplicarAtualizacao: apelidos antigos de status não geram linha de "mudança" falsa', () => {
  const r = A.aplicarAtualizacao(ordemAberta(), { status: 'Novo' }, { agoraIso: AGORA });
  assert.equal(r.ordem.timeline.filter((i) => i.event).length, 0);
  const antigo = A.aplicarAtualizacao({ ...ordemAberta(), status: 'Atendimento atribuído', tecnico_responsavel: 'Carlos' }, { status: 'Em Andamento' }, { agoraIso: AGORA });
  assert.equal(antigo.ordem.status, 'Atendimento atribuído');
  assert.equal(antigo.ordem.timeline.filter((i) => i.event).length, 0);
});

test('aplicarAtualizacao: atribuir técnico tira o chamado de "Novo" e tirar o técnico o devolve', () => {
  const atribuida = A.aplicarAtualizacao(ordemAberta(), { tecnico_responsavel: 'Carlos' }, { agoraIso: AGORA });
  assert.equal(atribuida.ordem.status, 'Atendimento atribuído');
  const solta = A.aplicarAtualizacao(atribuida.ordem, { tecnico_responsavel: '' }, { agoraIso: AGORA });
  assert.equal(solta.ordem.status, 'Novo');
  // quem manda o status junto decide: "Pendente" com técnico continua "Pendente"
  const espera = A.aplicarAtualizacao(ordemAberta(), { tecnico_responsavel: 'Carlos', status: 'Pendente' }, { agoraIso: AGORA });
  assert.equal(espera.ordem.status, 'Pendente');
});

test('linhas internas (categoria, ativo, horas) só aparecem para a equipe', () => {
  const r = A.aplicarAtualizacao(ordemAberta(), { service_type: 'Dados Cadastrais', asset: 'SW-CORE-02 (Switch Cisco)', time_spent: 2 }, { agoraIso: AGORA });
  assert.equal(r.ordem.timeline.filter((i) => i.event && i.internal).length, 3);
  const v = A.visaoSolicitante(r.ordem);
  assert.equal(v.timeline.length, 1);
  assert.ok(!JSON.stringify(v).includes('Switch Cisco'));
});

test('visaoSolicitante mostra título, andamento e conversa pública, sem parecer interno, dados pessoais nem id', () => {
  const base = A.aplicarAtualizacao(ordemAberta(), {
    status: 'Atendimento atribuído', tecnico_responsavel: 'Carlos', admin_notes: 'cliente chato', solution: '',
    timeline_entry: { sender: 'Técnico', author: 'Carlos', text: 'Estou analisando.' }
  }, { agoraIso: AGORA });
  const nota = A.aplicarAtualizacao(base.ordem, { timeline_entry: { sender: 'Técnico', author: 'Carlos', text: 'Nota privada', internal: true } }, { agoraIso: AGORA });
  const v = A.visaoSolicitante(nota.ordem);
  assert.equal(v.title, 'Boleto não liquidou');
  assert.equal(v.tecnico_responsavel, 'Carlos');
  assert.ok(v.timeline.some((i) => i.text === 'Estou analisando.' && i.sender === 'Técnico'));
  assert.ok(v.timeline.some((i) => i.event && i.sender === 'Sistema'));
  const json = JSON.stringify(v);
  for (const proibido of ['Nota privada', 'cliente chato', 'ana@empresa.com.br', 'client_email', 'client_cpf', 'admin_notes', '"id"']) assert.ok(!json.includes(proibido), proibido);
  assert.equal(v.pode_responder, true);
  assert.equal(v.pode_cancelar, false);
  assert.equal(v.pode_reabrir, false);
});

test('responder: registra a mensagem, devolve "Pendente" ao atendimento e ignora o duplo clique', () => {
  const aguardando = A.aplicarAtualizacao(ordemAberta(), { status: 'Pendente', tecnico_responsavel: 'Carlos' }, { agoraIso: AGORA }).ordem;
  const agora = Date.parse('2026-11-07T12:00:30.000Z');
  const r = A.aplicarAcaoSolicitante(aguardando, { acao: 'responder', texto: '  Segue o comprovante em anexo.  ' }, { agoraIso: '2026-11-07T12:00:00.000Z', agora });
  assert.ok(r.ok);
  assert.equal(r.ordem.status, 'Atendimento atribuído');
  const t = r.ordem.timeline;
  assert.equal(t[t.length - 2].sender, 'Solicitante');
  assert.equal(t[t.length - 2].text, 'Segue o comprovante em anexo.');
  assert.equal(t[t.length - 2].author, 'Ana Souza');
  assert.equal(t[t.length - 1].event, true);
  // mesma mensagem logo depois: nada muda
  const repetida = A.aplicarAcaoSolicitante(r.ordem, { acao: 'responder', texto: 'Segue o comprovante em anexo.' }, { agoraIso: '2026-11-07T12:00:40.000Z', agora: Date.parse('2026-11-07T12:00:40.000Z') });
  assert.ok(repetida.ok);
  assert.equal(repetida.ordem.timeline.length, r.ordem.timeline.length);
  assert.equal(r.ordem.updated_at, '2026-11-07T12:00:00.000Z');
});

test('responder: recusa texto vazio, chamado resolvido e chamado fechado', () => {
  assert.equal(A.aplicarAcaoSolicitante(ordemAberta(), { acao: 'responder', texto: ' ' }, { agoraIso: AGORA }).codigo, 400);
  const resolvida = A.aplicarAtualizacao(ordemAberta(), { status: 'Resolvido', solution: 'ok' }, { agoraIso: AGORA }).ordem;
  const r = A.aplicarAcaoSolicitante(resolvida, { acao: 'responder', texto: 'Obrigado!' }, { agoraIso: AGORA });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 409);
  assert.match(r.mensagem, /Reabrir/);
  const cancelada = A.aplicarAcaoSolicitante(ordemAberta(), { acao: 'cancelar' }, { agoraIso: AGORA }).ordem;
  assert.equal(A.aplicarAcaoSolicitante(cancelada, { acao: 'responder', texto: 'Alô?' }, { agoraIso: AGORA }).codigo, 409);
});

test('reabrir: só chamado resolvido, com motivo e dentro de 7 dias', () => {
  const resolvida = A.aplicarAtualizacao(ordemAberta(), { status: 'Resolvido', tecnico_responsavel: 'Carlos', solution: 'Reprocessado.' }, { agoraIso: AGORA }).ordem;
  assert.equal(resolvida.concluido_em, AGORA);
  assert.equal(A.aplicarAcaoSolicitante(ordemAberta(), { acao: 'reabrir', texto: 'Voltou a falhar' }, { agoraIso: AGORA }).codigo, 409);
  assert.equal(A.aplicarAcaoSolicitante(resolvida, { acao: 'reabrir', texto: 'ok' }, { agoraIso: AGORA, agora: Date.parse(AGORA) }).codigo, 400);

  const dentro = A.aplicarAcaoSolicitante(resolvida, { acao: 'reabrir', texto: 'O erro voltou hoje cedo.' }, { agoraIso: '2026-11-08T10:00:00.000Z', agora: Date.parse('2026-11-08T10:00:00.000Z') });
  assert.ok(dentro.ok);
  assert.equal(dentro.ordem.status, 'Atendimento atribuído');
  assert.equal(dentro.ordem.concluido_em, null);
  assert.ok(dentro.ordem.timeline.some((i) => i.event && /reaberto/.test(i.text)));

  const fora = A.aplicarAcaoSolicitante(resolvida, { acao: 'reabrir', texto: 'O erro voltou hoje cedo.' }, { agoraIso: '2026-11-20T10:00:00.000Z', agora: Date.parse('2026-11-20T10:00:00.000Z') });
  assert.equal(fora.ok, false);
  assert.equal(fora.codigo, 409);
  assert.match(fora.mensagem, /OS-261107-ABCD/);
  assert.equal(A.visaoSolicitante(resolvida, { agora: Date.parse('2026-11-20T10:00:00.000Z') }).pode_reabrir, false);
  assert.equal(A.visaoSolicitante(resolvida, { agora: Date.parse('2026-11-08T10:00:00.000Z') }).pode_reabrir, true);
});

test('cancelar: só enquanto ninguém assumiu o chamado (ele fica Fechado e não pode ser reaberto)', () => {
  const r = A.aplicarAcaoSolicitante(ordemAberta(), { acao: 'cancelar', texto: 'Resolvi por conta própria' }, { agoraIso: AGORA });
  assert.ok(r.ok);
  assert.equal(r.ordem.status, 'Fechado');
  assert.equal(r.ordem.concluido_em, AGORA);
  assert.equal(A.visaoSolicitante(r.ordem).pode_reabrir, false);
  assert.equal(A.visaoSolicitante(r.ordem).pode_responder, false);
  assert.equal(A.aplicarAcaoSolicitante(r.ordem, { acao: 'reabrir', texto: 'Quero reabrir agora' }, { agoraIso: AGORA }).codigo, 409);
  assert.equal(r.ordem.timeline.filter((i) => i.sender === 'Solicitante').length, 2);
  const assumida = A.aplicarAtualizacao(ordemAberta(), { tecnico_responsavel: 'Carlos' }, { agoraIso: AGORA }).ordem;
  const negada = A.aplicarAcaoSolicitante(assumida, { acao: 'cancelar' }, { agoraIso: AGORA });
  assert.equal(negada.ok, false);
  assert.equal(negada.codigo, 409);
  assert.equal(A.visaoSolicitante(assumida).pode_cancelar, false);
  assert.equal(A.visaoSolicitante(ordemAberta()).pode_cancelar, true);
  assert.equal(A.aplicarAcaoSolicitante(ordemAberta(), { acao: 'apagar' }, { agoraIso: AGORA }).codigo, 400);
});

test('aplicarAcaoSolicitante não altera o chamado original e respeita o limite de mensagens', () => {
  const original = ordemAberta();
  const copia = JSON.stringify(original);
  A.aplicarAcaoSolicitante(original, { acao: 'responder', texto: 'Alguma novidade?' }, { agoraIso: AGORA });
  assert.equal(JSON.stringify(original), copia);
  const cheia = { ...original, timeline: Array.from({ length: 300 }, (_, i) => ({ sender: 'Técnico', author: 'x', text: 'm' + i, date: AGORA })) };
  assert.equal(A.aplicarAcaoSolicitante(cheia, { acao: 'responder', texto: 'Mais uma' }, { agoraIso: AGORA }).codigo, 409);
});
// ---------- Fila de chamados 10/11: status, prioridade, tipo, categorias e filas ----------
test('catálogos: 5 status, 4 prioridades, 2 tipos e as 9 categorias pedidas (mais "Outros")', () => {
  assert.deepEqual([...A.STATUS], ['Novo', 'Pendente', 'Atendimento atribuído', 'Resolvido', 'Fechado']);
  assert.deepEqual([...A.PRIORIDADES], ['Crítica', 'Alta', 'Média', 'Baixa']);
  assert.deepEqual([...A.TIPOS], ['Requisição', 'Incidente']);
  for (const c of ['Reset de senha', 'Pagamento não reconhecido', 'Desbloqueio de usuário', 'Conta/Login', 'Dados Cadastrais', 'Liberação de degustação', '2ª Via de fatura', 'Atendimento Técnico', 'Falhas/Bugs/Correções']) {
    assert.ok(A.CATEGORIAS.includes(c), c);
  }
  assert.deepEqual({ ...A.SLA_POLITICA }, { 'Crítica': '4 Horas', 'Alta': '8 Horas', 'Média': '3 Dias Úteis', 'Baixa': '5 Dias Úteis' });
});

test('validarAbertura: requisição ou incidente (o tipo sugerido vem da categoria, mas o solicitante escolhe)', () => {
  const sugerido = A.validarAbertura({ ...pedidoValido(), service_type: 'Falhas/Bugs/Correções' });
  assert.equal(sugerido.dados.ticket_type, 'Incidente');
  const escolhido = A.validarAbertura({ ...pedidoValido(), service_type: 'Falhas/Bugs/Correções', ticket_type: 'requisição' });
  assert.equal(escolhido.dados.ticket_type, 'Requisição');
  const incidente = A.validarAbertura({ ...pedidoValido(), ticket_type: 'INCIDENTE' });
  assert.equal(incidente.dados.ticket_type, 'Incidente');
  assert.equal(A.validarAbertura({ ...pedidoValido(), tipo: 'Incidente' }).dados.ticket_type, 'Incidente');
});

test('validarAbertura: categorias novas, sem acento e nomes antigos de categoria e prioridade', () => {
  assert.equal(A.validarAbertura({ ...pedidoValido(), service_type: '2a via de fatura' }).dados.service_type, '2ª Via de fatura');
  assert.equal(A.validarAbertura({ ...pedidoValido(), service_type: 'liberacao de degustacao' }).dados.service_type, 'Liberação de degustação');
  assert.equal(A.validarAbertura({ ...pedidoValido(), service_type: 'conta/login' }).dados.service_type, 'Conta/Login');
  // aba antiga aberta: o nome velho cai na categoria nova mais próxima
  assert.equal(A.validarAbertura({ ...pedidoValido(), service_type: 'Gestão de Acessos & Reset de Senha' }).dados.service_type, 'Reset de senha');
  assert.equal(A.validarAbertura({ ...pedidoValido(), service_type: 'Sistema Financeiro & ERP' }).dados.service_type, 'Outros');
  // Solicitante só abre com Média ou Baixa: "Urgente"/"Crítica" caem na padrão; a equipe (admin) mantém os 4 níveis
  assert.equal(A.validarAbertura({ ...pedidoValido(), priority: 'Urgente' }).dados.priority, 'Média');
  assert.equal(A.validarAbertura({ ...pedidoValido(), priority: 'Crítica' }).dados.priority, 'Média');
  assert.equal(A.validarAbertura({ ...pedidoValido(), priority: 'Urgente' }, { admin: true }).dados.priority, 'Crítica');
  assert.equal(A.validarAbertura({ ...pedidoValido(), priority: 'Normal' }).dados.priority, 'Média');
  assert.equal(A.validarAbertura({ ...pedidoValido(), priority: '' }).dados.priority, 'Média');
});

test('SLA: Crítica 4 h e Alta 8 h entram no chamado; a prioridade recalcula o prazo', () => {
  const critica = A.validarAbertura({ ...pedidoValido(), priority: 'Crítica' }, { admin: true }).dados;
  assert.equal(critica.sla, '4 Horas');
  const ordem = A.montarOrdem(critica, { protocolo: 'OS-261110-AAAA', id: 1, agoraIso: AGORA });
  const alta = A.aplicarAtualizacao(ordem, { priority: 'Alta' }, { agoraIso: AGORA });
  assert.equal(alta.ordem.sla, '8 Horas');
  assert.ok(alta.ordem.timeline.some((i) => i.event && /Prioridade alterada de "Crítica" para "Alta"/.test(i.text) && /8 Horas/.test(i.text)));
});

test('filas: a categoria cai na fila que a atende ("Suporte Técnico N2") e a abertura registra isso', () => {
  const filas = A.filasIniciais(AGORA);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].nome, 'Suporte Técnico N2');
  assert.deepEqual(filas[0].categorias, ['Atendimento Técnico', 'Falhas/Bugs/Correções']);
  assert.equal(A.filaDaCategoria(filas, 'falhas/bugs/correções'), 'Suporte Técnico N2');
  assert.equal(A.filaDaCategoria(filas, 'Reset de senha'), null);
  assert.equal(A.filaDaCategoria([{ ...filas[0], ativa: false }], 'Atendimento Técnico'), null); // fila desativada não recebe

  const bug = A.validarAbertura({ ...pedidoValido(), service_type: 'Falhas/Bugs/Correções' }, { filas }).dados;
  assert.equal(bug.fila, 'Suporte Técnico N2');
  const ordem = A.montarOrdem(bug, { protocolo: 'OS-261110-BBBB', id: 2, agoraIso: AGORA });
  assert.equal(ordem.fila, 'Suporte Técnico N2');
  assert.ok(ordem.timeline.some((i) => i.event && /fila "Suporte Técnico N2"/.test(i.text)));
  const senha = A.validarAbertura(pedidoValido(), { filas }).dados;
  assert.equal(senha.fila, null);
  assert.equal(A.montarOrdem(senha, { protocolo: 'OS-261110-CCCC', id: 3, agoraIso: AGORA }).timeline.length, 1);
});

test('filas: o público não escolhe a fila; o administrador escolhe uma fila cadastrada', () => {
  const filas = A.filasIniciais(AGORA);
  assert.equal(A.validarAbertura({ ...pedidoValido(), fila: 'Suporte Técnico N2' }, { filas }).dados.fila, null);
  assert.equal(A.validarAbertura({ ...pedidoValido(), fila: 'suporte-tecnico-n2' }, { admin: true, filas }).dados.fila, 'Suporte Técnico N2');
  const ruim = A.validarAbertura({ ...pedidoValido(), fila: 'Fila que não existe' }, { admin: true, filas });
  assert.equal(ruim.ok, false);
  assert.equal(ruim.erros.fila, 'Fila inválida.');
});

test('aplicarAtualizacao: tipo e fila viram linhas públicas no histórico; fila só aceita as cadastradas', () => {
  const filas = A.filasIniciais(AGORA);
  const r = A.aplicarAtualizacao(ordemAberta(), { ticket_type: 'Incidente', fila: 'Suporte Técnico N2' }, { agoraIso: AGORA, filas });
  assert.ok(r.ok);
  assert.equal(r.ordem.ticket_type, 'Incidente');
  assert.equal(r.ordem.fila, 'Suporte Técnico N2');
  const publicos = r.ordem.timeline.filter((i) => i.event && !i.internal).map((i) => i.text);
  assert.ok(!publicos.some((t) => /Tipo do chamado alterado/.test(t))); // já era Incidente: sem mudança, sem linha
  assert.ok(publicos.some((t) => /encaminhado para a fila "Suporte Técnico N2"/.test(t)));
  const virouRequisicao = A.aplicarAtualizacao(r.ordem, { ticket_type: 'Requisição' }, { agoraIso: AGORA, filas });
  assert.ok(virouRequisicao.ordem.timeline.some((i) => i.event && !i.internal && /Tipo do chamado alterado de "Incidente" para "Requisição"/.test(i.text)));
  assert.equal(A.aplicarAtualizacao(ordemAberta(), { fila: 'Outra' }, { agoraIso: AGORA, filas }).ok, false);
  const tirada = A.aplicarAtualizacao(r.ordem, { fila: '' }, { agoraIso: AGORA, filas });
  assert.equal(tirada.ordem.fila, null);
  assert.ok(tirada.ordem.timeline.some((i) => i.event && /retirado da fila "Suporte Técnico N2"/.test(i.text)));
  // uma fila que o chamado já tinha (e foi excluída depois) não trava a edição de outros campos
  const orfa = { ...r.ordem, fila: 'Fila Antiga' };
  assert.equal(A.aplicarAtualizacao(orfa, { fila: 'Fila Antiga', admin_notes: 'ok' }, { agoraIso: AGORA, filas }).ok, true);
  // sem catálogo (uso interno) qualquer nome é aceito
  assert.equal(A.aplicarAtualizacao(ordemAberta(), { fila: 'Qualquer' }, { agoraIso: AGORA }).ordem.fila, 'Qualquer');
});

test('validarFila: nome, categorias e técnicos; nome repetido e fila inexistente', () => {
  const existentes = A.filasIniciais(AGORA);
  const nova = A.validarFila({ nome: '  Suporte   Financeiro N1 ', descricao: 'Boletos e faturas', categorias: ['2a via de fatura', 'Pagamento não reconhecido', '2ª Via de fatura'], tecnicos: ['Ana@Empresa.com', 'ana@empresa.com'] }, { existentes, agoraIso: AGORA });
  assert.ok(nova.ok, nova.mensagem);
  assert.equal(nova.fila.id, 'suporte-financeiro-n1');
  assert.equal(nova.fila.nome, 'Suporte Financeiro N1');
  assert.deepEqual(nova.fila.categorias, ['2ª Via de fatura', 'Pagamento não reconhecido']);
  assert.deepEqual(nova.fila.tecnicos, ['ana@empresa.com']);
  assert.equal(nova.fila.ativa, true);
  assert.equal(nova.anterior, null);

  assert.equal(A.validarFila({ nome: 'ab' }, { existentes }).ok, false);
  assert.equal(A.validarFila({ nome: '<script>x</script>' }, { existentes }).ok, false);
  assert.equal(A.validarFila({ nome: 'suporte técnico n2' }, { existentes }).erros.nome, 'Já existe uma fila com esse nome.');
  assert.equal(A.validarFila({ nome: 'Fila X', categorias: ['Inexistente'] }, { existentes }).ok, false);
  assert.equal(A.validarFila({ nome: 'Fila X', tecnicos: ['sem-arroba'] }, { existentes }).ok, false);
  assert.equal(A.validarFila({ id: 'nao-existe', nome: 'Fila Y' }, { existentes }).ok, false);

  // editar: mantém id e data de criação, aceita o próprio nome e permite desativar
  const edicao = A.validarFila({ id: 'suporte-tecnico-n2', nome: 'Suporte Técnico N2', ativa: false, categorias: [], tecnicos: ['t@x.com'] }, { existentes, agoraIso: '2026-12-01T00:00:00.000Z' });
  assert.ok(edicao.ok, edicao.mensagem);
  assert.equal(edicao.fila.id, 'suporte-tecnico-n2');
  assert.equal(edicao.fila.criada_em, AGORA);
  assert.equal(edicao.fila.ativa, false);
  assert.equal(edicao.anterior.nome, 'Suporte Técnico N2');
});

test('normalizarOrdem: chamado gravado antes da mudança migra os nomes sem perder o sentido', () => {
  // modelo antigo: "Pendente" era o recém-aberto
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Pendente' }).status, 'Novo');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Pendente', tecnico_responsavel: 'Carlos' }).status, 'Atendimento atribuído');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Em Andamento' }).status, 'Atendimento atribuído');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Em Atendimento' }).status, 'Atendimento atribuído');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Pendente Cliente' }).status, 'Pendente');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Concluído' }).status, 'Resolvido');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Cancelado' }).status, 'Fechado');
  // modelo novo (tem o tipo): "Pendente" é aguardando retorno e fica como está
  assert.equal(A.normalizarOrdem({ protocol: 'OS-1', status: 'Pendente', ticket_type: 'Incidente' }).status, 'Pendente');
  // normalizar duas vezes não muda mais nada
  const uma = A.normalizarOrdem({ protocol: 'OS-1', status: 'Pendente' });
  assert.deepEqual(A.normalizarOrdem(uma), uma);

  const antigo = A.normalizarOrdem({ protocol: 'OS-2', priority: 'Urgente', sla: '30 Minutos', service_type: 'Relato de Bug' });
  assert.equal(antigo.priority, 'Crítica');
  assert.equal(antigo.sla, '4 Horas'); // prazo padrão antigo passa à política nova
  assert.equal(antigo.ticket_type, 'Incidente');
  assert.equal(antigo.service_type, 'Relato de Bug'); // categoria antiga é preservada no chamado antigo
  assert.equal(A.normalizarOrdem({ protocol: 'OS-3', priority: 'Alta', sla: '1 Hora' }).sla, '8 Horas');
  assert.equal(A.normalizarOrdem({ protocol: 'OS-4', priority: 'Média', sla: '1 Hora' }).sla, '1 Hora'); // prazo combinado à mão não muda
  assert.equal(A.normalizarOrdem({ protocol: 'OS-5', priority: 'Normal' }).priority, 'Média');
});

test('visões do solicitante e pública trazem tipo e fila; a atualização aceita chamado antigo (Concluído)', () => {
  const resolvida = A.aplicarAtualizacao(ordemAberta(), { status: 'Resolvido', solution: 'ok' }, { agoraIso: AGORA, filas: A.filasIniciais(AGORA) }).ordem;
  const v = A.visaoSolicitante({ ...resolvida, fila: 'Suporte Técnico N2' }, { agora: Date.parse(AGORA) });
  assert.equal(v.ticket_type, 'Incidente');
  assert.equal(v.fila, 'Suporte Técnico N2');
  assert.equal(v.pode_reabrir, true);
  assert.equal(A.visaoPublica(resolvida, { detalhada: true }).ticket_type, 'Incidente');
  // chamado gravado como "Concluído" (modelo antigo) ainda pode ser reaberto e atualizado
  const velho = { ...ordemAberta(), ticket_type: undefined, status: 'Concluído', concluido_em: AGORA };
  delete velho.ticket_type;
  assert.equal(A.visaoSolicitante(velho, { agora: Date.parse(AGORA) }).status, 'Resolvido');
  assert.equal(A.aplicarAcaoSolicitante(velho, { acao: 'reabrir', texto: 'Voltou a dar erro' }, { agoraIso: AGORA, agora: Date.parse(AGORA) }).ordem.status, 'Novo');
});
