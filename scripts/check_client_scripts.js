const fs = require('fs');
const http = require('http');

http.get('http://localhost:3000/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const scripts = [];
    const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = re.exec(data)) !== null) {
      scripts.push(match[1]);
    }
    console.log('Found scripts:', scripts.length);
    scripts.forEach((code, idx) => {
      const file = './test_script_' + idx + '.js';
      fs.writeFileSync(file, code);
      try {
        require('child_process').execSync('node --check ' + file);
        console.log(`Script ${idx} (length ${code.length}): OK`);
      } catch (e) {
        console.log(`Script ${idx} (length ${code.length}): ERROR!`);
        console.log(e.stdout ? e.stdout.toString() : '');
        console.log(e.stderr ? e.stderr.toString() : '');
      } finally {
        try { fs.unlinkSync(file); } catch (_) {}
      }
    });
  });
}).on('error', (err) => {
  console.error('Fetch error:', err.message);
});
