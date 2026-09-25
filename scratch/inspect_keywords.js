const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

console.log('Searching for subscription, plano, trial, or auth in server.js:');
const keywords = ['plano', 'trial', 'subscription', 'gratis', 'mensal', 'anual', 'currentUser', 'current_user', 'auth_user', 'localStorage'];
keywords.forEach(kw => {
  const matches = [...content.matchAll(new RegExp(kw, 'gi'))];
  console.log(`Keyword "${kw}": ${matches.length} occurrences`);
});
