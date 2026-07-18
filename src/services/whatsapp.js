// Envio de WhatsApp.
//
// Modo "simulado": não envia nada de verdade, só retorna sucesso (o log fica
// registrado em message_logs e aparece no console). Perfeito pra testar o
// sistema sem credencial.
//
// Modo "real": faz um POST HTTP para o provider configurado pelo cliente.
// Já deixei mapeado o formato de dois providers muito usados no Brasil para
// drop (Z-API e Evolution API). Você escolhe o provider na aba Configurações.
//
// Nada aqui usa biblioteca externa — só o fetch nativo do Node 18+.

function normalizarTelefone(phone) {
  if (!phone) return '';
  let p = String(phone).replace(/\D/g, '');
  // Se vier sem DDI, assume Brasil (55).
  if (p.length <= 11) p = '55' + p;
  return p;
}

async function enviarWhatsapp(user, telefone, texto) {
  const destino = normalizarTelefone(telefone);
  if (!destino) {
    return { status: 'erro', error: 'Telefone do cliente não informado' };
  }

  if (user.send_mode !== 'real') {
    console.log(`\n[WHATSAPP SIMULADO] para ${destino}:\n${texto}\n`);
    return { status: 'simulado', destination: destino };
  }

  try {
    const provider = (user.wa_provider || '').toLowerCase();
    let url, options;

    if (provider === 'z-api' || provider === 'zapi') {
      // Z-API: https://api.z-api.io/instances/{instance}/token/{token}/send-text
      url = `${user.wa_api_url.replace(/\/$/, '')}/instances/${user.wa_instance}/token/${user.wa_api_token}/send-text`;
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: destino, message: texto }),
      };
    } else if (provider === 'evolution') {
      // Evolution API: POST {base}/message/sendText/{instance}  header apikey
      url = `${user.wa_api_url.replace(/\/$/, '')}/message/sendText/${user.wa_instance}`;
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: user.wa_api_token },
        body: JSON.stringify({ number: destino, text: texto }),
      };
    } else {
      // Provider genérico: manda { phone, message } pra URL configurada.
      url = user.wa_api_url;
      options = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.wa_api_token}` },
        body: JSON.stringify({ phone: destino, message: texto }),
      };
    }

    if (!url) return { status: 'erro', error: 'URL da API de WhatsApp não configurada' };

    const resp = await fetch(url, options);
    const body = await resp.text();
    if (!resp.ok) {
      return { status: 'erro', destination: destino, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
    }
    return { status: 'enviado', destination: destino };
  } catch (err) {
    return { status: 'erro', destination: destino, error: err.message };
  }
}

module.exports = { enviarWhatsapp, normalizarTelefone };
