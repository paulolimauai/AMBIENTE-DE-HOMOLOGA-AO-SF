const fs = require('fs');
const code = fs.readFileSync('server.backup_sub.js', 'utf8');

const anchor1 = String.raw`<span class="role-badge \${isAdminUser ? 'admin' : 'user'}">\${u.role}</span>`;
console.log('anchor1 with String.raw:', code.includes(anchor1));

const anchor2 = `<span class="role-badge \\` + `\${isAdminUser ? 'admin' : 'user'}">\\` + `\${u.role}</span>`;
console.log('anchor2:', code.includes(anchor2));
