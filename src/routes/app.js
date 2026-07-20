// Páginas do painel (exigem login): dashboard, webhook, mensagens,
// configurações de envio, lista de rastreios e logs.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireLogin, baseUrl } = require('../middleware');
const { notificarCliente } = require('../services/notify');
const { gerarCodigo } = require('../services/tracking');
const { testarConexao } = require('../services/whatsapp');
const evolution = require('../services/evolution');
const billing = require('../services/billing');

const router = express.Router();
router.use(requireLogin);

// Deixa o saldo formatado e os preços disponíveis em todas as telas do painel.
router.use((req, res, next) => {
  res.locals.saldo = billing.saldo(req.user.id);
  res.locals.saldoBRL = billing.formatBRL(res.locals.saldo);
  res.locals.billing = billing;
  next();
});

// ---- Dashboard ------------------------------------------------------------
router.get('/', (req, res) => {
  const stats = {
    total: db.prepare('SELECT COUNT(*) c FROM trackings WHERE user_id = ?').get(req.user.id).c,
    msgs: db.prepare("SELECT COUNT(*) c FROM message_logs WHERE user_id = ?").get(req.user.id).c,
  };
  const ultimos = db.prepare(
    'SELECT * FROM trackings WHERE user_id = ? ORDER BY id DESC LIMIT 5'
  ).all(req.user.id);
  res.render('dashboard', { stats, ultimos, base: baseUrl(req) });
});

// ---- Webhook (mostra URL e permite regenerar token) -----------------------
router.get('/webhook', (req, res) => {
  res.render('webhook', { base: baseUrl(req), salvo: req.query.salvo });
});

router.post('/webhook/acao/regenerar', (req, res) => {
  const token = crypto.randomBytes(18).toString('hex');
  db.prepare('UPDATE users SET webhook_token = ? WHERE id = ?').run(token, req.user.id);
  res.redirect('/webhook?salvo=1');
});

// Dispara um pedido de TESTE (simula o gateway chamando o webhook).
// Caminho com 2 segmentos (/webhook/acao/...) para não colidir com a rota
// pública POST /webhook/:token.
router.post('/webhook/acao/testar', async (req, res) => {
  const code = gerarCodigo();
  const info = db.prepare(`
    INSERT INTO trackings (user_id, code, gateway_order_id, customer_name, customer_email, customer_phone, status, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, 'Pedido confirmado', ?)
  `).run(
    req.user.id, code, 'TESTE-' + Date.now(),
    'Cliente Teste', req.user.email, '11999999999',
    JSON.stringify({ teste: true })
  );
  const tracking = db.prepare('SELECT * FROM trackings WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO tracking_events (tracking_id, status, description) VALUES (?, ?, ?)')
    .run(tracking.id, tracking.status, 'Pedido de teste criado pelo painel');
  await notificarCliente(req.user, tracking, baseUrl(req));
  res.redirect('/rastreios');
});

// ---- Mensagens ------------------------------------------------------------
router.get('/mensagens', (req, res) => {
  res.render('mensagens', { salvo: req.query.salvo });
});

router.post('/mensagens', (req, res) => {
  db.prepare(`
    UPDATE users SET store_name=@store_name, msg_wpp=@msg_wpp,
      email_subject=@email_subject, msg_email=@msg_email WHERE id=@id
  `).run({
    id: req.user.id,
    store_name: (req.body.store_name || '').trim() || 'Minha Loja',
    msg_wpp: req.body.msg_wpp || '',
    email_subject: req.body.email_subject || '',
    msg_email: req.body.msg_email || '',
  });
  res.redirect('/mensagens?salvo=1');
});

// ---- Configurações de envio (modo, WhatsApp, SMTP) ------------------------
router.get('/config', (req, res) => {
  res.render('config', { salvo: req.query.salvo });
});

router.post('/config', (req, res) => {
  db.prepare(`
    UPDATE users SET
      send_mode=@send_mode,
      wa_provider=@wa_provider, wa_api_url=@wa_api_url, wa_api_token=@wa_api_token, wa_instance=@wa_instance,
      wa_client_token=@wa_client_token,
      smtp_host=@smtp_host, smtp_port=@smtp_port, smtp_user=@smtp_user, smtp_pass=@smtp_pass, smtp_from=@smtp_from
    WHERE id=@id
  `).run({
    id: req.user.id,
    send_mode: req.body.send_mode === 'real' ? 'real' : 'simulado',
    wa_provider: req.body.wa_provider || '',
    wa_api_url: req.body.wa_api_url || '',
    wa_api_token: req.body.wa_api_token || '',
    wa_instance: req.body.wa_instance || '',
    wa_client_token: req.body.wa_client_token || '',
    smtp_host: req.body.smtp_host || '',
    smtp_port: Number(req.body.smtp_port) || 587,
    smtp_user: req.body.smtp_user || '',
    smtp_pass: req.body.smtp_pass || '',
    smtp_from: req.body.smtp_from || '',
  });
  res.redirect('/config?salvo=1');
});

// Testa a conexão do WhatsApp (usado pelo botão "Testar conexão"). Retorna JSON.
router.post('/config/testar-whatsapp', async (req, res) => {
  const r = await testarConexao(req.user);
  res.json(r);
});

// ---- Conectar WhatsApp via QR (Evolution) ---------------------------------
router.get('/whatsapp', (req, res) => {
  res.render('whatsapp', { configurado: evolution.isConfigured() });
});

// Retorna o QR code (ou avisa que já está conectado). Chamado pela tela via fetch.
router.get('/whatsapp/qr', async (req, res) => {
  if (!evolution.isConfigured()) return res.json({ erro: 'Evolution não configurado no servidor.' });
  await evolution.ensureInstance(req.user);
  const r = await evolution.getQr(req.user);
  res.json(r);
});

// Estado da conexão. Quando conecta ('open'), grava a config de envio do cliente.
router.get('/whatsapp/state', async (req, res) => {
  if (!evolution.isConfigured()) return res.json({ state: 'unconfigured' });
  const state = await evolution.getState(req.user);
  if (state === 'open') {
    db.prepare(`
      UPDATE users SET wa_provider='evolution', wa_api_url=?, wa_instance=?, wa_api_token=?, send_mode='real'
      WHERE id=?
    `).run(evolution.EVOLUTION_URL, evolution.instanceName(req.user), evolution.EVOLUTION_API_KEY, req.user.id);
  }
  res.json({ state });
});

// Desconecta o WhatsApp do cliente.
router.post('/whatsapp/desconectar', async (req, res) => {
  await evolution.logout(req.user);
  res.redirect('/whatsapp');
});

// ---- Lista de rastreios ---------------------------------------------------
router.get('/rastreios', (req, res) => {
  const trackings = db.prepare(
    'SELECT * FROM trackings WHERE user_id = ? ORDER BY id DESC LIMIT 200'
  ).all(req.user.id);
  res.render('rastreios', { trackings, base: baseUrl(req) });
});

// Atualiza o status manualmente e (opcional) notifica de novo.
router.post('/rastreios/:id/status', async (req, res) => {
  const tracking = db.prepare('SELECT * FROM trackings WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!tracking) return res.redirect('/rastreios');

  const novoStatus = (req.body.status || '').trim();
  if (novoStatus) {
    db.prepare("UPDATE trackings SET status=?, updated_at=datetime('now') WHERE id=?")
      .run(novoStatus, tracking.id);
    db.prepare('INSERT INTO tracking_events (tracking_id, status, description) VALUES (?, ?, ?)')
      .run(tracking.id, novoStatus, 'Status atualizado manualmente');

    if (req.body.notificar) {
      const atualizado = db.prepare('SELECT * FROM trackings WHERE id = ?').get(tracking.id);
      await notificarCliente(req.user, atualizado, baseUrl(req));
    }
  }
  res.redirect('/rastreios');
});

// ---- Logs de mensagens ----------------------------------------------------
router.get('/logs', (req, res) => {
  const logs = db.prepare(
    'SELECT * FROM message_logs WHERE user_id = ? ORDER BY id DESC LIMIT 100'
  ).all(req.user.id);
  res.render('logs', { logs });
});

// ---- Saldo e extrato ------------------------------------------------------
router.get('/saldo', (req, res) => {
  const transacoes = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100'
  ).all(req.user.id);
  res.render('saldo', {
    transacoes,
    testTopup: process.env.TEST_TOPUP === '1',
    salvo: req.query.salvo,
  });
});

// Recarga de TESTE (só funciona se TEST_TOPUP=1 no ambiente). Adiciona saldo fake.
router.post('/saldo/recarga-teste', (req, res) => {
  if (process.env.TEST_TOPUP !== '1') return res.redirect('/saldo');
  const valor = Math.min(Math.max(Number(req.body.valor) || 10, 1), 1000); // R$1 a R$1000
  billing.creditar(req.user.id, Math.round(valor * 100), 'Recarga de teste');
  res.redirect('/saldo?salvo=1');
});

module.exports = router;
