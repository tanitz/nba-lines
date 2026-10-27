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
  /** Home handicap falling means the market moved toward the home team. */
  const spreadToward = (delta, g) => (delta < 0 ? ab(g.home) : ab(g.away));

  // ---------- change colours: green = went up, red = went down ----------
  const EPS = 1e-9;
  const dirOf = (delta) => (delta > EPS ? 'up' : delta < -EPS ? 'down' : null);

  /** Table cell. opts: cls, dir ('up'|'down' tints it), arrow (draw ▲/▼), sub (small second line), title. */
  function td(text, o = {}) {
    const cls = [o.cls, o.dir].filter(Boolean).join(' ');
    const shown = text ?? '–';
    return h('td', { class: cls || null, title: o.title || null },
      o.arrow && o.dir ? h('span', { class: 'v' }, shown) : shown,
      o.sub ? h('small', null, o.sub) : null);
  }
  const changeKey = (since) => h('p', { class: 'chg-key' },
    h('span', { class: 'lead' }, `Colour shows change ${since}:`),
    h('span', { class: 'chip up' }, h('i'), 'Went up'),
    h('span', { class: 'chip down' }, h('i'), 'Went down'),
    h('span', { class: 'chip' }, 'No change'));

  // ---------- dates ----------
  const T = {
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }),
    day: new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
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
  // "~02:25" today, "~02:25 tomorrow", "~24 Oct, 02:25" later; "due now" once that time has passed
  const nextCheck = (iso) => {
    const d = new Date(iso);
    if (d.getTime() <= Date.now()) return 'due now';
    const days = Math.round((Date.parse(T.dayKey.format(d)) - Date.parse(T.dayKey.format(new Date()))) / 864e5);
    if (days <= 0) return `~${T.time.format(d)}`;
    return days === 1 ? `~${T.time.format(d)} tomorrow` : `~${T.stamp.format(d)}`;
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

  const mergeShared = (d, book) => (d?.[book] ? { ...d[book], ...(d._shared ?? {}) } : null);
  const stamp = (i) => encodeURIComponent(i.status.generatedAt || '');
  let resultsCache = null;
  const data = {
    status: () => (STATIC ? Promise.resolve(STATIC.status)
      : BASE ? siteIndex().then((i) => i.status)
      : fetchJSON('/api/status')),
    days: () => (STATIC ? Promise.resolve(STATIC.days ?? [])
      : BASE ? siteIndex().then((i) => i.days ?? [])
      : fetchJSON('/api/days')),
    games: (scope, book, day) => {
      if (STATIC) return Promise.resolve((scope === 'recent' ? STATIC.byDay?.[day] : STATIC.games?.upcoming)?.[book] ?? []);
      if (!BASE) return fetchJSON(`/api/games?scope=${scope}&book=${encodeURIComponent(book)}${day ? `&day=${day}` : ''}`);
      return siteIndex().then((i) => (scope === 'recent'
        ? (day ? fetchJSON(`${BASE}d/${day}.json?v=${stamp(i)}`).then((d) => d?.[book] ?? []) : [])
        : i.games?.upcoming?.[book] ?? []));
    },
    results: () => {
      if (STATIC) return Promise.resolve(STATIC.results ?? { games: [] });
      if (resultsCache && Date.now() - resultsCache.at < 60_000) return resultsCache.p;
      const p = BASE ? siteIndex().then((i) => fetchJSON(`${BASE}results.json?v=${stamp(i)}`)) : fetchJSON('/api/results');
      resultsCache = { at: Date.now(), p };
      p.catch(() => { resultsCache = null; });
      return p;
    },
    game: (id, book) => (STATIC ? Promise.resolve(mergeShared(STATIC.details?.[id], book))
      : BASE ? siteIndex().then((i) => fetchJSON(`${BASE}g/${safeId(id)}.json?v=${stamp(i)}`))
        .then((d) => mergeShared(d, book)).catch(() => null)
      : fetchJSON(`/api/games/${encodeURIComponent(id)}?book=${encodeURIComponent(book)}`)),
  };

  const state = {
    scope: 'upcoming',
    team: null,
    day: null,
    days: [],
    results: null,
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
      el.append(h('span', null, 'Next check ', h('b', null, nextCheck(s.nextPollAt))));
    }
    if (s.credits && s.credits.remaining != null) {
      el.append(h('span', null, 'API credits left ', h('b', null, s.credits.remaining.toLocaleString('en-US'))));
    }
    if (REPO && !s.demo) {
      el.append(h('button', { type: 'button', class: 'refresh-btn', disabled: !!gh.busy, onclick: ghRefresh },
        gh.busy ? 'Refreshing…' : '↻ Refresh prices'));
    }
    if (s.canPoll) {
      el.append(h('button', { type: 'button', class: 'linkbtn', onclick: () => {
        const f = $('#pollForm');
        f.hidden = !f.hidden;
        if (!f.hidden) { $('#tokenInput').value = store.get('token', ''); $('#tokenInput').focus(); }
      } }, 'Fetch now'));
    }
  }

  // ---------- "Refresh prices" on the GitHub Pages site ----------
  // The site is static, so the button asks GitHub to run the update job right away
  // (workflow_dispatch with fetch_odds). It needs a GitHub token that the visitor keeps in their own browser.
  const REPO = BASE && window.SITE_REPO ? window.SITE_REPO : null;
  const gh = { busy: null, timer: null };
  function ghShow(msg, { setup = false, noToken = false } = {}) {
    $('#ghForm').hidden = false;
    $('#ghMsg').textContent = msg;
    $('#ghSetup').hidden = !setup;
    $('#ghNoToken').hidden = !noToken;
    $('#ghForget').hidden = setup || noToken || !store.get('ghToken', '');
  }
  function ghWait(msg) {
    gh.busy = { since: new Date(Date.now() - 5000).toISOString(), at: Date.now(), quiet: !msg };
    renderStatus();
    if (msg) ghShow(msg); else $('#ghForm').hidden = true;
    clearInterval(gh.timer);
    gh.timer = setInterval(ghWatch, 10_000);
  }
  async function ghRefresh() {
    const token = store.get('ghToken', '');
    if (!token) {
      $('#ghOpen').href = `https://github.com/${REPO}/actions/workflows/update.yml`;
      ghShow('Prices are fetched by the site\'s update job on GitHub. Start it there (uses 2 API credits):', { noToken: true });
      return;
    }
    gh.busy = { since: new Date().toISOString(), at: Date.now(), quiet: true };
    renderStatus();
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/update.yml/dispatches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
        body: JSON.stringify({ ref: 'main', inputs: { rebuild: true, fetch_odds: true } }),
      });
    } catch (e) {
      gh.busy = null; renderStatus();
      ghShow(`Could not reach GitHub: ${e.message}`);
      return;
    }
    if (r.status === 401 || r.status === 403 || r.status === 404) {
      // bad / expired token: drop it and fall back to the no-token way
      gh.busy = null; renderStatus();
      store.set('ghToken', '');
      $('#ghOpen').href = `https://github.com/${REPO}/actions/workflows/update.yml`;
      ghShow(`The saved GitHub token did not work (HTTP ${r.status}) and was removed. Start the update on GitHub instead (uses 2 API credits):`, { noToken: true });
      return;
    }
    if (r.status !== 204) {
      gh.busy = null; renderStatus();
      const body = await r.json().catch(() => ({}));
      ghShow(`GitHub error (HTTP ${r.status}) ${body.message || ''}`);
      return;
    }
    ghWait(null);
  }
  async function ghWatch() {
    if (!gh.busy) return;
    indexCache = null;
    try {
      const st = await data.status();
      const la = st.lastAttempt;
      if (la && la.at > gh.busy.since) {
        clearInterval(gh.timer);
        const quiet = gh.busy?.quiet;
        gh.busy = null;
        await refresh();
        if (quiet && la.ok) return;
        ghShow(la.ok
          ? `Prices updated ${T.time.format(new Date(la.at))}: ${st.lastSuccess?.games ?? 0} games, ${st.lastSuccess?.changes ?? 0} price changes.`
          : `The fetch ran but failed: ${la.error || 'unknown error'}`);
        setTimeout(() => { if (!gh.busy) $('#ghForm').hidden = true; }, 15_000);
        return;
      }
    } catch { /* keep waiting */ }
    if (Date.now() - gh.busy.at > 15 * 60_000) {
      clearInterval(gh.timer);
      gh.busy = null;
      renderStatus();
      ghShow('Still waiting on GitHub — its queue can be slow. The new prices will appear here once the job finishes.');
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
    $('#scopeTabs').hidden = !!(state.gameId || state.team);
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
  /** Line movement cell (spread or total): arrow + size of the move since open. */
  function moveCell(s, g, kind) {
    if (!s) return td(null, { cls: 'flat mvc' });
    const dir = dirOf(s.delta);
    if (!dir) return td('—', { cls: 'flat mvc' });
    const mag = num(Math.abs(s.delta));
    if (kind === 'spreads') {
      const team = spreadToward(s.delta, g);
      return td(mag, { cls: 'mvc', dir, arrow: true, sub: `toward ${team}`, title: `Line moved ${mag} toward ${team}` });
    }
    return td(mag, { cls: 'mvc', dir, arrow: true, sub: dir === 'up' ? 'higher' : 'lower', title: `Total went ${dir === 'up' ? 'up' : 'down'} by ${mag}` });
  }
  /** Odds cell: latest price, coloured by its change since open. */
  function oddsCell(nowD, openD) {
    if (nowD == null) return td(null);
    const dir = dirOf(nowD - openD);
    return td(fmtOdds(nowD), {
      dir, arrow: true,
      sub: dir ? `open ${fmtOdds(openD)}` : null,
      title: dir ? `Open ${fmtOdds(openD)} → now ${fmtOdds(nowD)}` : null,
    });
  }

  // ---------- date picker for finished games ----------
  const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayFmtLong = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dayLabel = (d, long) => (long ? dayFmtLong : dayFmt).format(new Date(`${d}T12:00:00Z`));
  function dayBar() {
    const days = state.days;
    const i = days.findIndex((x) => x.d === state.day);
    const go = (k) => { if (days[k]) { state.day = days[k].d; refresh(); } };
    const sel = h('select', { id: 'daySelect', 'aria-label': 'Game day' });
    for (const x of days) {
      sel.append(h('option', { value: x.d }, `${dayLabel(x.d)} · ${x.n} game${x.n === 1 ? '' : 's'}${x.done < x.n ? ` (${x.done} final)` : ''}`));
    }
    sel.value = state.day ?? '';
    sel.addEventListener('change', () => { state.day = sel.value; refresh(); });
    const cur = days[i];
    return h('div', { class: 'daybar' },
      h('button', { type: 'button', class: 'nav', disabled: i < 0 || i >= days.length - 1, onclick: () => go(i + 1), 'aria-label': 'Previous day' }, '‹ Older'),
      h('label', { class: 'field' }, h('span', null, 'Game day (US Eastern)'), sel),
      h('button', { type: 'button', class: 'nav', disabled: i <= 0, onclick: () => go(i - 1), 'aria-label': 'Next day' }, 'Newer ›'),
      cur && cur.done < cur.n ? h('span', { class: 'note' }, 'Final scores arrive up to a day after the game.') : null);
  }

  // ---------- finished games: one easy-to-read card per game, all maths done ----------
  /** Everything a finished game needs, computed against the closing line. */
  function outcome(g) {
    const L = g.spreads?.now.line ?? null;
    const T0 = g.totals?.now.line ?? null;
    const done = !!g.score?.completed;
    const o = { L, T: T0, openL: g.spreads?.open.line ?? null, openT: g.totals?.open.line ?? null, done };
    if (!done) return o;
    const hs = g.score.home;
    const as = g.score.away;
    o.margin = hs - as;
    o.sum = hs + as;
    o.winner = hs > as ? g.home : g.away;
    if (L != null) {
      const v = o.margin + L;                                   // > 0: home covered
      o.ats = v === 0 ? { push: true } : { team: v > 0 ? g.home : g.away, by: Math.abs(v) };
      if (L !== 0 && v !== 0) o.favCovered = (L < 0) === (v > 0);
    }
    if (T0 != null) {
      const d = o.sum - T0;
      o.ou = d === 0 ? { push: true } : { side: d > 0 ? 'Over' : 'Under', by: Math.abs(d) };
    }
    return o;
  }

  function resultCards(games) {
    const rows = games.map((g) => ({ g, o: outcome(g) }));
    const done = rows.filter((r) => r.o.done);
    const fav = done.filter((r) => r.o.favCovered != null);
    const favW = fav.filter((r) => r.o.favCovered).length;
    const ou = done.filter((r) => r.o.ou && !r.o.ou.push);
    const overs = ou.filter((r) => r.o.ou.side === 'Over').length;
    const summary = done.length ? h('div', { class: 'day-sum' },
      h('span', null, h('b', null, `${done.length}`), ` of ${games.length} games final`),
      fav.length ? h('span', null, 'Favourites covered ', h('b', null, `${favW} of ${fav.length}`)) : null,
      ou.length ? h('span', null, 'Overs ', h('b', null, `${overs}`), ' · Unders ', h('b', null, `${ou.length - overs}`)) : null) : null;

    const teamRow = (name, score, win) => h('div', { class: `rc-team${win ? ' win' : ''}` },
      h('span', { class: 'ab' }, ab(name)), h('span', { class: 'nm' }, teamLink(name)), h('span', { class: 'sc' }, score ?? '–'));
    const moved = (open, close, f) => (open != null && close != null && open !== close ? `opened ${f(open)}` : 'no move');

    const cards = rows.map(({ g, o }) => {
      const tip = new Date(g.commence);
      const sc = g.score;
      const spreadRes = !o.done ? h('span', { class: 'chip-r pend' }, 'Result pending')
        : !o.ats ? h('span', { class: 'chip-r pend' }, 'No line')
          : o.ats.push ? h('span', { class: 'chip-r push' }, 'Push (exactly on the line)')
            : h('span', { class: `chip-r ${o.ats.team === g.home ? 'home' : 'away'}` }, `${ab(o.ats.team)} covered by ${num(o.ats.by)}`);
      const totalRes = !o.done ? h('span', { class: 'chip-r pend' }, 'Result pending')
        : !o.ou ? h('span', { class: 'chip-r pend' }, 'No line')
          : o.ou.push ? h('span', { class: 'chip-r push' }, 'Push (exactly on the line)')
            : h('span', { class: `chip-r ${o.ou.side === 'Over' ? 'over' : 'under'}` }, `${o.ou.side} by ${num(o.ou.by)}`);
      return h('article', { class: 'rc', tabindex: '0', onclick: () => openGame(g.id),
        onkeydown: (e) => { if (e.key === 'Enter') openGame(g.id); } },
        h('div', { class: 'rc-head' },
          h('span', null, T.time.format(tip), ' · ', T.day.format(tip)),
          h('span', { class: `pill${o.done ? '' : ' live'}` }, o.done ? 'Final' : (sc ? 'Live' : 'Awaiting score'))),
        h('div', { class: 'rc-score' },
          teamRow(g.away, sc?.away, o.done && o.winner === g.away),
          teamRow(g.home, sc?.home, o.done && o.winner === g.home)),
        h('dl', { class: 'rc-lines' },
          h('div', null,
            h('dt', null, 'Spread'),
            h('dd', null,
              h('span', { class: 'ln' }, o.L == null ? '–' : spreadText(o.L, g)),
              h('small', null, o.L == null ? '' : moved(o.openL, o.L, (x) => spreadText(x, g))),
              h('div', { class: 'res' }, o.done ? h('span', { class: 'calc' }, `${ab(o.winner)} won by ${Math.abs(o.margin)}`) : null, spreadRes))),
          h('div', null,
            h('dt', null, 'Total'),
            h('dd', null,
              h('span', { class: 'ln' }, o.T == null ? '–' : num(o.T)),
              h('small', null, o.T == null ? '' : moved(o.openT, o.T, num)),
              h('div', { class: 'res' }, o.done ? h('span', { class: 'calc' }, `Total scored ${o.sum}`) : null, totalRes)))),
        h('p', { class: 'rc-more' }, 'Tap for price charts and odds history ›'));
    });
    return [
      summary,
      h('div', { class: 'rc-grid' }, cards),
      h('p', { class: 'legend' }, 'Lines are the closing prices of the selected bookmaker (the last price stored before tip-off). ',
        '“Covered by” = how many points the team beat the spread by; “Over/Under by” = points above or below the total line.'),
    ];
  }

  function renderBoard() {
    const view = $('#view');
    view.replaceChildren();
    if (state.error) {
      view.append(h('div', { class: 'empty' }, h('strong', null, 'Could not load data'), state.error));
      return;
    }
    const final = state.scope === 'recent';
    // Upcoming: hide far-off games whose lines bookmakers have taken down (stale prices); keep everything in the next 48 h
    const hasLines = (g) => !!(g.spreads || g.totals);
    const soonish = (g) => Date.parse(g.commence) - Date.now() < 72 * 3600_000;
    const visible = (g) => final || soonish(g) || (hasLines(g) && g.offered !== false);
    const games = state.games.filter(visible);
    const hiddenN = state.games.length - games.length;
    if (final) view.append(dayBar());
    else view.append(h('p', { class: 'hint' }, 'Looking for finished games, final scores or line movement from earlier days? ',
      h('button', { type: 'button', class: 'linkbtn', onclick: () => { state.scope = 'recent'; refresh(); } }, 'Open past games by date')));
    if (!games.length) {
      const s = state.status;
      view.append(h('div', { class: 'empty' },
        h('strong', null, final ? (state.days.length ? 'No games on this day' : 'No games have started yet') : 'No upcoming games with odds yet'),
        s && !s.hasKey && !s.demo
          ? 'Add ODDS_API_KEY and the tracker will start fetching odds automatically.'
          : 'Games appear here as soon as bookmakers post lines. The off-season may have none.'));
      return;
    }

    if (final) { view.append(...resultCards(games)); return; }

    const cols = final ? 14 : 11;
    const thead = h('thead', null,
      h('tr', { class: 'grp' },
        h('th', { rowspan: '2', class: 'sticky game-h', scope: 'col' }, 'Game'),
        h('th', { colspan: '5', class: 'g', scope: 'colgroup' }, 'Spread'),
        h('th', { colspan: '5', class: 'g', scope: 'colgroup' }, 'Total points'),
        final ? h('th', { colspan: '3', class: 'g', scope: 'colgroup' }, 'Result') : null),
      h('tr', null,
        h('th', { class: 'gs' }, 'Open'), h('th', null, final ? 'Close' : 'Now'), h('th', { class: 'mvh' }, 'Move'),
        h('th', { class: 's1', title: 'Odds on the home team at the spread' }, 'Home odds'),
        h('th', { class: 's2', title: 'Odds on the away team at the spread' }, 'Away odds'),
        h('th', { class: 'gs' }, 'Open'), h('th', null, final ? 'Close' : 'Now'), h('th', { class: 'mvh' }, 'Move'),
        h('th', { class: 's1' }, 'Over odds'), h('th', { class: 's2' }, 'Under odds'),
        final ? [h('th', { class: 'gs' }, 'Score'), h('th', null, 'ATS'), h('th', null, 'O/U')] : null));

    const tbody = h('tbody');
    let lastDay = null;
    for (const g of games) {
      const d = new Date(g.commence);
      const key = final ? state.day : T.dayKey.format(d);
      if (key !== lastDay) {
        lastDay = key;
        tbody.append(h('tr', { class: 'day' }, h('th', { colspan: String(cols), scope: 'rowgroup' },
          h('span', null, final ? `Game day ${dayLabel(state.day, true)} (US Eastern)` : T.day.format(d)))));
      }
      const sp = g.spreads;
      const tt = g.totals;
      const v = verdict(g, sp?.now.line, tt?.now.line);
      const soon = Date.parse(g.commence) - Date.now();
      let note = null;
      if (soon > 0 && soon < 24 * 3600_000) note = rel(g.commence);
      else if (soon <= 0 && !g.score?.completed) note = g.score ? 'Live' : (soon < -4 * 3600_000 ? 'Result pending' : 'Started');
      let lineNote = null;
      if (!final && soon > 0 && !hasLines(g)) lineNote = 'Lines not posted yet';
      else if (!final && soon > 0 && g.offered === false) lineNote = `Lines off the board · last seen ${T.stamp.format(new Date(g.lastSeen))}`;
      else if (g.fallback) lineNote = `No ${state.status?.bookmakers?.find((b) => b.key === state.book)?.title ?? 'line'} line yet · market avg`;
      const open = () => openGame(g.id);
      tbody.append(h('tr', { class: 'game', onclick: open },
        h('td', { class: 'sticky game-c' },
          h('button', { type: 'button', class: 'match', title: `${g.away} at ${g.home}`, onclick: (e) => { e.stopPropagation(); open(); } },
            ab(g.away), h('span', { class: 'at' }, ' @ '), ab(g.home)),
          h('span', { class: 'tip' }, T.time.format(d), note ? ` · ${note}` : ''),
          lineNote ? h('span', { class: 'tip wait' }, lineNote) : null),
        td(sp ? spreadText(sp.open.line, g) : null, { cls: 'gs' }),
        td(sp ? spreadText(sp.now.line, g) : null, { cls: 'now', dir: sp ? dirOf(sp.delta) : null }),
        moveCell(sp, g, 'spreads'),
        oddsCell(sp?.now.a, sp?.open.a),
        oddsCell(sp?.now.b, sp?.open.b),
        td(tt ? num(tt.open.line) : null, { cls: 'gs' }),
        td(tt ? num(tt.now.line) : null, { cls: 'now', dir: tt ? dirOf(tt.delta) : null }),
        moveCell(tt, g, 'totals'),
        oddsCell(tt?.now.a, tt?.open.a),
        oddsCell(tt?.now.b, tt?.open.b),
        final ? [
          td(g.score ? `${g.score.away}–${g.score.home}` : null, { cls: 'gs' }),
          td(v?.ats ?? null),
          td(v?.ou ?? null),
        ] : null));
    }

    view.append(
      changeKey(final ? 'between the opening and closing price' : 'between the opening price and now'),
      h('div', { class: 'table-wrap board-wrap' }, h('table', { class: 'board' }, thead, tbody)),
      h('p', { class: 'legend' },
        'Spread is shown from the favourite (BOS -5.5 = Boston gives 5.5 points). ',
        'Spread move: the line shifted toward the team named; ▲/▼ follow the home team\'s handicap number. Total move: change in points. ',
        `Odds are the latest prices in ${FMT_NAME[state.fmt]} format with the opening price underneath. Click a game for its charts and full price history.`,
        hiddenN ? ` ${hiddenN} game${hiddenN === 1 ? '' : 's'} more than 3 days away without current lines ${hiddenN === 1 ? 'is' : 'are'} hidden until bookmakers post them.` : '',
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
      ctx.font = `600 11px ${cssVar('--f-body')}`;
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
          boxWidth: 12, boxHeight: 3,
          titleFont: { weight: '500', size: 11 },
          bodyFont: { weight: '600', size: 12 },
          callbacks: {
            title: (items) => T.stamp.format(new Date(items[0].parsed.x)),
            label,
            labelColor: (c) => ({ borderColor: c.dataset.borderColor, backgroundColor: c.dataset.borderColor }),
          },
        },
      },
    };
  }
  function stepData(points, endX, pick) {
    const out = points.map((p) => ({ x: Date.parse(p.t), y: pick(p) }));
    if (out.length && endX > out[out.length - 1].x) out.push({ x: endX, y: out[out.length - 1].y });
    return out;
  }
  const ds = (label, dataPts, color, wash) => ({
    label, data: dataPts, borderColor: color, backgroundColor: wash || color,
    fill: wash ? 'start' : false,
    borderWidth: 2.5, stepped: 'after', pointRadius: 0, pointHoverRadius: 4,
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

  // movement summary -----------------------------------------------------
  function seriesStats(vals) {
    const open = vals[0];
    const now = vals[vals.length - 1];
    let updates = 0;
    for (let i = 1; i < vals.length; i++) if (vals[i] !== vals[i - 1]) updates++;
    return { open, now, delta: now - open, min: Math.min(...vals), max: Math.max(...vals), updates };
  }
  /** kind: 'spread' (home handicap line) | 'total' (points line) | 'odds' (decimal price) */
  function statRow(label, rowCls, vals, fmt, kind, g) {
    const st = seriesStats(vals);
    const dir = dirOf(st.delta);
    let chg;
    if (!dir) chg = td('—', { cls: 'flat mvc' });
    else if (kind === 'spread') chg = td(num(Math.abs(st.delta)), { cls: 'mvc', dir, arrow: true, sub: `toward ${spreadToward(st.delta, g)}` });
    else if (kind === 'total') chg = td(num(Math.abs(st.delta)), { cls: 'mvc', dir, arrow: true });
    else chg = td(Math.abs(st.delta).toFixed(2), { cls: 'mvc', dir, arrow: true });
    return h('tr', null,
      h('th', { scope: 'row', class: rowCls || null }, label),
      td(fmt(st.open), { cls: 'val' }),
      td(fmt(st.now), { cls: 'val', dir }),
      chg,
      td(fmt(st.min)), td(fmt(st.max)),
      td(String(st.updates)));
  }

  function summaryTable(g, sp, tt, closeLbl) {
    const grp = (t) => h('tr', { class: 'sub' }, h('th', { colspan: '7', scope: 'rowgroup' }, t));
    const none = (t) => h('tr', null, h('td', { colspan: '7', class: 'flat' }, t));
    const rows = [grp('Spread')];
    if (sp.length) {
      rows.push(
        statRow('Handicap line', null, sp.map((p) => p.line), (v) => spreadText(v, g), 'spread', g),
        statRow(`${ab(g.home)} odds`, 'row-s1', sp.map((p) => p.a), fmtOdds, 'odds', g),
        statRow(`${ab(g.away)} odds`, 'row-s2', sp.map((p) => p.b), fmtOdds, 'odds', g));
    } else rows.push(none('No spread prices from this bookmaker yet.'));
    rows.push(grp('Total points'));
    if (tt.length) {
      rows.push(
        statRow('Points line', null, tt.map((p) => p.line), num, 'total', g),
        statRow('Over odds', 'row-s1', tt.map((p) => p.a), fmtOdds, 'odds', g),
        statRow('Under odds', 'row-s2', tt.map((p) => p.b), fmtOdds, 'odds', g));
    } else rows.push(none('No total prices from this bookmaker yet.'));
    return h('div', { class: 'table-wrap narrow' }, h('table', { class: 'summary' },
      h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'Open'), h('th', null, closeLbl), h('th', { class: 'mvh' }, 'Change'),
        h('th', { title: 'Lowest value seen' }, 'Min'), h('th', { title: 'Highest value seen' }, 'Max'), h('th', { title: 'Times this value changed' }, 'Updates'))),
      h('tbody', null, rows)));
  }

  // bookmaker comparison -------------------------------------------------
  function booksTable(g, started) {
    const tb = h('tbody');
    for (const b of g.byBook ?? []) {
      const s = b.spreads;
      const t = b.totals;
      const lastT = [s?.t, t?.t].filter(Boolean).sort().pop();
      const lineC = (m, text, extra) => (m ? td(text, { cls: `now ${extra || ''}`.trim(), dir: dirOf(m.line - m.open.line), title: `Open ${m === s ? spreadText(m.open.line, g) : num(m.open.line)}` }) : td(null, { cls: extra }));
      const oddsC = (m, k) => {
        if (!m) return td(null);
        const dir = dirOf(m[k] - m.open[k]);
        return td(fmtOdds(m[k]), { dir, arrow: true, sub: dir ? `open ${fmtOdds(m.open[k])}` : null });
      };
      tb.append(h('tr', { class: b.key === state.book ? 'sel' : null },
        h('th', { scope: 'row' }, b.title),
        lineC(s, s ? spreadText(s.line, g) : null), oddsC(s, 'a'), oddsC(s, 'b'),
        lineC(t, t ? num(t.line) : null, 'gs'), oddsC(t, 'a'), oddsC(t, 'b'),
        td(lastT ? T.stamp.format(new Date(lastT)) : null, { cls: 'muted gs' })));
    }
    return h('div', { class: 'table-wrap' }, h('table', { class: 'books' },
      h('thead', null, h('tr', null, h('th', null, 'Bookmaker'), h('th', null, 'Spread'),
        h('th', { class: 's1' }, `${ab(g.home)} odds`), h('th', { class: 's2' }, `${ab(g.away)} odds`),
        h('th', { class: 'gs' }, 'Total'), h('th', { class: 's1' }, 'Over odds'), h('th', { class: 's2' }, 'Under odds'),
        h('th', { class: 'gs' }, 'Last change'))),
      tb));
  }

  // ---------- team form: record against the closing lines ----------
  /** One row per finished game of `team` before `before`, newest first, with the result against that game's closing line. */
  function teamGames(team, before) {
    const out = [];
    for (const r of state.results?.games ?? []) {
      if (r.t >= before || (r.h !== team && r.a !== team)) continue;
      const c = r.c[state.book] ?? r.c[CONSENSUS];
      const home = r.h === team;
      let ats = null;
      let ou = null;
      if (c?.[0] != null) {
        const v = (r.hs - r.as) + c[0];                       // > 0: home team covered
        const tv = home ? v : -v;
        ats = tv > 0 ? 'W' : tv < 0 ? 'L' : 'P';
      }
      if (c?.[1] != null) {
        const sum = r.hs + r.as;
        ou = sum > c[1] ? 'O' : sum < c[1] ? 'U' : 'P';
      }
      out.push({ home, ats, ou });
    }
    return out.reverse();
  }
  const tally = (rows, key, a, b) => {
    let x = 0; let y = 0; let p = 0; let n = 0;
    for (const r of rows) {
      const v = r[key];
      if (!v) continue;
      n++;
      if (v === a) x++; else if (v === b) y++; else p++;
    }
    return { x, y, p, n };
  };
  const rec = (t) => (t.n ? `${t.x}-${t.y}${t.p ? `-${t.p}` : ''}` : null);
  /** % cell, tinted green when above 50% and red when below (needs at least 3 games). */
  const pctCell = (t, tint = true) => {
    if (!t.n) return td(null);
    const pct = Math.round((t.x / (t.x + t.y || 1)) * 100);
    return td(t.x + t.y ? `${pct}%` : null, { dir: tint && t.n >= 3 && t.x + t.y ? (pct > 50 ? 'up' : pct < 50 ? 'down' : null) : null });
  };
  const strip = (rows, key, a, b, cls) => h('span', { class: 'strip' }, rows.slice(0, 10).map((r) => {
    const v = r[key];
    return h('i', { class: v === a ? cls[0] : v === b ? cls[1] : 'p', title: v === a ? a : v === b ? b : 'Push' }, v ?? '·');
  }));

  function formSection(g, tip) {
    const res = state.results;
    const first = res?.first ? T.day.format(new Date(res.first)) : null;
    const rowsFor = (team, home) => {
      const all = teamGames(team, g.commence);
      const venue = all.filter((r) => r.home === home);
      return { all, sets: [['Last 10', all.slice(0, 10)], ['Last 20', all.slice(0, 20)], ['Season', all],
        [home ? 'Season at home' : 'Season on the road', venue]] };
    };
    const block = (team, home) => {
      const { all, sets } = rowsFor(team, home);
      const body = sets.map(([label, rows]) => {
        const a = tally(rows, 'ats', 'W', 'L');
        const o = tally(rows, 'ou', 'O', 'U');
        const short = label.startsWith('Last') && rows.length < Number(label.slice(5));
        return h('tr', null,
          h('th', { scope: 'row' }, label),
          td(rows.length ? (short ? `${rows.length} (all)` : String(rows.length)) : '0', { cls: 'muted' }),
          td(rec(a), { cls: 'gs' }), pctCell(a),
          td(rec(o), { cls: 'gs' }), pctCell(o, false));
      });
      return h('div', { class: 'form-team' },
        h('h4', null, teamLink(team), h('small', null, home ? 'Home' : 'Away')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'form' },
          h('thead', null,
            h('tr', { class: 'grp' }, h('th', { rowspan: '2' }, 'Period'), h('th', { rowspan: '2' }, 'Games'),
              h('th', { colspan: '2', class: 'g' }, 'Against the spread'), h('th', { colspan: '2', class: 'g' }, 'Over / Under')),
            h('tr', null, h('th', { class: 'gs' }, 'W-L-P'), h('th', null, 'Cover %'), h('th', { class: 'gs' }, 'O-U-P'), h('th', null, 'Over %'))),
          h('tbody', null, body))),
        all.length ? h('p', { class: 'strips' },
          h('span', null, 'Last 10, newest first'),
          h('span', null, 'ATS ', strip(all, 'ats', 'W', 'L', ['w', 'l'])),
          h('span', null, 'O/U ', strip(all, 'ou', 'O', 'U', ['o', 'u']))) : null);
    };
    const note = !res || !res.games.length
      ? 'No finished games with closing lines are stored yet, so there are no records to show.'
      : `Counts only games this tracker stored (since ${first}), so early-season samples are small; “(all)” means fewer games than the period asks for.`;
    return h('section', { class: 'block' },
      h('h3', null, Date.now() >= tip ? 'Team form going into this game' : 'Team form'),
      h('p', { class: 'legend' },
        'Each team’s results against the closing line of the selected bookmaker. ',
        'ATS: W = the team covered the spread, L = it did not, P = push. O/U: O = total points went over the line, U = under. ',
        note),
      h('div', { class: 'form-grid' }, block(g.away, false), block(g.home, true)));
  }

  // ---------- teams ----------
  /** Clickable team name that opens the team page. */
  function teamLink(name, label = name) {
    return h('button', { type: 'button', class: 'teamlink', title: `${name}: season stats`,
      onclick: (e) => { e.stopPropagation(); openTeam(name); } }, label);
  }
  const signedN = (v) => (v > 0 ? `+${num(v)}` : v < 0 ? `−${num(-v)}` : '0');
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const oneDec = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));

  /** Every finished game of a team, oldest first, from the team's point of view. */
  function teamLog(team) {
    const out = [];
    for (const r of state.results?.games ?? []) {
      if (r.h !== team && r.a !== team) continue;
      const c = r.c[state.book] ?? r.c[CONSENSUS] ?? [];
      const home = r.h === team;
      const pf = home ? r.hs : r.as;
      const pa = home ? r.as : r.hs;
      const flip = (v) => (v == null ? null : home ? v : -v);
      const line = flip(c[0]);                    // the team's own handicap, e.g. -6.5 = gave 6.5
      const open = flip(c[2]);
      const cover = line == null ? null : pf - pa + line;
      const sum = pf + pa;
      const ouBy = c[1] == null ? null : sum - c[1];
      out.push({
        id: r.id, t: r.t, home, opp: home ? r.a : r.h, pf, pa, won: pf > pa,
        line, open, cover, ats: cover == null ? null : cover > 0 ? 'W' : cover < 0 ? 'L' : 'P',
        total: c[1], totalOpen: c[3], sum, ouBy, ou: ouBy == null ? null : ouBy > 0 ? 'O' : ouBy < 0 ? 'U' : 'P',
        g: { home: r.h, away: r.a },
      });
    }
    return out;
  }
  function splitRow(label, rows) {
    const a = tally(rows, 'ats', 'W', 'L');
    const o = tally(rows, 'ou', 'O', 'U');
    const w = rows.filter((r) => r.won).length;
    const pct = (t) => (t.x + t.y ? `${Math.round((t.x / (t.x + t.y)) * 100)}%` : null);
    const tint = (t) => (t.n >= 3 && t.x + t.y ? (t.x > t.y ? 'up' : t.x < t.y ? 'down' : null) : null);
    return h('tr', null,
      h('th', { scope: 'row' }, label, h('small', null, `${rows.length} game${rows.length === 1 ? '' : 's'}`)),
      td(rows.length ? `${w}-${rows.length - w}` : null, { cls: 'gs' }),
      td(rec(a), { cls: 'gs', dir: tint(a), sub: pct(a) }),
      td(rec(o), { cls: 'gs', sub: o.x + o.y ? `${pct(o)} over` : null }),
      td(rows.length ? `${oneDec(avg(rows.map((r) => r.pf)))}–${oneDec(avg(rows.map((r) => r.pa)))}` : null, { cls: 'gs' }));
  }

  function renderTeams() {
    const view = $('#view');
    view.replaceChildren();
    if (state.error) { view.append(h('div', { class: 'empty' }, h('strong', null, 'Could not load data'), state.error)); return; }
    const names = new Set();
    for (const r of state.results?.games ?? []) { names.add(r.h); names.add(r.a); }
    for (const g of state.upcoming ?? []) { names.add(g.home); names.add(g.away); }
    const teams = [...names].sort();
    if (!teams.length) { view.append(h('div', { class: 'empty' }, h('strong', null, 'No teams yet'), 'Teams appear once games have odds.')); return; }
    const tb = h('tbody');
    for (const t of teams) {
      const rows = teamLog(t);
      const a = tally(rows, 'ats', 'W', 'L');
      const o = tally(rows, 'ou', 'O', 'U');
      const w = rows.filter((r) => r.won).length;
      tb.append(h('tr', { class: 'game', onclick: () => openTeam(t) },
        h('th', { scope: 'row', class: 'sticky' }, h('span', { class: 'tab-ab' }, ab(t)), teamLink(t)),
        td(String(rows.length), { cls: 'muted' }),
        td(rows.length ? `${w}-${rows.length - w}` : null, { cls: 'gs' }),
        td(rec(a), { cls: 'gs' }),
        td(rec(o), { cls: 'gs' })));
    }
    view.append(
      h('p', { class: 'hint' }, 'Tap a team for its games, home and road splits, line movement and results against the spread.'),
      h('div', { class: 'table-wrap narrow' }, h('table', { class: 'teams' },
        h('thead', null, h('tr', null, h('th', { class: 'sticky' }, 'Team'), h('th', null, 'Games'), h('th', { class: 'gs' }, 'Won-Lost'),
          h('th', { class: 'gs', title: 'Against the spread: covered-failed-push' }, 'Spread W-L-P'), h('th', { class: 'gs', title: 'Over-Under-Push' }, 'Total O-U-P'))),
        tb)),
      h('p', { class: 'legend' }, `Records count games stored by this tracker (since ${state.results?.first ? T.day.format(new Date(state.results.first)) : '–'}) against the closing line of the selected bookmaker.`));
  }

  function renderTeam() {
    const view = $('#view');
    view.replaceChildren();
    const team = state.team;
    const back = h('button', { type: 'button', class: 'back', onclick: closeTeam }, '← Back');
    if (state.error) { view.append(h('div', { class: 'sheet' }, back, h('div', { class: 'empty' }, h('strong', null, 'Could not load data'), state.error))); return; }
    const log = teamLog(team);
    const rows = [...log].reverse();                               // newest first
    const w = log.filter((r) => r.won).length;
    const a = tally(log, 'ats', 'W', 'L');
    const o = tally(log, 'ou', 'O', 'U');
    const tile = (big, label, sub) => h('div', { class: 'tile' }, h('b', null, big), h('span', null, label), sub ? h('small', null, sub) : null);
    const bookTitle = state.book === CONSENSUS ? 'market consensus'
      : (state.status?.bookmakers?.find((b) => b.key === state.book)?.title ?? state.book);

    const head = h('header', { class: 'sheet-head' },
      h('h2', null, ab(team)), h('p', { class: 'teams' }, team),
      h('p', { class: 'teams' }, `Lines from ${bookTitle} · games stored since ${state.results?.first ? T.day.format(new Date(state.results.first)) : '–'}`));

    const tiles = h('div', { class: 'tiles' },
      tile(String(log.length), 'Games played', `${log.filter((r) => r.home).length} home · ${log.filter((r) => !r.home).length} road`),
      tile(log.length ? `${w}-${log.length - w}` : '–', 'Won-Lost'),
      tile(a.n ? `${a.x}-${a.y}${a.p ? `-${a.p}` : ''}` : '–', 'Against the spread', a.n ? `covered ${a.x} of ${a.n}` : null),
      tile(o.n ? `${o.x}-${o.y}${o.p ? `-${o.p}` : ''}` : '–', 'Over-Under', o.n ? `${o.x} over, ${o.y} under` : null),
      tile(log.length ? `${oneDec(avg(log.map((r) => r.pf)))}` : '–', 'Points scored / game', log.length ? `allowed ${oneDec(avg(log.map((r) => r.pa)))}` : null),
      tile(a.n ? signedN(Math.round(avg(log.filter((r) => r.cover != null).map((r) => r.cover)) * 10) / 10) : '–', 'Avg vs the spread',
        'points beyond the line per game'));

    const splits = h('section', { class: 'block' },
      h('h3', null, 'Splits'),
      h('div', { class: 'table-wrap narrow' }, h('table', { class: 'splits' },
        h('thead', null, h('tr', null, h('th', null, ''), h('th', { class: 'gs' }, 'W-L'),
          h('th', { class: 'gs', title: 'Against the spread: covered-missed-push' }, 'Spread'), h('th', { class: 'gs', title: 'Over-Under-Push' }, 'Total'), h('th', { class: 'gs' }, 'Avg score'))),
        h('tbody', null,
          splitRow('All games', log),
          splitRow('Last 10', rows.slice(0, 10)),
          splitRow('Last 20', rows.slice(0, 20)),
          splitRow('Home', log.filter((r) => r.home)),
          splitRow('Road', log.filter((r) => !r.home)),
          splitRow('As favourite', log.filter((r) => r.line != null && r.line < 0)),
          splitRow('As underdog', log.filter((r) => r.line != null && r.line > 0))))),
      h('p', { class: 'legend' }, 'W-L: games won and lost. Spread: covered / missed / push (green when covering more often, red when less, from 3 games). Total: over / under / push. Avg score = points for – points against.'));

    // game log, newest first
    const tag = (cls, text) => h('span', { class: `chip-r ${cls}` }, text);
    const logList = h('div', { class: 'log' }, rows.map((r) => {
      const d = new Date(r.t);
      const lineTxt = r.line == null ? '–' : r.line === 0 ? 'PK' : signedN(r.line);
      const moved = r.open != null && r.line != null && r.open !== r.line
        ? `opened ${r.open === 0 ? 'PK' : signedN(r.open)} · ${r.line < r.open ? `market moved toward ${ab(team)}` : `market moved against ${ab(team)}`}`
        : 'line did not move';
      const totMoved = r.totalOpen != null && r.total != null && r.totalOpen !== r.total ? `opened ${num(r.totalOpen)}` : 'did not move';
      return h('article', { class: 'log-row', tabindex: '0', onclick: () => openGame(r.id), onkeydown: (e) => { if (e.key === 'Enter') openGame(r.id); } },
        h('div', { class: 'log-top' },
          h('span', { class: 'when' }, T.day.format(d)),
          h('span', { class: 'vs' }, r.home ? 'vs ' : '@ ', teamLink(r.opp, ab(r.opp)), h('small', null, r.home ? ' home' : ' road')),
          h('span', { class: `wl ${r.won ? 'w' : 'l'}` }, `${r.won ? 'W' : 'L'} ${r.pf}–${r.pa}`)),
        h('dl', { class: 'rc-lines' },
          h('div', null, h('dt', null, 'Spread'), h('dd', null,
            h('span', { class: 'ln' }, `${ab(team)} ${lineTxt}`), h('small', null, r.line == null ? '' : moved),
            h('div', { class: 'res' },
              h('span', { class: 'calc' }, r.pf === r.pa ? 'Tied' : `${r.won ? 'Won' : 'Lost'} by ${Math.abs(r.pf - r.pa)}`),
              r.ats == null ? tag('pend', 'No line') : r.ats === 'P' ? tag('push', 'Push')
                : tag(r.ats === 'W' ? 'cov' : 'miss', r.ats === 'W' ? `Covered by ${num(r.cover)}` : `Missed by ${num(-r.cover)}`)))),
          h('div', null, h('dt', null, 'Total'), h('dd', null,
            h('span', { class: 'ln' }, r.total == null ? '–' : num(r.total)), h('small', null, r.total == null ? '' : totMoved),
            h('div', { class: 'res' },
              h('span', { class: 'calc' }, `Total scored ${r.sum}`),
              r.ou == null ? tag('pend', 'No line') : r.ou === 'P' ? tag('push', 'Push')
                : tag(r.ou === 'O' ? 'over' : 'under', `${r.ou === 'O' ? 'Over' : 'Under'} by ${num(Math.abs(r.ouBy))}`))))));
    }));

    const next = (state.upcoming ?? []).filter((g) => g.home === team || g.away === team).slice(0, 3);
    const upcoming = next.length ? h('section', { class: 'block' },
      h('h3', null, 'Next games'),
      h('div', { class: 'log' }, next.map((g) => {
        const home = g.home === team;
        const d = new Date(g.commence);
        return h('article', { class: 'log-row', tabindex: '0', onclick: () => openGame(g.id) },
          h('div', { class: 'log-top' },
            h('span', { class: 'when' }, `${T.day.format(d)}, ${T.time.format(d)}`),
            h('span', { class: 'vs' }, home ? 'vs ' : '@ ', teamLink(home ? g.away : g.home, ab(home ? g.away : g.home)), h('small', null, home ? ' home' : ' road')),
            h('span', { class: 'wl' }, rel(g.commence))),
          h('p', { class: 'next-lines' },
            !g.spreads && !g.totals ? h('small', null, 'No line posted yet by this bookmaker') : null,
            g.spreads ? `Spread ${spreadText(g.spreads.now.line, g)}` : null,
            g.spreads && g.spreads.delta ? h('small', null, ` (opened ${spreadText(g.spreads.open.line, g)})`) : null,
            g.totals ? `${g.spreads ? ' · ' : ''}Total ${num(g.totals.now.line)}` : null,
            g.totals && g.totals.delta ? h('small', null, ` (opened ${num(g.totals.open.line)})`) : null));
      }))) : null;

    view.append(h('div', { class: 'sheet' }, back, head, tiles, upcoming, splits,
      h('section', { class: 'block' },
        h('h3', null, `Game log (${rows.length})`),
        h('p', { class: 'legend' }, `Newest first. Spread is ${ab(team)}'s own handicap at the close (−6.5 = gave 6.5 points). Tap a game for its price charts.`),
        rows.length ? logList : h('div', { class: 'empty' }, h('strong', null, 'No finished games stored yet')))));
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
    const bookTitle = state.book === CONSENSUS || g.fallback ? 'Market consensus (median of all bookmakers)'
      : (g.books.find((b) => b.key === state.book)?.title ?? state.book);
    const selTitle = state.status?.bookmakers?.find((b) => b.key === state.book)?.title ?? state.book;

    // header
    const head = h('header', { class: 'sheet-head' },
      h('h2', null, ab(g.away), h('span', { class: 'at' }, ' @ '), ab(g.home)),
      h('p', { class: 'teams' }, teamLink(g.away), ' at ', teamLink(g.home)),
      h('p', { class: 'tip' },
        h('span', null, `${T.day.format(new Date(tip))}, ${T.time.format(new Date(tip))}`),
        started ? h('span', { class: 'pill' }, g.score?.completed ? 'Final' : 'Started')
          : h('span', { class: 'pill live' }, `Tip-off ${rel(g.commence)}`)),
      v ? h('p', { class: 'result' }, h('b', null, v.score), [v.ats, v.ou].filter(Boolean).map((x) => ` · ${x}`).join('')) : null,
      h('p', { class: 'teams' }, `Prices from ${bookTitle}`),
      g.fallback ? h('p', { class: 'tip wait' }, `${selTitle} has not posted this game yet, so the market average of the other bookmakers is shown.`) : null);

    // movement summary: lines AND odds, open vs now
    const summary = h('section', { class: 'block' },
      h('h3', null, 'Movement summary'),
      changeKey('between the opening price and now'),
      summaryTable(g, sp, tt, started ? 'Close' : 'Now'),
      h('p', { class: 'legend' }, 'Spread handicap: ▲/▼ follow the home team\'s handicap number (▼ = the line moved toward the home team). Odds changes are measured in decimal / Hong Kong points. Min, Max and Updates count every stored snapshot.'));

    // charts
    const oddsLbl = chartFmt() === 'hk' ? 'Hong Kong' : 'Decimal';
    const c1 = chartCard('Spread line (home handicap)', [], 'tall');
    const c2 = chartCard(`Spread odds (${oddsLbl})`, [[ab(g.home), '--s1'], [ab(g.away), '--s2']], 'short');
    const c3 = chartCard('Total points line', [], 'tall');
    const c4 = chartCard(`Total odds (${oddsLbl})`, [['Over', '--s1'], ['Under', '--s2']], 'short');
    const charts = h('section', { class: 'block' },
      h('h3', null, 'Charts'),
      h('p', { class: 'legend' }, 'Spread charts plot the home team\'s handicap (below 0 = home favoured). The dashed line marks tip-off. Hover or tap a chart to read exact values.'),
      h('div', { class: 'chart-grid' }, c1.card, c2.card, c3.card, c4.card));

    // bookmakers
    const books = (g.byBook ?? []).length ? h('section', { class: 'block' },
      h('h3', null, started ? 'Closing line by bookmaker' : 'Current line by bookmaker'),
      h('p', { class: 'legend' }, 'Coloured cells moved since that bookmaker first posted the line.'),
      booksTable(g, started)) : null;

    // history: every colour compares a row with the one below it (the previous snapshot)
    const hist = mergeHistory(sp, tt);
    const LIMIT = 40;
    const tbh = h('tbody');
    const shown = state.showAll ? hist.length : Math.min(LIMIT, hist.length);
    const cmp = (cur, prev, key) => (cur && prev ? dirOf(cur[key] - prev[key]) : null);
    for (let k = hist.length - 1; k >= hist.length - shown; k--) {
      const r = hist[k];
      const p = k > 0 ? hist[k - 1] : null;
      tbh.append(h('tr', null,
        h('td', { class: 'muted' }, T.stamp.format(new Date(r.t))),
        td(r.s ? spreadText(r.s.line, g) : null, { cls: 'now', dir: cmp(r.s, p?.s, 'line'), arrow: true }),
        td(r.s ? fmtOdds(r.s.a) : null, { dir: cmp(r.s, p?.s, 'a'), arrow: true }),
        td(r.s ? fmtOdds(r.s.b) : null, { dir: cmp(r.s, p?.s, 'b'), arrow: true }),
        td(r.tt ? num(r.tt.line) : null, { cls: 'now gs', dir: cmp(r.tt, p?.tt, 'line'), arrow: true }),
        td(r.tt ? fmtOdds(r.tt.a) : null, { dir: cmp(r.tt, p?.tt, 'a'), arrow: true }),
        td(r.tt ? fmtOdds(r.tt.b) : null, { dir: cmp(r.tt, p?.tt, 'b'), arrow: true })));
    }
    const history = h('section', { class: 'block' },
      h('h3', null, 'Price history'),
      changeKey('versus the previous snapshot'),
      h('p', { class: 'legend' }, `Newest first. Every odds or line change is stored, so no movement is lost. Odds in ${FMT_NAME[state.fmt]} format.`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'history' },
        h('thead', null,
          h('tr', { class: 'grp' }, h('th', { rowspan: '2' }, 'Time'), h('th', { colspan: '3', class: 'g' }, 'Spread'), h('th', { colspan: '3', class: 'g' }, 'Total points')),
          h('tr', null, h('th', null, 'Line'), h('th', { class: 's1' }, `${ab(g.home)} odds`), h('th', { class: 's2' }, `${ab(g.away)} odds`),
            h('th', { class: 'gs' }, 'Line'), h('th', { class: 's1' }, 'Over odds'), h('th', { class: 's2' }, 'Under odds'))),
        tbh)),
      hist.length > LIMIT ? h('button', { type: 'button', class: 'more', onclick: () => { state.showAll = !state.showAll; renderSheet(); } },
        state.showAll ? 'Show latest 40 only' : `Show all ${hist.length} rows`) : null);

    view.append(h('div', { class: 'sheet' }, back, head, summary, formSection(g, tip), charts, books, history));

    if (!window.Chart) {
      charts.replaceChildren(h('h3', null, 'Charts'), h('p', { class: 'muted' }, 'The chart library did not load. All values are in the tables.'));
    } else {
      const draw = (pts, lineCard, oddsCard, kind) => {
        if (!pts.length) { lineCard.card.remove(); oddsCard.card.remove(); return; }
        const x0 = Date.parse(pts[0].t);
        const endX = Math.max(Math.min(Date.now(), tip), Date.parse(pts[pts.length - 1].t));
        const f2 = (x) => x.toFixed(2);
        const spread = kind === 'spread';
        state.charts.push(new window.Chart(lineCard.canvas, {
          type: 'line',
          data: { datasets: [ds('Line', stepData(pts, endX, (p) => p.line), cssVar('--s1'), cssVar('--s1-wash'))] },
          options: chartOptions(x0, endX, tip, (x) => (spread ? signed(x) : num(x)),
            (c) => ` ${spread ? spreadText(c.parsed.y, g) : num(c.parsed.y)}`),
          plugins: [crosshair, tipLine],
        }));
        const [na, nb] = spread ? [ab(g.home), ab(g.away)] : ['Over', 'Under'];
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

  // ---------- navigation ----------
  function render() {
    renderStatus();
    renderFilters();
    if (state.gameId) renderSheet();
    else {
      destroyCharts();
      if (state.team) renderTeam();
      else if (state.scope === 'teams') renderTeams();
      else renderBoard();
    }
  }

  async function refresh() {
    try {
      state.status = await data.status();
      const books = new Set([CONSENSUS, ...(state.status.bookmakers ?? []).map((b) => b.key)]);
      if (!state.book) state.book = store.get('book', null) || state.status.defaultBook || CONSENSUS;
      if (!books.has(state.book)) state.book = CONSENSUS;
      if (state.gameId) {
        [state.detail, state.results] = await Promise.all([data.game(state.gameId, state.book), data.results().catch(() => null)]);
      } else if (state.team || state.scope === 'teams') {
        [state.results, state.upcoming] = await Promise.all([data.results(), data.games('upcoming', state.book).catch(() => [])]);
      } else if (state.scope === 'recent') {
        state.days = await data.days();
        if (!state.days.some((x) => x.d === state.day)) state.day = state.days[0]?.d ?? null;
        state.games = state.day ? await data.games('recent', state.book, state.day) : [];
      } else {
        state.games = await data.games('upcoming', state.book);
      }
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
    setHash(state.team ? `team-${encodeURIComponent(state.team)}` : '');
    refresh().then(() => window.scrollTo({ top: 0 }));
  }
  function openTeam(name) {
    state.team = name;
    state.gameId = null;
    state.detail = null;
    setHash(`team-${encodeURIComponent(name)}`);
    refresh().then(() => window.scrollTo({ top: 0 }));
  }
  function closeTeam() {
    state.team = null;
    setHash('');
    refresh().then(() => window.scrollTo({ top: 0 }));
  }
  function setHash(hh) {
    if (STATIC) return;
    if (hh) { if (location.hash !== `#${hh}`) location.hash = hh; } else if (location.hash) history.pushState('', document.title, location.pathname + location.search);
  }
  /** Reads #game-<id> / #team-<name> into state; returns true when something changed. */
  function route() {
    const g = location.hash.match(/^#game-(.+)$/);
    const t = location.hash.match(/^#team-(.+)$/);
    const gameId = g ? decodeURIComponent(g[1]) : null;
    const team = t ? decodeURIComponent(t[1]) : (g ? state.team : null);
    const changed = gameId !== state.gameId || team !== state.team;
    state.gameId = gameId;
    state.team = team;
    return changed;
  }

  // ---------- start ----------
  for (const b of document.querySelectorAll('#scopeTabs button')) {
    b.addEventListener('click', () => { state.scope = b.dataset.scope; refresh(); });
  }
  $('#bookSelect').addEventListener('change', (e) => { state.book = e.target.value; store.set('book', state.book); refresh(); });
  $('#fmtSelect').addEventListener('change', (e) => { state.fmt = e.target.value; store.set('fmt', state.fmt); render(); });
  $('#pollGo').addEventListener('click', pollNow);
  $('#ghSave').addEventListener('click', () => {
    const t = $('#ghToken').value.trim();
    if (!t) { $('#ghToken').focus(); return; }
    store.set('ghToken', t);
    $('#ghToken').value = '';
    ghRefresh();
  });
  $('#ghToken').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ghSave').click(); });
  $('#ghForget').addEventListener('click', () => { store.set('ghToken', ''); ghShow('Token removed from this device.'); });
  $('#ghClose').addEventListener('click', () => { $('#ghForm').hidden = true; });
  $('#ghOpen').addEventListener('click', () => ghWait('Waiting for the update job you started on GitHub — this page refreshes by itself when the new prices land (usually 1–2 minutes after you press Run workflow).'));
  $('#ghWantToken').addEventListener('click', () => { ghShow('Save a GitHub token once on this device and the button will start the update by itself.', { setup: true }); $('#ghToken').focus(); });
  $('#tokenInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') pollNow(); });

  if (!STATIC) {
    window.addEventListener('hashchange', () => { if (route()) refresh(); });
    route();
    setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60_000);
  }

  if (window.Chart) window.Chart.defaults.font.family = cssVar('--f-body') || 'system-ui, sans-serif';
  refresh();
})();
