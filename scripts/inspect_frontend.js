const fs = require('fs');

const loginHtml = fs.readFileSync('login.html', 'utf8');
console.log('--- login.html ---');
console.log('Tamanho:', loginHtml.length);
console.log('Possui /api/register:', loginHtml.includes('/api/register'));
console.log('Possui /api/auth/register:', loginHtml.includes('/api/auth/register'));
console.log('Possui modal de cadastro:', loginHtml.includes('registerModal') || loginHtml.includes('modalCadastro') || loginHtml.includes('openRegister'));

const serverJs = fs.readFileSync('server.js', 'utf8');
console.log('\n--- server.js ---');
console.log('Possui /api/register:', serverJs.includes('/api/register'));
console.log('Possui modal de cadastro no htmlContent:', serverJs.includes('modalCadastro') || serverJs.includes('registerModal') || serverJs.includes('openRegister') || serverJs.includes('Abrir Conta'));
