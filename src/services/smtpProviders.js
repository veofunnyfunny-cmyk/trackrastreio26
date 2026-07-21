// Descobre as configurações de SMTP a partir do domínio do e-mail.
// Assim o cliente só informa e-mail + senha; o resto é automático.

const PROVIDERS = {
  'gmail.com':     { host: 'smtp.gmail.com',        port: 587, nome: 'Gmail',   appPass: true },
  'googlemail.com':{ host: 'smtp.gmail.com',        port: 587, nome: 'Gmail',   appPass: true },
  'outlook.com':   { host: 'smtp.office365.com',    port: 587, nome: 'Outlook', appPass: false },
  'hotmail.com':   { host: 'smtp.office365.com',    port: 587, nome: 'Outlook', appPass: false },
  'live.com':      { host: 'smtp.office365.com',    port: 587, nome: 'Outlook', appPass: false },
  'yahoo.com':     { host: 'smtp.mail.yahoo.com',   port: 587, nome: 'Yahoo',   appPass: true },
  'yahoo.com.br':  { host: 'smtp.mail.yahoo.com',   port: 587, nome: 'Yahoo',   appPass: true },
  'icloud.com':    { host: 'smtp.mail.me.com',      port: 587, nome: 'iCloud',  appPass: true },
  'zoho.com':      { host: 'smtp.zoho.com',         port: 587, nome: 'Zoho',    appPass: false },
  'uol.com.br':    { host: 'smtps.uol.com.br',      port: 587, nome: 'UOL',     appPass: false },
  'bol.com.br':    { host: 'smtps.bol.com.br',      port: 587, nome: 'BOL',     appPass: false },
};

function dominio(email) {
  return String(email || '').split('@')[1]?.trim().toLowerCase() || '';
}

function lookup(email) {
  return PROVIDERS[dominio(email)] || null;
}

module.exports = { PROVIDERS, lookup, dominio };
