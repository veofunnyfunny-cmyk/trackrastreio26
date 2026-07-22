// Página pública de rastreio (o que o cliente final vê).
const express = require('express');
const path = require('path');
const db = require('../db');
const stages = require('../services/stages');
const recharge = require('../services/recharge');
const billing = require('../services/billing');
const { UPLOAD_DIR } = require('../services/uploads');

const router = express.Router();

// Link curto de indicação: /r/CODE leva pro cadastro já com a indicação.
router.get('/r/:code', (req, res) => {
  res.redirect('/register?ref=' + encodeURIComponent(req.params.code));
});

// Serve a logo de uma loja (usada na página de rastreio).
router.get('/loja-logo/:id', (req, res) => {
  const u = db.prepare('SELECT logo_file FROM users WHERE id = ?').get(req.params.id);
  if (!u || !u.logo_file) return res.status(404).end();
  res.sendFile(path.join(UPLOAD_DIR, path.basename(u.logo_file)), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// Crédito manual (admin) — para dar saldo de teste sem pagamento.
// Só funciona se ADMIN_TOKEN estiver definido e for enviado no header.
// Ex.: curl -X POST .../admin/creditar -H "x-admin-token: XXX" -d '{"email":"a@a.com","valor":50}'
router.post('/admin/creditar', (req, res) => {
  const token = process.env.ADMIN_TOKEN;
  if (!token || req.headers['x-admin-token'] !== token) {
    return res.status(404).json({ ok: false }); // some quando não autorizado
  }
  const email = (req.body.email || '').trim().toLowerCase();
  const valor = Number(String(req.body.valor).replace(',', '.'));
  if (!email || !valor || valor <= 0) {
    return res.status(400).json({ ok: false, error: 'email e valor (>0) são obrigatórios' });
  }
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ ok: false, error: 'usuário não encontrado' });
  billing.creditar(user.id, Math.round(valor * 100), 'Crédito de teste (admin)');
  res.json({ ok: true, email, saldo: billing.formatBRL(billing.saldo(user.id)) });
});

// Webhook do gateway Pix (Roundfy) avisando pagamento. É best-effort e pode
// ser forjado, então NÃO confiamos no corpo: apenas usamos o txid para
// reconsultar a Roundfy e creditar (a verificação real está no recharge).
router.post('/pix/webhook', async (req, res) => {
  const txid = req.body && (req.body.txid || req.body.id);
  if (txid) {
    recharge.conferirEcreditar(String(txid)).catch((e) => console.error('pix webhook:', e.message));
  }
  res.json({ ok: true });
});

// Busca (form) e consulta direta por código.
router.get('/rastreio', (req, res) => {
  const code = (req.query.code || '').trim().toUpperCase();
  if (code) return res.redirect('/rastreio/' + encodeURIComponent(code));
  res.render('public/buscar', { erro: null });
});

router.get('/rastreio/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const tracking = db.prepare('SELECT * FROM trackings WHERE code = ?').get(code);
  if (!tracking) {
    return res.status(404).render('public/buscar', { erro: 'Código não encontrado: ' + code });
  }
  const user = db.prepare('SELECT store_name, logo_file FROM users WHERE id = ?').get(tracking.user_id);

  // Jornada automática (avança com o tempo). ?dia=N permite pré-visualizar
  // qualquer ponto da jornada sem esperar (modo de teste).
  const overrideDias = req.query.dia;
  const jornada = stages.timeline(tracking, overrideDias);

  res.render('public/rastreio', {
    tracking,
    jornada,
    loja: user ? user.store_name : '',
    logoUrl: user && user.logo_file ? '/loja-logo/' + tracking.user_id : null,
    preview: overrideDias !== undefined ? String(overrideDias) : null,
  });
});

module.exports = router;
