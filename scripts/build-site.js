/**
 * สร้างเว็บไซต์แบบไฟล์นิ่ง (เช่น สำหรับ GitHub Pages) จากฐานข้อมูล
 *   node scripts/build-site.js [--demo] [outDir]
 * ได้ไฟล์: index.html, app.js, style.css, data/index.json, data/results.json, data/d/<วัน>.json, data/g/<gameId>.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, ROOT } from '../src/config.js';
import { openDb } from '../src/db.js';
import { buildPayload } from '../src/payload.js';
import { seedDemo } from '../src/demo.js';

const safeId = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '_');

export function buildSite(db, outDir, opts = {}) {
  const { status, games, days, byDay, results, details } = buildPayload(db, config, opts);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, 'data', 'g'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'data', 'd'), { recursive: true });

  const pub = (f) => path.join(ROOT, 'public', f);
  const html = fs.readFileSync(pub('index.html'), 'utf8')
    .replace('<script src="app.js"></script>',
      `<script>window.STATIC_BASE = "data/"; window.SITE_REPO = ${JSON.stringify(process.env.GITHUB_REPOSITORY || '')};</script>\n<script src="app.js?v=${Date.now()}"></script>`)
    .replace('href="style.css"', `href="style.css?v=${Date.now()}"`);
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  fs.copyFileSync(pub('app.js'), path.join(outDir, 'app.js'));
  fs.copyFileSync(pub('style.css'), path.join(outDir, 'style.css'));
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

  fs.writeFileSync(path.join(outDir, 'data', 'index.json'), JSON.stringify({ status, games, days }));
  fs.writeFileSync(path.join(outDir, 'data', 'results.json'), JSON.stringify(results));
  for (const [d, byBook] of Object.entries(byDay)) {
    fs.writeFileSync(path.join(outDir, 'data', 'd', `${d}.json`), JSON.stringify(byBook));
  }
  for (const [id, byBook] of Object.entries(details)) {
    fs.writeFileSync(path.join(outDir, 'data', 'g', `${safeId(id)}.json`), JSON.stringify(byBook));
  }
  return { games: Object.keys(details).length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const demo = args.includes('--demo');
  const out = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'site'));
  const db = demo ? openDb(':memory:') : openDb(config.dbPath);
  if (demo) seedDemo(db);
  const r = buildSite(db, out, { demo });
  console.log(`สร้างเว็บที่ ${out} (${r.games} แมตช์)`);
}
