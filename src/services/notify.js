// Orquestra o envio das mensagens para o cliente final (WhatsApp + e-mail)
// e registra tudo em message_logs.

const db = require('../db');
const { renderTemplate } = require('./templates');
const { enviarWhatsapp } = require('./whatsapp');
const { enviarEmail } = require('./mailer');

const insertLog = db.prepare(`
  INSERT INTO message_logs (user_id, tracking_id, channel, destination, content, status, error)
  VALUES (@user_id, @tracking_id, @channel, @destination, @content, @status, @error)
`);

function montarVars(user, tracking, baseUrl) {
  return {
    nome: tracking.customer_name || 'cliente',
    codigo: tracking.code,
    status: tracking.status,
    link: `${baseUrl}/rastreio/${tracking.code}`,
    loja: user.store_name || '',
  };
}

// Dispara as notificações. `canais` limita quais enviar (padrão: ambos).
async function notificarCliente(user, tracking, baseUrl, canais = ['whatsapp', 'email']) {
  const vars = montarVars(user, tracking, baseUrl);
  const resultados = [];

  if (canais.includes('whatsapp')) {
    const texto = renderTemplate(user.msg_wpp, vars);
    const r = await enviarWhatsapp(user, tracking.customer_phone, texto);
    insertLog.run({
      user_id: user.id, tracking_id: tracking.id, channel: 'whatsapp',
      destination: r.destination || tracking.customer_phone, content: texto,
      status: r.status, error: r.error || null,
    });
    resultados.push({ canal: 'whatsapp', ...r });
  }

  if (canais.includes('email')) {
    const assunto = renderTemplate(user.email_subject, vars);
    const texto = renderTemplate(user.msg_email, vars);
    const r = await enviarEmail(user, tracking.customer_email, assunto, texto);
    insertLog.run({
      user_id: user.id, tracking_id: tracking.id, channel: 'email',
      destination: r.destination || tracking.customer_email, content: texto,
      status: r.status, error: r.error || null,
    });
    resultados.push({ canal: 'email', ...r });
  }

  return resultados;
}

module.exports = { notificarCliente, montarVars };
