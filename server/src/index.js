import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedBasics, ensureAdmin } from './seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 4000;
const db = openDb(process.env.DB_FILE || path.join(here, '..', 'data', 'academy.db'));
seedBasics(db);
if (ensureAdmin(db, { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD })) {
  console.log('Admin account created from ADMIN_EMAIL / ADMIN_PASSWORD');
}
const app = createApp(db, { webDistDir: process.env.WEB_DIST || path.join(here, '..', '..', 'web', 'dist') });

app.listen(port, () => console.log(`Swimming academy API listening on http://localhost:${port}`));
