import express from 'express';
import { requireRole } from '../auth.js';
import { requireDate, requireInt, badRequest, notFound, forbidden, toId, audit, notify } from '../http.js';
import { canManageClass, canManageLesson, canViewStudent } from '../access.js';

const STATUSES = ['present', 'absent', 'late', 'excused'];
// Statuses that use up one session from the student's subscription.
const CONSUMES = new Set(['present', 'late']);

export default function attendanceRoutes(db) {
  const r = express.Router();
  // Roster for a lesson with each student's current attendance status.
  r.get('/lessons/:id/attendance', requireRole('admin', 'coach'), (req, res) => {
    const lessonId = toId(req.params.id);
    if (!canManageLesson(db, req.user, lessonId)) throw forbidden();
    const lesson = db.prepare('SELECT class_id FROM lessons WHERE id = ?').get(lessonId);
    if (!lesson) throw notFound('Lesson');
    const rows = db
      .prepare(
        `SELECT u.id AS student_id, u.name, a.status
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
         LEFT JOIN attendance a ON a.lesson_id = ? AND a.student_id = e.student_id
         WHERE e.class_id = ? ORDER BY u.name`
      )
      .all(lessonId, lesson.class_id);
    res.json({ items: rows });
  });

  // Saves attendance for a lesson and keeps subscription sessions in sync:
  // marking present/late uses one session, changing it back releases it.
  r.put('/lessons/:id/attendance', requireRole('admin', 'coach'), (req, res) => {
    const lessonId = toId(req.params.id);
    if (!canManageLesson(db, req.user, lessonId)) throw forbidden();
    const lesson = db.prepare('SELECT class_id FROM lessons WHERE id = ?').get(lessonId);
    if (!lesson) throw notFound('Lesson');
    const records = req.body?.records;
    if (!Array.isArray(records) || records.length === 0 || records.length > 500) {
      throw badRequest('records must be a non-empty list');
    }

    const enrolled = new Set(
      db.prepare('SELECT student_id FROM enrollments WHERE class_id = ?').all(lesson.class_id).map((x) => x.student_id)
    );
    const findExisting = db.prepare('SELECT status, subscription_id FROM attendance WHERE lesson_id = ? AND student_id = ?');
    const findSub = db.prepare(
      `SELECT id FROM subscriptions
       WHERE student_id = ? AND status = 'active' AND sessions_used < sessions_total
       ORDER BY ends_at LIMIT 1`
    );
    const useSession = db.prepare('UPDATE subscriptions SET sessions_used = sessions_used + 1 WHERE id = ?');
    const releaseSession = db.prepare('UPDATE subscriptions SET sessions_used = sessions_used - 1 WHERE id = ?');
    const upsert = db.prepare(
      `INSERT INTO attendance (lesson_id, student_id, status, subscription_id, marked_by, marked_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(lesson_id, student_id) DO UPDATE SET
         status = excluded.status, subscription_id = excluded.subscription_id,
         marked_by = excluded.marked_by, marked_at = excluded.marked_at`
    );

    const warnings = [];
    db.transaction(() => {
      for (const rec of records) {
        const studentId = requireInt(rec, 'student_id', { min: 1 });
        const status = rec.status;
        if (!STATUSES.includes(status)) throw badRequest('Invalid attendance status');
        if (!enrolled.has(studentId)) throw badRequest(`Student ${studentId} is not enrolled in this class`);

        const prev = findExisting.get(lessonId, studentId);
        let subId = prev?.subscription_id ?? null;
        const wantsSession = CONSUMES.has(status);

        if (subId && !wantsSession) {
          releaseSession.run(subId);
          subId = null;
        } else if (!subId && wantsSession) {
          const sub = findSub.get(studentId);
          if (sub) {
            useSession.run(sub.id);
            subId = sub.id;
          } else {
            warnings.push(studentId);
            notify(db, studentId, 'No sessions remaining', 'Please renew your subscription to continue attending classes');
          }
        }
        upsert.run(lessonId, studentId, status, subId, req.user.id);
      }
    })();

    audit(db, req.user.id, 'mark_attendance', 'lesson', lessonId, { count: records.length });
    res.json({ ok: true, students_without_sessions: warnings });
  });

  // Attendance history of one student.
  r.get('/students/:id/attendance', (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const rows = db
      .prepare(
        `SELECT a.status, a.marked_at, l.id AS lesson_id, l.starts_at, c.name AS class_name
         FROM attendance a
         JOIN lessons l ON l.id = a.lesson_id
         JOIN classes c ON c.id = l.class_id
         WHERE a.student_id = ? ORDER BY l.starts_at DESC LIMIT 200`
      )
      .all(studentId);
    res.json({ items: rows });
  });

  // Attendance report per student for a class in a date range.
  r.get('/reports/attendance', requireRole('admin', 'coach'), (req, res) => {
    const classId = toId(req.query.class_id, 'class_id');
    if (req.user.role !== 'admin' && !canManageClass(db, req.user, classId)) throw forbidden();
    const from = requireDate(req.query, 'from', { optional: true }) || '1970-01-01T00:00:00.000Z';
    const to = requireDate(req.query, 'to', { optional: true }) || '9999-12-31T23:59:59.000Z';
    const rows = db
      .prepare(
        `SELECT u.id AS student_id, u.name,
                COUNT(a.lesson_id) AS lessons_recorded,
                SUM(CASE WHEN a.status = 'present' THEN 1 ELSE 0 END) AS present,
                SUM(CASE WHEN a.status = 'late' THEN 1 ELSE 0 END) AS late,
                SUM(CASE WHEN a.status = 'absent' THEN 1 ELSE 0 END) AS absent,
                SUM(CASE WHEN a.status = 'excused' THEN 1 ELSE 0 END) AS excused
         FROM enrollments e
         JOIN users u ON u.id = e.student_id
         LEFT JOIN lessons l ON l.class_id = e.class_id AND l.starts_at >= ? AND l.starts_at < ?
         LEFT JOIN attendance a ON a.lesson_id = l.id AND a.student_id = e.student_id
         WHERE e.class_id = ?
         GROUP BY u.id ORDER BY u.name`
      )
      .all(from, to, classId);
    res.json({ items: rows });
  });

  return r;
}
