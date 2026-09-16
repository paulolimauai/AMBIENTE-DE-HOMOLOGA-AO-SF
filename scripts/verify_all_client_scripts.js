const fs = require('fs');
const child_process = require('child_process');

// We want to test the htmlContent string inside server.js
// We can require or extract htmlContent
const content = fs.readFileSync('server.js', 'utf8');
const match = content.match(/const htmlContent = `([\s\S]*?)`;\s*\n\s*\/\/|\n\s*const htmlContent = `([\s\S]*?)`;\s*\n\s*const server/);

let html = '';
if (match) {
  html = match[1] || match[2];
} else {
  // Find substring between const htmlContent = ` and res.end(htmlContent);
  const start = content.indexOf('const htmlContent = `') + 'const htmlContent = `'.length;
  const end = content.lastIndexOf('`;\n\nconst server = http.createServer');
  html = content.substring(start, end !== -1 ? end : undefined);
}

// Extract scripts
const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
let m;
let count = 0;
let anyError = false;

while ((m = re.exec(html)) !== null) {
  const code = m[1];
  if (!code.trim()) continue;
  count++;
  const tmpFile = './scratch_test_' + count + '.js';
  fs.writeFileSync(tmpFile, code);
  try {
    child_process.execSync('node --check ' + tmpFile, { stdio: 'pipe' });
    console.log(`Script ${count} (${code.length} bytes): SYNTAX VALID!`);
  } catch (err) {
    anyError = true;
    console.error(`Script ${count} (${code.length} bytes): SYNTAX ERROR!`);
    console.error(err.stderr ? err.stderr.toString() : err.message);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
}

if (!anyError) {
  console.log(`\n✅ All ${count} scripts extracted from htmlContent are 100% VALID!`);
} else {
  console.log(`\n❌ Found syntax errors!`);
}
