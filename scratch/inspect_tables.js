const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('CREATE TABLE') || line.includes('Cadastros') || line.includes('local_users.json')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
