import { hashPassword } from './auth.js';

// Idempotent starter data: levels, a sport with its first skills, and an admin
// account if none exists yet. Safe to run on every start.
export function seedBasics(db) {
  const levelCount = db.prepare('SELECT COUNT(*) AS n FROM levels').get().n;
  if (levelCount === 0) {
    const insert = db.prepare('INSERT INTO levels (name, sort_order) VALUES (?, ?)');
    ['Beginner', 'Intermediate', 'Advanced', 'Pro'].forEach((name, i) => insert.run(name, i));
  }

  if (db.prepare('SELECT COUNT(*) AS n FROM sports').get().n === 0) {
    const sportId = Number(db.prepare('INSERT INTO sports (name) VALUES (?)').run('Swimming').lastInsertRowid);
    const beginner = db.prepare("SELECT id FROM levels WHERE name = 'Beginner'").get().id;
    const addSkill = db.prepare('INSERT INTO skills (sport_id, level_id, name) VALUES (?, ?, ?)');
    ['Underwater breathing', 'Backstroke float', 'Leg kick', 'Freestyle arm stroke'].forEach((name) =>
      addSkill.run(sportId, beginner, name)
    );
  }
}

export function ensureAdmin(db, { email, password, name = 'Academy Admin' }) {
  if (!email || !password) return false;
  if (db.prepare("SELECT 1 FROM users WHERE role = 'admin'").get()) return false;
  db.prepare("INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin')")
    .run(name, email.toLowerCase(), hashPassword(password));
  return true;
}
