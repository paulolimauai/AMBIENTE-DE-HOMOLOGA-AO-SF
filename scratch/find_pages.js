const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
for (let i = 11500; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('function pageConfig') || line.includes('function pageUsuarios')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
