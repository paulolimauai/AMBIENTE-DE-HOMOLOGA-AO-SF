'use strict';
/** Tela "Visitas" do painel do administrador (peças puras): node --test admin-visitas.test.js */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const A = require('./admin-visitas');

// Peças do painel, simplificadas: o que importa aqui é o que a tela escreve
const ui = {
  I: (n) => '<svg data-i="' + n + '"></svg>',
  head: (k, t, s, a) => '<header data-k="' + k + '"><h1>' + t + '</h1><p>' + s + '</p>' + (a || '') + '</header>',
  kpi: (i, l, v, h) => '<div class="kpi" data-l="' + l + '"><b>' + v + '</b><i>' + h + '</i></div>'
};
const dia = (d, v, u) => ({ dia: '2026-11-' + String(d).padStart(2, '0'), visitas: v, visitantes: u });
const resumo = (extra) => Object.assign({
  success: true, historico: { desde: '2026-11-01', arquivos: 20, bytes: 150000 }, dias: 7, visitas: 10, visitantes: 6, robos: 2,
  porDia: [dia(14, 0, 0), dia(15, 2, 2), dia(16, 0, 0), dia(17, 3, 2), dia(18, 1, 1), dia(19, 0, 0), dia(20, 4, 3)],
  paginas: [{ nome: '/inicio', visitas: 7 }, { nome: '/login', visitas: 3 }],
  dispositivos: [{ nome: 'Celular', visitas: 6 }, { nome: 'Computador', visitas: 4 }],
  sistemas: [{ nome: 'Celular · Android', visitas: 4 }, { nome: 'Computador · Windows', visitas: 3 }, { nome: 'Celular · iOS', visitas: 2 }, { nome: 'Computador · macOS', visitas: 1 }],
  navegadores: [{ nome: 'Chrome', visitas: 10 }],
  origens: [{ nome: 'Direto', visitas: 6 }, { nome: 'google.com', visitas: 4 }],
  paises: [{ nome: 'Brasil', visitas: 8 }, { nome: 'Não informado', visitas: 2 }],
  cidades: [{ nome: 'São Paulo/SP', visitas: 5 }, { nome: 'Salvador/BA', visitas: 3 }],
  recentes: [{ dia: '2026-11-20', hora: '19:31:32', ip: '189.45.xxx.xxx', local: 'São Paulo/SP · Brasil', pagina: '/inicio', origem: 'google.com', tipo: 'Celular', navegador: 'Safari', so: 'iOS' }]
}, extra || {});

test('rotuloDia e porcento', () => {
  assert.strictEqual(A.rotuloDia('2026-11-20'), '20/11');
  assert.strictEqual(A.rotuloDia('lixo'), '');
  assert.strictEqual(A.porcento(7, 10), '70%');
  assert.strictEqual(A.porcento(1, 1000), '<1%');
  assert.strictEqual(A.porcento(0, 10), '0%');
  assert.strictEqual(A.porcento(5, 0), '0%');
});

test('ranking: barra proporcional ao maior, % do total, no máximo 8 itens e texto de vazio', () => {
  const h = A.ranking('Páginas', [{ nome: '/inicio', visitas: 8 }, { nome: '/login', visitas: 2 }], 10);
  assert.match(h, /<h3>Páginas<\/h3>/);
  assert.ok(h.includes('width:100%') && h.includes('width:25%'));
  assert.ok(h.includes('80%') && h.includes('20%'));
  const muitos = Array.from({ length: 12 }, (_, i) => ({ nome: 'p' + i, visitas: 12 - i }));
  assert.strictEqual((A.ranking('x', muitos, 78).match(/<li>/g) || []).length, 8);
  assert.match(A.ranking('Cidades', [], 0, 'Nenhuma cidade identificada.'), /Nenhuma cidade identificada\./);
  assert.ok(A.ranking('x', [{ nome: 'a', visitas: 1 }], 1000).includes('width:100%'), 'o único item ocupa a barra toda');
});

test('o texto vindo dos dados é escapado (nome de cidade ou origem não injeta HTML)', () => {
  const mau = '<img src=x onerror=alert(1)>';
  const h = A.ranking('Origens', [{ nome: mau, visitas: 1 }], 1) + A.linhasRecentes([{ dia: '2026-11-20', hora: '10:00:00', ip: mau, local: mau, pagina: mau, origem: mau, tipo: mau, navegador: mau, so: mau }]);
  assert.ok(!h.includes('<img'), 'tag escapou');
  assert.ok(h.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!A.telaErro(mau, ui).includes('<img'));
});

test('graficoDias: uma coluna por dia, altura pelo maior dia, zero como traço e rótulos só até 14 dias', () => {
  const g = A.graficoDias(resumo().porDia);
  assert.strictEqual((g.html.match(/class="vd-c"/g) || []).length, 7);
  assert.ok(g.html.includes('height:132px'), 'o dia mais movimentado (4) usa a altura toda');
  assert.ok(g.html.includes('height:66px'), 'a metade (2 de 4)');
  assert.strictEqual((g.html.match(/class="z"/g) || []).length, 3, 'três dias sem visita');
  assert.ok(g.html.includes('title="20/11: 4 visitas · 3 visitantes"'));
  assert.ok(g.html.includes('title="18/11: 1 visita · 1 visitante"'), 'singular');
  assert.match(g.html, /role="img" aria-label="Visitas por dia, de 14\/11 a 20\/11\. Total: 10\. Maior dia: 20\/11, com 4\."/);
  assert.strictEqual(g.pico, '20/11 · 4 visitas');
  const longo = Array.from({ length: 30 }, (_, i) => dia(i + 1, i % 3, 1));
  assert.ok(!/<span class="vd-v">\d/.test(A.graficoDias(longo).html), 'com 30 dias não há número sobre a barra');
  assert.deepStrictEqual(A.graficoDias([]), { html: '', pico: '', porMes: false });
  const zeros = A.graficoDias([dia(1, 0, 0), dia(2, 0, 0)]);
  assert.strictEqual(zeros.pico, '');
  assert.ok(!zeros.html.includes('NaN'));
});

test('linhasRecentes: uma linha por acesso, IP já mascarado, sem local fica esmaecido', () => {
  const h = A.linhasRecentes(resumo().recentes.concat([{ dia: '2026-11-19', hora: '08:05:00', ip: 'local', local: 'Não informado', pagina: '/login', origem: 'Direto', tipo: 'Computador', navegador: 'Chrome', so: 'Outro' }]));
  assert.strictEqual((h.match(/<tr>/g) || []).length, 2);
  assert.ok(h.includes('20/11 19:31') && h.includes('189.45.xxx.xxx') && h.includes('São Paulo/SP · Brasil'));
  assert.ok(h.includes('<span>Celular · iOS</span><small class="vsub">Safari</small>'), 'aparelho e sistema em cima, navegador embaixo');
  assert.ok(h.includes('<span>Computador · Outro sistema</span><small class="vsub">Chrome</small>'), 'sistema desconhecido não some nem mostra "Outro" solto');
  assert.ok(h.includes('data-l="Aparelho e sistema"'));
  assert.ok(h.includes('<span class="vnd">Não informado</span>'));
  assert.ok(h.includes('data-l="IP (mascarado)"'), 'rótulo para o modo cartão no celular');
});

test('avisoLocal diz o passo que falta: nada chegou, só país ou tudo certo', () => {
  assert.match(A.avisoLocal(resumo({ paises: [{ nome: 'Não informado', visitas: 10 }], cidades: [] })), /IP Geolocation/);
  assert.match(A.avisoLocal(resumo({ cidades: [] })), /Add visitor location headers/);
  assert.strictEqual(A.avisoLocal(resumo()), '');
  assert.strictEqual(A.avisoLocal(resumo({ visitas: 0 })), '');
  assert.strictEqual(A.avisoLocal(null), '');
});

test('tela completa: abas de período, 4 indicadores, gráfico, rankings, tabela e nota', () => {
  const h = A.tela(resumo(), ui, 30);
  assert.ok(h.startsWith('<section>') && h.endsWith('</section>'));
  assert.ok(h.includes('data-k="vis"') && h.includes('onclick="visRecarregar()"'));
  assert.ok(h.includes('aria-selected="true" onclick="visDias(30)"') && h.includes('aria-selected="false" onclick="visDias(7)"'));
  for (const l of ['Visitas', 'Visitantes', 'Hoje', 'Robôs']) assert.ok(h.includes('class="kpi" data-l="' + l + '"'), l);
  assert.ok(h.includes('<b>10</b>') && h.includes('<b>6</b>') && h.includes('<b>4</b>'), 'visitas, visitantes e hoje (último dia)');
  assert.ok(h.includes('Visitas por dia') && h.includes('Maior dia: 20/11 · 4 visitas'));
  for (const t of ['Países', 'Cidades', 'Páginas', 'De onde chegaram', 'Aparelho e sistema', 'Navegadores']) assert.ok(h.includes('<h3>' + t + '</h3>'), t);
  for (const s of ['Celular · Android', 'Computador · Windows', 'Celular · iOS', 'Computador · macOS']) assert.ok(h.includes(s), s);
  assert.ok(h.includes('<th>Aparelho e sistema</th>'));
  assert.ok(h.includes('<th>IP (mascarado)</th>') && h.includes('189.45.xxx.xxx'));
  assert.ok(h.includes('Nada é apagado: o histórico fica guardado sem prazo.') && !h.includes('180 dias') && !h.includes('depois são apagados'));
  assert.ok(h.includes('desde 01/11/2026 (20 dias com acessos, ocupando 146 KB no disco do servidor)'));
  assert.ok(!h.includes('NaN') && !h.includes('undefined'));
});

test('períodos: 7, 30, 90 dias, último ano e todo o histórico (que chama visDias com o texto "tudo")', () => {
  const h = A.tela(resumo(), ui, 'tudo');
  assert.strictEqual((h.match(/role="tab"/g) || []).length, 5);
  for (const r of ['Últimos 7 dias', 'Últimos 30 dias', 'Últimos 90 dias', 'Último ano', 'Todo o histórico']) assert.ok(h.includes('>' + r + '</button>'), r);
  assert.ok(h.includes('aria-selected="true" onclick="visDias(\'tudo\')">Todo o histórico'));
  assert.ok(h.includes('aria-selected="false" onclick="visDias(365)">Último ano'));
  assert.ok(A.tela(resumo(), ui, 365).includes('aria-selected="true" onclick="visDias(365)"'));
});

test('ajudantes: mês, data, tamanho, agrupamento e texto do histórico', () => {
  assert.strictEqual(A.rotuloMes('2026-11'), 'nov/26');
  assert.strictEqual(A.rotuloMes('2027-01'), 'jan/27');
  assert.strictEqual(A.rotuloMes('2026-13'), '');
  assert.strictEqual(A.dataBR('2026-11-01'), '01/11/2026');
  assert.strictEqual(A.dataBR(''), '');
  assert.deepStrictEqual([0, 900, 2048, 150000, 5 * 1048576, 1.5 * 1073741824].map(A.tamanho), ['0 bytes', '900 bytes', '2 KB', '146 KB', '5,0 MB', '1,50 GB']);
  assert.deepStrictEqual(A.agruparPorMes([dia(5, 2, 2), dia(6, 3, 1), { dia: '2026-12-01', visitas: 4, visitantes: 4 }]), [{ dia: '2026-11', mes: true, visitas: 5 }, { dia: '2026-12', mes: true, visitas: 4 }]);
  assert.strictEqual(A.textoHistorico(null), 'Nada é apagado: o histórico fica guardado sem prazo.');
  assert.ok(A.textoHistorico({ desde: '2026-11-20', arquivos: 1, bytes: 300 }).includes('(1 dia com acessos, ocupando 300 bytes'));
});

test('período longo (mais de 120 dias): o gráfico vira uma coluna por mês, sem somar "visitantes"', () => {
  const ano = [];
  for (let i = 0; i < 200; i++) { const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000); ano.push({ dia: d.toISOString().slice(0, 10), visitas: 1, visitantes: 1 }); }
  const g = A.graficoDias(ano);
  assert.strictEqual(g.porMes, true);
  assert.strictEqual((g.html.match(/class="vd-c"/g) || []).length, 7, 'jan a jul = 7 meses');
  assert.ok(g.html.includes('title="jan/26: 31 visitas"') && !g.html.includes('visitante'), 'mês sem visitantes');
  assert.match(g.html, /aria-label="Visitas por mês, de jan\/26 a jul\/26\. Total: 200\. Maior mês: jan\/26, com 31\."/);
  assert.ok(g.html.includes('>31<'), 'até 14 colunas mostra o número sobre a barra');
  const h = A.tela(resumo({ porDia: ano, dias: 200 }), ui, 'tudo');
  assert.ok(h.includes('<h3>Visitas por mês</h3>') && h.includes('Maior mês: jan/26 · 31 visitas'));
  const curto = A.graficoDias(resumo().porDia);
  assert.strictEqual(curto.porMes, false);
  assert.ok(A.tela(resumo(), ui, 7).includes('<h3>Visitas por dia</h3>'));
});

test('acessos recentes: 15 mais novos por padrão, botão para ver todos e para voltar', () => {
  const quarenta = Array.from({ length: 40 }, (_, i) => ({ dia: '2026-11-20', hora: '10:' + String(i).padStart(2, '0') + ':00', ip: '10.1.xxx.xxx', local: 'Não informado', pagina: '/inicio', origem: 'Direto', tipo: 'Celular', navegador: 'Safari', so: 'iOS' }));
  const linhas = (h) => (h.match(/<tr><td data-l="Quando">/g) || []).length;
  const curta = A.tela(resumo({ recentes: quarenta }), ui, 7, false);
  assert.strictEqual(linhas(curta), 15);
  assert.ok(curta.includes('<h3>Acessos recentes</h3>') && curta.includes('Os 15 mais novos, de 40'));
  assert.ok(curta.includes('onclick="visTodos()">Mostrar todos os 40 acessos<'));
  const longa = A.tela(resumo({ recentes: quarenta }), ui, 7, true);
  assert.strictEqual(linhas(longa), 40);
  assert.ok(longa.includes('Os 40 mais novos') && longa.includes('Mostrar só os 15 mais novos'));
  const pouca = A.tela(resumo(), ui, 7, false);   // 1 acesso: sem botão
  assert.strictEqual(linhas(pouca), 1);
  assert.ok(!pouca.includes('visTodos()'));
});

test('servidor antigo sem "sistemas": o quadro cai para os tipos de aparelho, sem quebrar', () => {
  const antigo = resumo(); delete antigo.sistemas;
  const h = A.tela(antigo, ui, 7);
  assert.ok(h.includes('<h3>Aparelho e sistema</h3>') && h.includes('Computador') && !h.includes('undefined'));
});

test('os 6 rankings ficam numa grade própria de 3 colunas (não em 4 com sobra)', () => {
  const h = A.tela(resumo(), ui, 7);
  assert.ok(h.includes('<div class="vgrid">'));
  assert.strictEqual((h.match(/<div class="glass pad vr">/g) || []).length, 6);
  assert.ok(!h.includes('class="grid g3"'));
});

test('tela sem visitas mostra estado vazio (e conta os robôs ignorados), sem gráfico nem tabela', () => {
  const h = A.tela(resumo({ visitas: 0, visitantes: 0, robos: 3, porDia: [dia(20, 0, 0)], paginas: [], dispositivos: [], navegadores: [], origens: [], paises: [], cidades: [], recentes: [] }), ui, 7);
  assert.ok(h.includes('Nenhuma visita neste período'));
  assert.ok(h.includes('3 acessos de robôs foram ignorados'));
  assert.ok(!h.includes('class="vd"') && !h.includes('<table'));
  const um = A.tela(resumo({ visitas: 0, robos: 1, porDia: [] }), ui, 7);
  assert.ok(um.includes('1 acesso de robô foi ignorado'));
  assert.ok(!um.includes('NaN') && !um.includes('undefined'));
});

test('tela com o aviso da Cloudflare quando só o país chega', () => {
  assert.ok(A.tela(resumo({ cidades: [] }), ui, 7).includes('Managed Transforms'));
  assert.ok(!A.tela(resumo(), ui, 7).includes('Managed Transforms'));
});

test('encaixe: o painel carrega o script e o servidor o entrega', () => {
  const html = fs.readFileSync(path.join(__dirname, 'admin-assinaturas-glpi.html'), 'utf8');
  assert.ok(/<script src="\/admin-visitas\.js"><\/script>/.test(html), 'o painel precisa carregar /admin-visitas.js');
  assert.ok(html.indexOf('/admin-visitas.js') > html.indexOf('/admin-liberacao.js'), 'depois do script principal');
  const servidor = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  assert.ok(servidor.includes("'/admin-visitas.js': 'application/javascript; charset=utf-8'"), 'liberado na lista de arquivos estáticos');
});
