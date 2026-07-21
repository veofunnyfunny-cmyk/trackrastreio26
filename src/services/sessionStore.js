// Guardador de sessões de login usando o mesmo banco (better-sqlite3).
// Assim o usuário continua logado mesmo após reinícios/atualizações do
// servidor (a sessão fica salva no disco, junto com o resto dos dados).

const session = require('express-session');
const db = require('../db');

const SETE_DIAS = 1000 * 60 * 60 * 24 * 7;

db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
)`);

class BetterSqliteStore extends session.Store {
  constructor() {
    super();
    this._get = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
    this._set = db.prepare(`INSERT INTO sessions (sid, sess, expire) VALUES (@sid, @sess, @expire)
                            ON CONFLICT(sid) DO UPDATE SET sess = @sess, expire = @expire`);
    this._del = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._touch = db.prepare('UPDATE sessions SET expire = @expire WHERE sid = @sid');

    // Limpa sessões expiradas de hora em hora.
    setInterval(() => {
      try { db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now()); } catch (_) {}
    }, 1000 * 60 * 60).unref();
  }

  _expireOf(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    return exp ? new Date(exp).getTime() : Date.now() + SETE_DIAS;
  }

  get(sid, cb) {
    try {
      const row = this._get.get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) { this._del.run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      this._set.run({ sid, sess: JSON.stringify(sess), expire: this._expireOf(sess) });
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  destroy(sid, cb) {
    try { this._del.run(sid); cb && cb(null); } catch (e) { cb && cb(e); }
  }

  touch(sid, sess, cb) {
    try { this._touch.run({ sid, expire: this._expireOf(sess) }); cb && cb(null); } catch (e) { cb && cb(e); }
  }
}

module.exports = BetterSqliteStore;
