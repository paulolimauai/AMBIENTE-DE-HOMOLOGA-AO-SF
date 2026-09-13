const fs = require('fs');

function findOccurrences(filename) {
  console.log(`\n=== Buscando em ${filename} ===`);
  const content = fs.readFileSync(filename, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('/api/register') || l.includes('register') || l.includes('cadastr') || l.includes('Abrir conta') || l.includes('Criar conta')) {
      if (l.length < 200 && (l.includes('api/register') || l.includes('Cadastro') || l.includes('cadastrar') || l.includes('Criar Conta') || l.includes('Abrir Conta'))) {
        console.log(`L${i+1}: ${l.trim()}`);
      }
    }
  });
}

findOccurrences('login.html');
findOccurrences('server.js');
