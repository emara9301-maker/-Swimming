import { badRequest, notFound, HttpError, requireString, requireInt, audit, notify } from './http.js';

const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

function requiredText(body, field, max) {
  const value = requireString(body, field, { max });
  if (!value) throw badRequest(`Field ${field} is required`);
  return value;
}

// Creates a booking for a student. Shared by the booking endpoint and by
// registration, so both paths apply the same rules. Call it inside a transaction.
export function createBooking(db, studentId, body, actorId) {
  const type = requireString(body, 'type', { max: 10 });
  if (type === 'public') return createPublicBooking(db, studentId, body, actorId);
  if (type === 'private') return createPrivateBooking(db, studentId, body, actorId);
  throw badRequest('Booking type must be public or private');
}

// Public sessions are confirmed at once, as long as seats are left.
function createPublicBooking(db, studentId, body, actorId) {
  const sessionId = requireInt(body, 'training_session_id', { min: 1 });
  const session = db.prepare('SELECT * FROM training_sessions WHERE id = ? AND active = 1').get(sessionId);
  if (!session) throw notFound('Training session');
  if (session.starts_at <= new Date().toISOString()) throw badRequest('This training session has already started');

  const booked = db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE training_session_id = ? AND status = 'confirmed'")
    .get(sessionId).n;
  if (booked >= session.capacity) throw new HttpError(409, 'This training session is fully booked');

  const existing = db
    .prepare("SELECT 1 FROM bookings WHERE student_id = ? AND training_session_id = ? AND status != 'cancelled'")
    .get(studentId, sessionId);
  if (existing) throw new HttpError(409, 'You have already booked this session');

  const info = db
    .prepare(
      `INSERT INTO bookings (student_id, type, status, training_session_id, starts_at, ends_at, coach_id)
       VALUES (?, 'public', 'confirmed', ?, ?, ?, ?)`
    )
    .run(studentId, sessionId, session.starts_at, session.ends_at, session.coach_id);
  const id = Number(info.lastInsertRowid);
  audit(db, actorId, 'create', 'booking', id, { type: 'public' });
  notify(db, studentId, 'Booking confirmed', `${session.title} at ${session.venue}, ${new Date(session.starts_at).toUTCString()}`);
  return id;
}

// Private trainings stay pending until an admin has called the student and
// confirmed a time.
function createPrivateBooking(db, studentId, body, actorId) {
  const venue = requiredText(body, 'venue_address', 300);
  const preferred = requiredText(body, 'preferred_times', 500);
  const phone = requiredText(body, 'contact_phone', 30);
  if (!PHONE_RE.test(phone)) throw badRequest('Contact phone number is invalid');
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
