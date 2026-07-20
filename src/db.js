// Camada de banco de dados (SQLite via better-sqlite3).
// Um único arquivo `data/rastreio.db` guarda tudo. Fácil de abrir com
// qualquer visualizador de SQLite (ex.: DB Browser for SQLite).

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Onde o arquivo do banco fica. Em produção (ex.: Render com disco persistente)
// aponte DATA_DIR para o caminho do disco montado, ex.: DATA_DIR=/var/data.
// Localmente cai na pasta ./data do projeto.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'rastreio.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------------------------------------------------------------------------
// Esquema. Cada cliente (user) tem seus próprios rastreios e configurações,
// então tudo é isolado por user_id.
// ---------------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT    NOT NULL,
  email             TEXT    NOT NULL UNIQUE,
  password_hash     TEXT    NOT NULL,
  webhook_token     TEXT    NOT NULL UNIQUE,

  -- Templates de mensagem (com variáveis {nome} {codigo} {status} {link} {loja})
  msg_wpp           TEXT    NOT NULL DEFAULT 'Olá {nome}! Seu pedido foi confirmado. 🚚\nAcompanhe o rastreio pelo código {codigo}: {link}',
  email_subject     TEXT    NOT NULL DEFAULT 'Seu código de rastreio: {codigo}',
  msg_email         TEXT    NOT NULL DEFAULT 'Olá {nome},\n\nRecebemos seu pedido e ele já está sendo preparado.\n\nCódigo de rastreio: {codigo}\nAcompanhe aqui: {link}\n\nStatus atual: {status}\n\nObrigado pela compra!',
  store_name        TEXT    NOT NULL DEFAULT 'Minha Loja',

  -- Envio: modo pode ser "simulado" (só loga) ou "real"
  send_mode         TEXT    NOT NULL DEFAULT 'simulado',

  -- WhatsApp (provider genérico HTTP no estilo Z-API/Evolution)
  wa_provider       TEXT    DEFAULT '',
  wa_api_url        TEXT    DEFAULT '',
  wa_api_token      TEXT    DEFAULT '',
  wa_instance       TEXT    DEFAULT '',

  -- E-mail (SMTP)
  smtp_host         TEXT    DEFAULT '',
  smtp_port         INTEGER DEFAULT 587,
  smtp_user         TEXT    DEFAULT '',
  smtp_pass         TEXT    DEFAULT '',
  smtp_from         TEXT    DEFAULT '',

  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trackings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code              TEXT    NOT NULL UNIQUE,          -- código de rastreio (aleatório por enquanto)
  gateway_order_id  TEXT,                             -- id do pedido no gateway
  customer_name     TEXT,
  customer_email    TEXT,
  customer_phone    TEXT,
  status            TEXT    NOT NULL DEFAULT 'Pedido confirmado',
  raw_payload       TEXT,                             -- JSON cru recebido do gateway (debug)
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_trackings_user ON trackings(user_id);

CREATE TABLE IF NOT EXISTS tracking_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tracking_id       INTEGER NOT NULL REFERENCES trackings(id) ON DELETE CASCADE,
  status            TEXT    NOT NULL,
  description       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_tracking ON tracking_events(tracking_id);

CREATE TABLE IF NOT EXISTS message_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tracking_id       INTEGER REFERENCES trackings(id) ON DELETE SET NULL,
  channel           TEXT    NOT NULL,                 -- 'whatsapp' | 'email'
  destination       TEXT,
  content           TEXT,
  status            TEXT    NOT NULL,                 -- 'enviado' | 'simulado' | 'erro'
  error             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_logs_user ON message_logs(user_id);
`);

// ---------------------------------------------------------------------------
// Migrações simples: colunas adicionadas depois da criação inicial.
// (roda toda vez, mas só adiciona se ainda não existir)
// ---------------------------------------------------------------------------
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('wa_client_token')) {
  // Token de segurança da conta Z-API (header Client-Token). Opcional.
  db.exec("ALTER TABLE users ADD COLUMN wa_client_token TEXT DEFAULT ''");
}
if (!userCols.includes('balance_cents')) {
  // Saldo do cliente em CENTAVOS (inteiro, para não ter erro de arredondamento).
  db.exec('ALTER TABLE users ADD COLUMN balance_cents INTEGER NOT NULL DEFAULT 0');
}

// Extrato de transações (créditos = recargas, débitos = mensagens enviadas).
db.exec(`
CREATE TABLE IF NOT EXISTS transactions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL,               -- 'credito' | 'debito'
  amount_cents  INTEGER NOT NULL,               -- sempre positivo
  description   TEXT,
  channel       TEXT,                           -- 'whatsapp' | 'email' | NULL
  tracking_id   INTEGER REFERENCES trackings(id) ON DELETE SET NULL,
  provider_ref  TEXT,                           -- id do pagamento no gateway (recargas)
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
`);

module.exports = db;
