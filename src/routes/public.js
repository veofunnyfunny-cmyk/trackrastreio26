// Página pública de rastreio (o que o cliente final vê).
const express = require('express');
const db = require('../db');
const stages = require('../services/stages');

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

  // Jornada automática (avança com o tempo). ?dia=N permite pré-visualizar
  // qualquer ponto da jornada sem esperar (modo de teste).
  const overrideDias = req.query.dia;
  const jornada = stages.timeline(tracking, overrideDias);

  res.render('public/rastreio', {
    tracking,
    jornada,
    loja: user ? user.store_name : '',
    preview: overrideDias !== undefined ? String(overrideDias) : null,
  });
});

module.exports = router;
