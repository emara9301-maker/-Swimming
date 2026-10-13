import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','coach','admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sport_id INTEGER NOT NULL REFERENCES sports(id) ON DELETE CASCADE,
  level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  UNIQUE (sport_id, name)
);
CREATE TABLE IF NOT EXISTS students (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  birth_date TEXT,
  level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS coaches (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty TEXT,
  bio TEXT
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sport_id INTEGER NOT NULL REFERENCES sports(id),
  level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  coach_id INTEGER REFERENCES coaches(user_id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL DEFAULT 10 CHECK (capacity > 0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  location TEXT,
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_lessons_starts ON lessons(starts_at);
CREATE TABLE IF NOT EXISTS enrollments (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  enrolled_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (class_id, student_id)
);
CREATE TABLE IF NOT EXISTS prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sessions_count INTEGER NOT NULL CHECK (sessions_count > 0),
  validity_days INTEGER NOT NULL DEFAULT 30,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  price_id INTEGER NOT NULL REFERENCES prices(id),
  sessions_total INTEGER NOT NULL,
  sessions_used INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending','active','expired','cancelled')),
  starts_at TEXT,
  ends_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_subs_student ON subscriptions(student_id, status);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('online','card','cash','transfer')),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')),
  provider_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
  number TEXT NOT NULL UNIQUE,
  total_cents INTEGER NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance (
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lesson_id, student_id)
);
CREATE TABLE IF NOT EXISTS evaluations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lesson_id INTEGER REFERENCES lessons(id) ON DELETE SET NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS student_skills (
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, skill_id)
);
CREATE TABLE IF NOT EXISTS coach_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  coach_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS level_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  from_level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  to_level_id INTEGER REFERENCES levels(id) ON DELETE SET NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, read_at);
CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS training_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  venue TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  coach_id INTEGER REFERENCES coaches(user_id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ends_at > starts_at)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(user_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('public','private')),
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','cancelled')),
  subscription_id INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL,
  attendance TEXT,
  training_session_id INTEGER REFERENCES training_sessions(id) ON DELETE SET NULL,
  venue_address TEXT,
  preferred_times TEXT,
  contact_phone TEXT,
  notes TEXT,
  starts_at TEXT,
  ends_at TEXT,
  coach_id INTEGER REFERENCES coaches(user_id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(training_session_id, status);
`;

export function openDb(file = process.env.DB_FILE || 'data/academy.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  addTransactionHelper(db);
  // Databases created before a column existed need it added in place.
  ensureColumn(db, 'bookings', 'subscription_id', 'INTEGER REFERENCES subscriptions(id) ON DELETE SET NULL');
  ensureColumn(db, 'bookings', 'attendance', 'TEXT');
  return db;
}

// node:sqlite has no transaction helper. This gives db.transaction(fn)() the
// same shape as better-sqlite3; nested calls join the outer transaction.
function addTransactionHelper(db) {
  let depth = 0;
  db.transaction = (fn) => (...args) => {
    if (depth > 0) return fn(...args);
    db.exec('BEGIN IMMEDIATE');
    depth += 1;
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      depth -= 1;
    }
  };
}

function ensureColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
