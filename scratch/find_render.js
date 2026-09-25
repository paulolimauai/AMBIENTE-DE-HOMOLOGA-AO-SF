const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');

const lines = content.split('\n');
for (let i = 11500; i < lines.length; i++) {
  const line = lines[i];
  if (line.includes('function render(') || line.includes('function renderPage(') || line.includes('switch(currentPage)') || line.includes('switch (currentPage)')) {
    console.log(`${i+1}: ${line.trim().slice(0, 100)}`);
  }
}
