export const CONSENSUS = 'consensus';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

function toPoint(r) {
  return { t: r.at, line: r.line, a: r.price_a, b: r.price_b };
}

/** ค่ากลางตลาด: ทุกครั้งที่เจ้ามือใดขยับ คำนวณค่ามัธยฐานของทุกเจ้า ณ ขณะนั้น */
function consensusSeries(rows) {
  const current = new Map();
  const out = [];
  const byTime = new Map();
  for (const r of rows) {
    if (!byTime.has(r.at)) byTime.set(r.at, []);
    byTime.get(r.at).push(r);
  }
  for (const t of [...byTime.keys()].sort()) {
    for (const r of byTime.get(t)) current.set(r.bookmaker, r);
    const vals = [...current.values()];
    const p = {
      t,
      line: r2(median(vals.map((v) => v.line))),
      a: r3(median(vals.map((v) => v.price_a))),
      b: r3(median(vals.map((v) => v.price_b))),
      books: vals.length,
    };
    const prev = out[out.length - 1];
    if (prev && prev.line === p.line && prev.a === p.a && prev.b === p.b) continue;
    out.push(p);
  }
  return out;
}

function seriesFromRows(rows, book) {
  const res = { spreads: [], totals: [] };
  for (const m of ['spreads', 'totals']) {
    const mr = rows.filter((r) => r.market === m);
    res[m] = book === CONSENSUS ? consensusSeries(mr) : mr.map(toPoint);
  }
  return res;
}

function loadRows(db, gameIds, book) {
  if (!gameIds.length) return [];
  const ph = gameIds.map(() => '?').join(',');
  const bookClause = book === CONSENSUS ? '' : 'AND bookmaker = ?';
  const args = book === CONSENSUS ? gameIds : [...gameIds, book];
  return db.prepare(`
    SELECT game_id, bookmaker, market, at, line, price_a, price_b
    FROM snapshots WHERE game_id IN (${ph}) ${bookClause}
    ORDER BY at, id
  `).all(...args);
}

function gameRow(g) {
  const endAt = g.last_seen_at < g.commence_time ? g.last_seen_at : g.commence_time;
  return {
    id: g.id,
    commence: g.commence_time,
    home: g.home_team,
    away: g.away_team,
    firstSeen: g.first_seen_at,
    lastSeen: g.last_seen_at,
    endAt,
    score: g.home_score == null ? null : { home: g.home_score, away: g.away_score, completed: !!g.completed },
  };
}

function summarize(points) {
  if (!points.length) return null;
  const open = points[0];
  const now = points[points.length - 1];
  return {
    open, now, moves: points.length - 1, delta: r2(now.line - open.line),
    // เส้นย่อสำหรับกราฟจิ๋วในรายการ: [เวลา(ms), เส้น]
    spark: points.map((p) => [Date.parse(p.t), p.line]),
  };
}

export function listGames(db, { scope = 'upcoming', book = CONSENSUS, now = new Date() } = {}) {
  const iso = now.toISOString();
  let games;
  if (scope === 'recent') {
    games = db.prepare(`SELECT * FROM games WHERE commence_time <= ? AND commence_time > ?
                        ORDER BY commence_time DESC LIMIT 60`)
      .all(iso, new Date(now - 10 * 86400_000).toISOString());
  } else {
    games = db.prepare(`SELECT * FROM games WHERE commence_time > ? ORDER BY commence_time LIMIT 100`).all(iso);
  }
  const rows = loadRows(db, games.map((g) => g.id), book);
  const byGame = new Map();
  for (const r of rows) {
    if (!byGame.has(r.game_id)) byGame.set(r.game_id, []);
    byGame.get(r.game_id).push(r);
  }
  return games.map((g) => {
    const s = seriesFromRows(byGame.get(g.id) ?? [], book);
    return { ...gameRow(g), spreads: summarize(s.spreads), totals: summarize(s.totals) };
  });
}

export function gameDetail(db, id, book = CONSENSUS) {
  const g = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id);
  if (!g) return null;
  const rows = loadRows(db, [id], book);
  const series = seriesFromRows(rows, book);
  const books = db.prepare(`
    SELECT s.bookmaker AS key, COALESCE(b.title, s.bookmaker) AS title, COUNT(*) AS points
    FROM snapshots s LEFT JOIN bookmakers b ON b.key = s.bookmaker
    WHERE s.game_id = ? GROUP BY s.bookmaker ORDER BY b.title
  `).all(id);

  // ราคาล่าสุดของทุกเจ้ามือ (ตารางเทียบเจ้ามือ)
  const latest = db.prepare(`
    SELECT s.bookmaker, s.market, s.at, s.line, s.price_a, s.price_b FROM snapshots s
    WHERE s.game_id = ? AND s.id = (
      SELECT s2.id FROM snapshots s2
      WHERE s2.game_id = s.game_id AND s2.bookmaker = s.bookmaker AND s2.market = s.market
      ORDER BY s2.at DESC, s2.id DESC LIMIT 1)
  `).all(id);
  // ราคาแรกที่เห็นของแต่ละเจ้า (ไว้เทียบว่าเจ้านั้นขยับแค่ไหน)
  const first = db.prepare(`
    SELECT s.bookmaker, s.market, s.at, s.line, s.price_a, s.price_b FROM snapshots s
    WHERE s.game_id = ? AND s.id = (
      SELECT s2.id FROM snapshots s2
      WHERE s2.game_id = s.game_id AND s2.bookmaker = s.bookmaker AND s2.market = s.market
      ORDER BY s2.at ASC, s2.id ASC LIMIT 1)
  `).all(id);
  const byBook = books.map((b) => {
    const pick = (m) => {
      const r = latest.find((x) => x.bookmaker === b.key && x.market === m);
      const o = first.find((x) => x.bookmaker === b.key && x.market === m);
      return r ? {
        t: r.at, line: r.line, a: r.price_a, b: r.price_b,
        open: { t: o.at, line: o.line, a: o.price_a, b: o.price_b },
      } : null;
    };
    return { key: b.key, title: b.title, spreads: pick('spreads'), totals: pick('totals') };
  });
  return { ...gameRow(g), book, books, byBook, series };
}

export function listBookmakers(db) {
  return db.prepare(`
    SELECT b.key, b.title, COUNT(s.id) AS points FROM bookmakers b
    LEFT JOIN snapshots s ON s.bookmaker = b.key
    GROUP BY b.key ORDER BY points DESC, b.title
  `).all();
}
