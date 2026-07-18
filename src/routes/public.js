// Página pública de rastreio (o que o cliente final vê).
const express = require('express');
const db = require('../db');

const router = express.Router();

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
  const user = db.prepare('SELECT store_name FROM users WHERE id = ?').get(tracking.user_id);
  const eventos = db.prepare(
    'SELECT * FROM tracking_events WHERE tracking_id = ? ORDER BY id DESC'
  ).all(tracking.id);
  res.render('public/rastreio', { tracking, eventos, loja: user ? user.store_name : '' });
});

module.exports = router;
