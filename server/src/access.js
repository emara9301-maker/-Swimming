// Central ownership rules. Every route that reads or writes student data
// should go through one of these checks instead of re-implementing them.

export function canViewStudent(db, user, studentId) {
  if (user.role === 'admin') return true;
  if (user.role === 'student') return user.id === studentId;
  if (user.role === 'coach') {
    return !!db
      .prepare(
        `SELECT 1 FROM enrollments e JOIN classes c ON c.id = e.class_id
         WHERE e.student_id = ? AND c.coach_id = ? LIMIT 1`
      )
      .get(studentId, user.id);
  }
  return false;
}

export function canManageClass(db, user, classId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'coach') return false;
  return !!db.prepare('SELECT 1 FROM classes WHERE id = ? AND coach_id = ?').get(classId, user.id);
}

export function canManageLesson(db, user, lessonId) {
  const row = db.prepare('SELECT class_id FROM lessons WHERE id = ?').get(lessonId);
  return row ? canManageClass(db, user, row.class_id) : false;
}

// Sessions left across all currently active subscriptions.
export function remainingSessions(db, studentId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sessions_total - sessions_used), 0) AS left
       FROM subscriptions WHERE student_id = ? AND status = 'active'`
    )
    .get(studentId);
  return row.left;
}

// Marks subscriptions past their end date as expired. Called before reads
// that depend on subscription state.
export function expireSubscriptions(db) {
  db.prepare(
    `UPDATE subscriptions SET status = 'expired'
     WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at < datetime('now')`
  ).run();
}
