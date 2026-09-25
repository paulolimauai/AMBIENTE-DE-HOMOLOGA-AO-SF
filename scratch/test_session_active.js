const fs = require('fs');
let serverCode = fs.readFileSync('server.js', 'utf8');

const anchor = "sessionStorage.setItem('nexus_session_active', 'true');";
const idxs = [];
let pos = 0;
while ((pos = serverCode.indexOf(anchor, pos)) !== -1) {
  idxs.push(pos);
  pos += anchor.length;
}
console.log('Occurrences of sessionStorage.setItem(\'nexus_session_active\', \'true\'):', idxs.length);
idxs.forEach(idx => {
  const lineNo = serverCode.slice(0, idx).split('\n').length;
  console.log(`Line ${lineNo}: ${serverCode.slice(idx - 30, idx + 80).replace(/\r?\n/g, ' ')}`);
});
