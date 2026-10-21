import { upsertGame, upsertBookmaker, insertSnapshotIfChanged, recordPoll } from './db.js';

/** ข้อมูลตัวอย่าง (สุ่ม) สำหรับลองหน้าเว็บโดยไม่ต้องใช้คีย์ API — ไม่ใช่ราคาจริง */
const TEAMS = [
  'Boston Celtics', 'New York Knicks', 'Milwaukee Bucks', 'Cleveland Cavaliers',
  'Denver Nuggets', 'Los Angeles Lakers', 'Golden State Warriors', 'Phoenix Suns',
  'Oklahoma City Thunder', 'Dallas Mavericks', 'Minnesota Timberwolves', 'Miami Heat',
  'Philadelphia 76ers', 'Sacramento Kings', 'Houston Rockets', 'Orlando Magic',
  'Indiana Pacers', 'Memphis Grizzlies', 'Atlanta Hawks', 'San Antonio Spurs',
];
const BOOKS = [['demo_a', 'Demo Book A'], ['demo_b', 'Demo Book B'], ['demo_c', 'Demo Book C']];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const half = (v) => Math.round(v * 2) / 2;
const price = (v) => Math.round(v * 100) / 100;

/** คู่ค่าน้ำที่มีส่วนต่างเจ้ามือ ~4.5%, skew > 0 = ฝั่ง a แพงขึ้น (ค่าน้ำต่ำลง) */
function pricePair(skew) {
  const pa = Math.min(0.62, Math.max(0.38, 0.5 + skew));
  const over = 1.045;
  return [price(1 / (pa * over)), price(1 / ((1 - pa) * over))];
}

export function seedDemo(db, now = new Date()) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
  if (count) return false;
  const rand = rng(20261021);
  const H = 3600_000;
  db.exec('BEGIN');
  for (const [k, t] of BOOKS) upsertBookmaker(db, k, t);

  const slots = [-60, -36, -12, -5, 3, 9, 20, 27, 33, 46, 52];
  const teams = [...TEAMS].sort(() => rand() - 0.5);
  slots.forEach((hoursFromNow, i) => {
    const home = teams[(i * 7) % teams.length];
    const away = teams[(i * 7 + 3) % teams.length];
    const tip = new Date(Math.round((now.getTime() + hoursFromNow * H) / (30 * 60_000)) * 30 * 60_000);
    let opened = new Date(tip - (40 + rand() * 30) * H);
    if (opened >= now) opened = new Date(now - (2 + rand() * 4) * H);
    const id = `demo_${i}_${tip.getTime().toString(36)}`;
    const until = new Date(Math.min(now.getTime(), tip.getTime()));
    upsertGame(db, { id, commence_time: tip.toISOString(), home_team: home, away_team: away }, opened.toISOString());

    let spread = half((rand() - 0.55) * 22);
    let total = half(218 + rand() * 18);
    let sSkew = 0;
    let tSkew = 0;
    const drift = (rand() - 0.5) * 0.18;
    const tDrift = (rand() - 0.5) * 0.18;
    const bookOffset = BOOKS.map(() => [half((rand() - 0.5) * 1.2), half((rand() - 0.5) * 1.5)]);

    for (let t = opened.getTime(); t < until.getTime(); ) {
      const left = (tip - t) / H;
      const step = left > 24 ? 3 : left > 6 ? 1 : left > 1 ? 1 / 3 : 1 / 6;
      // เดินสุ่ม: เส้นขยับทีละครึ่งแต้มเป็นบางครั้ง ค่าน้ำแกว่งระหว่างนั้น
      sSkew += (rand() - 0.5) * 0.07 + drift * 0.08;
      tSkew += (rand() - 0.5) * 0.07 + tDrift * 0.08;
      if (Math.abs(sSkew) > 0.06) { spread += sSkew > 0 ? -0.5 : 0.5; sSkew *= -0.4; }
      if (Math.abs(tSkew) > 0.06) { total += tSkew > 0 ? 0.5 : -0.5; tSkew *= -0.4; }
      const at = new Date(t).toISOString();
      BOOKS.forEach(([key], bi) => {
        const jitter = (rand() - 0.5) * 0.02;
        const [ha, hb] = pricePair(sSkew + jitter);
        const [oa, ob] = pricePair(tSkew - jitter);
        insertSnapshotIfChanged(db, { game_id: id, bookmaker: key, market: 'spreads', at, fetched_at: at,
          line: spread + bookOffset[bi][0], price_a: ha, price_b: hb });
        insertSnapshotIfChanged(db, { game_id: id, bookmaker: key, market: 'totals', at, fetched_at: at,
          line: total + bookOffset[bi][1], price_a: oa, price_b: ob });
      });
      db.prepare('UPDATE games SET last_seen_at = ? WHERE id = ?').run(at, id);
      t += step * H;
    }

    if (hoursFromNow < -3) {
      const exp = total + (rand() - 0.5) * 30;
      const margin = -spread + (rand() - 0.5) * 26;
      const hs = Math.round((exp + margin) / 2);
      const as = Math.round((exp - margin) / 2);
      db.prepare('UPDATE games SET home_score = ?, away_score = ?, completed = 1 WHERE id = ?').run(hs, as, id);
    }
  });
  recordPoll(db, { at: new Date(now - 7 * 60_000).toISOString(), kind: 'odds', ok: true,
    games: 7, changes: 12, credits_used: 132, credits_remaining: 368, credits_last: 2 });
  db.exec('COMMIT');
  return true;
}
