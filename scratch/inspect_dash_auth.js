const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

for (let i = 1438; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('nexus_session') || line.includes('nexus_token') || line.includes('nexus_cached_user') || line.includes('location.href = \'/login\'') || line.includes('window.location.replace(\'/login\'') || line.includes('window.location.href = \'/login\'')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
