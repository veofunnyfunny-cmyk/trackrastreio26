// Orquestra o envio das mensagens para o cliente final (WhatsApp + e-mail),
// cobra do saldo do usuário e registra tudo em message_logs.

const db = require('../db');
const { renderTemplate } = require('./templates');
const { enviarWhatsapp } = require('./whatsapp');
const { enviarEmail } = require('./mailer');
const billing = require('./billing');

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

// Envia por um canal, cobrando do saldo. Só cobra se a mensagem for enviada
// com sucesso. Se não houver saldo, nem tenta enviar.
async function enviarComCobranca(user, tracking, canal, destino, texto, enviar) {
  // 1) Sem saldo: bloqueia antes de enviar.
  if (!billing.temSaldo(user.id, canal)) {
    insertLog.run({
      user_id: user.id, tracking_id: tracking.id, channel: canal,
      destination: destino, content: texto, status: 'sem_saldo',
      error: `Saldo insuficiente (precisa de ${billing.formatBRL(billing.preco(canal))})`,
    });
    return { canal, status: 'sem_saldo', error: 'Saldo insuficiente' };
  }

  // 2) Envia.
  const r = await enviar();

  // 3) Cobra apenas se enviou de verdade.
  if (r.status === 'enviado') {
    billing.cobrar(user.id, canal, tracking.id);
  }

  insertLog.run({
    user_id: user.id, tracking_id: tracking.id, channel: canal,
    destination: r.destination || destino, content: texto,
    status: r.status, error: r.error || null,
  });
  return { canal, ...r };
}

// Dispara as notificações. `canais` limita quais enviar (padrão: ambos).
async function notificarCliente(user, tracking, baseUrl, canais = ['whatsapp', 'email']) {
  const vars = montarVars(user, tracking, baseUrl);
  const resultados = [];

  if (canais.includes('whatsapp')) {
    const texto = renderTemplate(user.msg_wpp, vars);
    resultados.push(await enviarComCobranca(
      user, tracking, 'whatsapp', tracking.customer_phone, texto,
      () => enviarWhatsapp(user, tracking.customer_phone, texto)
    ));
  }

  if (canais.includes('email')) {
    const assunto = renderTemplate(user.email_subject, vars);
    const texto = renderTemplate(user.msg_email, vars);
    resultados.push(await enviarComCobranca(
      user, tracking, 'email', tracking.customer_email, texto,
      () => enviarEmail(user, tracking.customer_email, assunto, texto)
    ));
  }

  return resultados;
}

module.exports = { notificarCliente, montarVars };
