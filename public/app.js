/* ตามราคา NBA — หน้าเว็บ (ใช้ได้ทั้งกับเซิร์ฟเวอร์จริง และโหมดไฟล์เดียวที่ฝังข้อมูลไว้ใน window.STATIC_DATA) */
(() => {
  'use strict';

  const STATIC = window.STATIC_DATA || null;
  const CONSENSUS = 'consensus';

  // ---------- ตัวช่วย ----------
  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem('nlt.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('nlt.' + k, JSON.stringify(v)); } catch { /* ไม่มีที่เก็บก็ไม่เป็นไร */ } },
  };

  const TEAM = {
    'Atlanta Hawks': 'ATL', 'Boston Celtics': 'BOS', 'Brooklyn Nets': 'BKN', 'Charlotte Hornets': 'CHA',
    'Chicago Bulls': 'CHI', 'Cleveland Cavaliers': 'CLE', 'Dallas Mavericks': 'DAL', 'Denver Nuggets': 'DEN',
    'Detroit Pistons': 'DET', 'Golden State Warriors': 'GSW', 'Houston Rockets': 'HOU', 'Indiana Pacers': 'IND',
    'Los Angeles Clippers': 'LAC', 'Los Angeles Lakers': 'LAL', 'Memphis Grizzlies': 'MEM', 'Miami Heat': 'MIA',
    'Milwaukee Bucks': 'MIL', 'Minnesota Timberwolves': 'MIN', 'New Orleans Pelicans': 'NOP', 'New York Knicks': 'NYK',
    'Oklahoma City Thunder': 'OKC', 'Orlando Magic': 'ORL', 'Philadelphia 76ers': 'PHI', 'Phoenix Suns': 'PHX',
    'Portland Trail Blazers': 'POR', 'Sacramento Kings': 'SAC', 'San Antonio Spurs': 'SAS', 'Toronto Raptors': 'TOR',
    'Utah Jazz': 'UTA', 'Washington Wizards': 'WAS',
  };
  const ab = (n) => TEAM[n] || String(n).split(' ').pop().slice(0, 3).toUpperCase();

  const num = (v) => String(Math.round(v * 100) / 100);
  const fmtOdds = (d, f = state.fmt) => {
    if (d == null || !Number.isFinite(d)) return '–';
    if (f === 'eu') return d.toFixed(2);
    const hk = d - 1;
    if (f === 'my') return (d >= 2 ? -1 / hk : hk).toFixed(2);
    return hk.toFixed(2);
  };
  // กราฟค่าน้ำ: มาเลย์มีจุดกระโดด +1/-1 จึงวาดเป็นฮ่องกงแทน
  const chartOdds = (d) => (state.fmt === 'eu' ? d : d - 1);

  const spreadText = (line, g) => {
    if (line === 0) return 'PK';
    return `${line < 0 ? ab(g.home) : ab(g.away)} ต่อ ${num(Math.abs(line))}`;
  };
  const spreadMove = (delta, g) => {
    if (!delta) return null;
    return delta < 0 ? `ไหล ${ab(g.home)} ${num(-delta)}` : `ไหล ${ab(g.away)} ${num(delta)}`;
  };
  const totalMove = (delta) => (!delta ? null : delta > 0 ? `ขึ้น ${num(delta)}` : `ลง ${num(-delta)}`);

  const T = {
    time: new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false }),
    day: new Intl.DateTimeFormat('th-TH', { weekday: 'long', day: 'numeric', month: 'short' }),
    dayKey: new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    short: new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
  function rel(iso, now = Date.now()) {
    const ms = Date.parse(iso) - now;
    const past = ms < 0;
    let m = Math.round(Math.abs(ms) / 60000);
    let s;
    if (m < 1) s = 'ไม่ถึงนาที';
    else if (m < 60) s = `${m} นาที`;
    else if (m < 48 * 60) { const hh = Math.floor(m / 60); m %= 60; s = m ? `${hh} ชม. ${m} นาที` : `${hh} ชม.`; }
    else s = `${Math.round(m / 1440)} วัน`;
    return past ? `${s}ที่แล้ว` : `อีก ${s}`;
  }

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---------- ข้อมูล ----------
  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  }
  // โหมดเว็บไฟล์นิ่ง (GitHub Pages): อ่าน data/index.json และ data/g/<id>.json
  const BASE = !STATIC && window.STATIC_BASE ? window.STATIC_BASE : null;
  let indexCache = null;
  function siteIndex() {
    if (indexCache && Date.now() - indexCache.at < 20_000) return indexCache.p;
    const p = fetchJSON(`${BASE}index.json?t=${Date.now()}`, { cache: 'no-store' });
    indexCache = { at: Date.now(), p };
    p.catch(() => { indexCache = null; });
    return p;
  }
  const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

  const data = {
    status: () => (STATIC ? Promise.resolve(STATIC.status)
      : BASE ? siteIndex().then((i) => i.status)
      : fetchJSON('/api/status')),
    games: (scope, book) => (STATIC ? Promise.resolve(STATIC.games?.[scope]?.[book] ?? [])
      : BASE ? siteIndex().then((i) => i.games?.[scope]?.[book] ?? [])
      : fetchJSON(`/api/games?scope=${scope}&book=${encodeURIComponent(book)}`)),
    game: (id, book) => (STATIC ? Promise.resolve(STATIC.details?.[id]?.[book] ?? null)
      : BASE ? siteIndex().then((i) => fetchJSON(`${BASE}g/${safeId(id)}.json?v=${encodeURIComponent(i.status.generatedAt || '')}`))
        .then((d) => d?.[book] ?? null).catch(() => null)
      : fetchJSON(`/api/games/${encodeURIComponent(id)}?book=${encodeURIComponent(book)}`)),
  };

  const state = {
    scope: 'upcoming',
    book: null,
    fmt: store.get('fmt', 'hk'),
    status: null,
    games: [],
    gameId: null,
    detail: null,
    charts: [],
    error: null,
  };

  // ---------- สถานะการดึงราคา ----------
  function renderStatus() {
    const s = state.status;
    const el = $('#status');
    el.replaceChildren();
    $('#demoNote').hidden = !(s && s.demo);
    if (!s) return;
    if (!s.demo && !s.hasKey) {
      el.append(h('span', null, h('i', { class: 'dot err' }), 'ยังไม่ได้ตั้ง ODDS_API_KEY'));
      return;
    }
    const la = s.lastAttempt;
    if (la && !la.ok) {
      el.append(h('span', { class: 'err-text' }, h('i', { class: 'dot err' }), `ดึงไม่สำเร็จ ${rel(la.at)}: ${la.error || ''}`));
    } else if (s.lastSuccess) {
      el.append(h('span', null, h('i', { class: 'dot ok' }), 'ดึงล่าสุด ', h('b', null, rel(s.lastSuccess.at))));
    } else {
      el.append(h('span', null, h('i', { class: 'dot' }), 'ยังไม่เคยดึงราคา'));
    }
    if (s.nextPollAt) {
      el.append(h('span', null, 'รอบถัดไป ', h('b', null, T.time.format(new Date(s.nextPollAt))),
        s.intervalMin ? ` (ทุก ${s.intervalMin} นาที)` : ''));
    }
    if (s.credits && s.credits.remaining != null) {
      el.append(h('span', null, 'เครดิตเหลือ ', h('b', null, s.credits.remaining.toLocaleString('th-TH'))));
    }
    if (s.canPoll) {
      el.append(h('button', { type: 'button', class: 'linkbtn', onclick: () => {
        const f = $('#pollForm');
        f.hidden = !f.hidden;
        if (!f.hidden) { $('#tokenInput').value = store.get('token', ''); $('#tokenInput').focus(); }
      } }, 'ดึงราคาตอนนี้'));
    }
  }

  async function pollNow() {
    const token = $('#tokenInput').value.trim();
    const msg = $('#pollMsg');
    if (!token) { msg.textContent = 'ใส่รหัสผู้ดูแลก่อน'; return; }
    store.set('token', token);
    msg.textContent = 'กำลังดึงราคา…';
    try {
      const r = await fetchJSON('/api/poll', { method: 'POST', headers: { 'x-admin-token': token } });
      msg.textContent = r.ok ? `ดึงแล้ว ${r.games} แมตช์ ราคาเปลี่ยน ${r.changes} รายการ` : `ไม่สำเร็จ: ${r.error}`;
      await refresh();
    } catch (e) {
      msg.textContent = `ไม่สำเร็จ: ${e.message}`;
    }
  }

  // ---------- ตัวกรอง ----------
  function renderFilters() {
    for (const b of document.querySelectorAll('#scopeTabs button')) {
      b.setAttribute('aria-selected', String(b.dataset.scope === state.scope));
    }
    const sel = $('#bookSelect');
    sel.replaceChildren(h('option', { value: CONSENSUS }, 'ค่ากลางตลาด'));
    for (const b of state.status?.bookmakers ?? []) sel.append(h('option', { value: b.key }, b.title));
    sel.value = state.book;
    $('#fmtSelect').value = state.fmt;
    $('#scopeTabs').hidden = !!state.gameId;
  }

  // ---------- กราฟจิ๋ว ----------
  function sparkline(spark) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('viewBox', '0 0 56 18');
    svg.setAttribute('aria-hidden', 'true');
    const pts = [];
    for (const p of spark || []) if (!pts.length || pts[pts.length - 1][1] !== p[1]) pts.push(p);
    if (pts.length < 1) return svg;
    const x0 = pts[0][0];
    const x1 = Math.max(spark[spark.length - 1][0], x0 + 1);
    const ys = pts.map((p) => p[1]);
    const lo = Math.min(...ys); const hi = Math.max(...ys);
    const X = (x) => 2 + ((x - x0) / (x1 - x0)) * 50;
    const Y = (y) => (hi === lo ? 9 : 15 - ((y - lo) / (hi - lo)) * 12);
    let d = `M${X(pts[0][0]).toFixed(1)},${Y(pts[0][1]).toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) d += `H${X(pts[i][0]).toFixed(1)}V${Y(pts[i][1]).toFixed(1)}`;
    d += `H${X(x1).toFixed(1)}`;
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', X(x1).toFixed(1)); c.setAttribute('cy', Y(pts[pts.length - 1][1]).toFixed(1)); c.setAttribute('r', '2');
    svg.append(path, c);
    return svg;
  }

  // ---------- ผลการแข่งขันเทียบราคาปิด ----------
  function verdict(g, closeSpread, closeTotal) {
    if (!g.score || !g.score.completed) return null;
    const margin = g.score.home - g.score.away;
    const out = [];
    if (closeSpread != null) {
      const ats = margin + closeSpread;
      out.push(ats === 0 ? 'เสมอราคา' : `${ats > 0 ? ab(g.home) : ab(g.away)} ชนะราคา`);
    }
    if (closeTotal != null) {
      const sum = g.score.home + g.score.away;
      out.push(sum === closeTotal ? 'สูง/ต่ำ เสมอ' : sum > closeTotal ? 'ออกสูง' : 'ออกต่ำ');
    }
    return out;
  }

  // ---------- หน้ารายการ ----------
  function mktRow(label, sum, g, kind) {
    if (!sum) {
      return h('div', { class: 'mkt' }, h('span', { class: 'k' }, label), h('span', { class: 'v' }, '–'), h('span', { class: 'move flat' }, ''));
    }
    const txt = kind === 'spreads' ? spreadText : (l) => num(l);
    const mv = kind === 'spreads' ? spreadMove(sum.delta, g) : totalMove(sum.delta);
    // ฝั่งต่อเดิม: แสดงแค่ตัวเลขใหม่ เช่น "DEN ต่อ 10 → 9.5"
    const sameSide = kind === 'spreads' && Math.sign(sum.open.line) === Math.sign(sum.now.line) && sum.now.line !== 0;
    const to = sameSide ? num(Math.abs(sum.now.line)) : txt(sum.now.line, g);
    const v = sum.delta
      ? h('span', { class: 'v' }, txt(sum.open.line, g), h('span', { class: 'arrow' }, '→'), to)
      : h('span', { class: 'v' }, txt(sum.now.line, g));
    return h('div', { class: 'mkt' },
      h('span', { class: 'k' }, label), v,
      h('span', { class: mv ? 'move' : 'move flat' }, mv || 'คงที่'),
      sparkline(sum.spark));
  }

  function timeNote(g) {
    const ms = Date.parse(g.commence) - Date.now();
    if (ms <= 0) return g.score?.completed ? 'จบ' : (g.score ? 'กำลังแข่ง' : '');
    if (ms >= 12 * 3600_000) return '';
    const m = Math.round(ms / 60000);
    return m < 60 ? `อีก ${m} นาที` : `อีก ${Math.round(m / 60)} ชม.`;
  }

  function renderBoard() {
    const view = $('#view');
    view.replaceChildren();
    if (state.error) {
      view.append(h('div', { class: 'empty' }, h('strong', null, 'โหลดข้อมูลไม่ได้'), state.error));
      return;
    }
    const games = state.games;
    if (!games.length) {
      const s = state.status;
      view.append(h('div', { class: 'empty' },
        h('strong', null, state.scope === 'upcoming' ? 'ยังไม่มีแมตช์ที่รอแข่ง' : 'ยังไม่มีแมตช์ที่แข่งแล้วใน 10 วันล่าสุด'),
        s && !s.hasKey && !s.demo
          ? 'ตั้งค่า ODDS_API_KEY ในไฟล์ .env แล้วเริ่มเซิร์ฟเวอร์ใหม่ ระบบจะดึงราคาให้อัตโนมัติ'
          : 'ระบบจะเพิ่มแมตช์ให้เองเมื่อเจ้ามือเปิดราคา ช่วงปิดฤดูกาลอาจไม่มีราคา'));
      return;
    }
    const groups = new Map();
    for (const g of games) {
      const d = new Date(g.commence);
      const k = T.dayKey.format(d);
      if (!groups.has(k)) groups.set(k, { label: T.day.format(d), items: [] });
      groups.get(k).items.push(g);
    }
    const board = h('div', { class: 'board' });
    for (const grp of groups.values()) {
      const list = h('div', { class: 'day-list' });
      for (const g of grp.items) {
        const d = new Date(g.commence);
        const res = verdict(g, g.spreads?.now.line, g.totals?.now.line);
        list.append(h('button', { type: 'button', class: 'row', onclick: () => openGame(g.id) },
          h('span', { class: 'time' }, T.time.format(d)),
          h('span', { class: 'matchup' }, ab(g.away), h('span', { class: 'at' }, '@'), ab(g.home),
            timeNote(g) ? h('small', { class: 'when' }, timeNote(g)) : null),
          h('span', { class: 'mkts' },
            mktRow('แฮนดิแคป', g.spreads, g, 'spreads'),
            mktRow('สูง/ต่ำ', g.totals, g, 'totals')),
          g.score ? h('span', { class: 'result' },
            h('b', null, `${ab(g.away)} ${g.score.away} – ${g.score.home} ${ab(g.home)}`),
            res && res.length ? ` · ${res.join(' · ')}` : (g.score.completed ? '' : ' · กำลังแข่ง')) : null));
      }
      board.append(h('section', { class: 'day' }, h('h2', null, grp.label), list));
    }
    view.append(board);
  }

  // ---------- หน้าแมตช์ ----------
  function destroyCharts() {
    for (const c of state.charts) c.destroy();
    state.charts = [];
  }

  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const a = chart.tooltip?.getActiveElements?.();
      if (!a || !a.length) return;
      const x = a[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cssVar('--line-strong');
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.restore();
    },
  };
  const tipLine = {
    id: 'tipLine',
    afterDraw(chart, _a, opts) {
      if (!opts || opts.x == null) return;
      const xs = chart.scales.x;
      if (opts.x < xs.min || opts.x > xs.max) return;
      const x = xs.getPixelForValue(opts.x);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = cssVar('--ink-2');
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = cssVar('--ink-2');
      ctx.font = `500 11px ${cssVar('--f-body')}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(opts.label || 'เริ่มแข่ง', x, top - 3);
      ctx.restore();
    },
  };

  function baseOptions(x0, x1, tipX, yFmt, tooltipLabel) {
    const grid = cssVar('--line');
    const muted = cssVar('--muted');
    return {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      layout: { padding: { top: tipX >= x0 && tipX <= x1 ? 16 : 4, right: 4 } },
      scales: {
        x: {
          type: 'linear', min: x0, max: x1,
          grid: { display: false },
          border: { color: cssVar('--line-strong') },
          ticks: { color: muted, maxTicksLimit: 4, maxRotation: 0, font: { size: 10 },
            callback: (v) => T.short.format(new Date(v)) },
        },
        y: {
          grace: '8%',
          grid: { color: grid, drawTicks: false },
          border: { display: false },
          ticks: { color: muted, font: { size: 10 }, padding: 6, maxTicksLimit: 5, callback: yFmt },
        },
      },
      plugins: {
        legend: { display: false },
        tipLine: { x: tipX },
        tooltip: {
          backgroundColor: cssVar('--surface'),
          titleColor: cssVar('--muted'),
          bodyColor: cssVar('--ink'),
          borderColor: cssVar('--line-strong'),
          borderWidth: 1,
          padding: 8,
          boxWidth: 12, boxHeight: 2,
          titleFont: { weight: '500', size: 11 },
          bodyFont: { weight: '600', size: 12 },
          callbacks: { title: (items) => T.short.format(new Date(items[0].parsed.x)), label: tooltipLabel },
        },
      },
    };
  }

  function stepData(points, endX, pick) {
    const out = points.map((p) => ({ x: Date.parse(p.t), y: pick(p) }));
    if (out.length && endX > out[out.length - 1].x) out.push({ x: endX, y: out[out.length - 1].y });
    return out;
  }
  const ds = (label, data, color) => ({
    label, data, borderColor: color, backgroundColor: color,
    borderWidth: 2, stepped: 'after', pointRadius: 0, pointHoverRadius: 4,
    pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar('--surface'),
  });

  function marketBlock(g, kind, points) {
    const isSp = kind === 'spreads';
    const title = isSp ? 'แฮนดิแคป' : 'สูง/ต่ำ (คะแนนรวม)';
    const sec = h('section', { class: 'market', 'aria-label': title }, h('h3', null, title));
    if (!points.length) {
      sec.append(h('p', { class: 'no-chart' }, 'เจ้ามือนี้ยังไม่มีราคาตลาดนี้'));
      return { sec, draw: () => {} };
    }
    const started = Date.now() >= Date.parse(g.commence);
    const open = points[0];
    const last = points[points.length - 1];
    const lineTxt = (l) => (isSp ? spreadText(l, g) : num(l));
    const aName = isSp ? ab(g.home) : 'สูง';
    const bName = isSp ? ab(g.away) : 'ต่ำ';
    const delta = Math.round((last.line - open.line) * 100) / 100;
    const mv = isSp ? spreadMove(delta, g) : totalMove(delta);
    const lineMoves = points.reduce((n, p, i) => n + (i && p.line !== points[i - 1].line ? 1 : 0), 0);

    if (isSp) sec.append(h('p', { class: 'hint' }, `กราฟแสดงแต้มต่อของ ${ab(g.home)} (เจ้าบ้าน) ค่าติดลบ = ${ab(g.home)} เป็นฝ่ายต่อ`));
    sec.append(h('dl', { class: 'facts' },
      h('div', null, h('dt', null, 'ราคาเปิด'), h('dd', null, lineTxt(open.line),
        h('small', null, `${aName} ${fmtOdds(open.a)} · ${bName} ${fmtOdds(open.b)}`))),
      h('div', null, h('dt', null, started ? 'ราคาปิด' : 'ล่าสุด'), h('dd', null, lineTxt(last.line),
        h('small', null, `${aName} ${fmtOdds(last.a)} · ${bName} ${fmtOdds(last.b)}`))),
      h('div', null, h('dt', null, 'การขยับ'), h('dd', null, mv || 'คงที่',
        h('small', null, `เส้นเปลี่ยน ${lineMoves} ครั้ง · ค่าน้ำ ${points.length - 1} ครั้ง`)))));

    const lineCanvas = h('canvas', { role: 'img', 'aria-label': `กราฟเส้น${title}ตามเวลา` });
    const priceCanvas = h('canvas', { role: 'img', 'aria-label': `กราฟค่าน้ำ${title}ตามเวลา` });
    const fmtLabel = state.fmt === 'eu' ? 'ยุโรป' : 'ฮ่องกง';
    sec.append(
      h('div', { class: 'chart-label' }, h('span', { class: 'ttl' }, isSp ? 'เส้นต่อ' : 'เส้นคะแนนรวม')),
      h('div', { class: 'chart-box tall' }, lineCanvas),
      h('div', { class: 'chart-label' },
        h('span', { class: 'ttl' }, `ค่าน้ำ (${fmtLabel})`),
        h('span', { class: 'key' }, h('i', { style: 'background:var(--s1)' }), aName),
        h('span', { class: 'key' }, h('i', { style: 'background:var(--s2)' }), bName)),
      h('div', { class: 'chart-box short' }, priceCanvas));

    // ตารางประวัติ (ใหม่สุดก่อน)
    const tbody = h('tbody');
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const moved = i > 0 && p.line !== points[i - 1].line;
      tbody.append(h('tr', { class: moved ? 'moved' : null },
        h('td', null, T.short.format(new Date(p.t))),
        h('td', { class: 'ln' }, isSp ? num(p.line) : num(p.line)),
        h('td', null, fmtOdds(p.a)), h('td', null, fmtOdds(p.b))));
    }
    sec.append(h('details', { class: 'log' },
      h('summary', null, `ตารางราคาทั้งหมด (${points.length} รายการ)`),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'เวลา'), h('th', null, isSp ? `แต้ม ${ab(g.home)}` : 'เส้น'),
          h('th', null, aName), h('th', null, bName))),
        tbody))));

    const draw = () => {
      if (!window.Chart) {
        lineCanvas.parentElement.replaceWith(h('p', { class: 'no-chart' }, 'โหลดไลบรารีกราฟไม่ได้ ดูตัวเลขในตารางด้านล่าง'));
        priceCanvas.parentElement.remove();
        return;
      }
      const tip = Date.parse(g.commence);
      const x0 = Date.parse(open.t);
      const endX = Math.max(Math.min(Date.now(), tip), Date.parse(last.t));
      const s1 = cssVar('--s1'); const s2 = cssVar('--s2');
      const ink = cssVar('--s1');
      state.charts.push(new window.Chart(lineCanvas, {
        type: 'line',
        data: { datasets: [ds(isSp ? 'เส้นต่อ' : 'เส้น', stepData(points, endX, (p) => p.line), ink)] },
        options: baseOptions(x0, endX, tip, (v) => num(v), (c) => ` ${lineTxt(c.parsed.y)}`),
        plugins: [crosshair, tipLine],
      }));
      const oddsFmt = (v) => (state.fmt === 'eu' ? v.toFixed(2) : v.toFixed(2));
      state.charts.push(new window.Chart(priceCanvas, {
        type: 'line',
        data: { datasets: [
          ds(aName, stepData(points, endX, (p) => chartOdds(p.a)), s1),
          ds(bName, stepData(points, endX, (p) => chartOdds(p.b)), s2),
        ] },
        options: baseOptions(x0, endX, tip, oddsFmt, (c) => ` ${oddsFmt(c.parsed.y)}  ${c.dataset.label}`),
        plugins: [crosshair, tipLine],
      }));
    };
    return { sec, draw };
  }

  function renderSheet() {
    const view = $('#view');
    destroyCharts();
    view.replaceChildren();
    const back = h('button', { type: 'button', class: 'back', onclick: closeGame }, '← รายการแมตช์');
    const g = state.detail;
    if (!g) {
      view.append(h('div', { class: 'sheet' }, back, h('div', { class: 'empty' }, h('strong', null, 'ไม่พบแมตช์นี้'), 'อาจถูกลบหรือยังไม่ได้ดึงข้อมูล')));
      return;
    }
    const tip = Date.parse(g.commence);
    const started = Date.now() >= tip;
    const sp = g.series.spreads; const tt = g.series.totals;
    const res = verdict(g, sp.length ? sp[sp.length - 1].line : null, tt.length ? tt[tt.length - 1].line : null);
    const bookTitle = state.book === CONSENSUS ? 'ค่ากลางตลาด (มัธยฐานทุกเจ้า)'
      : (g.books.find((b) => b.key === state.book)?.title ?? state.book);

    const head = h('header', { class: 'sheet-head' },
      h('h2', null, ab(g.away), h('span', { class: 'at' }, '@'), ab(g.home)),
      h('div', { class: 'teams' }, `${g.away} (เยือน) พบ ${g.home} (เหย้า)`),
      h('div', { class: 'tip' },
        h('span', null, `${T.day.format(new Date(tip))} ${T.time.format(new Date(tip))}`),
        started
          ? h('span', { class: 'pill' }, g.score?.completed ? 'จบเกม' : 'เริ่มแข่งแล้ว')
          : h('span', { class: 'pill live' }, `เริ่ม${rel(g.commence)}`),
        g.score ? h('b', null, `${ab(g.away)} ${g.score.away} – ${g.score.home} ${ab(g.home)}`) : null,
        res && res.length ? h('span', null, res.join(' · ')) : null),
      h('div', { class: 'teams' }, `ราคาจาก ${bookTitle}`));

    const a = marketBlock(g, 'spreads', sp);
    const b = marketBlock(g, 'totals', tt);
    view.append(h('div', { class: 'sheet' }, back, head, a.sec, b.sec));
    a.draw(); b.draw();
    window.scrollTo({ top: 0 });
  }

  // ---------- การนำทาง ----------
  function render() {
    renderStatus();
    renderFilters();
    if (state.gameId) renderSheet(); else { destroyCharts(); renderBoard(); }
  }

  async function refresh() {
    try {
      state.status = await data.status();
      const books = new Set([CONSENSUS, ...(state.status.bookmakers ?? []).map((b) => b.key)]);
      if (!state.book) state.book = store.get('book', null) || state.status.defaultBook || CONSENSUS;
      if (!books.has(state.book)) state.book = CONSENSUS;
      if (state.gameId) state.detail = await data.game(state.gameId, state.book);
      else state.games = await data.games(state.scope, state.book);
      state.error = null;
    } catch (e) {
      state.error = e.message;
    }
    render();
  }

  function openGame(id) {
    state.gameId = id;
    if (!STATIC && location.hash !== `#game-${id}`) location.hash = `game-${id}`;
    refresh();
  }
  function closeGame() {
    state.gameId = null;
    state.detail = null;
    if (!STATIC && location.hash) history.pushState('', document.title, location.pathname + location.search);
    refresh();
  }

  // ---------- เริ่มต้น ----------
  for (const b of document.querySelectorAll('#scopeTabs button')) {
    b.addEventListener('click', () => { state.scope = b.dataset.scope; refresh(); });
  }
  $('#bookSelect').addEventListener('change', (e) => { state.book = e.target.value; store.set('book', state.book); refresh(); });
  $('#fmtSelect').addEventListener('change', (e) => { state.fmt = e.target.value; store.set('fmt', state.fmt); render(); });
  $('#pollGo').addEventListener('click', pollNow);
  $('#tokenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') pollNow(); });

  if (!STATIC) {
    window.addEventListener('hashchange', () => {
      const m = location.hash.match(/^#game-(.+)$/);
      const id = m ? decodeURIComponent(m[1]) : null;
      if (id !== state.gameId) { state.gameId = id; refresh(); }
    });
    const m = location.hash.match(/^#game-(.+)$/);
    if (m) state.gameId = decodeURIComponent(m[1]);
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60_000);
  }

  // วาดกราฟใหม่เมื่อเปลี่ยนธีม
  const redrawTheme = () => { if (state.gameId) renderSheet(); };
  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', redrawTheme);
  new MutationObserver(redrawTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  if (window.Chart) {
    window.Chart.defaults.font.family = cssVar('--f-body') || 'system-ui, sans-serif';
  }
  refresh();
})();
