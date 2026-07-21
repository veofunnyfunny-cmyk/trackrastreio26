// Helpers compartilhados: exigir login e carregar o usuário logado.
const db = require('./db');

const getUserById = db.prepare('SELECT * FROM users WHERE id = ?');

function requireLogin(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  const user = getUserById.get(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.redirect('/login');
  }
  req.user = user;
  res.locals.user = user; // disponível nas views
  next();
}

// Admin: definido pela variável ADMIN_EMAILS (e-mails separados por vírgula).
function isAdmin(user) {
  const lista = (process.env.ADMIN_EMAILS || '')
    .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  return Boolean(user && lista.includes(String(user.email || '').toLowerCase()));
}

// Exige que o usuário logado seja admin (senão 404, para não revelar a rota).
function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) return res.status(404).send('Página não encontrada');
  next();
}

// URL base do sistema (para montar o link de rastreio). Respeita proxy.
function baseUrl(req) {
  if (process.env.BASE_URL) return process.env.BASE_URL.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  return `${proto}://${req.get('host')}`;
}

module.exports = { requireLogin, baseUrl, isAdmin, requireAdmin };
