'use strict';
// Painel /admin-assinaturas-glpi: conferências estáticas que pegam o tipo de defeito que já aconteceu aqui.
// Caso real (21/11): o commit f799031 renomeou `const PH3` para `const PH1`, mas a aba "Acessos GLPI → Usuários" continuou chamando PH3;
// o desenho da tabela estourava com "PH3 is not defined" e a lista de cadastros aparecia vazia (com o contador certo).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'admin-assinaturas-glpi.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join('\n');

test('o painel tem os scripts inline que o teste lê', () => {
  assert.ok(scripts.length > 20000, 'esperava os scripts inline do painel, achei ' + scripts.length + ' caracteres');
});

test('toda constante PH<n> (espaço reservado dos botões da linha) que é USADA está DEFINIDA', () => {
  const usadas = new Set([...scripts.matchAll(/\bPH(\d+)\b/g)].map((m) => m[1]));
  const definidas = new Set([...scripts.matchAll(/\bconst\s+PH(\d+)\s*=/g)].map((m) => m[1]));
  assert.ok(usadas.size >= 2, 'esperava PH1 (Assinaturas) e PH3 (Acessos GLPI) em uso');
  for (const n of usadas) assert.ok(definidas.has(n), 'PH' + n + ' é usada mas não é definida: a tabela que a usa quebra e fica vazia');
});

test('PH1 vale 1 espaço reservado e PH3 vale 3 (mesmo tamanho dos botões Redefinir/Bloquear/Remover que ficam de fora)', () => {
  assert.match(scripts, /const PH1='<span class="ib ph" aria-hidden="true"><\/span>';/);
  assert.match(scripts, /const PH3=PH1\.repeat\(3\);/);
});

test('a lista de Usuários e a de Assinaturas usam o espaço reservado certo', () => {
  assert.match(scripts, /own\|\|u\.p==='Proprietário'\|\|u\._owner\?PH3:/, 'linha protegida de Usuários');
  assert.match(scripts, /prot\?PH1:/, 'linha protegida de Assinaturas');
});
