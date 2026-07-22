// Agendador dos avisos automáticos de atualização.
//
// De tempos em tempos, verifica os rastreios de contas com "avisos automáticos"
// ligados. Se um pedido entrou numa etapa nova da jornada desde o último aviso,
// envia a atualização pro cliente (pelos canais ativos) e cobra do saldo.

const db = require('../db');
const stages = require('./stages');
const notify = require('./notify');

function siteUrl() {
  const u = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
  return u.replace(/\/$/, '');
}

async function tick() {
  const base = siteUrl();
  const trackings = db.prepare(`
    SELECT t.* FROM trackings t
    JOIN users u ON u.id = t.user_id
    WHERE u.auto_updates = 1
      AND t.created_at >= datetime('now', '-15 days')
  `).all();

  for (const t of trackings) {
    try {
      const idx = stages.etapaAtualIndex(t);
      if (idx <= (t.last_notified_stage || 0)) continue; // nenhuma etapa nova
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(t.user_id);
      if (!user) continue;

      const et = stages.etapa(t, idx);
      const resultados = await notify.notificarAtualizacao(user, t, base, et);
      // Só marca a etapa como avisada se pelo menos um canal enviou de verdade
      // (senão tenta de novo no próximo ciclo — ex.: saldo entrou depois).
      if (resultados.some((r) => r.status === 'enviado')) {
        db.prepare('UPDATE trackings SET last_notified_stage = ? WHERE id = ?').run(idx, t.id);
      }
    } catch (e) {
      console.error('scheduler:', e.message);
    }
  }
}

function iniciar() {
  const intervalo = Number(process.env.SCHEDULER_INTERVAL_MS) || 30 * 60 * 1000; // 30 min
  setTimeout(() => tick().catch(() => {}), 60 * 1000);     // 1 min após subir
  setInterval(() => tick().catch(() => {}), intervalo);
  console.log(`⏰ Avisos automáticos: verificando a cada ${Math.round(intervalo / 60000)} min`);
}

module.exports = { iniciar, tick };
