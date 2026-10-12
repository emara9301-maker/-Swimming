import express from 'express';
import { requireRole } from '../auth.js';
import {
  requireString, requireInt, requireDate, badRequest, notFound, forbidden, toId, paging, audit, HttpError,
} from '../http.js';
import { canManageClass, canViewStudent, remainingSessions } from '../access.js';

const CLASS_SELECT = `
  SELECT c.id, c.name, c.capacity, c.active, c.sport_id, s.name AS sport_name,
         c.level_id, l.name AS level_name, c.coach_id, u.name AS coach_name,
         (SELECT COUNT(*) FROM enrollments e WHERE e.class_id = c.id) AS enrolled_count
  FROM classes c
  JOIN sports s ON s.id = c.sport_id
  LEFT JOIN levels l ON l.id = c.level_id
  LEFT JOIN users u ON u.id = c.coach_id`;

export default function classRoutes(db) {
  const r = express.Router();
  // Classes visible to everyone logged in (coach directory, enrollment picker).
  r.get('/classes', (req, res) => {
    const { limit, offset } = paging(req.query);
    const where = [];
    const args = [];
    if (req.query.sport_id) { where.push('c.sport_id = ?'); args.push(toId(req.query.sport_id, 'sport_id')); }
    if (req.query.level_id) { where.push('c.level_id = ?'); args.push(toId(req.query.level_id, 'level_id')); }
    if (req.user.role !== 'admin') where.push('c.active = 1');
    const sql = `${CLASS_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id LIMIT ? OFFSET ?`;
    res.json({ items: db.prepare(sql).all(...args, limit, offset) });
  });

  r.get('/classes/:id', (req, res) => {
    const row = db.prepare(`${CLASS_SELECT} WHERE c.id = ?`).get(toId(req.params.id));
    if (!row) throw notFound('الكلاس');
    res.json({ class: row });
  });

  r.post('/classes', requireRole('admin'), (req, res) => {
    const name = requireString(req.body, 'name', { max: 120 });
    const sportId = requireInt(req.body, 'sport_id', { min: 1 });
    const levelId = requireInt(req.body, 'level_id', { min: 1, optional: true });
    const coachId = requireInt(req.body, 'coach_id', { min: 1, optional: true });
    const capacity = requireInt(req.body, 'capacity', { min: 1, max: 200 });
    if (coachId && !db.prepare('SELECT 1 FROM coaches WHERE user_id = ?').get(coachId)) throw badRequest('المدرب غير موجود');
    const info = db
      .prepare('INSERT INTO classes (name, sport_id, level_id, coach_id, capacity) VALUES (?, ?, ?, ?, ?)')
      .run(name, sportId, levelId, coachId, capacity);
    audit(db, req.user.id, 'create', 'class', info.lastInsertRowid);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/classes/:id', requireRole('admin'), (req, res) => {
    const id = toId(req.params.id);
    if (!db.prepare('SELECT 1 FROM classes WHERE id = ?').get(id)) throw notFound('الكلاس');
    const name = requireString(req.body, 'name', { max: 120, optional: true });
    const coachId = requireInt(req.body, 'coach_id', { min: 1, optional: true });
    const capacity = requireInt(req.body, 'capacity', { min: 1, max: 200, optional: true });
    const active = typeof req.body.active === 'boolean' ? (req.body.active ? 1 : 0) : null;
    db.prepare(
      `UPDATE classes SET name = COALESCE(?, name), coach_id = COALESCE(?, coach_id),
       capacity = COALESCE(?, capacity), active = COALESCE(?, active) WHERE id = ?`
    ).run(name, coachId, capacity, active, id);
    audit(db, req.user.id, 'update', 'class', id);
    res.json({ ok: true });
  });

  // Enroll a student. Students enroll themselves; admins can enroll anyone.
  r.post('/classes/:id/enrollments', (req, res) => {
    const classId = toId(req.params.id);
    const studentId = req.user.role === 'student' ? req.user.id : requireInt(req.body, 'student_id', { min: 1 });
    if (req.user.role === 'coach') throw forbidden();
    const cls = db.prepare('SELECT capacity, active, level_id FROM classes WHERE id = ?').get(classId);
    if (!cls) throw notFound('الكلاس');
    if (!cls.active) throw badRequest('هذا الكلاس غير متاح للتسجيل');
    if (!db.prepare('SELECT 1 FROM students WHERE user_id = ?').get(studentId)) throw notFound('الطالب');
    const count = db.prepare('SELECT COUNT(*) AS n FROM enrollments WHERE class_id = ?').get(classId).n;
    if (count >= cls.capacity) throw new HttpError(409, 'الكلاس مكتمل');
    db.prepare('INSERT OR IGNORE INTO enrollments (class_id, student_id) VALUES (?, ?)').run(classId, studentId);
    audit(db, req.user.id, 'enroll', 'class', classId, { student_id: studentId });
    res.status(201).json({ ok: true, sessions_remaining: remainingSessions(db, studentId) });
  });

  r.delete('/classes/:id/enrollments/:studentId', (req, res) => {
    const classId = toId(req.params.id);
    const studentId = toId(req.params.studentId, 'student_id');
    if (req.user.role !== 'admin' && req.user.id !== studentId) throw forbidden();
    db.prepare('DELETE FROM enrollments WHERE class_id = ? AND student_id = ?').run(classId, studentId);
    audit(db, req.user.id, 'unenroll', 'class', classId, { student_id: studentId });
    res.json({ ok: true });
  });

  // Roster of a class: admins and the class's own coach only.
  r.get('/classes/:id/students', (req, res) => {
    const classId = toId(req.params.id);
    if (!canManageClass(db, req.user, classId)) throw forbidden();
    const rows = db
      .prepare(
        `SELECT u.id, u.name, u.phone, st.level_id, l.name AS level_name
         FROM enrollments e
         JOIN students st ON st.user_id = e.student_id
         JOIN users u ON u.id = st.user_id
         LEFT JOIN levels l ON l.id = st.level_id
         WHERE e.class_id = ? ORDER BY u.name`
      )
      .all(classId);
    res.json({ items: rows });
  });

  // Single lesson with its class, used by the coach's attendance screen.
  r.get('/lessons/:id', (req, res) => {
    const lessonId = toId(req.params.id);
    const row = db
      .prepare(
        `SELECT l.id, l.class_id, l.starts_at, l.ends_at, l.location, c.name AS class_name, s.name AS sport_name
         FROM lessons l JOIN classes c ON c.id = l.class_id JOIN sports s ON s.id = c.sport_id WHERE l.id = ?`
      )
      .get(lessonId);
    if (!row) throw notFound('الحصة');
    if (req.user.role === 'student') {
      const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?').get(row.class_id, req.user.id);
      if (!enrolled) throw forbidden();
    }
    res.json({ lesson: row });
  });

  // Lessons of a class.
  r.get('/classes/:id/lessons', (req, res) => {
    const rows = db
      .prepare('SELECT id, class_id, starts_at, ends_at, location FROM lessons WHERE class_id = ? ORDER BY starts_at')
      .all(toId(req.params.id));
    res.json({ items: rows });
  });

  r.post('/classes/:id/lessons', requireRole('admin', 'coach'), (req, res) => {
    const classId = toId(req.params.id);
    if (!canManageClass(db, req.user, classId)) throw forbidden();
    const startsAt = requireDate(req.body, 'starts_at');
    const endsAt = requireDate(req.body, 'ends_at');
    if (endsAt <= startsAt) throw badRequest('وقت النهاية يجب أن يكون بعد البداية');
    const location = requireString(req.body, 'location', { max: 120, optional: true });
    const info = db
      .prepare('INSERT INTO lessons (class_id, starts_at, ends_at, location) VALUES (?, ?, ?, ?)')
      .run(classId, startsAt, endsAt, location);
    audit(db, req.user.id, 'create', 'lesson', info.lastInsertRowid);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // Timetable: admins see everything, coaches see their classes,
  // students see classes they are enrolled in.
  r.get('/schedule', (req, res) => {
    const from = requireDate(req.query, 'from', { optional: true }) || new Date().toISOString();
    const to = requireDate(req.query, 'to', { optional: true }) || new Date(Date.now() + 14 * 864e5).toISOString();
    const scope = {
      admin: '1=1',
      coach: `c.coach_id = ${req.user.id}`,
      student: `c.id IN (SELECT class_id FROM enrollments WHERE student_id = ${req.user.id})`,
    }[req.user.role];
    const rows = db
      .prepare(
        `SELECT l.id, l.starts_at, l.ends_at, l.location, c.id AS class_id, c.name AS class_name,
                s.name AS sport_name, lv.name AS level_name, u.name AS coach_name
         FROM lessons l
         JOIN classes c ON c.id = l.class_id
         JOIN sports s ON s.id = c.sport_id
         LEFT JOIN levels lv ON lv.id = c.level_id
         LEFT JOIN users u ON u.id = c.coach_id
         WHERE ${scope} AND l.starts_at >= ? AND l.starts_at < ?
         ORDER BY l.starts_at LIMIT 500`
      )
      .all(from, to);
    res.json({ items: rows });
  });

  // Used by the student profile to show what they're enrolled in.
  r.get('/students/:id/classes', (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const rows = db
      .prepare(
        `${CLASS_SELECT} JOIN enrollments e ON e.class_id = c.id WHERE e.student_id = ? ORDER BY c.name`
      )
      .all(studentId);
    res.json({ items: rows });
  });

  return r;
}
