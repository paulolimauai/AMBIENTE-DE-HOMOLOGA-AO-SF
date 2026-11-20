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

test('localizacaoDe lê os cabeçalhos da Cloudflare e conserta acento, país desconhecido, Tor e texto perigoso', () => {
  // "São Paulo" em UTF-8 chega ao Node lido como latin1: "SÃ£o Paulo"
  assert.deepStrictEqual(V.localizacaoDe({ 'cf-ipcountry': 'br', 'cf-region-code': 'SP', 'cf-ipcity': 'SÃ£o Paulo' }), { pais: 'BR', regiao: 'SP', cidade: 'São Paulo' });
  assert.deepStrictEqual(V.localizacaoDe({ 'cf-ipcountry': 'BR', 'cf-region': 'Bahia', 'cf-ipcity': 'Salvador' }), { pais: 'BR', regiao: 'Bahia', cidade: 'Salvador' }, 'sem código de região usa o nome');
  assert.strictEqual(V.localizacaoDe({ 'cf-ipcountry': 'XX' }).pais, '');
  assert.strictEqual(V.localizacaoDe({ 'cf-ipcountry': 'T1' }).pais, 'TOR');
  assert.strictEqual(V.localizacaoDe({ 'cf-ipcountry': 'Brasil' }).pais, '', 'só código de 2 letras');
  assert.deepStrictEqual(V.localizacaoDe({}), { pais: '', regiao: '', cidade: '' });
  assert.deepStrictEqual(V.localizacaoDe(undefined), { pais: '', regiao: '', cidade: '' });
  const sujo = V.localizacaoDe({ 'cf-ipcountry': 'BR', 'cf-ipcity': '<script>alert("x")</script>' + 'a'.repeat(200) });
  assert.ok(!/[<>"]/.test(sujo.cidade) && sujo.cidade.length <= 60, 'cidade sem tag e limitada a 60 caracteres');
  assert.strictEqual(V.localizacaoDe({ 'cf-ipcity': 'ÃGUAS' }).cidade, 'ÃGUAS', 'nome com Ã legítimo não é estragado');
});

test('nomePais traduz o código; Tor e vazio têm rótulo próprio', () => {
  assert.strictEqual(V.nomePais('BR'), 'Brasil');
  assert.strictEqual(V.nomePais('PT'), 'Portugal');
  assert.strictEqual(V.nomePais('TOR'), 'Rede Tor (anônimo)');
  assert.strictEqual(V.nomePais(''), 'Não informado');
});

test('a localização é gravada, resumida por país e cidade e aparece nos acessos recentes (com o IP mascarado)', () => {
  V._resetar();
  const dir = pasta();
  const loc = (pais, regiao, cidade) => ({ pais, regiao, cidade });
  const g = (ip, iso, local) => V.registrarVisita(dir, { ip, pathname: '/inicio', ua: CHROME_WIN, host: 'x.com', local }, em(iso));
  g('189.45.10.7', '2026-11-20T13:00:00Z', loc('BR', 'SP', 'São Paulo'));
  g('201.17.3.99', '2026-11-20T14:00:00Z', loc('BR', 'SP', 'São Paulo'));
  g('177.10.2.5', '2026-11-20T15:00:00Z', loc('PT', '', 'Lisboa'));
  g('45.9.9.9', '2026-11-20T16:00:00Z', undefined); // sem cabeçalho (acesso local ou fora do proxy)
  const linha = JSON.parse(fs.readFileSync(path.join(dir, '2026-11-20.jsonl'), 'utf8').split('\n')[0]);
  assert.deepStrictEqual([linha.pais, linha.regiao, linha.cidade], ['BR', 'SP', 'São Paulo']);
  const r = V.resumir(dir, { dias: 1, agora: em('2026-11-20T18:00:00Z').getTime() });
  assert.deepStrictEqual(r.paises.map(p => [p.nome, p.visitas]), [['Brasil', 2], ['Não informado', 1], ['Portugal', 1]]);
  assert.deepStrictEqual(r.cidades.map(c => [c.nome, c.visitas]), [['São Paulo/SP', 2], ['Lisboa', 1]]);
  assert.deepStrictEqual(r.recentes.map(a => a.local), ['Não informado', 'Lisboa · Portugal', 'São Paulo/SP · Brasil', 'São Paulo/SP · Brasil']);
  assert.ok(!JSON.stringify(r).includes('189.45.10.7'), 'IP completo vazou');
});

test('sistema operacional: Android, iOS, iPadOS, Windows, macOS, Linux e ChromeOS (na ordem certa)', () => {
  const so = (ua) => V.dispositivoDe(ua);
  assert.deepStrictEqual([so(IPHONE).tipo, so(IPHONE).so], ['Celular', 'iOS']);
  assert.deepStrictEqual(so('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'), { tipo: 'Tablet', navegador: 'Safari', so: 'iPadOS' });
  assert.deepStrictEqual([so('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36').tipo, so('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36').so], ['Celular', 'Android']);
  assert.strictEqual(so('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15').so, 'macOS');
  assert.strictEqual(so('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36').so, 'Linux');
  assert.strictEqual(so('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0').so, 'Linux');
  assert.strictEqual(so('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36').so, 'ChromeOS', 'ChromeOS diz X11, mas não é Linux');
  assert.strictEqual(so(CHROME_WIN).so, 'Windows');
  assert.strictEqual(so('Mozilla/5.0 (compatible; Windows NT 10.0; Microsoft Edge)').so, 'Windows', '"Microsoft" não vira ChromeOS');
  assert.strictEqual(so('AlgumNavegadorRaro/1.0').so, 'Outro');
});

test('rotuloSistema junta aparelho e sistema num rótulo só', () => {
  assert.strictEqual(V.rotuloSistema('Celular', 'Android'), 'Celular · Android');
  assert.strictEqual(V.rotuloSistema('Computador', 'macOS'), 'Computador · macOS');
  assert.strictEqual(V.rotuloSistema('Tablet', 'iPadOS'), 'Tablet · iPadOS');
  assert.strictEqual(V.rotuloSistema('Computador', 'Outro'), 'Computador · Outro sistema');
  assert.strictEqual(V.rotuloSistema('Computador', undefined), 'Computador · Outro sistema');
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

test('HISTÓRICO PERMANENTE: o código-fonte não tem nenhuma chamada que apague, esvazie ou reescreva arquivo', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'visitas.js'), 'utf8');
  const perigosas = fonte.match(/\.(unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|truncate|truncateSync|writeFile|writeFileSync|rename|renameSync|copyFileSync)\(/g);
  assert.strictEqual(perigosas, null, 'visitas.js só pode ler e acrescentar (appendFileSync): achou ' + JSON.stringify(perigosas));
  assert.strictEqual(V.limparAntigos, undefined, 'a limpeza por idade foi removida de vez');
  assert.strictEqual(V.RETENCAO_DIAS, undefined, 'não existe mais prazo de retenção');
});

test('HISTÓRICO PERMANENTE: registros de anos atrás continuam intactos depois de novas visitas (só acrescenta)', () => {
  V._resetar();
  const dir = pasta();
  const antigo = JSON.stringify({ ts: '2016-03-01T12:00:00.000Z', dia: '2016-03-01', hora: '09:00:00', ip: '1.2.3.4', pagina: '/inicio', robo: false, visitante: 'abc' }) + '\n';
  const arquivoAntigo = path.join(dir, '2016-03-01.jsonl');
  fs.writeFileSync(arquivoAntigo, antigo);
  const ontem = path.join(dir, '2026-11-19.jsonl'); fs.writeFileSync(ontem, '{"x":1}\n');
  for (let i = 0; i < 5; i++) V.registrarVisita(dir, { ip: '189.45.10.' + (10 + i), pathname: '/inicio', ua: CHROME_WIN }, em('2026-11-20T1' + i + ':00:00Z'));   // dia novo: dispara o que antes limpava
  assert.strictEqual(fs.readFileSync(arquivoAntigo, 'utf8'), antigo, 'arquivo de 10 anos atrás idêntico');
  assert.strictEqual(fs.readFileSync(ontem, 'utf8'), '{"x":1}\n');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['2016-03-01.jsonl', '2026-11-19.jsonl', '2026-11-20.jsonl']);
  // acrescentar no mesmo dia mantém as linhas anteriores
  const hoje = path.join(dir, '2026-11-20.jsonl');
  const antes = fs.readFileSync(hoje, 'utf8');
  V.registrarVisita(dir, { ip: '201.17.3.99', pathname: '/login.html', ua: CHROME_WIN }, em('2026-11-20T20:00:00Z'));
  assert.ok(fs.readFileSync(hoje, 'utf8').startsWith(antes), 'as linhas já gravadas não mudam');
});

test('resumir olha além de 180 dias: 1 ano e "tudo" enxergam o histórico antigo, e ler não apaga nada', () => {
  V._resetar();
  const dir = pasta();
  const g = (ip, iso) => V.registrarVisita(dir, { ip, pathname: '/inicio', ua: CHROME_WIN, host: 'x.com' }, em(iso));
  g('189.45.10.1', '2026-01-10T15:00:00Z');   // ~314 dias antes de 20/11
  g('189.45.10.2', '2026-11-19T15:00:00Z');
  g('189.45.10.3', '2026-11-20T15:00:00Z');
  const agora = em('2026-11-20T18:00:00Z').getTime();
  assert.strictEqual(V.resumir(dir, { dias: 90, agora }).visitas, 2);
  assert.strictEqual(V.resumir(dir, { dias: 365, agora }).visitas, 3, 'um ano alcança a visita de janeiro (antes o teto era 180 dias)');
  const tudo = V.resumir(dir, { dias: 'tudo', agora });
  assert.strictEqual(tudo.visitas, 3);
  assert.strictEqual(tudo.dias, 315, 'de 10/01 a 20/11, contando os dois dias');
  assert.deepStrictEqual({ desde: tudo.historico.desde, arquivos: tudo.historico.arquivos }, { desde: '2026-01-10', arquivos: 3 });
  assert.ok(tudo.historico.bytes > 0);
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['2026-01-10.jsonl', '2026-11-19.jsonl', '2026-11-20.jsonl'], 'consultar não mexe em nada');
  assert.strictEqual(V.resumir(dir, { dias: 'TUDO', agora }).dias, 315, 'maiúsculas também valem');
});

test('"tudo" sem nenhum histórico e o teto de leitura de 10 anos', () => {
  const vazio = V.resumir(path.join(pasta(), 'nao-existe'), { dias: 'tudo', agora: em('2026-11-20T18:00:00Z').getTime() });
  assert.strictEqual(vazio.dias, 1);
  assert.deepStrictEqual(vazio.historico, { desde: '', arquivos: 0, bytes: 0 });
  const dir = pasta();
  fs.writeFileSync(path.join(dir, '2000-01-01.jsonl'), '{"dia":"2000-01-01","robo":false,"visitante":"a","pagina":"/inicio"}\n');
  const longo = V.resumir(dir, { dias: 'tudo', agora: em('2026-11-20T18:00:00Z').getTime() });
  assert.strictEqual(longo.dias, V.MAX_DIAS_CONSULTA, 'só limita quanto se lê de uma vez');
  assert.strictEqual(longo.historico.arquivos, 1, 'o arquivo antigo continua contado e no disco');
  assert.ok(fs.existsSync(path.join(dir, '2000-01-01.jsonl')));
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
  assert.deepStrictEqual(r.sistemas.map(d => [d.nome, d.visitas]), [['Computador · Windows', 2], ['Celular · iOS', 1]], 'aparelho e sistema, sem contar o robô');
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
