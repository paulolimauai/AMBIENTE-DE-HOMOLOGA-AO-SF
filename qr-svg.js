'use strict';
/* QR Code em SVG gerado aqui no servidor (biblioteca MIT em vendor/qrcode-generator.js).
   Antes o QR do Pix vinha de api.qrserver.com: o código (chave, valor, referência) saía do sistema e, sem internet, a imagem não aparecia. */
const qrcode = require('./vendor/qrcode-generator.js');

const LIMITE = 700; // um Pix copia-e-cola tem ~150 caracteres; o teto evita usar a rota para gerar QR gigante

function qrSvg(dados, opcoes) {
  const t = String(dados == null ? '' : dados);
  if (!t || t.length > LIMITE) throw new Error('Conteúdo inválido para o QR Code.');
  const qr = qrcode(0, (opcoes && opcoes.correcao) || 'M');
  qr.addData(t, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 16, scalable: true, alt: 'QR Code para pagamento', title: 'QR Code Pix' });
}

module.exports = { qrSvg, LIMITE };
