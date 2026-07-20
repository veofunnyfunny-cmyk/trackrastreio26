// Conversa com o Evolution API (o "motor" de WhatsApp com QR code).
//
// A URL e a chave do Evolution são configuradas UMA vez, a nível de
// plataforma, via variáveis de ambiente (.env):
//   EVOLUTION_URL=http://localhost:8080
//   EVOLUTION_API_KEY=xxxxxxxx
//
// Cada cliente (user) do sistema tem sua própria "instância" no Evolution,
// nomeada de forma única: rastreio_<id>. Assim cada um conecta o próprio
// WhatsApp pelo QR, sem ver nenhum dado técnico.

const EVOLUTION_URL = (process.env.EVOLUTION_URL || 'http://localhost:8080').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

const isConfigured = () => Boolean(EVOLUTION_API_KEY);

function instanceName(user) {
  return `rastreio_${user.id}`;
}

async function api(path, opts = {}) {
  try {
    const res = await fetch(`${EVOLUTION_URL}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY, ...(opts.headers || {}) },
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }
}

// Cria a instância do cliente se ainda não existir (ignora "já existe").
async function ensureInstance(user) {
  const name = instanceName(user);
  await api('/instance/create', {
    method: 'POST',
    body: JSON.stringify({ instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true }),
  });
  return name;
}

// Estado da conexão: 'open' (conectado), 'connecting', 'close', 'unknown'.
async function getState(user) {
  const r = await api(`/instance/connectionState/${instanceName(user)}`);
  if (!r.ok || !r.data || !r.data.instance) return 'unknown';
  return r.data.instance.state || 'unknown';
}

// Retorna o QR (base64) para conectar, ou indica que já está conectado.
async function getQr(user) {
  const name = instanceName(user);
  const state = await getState(user);
  if (state === 'open') return { connected: true, qr: null };

  const r = await api(`/instance/connect/${name}`);
  const qr = r.data && (r.data.base64 || (r.data.qrcode && r.data.qrcode.base64)) || null;
  return { connected: false, qr };
}

// Desconecta o WhatsApp do cliente (faz logout no aparelho).
async function logout(user) {
  return api(`/instance/logout/${instanceName(user)}`, { method: 'DELETE' });
}

// Envia uma mensagem de texto pela instância do cliente.
async function sendText(user, numero, texto) {
  const r = await api(`/message/sendText/${instanceName(user)}`, {
    method: 'POST',
    body: JSON.stringify({ number: numero, text: texto }),
  });
  return r;
}

module.exports = {
  EVOLUTION_URL, EVOLUTION_API_KEY, isConfigured,
  instanceName, ensureInstance, getState, getQr, logout, sendText,
};
