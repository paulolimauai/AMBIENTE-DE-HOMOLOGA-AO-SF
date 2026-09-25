const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
for (let i = 1438; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('function updateHeaderUser') || line.includes('id="userDropdown"') || line.includes('nav-item') || line.includes('data-nav="config"')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
