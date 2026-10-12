import express from 'express';
import { requireRole } from '../auth.js';
import { requireString, requireInt, badRequest, notFound, forbidden, toId, audit, paging } from '../http.js';
import { canViewStudent } from '../access.js';

export default function progressRoutes(db) {
  const r = express.Router();
  // Skills catalogue, optionally filtered by sport or level.
  r.get('/skills', (req, res) => {
    const where = [];
    const args = [];
    if (req.query.sport_id) { where.push('sk.sport_id = ?'); args.push(toId(req.query.sport_id, 'sport_id')); }
    if (req.query.level_id) { where.push('sk.level_id = ?'); args.push(toId(req.query.level_id, 'level_id')); }
    const sql = `SELECT sk.id, sk.name, sk.sport_id, sk.level_id, sp.name AS sport_name, lv.name AS level_name
                 FROM skills sk JOIN sports sp ON sp.id = sk.sport_id LEFT JOIN levels lv ON lv.id = sk.level_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY sp.name, sk.name`;
    res.json({ items: db.prepare(sql).all(...args) });
  });

  // Coach records a skill the student has learned in a lesson.
  r.post('/students/:id/skills', requireRole('admin', 'coach'), (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const skillId = requireInt(req.body, 'skill_id', { min: 1 });
    if (!db.prepare('SELECT 1 FROM skills WHERE id = ?').get(skillId)) throw notFound('المهارة');
    db.prepare(
      `INSERT INTO student_skills (student_id, skill_id, coach_id) VALUES (?, ?, ?)
       ON CONFLICT(student_id, skill_id) DO NOTHING`
    ).run(studentId, skillId, req.user.id);
    audit(db, req.user.id, 'record_skill', 'student', studentId, { skill_id: skillId });
    res.status(201).json({ ok: true });
  });

  // Coach rating for a student (1-5), optionally tied to a lesson.
  r.post('/students/:id/evaluations', requireRole('admin', 'coach'), (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const score = requireInt(req.body, 'score', { min: 1, max: 5 });
    const comment = requireString(req.body, 'comment', { max: 2000, optional: true });
    const lessonId = requireInt(req.body, 'lesson_id', { min: 1, optional: true });
    const info = db
      .prepare('INSERT INTO evaluations (student_id, coach_id, lesson_id, score, comment) VALUES (?, ?, ?, ?, ?)')
      .run(studentId, req.user.id, lessonId, score, comment);
    audit(db, req.user.id, 'evaluate', 'student', studentId, { score });
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.get('/students/:id/evaluations', (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const { limit, offset } = paging(req.query);
    const rows = db
      .prepare(
        `SELECT e.id, e.score, e.comment, e.created_at, e.lesson_id, u.name AS coach_name
         FROM evaluations e LEFT JOIN users u ON u.id = e.coach_id
         WHERE e.student_id = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(studentId, limit, offset);
    res.json({ items: rows });
  });

  // Private coach notes: visible to coaches of the student and admins, never to the student.
  r.get('/students/:id/notes', requireRole('admin', 'coach'), (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const rows = db
      .prepare(
        `SELECT n.id, n.body, n.created_at, u.name AS coach_name
         FROM coach_notes n LEFT JOIN users u ON u.id = n.coach_id
         WHERE n.student_id = ? ORDER BY n.created_at DESC LIMIT 200`
      )
      .all(studentId);
    res.json({ items: rows });
  });

  r.post('/students/:id/notes', requireRole('admin', 'coach'), (req, res) => {
    const studentId = toId(req.params.id);
    if (!canViewStudent(db, req.user, studentId)) throw forbidden();
    const body = requireString(req.body, 'body', { max: 5000 });
    if (!body) throw badRequest('الملاحظة فارغة');
    const info = db
      .prepare('INSERT INTO coach_notes (student_id, coach_id, body) VALUES (?, ?, ?)')
      .run(studentId, req.user.id, body);
    audit(db, req.user.id, 'add_note', 'student', studentId);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  return r;
}
