/* NBA Line Tracker — frontend.
 * Works with the Node server (/api/*), a static site (window.STATIC_BASE → data/*.json),
 * or a single file with data embedded (window.STATIC_DATA). */
(() => {
  'use strict';

  const STATIC = window.STATIC_DATA || null;
  const CONSENSUS = 'consensus';

  // ---------- helpers ----------
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
    set(k, v) { try { localStorage.setItem('nlt.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
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

  // ---------- number formats ----------
  const num = (v) => String(Math.round(v * 100) / 100);
  const signed = (v) => (v > 0 ? `+${num(v)}` : v < 0 ? `-${num(-v)}` : '0');

  const FMT_NAME = { eu: 'Decimal', hk: 'Hong Kong', my: 'Malay', us: 'American' };
  function fmtOdds(d, f = state.fmt) {
    if (d == null || !Number.isFinite(d)) return '–';
    const hk = d - 1;
    if (f === 'hk') return hk.toFixed(2);
    if (f === 'my') return (d >= 2 ? -1 / hk : hk).toFixed(2);
    if (f === 'us') return d >= 2 ? `+${Math.round(hk * 100)}` : `-${Math.round(100 / hk)}`;
    return d.toFixed(2);
  }
  // Malay and American jump across ±1 / ±100, so their charts plot Hong Kong / Decimal instead.
  const chartFmt = () => (state.fmt === 'hk' || state.fmt === 'my' ? 'hk' : 'eu');
  const chartOdds = (d) => (chartFmt() === 'hk' ? d - 1 : d);

  /** Spread is stored from the home side; show it from the favourite: "BOS -5.5". */
  const spreadText = (line, g) => {
    if (line == null) return '–';
    if (line === 0) return 'PK';
    return line < 0 ? `${ab(g.home)} -${num(-line)}` : `${ab(g.away)} -${num(line)}`;
  };
  /** A negative change in the home line means the market moved toward the home team. */
  const spreadMove = (delta, g) => {
    if (!delta) return null;
    return delta < 0 ? `${ab(g.home)} ${num(-delta)}` : `${ab(g.away)} ${num(delta)}`;
  };
  const totalMove = (delta) => (!delta ? null : signed(delta));

  // ---------- dates ----------
  const T = {
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    day: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
    dayShort: new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }),
    dayKey: new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }),
    stamp: new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
  function span(ms) {
    let m = Math.round(Math.abs(ms) / 60000);
    if (m < 1) return 'under a minute';
    if (m < 60) return `${m} min`;
    if (m < 48 * 60) { const hh = Math.floor(m / 60); m %= 60; return m ? `${hh}h ${m}m` : `${hh}h`; }
    return `${Math.round(m / 1440)} days`;
  }
  const rel = (iso) => {
    const ms = Date.parse(iso) - Date.now();
    return ms < 0 ? `${span(ms)} ago` : `in ${span(ms)}`;
  };

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---------- data ----------
  async function fetchJSON(url, opts) {
    const r = await fetch(url, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
    return body;
  }
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
    fmt: (() => { const f = store.get('fmt', 'hk'); return FMT_NAME[f] ? f : 'hk'; })(),
    status: null,
    games: [],
    gameId: null,
    detail: null,
    charts: [],
    showAll: false,
    error: null,
  };

  // ---------- status bar ----------
  function renderStatus() {
    const s = state.status;
    const el = $('#status');
    el.replaceChildren();
    $('#demoNote').hidden = !(s && s.demo);
    if (!s) return;
    if (!s.demo && !s.hasKey) {
      el.append(h('span', null, h('i', { class: 'dot err' }), 'ODDS_API_KEY is not set'));
      return;
    }
    const la = s.lastAttempt;
    if (la && !la.ok) {
      el.append(h('span', { class: 'err-text' }, h('i', { class: 'dot err' }), `Last fetch failed ${rel(la.at)}: ${la.error || ''}`));
    } else if (s.lastSuccess) {
      el.append(h('span', null, h('i', { class: 'dot ok' }), 'Updated ', h('b', null, rel(s.lastSuccess.at))));
    } else {
      el.append(h('span', null, h('i', { class: 'dot' }), 'No odds fetched yet'));
    }
    if (s.nextPollAt) {
      el.append(h('span', null, 'Next check ', h('b', null, `~${T.time.format(new Date(s.nextPollAt))}`)));
    }
    if (s.credits && s.credits.remaining != null) {
      el.append(h('span', null, 'API credits left ', h('b', null, s.credits.remaining.toLocaleString('en-US'))));
    }
    if (s.canPoll) {
      el.append(h('button', { type: 'button', class: 'linkbtn', onclick: () => {
        const f = $('#pollForm');
        f.hidden = !f.hidden;
        if (!f.hidden) { $('#tokenInput').value = store.get('token', ''); $('#tokenInput').focus(); }
      } }, 'Fetch now'));
    }
  }

  async function pollNow() {
    const token = $('#tokenInput').value.trim();
    const msg = $('#pollMsg');
    if (!token) { msg.textContent = 'Enter the admin token first.'; return; }
    store.set('token', token);
    msg.textContent = 'Fetching odds…';
    try {
      const r = await fetchJSON('/api/poll', { method: 'POST', headers: { 'x-admin-token': token } });
      msg.textContent = r.ok ? `Fetched ${r.games} games, ${r.changes} price changes.` : `Failed: ${r.error}`;
      await refresh();
    } catch (e) {
      msg.textContent = `Failed: ${e.message}`;
    }
  }

  // ---------- filters ----------
  function renderFilters() {
    for (const b of document.querySelectorAll('#scopeTabs button')) {
      b.setAttribute('aria-selected', String(b.dataset.scope === state.scope));
    }
    const sel = $('#bookSelect');
    sel.replaceChildren(h('option', { value: CONSENSUS }, 'Market consensus'));
    for (const b of state.status?.bookmakers ?? []) sel.append(h('option', { value: b.key }, b.title));
    sel.value = state.book;
    $('#fmtSelect').value = state.fmt;
    $('#scopeTabs').hidden = !!state.gameId;
  }

  // ---------- results vs closing line ----------
  function verdict(g, closeSpread, closeTotal) {
    if (!g.score || !g.score.completed) return null;
    const margin = g.score.home - g.score.away;
    let ats = null;
    let ou = null;
    if (closeSpread != null) {
      const v = margin + closeSpread;
      ats = v === 0 ? 'Push' : `${v > 0 ? ab(g.home) : ab(g.away)} covered`;
    }
    if (closeTotal != null) {
      const sum = g.score.home + g.score.away;
      ou = sum === closeTotal ? 'Push' : sum > closeTotal ? 'Over' : 'Under';
    }
    return { ats, ou, score: `${ab(g.away)} ${g.score.away} – ${g.score.home} ${ab(g.home)}` };
  }

  // ---------- board (game list as a table) ----------
  const cell = (v, cls) => h('td', { class: cls || null }, v ?? '–');
  const moveCell = (txt, arrow) => h('td', { class: txt ? 'mv' : 'mv flat' }, txt ? `${arrow}${txt}` : '—');

  function renderBoard() {
    const view = $('#view');
    view.replaceChildren();
    if (state.error) {
      view.append(h('div', { class: 'empty' }, h('strong', null, 'Could not load data'), state.error));
      return;
    }
    const games = state.games;
    const final = state.scope === 'recent';
    if (!games.length) {
      const s = state.status;
      view.append(h('div', { class: 'empty' },
        h('strong', null, final ? 'No finished games in the last 10 days' : 'No upcoming games with odds yet'),
        s && !s.hasKey && !s.demo
          ? 'Add ODDS_API_KEY and the tracker will start fetching odds automatically.'
          : 'Games appear here as soon as bookmakers post lines. The off-season may have none.'));
      return;
    }

    const cols = final ? 14 : 11;
    const thead = h('thead', null,
      h('tr', { class: 'grp' },
        h('th', { rowspan: '2', class: 'sticky game-h', scope: 'col' }, 'Game'),
        h('th', { colspan: '5', class: 'g', scope: 'colgroup' }, 'Spread'),
        h('th', { colspan: '5', class: 'g', scope: 'colgroup' }, 'Total points'),
        final ? h('th', { colspan: '3', class: 'g', scope: 'colgroup' }, 'Result') : null),
      h('tr', null,
        h('th', { class: 'gs' }, 'Open'), h('th', null, final ? 'Close' : 'Now'), h('th', { class: 'mvh' }, 'Move'),
        h('th', { title: 'Odds on the home team at the spread' }, 'Home odds'), h('th', { title: 'Odds on the away team at the spread' }, 'Away odds'),
        h('th', { class: 'gs' }, 'Open'), h('th', null, final ? 'Close' : 'Now'), h('th', { class: 'mvh' }, 'Move'),
        h('th', null, 'Over odds'), h('th', null, 'Under odds'),
        final ? [h('th', { class: 'gs' }, 'Score'), h('th', null, 'ATS'), h('th', null, 'O/U')] : null));

    const tbody = h('tbody');
    let lastDay = null;
    for (const g of games) {
      const d = new Date(g.commence);
      const key = T.dayKey.format(d);
      if (key !== lastDay) {
        lastDay = key;
        tbody.append(h('tr', { class: 'day' }, h('th', { colspan: String(cols), scope: 'rowgroup' },
          h('span', null, T.day.format(d)))));
      }
      const sp = g.spreads;
      const tt = g.totals;
      const v = verdict(g, sp?.now.line, tt?.now.line);
      const soon = Date.parse(g.commence) - Date.now();
      let note = null;
      if (soon > 0 && soon < 24 * 3600_000) note = rel(g.commence);
      else if (soon <= 0 && !g.score?.completed) note = g.score ? 'Live' : (soon < -4 * 3600_000 ? 'Result pending' : 'Started');
      const open = () => openGame(g.id);
      tbody.append(h('tr', { class: 'game', onclick: open },
        h('td', { class: 'sticky game-c' },
          h('button', { type: 'button', class: 'match', title: `${g.away} at ${g.home}`, onclick: (e) => { e.stopPropagation(); open(); } },
            ab(g.away), h('span', { class: 'at' }, ' @ '), ab(g.home)),
          h('span', { class: 'tip' }, T.time.format(d), note ? ` · ${note}` : '')),
        cell(sp ? spreadText(sp.open.line, g) : null, 'gs'),
        cell(sp ? spreadText(sp.now.line, g) : null, 'now'),
        moveCell(sp ? spreadMove(sp.delta, g) : null, '→ '),
        cell(sp ? fmtOdds(sp.now.a) : null),
        cell(sp ? fmtOdds(sp.now.b) : null),
        cell(tt ? num(tt.open.line) : null, 'gs'),
        cell(tt ? num(tt.now.line) : null, 'now'),
        moveCell(tt ? totalMove(tt.delta) : null, ''),
        cell(tt ? fmtOdds(tt.now.a) : null),
        cell(tt ? fmtOdds(tt.now.b) : null),
        final ? [
          cell(g.score ? `${g.score.away}–${g.score.home}` : null, 'gs'),
          cell(v?.ats ?? null),
          cell(v?.ou ?? null),
        ] : null));
    }

    view.append(
      h('div', { class: 'table-wrap board-wrap' }, h('table', { class: 'board' }, thead, tbody)),
      h('p', { class: 'legend' },
        'Spread is shown from the favourite (BOS -5.5 = Boston gives 5.5 points). ',
        'Spread move = how far the line shifted since it opened, toward the team named. Total move = change in points (+ means the total went up). ',
        `Odds are the latest prices in ${FMT_NAME[state.fmt]} format. Click a game for its full price history.`,
        h('span', { class: 'swipe' }, ' Swipe the table sideways to see every column.')));
  }

  // ---------- game page ----------
  function destroyCharts() {
    for (const c of state.charts) c.destroy();
    state.charts = [];
  }

  /** Merge spread and total series into one timeline, carrying values forward. */
  function mergeHistory(sp, tt) {
    const times = [...new Set([...sp.map((p) => p.t), ...tt.map((p) => p.t)])].sort();
    const rows = [];
    let i = 0; let j = 0; let s = null; let t = null;
    for (const time of times) {
      while (i < sp.length && sp[i].t <= time) s = sp[i++];
      while (j < tt.length && tt[j].t <= time) t = tt[j++];
      rows.push({ t: time, s, tt: t });
    }
    return rows;
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
      ctx.fillText('Tip-off', x, top - 3);
      ctx.restore();
    },
  };

  function chartOptions(x0, x1, tipX, yFmt, label) {
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
          ticks: { color: muted, maxTicksLimit: 4, maxRotation: 0, font: { size: 10 }, callback: (v) => T.stamp.format(new Date(v)) },
        },
        y: {
          grace: '8%',
          grid: { color: cssVar('--line'), drawTicks: false },
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
          callbacks: { title: (items) => T.stamp.format(new Date(items[0].parsed.x)), label },
        },
      },
    };
  }
  function stepData(points, endX, pick) {
    const out = points.map((p) => ({ x: Date.parse(p.t), y: pick(p) }));
    if (out.length && endX > out[out.length - 1].x) out.push({ x: endX, y: out[out.length - 1].y });
    return out;
  }
  const ds = (label, dataPts, color) => ({
    label, data: dataPts, borderColor: color, backgroundColor: color,
    borderWidth: 2, stepped: 'after', pointRadius: 0, pointHoverRadius: 4,
    pointHoverBorderWidth: 2, pointHoverBorderColor: cssVar('--surface'),
  });

  function chartCard(title, keys, height) {
    const canvas = h('canvas', { role: 'img', 'aria-label': title });
    const card = h('figure', { class: 'chart' },
      h('figcaption', null, h('span', { class: 'ttl' }, title),
        keys.map(([name, color]) => h('span', { class: 'key' }, h('i', { style: `background:var(${color})` }), name))),
      h('div', { class: `chart-box ${height}` }, canvas));
    return { card, canvas };
  }

  function summaryRow(label, pts, g, isSp) {
    if (!pts.length) return h('tr', null, h('th', { scope: 'row' }, label), h('td', { colspan: '4', class: 'muted' }, 'No odds from this bookmaker'));
    const o = pts[0];
    const n = pts[pts.length - 1];
    const lineTxt = (l) => (isSp ? spreadText(l, g) : num(l));
    const odds = (p) => (isSp ? `${ab(g.home)} ${fmtOdds(p.a)} · ${ab(g.away)} ${fmtOdds(p.b)}` : `O ${fmtOdds(p.a)} · U ${fmtOdds(p.b)}`);
    const delta = Math.round((n.line - o.line) * 100) / 100;
    const mv = isSp ? spreadMove(delta, g) : totalMove(delta);
    const changes = pts.reduce((c, p, i) => c + (i && p.line !== pts[i - 1].line ? 1 : 0), 0);
    return h('tr', null,
      h('th', { scope: 'row' }, label),
      h('td', null, h('b', null, lineTxt(o.line)), h('small', null, odds(o))),
      h('td', null, h('b', null, lineTxt(n.line)), h('small', null, odds(n))),
      h('td', { class: mv ? 'mv' : 'mv flat' }, mv ? (isSp ? `→ ${mv}` : mv) : '—'),
      h('td', null, String(changes)));
  }

  function renderSheet() {
    const view = $('#view');
    destroyCharts();
    view.replaceChildren();
    const back = h('button', { type: 'button', class: 'back', onclick: closeGame }, '← All games');
    const g = state.detail;
    if (!g) {
      view.append(h('div', { class: 'sheet' }, back, h('div', { class: 'empty' }, h('strong', null, 'Game not found'), 'It may have been removed or not fetched yet.')));
      return;
    }
    const tip = Date.parse(g.commence);
    const started = Date.now() >= tip;
    const sp = g.series.spreads;
    const tt = g.series.totals;
    const v = verdict(g, sp.length ? sp[sp.length - 1].line : null, tt.length ? tt[tt.length - 1].line : null);
    const bookTitle = state.book === CONSENSUS ? 'Market consensus (median of all bookmakers)'
      : (g.books.find((b) => b.key === state.book)?.title ?? state.book);

    // header
    const head = h('header', { class: 'sheet-head' },
      h('h2', null, ab(g.away), h('span', { class: 'at' }, ' @ '), ab(g.home)),
      h('p', { class: 'teams' }, `${g.away} at ${g.home}`),
      h('p', { class: 'tip' },
        h('span', null, `${T.day.format(new Date(tip))}, ${T.time.format(new Date(tip))}`),
        started ? h('span', { class: 'pill' }, g.score?.completed ? 'Final' : 'Started')
          : h('span', { class: 'pill live' }, `Tip-off ${rel(g.commence)}`)),
      v ? h('p', { class: 'result' }, h('b', null, v.score), [v.ats, v.ou].filter(Boolean).map((x) => ` · ${x}`).join('')) : null,
      h('p', { class: 'teams' }, `Prices from ${bookTitle}`));

    // summary
    const closeLbl = started ? 'Close' : 'Now';
    const summary = h('section', { class: 'block' },
      h('h3', null, 'Summary'),
      h('div', { class: 'table-wrap narrow' }, h('table', { class: 'summary' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Open'), h('th', null, closeLbl), h('th', { class: 'mvh' }, 'Move'), h('th', null, 'Line changes'))),
        h('tbody', null, summaryRow('Spread', sp, g, true), summaryRow('Total', tt, g, false)))));

    // bookmakers
    let books = null;
    const rowsByBook = g.byBook ?? [];
    if (rowsByBook.length) {
      const tb = h('tbody');
      for (const b of rowsByBook) {
        const s = b.spreads; const t = b.totals;
        const lastT = [s?.t, t?.t].filter(Boolean).sort().pop();
        tb.append(h('tr', { class: b.key === state.book ? 'sel' : null },
          h('th', { scope: 'row' }, b.title),
          cell(s ? spreadText(s.line, g) : null, 'now'), cell(s ? fmtOdds(s.a) : null), cell(s ? fmtOdds(s.b) : null),
          cell(t ? num(t.line) : null, 'now gs'), cell(t ? fmtOdds(t.a) : null), cell(t ? fmtOdds(t.b) : null),
          cell(lastT ? T.stamp.format(new Date(lastT)) : null, 'muted gs')));
      }
      books = h('section', { class: 'block' },
        h('h3', null, started ? 'Closing line by bookmaker' : 'Current line by bookmaker'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'books' },
          h('thead', null, h('tr', null, h('th', null, 'Bookmaker'), h('th', null, 'Spread'), h('th', null, `${ab(g.home)} odds`), h('th', null, `${ab(g.away)} odds`),
            h('th', { class: 'gs' }, 'Total'), h('th', null, 'Over odds'), h('th', null, 'Under odds'), h('th', { class: 'gs' }, 'Last change'))),
          tb)));
    }

    // history
    const hist = mergeHistory(sp, tt);
    const LIMIT = 40;
    const tbh = h('tbody');
    const shown = state.showAll ? hist.length : Math.min(LIMIT, hist.length);
    for (let k = hist.length - 1; k >= hist.length - shown; k--) {
      const r = hist[k];
      const p = k > 0 ? hist[k - 1] : null;
      const lineMoved = (a, b) => (p && a && b && a.line !== b.line ? 'chg' : null);
      tbh.append(h('tr', null,
        h('td', { class: 'muted' }, T.stamp.format(new Date(r.t))),
        h('td', { class: ['now', lineMoved(r.s, p?.s)].filter(Boolean).join(' ') }, r.s ? spreadText(r.s.line, g) : '–'),
        h('td', null, r.s ? fmtOdds(r.s.a) : '–'),
        h('td', null, r.s ? fmtOdds(r.s.b) : '–'),
        h('td', { class: ['now', 'gs', lineMoved(r.tt, p?.tt)].filter(Boolean).join(' ') }, r.tt ? num(r.tt.line) : '–'),
        h('td', null, r.tt ? fmtOdds(r.tt.a) : '–'),
        h('td', null, r.tt ? fmtOdds(r.tt.b) : '–')));
    }
    const history = h('section', { class: 'block' },
      h('h3', null, 'Price history'),
      h('p', { class: 'legend' }, `Newest first. A highlighted line moved from the row below it. Odds in ${FMT_NAME[state.fmt]} format.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'history' },
        h('thead', null,
          h('tr', { class: 'grp' }, h('th', { rowspan: '2' }, 'Time'), h('th', { colspan: '3', class: 'g' }, 'Spread'), h('th', { colspan: '3', class: 'g' }, 'Total')),
          h('tr', null, h('th', null, 'Line'), h('th', null, `${ab(g.home)} odds`), h('th', null, `${ab(g.away)} odds`),
            h('th', { class: 'gs' }, 'Line'), h('th', null, 'Over odds'), h('th', null, 'Under odds'))),
        tbh)),
      hist.length > LIMIT ? h('button', { type: 'button', class: 'more', onclick: () => { state.showAll = !state.showAll; renderSheet(); } },
        state.showAll ? 'Show latest 40 only' : `Show all ${hist.length} rows`) : null);

    // charts
    const oddsLbl = chartFmt() === 'hk' ? 'Hong Kong' : 'Decimal';
    const c1 = chartCard('Spread line (home team points)', [], 'tall');
    const c2 = chartCard(`Spread odds (${oddsLbl})`, [[ab(g.home), '--s1'], [ab(g.away), '--s2']], 'short');
    const c3 = chartCard('Total points line', [], 'tall');
    const c4 = chartCard(`Total odds (${oddsLbl})`, [['Over', '--s1'], ['Under', '--s2']], 'short');
    const charts = h('section', { class: 'block' },
      h('h3', null, 'Charts'),
      h('p', { class: 'legend' }, 'Spread charts plot the home team\'s handicap (below 0 = home favoured). The dashed line marks tip-off. Hover or tap a chart to read exact values.'),
      h('div', { class: 'chart-grid' }, c1.card, c2.card, c3.card, c4.card));

    view.append(h('div', { class: 'sheet' }, back, head, summary, charts, books, history));

    if (!window.Chart) {
      charts.replaceChildren(h('h3', null, 'Charts'), h('p', { class: 'muted' }, 'The chart library did not load. All values are in the tables above.'));
    } else {
      const draw = (pts, lineCard, oddsCard, lineLabel) => {
        if (!pts.length) { lineCard.card.remove(); oddsCard.card.remove(); return; }
        const x0 = Date.parse(pts[0].t);
        const endX = Math.max(Math.min(Date.now(), tip), Date.parse(pts[pts.length - 1].t));
        const f2 = (x) => x.toFixed(2);
        state.charts.push(new window.Chart(lineCard.canvas, {
          type: 'line',
          data: { datasets: [ds('Line', stepData(pts, endX, (p) => p.line), cssVar('--s1'))] },
          options: chartOptions(x0, endX, tip, (x) => signedOrNum(x, lineLabel), (c) => ` ${lineLabel === 'spread' ? spreadText(c.parsed.y, g) : num(c.parsed.y)}`),
          plugins: [crosshair, tipLine],
        }));
        const [na, nb] = lineLabel === 'spread' ? [ab(g.home), ab(g.away)] : ['Over', 'Under'];
        state.charts.push(new window.Chart(oddsCard.canvas, {
          type: 'line',
          data: { datasets: [ds(na, stepData(pts, endX, (p) => chartOdds(p.a)), cssVar('--s1')), ds(nb, stepData(pts, endX, (p) => chartOdds(p.b)), cssVar('--s2'))] },
          options: chartOptions(x0, endX, tip, f2, (c) => ` ${f2(c.parsed.y)}  ${c.dataset.label}`),
          plugins: [crosshair, tipLine],
        }));
      };
      draw(sp, c1, c2, 'spread');
      draw(tt, c3, c4, 'total');
    }
  }
  const signedOrNum = (x, kind) => (kind === 'spread' ? signed(x) : num(x));

  // ---------- navigation ----------
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
    state.showAll = false;
    if (!STATIC && location.hash !== `#game-${id}`) location.hash = `game-${id}`;
    refresh().then(() => window.scrollTo({ top: 0 }));
  }
  function closeGame() {
    state.gameId = null;
    state.detail = null;
    if (!STATIC && location.hash) history.pushState('', document.title, location.pathname + location.search);
    refresh();
  }

  // ---------- start ----------
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

  const redrawTheme = () => { if (state.gameId) renderSheet(); };
  window.matchMedia?.('(prefers-color-scheme: dark)')?.addEventListener?.('change', redrawTheme);
  new MutationObserver(redrawTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  if (window.Chart) window.Chart.defaults.font.family = cssVar('--f-body') || 'system-ui, sans-serif';
  refresh();
})();
