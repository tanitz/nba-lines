import { lastPoll, lastCredits } from './db.js';
import { listGames, gameDetail, listBookmakers, CONSENSUS } from './series.js';
import { buildResults, listDays } from './results.js';

/**
 * รวบรวมข้อมูลทั้งหมดที่หน้าเว็บต้องใช้ (สำหรับเว็บแบบไฟล์นิ่ง ไม่มีเซิร์ฟเวอร์)
 * คืนค่า { status, games: {upcoming: {book: [...]}}, days: [{d,n,done}], byDay: {day: {book: [...]}},
 *        results, details: {gameId: {book: detail}} }
 */
export function buildPayload(db, cfg, { demo = false, nextPollAt = null, intervalMin = null, now = new Date() } = {}) {
  const books = listBookmakers(db);
  const keys = [CONSENSUS, ...books.map((b) => b.key)];
  const attempt = lastPoll(db, 'odds');
  const ok = lastPoll(db, 'odds', true);
  const credits = lastCredits(db);
  const status = {
    demo,
    hasKey: demo || !!cfg.apiKey,
    defaultBook: demo ? CONSENSUS : (cfg.defaultBook || CONSENSUS),
    canPoll: false,
    generatedAt: now.toISOString(),
    lastAttempt: attempt && { at: attempt.at, ok: !!attempt.ok, error: attempt.error },
    lastSuccess: ok && { at: ok.at, games: ok.games, changes: ok.changes },
    credits: credits && { remaining: credits.credits_remaining, used: credits.credits_used, at: credits.at },
    nextPollAt,
    intervalMin,
    bookmakers: books,
  };

  const games = { upcoming: {} };
  const details = {};
  // books / byBook (ตารางเทียบเจ้ามือ) เหมือนกันทุกเจ้า เก็บไว้ที่ _shared ครั้งเดียวเพื่อลดขนาดไฟล์
  const keep = (rows, k) => {
    for (const g of rows) {
      details[g.id] ??= {};
      if (details[g.id][k]) continue;
      const { books: bk, byBook, ...rest } = gameDetail(db, g.id, k);
      details[g.id]._shared ??= { books: bk, byBook };
      details[g.id][k] = rest;
    }
  };
  for (const k of keys) {
    games.upcoming[k] = listGames(db, { scope: 'upcoming', book: k, now });
    keep(games.upcoming[k], k);
  }
  const days = listDays(db, now);
  const byDay = {};
  for (const { d } of days) {
    byDay[d] = {};
    for (const k of keys) {
      byDay[d][k] = listGames(db, { scope: 'recent', day: d, book: k, now });
      keep(byDay[d][k], k);
    }
  }
  const results = buildResults(db);
  return { status, games, days, byDay, results, details };
}
