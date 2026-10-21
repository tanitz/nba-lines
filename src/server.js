import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { openDb, lastPoll, lastCredits } from './db.js';
import { createPoller } from './poller.js';
import { listGames, gameDetail, listBookmakers, CONSENSUS } from './series.js';
import { seedDemo } from './demo.js';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };

let dbPath = config.dbPath;
if (config.demo) {
  dbPath = path.join(path.dirname(config.dbPath), 'demo.db');
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) fs.rmSync(f, { force: true });
}
const db = openDb(dbPath);
if (config.demo) seedDemo(db);

const poller = createPoller(db, config);
if (!config.demo) poller.start();

function send(res, status, body, headers = {}) {
  const isObj = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, {
    'content-type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(isObj ? JSON.stringify(body) : body);
}

function status() {
  const odds = lastPoll(db, 'odds');
  const ok = lastPoll(db, 'odds', true);
  const credits = lastCredits(db);
  return {
    demo: config.demo,
    hasKey: !!config.apiKey,
    defaultBook: config.defaultBook || CONSENSUS,
    canPoll: !!config.adminToken && !config.demo,
    lastAttempt: odds && { at: odds.at, ok: !!odds.ok, error: odds.error },
    lastSuccess: ok && { at: ok.at, games: ok.games, changes: ok.changes },
    credits: credits && { remaining: credits.credits_remaining, used: credits.credits_used, at: credits.at },
    nextPollAt: config.demo || !config.apiKey ? null : poller.forecastNextOddsAt().toISOString(),
    intervalMin: config.demo ? null : poller.intervalMinutes(),
    bookmakers: listBookmakers(db),
  };
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const book = url.searchParams.get('book') || CONSENSUS;
  try {
    if (req.method === 'GET' && p === '/api/status') return send(res, 200, status());
    if (req.method === 'GET' && p === '/api/games') {
      return send(res, 200, listGames(db, { scope: url.searchParams.get('scope') || 'upcoming', book }));
    }
    const m = p.match(/^\/api\/games\/([^/]+)$/);
    if (req.method === 'GET' && m) {
      const g = gameDetail(db, decodeURIComponent(m[1]), book);
      return g ? send(res, 200, g) : send(res, 404, { error: 'Game not found' });
    }
    if (req.method === 'POST' && p === '/api/poll') {
      if (!config.adminToken || req.headers['x-admin-token'] !== config.adminToken) {
        return send(res, 403, { error: 'Wrong admin token' });
      }
      if (config.demo) return send(res, 400, { error: 'Demo mode does not fetch real odds' });
      return send(res, 200, await poller.pollOdds());
    }
    if (req.method === 'GET' && !p.startsWith('/api/')) return serveStatic(req, res, p);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

server.listen(config.port, () => {
  console.log(`เปิดเว็บที่ http://localhost:${config.port}${config.demo ? '  (โหมดข้อมูลตัวอย่าง)' : ''}`);
});
