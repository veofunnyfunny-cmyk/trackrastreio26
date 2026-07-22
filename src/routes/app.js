// Páginas do painel (exigem login): dashboard, webhook, mensagens,
// configurações de envio, lista de rastreios e logs.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireLogin, baseUrl, isAdmin, requireAdmin } = require('../middleware');
const { notificarCliente } = require('../services/notify');
const { gerarCodigo } = require('../services/tracking');
const evolution = require('../services/evolution');
const billing = require('../services/billing');
const stages = require('../services/stages');
const pix = require('../services/pix');
const recharge = require('../services/recharge');
const QRCode = require('qrcode');
const smtpProviders = require('../services/smtpProviders');
const mailer = require('../services/mailer');
const { uploadLogo } = require('../services/uploads');

const router = express.Router();
router.use(requireLogin);

// Deixa o saldo formatado e os preços disponíveis em todas as telas do painel.
router.use((req, res, next) => {
  res.locals.saldo = billing.saldo(req.user.id);
  res.locals.saldoBRL = billing.formatBRL(res.locals.saldo);
  res.locals.billing = billing;
  res.locals.isAdmin = isAdmin(req.user);
  res.locals.impersonating = Boolean(req.session.adminId);
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
  ultimos.forEach((t) => { t.status_atual = stages.statusAtual(t); });
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
    INSERT INTO trackings (user_id, code, gateway_order_id, customer_name, customer_email, customer_phone,
      customer_cep, customer_city, customer_state, status, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pedido confirmado', ?)
  `).run(
    req.user.id, code, 'TESTE-' + Date.now(),
    'Cliente Teste', req.user.email, '11999999999',
    '20000-000', 'Rio de Janeiro', 'RJ',
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
    UPDATE users SET msg_wpp=@msg_wpp, email_subject=@email_subject, msg_email=@msg_email WHERE id=@id
  `).run({
    id: req.user.id,
    msg_wpp: req.body.msg_wpp || '',
    email_subject: req.body.email_subject || '',
    msg_email: req.body.msg_email || '',
  });
  res.redirect('/mensagens?salvo=1');
});

// ---- Configurações de envio (modo, WhatsApp, SMTP) ------------------------
router.get('/config', (req, res) => {
  res.render('config', { salvo: req.query.salvo, erro: req.query.erro, emailCentral: mailer.emailCentralAtivo() });
});

// Upload da logo da loja (aparece na página de rastreio do cliente).
router.post('/config/logo', (req, res) => {
  uploadLogo(req, res, (err) => {
    if (err) return res.redirect('/config?erro=' + encodeURIComponent(err.message));
    if (req.file) {
      db.prepare('UPDATE users SET logo_file = ? WHERE id = ?').run(req.file.filename, req.user.id);
    }
    res.redirect('/config?salvo=1');
  });
});

// Remove a logo da loja.
router.post('/config/logo/remover', (req, res) => {
  db.prepare("UPDATE users SET logo_file = '' WHERE id = ?").run(req.user.id);
  res.redirect('/config?salvo=1');
});

router.post('/config', (req, res) => {
  const store_name = (req.body.store_name || '').trim() || 'Minha Loja';

  // E-mail simplificado: cliente informa só e-mail + senha; derivamos o resto.
  const smtpEmail = (req.body.smtp_email || '').trim();
  const prov = smtpProviders.lookup(smtpEmail);
  const smtp_host = (req.body.smtp_host_manual || '').trim() || (prov ? prov.host : '');
  const smtp_port = Number(req.body.smtp_port_manual) || (prov ? prov.port : 587);
  const smtp_user = smtpEmail;
  const smtp_from = smtpEmail ? `${store_name} <${smtpEmail}>` : '';
  // Só troca a senha se uma nova foi digitada (senão mantém a atual).
  const smtp_pass = req.body.smtp_pass ? req.body.smtp_pass : (req.user.smtp_pass || '');

  // Obs.: os campos de WhatsApp (wa_*) NÃO são tocados aqui — a conexão é
  // gerenciada pela aba "Conectar WhatsApp" (QR do Evolution). Salvar as
  // configurações não pode derrubar o WhatsApp conectado.
  // Canais de envio (checkboxes: presente = ligado).
  const notify_whatsapp = req.body.notify_whatsapp ? 1 : 0;
  const notify_email = req.body.notify_email ? 1 : 0;

  db.prepare(`
    UPDATE users SET
      store_name=@store_name,
      notify_whatsapp=@notify_whatsapp, notify_email=@notify_email,
      smtp_host=@smtp_host, smtp_port=@smtp_port, smtp_user=@smtp_user, smtp_pass=@smtp_pass, smtp_from=@smtp_from
    WHERE id=@id
  `).run({
    id: req.user.id,
    store_name, notify_whatsapp, notify_email,
    smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from,
  });
  res.redirect('/config?salvo=1');
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
  trackings.forEach((t) => { t.status_atual = stages.statusAtual(t); });
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
    pixConfigured: pix.isConfigured(),
    erro: null,
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

// Validação de CPF (dígitos verificadores).
function cpfValido(valor) {
  const cpf = String(valor || '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += parseInt(cpf[i], 10) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += parseInt(cpf[i], 10) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

function renderSaldoErro(req, res, erro) {
  return res.render('saldo', {
    transacoes: db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 100').all(req.user.id),
    testTopup: process.env.TEST_TOPUP === '1', pixConfigured: pix.isConfigured(),
    erro, salvo: null,
  });
}

// ---- Recarga via Pix (Roundfy) --------------------------------------------
// Gera a cobrança Pix e leva para a página do QR code.
router.post('/saldo/pix/criar', async (req, res) => {
  if (!pix.isConfigured()) return res.redirect('/saldo');

  const valor = Number(String(req.body.valor).replace(',', '.'));
  const amountCents = Math.round(valor * 100);
  if (!amountCents || amountCents < 5000) {         // mínimo R$ 50,00
    return renderSaldoErro(req, res, 'Valor mínimo de recarga: R$ 50,00.');
  }

  const cpf = (req.body.cpf || '').replace(/\D/g, '');
  if (!cpfValido(cpf)) {
    return renderSaldoErro(req, res, 'Informe um CPF válido para gerar o Pix.');
  }

  try {
    const customer = { name: req.user.name, email: req.user.email, taxId: cpf };

    const { txid, pix_code } = await pix.criarPix({
      amountCents, description: `Recarga de saldo - ${req.user.email}`, customer,
    });

    db.prepare(`INSERT INTO pix_charges (user_id, txid, amount_cents, status, pix_code)
                VALUES (?, ?, ?, 'pending', ?)`).run(req.user.id, txid, amountCents, pix_code);

    res.redirect('/saldo/pix/' + encodeURIComponent(txid));
  } catch (err) {
    renderSaldoErro(req, res, 'Não foi possível gerar o Pix: ' + err.message);
  }
});

// Página com o QR code do Pix (fica fazendo polling até pagar).
router.get('/saldo/pix/:txid', async (req, res) => {
  const charge = db.prepare('SELECT * FROM pix_charges WHERE txid = ? AND user_id = ?')
    .get(req.params.txid, req.user.id);
  if (!charge) return res.redirect('/saldo');
  const qrDataUrl = await QRCode.toDataURL(charge.pix_code, { margin: 1, width: 260 });
  res.render('saldo_pix', { charge, qrDataUrl });
});

// Status da cobrança (chamado pelo polling da página). Credita se aprovado.
router.get('/saldo/pix/:txid/status', async (req, res) => {
  const charge = db.prepare('SELECT id FROM pix_charges WHERE txid = ? AND user_id = ?')
    .get(req.params.txid, req.user.id);
  if (!charge) return res.json({ status: 'nao_encontrado' });
  const r = await recharge.conferirEcreditar(req.params.txid);
  res.json({ status: r.status, saldoBRL: billing.formatBRL(billing.saldo(req.user.id)) });
});

// ==========================================================================
// PAINEL ADMIN (só para e-mails em ADMIN_EMAILS)
// ==========================================================================

// Lista todas as contas, com busca por ID/nome/e-mail.
router.get('/admin', requireAdmin, (req, res) => {
  const q = (req.query.q || '').trim();
  let contas;
  if (q) {
    const like = `%${q}%`;
    contas = db.prepare(`
      SELECT * FROM users
      WHERE CAST(id AS TEXT) = ? OR email LIKE ? OR name LIKE ?
      ORDER BY id DESC LIMIT 200
    `).all(q, like, like);
  } else {
    contas = db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 200').all();
  }
  contas.forEach((c) => {
    c.n_rastreios = db.prepare('SELECT COUNT(*) c FROM trackings WHERE user_id = ?').get(c.id).c;
  });
  const totalContas = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  res.render('admin/list', { contas, q, totalContas });
});

// Detalhe de uma conta (com ações de admin).
router.get('/admin/user/:id', requireAdmin, (req, res) => {
  const conta = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!conta) return res.redirect('/admin');
  const stats = {
    rastreios: db.prepare('SELECT COUNT(*) c FROM trackings WHERE user_id = ?').get(conta.id).c,
    msgs: db.prepare('SELECT COUNT(*) c FROM message_logs WHERE user_id = ?').get(conta.id).c,
    saldo: billing.formatBRL(billing.saldo(conta.id)),
  };
  const transacoes = db.prepare(
    'SELECT * FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20'
  ).all(conta.id);
  res.render('admin/user', { conta, stats, transacoes, salvo: req.query.salvo });
});

// Credita saldo numa conta.
router.post('/admin/user/:id/creditar', requireAdmin, (req, res) => {
  const conta = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!conta) return res.redirect('/admin');
  const valor = Number(String(req.body.valor).replace(',', '.'));
  if (valor && valor > 0) {
    billing.creditar(conta.id, Math.round(valor * 100), 'Crédito manual (admin)');
  }
  res.redirect('/admin/user/' + conta.id + '?salvo=1');
});

// Entrar como o usuário (impersonar) — guarda o id do admin para voltar.
router.post('/admin/impersonate/:id', requireAdmin, (req, res) => {
  const alvo = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!alvo) return res.redirect('/admin');
  req.session.adminId = req.user.id;
  req.session.userId = alvo.id;
  res.redirect('/');
});

// Voltar para a conta admin (sai da impersonação).
router.post('/admin/voltar', (req, res) => {
  if (req.session.adminId) {
    req.session.userId = req.session.adminId;
    delete req.session.adminId;
  }
  res.redirect('/admin');
});

// ---- Admin: Programa de Indicação ----------------------------------------
function statsIndicador(r) {
  r.signups = db.prepare('SELECT COUNT(*) c FROM users WHERE referrer_id = ?').get(r.id).c;
  const a = db.prepare('SELECT COALESCE(SUM(deposit_cents),0) dep, COALESCE(SUM(commission_cents),0) com FROM referral_earnings WHERE referrer_id = ?').get(r.id);
  r.total_dep = a.dep; r.total_com = a.com;
  return r;
}

router.get('/admin/indicacoes', requireAdmin, (req, res) => {
  const refs = db.prepare('SELECT * FROM referrers ORDER BY id DESC').all().map(statsIndicador);
  res.render('admin/referrals', { refs, base: baseUrl(req), salvo: req.query.salvo });
});

router.post('/admin/indicacoes/criar', requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  const percent = Math.max(0, Math.min(100, Number(String(req.body.percent).replace(',', '.')) || 0));
  if (!name) return res.redirect('/admin/indicacoes');
  let code;
  for (let i = 0; i < 12; i++) {
    code = crypto.randomBytes(4).toString('hex');
    if (!db.prepare('SELECT 1 FROM referrers WHERE code = ?').get(code)) break;
  }
  db.prepare('INSERT INTO referrers (name, code, percent) VALUES (?, ?, ?)').run(name, code, percent);
  res.redirect('/admin/indicacoes?salvo=1');
});

router.post('/admin/indicacoes/:id/percent', requireAdmin, (req, res) => {
  const percent = Math.max(0, Math.min(100, Number(String(req.body.percent).replace(',', '.')) || 0));
  db.prepare('UPDATE referrers SET percent = ? WHERE id = ?').run(percent, req.params.id);
  res.redirect('/admin/indicacoes?salvo=1');
});

router.post('/admin/indicacoes/:id/remover', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM referrers WHERE id = ?').run(req.params.id);
  res.redirect('/admin/indicacoes');
});

router.get('/admin/indicacoes/:id', requireAdmin, (req, res) => {
  const ref = statsIndicador(db.prepare('SELECT * FROM referrers WHERE id = ?').get(req.params.id) || {});
  if (!ref.id) return res.redirect('/admin/indicacoes');
  const earnings = db.prepare(
    'SELECT e.*, u.email FROM referral_earnings e LEFT JOIN users u ON u.id = e.user_id WHERE e.referrer_id = ? ORDER BY e.id DESC LIMIT 100'
  ).all(ref.id);
  const usuarios = db.prepare('SELECT id, name, email, created_at FROM users WHERE referrer_id = ? ORDER BY id DESC').all(ref.id);
  res.render('admin/referral', { ref, earnings, usuarios, base: baseUrl(req) });
});

module.exports = router;
