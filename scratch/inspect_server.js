const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

console.log('Searching for server creation and route handlers:');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('createServer') || line.includes('pathname ===') || line.includes('pathname.startsWith') || line.includes('req.url')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
