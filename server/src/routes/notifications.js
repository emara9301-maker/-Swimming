import express from 'express';
import { requireRole } from '../auth.js';
import { requireString, requireInt, notFound, toId, paging, audit, notify } from '../http.js';

export default function notificationRoutes(db) {
  const r = express.Router();
  r.get('/notifications', (req, res) => {
    const { limit, offset } = paging(req.query);
    const unreadOnly = req.query.unread === 'true' ? 'AND read_at IS NULL' : '';
    const rows = db
      .prepare(
        `SELECT id, title, body, read_at, created_at FROM notifications
         WHERE user_id = ? ${unreadOnly} ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(req.user.id, limit, offset);
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(req.user.id).n;
    res.json({ items: rows, unread });
  });

  r.post('/notifications/:id/read', (req, res) => {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND user_id = ?")
      .run(toId(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  r.post('/notifications/read-all', (req, res) => {
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(req.user.id);
    res.json({ ok: true });
  });

  // Admin broadcast to everyone, or to one role (e.g. all students).
  r.post('/notifications/broadcast', requireRole('admin'), (req, res) => {
    const title = requireString(req.body, 'title', { max: 200 });
    const body = requireString(req.body, 'body', { max: 2000, optional: true });
    const role = req.body.role ? requireString(req.body, 'role', { max: 20 }) : null;
    if (role && !['student', 'coach', 'admin'].includes(role)) throw notFound('الدور');
    const users = role
      ? db.prepare('SELECT id FROM users WHERE role = ? AND active = 1').all(role)
      : db.prepare('SELECT id FROM users WHERE active = 1').all();
    db.transaction(() => users.forEach((u) => notify(db, u.id, title, body)))();
    audit(db, req.user.id, 'broadcast', 'notification', null, { role, count: users.length });
    res.status(201).json({ sent: users.length });
  });

  return r;
}
