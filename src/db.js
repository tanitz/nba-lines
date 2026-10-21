import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * ตาราง
 *  games      แมตช์ (id จาก The Odds API)
 *  snapshots  ราคาที่ "เปลี่ยน" เท่านั้น ต่อแมตช์ / เจ้ามือ / ตลาด
 *             spreads: line = แต้มต่อของทีมเหย้า, price_a = ค่าน้ำทีมเหย้า, price_b = ค่าน้ำทีมเยือน
 *             totals : line = เส้นสูง/ต่ำ,      price_a = ค่าน้ำสูง (Over), price_b = ค่าน้ำต่ำ (Under)
 *             ราคาเก็บเป็นทศนิยมแบบยุโรป (decimal) เสมอ หน้าเว็บค่อยแปลงเป็นฮ่องกง/มาเลย์
 *  polls      บันทึกการเรียก API ทุกครั้ง (เวลา เครดิต ข้อผิดพลาด)
 */
export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS games (
      id            TEXT PRIMARY KEY,
      commence_time TEXT NOT NULL,
      home_team     TEXT NOT NULL,
      away_team     TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at  TEXT NOT NULL,
      home_score    INTEGER,
      away_score    INTEGER,
      completed     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS games_commence ON games(commence_time);

    CREATE TABLE IF NOT EXISTS snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id    TEXT NOT NULL REFERENCES games(id),
      bookmaker  TEXT NOT NULL,
      market     TEXT NOT NULL CHECK (market IN ('spreads','totals')),
      at         TEXT NOT NULL,
      line       REAL NOT NULL,
      price_a    REAL NOT NULL,
      price_b    REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS snap_lookup ON snapshots(game_id, bookmaker, market, at);

    CREATE TABLE IF NOT EXISTS bookmakers (
      key   TEXT PRIMARY KEY,
      title TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS polls (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      at                TEXT NOT NULL,
      kind              TEXT NOT NULL,          -- odds | scores
      ok                INTEGER NOT NULL,
      games             INTEGER,
      changes           INTEGER,
      credits_used      INTEGER,
      credits_remaining INTEGER,
      credits_last      INTEGER,
      error             TEXT
    );
  `);
  return db;
}

export function upsertGame(db, g, seenAt) {
  db.prepare(`
    INSERT INTO games (id, commence_time, home_team, away_team, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      commence_time = excluded.commence_time,
      home_team     = excluded.home_team,
      away_team     = excluded.away_team,
      last_seen_at  = excluded.last_seen_at
  `).run(g.id, g.commence_time, g.home_team, g.away_team, seenAt, seenAt);
}

export function upsertBookmaker(db, key, title) {
  db.prepare(`INSERT INTO bookmakers (key, title) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET title = excluded.title`).run(key, title);
}

/** บันทึกเฉพาะเมื่อราคาเปลี่ยนจากครั้งล่าสุด คืนค่า true ถ้ามีการบันทึก */
export function insertSnapshotIfChanged(db, s) {
  const last = db.prepare(`
    SELECT at, line, price_a, price_b FROM snapshots
    WHERE game_id = ? AND bookmaker = ? AND market = ?
    ORDER BY at DESC, id DESC LIMIT 1
  `).get(s.game_id, s.bookmaker, s.market);

  if (last && last.line === s.line && last.price_a === s.price_a && last.price_b === s.price_b) {
    return false;
  }
  // เวลาไม่ย้อนหลังกว่าจุดก่อนหน้า (last_update ของเจ้ามืออาจเก่ากว่าที่เราเห็น)
  let at = s.at;
  if (last && at <= last.at) at = s.fetched_at > last.at ? s.fetched_at : last.at;

  db.prepare(`
    INSERT INTO snapshots (game_id, bookmaker, market, at, line, price_a, price_b)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(s.game_id, s.bookmaker, s.market, at, s.line, s.price_a, s.price_b);
  return true;
}

export function recordPoll(db, p) {
  db.prepare(`
    INSERT INTO polls (at, kind, ok, games, changes, credits_used, credits_remaining, credits_last, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.at, p.kind, p.ok ? 1 : 0, p.games ?? null, p.changes ?? null,
    p.credits_used ?? null, p.credits_remaining ?? null, p.credits_last ?? null, p.error ?? null);
}

export function lastPoll(db, kind, okOnly = false) {
  return db.prepare(`SELECT * FROM polls WHERE kind = ? ${okOnly ? 'AND ok = 1' : ''}
                     ORDER BY at DESC, id DESC LIMIT 1`).get(kind) ?? null;
}

export function lastCredits(db) {
  return db.prepare(`SELECT credits_remaining, credits_used, at FROM polls
                     WHERE credits_remaining IS NOT NULL ORDER BY at DESC, id DESC LIMIT 1`).get() ?? null;
}
