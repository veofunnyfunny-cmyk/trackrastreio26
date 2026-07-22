// Confirma um pagamento Pix e credita o saldo — com segurança.
//
// Regras importantes:
//  - Só credita se a PRÓPRIA Roundfy confirmar 'approved' (nunca confia no
//    corpo de um webhook, que poderia ser forjado).
//  - Credita no máximo UMA vez por txid (idempotente), mesmo se o polling e o
//    webhook chegarem juntos.

const db = require('../db');
const billing = require('./billing');
const pix = require('./pix');

const getCharge = db.prepare('SELECT * FROM pix_charges WHERE txid = ?');

// Marca como paga e credita numa transação única, revalidando o status para
// evitar crédito duplicado em chamadas concorrentes.
const marcarPagoECreditar = db.transaction((chargeId) => {
  const fresh = db.prepare('SELECT * FROM pix_charges WHERE id = ?').get(chargeId);
  if (!fresh || fresh.status === 'paid') return false; // já creditado
  db.prepare("UPDATE pix_charges SET status='paid', paid_at=datetime('now') WHERE id = ?").run(chargeId);
  billing.creditar(fresh.user_id, fresh.amount_cents, 'Recarga via Pix', fresh.txid);

  // Comissão de indicação: se o depositante veio por um link de indicação,
  // registra a comissão (% do depósito) para o indicador.
  const u = db.prepare('SELECT referrer_id FROM users WHERE id = ?').get(fresh.user_id);
  if (u && u.referrer_id) {
    const ref = db.prepare('SELECT percent FROM referrers WHERE id = ?').get(u.referrer_id);
    if (ref) {
      const commission = Math.round((fresh.amount_cents * ref.percent) / 100);
      db.prepare(`INSERT INTO referral_earnings (referrer_id, user_id, deposit_cents, percent, commission_cents)
                  VALUES (?, ?, ?, ?, ?)`).run(u.referrer_id, fresh.user_id, fresh.amount_cents, ref.percent, commission);
    }
  }
  return true;
});

// Retorna { status: 'approved'|'pendente'|'nao_encontrado', creditado?: bool }
async function conferirEcreditar(txid) {
  if (!txid) return { status: 'nao_encontrado' };
  const charge = getCharge.get(txid);
  if (!charge) return { status: 'nao_encontrado' };
  if (charge.status === 'paid') return { status: 'approved', creditado: false };

  const r = await pix.verificar(txid);
  // O Roundfy usa 'paid' na verificação e 'approved' na listagem — aceitamos os dois.
  const pago = r.status === 'paid' || r.status === 'approved';
  if (pago) {
    const creditado = marcarPagoECreditar(charge.id);
    return { status: 'approved', creditado };
  }
  return { status: r.status === 'erro' ? 'pendente' : (r.status || 'pendente') };
}

module.exports = { conferirEcreditar };
