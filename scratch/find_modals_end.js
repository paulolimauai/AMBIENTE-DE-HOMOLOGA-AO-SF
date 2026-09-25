const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
for (let i = 24000; i < 24400; i++) {
  const line = lines[i];
  if (line.includes('modal') || line.includes('popup') || line.includes('<!-- MODAL') || line.includes('class="modal')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
