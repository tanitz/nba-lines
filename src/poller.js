import { pathToFileURL } from 'node:url';
import { config as defaultConfig } from './config.js';
import {
  openDb, upsertGame, upsertBookmaker, insertSnapshotIfChanged,
  recordPoll, lastPoll, lastCredits,
} from './db.js';
import { fetchOdds, fetchScores, parseOddsEvents, parseScores } from './oddsApi.js';

const MIN = 60_000;

/**
 * ตัวดึงราคาอัตโนมัติ
 * - คำขอ /odds หนึ่งครั้งได้ทุกแมตช์ จึงตัดสินใจ "ถึงเวลาดึงหรือยัง" จากแมตช์ที่ใกล้เริ่มที่สุด
 * - ยิ่งใกล้เวลาแข่ง ยิ่งดึงถี่ เพื่อประหยัดเครดิต
 */
export function createPoller(db, cfg = defaultConfig, deps = {}) {
  const getOdds = deps.fetchOdds ?? fetchOdds;
  const getScores = deps.fetchScores ?? fetchScores;
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((...a) => console.log(new Date().toISOString(), ...a));
  let running = false;
  let timer = null;

  function nearestGameMinutes(now) {
    const row = db.prepare(`SELECT MIN(commence_time) AS t FROM games WHERE commence_time > ?`)
      .get(now.toISOString());
    return row?.t ? (Date.parse(row.t) - now.getTime()) / MIN : null;
  }

  function intervalMinutes(now) {
    const p = cfg.poll;
    const m = nearestGameMinutes(now);
    let iv;
    if (m == null) iv = p.idleMin;
    else if (m > 24 * 60) iv = p.farMin;
    else if (m > 6 * 60) iv = p.dayMin;
    else if (m > 60) iv = p.nearMin;
    else iv = p.closeMin;

    const last = lastPoll(db, 'odds');
    if (last && !last.ok) iv = Math.max(iv, 15);                 // ผิดพลาด: รออย่างน้อย 15 นาที
    if (last && !last.ok && /^(401|403)/.test(last.error ?? '')) iv = Math.max(iv, p.idleMin); // คีย์ผิด
    const cr = lastCredits(db);
    if (cr && cr.credits_remaining < cfg.minCreditsLeft) iv = Math.max(iv, p.idleMin); // เครดิตใกล้หมด
    return iv;
  }

  function nextOddsAt(now = clock()) {
    const last = lastPoll(db, 'odds');
    if (!last) return now;
    return new Date(Date.parse(last.at) + intervalMinutes(now) * MIN);
  }

  async function pollOdds() {
    const now = clock();
    const at = now.toISOString();
    try {
      const res = await getOdds(cfg, now);
      const { games, bookmakers, snapshots } = parseOddsEvents(res.data, at);
      let changes = 0;
      db.exec('BEGIN');
      try {
        for (const g of games) upsertGame(db, g, at);
        for (const [k, t] of bookmakers) upsertBookmaker(db, k, t);
        for (const s of snapshots) if (insertSnapshotIfChanged(db, s)) changes++;
        recordPoll(db, { at, kind: 'odds', ok: true, games: games.length, changes, ...pick(res) });
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      log(`odds: ${games.length} แมตช์, ราคาเปลี่ยน ${changes} รายการ, เครดิตเหลือ ${res.credits_remaining ?? '?'}`);
      return { ok: true, games: games.length, changes };
    } catch (e) {
      recordPoll(db, { at, kind: 'odds', ok: false, error: e.message, ...pick(e) });
      log(`odds ผิดพลาด: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  function scoresDue(now) {
    if (!cfg.scoresEveryHours) return false;
    const pending = db.prepare(`
      SELECT COUNT(*) AS n FROM games
      WHERE completed = 0 AND commence_time < ? AND commence_time > ?
    `).get(new Date(now - 2.5 * 3600_000).toISOString(), new Date(now - 3 * 86400_000).toISOString());
    if (!pending?.n) return false;
    const last = lastPoll(db, 'scores');
    return !last || now - Date.parse(last.at) >= cfg.scoresEveryHours * 3600_000;
  }

  async function pollScores() {
    const at = clock().toISOString();
    try {
      const res = await getScores(cfg, 3);
      const rows = parseScores(res.data);
      const st = db.prepare(`UPDATE games SET home_score = ?, away_score = ?, completed = ? WHERE id = ?`);
      let n = 0;
      for (const r of rows) n += Number(st.run(r.home_score, r.away_score, r.completed, r.id).changes);
      recordPoll(db, { at, kind: 'scores', ok: true, games: n, ...pick(res) });
      log(`scores: อัปเดต ${n} แมตช์`);
      return { ok: true, updated: n };
    } catch (e) {
      recordPoll(db, { at, kind: 'scores', ok: false, error: e.message, ...pick(e) });
      log(`scores ผิดพลาด: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  /** slackMin: ยอมให้ดึงก่อนกำหนดได้กี่นาที (ใช้กับตัวตั้งเวลาภายนอกที่รันทุก ๆ 10 นาที) */
  async function tick({ slackMin = cfg.poll.slackMin ?? 0 } = {}) {
    if (running) return;
    running = true;
    try {
      const now = clock();
      const slack = new Date(now.getTime() + slackMin * MIN);
      if (slack >= nextOddsAt(now)) await pollOdds();
      if (scoresDue(slack)) await pollScores();
    } finally {
      running = false;
    }
  }

  return {
    tick,
    pollOdds,
    pollScores,
    nextOddsAt,
    intervalMinutes: () => intervalMinutes(clock()),
    start() {
      if (!cfg.apiKey) {
        log('ยังไม่ได้ตั้ง ODDS_API_KEY ในไฟล์ .env — ปิดการดึงราคาอัตโนมัติ');
        return;
      }
      tick();
      timer = setInterval(() => tick(), cfg.poll.tickSec * 1000);
    },
    stop() { clearInterval(timer); },
  };
}

function pick(o) {
  return {
    credits_used: o?.credits_used ?? null,
    credits_remaining: o?.credits_remaining ?? null,
    credits_last: o?.credits_last ?? null,
  };
}

// รันเดี่ยว: node src/poller.js --once  (เหมาะกับ cron ของระบบ)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (!defaultConfig.apiKey) {
    console.error('กรุณาตั้ง ODDS_API_KEY ในไฟล์ .env');
    process.exit(1);
  }
  const db = openDb(defaultConfig.dbPath);
  const poller = createPoller(db);
  if (process.argv.includes('--once')) {
    const r = await poller.pollOdds();
    await poller.pollScores();
    process.exit(r.ok ? 0 : 1);
  } else {
    poller.start();
  }
}
