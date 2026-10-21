/**
 * สร้างหน้าเว็บไฟล์เดียว (ไม่ต้องมีเซิร์ฟเวอร์) จากฐานข้อมูล
 *   node scripts/export-static.js [--demo] [--fragment] [out.html]
 * --demo      ใช้ข้อมูลตัวอย่างแบบสุ่มแทนฐานข้อมูลจริง
 * --fragment  ไม่ใส่ <html><head><body> (สำหรับระบบที่ห่อหน้าเว็บให้เอง)
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { openDb } from '../src/db.js';
import { buildPayload } from '../src/payload.js';
import { seedDemo } from '../src/demo.js';

const args = process.argv.slice(2);
const demo = args.includes('--demo');
const fragment = args.includes('--fragment');
const out = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'dist', 'index.html');

const db = demo ? openDb(':memory:') : openDb(config.dbPath);
if (demo) seedDemo(db);
const { status, games, details } = buildPayload(db, config, { demo });

const read = (f) => fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
const html = read('index.html');
const body = html.split('<!--APP-START-->')[1].split('<!--APP-END-->')[0];
const css = read('style.css');
const js = read('app.js');
const json = JSON.stringify({ status, games, details }).replace(/</g, '\\u003c');
const fonts = 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap';

const inner = `<title>NBA Line Tracker</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${fonts}">
<style>
${css}
</style>
${body}
<script>window.STATIC_DATA = ${json};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script>
${js}
</script>
`;
const page = fragment ? inner : `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
</head><body>
${inner}</body></html>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`เขียน ${out} (${(page.length / 1024).toFixed(0)} KB)`);
