const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
console.log('Searching UI structures in server.js:');
for (let i = 1438; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('id="appMain"') || line.includes('id="authPage"') || line.includes('modal-overlay') || line.includes('function showModal') || line.includes('class="sidebar"') || line.includes('id="header"')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
