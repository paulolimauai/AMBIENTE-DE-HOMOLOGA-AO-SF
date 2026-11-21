'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.NEXUS_ENABLE_SQL_VIGIA = '1';   // o vigia é desligado por padrão: os testes o ligam
const V = require('./sql-vigia');
const Acesso = require('./acesso');
const Assinatura = require('./assinatura');
const Credenciais = require('./credenciais');

const HASH_A = 'scrypt:' + 'a'.repeat(32) + ':' + 'b'.repeat(128);
const HASH_B = 'scrypt:' + 'c'.repeat(32) + ':' + 'd'.repeat(128);
const T0 = Date.parse('2026-11-20T12:00:00.000Z');

// Linha do SQL (datas já como texto ISO: o paraIso do teste é a identidade)
const sqlRow = (extra) => Object.assign({
  id: 1, name: 'Maria Teste', email: 'maria@example.com', password: HASH_A, role: 'Usuário', active: 1, cpf: '12345678909', phone: '11999990000',
  birth_date: '1990-01-01', device_type: 'Computador', subscription_status: 'active', subscription_plan: 'mensal', subscription_method: 'pix',
  subscription_payment_id: 'P1', subscription_expires_at: '2026-12-20T12:00:00.000Z', trial_started_at: '2026-10-01T12:00:00.000Z'
}, extra || {});
// Espelho local: o mesmo usuário como o app o guarda (com os carimbos)
const espelho = (extra) => Object.assign(sqlRow(), {
  active: true, subscription_updated_at: '2026-11-19T10:00:00.000Z', active_updated_at: '2026-11-19T10:00:00.000Z', password_changed_at: '2026-11-19T09:00:00.000Z'
}, extra || {});

function montar(opts) {
  const o = opts || {};
  const caixa = { espelho: [espelho()], salvos: 0, editados: [], relogio: T0, ocupada: false, linhas: [sqlRow()], logs: [] };
  const estadoPath = o.estadoPath === undefined ? null : o.estadoPath;
  const vigia = V.createVigia({
    getPool: () => ({ query: async () => ({ rows: caixa.linhas }) }),
    getLocalUsers: () => caixa.espelho.map((u) => ({ ...u })),
    saveLocalUsers: (lista) => { caixa.espelho = lista.map((u) => ({ ...u })); caixa.salvos++; },
    paraIso: (v) => v, nuvemOcupada: () => caixa.ocupada, aoEditar: (info) => caixa.editados.push(info),
    estadoPath, agora: () => caixa.relogio, log: (m) => caixa.logs.push(m)
  });
  caixa.vigia = vigia;
  caixa.ler = (linhas, avancaMs) => { if (linhas) caixa.linhas = linhas; if (avancaMs) caixa.relogio += avancaMs; return vigia.processarUsuarios(caixa.linhas); };
  return caixa;
}

test('foto/detectar: sem leitura anterior ou sem espelho não há como saber', () => {
  const f = V.foto(sqlRow());
  assert.deepEqual(V.detectar(f, null, V.foto(espelho())), {});
  assert.deepEqual(V.detectar(f, f, null), {});
  assert.deepEqual(V.detectar(f, f, V.foto(espelho())), {});
});

test('a primeira leitura só inicializa: nada é adotado, nem mesmo o que difere do espelho', () => {
  const c = montar();
  c.espelho = [espelho({ active: false })];            // o SQL (ativo) difere do espelho carimbado, mas não há leitura anterior
  assert.deepEqual(c.ler(), []);
  assert.equal(c.espelho[0].active, false);
  assert.equal(c.salvos, 0);
});

test('bloqueio feito no SQL: espera ficar estável, adota, carimba e avisa (encerrar sessões)', () => {
  const c = montar();
  c.ler();                                              // inicializa
  const antes = Acesso.relogioMs(c.espelho[0]);
  assert.deepEqual(c.ler([sqlRow({ active: 0 })], 3000), []);           // 1ª vez que vê: pendente
  assert.equal(c.vigia.emEdicao('MARIA@example.com'), true);
  assert.equal(c.espelho[0].active, true);
  const r = c.ler(null, 3000);                                          // 2ª leitura igual: estável
  assert.equal(r.length, 1);
  assert.equal(c.espelho[0].active, false);
  assert.ok(Acesso.relogioMs(c.espelho[0]) > antes, 'carimbo novo vence a nuvem');
  assert.equal(c.vigia.emEdicao('maria@example.com'), false);
  assert.equal(c.editados.length, 1);
  assert.equal(c.editados[0].bloqueou, true);
  assert.equal(c.salvos, 1);
  assert.deepEqual(c.ler(null, 3000), []);                              // nada mais a fazer
});

test('reativar no SQL também vale (e não deixa o carimbo recuar)', () => {
  const c = montar();
  c.espelho = [espelho({ active: false, active_updated_at: new Date(T0 + 60000).toISOString() })];   // carimbo "do futuro": relógio da máquina voltou
  c.linhas = [sqlRow({ active: 0 })]; c.ler();
  c.ler([sqlRow({ active: 1 })], 3000); c.ler(null, 3000);
  assert.equal(c.espelho[0].active, true);
  assert.ok(Acesso.relogioMs(c.espelho[0]) > T0 + 60000, 'nunca recua');
});

test('mudança do próprio app (espelho gravado primeiro, SQL depois) não é edição de fora', () => {
  const c = montar();
  c.ler();
  c.espelho = [espelho({ active: false, active_updated_at: '2026-11-20T11:59:00.000Z' })];   // app bloqueou: espelho primeiro...
  assert.deepEqual(c.ler(null, 3000), []);                              // ...SQL ainda igual ao visto: o espelho continua valendo
  assert.equal(c.vigia.emEdicao('maria@example.com'), false);
  assert.deepEqual(c.ler([sqlRow({ active: 0 })], 3000), []);           // ...e o UPDATE chega: igual ao espelho, só atualiza o visto
  assert.equal(c.vigia.emEdicao('maria@example.com'), false);
  assert.equal(c.salvos, 0);
});

test('SQL difere dos dois mas muda a cada leitura: nunca fica estável, nunca adota', () => {
  const c = montar();
  c.ler();
  c.ler([sqlRow({ subscription_status: 'expired' })], 3000);
  c.ler([sqlRow({ subscription_status: 'canceled' })], 3000);
  c.ler([sqlRow({ subscription_status: 'trial' })], 3000);
  assert.equal(c.espelho[0].subscription_status, 'active');
  assert.equal(c.editados.length, 0);
});

test('menos de ESTAVEL_MS entre as duas leituras não basta', () => {
  const c = montar();
  c.ler();
  c.ler([sqlRow({ subscription_status: 'expired' })], 1000);
  assert.deepEqual(c.ler(null, 500), []);
  assert.deepEqual(c.ler(null, 1000), [], '1,5 s desde a primeira vez ainda é pouco');
  assert.equal(c.espelho[0].subscription_status, 'active');
  assert.equal(c.ler(null, 600).length, 1, '2,1 s: estável');
});

test('assinatura liberada no SQL: copia os campos, datas pelo paraIso, e carimba', () => {
  const c = montar();
  c.ler();
  const novo = sqlRow({ subscription_status: 'active', subscription_plan: 'vitalicio', subscription_expires_at: null, subscription_method: 'cortesia', subscription_payment_id: null });
  c.ler([novo], 3000); c.ler(null, 3000);
  const m = c.espelho[0];
  assert.equal(m.subscription_plan, 'vitalicio');
  assert.equal(m.subscription_expires_at, null);
  assert.equal(m.subscription_method, 'cortesia');
  assert.ok(Assinatura.relogioMs(m) > Date.parse('2026-11-19T10:00:00.000Z'));
  assert.equal(c.editados[0].mud.assinatura, true);
  assert.equal(m.active, true, 'o que não mudou fica como estava');
});

test('senha trocada no SQL por outro hash do sistema: vale e ganha relógio novo; texto puro NÃO é propagado', () => {
  const c = montar();
  c.ler();
  c.ler([sqlRow({ password: HASH_B })], 3000); c.ler(null, 3000);
  assert.equal(c.espelho[0].password, HASH_B);
  assert.ok(Credenciais.clockMs(c.espelho[0]) > Date.parse('2026-11-19T09:00:00.000Z'));
  assert.equal(c.editados[0].senha, true);

  const d = montar();
  d.ler();
  d.ler([sqlRow({ password: 'senha123' })], 3000); const r = d.ler(null, 3000);
  assert.equal(d.espelho[0].password, HASH_A, 'texto puro nunca vai para o espelho/nuvem/Supabase');
  assert.deepEqual(r[0].avisos, ['senha_sem_hash']);
  assert.equal(r[0].senha, false);
});

test('perfil (nome, CPF, telefone, nascimento): adota e fica protegido do passo A até a nuvem confirmar', () => {
  const c = montar();
  c.ler();
  c.ler([sqlRow({ name: 'Maria Souza', phone: '11888887777' })], 3000);
  assert.equal(c.vigia.perfilProtegido('maria@example.com'), true, 'pendente já protege');
  c.ler(null, 3000);
  assert.equal(c.espelho[0].name, 'Maria Souza');
  assert.equal(c.espelho[0].phone, '11888887777');
  assert.equal(c.vigia.perfilProtegido('maria@example.com'), true, 'adotado e ainda não confirmado pela nuvem');
  c.vigia.confirmarEnvio();
  assert.equal(c.vigia.perfilProtegido('maria@example.com'), false);
});

test('a proteção do perfil expira sozinha (nuvem fora do ar não prende a conta para sempre)', () => {
  const c = montar();
  c.ler(); c.ler([sqlRow({ name: 'Outro Nome' })], 3000); c.ler(null, 3000);
  assert.equal(c.vigia.perfilProtegido('maria@example.com'), true);
  c.relogio += 11 * 60 * 1000;
  assert.equal(c.vigia.perfilProtegido('maria@example.com'), false);
});

test('CPF comparado só pelos dígitos: máscara não é edição', () => {
  const c = montar();
  c.ler();
  assert.deepEqual(c.ler([sqlRow({ cpf: '123.456.789-09' })], 3000), []);
  assert.equal(c.vigia.emEdicao('maria@example.com'), false);
});

test('tick respeita o ciclo com a nuvem (não adota no meio dele) e dentroDoCiclo ignora essa trava', async () => {
  const c = montar();
  c.ler();
  c.linhas = [sqlRow({ active: 0 })];
  c.ocupada = true;
  assert.deepEqual(await c.vigia.tickUsuarios(), []);
  assert.equal(c.vigia.emEdicao('maria@example.com'), false, 'nem registrou: nada foi lido');
  await c.vigia.tickUsuarios({ dentroDoCiclo: true });
  assert.equal(c.vigia.emEdicao('maria@example.com'), true);
});

test('sem pool (banco fora do ar) o tick não faz nada', async () => {
  const v = V.createVigia({ getPool: () => null });
  assert.deepEqual(await v.tickUsuarios(), []);
});

test('o que o vigia viu sobrevive a reinício: edição feita com o servidor desligado é pega na volta', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  const arq = path.join(dir, 'estado.json');
  try {
    const a = montar({ estadoPath: arq });
    a.ler();                                             // visto gravado em disco
    assert.ok(fs.existsSync(arq));
    assert.ok(!fs.readFileSync(arq, 'utf8').includes(HASH_A), 'a senha nunca vai para o arquivo de estado');
    const b = montar({ estadoPath: arq });               // "reiniciou"
    b.espelho = [espelho()];
    b.ler([sqlRow({ active: 0 })], 0);                   // alguém bloqueou no SSMS com o servidor desligado
    assert.equal(b.vigia.emEdicao('maria@example.com'), true);
    b.ler(null, 3000);
    assert.equal(b.espelho[0].active, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('estado ilegível não derruba: recomeça só inicializando', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-'));
  const arq = path.join(dir, 'estado.json');
  try {
    fs.writeFileSync(arq, '{isto não é json');
    const c = montar({ estadoPath: arq });
    assert.deepEqual(c.ler([sqlRow({ active: 0 })]), []);
    assert.equal(c.espelho[0].active, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('conta que só existe no SQL (criada direto no banco) não é do vigia: o ciclo normal a leva ao espelho', () => {
  const c = montar();
  c.ler();
  const nova = sqlRow({ id: 9, email: 'nova@example.com', name: 'Nova' });
  assert.deepEqual(c.ler([sqlRow(), nova], 3000), []);
  assert.deepEqual(c.ler(null, 3000), []);
  assert.equal(c.espelho.length, 1, 'o vigia nunca cria nem apaga contas no espelho');
});

test('conta que sumiu do SQL (DELETE) não é propagada como exclusão', () => {
  const c = montar();
  c.ler();
  assert.deepEqual(c.ler([], 3000), []);
  assert.deepEqual(c.ler(null, 3000), []);
  assert.equal(c.espelho.length, 1);
  assert.equal(c.editados.length, 0);
});

test('aplicar não altera o espelho recebido e não inventa carimbo de domínio que não mudou', () => {
  const e = espelho();
  const copia = JSON.stringify(e);
  const r = V.aplicar(e, sqlRow({ name: 'Só o Nome' }), { perfil: true }, { agora: T0 });
  assert.equal(JSON.stringify(e), copia);
  assert.equal(r.usuario.name, 'Só o Nome');
  assert.equal(r.usuario.active_updated_at, e.active_updated_at);
  assert.equal(r.usuario.subscription_updated_at, e.subscription_updated_at);
  assert.equal(r.usuario.password_changed_at, e.password_changed_at);
});
