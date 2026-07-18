// Ponto de entrada do sistema de rastreio.
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./src/routes/auth');
const appRoutes = require('./src/routes/app');
const webhookRoutes = require('./src/routes/webhook');
const publicRoutes = require('./src/routes/public');

const app = express();
const PORT = process.env.PORT || 3000;

// Em produção o app roda atrás do proxy do Render/hospedagem.
// Isso faz o Express confiar no cabeçalho X-Forwarded-Proto (https) para
// montar corretamente o link de rastreio e os cookies.
app.set('trust proxy', 1);

// Views (EJS) com layout via ejs partials.
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsers (webhooks mandam JSON; formulários mandam urlencoded).
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos (CSS).
app.use('/static', express.static(path.join(__dirname, 'public')));

// Sessão de login.
app.use(session({
  secret: process.env.SESSION_SECRET || 'troque-esse-segredo-em-producao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 dias
}));

// Rotas públicas (não exigem login).
app.use('/', authRoutes);
app.use('/', webhookRoutes);
app.use('/', publicRoutes);

// Rotas do painel (exigem login) — registradas por último.
app.use('/', appRoutes);

// 404 simples.
app.use((req, res) => res.status(404).send('Página não encontrada'));

app.listen(PORT, () => {
  console.log(`\n✅ Sistema de rastreio rodando em http://localhost:${PORT}\n`);
});
