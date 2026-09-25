const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
for (let i = 11330; i < 11600; i++) {
  const line = lines[i];
  if (line.includes('nav-item') || line.includes('sidebar') || line.includes('nav')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
