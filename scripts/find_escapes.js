const fs = require('fs');

const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split(/\r?\n/);
console.log('Checking client-side lines for possible newline/escape issues...');

for (let i = 1432; i < 25700; i++) {
  const line = lines[i];
  if (!line) continue;
  if (line.includes(".join('\\n')") || line.includes('.join("\\n")') ||
      line.includes(".split('\\n')") || line.includes('.split("\\n")') ||
      line.includes(".join('\\r\\n')") || line.includes('.split(\'\\r\\n\')')) {
    console.log(`Line ${i + 1}: ${line.trim()}`);
  }
}
