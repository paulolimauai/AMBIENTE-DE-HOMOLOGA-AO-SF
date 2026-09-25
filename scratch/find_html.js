const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const htmlContent =') || lines[i].includes('let htmlContent =') || lines[i].includes('var htmlContent =')) {
    console.log(`htmlContent defined at line ${i+1}: ${lines[i].slice(0, 100)}`);
  }
}
