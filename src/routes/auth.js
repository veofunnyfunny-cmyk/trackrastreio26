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

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { erro: null, dados: {} });
});

router.post('/register', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!name || !email || !password) {
    return res.render('register', { erro: 'Preencha todos os campos.', dados: { name, email } });
  }
  if (password.length < 6) {
    return res.render('register', { erro: 'A senha precisa ter pelo menos 6 caracteres.', dados: { name, email } });
  }
  if (findByEmail.get(email)) {
    return res.render('register', { erro: 'Já existe uma conta com esse e-mail.', dados: { name, email } });
  }

  const password_hash = bcrypt.hashSync(password, 10);
  const webhook_token = crypto.randomBytes(18).toString('hex');
  const info = insertUser.run({ name, email, password_hash, webhook_token });

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
