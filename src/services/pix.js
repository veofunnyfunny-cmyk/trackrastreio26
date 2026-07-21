// Integração com o gateway de pagamento Pix (Roundfy).
// Docs: /create-pix-duck (criar cobrança) e /api/verificar-pix/:txid (status).
//
// A chave da API é da conta da PLATAFORMA (você), configurada via env:
//   ROUNDFY_API_KEY=roundfy_apikey_...
// Todas as recargas dos seus clientes caem na sua conta Roundfy.

const ROUNDFY_URL = (process.env.ROUNDFY_URL || 'https://roundfy-api-abacate.vercel.app').replace(/\/$/, '');
const ROUNDFY_API_KEY = process.env.ROUNDFY_API_KEY || '';

const isConfigured = () => Boolean(ROUNDFY_API_KEY);

// Cria uma cobrança Pix. amountCents em centavos. Retorna { pix_code, txid }.
async function criarPix({ amountCents, description, customer }) {
  const res = await fetch(`${ROUNDFY_URL}/create-pix-duck`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': ROUNDFY_API_KEY },
    body: JSON.stringify({
      amount: amountCents,
      description: description || 'Recarga de saldo',
      api_key: ROUNDFY_API_KEY,
      customer,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `Falha ao gerar Pix (HTTP ${res.status})`);
  }
  const pix_code = data.pix_code || data.pix_qr_code;
  if (!data.txid || !pix_code) throw new Error('Resposta inesperada do gateway.');
  return { txid: data.txid, pix_code };
}

// Consulta o status de um Pix. Retorna { status, valor?, ... }.
// status pode ser 'pendente' ou 'approved'.
async function verificar(txid) {
  const res = await fetch(`${ROUNDFY_URL}/api/verificar-pix/${encodeURIComponent(txid)}`, {
    headers: { 'x-api-key': ROUNDFY_API_KEY },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { status: 'erro', error: `HTTP ${res.status}` };
  return data;
}

module.exports = { isConfigured, criarPix, verificar, ROUNDFY_URL };
