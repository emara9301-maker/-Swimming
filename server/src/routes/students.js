import express from 'express';
import { requireRole } from '../auth.js';
import { requireString, requireInt, requireDate, badRequest, notFound, forbidden, toId, paging, audit, notify } from '../http.js';
import { canViewStudent, remainingSessions, expireSubscriptions } from '../access.js';

export default function studentRoutes(db) {
  const r = express.Router();
  // Admins see all students; coaches see students enrolled in their classes.
  r.get('/students', requireRole('admin', 'coach'), (req, res) => {
    const { limit, offset } = paging(req.query);
    const q = `%${String(req.query.q || '').trim()}%`;
    const scope = req.user.role === 'admin'
      ? ''
      : `AND st.user_id IN (SELECT e.student_id FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE c.coach_id = ${req.user.id})`;
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.active, st.level_id, l.name AS level_name
         FROM students st
         JOIN users u ON u.id = st.user_id
         LEFT JOIN levels l ON l.id = st.level_id
         WHERE (u.name LIKE ? OR u.email LIKE ?) ${scope}
         ORDER BY u.name LIMIT ? OFFSET ?`
      )
      .all(q, q, limit, offset);
    res.json({ items: rows });
  });

  // Full profile: personal data, level, sessions left and subscriptions.
  r.get('/students/:id', (req, res) => {
    const id = toId(req.params.id);
    if (!canViewStudent(db, req.user, id)) throw forbidden();
    expireSubscriptions(db);
    const profile = db
      .prepare(
        `SELECT u.id, u.name, u.email, u.phone, u.active, st.birth_date, st.level_id, l.name AS level_name
         FROM students st JOIN users u ON u.id = st.user_id
         LEFT JOIN levels l ON l.id = st.level_id WHERE st.user_id = ?`
      )
      .get(id);
    if (!profile) throw notFound('الطالب');
    const subscriptions = db
      .prepare(
        `SELECT s.id, s.status, s.sessions_total, s.sessions_used, s.starts_at, s.ends_at, p.name AS plan_name
         FROM subscriptions s JOIN prices p ON p.id = s.price_id
         WHERE s.student_id = ? ORDER BY s.id DESC`
      )
      .all(id);
    res.json({ student: { ...profile, sessions_remaining: remainingSessions(db, id) }, subscriptions });
  });

  // Students edit their own basic info; admins can edit anyone.
  r.patch('/students/:id', (req, res) => {
    const id = toId(req.params.id);
    if (req.user.role !== 'admin' && req.user.id !== id) throw forbidden();
    if (!db.prepare('SELECT 1 FROM students WHERE user_id = ?').get(id)) throw notFound('الطالب');
    const name = requireString(req.body, 'name', { max: 120, optional: true });
    const phone = requireString(req.body, 'phone', { max: 30, optional: true });
    const birth = requireDate(req.body, 'birth_date', { optional: true });
    db.prepare('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?').run(name, phone, id);
    if (birth) db.prepare('UPDATE students SET birth_date = ? WHERE user_id = ?').run(birth.slice(0, 10), id);
    audit(db, req.user.id, 'update', 'student', id);
    res.json({ ok: true });
  });

  // Level change by a coach (for their students) or admin. Recorded in history
  // and the student is notified.
  r.post('/students/:id/level', requireRole('admin', 'coach'), (req, res) => {
    const id = toId(req.params.id);
    if (!canViewStudent(db, req.user, id)) throw forbidden();
    const levelId = requireInt(req.body, 'level_id', { min: 1 });
    const student = db.prepare('SELECT level_id FROM students WHERE user_id = ?').get(id);
    if (!student) throw notFound('الطالب');
    if (!db.prepare('SELECT 1 FROM levels WHERE id = ?').get(levelId)) throw notFound('المستوى');
    if (student.level_id === levelId) throw badRequest('الطالب موجود بالفعل في هذا المستوى');
    db.transaction(() => {
      db.prepare('UPDATE students SET level_id = ? WHERE user_id = ?').run(levelId, id);
      db.prepare('INSERT INTO level_history (student_id, from_level_id, to_level_id, changed_by) VALUES (?, ?, ?, ?)')
        .run(id, student.level_id, levelId, req.user.id);
    })();
    const level = db.prepare('SELECT name FROM levels WHERE id = ?').get(levelId);
    notify(db, id, 'تمت ترقيتك لمستوى جديد', `مستواك الآن: ${level.name}`);
    audit(db, req.user.id, 'level_change', 'student', id, { to: levelId });
    res.json({ ok: true });
  });

  // Level history and progress summary: attendance, evaluations, skills.
  r.get('/students/:id/progress', (req, res) => {
    const id = toId(req.params.id);
    if (!canViewStudent(db, req.user, id)) throw forbidden();
    const attendance = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status IN ('present','late') THEN 1 ELSE 0 END) AS attended
         FROM attendance WHERE student_id = ?`
      )
      .get(id);
    const evalAvg = db.prepare('SELECT ROUND(AVG(score), 2) AS avg, COUNT(*) AS count FROM evaluations WHERE student_id = ?').get(id);
    const levelHistory = db
      .prepare(
        `SELECT h.changed_at, fl.name AS from_level, tl.name AS to_level
         FROM level_history h
         LEFT JOIN levels fl ON fl.id = h.from_level_id
         LEFT JOIN levels tl ON tl.id = h.to_level_id
         WHERE h.student_id = ? ORDER BY h.changed_at DESC`
      )
      .all(id);
    const skills = db
      .prepare(
        `SELECT sk.id, sk.name, sp.name AS sport_name, ss.achieved_at
         FROM student_skills ss JOIN skills sk ON sk.id = ss.skill_id JOIN sports sp ON sp.id = sk.sport_id
         WHERE ss.student_id = ? ORDER BY ss.achieved_at DESC`
      )
      .all(id);
    res.json({
      attendance: {
        total: attendance.total,
        attended: attendance.attended || 0,
        rate: attendance.total ? Math.round(((attendance.attended || 0) / attendance.total) * 100) : null,
      },
      evaluations: { average: evalAvg.avg, count: evalAvg.count },
      level_history: levelHistory,
      skills,
    });
  });

  return r;
}
