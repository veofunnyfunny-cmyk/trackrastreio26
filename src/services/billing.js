// Cobrança e saldo.
//
// Tudo em CENTAVOS (inteiro) para evitar erro de arredondamento com dinheiro.
// Preços por mensagem enviada:
//   WhatsApp = R$ 1,00 = 100 centavos
//   E-mail   = R$ 0,50 =  50 centavos

const db = require('../db');

const PRECOS = { whatsapp: 100, email: 50, sms: 50 };

const getBal = db.prepare('SELECT balance_cents FROM users WHERE id = ?');
const addBal = db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?');
const insertTx = db.prepare(`
  INSERT INTO transactions (user_id, kind, amount_cents, description, channel, tracking_id, provider_ref)
  VALUES (@user_id, @kind, @amount_cents, @description, @channel, @tracking_id, @provider_ref)
`);

function saldo(userId) {
  const row = getBal.get(userId);
  return row ? row.balance_cents : 0;
}

function preco(canal) {
  return PRECOS[canal] || 0;
}

function temSaldo(userId, canal) {
  return saldo(userId) >= preco(canal);
}

// Debita o valor de uma mensagem enviada e registra no extrato.
// Feito numa transação para saldo e extrato ficarem sempre consistentes.
const _cobrar = db.transaction((userId, canal, trackingId) => {
  const amount = preco(canal);
  addBal.run(-amount, userId);
  const nomes = { whatsapp: 'WhatsApp', email: 'e-mail', sms: 'SMS' };
  insertTx.run({
    user_id: userId, kind: 'debito', amount_cents: amount,
    description: `Envio ${nomes[canal] || canal}`,
    channel: canal, tracking_id: trackingId || null, provider_ref: null,
  });
});
function cobrar(userId, canal, trackingId) {
  _cobrar(userId, canal, trackingId);
}

// Credita saldo (recarga). providerRef = id do pagamento no gateway.
const _creditar = db.transaction((userId, amountCents, descricao, providerRef) => {
  addBal.run(amountCents, userId);
  insertTx.run({
    user_id: userId, kind: 'credito', amount_cents: amountCents,
    description: descricao || 'Recarga', channel: null, tracking_id: null,
    provider_ref: providerRef || null,
  });
});
function creditar(userId, amountCents, descricao, providerRef) {
  _creditar(userId, amountCents, descricao, providerRef);
}

// Formata centavos como "R$ 12,34".
function formatBRL(cents) {
  return 'R$ ' + (Number(cents || 0) / 100).toFixed(2).replace('.', ',');
}

module.exports = { PRECOS, saldo, preco, temSaldo, cobrar, creditar, formatBRL };
