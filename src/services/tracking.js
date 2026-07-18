// Geração do código de rastreio.
// Por enquanto é ALEATÓRIO (só para testar o fluxo). Quando você for
// integrar com a transportadora/correios de verdade, é só trocar a função
// gerarCodigo() por uma que consulte a API real e retorne o código oficial.

const crypto = require('crypto');
const db = require('../db');

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I pra evitar confusão

function randomBloco(tamanho) {
  let out = '';
  const bytes = crypto.randomBytes(tamanho);
  for (let i = 0; i < tamanho; i++) out += ALFABETO[bytes[i] % ALFABETO.length];
  return out;
}

// Gera algo no formato RS-XXXXXX-XXXX e garante que não existe no banco.
function gerarCodigo() {
  for (let tentativa = 0; tentativa < 10; tentativa++) {
    const code = `RS-${randomBloco(6)}-${randomBloco(4)}`;
    const existe = db.prepare('SELECT 1 FROM trackings WHERE code = ?').get(code);
    if (!existe) return code;
  }
  // fallback praticamente impossível de colidir
  return `RS-${randomBloco(10)}`;
}

module.exports = { gerarCodigo };
