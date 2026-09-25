const fs = require('fs');
const content = fs.readFileSync('login.html', 'utf8');
const lines = content.split('\n');
console.log('login.html lines:', lines.length);

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('localStorage') || line.includes('/api/login') || line.includes('window.location') || line.includes('sessionStorage')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
