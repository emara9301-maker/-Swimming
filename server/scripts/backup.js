// Writes a consistent copy of the database using SQLite's VACUUM INTO.
// Safe to run while the server is up (WAL mode). Keeps the newest N copies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = process.env.DB_FILE || path.join(here, '..', 'data', 'academy.db');
const dir = process.env.BACKUP_DIR || path.join(here, '..', 'backups');
const keep = Number(process.env.BACKUP_KEEP) || 14;

fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `academy-${stamp}.db`);

const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
db.close();

const old = fs.readdirSync(dir).filter((f) => /^academy-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) fs.unlinkSync(path.join(dir, f));
console.log(`Backup written: ${target} (kept ${keep})`);
