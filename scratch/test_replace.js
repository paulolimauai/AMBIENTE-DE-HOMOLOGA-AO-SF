const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '..', 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

// Check line endings
const isCRLF = code.includes('\r\n');
console.log('File uses CRLF:', isCRLF);

function safeReplace(source, targetPattern, replacement) {
  if (typeof targetPattern === 'string') {
    // Normaliza targetPattern para bater com o line ending do arquivo
    let normalizedTarget = targetPattern;
    if (isCRLF) {
      normalizedTarget = normalizedTarget.replace(/(?<!\r)\n/g, '\r\n');
    } else {
      normalizedTarget = normalizedTarget.replace(/\r\n/g, '\n');
    }

    if (!source.includes(normalizedTarget)) {
      // Tenta busca flexível ignorando espaços em branco e quebras de linha
      const cleanTarget = targetPattern.replace(/\r?\n\s*/g, ' ').trim();
      console.log('Tentando busca flexível para:', cleanTarget.slice(0, 50));
      return null;
    }
    return source.replace(normalizedTarget, replacement);
  }
  return source.replace(targetPattern, replacement);
}

// Test target 1
const target1 = `IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID('usuarios') AND name = 'last_ip')
    BEGIN
      ALTER TABLE usuarios ADD last_ip NVARCHAR(50) NULL;
    END;`;

const res1 = safeReplace(code, target1, 'TEST');
console.log('Target 1 matched:', res1 !== null);
