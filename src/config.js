import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// โหลดไฟล์ .env แบบง่าย ๆ (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

const num = (k, d) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== '' ? v : d;
};
const str = (k, d = '') => (process.env[k] ?? d).trim();

export const config = {
  apiKey: str('ODDS_API_KEY'),
  sport: 'basketball_nba',
  regions: str('REGIONS', 'eu'),
  bookmakers: str('BOOKMAKERS'),
  defaultBook: str('DEFAULT_BOOK', 'pinnacle'),
  port: num('PORT', 3000),
  dbPath: path.resolve(ROOT, str('DB_PATH', './data/odds.db')),
  demo: ['1', 'true', 'yes'].includes(str('DEMO').toLowerCase()),
  poll: {
    farMin: num('POLL_FAR_MIN', 180),
    dayMin: num('POLL_DAY_MIN', 60),
    nearMin: num('POLL_NEAR_MIN', 20),
    closeMin: num('POLL_CLOSE_MIN', 10),
    idleMin: num('POLL_IDLE_MIN', 360),
    tickSec: num('POLL_TICK_SEC', 60),
    slackMin: num('POLL_SLACK_MIN', 0),
  },
  scoresEveryHours: num('SCORES_EVERY_HOURS', 4),
  minCreditsLeft: num('MIN_CREDITS_LEFT', 25),
  adminToken: str('ADMIN_TOKEN'),
};
