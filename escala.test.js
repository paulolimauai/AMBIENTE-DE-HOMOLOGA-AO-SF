'use strict';
// Escala automática da tela (script do <head> do server.js) e os ajustes de CSS que ela exige quando o zoom fica ABAIXO de 100%.
// A função mora dentro do HTML do app, então o teste extrai o trecho do código-fonte e o executa isolado (vm), sem subir o servidor.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fonte = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'nexus-shell.css'), 'utf8');

function carregar() {
  const ini = fonte.indexOf('window.__nexusAutoScale = function (i) {');
  const fim = fonte.indexOf('window.__nexusScaleFor = function', ini);
  assert.ok(ini > 0 && fim > ini, 'não achei __nexusAutoScale no server.js');
  const ctx = { window: {}, Math };
  vm.runInNewContext(fonte.slice(ini, fim), ctx);
  return (o) => ctx.window.__nexusAutoScale(Object.assign({ handheld: false, dpr: 1 }, o));
}
const auto = carregar();

test('monitor Full HD a 100% fica em 100% (nada muda)', () => {
  assert.equal(auto({ w: 1905, h: 940, sw: 1920, sh: 1080, dpr: 1 }), 1);
  assert.equal(auto({ w: 1920, h: 970, sw: 1920, sh: 1080, dpr: 1 }), 1);
});

test('notebook Full HD ampliado a 125% (janela de ~1540 px) encolhe para 80% e cabe como o monitor', () => {
  const z = auto({ w: 1539, h: 728, sw: 1536, sh: 864, dpr: 1.25 });
  assert.equal(z, 0.8);
  assert.ok(Math.abs(1539 / z - 1920) < 40, 'a área útil fica ~1920 px de largura, como no monitor');
});

test('notebook Full HD a 150% encolhe para 65% (piso) e a 175%/telas pequenas mantêm 95%', () => {
  assert.equal(auto({ w: 1280, h: 600, sw: 1280, sh: 720, dpr: 1.5 }), 0.65);
  assert.equal(auto({ w: 1097, h: 560, sw: 1097, sh: 614, dpr: 1.75 }), 0.95);   // regra antiga de tela pequena continua valendo
});

test('notebook 1366x768 a 100% NÃO encolhe: o texto já é pequeno (só encolhe quando o Windows está ampliando)', () => {
  assert.equal(auto({ w: 1366, h: 650, sw: 1366, sh: 768, dpr: 1 }), 1);
  assert.equal(auto({ w: 1440, h: 780, sw: 1440, sh: 900, dpr: 1 }), 1);
  assert.equal(auto({ w: 1600, h: 800, sw: 1600, sh: 900, dpr: 1 }), 1);
});

test('o zoom é pela TELA: redimensionar a janela não muda a escala', () => {
  const base = auto({ w: 1539, h: 728, sw: 1536, sh: 864, dpr: 1.25 });
  for (const w of [1100, 1300, 1450, 1539]) assert.equal(auto({ w, h: 700, sw: 1536, sh: 864, dpr: 1.25 }), base);
});

test('Ctrl+ no navegador de um monitor Full HD é respeitado (tela de 1920 px não encolhe)', () => {
  assert.equal(auto({ w: 1536, h: 750, sw: 1920, sh: 1080, dpr: 1.25 }), 1);
});

test('o piso é 65% e o texto nunca fica menor que num Full HD a 100% (piso 1/dpr)', () => {
  assert.equal(auto({ w: 1250, h: 700, sw: 1250, sh: 700, dpr: 2 }), 0.65);
  for (const dpr of [1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    for (const sw of [1182, 1280, 1366, 1536, 1707, 1899]) {
      const z = auto({ w: sw, h: 700, sw, sh: 800, dpr });
      assert.ok(z >= 0.65 && z <= 1, `z=${z} fora de 0,65..1 (sw=${sw}, dpr=${dpr})`);
      if (z < 1) assert.ok(z * dpr >= 0.95 || z === 0.65, `texto menor que num Full HD (z=${z}, dpr=${dpr})`);
    }
  }
});

test('monitores grandes continuam crescendo (2K/4K) e aparelhos de mão ficam em 100%', () => {
  assert.equal(auto({ w: 3840, h: 2000, sw: 3840, sh: 2160, dpr: 1 }), 1.5);
  assert.ok(auto({ w: 2560, h: 1300, sw: 2560, sh: 1440, dpr: 1 }) > 1);
  assert.equal(auto({ w: 800, h: 1200, sw: 800, sh: 1280, dpr: 2, handheld: true }), 1);
});

test('migração única: só quem estava em "100%" manual onde o Auto agora encolhe (< 94%) volta ao Auto, uma vez', () => {
  assert.match(fonte, /localStorage\.getItem\('nexus_scale_rev'\) !== '2'/);
  assert.match(fonte, /sc === '100%' && window\.__nexusAutoScale\(info\) < 0\.94/);
  assert.match(fonte, /localStorage\.setItem\('nexus_scale_rev', '2'\)/);
});

test('o rótulo do botão de escala já nasce com o valor do Auto (sem piscar "Auto (100%)")', () => {
  assert.ok(!/\? 'Auto \(100%\)' : savedScale/.test(fonte));
});

test('CSS com zoom < 100%: fundo fixo e menu acompanham a janela inteira', () => {
  assert.match(css, /#persistentSystemBg,\s*html\.user-logged-in \.persistent-system-bg\s*\{[^}]*width:\s*calc\(100vw \/ var\(--app-zoom, 1\)\) !important;[^}]*height:\s*calc\(100vh \/ var\(--app-zoom, 1\)\) !important;/);
  assert.match(css, /#menu\.sidebar-menu \{ height: auto !important; max-height: none !important; bottom: 0 !important; \}/);
});

test('menu recolhido: "Assinaturas & Acessos" (admin, sem data-page) esconde o rótulo e vira só ícone', () => {
  assert.match(css, /sidebar-collapsed #menu #menuAdminAssinaturasBtn \.label[^{]*\{ display: none !important; \}/);
  assert.match(css, /sidebar-collapsed #menu #menuAdminAssinaturasBtn \{ gap: 0 !important; \}/);
});

test('Orçamentos: os cartões de categoria quebram o texto em vez de cortar com reticências', () => {
  assert.match(css, /\.orc-chip-txt small \{[^}]*white-space: normal !important;[^}]*text-overflow: clip !important;/);
});
