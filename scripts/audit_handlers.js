// Auditoria: funções chamadas no HTML (onclick/onchange/oninput/onsubmit, addEventListener não cobre)
// que não têm definição em nenhum lugar -> botões mortos / erros de console.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const i = server.indexOf('const htmlContent');
const j = server.indexOf('</html>`;', i);
const html = server.slice(i, j);

const sources = { 'inline': html };
for (const f of ['dashboard-financeiro.js', 'transacoes.js', 'administracao.js', 'importacao.js', 'atendimento.js', 'glpi-enterprise.html', 'login-nexus-v5.html']) {
  try { sources[f] = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) {}
}

// nomes definidos: function NAME(, NAME = (, const/let/var NAME =, window.NAME =, NAME: function, NAME(...){ em obj? cobre os principais
const defined = new Set();
const defRe = /(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()|window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function|window\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\()/g;
for (const [name, src] of Object.entries(sources)) {
  let m;
  while ((m = defRe.exec(src))) {
    const fn = m[1] || m[2] || m[3] || m[4];
    if (fn) defined.add(fn);
  }
}
// métodos window.X = function já cobertos; também "NAME: function" e arrow "NAME = (...) =>"
const defRe2 = /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g;
for (const src of Object.values(sources)) {
  let m;
  while ((m = defRe2.exec(src))) defined.add(m[1]);
}

// chamadas em atributos inline e addEventListener('x', name)
const callRe = /\bon(?:click|change|input|submit|keyup|keydown|keypress|focus|blur|mouseover|mouseout|load|error)\s*=\s*"([^"]+)"/g;
const called = new Map(); // fn -> files
for (const [name, src] of Object.entries(sources)) {
  let m;
  while ((m = callRe.exec(src))) {
    const code = m[1];
    // extrai identificadores seguidos de ( que não sejam palavras-chave nem métodos
    const fnRe = /([A-Za-z_$][\w$]*)\s*\(/g;
    let f;
    while ((f = fnRe.exec(code))) {
      const fn = f[1];
      if (['if','for','while','switch','return','function','catch','typeof','new','Math','JSON','String','Number','Boolean','Date','Array','Object','parseInt','parseFloat','isNaN','setTimeout','setInterval','encodeURIComponent','decodeURIComponent','alert','confirm','prompt','fetch','print','void','this','event','window','document','localStorage','sessionStorage','console','Promise','URL','Blob','FileReader','FormData','Headers','Request','Response','EventSource','navigator','location','history','screen','self','top','parent','frames','open','close','focus','blur','submit','reset','select','click'].includes(fn)) continue;
      if (!defined.has(fn)) {
        if (!called.has(fn)) called.set(fn, new Set());
        called.get(fn).add(name);
      }
    }
  }
}

// funções usadas via getElementById+onclick dinâmico não pega; reporta o que achou
console.log('=== FUNÇÕES CHAMADAS EM HANDLERS SEM DEFINIÇÃO (' + called.size + ') ===');
for (const [fn, fs2] of [...called.entries()].sort()) console.log(fn.padEnd(45), '<-', [...fs2].join(', '));
console.log('defined total:', defined.size);
