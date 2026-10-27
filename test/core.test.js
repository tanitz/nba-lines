import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { parseOddsEvents, parseScores } from '../src/oddsApi.js';
import { createPoller } from '../src/poller.js';
import { gameDetail, listGames } from '../src/series.js';

// รูปแบบเดียวกับผลลัพธ์จริงของ /v4/sports/basketball_nba/odds?oddsFormat=decimal
const event = (spread, total, upd) => ({
  id: 'g1', sport_key: 'basketball_nba', commence_time: '2026-10-23T00:00:00Z',
  home_team: 'Boston Celtics', away_team: 'New York Knicks',
  bookmakers: [{
    key: 'pinnacle', title: 'Pinnacle', last_update: upd,
    markets: [
      { key: 'spreads', last_update: upd, outcomes: [
        { name: 'New York Knicks', price: 1.95, point: -spread },
        { name: 'Boston Celtics', price: 1.91, point: spread },
      ] },
      { key: 'totals', last_update: upd, outcomes: [
        { name: 'Over', price: 1.93, point: total },
        { name: 'Under', price: 1.93, point: total },
      ] },
    ],
  }],
});

test('parse spreads from home perspective and totals', () => {
  const r = parseOddsEvents([event(-5.5, 221.5, '2026-10-21T10:00:00Z')], '2026-10-21T10:01:00Z');
  assert.equal(r.games.length, 1);
  const s = r.snapshots.find((x) => x.market === 'spreads');
  assert.deepEqual([s.line, s.price_a, s.price_b], [-5.5, 1.91, 1.95]);
  const t = r.snapshots.find((x) => x.market === 'totals');
  assert.deepEqual([t.line, t.price_a, t.price_b], [221.5, 1.93, 1.93]);
});

test('skips games that already started', () => {
  const r = parseOddsEvents([event(-5.5, 221.5, 'x')], '2026-10-23T00:05:00Z');
  assert.equal(r.games.length, 0);
});

test('poller stores only changes and respects interval', async () => {
  const db = openDb(':memory:');
  let now = new Date('2026-10-21T10:00:00Z');
  const feed = [event(-5.5, 221.5, '2026-10-21T09:59:00Z'), event(-5.5, 221.5, '2026-10-21T09:59:00Z'),
    event(-6, 222, '2026-10-21T13:00:00Z')];
  let calls = 0;
  const cfg = { poll: { farMin: 180, dayMin: 60, nearMin: 20, closeMin: 10, idleMin: 360, tickSec: 60 },
    minCreditsLeft: 25, scoresEveryHours: 0 };
  const p = createPoller(db, cfg, {
    now: () => now,
    log: () => {},
    fetchOdds: async () => ({ data: [feed[Math.min(calls++, feed.length - 1)]], credits_remaining: 400, credits_used: 2, credits_last: 2 }),
  });
  await p.tick();                         // ครั้งแรก
  now = new Date('2026-10-21T11:00:00Z');
  await p.tick();                         // ยังไม่ถึง 3 ชม. (แมตช์อีก > 24 ชม.)
  assert.equal(calls, 1);
  now = new Date('2026-10-21T13:00:00Z');
  await p.tick();                         // ราคาเดิม
  now = new Date('2026-10-21T16:00:00Z');
  await p.tick();                         // ราคาเปลี่ยน
  assert.equal(calls, 3);
  const d = gameDetail(db, 'g1', 'pinnacle');
  assert.deepEqual(d.series.spreads.map((x) => x.line), [-5.5, -6]);
  assert.deepEqual(d.series.totals.map((x) => x.line), [221.5, 222]);
  assert.equal(d.byBook[0].title, 'Pinnacle');
  assert.equal(d.byBook[0].spreads.line, -6);
  assert.equal(d.byBook[0].totals.line, 222);
  assert.equal(d.byBook[0].spreads.open.line, -5.5);
  assert.equal(d.byBook[0].totals.open.line, 221.5);
  const list = listGames(db, { now, book: 'consensus' });
  assert.equal(list[0].spreads.delta, -0.5);
  // ใกล้เวลาแข่ง (< 1 ชม.) ต้องดึงถี่ขึ้น
  now = new Date('2026-10-22T23:30:00Z');
  assert.equal(p.intervalMinutes(), 10);
});

test('parse scores', () => {
  const r = parseScores([{ id: 'g1', completed: true, home_team: 'A', away_team: 'B',
    scores: [{ name: 'A', score: '110' }, { name: 'B', score: '104' }] }]);
  assert.deepEqual(r[0], { id: 'g1', home_score: 110, away_score: 104, completed: 1 });
});

test('forecast of the next poll equals the time the poller really fires', async () => {
  const db = openDb(':memory:');
  const H = 3600_000;
  const tips = [];                                   // ทุกวัน 23:00, 23:30, 00:30 (UTC)
  for (let d = 0; d < 5; d++) for (const m of [0, 30, 90]) tips.push(Date.UTC(2026, 9, 21 + d, 23, m));
  let now = new Date(Date.UTC(2026, 9, 21, 15, 25));
  let calls = 0;
  // ค่าเริ่มต้นของแผนฟรีใน workflow
  const cfg = { poll: { farMin: 1440, dayMin: 720, nearMin: 240, closeMin: 60, idleMin: 1440, tickSec: 60 },
    minCreditsLeft: 10, scoresEveryHours: 0 };
  const p = createPoller(db, cfg, {
    now: () => now,
    log: () => {},
    fetchOdds: async () => {
      calls++;
      const data = tips.filter((t) => t > now.getTime() && t - now.getTime() < 40 * H).map((t) => ({
        ...event(-5.5, 221.5, now.toISOString()), id: `g${t}`, commence_time: new Date(t).toISOString(),
      }));
      return { data, credits_remaining: 400, credits_used: 2, credits_last: 2 };
    },
  });
  const at = (d) => d.toISOString().slice(5, 16).replace('T', ' ');

  await p.tick();                                    // ครั้งแรก 21 ต.ค. 15:25Z แมตช์แรก 23:00Z (ห่าง 7 ชม. 35 นาที)
  assert.equal(calls, 1);
  assert.equal(at(p.nextOddsAt()), '10-21 19:25');          // เหลือ < 6 ชม. ช่วงห่างลดเป็น 4 ชม. (บวก 12 ชม. ตรง ๆ จะช้าเกินจริง)
  assert.equal(at(p.forecastNextOddsAt()), '10-21 19:25');  // เหลือ < 6 ชม. ช่วงห่างลดเป็น 4 ชม.

  const fired = [];
  for (let i = 0; i < 8; i++) {
    const forecast = p.forecastNextOddsAt();
    const before = calls;
    for (let guard = 0; calls === before && guard < 3000; guard++) {
      now = new Date(now.getTime() + 60_000);
      await p.tick({ slackMin: 0 });
    }
    assert.equal(calls, before + 1);
    assert.equal(now.toISOString(), forecast.toISOString(), `poll #${i + 2}`);
    fired.push(at(now));
  }
  assert.deepEqual(fired.slice(0, 4), ['10-21 19:25', '10-21 22:00', '10-21 23:00', '10-22 00:00']);
});

test('a poll that fell due while the external scheduler was away is made up, not lost', async () => {
  const db = openDb(':memory:');
  const tips = ['2026-10-21T23:30:00Z', '2026-10-22T00:10:00Z', '2026-10-22T00:40:00Z',
    '2026-10-22T02:00:00Z', '2026-10-22T02:10:00Z'].map(Date.parse);
  let now = new Date('2026-10-21T23:17:48Z');
  let calls = 0;
  const cfg = { poll: { farMin: 1440, dayMin: 720, nearMin: 240, closeMin: 60, idleMin: 1440, tickSec: 60, slackMin: 3 },
    minCreditsLeft: 10, scoresEveryHours: 0 };
  const p = createPoller(db, cfg, {
    now: () => now,
    log: () => {},
    fetchOdds: async () => {
      calls++;
      const data = tips.filter((t) => t > now.getTime()).map((t) => ({
        ...event(-5.5, 221.5, now.toISOString()), id: `g${t}`, commence_time: new Date(t).toISOString(),
      }));
      return { data, credits_remaining: 400, credits_used: 2, credits_last: 2 };
    },
  });
  const at = (d) => d.toISOString().slice(5, 16).replace('T', ' ');

  await p.tick();                                    // 23:17 แมตช์ถัดไปอีก 12 นาที: รอบละ 60 นาที ถึงกำหนด 00:17
  assert.equal(calls, 1);
  assert.equal(at(p.nextOddsAt()), '10-22 00:17');
  now = new Date('2026-10-22T00:04:20Z');
  await p.tick();                                    // ยังไม่ถึงกำหนด
  assert.equal(calls, 1);

  // cron ของ GitHub หายไป 50 นาที กลับมาตอน 00:54 ซึ่งแมตช์ที่ใกล้ที่สุด (02:00) อยู่ห่าง 66 นาที
  // ช่วงห่างตามสถานะ ณ ตอนนี้จึงเป็น 4 ชม. แต่รอบ 00:17 ที่ค้างอยู่ต้องถูกดึงชดเชย ไม่ใช่หายไป
  now = new Date('2026-10-22T00:54:32Z');
  assert.equal(p.intervalMinutes(), 240);
  assert.equal(at(p.nextOddsAt()), '10-22 00:17');
  assert.equal(at(p.forecastNextOddsAt()), '10-22 00:54');   // หน้าเว็บไม่แสดงเวลาที่ผ่านมาแล้ว
  await p.tick();
  assert.equal(calls, 2);
  assert.equal(at(p.nextOddsAt()), '10-22 01:54');           // ตารางเริ่มนับใหม่จากรอบที่ดึงชดเชย
});

test('results: closing lines per book + consensus, and games grouped by US Eastern day', async () => {
  const { buildResults, listDays, etDay } = await import('../src/results.js');
  const db = openDb(':memory:');
  const now = new Date('2026-10-25T10:00:00Z');
  const p = createPoller(db, { poll: { farMin: 1, dayMin: 1, nearMin: 1, closeMin: 1, idleMin: 1, tickSec: 60 }, minCreditsLeft: 0, scoresEveryHours: 0 }, {
    now: () => new Date('2026-10-22T12:00:00Z'), log: () => {},
    fetchOdds: async () => ({ data: [event(-5.5, 221.5, 'x')], credits_remaining: 400, credits_used: 2, credits_last: 2 }),
  });
  await p.pollOdds();
  db.prepare('UPDATE games SET home_score = 110, away_score = 100, completed = 1 WHERE id = ?').run('g1');
  const r = buildResults(db);
  assert.equal(r.games.length, 1);
  assert.deepEqual(r.games[0].c.pinnacle, [-5.5, 221.5, -5.5, 221.5]);
  assert.deepEqual(r.games[0].c.consensus, [-5.5, 221.5, -5.5, 221.5]);
  assert.equal(etDay('2026-10-23T00:00:00Z'), '2026-10-22');            // 20:00 ET ยังเป็นวันที่ 22
  assert.deepEqual(listDays(db, now), [{ d: '2026-10-22', n: 1, done: 1 }]);
});

test('free /events schedule adds games without touching "last seen with odds"', async () => {
  const db = openDb(':memory:');
  let now = new Date('2026-10-27T10:00:00Z');
  const p = createPoller(db, { poll: { farMin: 1440, dayMin: 720, nearMin: 240, closeMin: 60, idleMin: 1440, tickSec: 60 },
    minCreditsLeft: 10, scoresEveryHours: 0, eventsEveryMin: 60 }, {
    now: () => now, log: () => {},
    fetchOdds: async () => ({ data: [{ ...event(-5.5, 221.5, 'x'), commence_time: '2026-10-28T00:10:00Z' }], credits_remaining: 400, credits_used: 2, credits_last: 2 }),
    fetchEvents: async () => ({ data: [
      { id: 'g1', commence_time: '2026-10-28T00:10:00Z', home_team: 'Boston Celtics', away_team: 'New York Knicks' },
      { id: 'g2', commence_time: '2026-10-28T00:40:00Z', home_team: 'Miami Heat', away_team: 'Chicago Bulls' },
    ] }),
  });
  await p.tick();                                   // events + odds ครั้งแรก
  const g2 = db.prepare('SELECT * FROM games WHERE id = ?').get('g2');
  assert.equal(g2.last_seen_at, '');                // ยังไม่มีราคา
  const list = listGames(db, { now, book: 'consensus' });
  assert.deepEqual(list.map((g) => [g.id, g.offered, !!g.spreads]), [['g1', true, true], ['g2', false, false]]);
  now = new Date('2026-10-27T10:30:00Z');
  await p.tick();                                   // ยังไม่ครบ 60 นาที: ไม่ดึงตารางซ้ำ
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM polls WHERE kind = 'events'").get().n, 1);
});
