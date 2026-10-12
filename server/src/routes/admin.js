import express from 'express';
import { authenticate, requireRole, hashPassword } from '../auth.js';
import { requireString, requireInt, badRequest, notFound, toId, paging, audit, HttpError } from '../http.js';
import { expireSubscriptions } from '../access.js';

const ROLES = ['student', 'coach', 'admin'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function adminRoutes(db) {
  const r = express.Router();

  // Public: sports, levels and published content are readable without admin rights.
  r.get('/sports', authenticate(db), (req, res) => {
    res.json({ items: db.prepare('SELECT id, name FROM sports ORDER BY name').all() });
  });
  r.get('/levels', authenticate(db), (req, res) => {
    res.json({ items: db.prepare('SELECT id, name, sort_order FROM levels ORDER BY sort_order').all() });
  });
  r.get('/coaches', authenticate(db), (req, res) => {
    const rows = db.prepare(
      `SELECT u.id, u.name, u.phone, c.specialty, c.bio,
              (SELECT COUNT(*) FROM classes cl WHERE cl.coach_id = u.id AND cl.active = 1) AS class_count
       FROM coaches c JOIN users u ON u.id = c.user_id ORDER BY u.name`
    ).all();
    res.json({ items: rows });
  });
  r.get('/content', authenticate(db), (req, res) => {
    const filter = req.user.role === 'admin' ? '' : 'WHERE published = 1';
    res.json({ items: db.prepare(`SELECT id, title, body, published, created_at FROM content ${filter} ORDER BY id DESC`).all() });
  });

  // Everything below is admin-only.
  r.use(authenticate(db), requireRole('admin'));

  r.get('/admin/stats', (req, res) => {
    expireSubscriptions(db);
    const one = (sql) => db.prepare(sql).get();
    res.json({
      students: one("SELECT COUNT(*) AS n FROM students").n,
      coaches: one("SELECT COUNT(*) AS n FROM coaches").n,
      active_classes: one("SELECT COUNT(*) AS n FROM classes WHERE active = 1").n,
      active_subscriptions: one("SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active'").n,
      revenue_cents: one("SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payments WHERE status = 'paid'").n,
      pending_payments: one("SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'").n,
      attendance_rate: (() => {
        const a = one("SELECT COUNT(*) AS total, SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended FROM attendance");
        return a.total ? Math.round((a.attended / a.total) * 100) : null;
      })(),
    });
  });

  r.get('/admin/users', (req, res) => {
    const { limit, offset } = paging(req.query);
    const args = [];
    let where = '';
    if (req.query.role) {
      const role = requireString(req.query, 'role', { max: 20 });
      if (!ROLES.includes(role)) throw badRequest('الدور غير صالح');
      where = 'WHERE role = ?';
      args.push(role);
    }
    const rows = db.prepare(
      `SELECT id, name, email, phone, role, active, created_at FROM users ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
    ).all(...args, limit, offset);
    res.json({ items: rows });
  });

  // Creates staff accounts (coach or admin). Students self-register.
  r.post('/admin/users', (req, res) => {
    const name = requireString(req.body, 'name', { max: 120 });
    const email = requireString(req.body, 'email', { max: 255 }).toLowerCase();
    const password = requireString(req.body, 'password', { max: 200 });
    const role = requireString(req.body, 'role', { max: 20 });
    const phone = requireString(req.body, 'phone', { max: 30, optional: true });
    if (!['coach', 'admin'].includes(role)) throw badRequest('الدور يجب أن يكون coach أو admin');
    if (!EMAIL_RE.test(email)) throw badRequest('البريد الإلكتروني غير صالح');
    if (password.length < 8) throw badRequest('كلمة المرور يجب ألا تقل عن 8 أحرف');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'البريد مستخدم بالفعل');

    const id = db.transaction(() => {
      const info = db.prepare('INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)')
        .run(name, email, phone, hashPassword(password), role);
      if (role === 'coach') {
        db.prepare('INSERT INTO coaches (user_id, specialty, bio) VALUES (?, ?, ?)').run(
          info.lastInsertRowid,
          requireString(req.body, 'specialty', { max: 120, optional: true }),
          requireString(req.body, 'bio', { max: 2000, optional: true })
        );
      }
      return Number(info.lastInsertRowid);
    })();
    audit(db, req.user.id, 'create', 'user', id, { role });
    res.status(201).json({ id });
  });

  // Permissions: change role or deactivate an account.
  r.patch('/admin/users/:id', (req, res) => {
    const id = toId(req.params.id);
    if (id === req.user.id && (req.body.active === false || req.body.role)) {
      throw badRequest('لا يمكنك تعديل صلاحياتك أو تعطيل حسابك بنفسك');
    }
    const user = db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!user) throw notFound('المستخدم');
    if (req.body.role !== undefined) {
      if (!ROLES.includes(req.body.role)) throw badRequest('الدور غير صالح');
      db.transaction(() => {
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
        if (req.body.role === 'coach') db.prepare('INSERT OR IGNORE INTO coaches (user_id) VALUES (?)').run(id);
        if (req.body.role === 'student') db.prepare('INSERT OR IGNORE INTO students (user_id) VALUES (?)').run(id);
      })();
    }
    if (typeof req.body.active === 'boolean') {
      db.prepare('UPDATE users SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
    }
    audit(db, req.user.id, 'update_permissions', 'user', id, { role: req.body.role, active: req.body.active });
    res.json({ ok: true });
  });

  r.patch('/coaches/:id', (req, res) => {
    const id = toId(req.params.id);
    const specialty = requireString(req.body, 'specialty', { max: 120, optional: true });
    const bio = requireString(req.body, 'bio', { max: 2000, optional: true });
    if (!db.prepare('SELECT 1 FROM coaches WHERE user_id = ?').get(id)) throw notFound('المدرب');
    db.prepare('UPDATE coaches SET specialty = COALESCE(?, specialty), bio = COALESCE(?, bio) WHERE user_id = ?')
      .run(specialty, bio, id);
    audit(db, req.user.id, 'update', 'coach', id);
    res.json({ ok: true });
  });

  r.post('/sports', (req, res) => {
    const name = requireString(req.body, 'name', { max: 80 });
    const info = db.prepare('INSERT INTO sports (name) VALUES (?)').run(name);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.post('/levels', (req, res) => {
    const name = requireString(req.body, 'name', { max: 80 });
    const order = requireInt(req.body, 'sort_order', { min: 0, max: 1000 });
    const info = db.prepare('INSERT INTO levels (name, sort_order) VALUES (?, ?)').run(name, order);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.post('/skills', (req, res) => {
    const sportId = requireInt(req.body, 'sport_id', { min: 1 });
    const levelId = requireInt(req.body, 'level_id', { min: 1, optional: true });
    const name = requireString(req.body, 'name', { max: 120 });
    const info = db.prepare('INSERT INTO skills (sport_id, level_id, name) VALUES (?, ?, ?)').run(sportId, levelId, name);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.post('/content', (req, res) => {
    const title = requireString(req.body, 'title', { max: 200 });
    const body = requireString(req.body, 'body', { max: 20000 });
    const info = db.prepare('INSERT INTO content (title, body, published) VALUES (?, ?, ?)')
      .run(title, body, req.body.published ? 1 : 0);
    audit(db, req.user.id, 'create', 'content', info.lastInsertRowid);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/content/:id', (req, res) => {
    const id = toId(req.params.id);
    const title = requireString(req.body, 'title', { max: 200, optional: true });
    const body = requireString(req.body, 'body', { max: 20000, optional: true });
    const published = typeof req.body.published === 'boolean' ? (req.body.published ? 1 : 0) : null;
    const info = db.prepare(
      'UPDATE content SET title = COALESCE(?, title), body = COALESCE(?, body), published = COALESCE(?, published) WHERE id = ?'
    ).run(title, body, published, id);
    if (info.changes === 0) throw notFound('المحتوى');
    audit(db, req.user.id, 'update', 'content', id);
    res.json({ ok: true });
  });

  r.delete('/content/:id', (req, res) => {
    const id = toId(req.params.id);
    db.prepare('DELETE FROM content WHERE id = ?').run(id);
    audit(db, req.user.id, 'delete', 'content', id);
    res.json({ ok: true });
  });

  r.get('/reports/revenue', (req, res) => {
    const rows = db.prepare(
      `SELECT substr(paid_at, 1, 7) AS month, COUNT(*) AS payments, SUM(amount_cents) AS total_cents
       FROM payments WHERE status = 'paid' GROUP BY month ORDER BY month DESC LIMIT 24`
    ).all();
    res.json({ items: rows });
  });

  r.get('/admin/audit', (req, res) => {
    const { limit, offset } = paging(req.query);
    const rows = db.prepare(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.meta, a.created_at, u.name AS user_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
    res.json({ items: rows });
  });

  return r;
}
