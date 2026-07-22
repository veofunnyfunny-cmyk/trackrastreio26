// Cadastro, login e logout.
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const router = express.Router();

const findByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const insertUser = db.prepare(`
  INSERT INTO users (name, email, password_hash, webhook_token)
  VALUES (@name, @email, @password_hash, @webhook_token)
`);

const findReferrerByCode = db.prepare('SELECT * FROM referrers WHERE code = ?');

router.get('/register', (req, res) => {
  // Guarda a indicação (?ref=CODE) na sessão para vincular no cadastro.
  if (req.query.ref) req.session.ref = String(req.query.ref).trim();
  if (req.session.userId) return res.redirect('/');
  const indicador = req.session.ref ? findReferrerByCode.get(req.session.ref) : null;
  res.render('register', { erro: null, dados: {}, indicador: indicador || null });
});

router.post('/register', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const indicador = req.session.ref ? findReferrerByCode.get(req.session.ref) : null;
  const rerender = (erro) => res.render('register', { erro, dados: { name, email }, indicador: indicador || null });

  if (!name || !email || !password) return rerender('Preencha todos os campos.');
  if (password.length < 6) return rerender('A senha precisa ter pelo menos 6 caracteres.');
  if (findByEmail.get(email)) return rerender('Já existe uma conta com esse e-mail.');

  const password_hash = bcrypt.hashSync(password, 10);
  const webhook_token = crypto.randomBytes(18).toString('hex');
  const info = insertUser.run({ name, email, password_hash, webhook_token });

  // Vincula o novo usuário ao indicador (se veio por um link de indicação).
  if (indicador) {
    db.prepare('UPDATE users SET referrer_id = ? WHERE id = ?').run(indicador.id, info.lastInsertRowid);
    delete req.session.ref;
  }

  req.session.userId = info.lastInsertRowid;
  res.redirect('/');
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { erro: null, dados: {} });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';
  const user = findByEmail.get(email);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.render('login', { erro: 'E-mail ou senha inválidos.', dados: { email } });
  }

  req.session.userId = user.id;
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
