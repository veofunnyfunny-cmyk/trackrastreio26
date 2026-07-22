// Envio de SMS via SMSDev (https://www.smsdev.com.br) — pré-pago.
//
// Configuração a nível de plataforma (uma conta para todos), via env:
//   SMS_API_KEY=sua-chave-do-smsdev
//
// SMS custa por mensagem (o crédito fica na sua conta do SMSDev). Por isso o
// canal vem DESLIGADO por padrão em cada conta.

const SMS_API_KEY = process.env.SMS_API_KEY || '';
const SMS_URL = (process.env.SMS_URL || 'https://api.smsdev.com.br').replace(/\/$/, '');

const isConfigured = () => Boolean(SMS_API_KEY);

function normalizarTelefone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (!p) return '';
  if (p.length <= 11) p = '55' + p; // assume Brasil se vier sem DDI
  return p;
}

// Envia um SMS. Retorna { status: 'enviado'|'erro', ... }.
async function enviarSms(numero, texto) {
  const destino = normalizarTelefone(numero);
  if (!destino) return { status: 'erro', error: 'Telefone não informado' };
  if (!SMS_API_KEY) return { status: 'erro', error: 'SMS não configurado no servidor' };

  try {
    const resp = await fetch(`${SMS_URL}/v1/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: SMS_API_KEY, type: 9, number: destino, msg: texto }),
    });
    const data = await resp.json().catch(() => ({}));
    // SMSDev responde com situacao "OK" quando aceita o envio.
    const ok = String(data.situacao || data.status || '').toUpperCase() === 'OK' || data.id;
    if (ok) return { status: 'enviado', destination: destino, id: data.id };
    return { status: 'erro', destination: destino, error: data.descricao || data.retorno || `Falha no SMS` };
  } catch (err) {
    return { status: 'erro', destination: destino, error: err.message };
  }
}

// Consulta o saldo (créditos) da conta SMSDev.
async function saldo() {
  if (!SMS_API_KEY) return { ok: false, error: 'SMS não configurado' };
  try {
    const resp = await fetch(`${SMS_URL}/v1/balance?key=${encodeURIComponent(SMS_API_KEY)}&action=saldo`);
    const data = await resp.json().catch(() => ({}));
    return { ok: true, saldo: data.saldo_sms ?? data.saldo ?? data.qtd ?? null, raw: data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { isConfigured, enviarSms, saldo, normalizarTelefone };
