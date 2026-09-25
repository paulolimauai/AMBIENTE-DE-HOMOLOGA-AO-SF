const fs = require('fs');
const content = fs.readFileSync('login.html', 'utf8');

['plano', 'mensal', 'anual', 'gratis', 'trial'].forEach(kw => {
  const count = (content.match(new RegExp(kw, 'gi')) || []).length;
  console.log(`login.html "${kw}": ${count}`);
});
