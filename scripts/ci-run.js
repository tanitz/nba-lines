/**
 * รันหนึ่งรอบสำหรับตัวตั้งเวลาภายนอก (GitHub Actions ทุก ~10 นาที)
 * 1) ดึงราคาเฉพาะเมื่อถึงรอบตามตาราง  2) สร้างเว็บไฟล์นิ่งลงโฟลเดอร์ site/
 * เขียน changed=true|false ลง $GITHUB_OUTPUT เพื่อบอกว่าต้องอัปเดตเว็บหรือไม่
 */
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from '../src/config.js';
import { openDb } from '../src/db.js';
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
await poller.tick({ slackMin: config.poll.slackMin || 3 });
const polled = count() > before;

const outDir = path.join(ROOT, 'site');
const force = process.env.FORCE_BUILD === 'true';
const changed = polled || force;
if (changed) {
  const r = buildSite(db, outDir, {
    nextPollAt: poller.nextOddsAt().toISOString(),
    intervalMin: poller.intervalMinutes(),
  });
  console.log(`สร้างเว็บใหม่ (${r.games} แมตช์)`);
} else {
  console.log(`ยังไม่ถึงรอบ รอบถัดไป ${poller.nextOddsAt().toISOString()}`);
}

db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
db.close();

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\npolled=${polled}\n`);
}
