import express from 'express';
import rateLimit from 'express-rate-limit';
import { hashPassword, verifyPassword, signToken, authenticate } from '../auth.js';
import { requireString, requireDate, badRequest, HttpError, audit } from '../http.js';
import { remainingSessions } from '../access.js';
import { createBooking } from '../bookings.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(db, id) {
  const u = db.prepare('SELECT id, name, email, phone, role FROM users WHERE id = ?').get(id);
  if (u.role === 'student') {
    const s = db
      .prepare(
        `SELECT s.birth_date, s.level_id, l.name AS level_name
         FROM students s LEFT JOIN levels l ON l.id = s.level_id WHERE s.user_id = ?`
      )
      .get(id);
    return { ...u, ...s, sessions_remaining: remainingSessions(db, id) };
  }
  if (u.role === 'coach') {
    const c = db.prepare('SELECT specialty, bio FROM coaches WHERE user_id = ?').get(id);
    return { ...u, ...c };
  }
  return u;
}

export default function authRoutes(db) {
  const r = express.Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

  // Student self-registration.
  r.post('/register', (req, res) => {
    const name = requireString(req.body, 'name', { max: 120 });
    const email = requireString(req.body, 'email', { max: 255 }).toLowerCase();
    const password = requireString(req.body, 'password', { max: 200 });
    const phone = requireString(req.body, 'phone', { max: 30, optional: true });
    const birthDate = requireDate(req.body, 'birth_date', { optional: true });
    // Optional: choose a public session or request a private training during sign-up.
    const booking = req.body.booking ?? null;
    if (booking !== null && (typeof booking !== 'object' || Array.isArray(booking))) throw badRequest('booking is invalid');
    if (!EMAIL_RE.test(email)) throw badRequest('Invalid email address');
    if (password.length < 8) throw badRequest('Password must be at least 8 characters');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Email is already in use');
    }

    const userId = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, phone, hashPassword(password), 'student');
      db.prepare('INSERT INTO students (user_id, birth_date) VALUES (?, ?)').run(
        info.lastInsertRowid,
        birthDate ? birthDate.slice(0, 10) : null
      );
      const userId = Number(info.lastInsertRowid);
      audit(db, userId, 'register', 'user', userId);
      // A failed booking rolls back the whole sign-up, so the student can retry.
      if (booking) createBooking(db, userId, booking, userId);
      return userId;
    })();

    res.status(201).json({ token: signToken({ id: userId }), user: publicUser(db, userId) });
  });

  r.post('/login', loginLimiter, (req, res) => {
    const email = requireString(req.body, 'email', { max: 255 }).toLowerCase();
    const password = requireString(req.body, 'password', { max: 200 });
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    // Same error for unknown email and wrong password to avoid account enumeration.
    if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }
    audit(db, user.id, 'login', 'user', user.id);
    res.json({ token: signToken(user), user: publicUser(db, user.id) });
  });

  r.get('/me', authenticate(db), (req, res) => {
    res.json({ user: publicUser(db, req.user.id) });
  });

  r.patch('/me', authenticate(db), (req, res) => {
    const name = requireString(req.body, 'name', { max: 120, optional: true });
    const phone = requireString(req.body, 'phone', { max: 30, optional: true });
    const newPassword = requireString(req.body, 'new_password', { max: 200, optional: true });
    const current = requireString(req.body, 'current_password', { max: 200, optional: true });
    if (newPassword) {
      const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!current || !verifyPassword(current, row.password_hash)) throw badRequest('Current password is incorrect');
      if (newPassword.length < 8) throw badRequest('Password must be at least 8 characters');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    }
    db.prepare('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?').run(
      name,
      phone,
      req.user.id
    );
    audit(db, req.user.id, 'update_profile', 'user', req.user.id);
    res.json({ user: publicUser(db, req.user.id) });
  });

  return r;
}
