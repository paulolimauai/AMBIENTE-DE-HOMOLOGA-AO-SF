'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const V = require('./visitas');

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nx-visitas-'));
const em = (iso) => new Date(iso);

test('só páginas de pessoas entram; CSS, JS, imagens e API ficam de fora', () => {
  assert.strictEqual(V.paginaDe('/inicio'), '/inicio');
  assert.strictEqual(V.paginaDe('/site'), '/inicio');
  assert.strictEqual(V.paginaDe('/login.html'), '/login');
  assert.strictEqual(V.paginaDe('/glpi'), '/suporte');
  assert.strictEqual(V.paginaDe('/'), '/ (entrada)');
  for (const p of ['/site-inicial.css', '/site-inicial.js', '/api/admin/usage', '/images/logo.png', '/favicon.ico', '/.env', '/inicio/../x']) {
    assert.strictEqual(V.paginaDe(p), null, p);
  }
});

test('normalizarIp limpa prefixo IPv6-mapeado, porta e lixo', () => {
  assert.strictEqual(V.normalizarIp('::ffff:189.45.10.7'), '189.45.10.7');
  assert.strictEqual(V.normalizarIp('189.45.10.7:51234'), '189.45.10.7');
  assert.strictEqual(V.normalizarIp('[2804:14d:1:2::5]:443'), '2804:14d:1:2::5');
  assert.strictEqual(V.normalizarIp('  '), 'desconhecido');
  assert.strictEqual(V.normalizarIp('<script>alert(1)</script>'), 'desconhecido');
  assert.strictEqual(V.normalizarIp(undefined), 'desconhecido');
});

test('mascararIp esconde o fim do endereço (IPv4, IPv6, local e desconhecido)', () => {
  assert.strictEqual(V.mascararIp('189.45.10.7'), '189.45.xxx.xxx');
  assert.strictEqual(V.mascararIp('::ffff:201.17.3.99'), '201.17.xxx.xxx');
  assert.strictEqual(V.mascararIp('2804:14d:5c80:1234::9'), '2804:14d:xxxx:xxxx');
  assert.strictEqual(V.mascararIp('127.0.0.1'), 'local');
  assert.strictEqual(V.mascararIp('::1'), 'local');
  assert.strictEqual(V.mascararIp('lixo'), 'desconhecido');
});

test('dispositivoDe separa celular, computador, tablet e robô', () => {
  assert.deepStrictEqual(V.dispositivoDe(CHROME_WIN), { tipo: 'Computador', navegador: 'Chrome', so: 'Windows' });
  assert.deepStrictEqual(V.dispositivoDe(IPHONE), { tipo: 'Celular', navegador: 'Safari', so: 'iOS' });
  assert.strictEqual(V.dispositivoDe('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130.0 Safari/537.36').tipo, 'Tablet');
  assert.strictEqual(V.dispositivoDe('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0').navegador, 'Edge');
  assert.strictEqual(V.dispositivoDe('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)').tipo, 'Robô');
  assert.strictEqual(V.dispositivoDe('curl/8.5.0').tipo, 'Robô');
  assert.strictEqual(V.dispositivoDe('').tipo, 'Robô');
});

test('origemDe guarda só o domínio e distingue direto, interno e externo', () => {
  assert.strictEqual(V.origemDe('https://www.google.com/search?q=nexus+financeiro&token=abc', 'nexusfinanceirohub.com.br'), 'google.com');
  assert.strictEqual(V.origemDe('https://nexusfinanceirohub.com.br/inicio', 'nexusfinanceirohub.com.br'), 'Interno');
  assert.strictEqual(V.origemDe('', 'x.com'), 'Direto');
  assert.strictEqual(V.origemDe('não é url', 'x.com'), 'Direto');
});

test('o dia do arquivo é o de Brasília (23h50 em Brasília ainda é o mesmo dia)', () => {
  // 02:50 UTC de 21/11 = 23:50 de 20/11 em Brasília (UTC-3)
  assert.deepStrictEqual(V.diaEHora(em('2026-11-21T02:50:00Z')), { dia: '2026-11-20', hora: '23:50:00' });
  assert.deepStrictEqual(V.diaEHora(em('2026-11-21T03:00:05Z')), { dia: '2026-11-21', hora: '00:00:05' });
});

test('registrarVisita grava uma linha com o IP completo no arquivo do dia', () => {
  V._resetar();
  const dir = pasta();
  const reg = V.registrarVisita(dir, { ip: '189.45.10.7', pathname: '/inicio', ua: CHROME_WIN, referer: 'https://www.google.com/', host: 'nexusfinanceirohub.com.br' }, em('2026-11-20T15:00:00Z'));
  assert.ok(reg);
  const arquivo = path.join(dir, '2026-11-20.jsonl');
  const linhas = fs.readFileSync(arquivo, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  assert.strictEqual(linhas.length, 1);
  assert.strictEqual(linhas[0].ip, '189.45.10.7');
  assert.strictEqual(linhas[0].pagina, '/inicio');
  assert.strictEqual(linhas[0].origem, 'google.com');
  assert.strictEqual(linhas[0].tipo, 'Computador');
  assert.strictEqual(linhas[0].hora, '12:00:00');
  assert.strictEqual(linhas[0].robo, false);
});

test('não grava asset, API nem a mesma página repetida em menos de 10 s; grava depois', () => {
  V._resetar();
  const dir = pasta();
  const base = { ip: '189.45.10.7', ua: CHROME_WIN, host: 'x.com' };
  assert.strictEqual(V.registrarVisita(dir, { ...base, pathname: '/site-inicial.css' }, em('2026-11-20T15:00:00Z')), null);
  assert.strictEqual(V.registrarVisita(dir, { ...base, pathname: '/api/admin/usage' }, em('2026-11-20T15:00:00Z')), null);
  assert.ok(V.registrarVisita(dir, { ...base, pathname: '/inicio' }, em('2026-11-20T15:00:00Z')));
  assert.strictEqual(V.registrarVisita(dir, { ...base, pathname: '/inicio' }, em('2026-11-20T15:00:05Z')), null, 'F5 em 5 s');
  assert.ok(V.registrarVisita(dir, { ...base, pathname: '/login.html' }, em('2026-11-20T15:00:06Z')), 'outra página conta');
  assert.ok(V.registrarVisita(dir, { ...base, pathname: '/inicio' }, em('2026-11-20T15:00:20Z')), 'depois de 10 s conta de novo');
  const n = fs.readFileSync(path.join(dir, '2026-11-20.jsonl'), 'utf8').trim().split('\n').length;
  assert.strictEqual(n, 3);
});

test('NEXUS_VISITAS=0 desliga o registro e nem cria a pasta', () => {
  V._resetar();
  const dir = path.join(pasta(), 'visitas');
  process.env.NEXUS_VISITAS = '0';
  try {
    assert.strictEqual(V.registrarVisita(dir, { ip: '1.2.3.4', pathname: '/inicio', ua: CHROME_WIN }, em('2026-11-20T15:00:00Z')), null);
    assert.strictEqual(fs.existsSync(dir), false);
  } finally { process.env.NEXUS_VISITAS = ''; }
});

test('falha de disco nunca derruba quem chama', () => {
  V._resetar();
  const arquivoNoLugarDaPasta = path.join(pasta(), 'ocupado');
  fs.writeFileSync(arquivoNoLugarDaPasta, 'x');
  assert.doesNotThrow(() => V.registrarVisita(path.join(arquivoNoLugarDaPasta, 'visitas'), { ip: '1.2.3.4', pathname: '/inicio', ua: CHROME_WIN }, em('2026-11-20T15:00:00Z')));
});

test('limparAntigos apaga só arquivo diário com mais de 180 dias e preserva o resto', () => {
  const dir = pasta();
  for (const n of ['2026-05-01.jsonl', '2026-05-24.jsonl', '2026-05-25.jsonl', '2026-11-20.jsonl', 'leia-me.txt']) fs.writeFileSync(path.join(dir, n), '');
  // hoje 20/11/2026 - 180 dias = 24/05/2026: o arquivo de 24/05 ainda fica; o de 01/05 sai
  const apagados = V.limparAntigos(dir, '2026-11-20', 180);
  assert.strictEqual(apagados, 1);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['2026-05-24.jsonl', '2026-05-25.jsonl', '2026-11-20.jsonl', 'leia-me.txt']);
});

test('resumir conta pessoas, separa robôs e NUNCA devolve o IP completo', () => {
  V._resetar();
  const dir = pasta();
  const g = (ip, pathname, ua, iso, referer) => V.registrarVisita(dir, { ip, pathname, ua, referer, host: 'nexusfinanceirohub.com.br' }, em(iso));
  g('189.45.10.7', '/inicio', CHROME_WIN, '2026-11-19T12:00:00Z', 'https://www.google.com/');
  g('189.45.10.7', '/login.html', CHROME_WIN, '2026-11-19T12:01:00Z');
  g('201.17.3.99', '/inicio', IPHONE, '2026-11-20T13:00:00Z');
  g('66.249.66.1', '/inicio', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', '2026-11-20T14:00:00Z');
  const r = V.resumir(dir, { dias: 3, agora: em('2026-11-20T18:00:00Z').getTime() });
  assert.strictEqual(r.visitas, 3);
  assert.strictEqual(r.visitantes, 2);
  assert.strictEqual(r.robos, 1);
  assert.deepStrictEqual(r.porDia.map(d => [d.dia, d.visitas]), [['2026-11-18', 0], ['2026-11-19', 2], ['2026-11-20', 1]]);
  assert.deepStrictEqual(r.paginas.map(p => [p.nome, p.visitas]), [['/inicio', 2], ['/login', 1]]);
  assert.deepStrictEqual(r.dispositivos.map(d => [d.nome, d.visitas]), [['Computador', 2], ['Celular', 1]]);
  assert.strictEqual(r.recentes[0].ip, '201.17.xxx.xxx', 'mais recente primeiro, mascarado');
  const texto = JSON.stringify(r);
  assert.ok(!texto.includes('189.45.10.7') && !texto.includes('201.17.3.99') && !texto.includes('66.249.66.1'), 'IP completo vazou no resumo');
});

test('resumir sem pasta devolve zeros, sem erro', () => {
  const r = V.resumir(path.join(pasta(), 'nao-existe'), { dias: 7 });
  assert.strictEqual(r.visitas, 0);
  assert.strictEqual(r.visitantes, 0);
  assert.strictEqual(r.porDia.length, 7);
});

test('linha corrompida no arquivo é ignorada e o resto continua valendo', () => {
  V._resetar();
  const dir = pasta();
  V.registrarVisita(dir, { ip: '189.45.10.7', pathname: '/inicio', ua: CHROME_WIN }, em('2026-11-20T15:00:00Z'));
  fs.appendFileSync(path.join(dir, '2026-11-20.jsonl'), '{linha quebrada\n');
  const r = V.resumir(dir, { dias: 1, agora: em('2026-11-20T18:00:00Z').getTime() });
  assert.strictEqual(r.visitas, 1);
});
