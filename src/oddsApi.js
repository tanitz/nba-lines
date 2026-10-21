const BASE = 'https://api.the-odds-api.com/v4';

/** แปลงเวลาเป็นรูปแบบที่ API รับ (ไม่มีมิลลิวินาที) */
const apiTime = (d) => new Date(d).toISOString().replace(/\.\d{3}Z$/, 'Z');

function quota(res) {
  const n = (h) => {
    const v = res.headers.get(h);
    return v == null || v === '' ? null : Math.round(Number(v));
  };
  return {
    credits_remaining: n('x-requests-remaining'),
    credits_used: n('x-requests-used'),
    credits_last: n('x-requests-last'),
  };
}

async function get(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  const q = quota(res);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.message) msg += ` – ${body.message}`;
    } catch { /* ignore */ }
    const err = new Error(msg);
    Object.assign(err, q, { status: res.status });
    throw err;
  }
  return { data: await res.json(), ...q };
}

/**
 * ราคาแฮนดิแคป + สูง/ต่ำ ของแมตช์ที่ยังไม่เริ่มทั้งหมดในคำขอเดียว
 * ค่าเครดิต = จำนวนตลาด (2) x จำนวนภูมิภาค
 */
export function fetchOdds(cfg, now = new Date()) {
  const p = new URLSearchParams({
    apiKey: cfg.apiKey,
    markets: 'spreads,totals',
    oddsFormat: 'decimal',
    dateFormat: 'iso',
    commenceTimeFrom: apiTime(now),
  });
  if (cfg.bookmakers) p.set('bookmakers', cfg.bookmakers);
  else p.set('regions', cfg.regions);
  return get(`${BASE}/sports/${cfg.sport}/odds?${p}`);
}

/** ผลการแข่งขันย้อนหลัง daysFrom วัน (ค่าเครดิต 2 เมื่อระบุ daysFrom) */
export function fetchScores(cfg, daysFrom = 2) {
  const p = new URLSearchParams({ apiKey: cfg.apiKey, daysFrom: String(daysFrom), dateFormat: 'iso' });
  return get(`${BASE}/sports/${cfg.sport}/scores?${p}`);
}

/**
 * แปลงผลลัพธ์จาก /odds เป็นรายการที่พร้อมบันทึก (pure function ทดสอบได้)
 * คืนค่า { games, bookmakers, snapshots }
 */
export function parseOddsEvents(events, fetchedAt) {
  const games = [];
  const bookmakers = new Map();
  const snapshots = [];

  for (const ev of events ?? []) {
    if (!ev?.id || !ev.home_team || !ev.away_team) continue;
    // เก็บเฉพาะราคาก่อนแข่ง
    if (ev.commence_time && ev.commence_time <= fetchedAt) continue;
    games.push({ id: ev.id, commence_time: ev.commence_time, home_team: ev.home_team, away_team: ev.away_team });

    for (const bk of ev.bookmakers ?? []) {
      bookmakers.set(bk.key, bk.title ?? bk.key);
      for (const m of bk.markets ?? []) {
        const at = m.last_update || bk.last_update || fetchedAt;
        const base = { game_id: ev.id, bookmaker: bk.key, market: m.key, at, fetched_at: fetchedAt };
        const outs = m.outcomes ?? [];

        if (m.key === 'spreads') {
          const home = outs.find((o) => o.name === ev.home_team);
          const away = outs.find((o) => o.name === ev.away_team);
          if (!home || !away || !Number.isFinite(home.point)) continue;
          snapshots.push({ ...base, line: home.point, price_a: home.price, price_b: away.price });
        } else if (m.key === 'totals') {
          const over = outs.find((o) => o.name === 'Over');
          const under = outs.find((o) => o.name === 'Under');
          if (!over || !under || !Number.isFinite(over.point)) continue;
          snapshots.push({ ...base, line: over.point, price_a: over.price, price_b: under.price });
        }
      }
    }
  }
  return { games, bookmakers, snapshots };
}

/** แปลงผลจาก /scores เป็น { id, home_score, away_score, completed } */
export function parseScores(events) {
  const out = [];
  for (const ev of events ?? []) {
    if (!ev?.id || !ev.scores) continue;
    const find = (team) => {
      const s = ev.scores.find((x) => x.name === team);
      return s ? Number(s.score) : null;
    };
    out.push({
      id: ev.id,
      home_score: find(ev.home_team),
      away_score: find(ev.away_team),
      completed: ev.completed ? 1 : 0,
    });
  }
  return out;
}
