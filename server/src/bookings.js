import { badRequest, notFound, HttpError, requireString, requireInt, audit, notify } from './http.js';
import { remainingSessions } from './access.js';

export const TRAINING_ATTENDANCE = ['present', 'absent', 'late', 'excused'];
// Attendance that uses up one session from the plan.
const CONSUMES = new Set(['present', 'late']);

const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

function requiredText(body, field, max) {
  const value = requireString(body, field, { max });
  if (!value) throw badRequest(`Field ${field} is required`);
  return value;
}

// Uses one session from the student's active plan. Returns the subscription, or null when none is left.
// Called when the coach marks a training as attended, not when it is booked.
export function consumeSession(db, studentId) {
  const sub = db
    .prepare(
      `SELECT id FROM subscriptions
       WHERE student_id = ? AND status = 'active' AND sessions_used < sessions_total
       ORDER BY ends_at LIMIT 1`
    )
    .get(studentId);
  if (!sub) return null;
  db.prepare('UPDATE subscriptions SET sessions_used = sessions_used + 1 WHERE id = ?').run(sub.id);
  return sub.id;
}

export function releaseSession(db, booking) {
  if (!booking.subscription_id) return;
  db.prepare('UPDATE subscriptions SET sessions_used = sessions_used - 1 WHERE id = ?').run(booking.subscription_id);
  db.prepare('UPDATE bookings SET subscription_id = NULL WHERE id = ?').run(booking.id);
}

// Creates a booking for a student. Shared by the booking endpoint and by
// registration, so both paths apply the same rules. Call it inside a transaction.
export function createBooking(db, studentId, body, actorId) {
  const type = requireString(body, 'type', { max: 10 });
  if (type === 'public') return createPublicBooking(db, studentId, body, actorId);
  if (type === 'private') return createPrivateBooking(db, studentId, body, actorId);
  throw badRequest('Booking type must be public or private');
}

// Public bookings are confirmed right away when the student has a session left and
// a seat is free. Otherwise they stay pending and are confirmed after a plan is paid.
// Booking does not use a session; attendance does.
function createPublicBooking(db, studentId, body, actorId) {
  const sessionId = requireInt(body, 'training_session_id', { min: 1 });
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ? AND active = 1').get(sessionId);
  if (!session) throw notFound('Training session');
  if (session.starts_at <= new Date().toISOString()) throw badRequest('This training session has already started');
  const existing = db
    .prepare("SELECT 1 FROM bookings WHERE student_id = ? AND training_session_id = ? AND status != 'cancelled'")
    .get(studentId, sessionId);
  if (existing) throw new HttpError(409, 'You have already booked this session');

  const info = db
    .prepare(
      `INSERT INTO bookings (student_id, type, status, training_session_id, starts_at, ends_at, coach_id)
       VALUES (?, 'public', 'pending', ?, ?, ?, ?)`
    )
    .run(studentId, sessionId, session.starts_at, session.ends_at, session.coach_id);
  const id = Number(info.lastInsertRowid);
  audit(db, actorId, 'create', 'booking', id, { type: 'public' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  if (!confirmPublic(db, booking, false)) {
    notify(db, studentId, 'Booking received', `${session.title}: it will be confirmed once you have a session left in your plan`);
  }
  return id;
}

// Tries to confirm a pending public booking. Strict mode throws the reason instead of returning false.
export function confirmPublic(db, booking, strict) {
  const fail = (status, message) => {
    if (strict) throw new HttpError(status, message);
    return false;
  };
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ?').get(booking.training_session_id);
  if (!session || !session.active || session.starts_at <= new Date().toISOString()) {
    return fail(400, 'This training session is no longer available');
  }
  const booked = db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE training_session_id = ? AND status = 'confirmed'")
    .get(session.id).n;
  if (booked >= session.capacity) return fail(409, 'This training session is fully booked');

  if (remainingSessions(db, booking.student_id) < 1) return fail(400, 'No sessions remaining. Renew the plan to confirm this booking');

  db.prepare("UPDATE bookings SET status = 'confirmed', updated_at = datetime('now') WHERE id = ?").run(booking.id);
  notify(db, booking.student_id, 'Booking confirmed', `${session.title} at ${session.venue}, ${new Date(session.starts_at).toUTCString()}`);
  return true;
}

// Called after a payment activates a plan, so waiting public bookings get their seat.
export function confirmPendingPublic(db, studentId) {
  const pending = db
    .prepare("SELECT * FROM bookings WHERE student_id = ? AND type = 'public' AND status = 'pending' ORDER BY id")
    .all(studentId);
  for (const booking of pending) confirmPublic(db, booking, false);
}

// Private trainings stay pending until an admin has called the student and set a time.
function createPrivateBooking(db, studentId, body, actorId) {
  const venue = requiredText(body, 'venue_address', 300);
  const preferred = requiredText(body, 'preferred_times', 500);
  // Optional: a student may not have a number yet. The admin can use the phone on the student's profile.
  const phone = requireString(body, 'contact_phone', { max: 30, optional: true });
  if (phone && !PHONE_RE.test(phone)) throw badRequest('Contact phone number is invalid');
  const notes = requireString(body, 'notes', { max: 1000, optional: true });

  const info = db
    .prepare(
      `INSERT INTO bookings (student_id, type, status, venue_address, preferred_times, contact_phone, notes)
       VALUES (?, 'private', 'pending', ?, ?, ?, ?)`
    )
    .run(studentId, venue, preferred, phone, notes);
  const id = Number(info.lastInsertRowid);
  for (const admin of db.prepare("SELECT id FROM users WHERE role = 'admin' AND active = 1").all()) {
    notify(db, admin.id, 'New private training request', `Booking #${id} at ${venue}`);
  }
  audit(db, actorId, 'create', 'booking', id, { type: 'private' });
  return id;
}

// Records the coach's attendance for a training and keeps the plan in sync:
// present/late uses a session, changing back to another status returns it.
export function markTrainingAttendance(db, booking, status) {
  let warning = false;
  if (CONSUMES.has(status) && !booking.subscription_id) {
    const subscriptionId = consumeSession(db, booking.student_id);
    db.prepare('UPDATE bookings SET subscription_id = ? WHERE id = ?').run(subscriptionId, booking.id);
    warning = !subscriptionId;
  } else if (!CONSUMES.has(status) && booking.subscription_id) {
    releaseSession(db, booking);
  }
  db.prepare("UPDATE bookings SET attendance = ?, updated_at = datetime('now') WHERE id = ?").run(status, booking.id);
  return { warning };
}
