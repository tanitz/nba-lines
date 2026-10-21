import { lastPoll, lastCredits } from './db.js';
import { listGames, gameDetail, listBookmakers, CONSENSUS } from './series.js';

/**
 * รวบรวมข้อมูลทั้งหมดที่หน้าเว็บต้องใช้ (สำหรับเว็บแบบไฟล์นิ่ง ไม่มีเซิร์ฟเวอร์)
 * คืนค่า { status, games: {upcoming|recent: {book: [...]}}, details: {gameId: {book: detail}} }
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

  const games = { upcoming: {}, recent: {} };
  const details = {};
  for (const scope of Object.keys(games)) {
    for (const k of keys) {
      games[scope][k] = listGames(db, { scope, book: k, now });
      for (const g of games[scope][k]) {
        details[g.id] ??= {};
        details[g.id][k] ??= gameDetail(db, g.id, k);
      }
    }
  }
  return { status, games, details };
}
