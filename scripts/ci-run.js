/**
 * รันหนึ่งรอบสำหรับตัวตั้งเวลาภายนอก (GitHub Actions ทุก ~5 นาที)
 * 1) ดึงราคาเฉพาะเมื่อถึงรอบตามตาราง  2) สร้างเว็บไฟล์นิ่งลงโฟลเดอร์ site/
 * เขียน changed=true|false ลง $GITHUB_OUTPUT เพื่อบอกว่าต้องอัปเดตเว็บหรือไม่
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { openDb, lastCredits } from '../src/db.js';
import { createPoller } from '../src/poller.js';
import { buildSite } from './build-site.js';

if (!config.apiKey) {
  console.error('ไม่พบ ODDS_API_KEY — เพิ่มใน Settings → Secrets and variables → Actions ของ repo');
  process.exit(1);
}

const db = openDb(config.dbPath);
const count = () => db.prepare('SELECT COUNT(*) AS n FROM polls').get().n;
const before = count();
const poller = createPoller(db, config);
if (process.env.FORCE_ODDS === 'true') {
  // กดปุ่ม Refresh prices บนหน้าเว็บ: ดึงราคาทันที ถ้าเครดิตยังไม่ต่ำกว่าขั้นต่ำ
  const cr = lastCredits(db);
  if (cr && cr.credits_remaining < config.minCreditsLeft) console.log(`เครดิตเหลือ ${cr.credits_remaining} ต่ำกว่าขั้นต่ำ ไม่ดึงราคา`);
  else await poller.pollOdds();
}
// รันจาก push / กดเอง: ดึงตารางแข่งด้วย (ไม่เสียเครดิต)
if (process.env.FORCE_BUILD === 'true' && config.eventsEveryMin) await poller.pollEvents();
await poller.tick({ slackMin: config.poll.slackMin || 3 });
const polled = count() > before;

const outDir = path.join(ROOT, 'site');
const force = process.env.FORCE_BUILD === 'true';
const changed = polled || force;
if (changed) {
  const r = buildSite(db, outDir, {
    nextPollAt: poller.forecastNextOddsAt().toISOString(),
    intervalMin: poller.intervalMinutes(),
  });
  console.log(`สร้างเว็บใหม่ (${r.games} แมตช์)`);
} else {
  console.log(`ยังไม่ถึงรอบ รอบถัดไป ${poller.forecastNextOddsAt().toISOString()}`);
}

db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\npolled=${polled}\n`);
}
