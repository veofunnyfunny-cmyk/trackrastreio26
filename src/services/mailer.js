// Envio de e-mail via SMTP (nodemailer).
//
// Modo CENTRAL (recomendado): se as variáveis EMAIL_* estiverem no ambiente,
// TODOS os clientes enviam por essa conta (ex.: Brevo). O cliente não configura
// nada; o nome da loja dele aparece como remetente.
//
// Modo por cliente (fallback): se não houver conta central, usa o SMTP que o
// próprio cliente configurou nas Configurações.

const nodemailer = require('nodemailer');

// A conta central está configurada?
function emailCentralAtivo() {
  return Boolean(process.env.EMAIL_HOST && process.env.EMAIL_USER);
}

function sanitizeName(nome) {
  return String(nome || 'Rastreio').replace(/["\\\r\n]/g, '').trim() || 'Rastreio';
}

async function enviarEmail(user, destino, assunto, texto) {
  if (!destino) {
    return { status: 'erro', error: 'E-mail do cliente não informado' };
  }

  let host, port, authUser, pass, from;

  if (emailCentralAtivo()) {
    // Conta central (uma configuração para todos).
    host = process.env.EMAIL_HOST;
    port = Number(process.env.EMAIL_PORT) || 587;
    authUser = process.env.EMAIL_USER;
    pass = process.env.EMAIL_PASS || '';
    const fromEmail = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    from = `"${sanitizeName(user.store_name)}" <${fromEmail}>`;
  } else {
    // SMTP do próprio cliente.
    if (!user.smtp_host || !user.smtp_user) {
      return { status: 'erro', destination: destino, error: 'E-mail não configurado' };
    }
    host = user.smtp_host;
    port = Number(user.smtp_port) || 587;
    authUser = user.smtp_user;
    pass = user.smtp_pass;
    from = user.smtp_from || user.smtp_user;
  }

  try {
    const opts = { host, port, secure: port === 465, auth: { user: authUser, pass } };
    // O Brevo às vezes apresenta certificado com o nome antigo (sendinblue.com).
    // Fixamos o servername para o certificado sempre validar.
    if (/brevo\.com|sendinblue\.com/i.test(host)) {
      opts.tls = { servername: 'smtp-relay.sendinblue.com' };
    }
    const transporter = nodemailer.createTransport(opts);
    await transporter.sendMail({ from, to: destino, subject: assunto, text: texto });
    return { status: 'enviado', destination: destino };
  } catch (err) {
    return { status: 'erro', destination: destino, error: err.message };
  }
}

module.exports = { enviarEmail, emailCentralAtivo };
