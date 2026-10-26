/**
 * ผลการแข่งที่จบแล้ว + ราคาปิดของทุกเจ้ามือ (ใช้คำนวณสถิติชนะ/แพ้ราคา และเลือกดูย้อนหลังรายวัน)
 * ราคาปิด = ราคาสุดท้ายที่เก็บได้ก่อนเริ่มแข่ง (ระบบเก็บเฉพาะราคาก่อนแข่ง)
 */
import { CONSENSUS } from './series.js';

const etFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
});
/** วันแข่งตามเวลาอีสต์ของสหรัฐฯ (ตามตารางแข่ง NBA) เช่น 2026-10-25 */
export const etDay = (iso) => etFmt.format(new Date(iso));

function median(xs) {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return Math.round((n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) * 100) / 100;
}

/** รายการแมตช์ที่จบแล้วพร้อมราคาปิด: { first, games: [{id,t,h,a,hs,as,c:{book:[spread,total]}}] } */
export function buildResults(db) {
  const games = db.prepare(`
    SELECT id, commence_time, home_team, away_team, home_score, away_score FROM games
    WHERE completed = 1 AND home_score IS NOT NULL ORDER BY commence_time`).all();
  const close = new Map();
  const rows = db.prepare(`
    SELECT s.game_id, s.bookmaker, s.market, s.line FROM snapshots s
    JOIN (SELECT MAX(id) AS mid FROM snapshots GROUP BY game_id, bookmaker, market) m ON s.id = m.mid
    JOIN games g ON g.id = s.game_id WHERE g.completed = 1`).all();
  for (const r of rows) {
    if (!close.has(r.game_id)) close.set(r.game_id, new Map());
    const byBook = close.get(r.game_id);
    if (!byBook.has(r.bookmaker)) byBook.set(r.bookmaker, [null, null]);
    byBook.get(r.bookmaker)[r.market === 'spreads' ? 0 : 1] = r.line;
  }
  const out = games.map((g) => {
    const byBook = close.get(g.id) ?? new Map();
    const c = {};
    for (const [b, v] of byBook) c[b] = v;
    const all = [...byBook.values()];
    if (all.length) c[CONSENSUS] = [median(all.map((v) => v[0])), median(all.map((v) => v[1]))];
    return { id: g.id, t: g.commence_time, h: g.home_team, a: g.away_team, hs: g.home_score, as: g.away_score, c };
  });
  const first = db.prepare('SELECT MIN(commence_time) AS t FROM games').get()?.t ?? null;
  return { first, games: out };
}

/** วันแข่ง (เวลาอีสต์) ที่มีแมตช์เริ่มไปแล้ว: [{d, n, done}] เรียงจากใหม่ไปเก่า */
export function listDays(db, now = new Date()) {
  const rows = db.prepare(`SELECT commence_time AS t, completed FROM games WHERE commence_time <= ?`).all(now.toISOString());
  const m = new Map();
  for (const r of rows) {
    const d = etDay(r.t);
    const x = m.get(d) ?? { d, n: 0, done: 0 };
    x.n++;
    x.done += r.completed ? 1 : 0;
    m.set(d, x);
  }
  return [...m.values()].sort((a, b) => (a.d < b.d ? 1 : -1));
}
