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
