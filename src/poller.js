import { pathToFileURL } from 'node:url';
import { config as defaultConfig } from './config.js';
import {
  openDb, upsertGame, upsertScheduledGame, upsertBookmaker, insertSnapshotIfChanged,
  recordPoll, lastPoll, lastCredits,
} from './db.js';
import { fetchOdds, fetchScores, fetchEvents, parseOddsEvents, parseScores, parseEvents } from './oddsApi.js';

const MIN = 60_000;

/**
 * ตัวดึงราคาอัตโนมัติ
 * - คำขอ /odds หนึ่งครั้งได้ทุกแมตช์ จึงตัดสินใจ "ถึงเวลาดึงหรือยัง" จากแมตช์ที่ใกล้เริ่มที่สุด
 * - ยิ่งใกล้เวลาแข่ง ยิ่งดึงถี่ เพื่อประหยัดเครดิต
 */
export function createPoller(db, cfg = defaultConfig, deps = {}) {
  const getOdds = deps.fetchOdds ?? fetchOdds;
  const getScores = deps.fetchScores ?? fetchScores;
  const getEvents = deps.fetchEvents ?? fetchEvents;
  const clock = deps.now ?? (() => new Date());
  const log = deps.log ?? ((...a) => console.log(new Date().toISOString(), ...a));
  let running = false;
  let timer = null;

  function nearestGameMinutes(now) {
    const row = db.prepare(`SELECT MIN(commence_time) AS t FROM games WHERE commence_time > ?`)
      .get(now.toISOString());
    return row?.t ? (Date.parse(row.t) - now.getTime()) / MIN : null;
  }

  // m = นาทีก่อนแมตช์ที่ใกล้ที่สุดเริ่ม (null = ไม่มีแมตช์) ไม่ส่งมาก็คำนวณจากเวลา now
  function intervalMinutes(now, m = nearestGameMinutes(now)) {
    const p = cfg.poll;
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

  /**
   * เวลาที่ตารางกำหนดให้ดึงครั้งถัดไป นับจากครั้งล่าสุด (เป็นเวลาในอดีตได้ ถ้าเลยกำหนดแล้ว)
   * ช่วงห่างสั้นลงเมื่อใกล้เวลาแข่ง จึงไล่ดูทีละช่วงตามเวลาเริ่มแข่งที่รู้อยู่แล้ว
   * และนับเวลาเริ่มแข่งตั้งแต่ "ครั้งล่าสุด" ไม่ใช่ "ตอนนี้" เพื่อให้รอบที่ตัวตั้งเวลาภายนอก (cron ของ
   * GitHub) มาช้าหรือถูกข้ามไป ถูกดึงชดเชยทันทีที่มีโอกาส แทนที่จะหายไปเพราะแมตช์เริ่มไปแล้วและช่วงห่างยาวขึ้น
   */
  function nextOddsAt(now = clock()) {
    const last = lastPoll(db, 'odds');
    if (!last) return now;
    const lastMs = Date.parse(last.at);
    const starts = db.prepare(
      `SELECT DISTINCT commence_time AS t FROM games WHERE commence_time > ? ORDER BY commence_time`,
    ).all(last.at).map((r) => Date.parse(r.t)).sort((a, b) => a - b);

    // จุดที่ช่วงห่างเปลี่ยน: ครั้งล่าสุด เวลาเริ่มแข่ง และ 24 ชม. / 6 ชม. / 1 ชม. ก่อนเริ่มแข่งของแต่ละแมตช์
    const cuts = new Set([lastMs]);
    for (const g of starts) {
      cuts.add(g);
      for (const m of [60, 6 * 60, 24 * 60]) if (g - m * MIN > lastMs) cuts.add(g - m * MIN);
    }
    const ts = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < ts.length; i++) {
      const a = ts[i];
      const b = i + 1 < ts.length ? ts[i + 1] : Infinity;
      const g = starts.find((x) => x > a);                         // แมตช์ที่ใกล้ที่สุด ณ เวลา a
      const iv = intervalMinutes(new Date(a), g == null ? null : (g - a) / MIN);
      const due = Math.max(a, lastMs + iv * MIN);
      if (due < b) return new Date(due);
    }
    return new Date(lastMs);                                       // ไม่ควรมาถึงตรงนี้ (ช่วงสุดท้ายไม่มีขอบบน)
  }

  /** เหมือน nextOddsAt แต่ไม่คืนเวลาในอดีต (ใช้แสดงบนหน้าเว็บ) */
  function forecastNextOddsAt(now = clock()) {
    return new Date(Math.max(now.getTime(), nextOddsAt(now).getTime()));
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

  function eventsDue(now) {
    if (!cfg.eventsEveryMin) return false;
    const last = lastPoll(db, 'events');
    return !last || now - Date.parse(last.at) >= cfg.eventsEveryMin * MIN;
  }

  /** ตารางแข่ง 3 วันข้างหน้า (ไม่เสียเครดิต) ให้เห็นแมตช์ก่อนเจ้ามือเปิดราคา */
  async function pollEvents() {
    const now = clock();
    const at = now.toISOString();
    try {
      const res = await getEvents(cfg, now);
      const games = parseEvents(res.data, at);
      const before = db.prepare('SELECT COUNT(*) AS n FROM games').get().n;
      for (const g of games) upsertScheduledGame(db, g, at);
      const added = db.prepare('SELECT COUNT(*) AS n FROM games').get().n - before;
      recordPoll(db, { at, kind: 'events', ok: true, games: games.length, changes: added });
      log(`events: ${games.length} แมตช์ใน 3 วัน (ใหม่ ${added})`);
      return { ok: true, games: games.length, added };
    } catch (e) {
      recordPoll(db, { at, kind: 'events', ok: false, error: e.message });
      log(`events ผิดพลาด: ${e.message}`);
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

  /** slackMin: ยอมให้ดึงก่อนกำหนดได้กี่นาที (ใช้กับตัวตั้งเวลาภายนอกที่รันเป็นรอบ ๆ เช่น cron ทุก 5 นาที) */
  async function tick({ slackMin = cfg.poll.slackMin ?? 0 } = {}) {
    if (running) return;
    running = true;
    try {
      const now = clock();
      const slack = new Date(now.getTime() + slackMin * MIN);
      if (eventsDue(slack)) await pollEvents();
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
    pollEvents,
    nextOddsAt,
    forecastNextOddsAt,
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
