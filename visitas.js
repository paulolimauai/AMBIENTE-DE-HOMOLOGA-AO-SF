'use strict';
// Registro de visitas ao site: uma linha por página aberta, em arquivos diários (visitas/AAAA-MM-DD.jsonl).
// O IP COMPLETO fica só no arquivo (pasta fora do Git, lida apenas pelo servidor). Qualquer tela ou resposta de API
// mostra o IP MASCARADO (189.45.xxx.xxx). Regras puras, sem depender do server.js, para poderem ser testadas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

// Marco Civil da Internet, art. 15: quem opera aplicação de internet como empresa guarda os registros de acesso por 6 meses.
const RETENCAO_DIAS = 180;
const INTERVALO_REPETIDO_MS = 10 * 1000;   // F5 em sequência na mesma página conta uma vez só
const MAX_LINHAS_POR_DIA = 100000;         // trava contra inundação: o arquivo nunca cresce sem limite

// Só páginas abertas por pessoas (não CSS, JS, imagens nem API). Cada caminho recebe um rótulo curto.
const PAGINAS = {
  '/': '/ (entrada)',
  '/inicio': '/inicio', '/site': '/inicio', '/site-inicial.html': '/inicio',
  '/login': '/login', '/login.html': '/login', '/login-nexus-v5.html': '/login',
  '/suporte': '/suporte', '/glpi': '/suporte', '/glpi.html': '/suporte', '/glpi-enterprise.html': '/suporte',
  '/termos.html': '/termos', '/privacidade.html': '/privacidade'
};

const estado = { dia: '', linhas: 0, recentes: new Map(), ultimaLimpeza: '' };
function _resetar() { estado.dia = ''; estado.linhas = 0; estado.recentes.clear(); estado.ultimaLimpeza = ''; }

function paginaDe(pathname) {
  return Object.prototype.hasOwnProperty.call(PAGINAS, pathname) ? PAGINAS[pathname] : null;
}

// "::ffff:1.2.3.4" e "1.2.3.4:5678" viram "1.2.3.4"; o que não for IP vira "desconhecido"
function normalizarIp(valor) {
  let ip = String(valor || '').trim();
  if (!ip) return 'desconhecido';
  if (ip.startsWith('[')) ip = ip.replace(/^\[([^\]]*)\].*$/, '$1');
  ip = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));
  return net.isIP(ip) ? ip.toLowerCase() : 'desconhecido';
}

function mascararIp(valor) {
  const ip = normalizarIp(valor);
  if (ip === 'desconhecido') return ip;
  if (ip === '127.0.0.1' || ip === '::1') return 'local';
  if (net.isIPv4(ip)) { const p = ip.split('.'); return p[0] + '.' + p[1] + '.xxx.xxx'; }
  const g = ip.split(':');
  return (g[0] || '0') + ':' + (g[1] || '0') + ':xxxx:xxxx';
}

function dispositivoDe(ua) {
  const u = String(ua || '');
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegram|headless|lighthouse|curl\/|wget|python-requests|go-http-client|uptime|pingdom|monitor|preview/i.test(u) || !u) {
    return { tipo: 'Robô', navegador: 'Robô', so: 'Outro' };
  }
  const tipo = /ipad|tablet|android(?!.*mobile)/i.test(u) ? 'Tablet' : (/mobi|iphone|ipod|android/i.test(u) ? 'Celular' : 'Computador');
  const navegador = /edg(e|a|ios)?\//i.test(u) ? 'Edge' : /opr\/|opera/i.test(u) ? 'Opera' : /firefox|fxios/i.test(u) ? 'Firefox'
    : /chrome|crios/i.test(u) ? 'Chrome' : /safari/i.test(u) ? 'Safari' : 'Outro';
  const so = /iphone|ipad|ipod/i.test(u) ? 'iOS' : /android/i.test(u) ? 'Android' : /windows/i.test(u) ? 'Windows'
    : /mac os x|macintosh/i.test(u) ? 'macOS' : /linux|x11/i.test(u) ? 'Linux' : 'Outro';
  return { tipo, navegador, so };
}

// Só o domínio de onde a pessoa veio (nunca a URL inteira, que pode trazer dados na query)
function origemDe(referer, hostProprio) {
  try {
    const host = new URL(String(referer || '')).hostname.toLowerCase().replace(/^www\./, '');
    if (!host) return 'Direto';
    const meu = String(hostProprio || '').toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
    return host === meu ? 'Interno' : host;
  } catch (e) { return 'Direto'; }
}

// Dia e hora no fuso de Brasília (o dia do arquivo é o dia do usuário, não o do servidor)
function diaEHora(data) {
  const partes = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
    .formatToParts(data).forEach(p => { partes[p.type] = p.value; });
  return { dia: partes.year + '-' + partes.month + '-' + partes.day, hora: partes.hour + ':' + partes.minute + ':' + partes.second };
}

function montarRegistro(entrada, agora) {
  const pagina = paginaDe(entrada.pathname);
  if (!pagina) return null;
  const data = agora || new Date();
  const ip = normalizarIp(entrada.ip);
  const disp = dispositivoDe(entrada.ua);
  const { dia, hora } = diaEHora(data);
  return {
    ts: data.toISOString(), dia, hora, ip, pagina,
    origem: origemDe(entrada.referer, entrada.host),
    tipo: disp.tipo, navegador: disp.navegador, so: disp.so, robo: disp.tipo === 'Robô',
    // Mesmo IP + mesmo navegador = mesmo visitante (aproximação: o IP identifica a conexão, não o aparelho)
    visitante: crypto.createHash('sha256').update(ip + '|' + String(entrada.ua || '')).digest('hex').slice(0, 12),
    ua: String(entrada.ua || '').slice(0, 160)
  };
}

function limparAntigos(dir, hoje, retencaoDias) {
  const dias = retencaoDias || RETENCAO_DIAS;
  const corte = new Date(hoje + 'T00:00:00Z'); corte.setUTCDate(corte.getUTCDate() - dias);
  const limite = corte.toISOString().slice(0, 10);
  let apagados = 0;
  try {
    fs.readdirSync(dir).forEach(nome => {
      if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(nome) && nome.slice(0, 10) < limite) {
        try { fs.unlinkSync(path.join(dir, nome)); apagados++; } catch (e) {}
      }
    });
  } catch (e) {}
  return apagados;
}

// Grava a visita se for página de pessoa. Nunca derruba a requisição: qualquer falha de disco é engolida.
function registrarVisita(dir, entrada, agora) {
  try {
    if (process.env.NEXUS_VISITAS === '0') return null;
    const reg = montarRegistro(entrada, agora);
    if (!reg) return null;
    const t = (agora || new Date()).getTime();
    const chave = reg.ip + '|' + reg.pagina + '|' + reg.visitante;
    const ultimo = estado.recentes.get(chave);
    if (ultimo && t - ultimo < INTERVALO_REPETIDO_MS) return null;
    if (estado.recentes.size > 5000) estado.recentes.clear();
    estado.recentes.set(chave, t);
    if (estado.dia !== reg.dia) { estado.dia = reg.dia; estado.linhas = 0; }
    if (estado.linhas >= MAX_LINHAS_POR_DIA) return null;
    fs.mkdirSync(dir, { recursive: true });
    if (estado.ultimaLimpeza !== reg.dia) { estado.ultimaLimpeza = reg.dia; limparAntigos(dir, reg.dia); }
    fs.appendFileSync(path.join(dir, reg.dia + '.jsonl'), JSON.stringify(reg) + '\n', 'utf8');
    estado.linhas++;
    return reg;
  } catch (e) { return null; }
}

function lerDia(dir, dia) {
  let texto = '';
  try { texto = fs.readFileSync(path.join(dir, dia + '.jsonl'), 'utf8'); } catch (e) { return []; }
  const linhas = [];
  texto.split('\n').forEach(l => { if (!l) return; try { linhas.push(JSON.parse(l)); } catch (e) {} });
  return linhas;
}

const contar = (lista, campo) => {
  const m = new Map();
  lista.forEach(r => m.set(r[campo], (m.get(r[campo]) || 0) + 1));
  return Array.from(m, ([nome, visitas]) => ({ nome, visitas })).sort((a, b) => b.visitas - a.visitas || String(a.nome).localeCompare(String(b.nome)));
};

// Resumo dos últimos N dias (inclui hoje). Robôs ficam fora das contagens de pessoas e aparecem à parte.
// O IP sai SEMPRE mascarado: o completo só existe no arquivo.
function resumir(dir, opcoes) {
  const o = opcoes || {};
  const dias = Math.min(Math.max(parseInt(o.dias, 10) || 7, 1), RETENCAO_DIAS);
  const fim = new Date(o.agora || Date.now());
  const lista = [];
  const porDia = [];
  for (let i = dias - 1; i >= 0; i--) {
    const { dia } = diaEHora(new Date(fim.getTime() - i * 86400000));
    const regs = lerDia(dir, dia);
    const pessoas = regs.filter(r => !r.robo);
    porDia.push({ dia, visitas: pessoas.length, visitantes: new Set(pessoas.map(r => r.visitante)).size });
    regs.forEach(r => lista.push(r));
  }
  const pessoas = lista.filter(r => !r.robo);
  return {
    dias,
    visitas: pessoas.length,
    visitantes: new Set(pessoas.map(r => r.visitante)).size,
    robos: lista.length - pessoas.length,
    porDia,
    paginas: contar(pessoas, 'pagina'),
    dispositivos: contar(pessoas, 'tipo'),
    navegadores: contar(pessoas, 'navegador'),
    origens: contar(pessoas, 'origem'),
    recentes: pessoas.slice(-50).reverse().map(r => ({ dia: r.dia, hora: r.hora, ip: mascararIp(r.ip), pagina: r.pagina, origem: r.origem, tipo: r.tipo, navegador: r.navegador, so: r.so }))
  };
}

module.exports = { RETENCAO_DIAS, INTERVALO_REPETIDO_MS, MAX_LINHAS_POR_DIA, paginaDe, normalizarIp, mascararIp, dispositivoDe, origemDe, diaEHora, montarRegistro, registrarVisita, limparAntigos, resumir, _resetar };
