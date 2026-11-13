const fs=require('fs');
const s=fs.readFileSync('server.js','utf8');
const re=/id="(menu[A-Za-z]+Btn|mobileDrawer[A-Za-z]+Btn)"/g;let m;const ids=new Set();
while((m=re.exec(s)))ids.add(m[1]);
console.log([...ids].sort().join('\n'));
