// Envio de e-mail via SMTP (nodemailer).
// Igual ao WhatsApp: em modo "simulado" só loga; em modo "real" usa o SMTP
// que o cliente configurou na aba Configurações.

const nodemailer = require('nodemailer');

async function enviarEmail(user, destino, assunto, texto) {
  if (!destino) {
    return { status: 'erro', error: 'E-mail do cliente não informado' };
  }

  if (user.send_mode !== 'real') {
    console.log(`\n[EMAIL SIMULADO] para ${destino}\nAssunto: ${assunto}\n${texto}\n`);
    return { status: 'simulado', destination: destino };
  }

  if (!user.smtp_host || !user.smtp_user) {
    return { status: 'erro', destination: destino, error: 'SMTP não configurado' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: user.smtp_host,
      port: Number(user.smtp_port) || 587,
      secure: Number(user.smtp_port) === 465, // 465 = SSL
      auth: { user: user.smtp_user, pass: user.smtp_pass },
    });

    await transporter.sendMail({
      from: user.smtp_from || user.smtp_user,
      to: destino,
      subject: assunto,
      text: texto,
    });

    return { status: 'enviado', destination: destino };
  } catch (err) {
    return { status: 'erro', destination: destino, error: err.message };
  }
}

module.exports = { enviarEmail };
