// Endpoint PÚBLICO que os gateways chamam.
// URL: POST /webhook/:token
//
// Aceita JSON em vários formatos (os gateways de drop mandam campos com
// nomes diferentes), então tentamos extrair nome/email/telefone de várias
// chaves possíveis. O payload cru fica salvo em raw_payload pra você ajustar
// o mapeamento depois de ver o que cada gateway manda de verdade.

const express = require('express');
const db = require('../db');
const { baseUrl } = require('../middleware');
const { gerarCodigo } = require('../services/tracking');
const { notificarCliente } = require('../services/notify');

const router = express.Router();

const findByToken = db.prepare('SELECT * FROM users WHERE webhook_token = ?');

// Procura o primeiro valor não-vazio entre várias chaves possíveis (inclusive aninhadas).
function pick(obj, chaves) {
  for (const chave of chaves) {
    const partes = chave.split('.');
    let v = obj;
    for (const p of partes) {
      if (v && typeof v === 'object' && v[p] !== undefined) v = v[p];
      else { v = undefined; break; }
    }
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

router.post('/webhook/:token', async (req, res) => {
  const user = findByToken.get(req.params.token);
  if (!user) return res.status(404).json({ ok: false, error: 'Webhook não encontrado' });

  const body = req.body || {};

  const customer_name = pick(body, [
    'customer_name', 'name', 'nome', 'cliente', 'customer.name', 'customer.first_name', 'buyer.name', 'data.customer.name',
  ]);
  const customer_email = pick(body, [
    'customer_email', 'email', 'e-mail', 'customer.email', 'buyer.email', 'data.customer.email',
  ]);
  const customer_phone = pick(body, [
    'customer_phone', 'phone', 'telefone', 'celular', 'whatsapp', 'customer.phone', 'customer.phone_number', 'buyer.phone', 'data.customer.phone',
  ]);
  const gateway_order_id = pick(body, [
    'order_id', 'id', 'pedido', 'transaction_id', 'order.id', 'data.id', 'data.order_id',
  ]);

  const code = gerarCodigo();
  const info = db.prepare(`
    INSERT INTO trackings (user_id, code, gateway_order_id, customer_name, customer_email, customer_phone, status, raw_payload)
    VALUES (?, ?, ?, ?, ?, ?, 'Pedido confirmado', ?)
  `).run(
    user.id, code, gateway_order_id || null,
    customer_name || null, customer_email || null, customer_phone || null,
    JSON.stringify(body)
  );

  const tracking = db.prepare('SELECT * FROM trackings WHERE id = ?').get(info.lastInsertRowid);
  db.prepare('INSERT INTO tracking_events (tracking_id, status, description) VALUES (?, ?, ?)')
    .run(tracking.id, tracking.status, 'Pedido recebido via webhook');

  // Dispara as notificações (não trava a resposta pro gateway se der erro).
  notificarCliente(user, tracking, baseUrl(req)).catch((e) =>
    console.error('Erro ao notificar:', e.message)
  );

  res.json({
    ok: true,
    tracking_code: code,
    tracking_url: `${baseUrl(req)}/rastreio/${code}`,
  });
});

module.exports = router;
