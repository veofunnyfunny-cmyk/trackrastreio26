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
      const base = (user.wa_api_url && user.wa_api_url.trim())
        ? user.wa_api_url.replace(/\/$/, '') : 'https://api.z-api.io';
      url = `${base}/instances/${user.wa_instance}/token/${user.wa_api_token}/send-text`;
      const headers = { 'Content-Type': 'application/json' };
      if (user.wa_client_token) headers['Client-Token'] = user.wa_client_token;
      options = { method: 'POST', headers, body: JSON.stringify({ phone: destino, message: texto }) };
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

// Testa se o WhatsApp está conectado (por enquanto suporta Z-API).
// Retorna { ok, connected, message }.
async function testarConexao(user) {
  const provider = (user.wa_provider || '').toLowerCase();

  if (provider !== 'z-api' && provider !== 'zapi') {
    return { ok: false, message: 'O teste automático só funciona com Z-API por enquanto.' };
  }
  if (!user.wa_instance || !user.wa_api_token) {
    return { ok: false, message: 'Preencha a Instância e o Token e salve antes de testar.' };
  }

  try {
    const base = (user.wa_api_url && user.wa_api_url.trim())
      ? user.wa_api_url.replace(/\/$/, '') : 'https://api.z-api.io';
    const url = `${base}/instances/${user.wa_instance}/token/${user.wa_api_token}/status`;
    const headers = {};
    if (user.wa_client_token) headers['Client-Token'] = user.wa_client_token;

    const resp = await fetch(url, { headers });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      return { ok: false, message: `Erro do Z-API (HTTP ${resp.status}). Confira os dados.`, raw: data };
    }
    if (data.error) {
      return { ok: false, message: `Z-API: ${data.error}` };
    }
    if (data.connected) {
      return { ok: true, connected: true, message: 'WhatsApp conectado! ✅ Pode enviar mensagens.' };
    }
    return {
      ok: true,
      connected: false,
      message: 'Credenciais OK, mas o WhatsApp ainda NÃO está conectado. Leia o QR code no painel do Z-API.',
    };
  } catch (err) {
    return { ok: false, message: 'Não consegui falar com o Z-API: ' + err.message };
  }
}

module.exports = { enviarWhatsapp, normalizarTelefone, testarConexao };
