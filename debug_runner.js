const { spawn } = require('child_process');
const fs = require('fs');

const logFile = 'C:\\AMBIENTE DE HOMOLOGAÇAO\\server_debug.log';
fs.writeFileSync(logFile, '--- Starting Debug Runner ---\n');

const child = spawn('node', ['server.js'], {
  cwd: 'C:\\AMBIENTE DE HOMOLOGAÇAO',
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (d) => {
  fs.appendFileSync(logFile, d);
  process.stdout.write(d);
});

child.stderr.on('data', (d) => {
  fs.appendFileSync(logFile, '[STDERR] ' + d);
  process.stderr.write(d);
});

child.on('exit', (code, signal) => {
  fs.appendFileSync(logFile, `\n[CHILD EXIT] code=${code} signal=${signal}\n`);
  console.log(`\n[CHILD EXIT] code=${code} signal=${signal}`);
});

child.on('error', (err) => {
  fs.appendFileSync(logFile, `\n[CHILD ERROR] ${err.message}\n`);
  console.error(`\n[CHILD ERROR] ${err.message}`);
});
