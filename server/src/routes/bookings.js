import express from 'express';
import { requireRole } from '../auth.js';
import { requireString, requireInt, requireDate, badRequest, notFound, forbidden, toId, paging, audit, notify } from '../http.js';
import { createBooking, confirmPublic, consumeSession, releaseSession } from '../bookings.js';

const SESSION_SELECT = `
  SELECT t.id, t.title, t.venue, t.starts_at, t.ends_at, t.capacity, t.coach_id, t.active, u.name AS coach_name,
         (SELECT COUNT(*) FROM bookings b WHERE b.training_session_id = t.id AND b.status = 'confirmed') AS booked
  FROM training_sessions t
  LEFT JOIN users u ON u.id = t.coach_id`;

const BOOKING_SELECT = `
  SELECT b.id, b.student_id, s.name AS student_name, b.type, b.status, b.training_session_id,
         t.title AS session_title, COALESCE(t.venue, b.venue_address) AS venue,
         b.venue_address, b.preferred_times, b.contact_phone, b.notes,
         b.starts_at, b.ends_at, b.coach_id, c.name AS coach_name, b.created_at
  FROM bookings b
  JOIN users s ON s.id = b.student_id
  LEFT JOIN training_sessions t ON t.id = b.training_session_id
  LEFT JOIN users c ON c.id = b.coach_id`;

// Public (no login): lets the registration page list open sessions.
export function publicBookingRouter(db) {
  const r = express.Router();
  r.get('/training-sessions', (req, res) => {
    const rows = db
      .prepare(`${SESSION_SELECT} WHERE t.active = 1 AND t.starts_at > ? ORDER BY t.starts_at LIMIT 100`)
      .all(new Date().toISOString());
    res.json({ items: rows });
  });
  return r;
}

function cancelBooking(db, booking, actorId, tellStudent) {
  releaseSession(db, booking);
  db.prepare("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(booking.id);
  if (tellStudent) notify(db, booking.student_id, 'Booking cancelled', 'Your training booking was cancelled by the academy');
  audit(db, actorId, 'cancel', 'booking', booking.id);
}

export default function bookingRoutes(db) {
  const r = express.Router();

  // Students book for themselves; admins can book for any student.
  r.post('/bookings', requireRole('student', 'admin'), (req, res) => {
    const studentId = req.user.role === 'student' ? req.user.id : requireInt(req.body, 'student_id', { min: 1 });
    if (!db.prepare('SELECT 1 FROM students WHERE user_id = ?').get(studentId)) throw notFound('Student');
    const id = db.transaction(() => createBooking(db, studentId, req.body, req.user.id))();
    res.status(201).json({ id });
  });

  // Students see their own bookings; admins see all (optionally filtered by status).
  r.get('/bookings', (req, res) => {
    if (req.user.role !== 'student' && req.user.role !== 'admin') throw forbidden();
    const { limit, offset } = paging(req.query);
    const where = [];
    const args = [];
    if (req.user.role === 'student') {
      where.push('b.student_id = ?');
      args.push(req.user.id);
    }
    if (req.query.status) {
      where.push('b.status = ?');
      args.push(requireString(req.query, 'status', { max: 20 }));
    }
    const rows = db
      .prepare(`${BOOKING_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
    res.json({ items: rows });
  });

  r.post('/bookings/:id/cancel', (req, res) => {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(toId(req.params.id));
    if (!booking) throw notFound('Booking');
    if (req.user.role !== 'admin' && req.user.id !== booking.student_id) throw forbidden();
    if (booking.status === 'cancelled') throw badRequest('Booking is already cancelled');
    cancelBooking(db, booking, req.user.id, req.user.role === 'admin');
    res.json({ ok: true });
  });

  // Admin: list training sessions with seat counts.
  r.get('/admin/training-sessions', requireRole('admin'), (req, res) => {
    res.json({ items: db.prepare(`${SESSION_SELECT} ORDER BY t.starts_at DESC LIMIT 200`).all() });
  });

  r.post('/admin/training-sessions', requireRole('admin'), (req, res) => {
    const title = requireString(req.body, 'title', { max: 120 });
    const venue = requireString(req.body, 'venue', { max: 300 });
    const startsAt = requireDate(req.body, 'starts_at');
    const endsAt = requireDate(req.body, 'ends_at');
    if (endsAt <= startsAt) throw badRequest('End time must be after start time');
    const capacity = requireInt(req.body, 'capacity', { min: 1, max: 200 });
    const coachId = requireInt(req.body, 'coach_id', { min: 1, optional: true });
    if (coachId && !db.prepare('SELECT 1 FROM coaches WHERE user_id = ?').get(coachId)) throw badRequest('Coach not found');
    const info = db
      .prepare('INSERT INTO training_sessions (title, venue, starts_at, ends_at, capacity, coach_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(title, venue, startsAt, endsAt, capacity, coachId);
    audit(db, req.user.id, 'create', 'training_session', info.lastInsertRowid);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/admin/training-sessions/:id', requireRole('admin'), (req, res) => {
    const id = toId(req.params.id);
    if (typeof req.body?.active !== 'boolean') throw badRequest('active must be true or false');
    const info = db.prepare('UPDATE training_sessions SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
    if (info.changes === 0) throw notFound('Training session');
    audit(db, req.user.id, 'update', 'training_session', id, { active: req.body.active });
    res.json({ ok: true });
  });

  // Admin confirms a private request with a time (and optional coach), or cancels a booking.
  r.patch('/admin/bookings/:id', requireRole('admin'), (req, res) => {
    const id = toId(req.params.id);
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) throw notFound('Booking');
    if (booking.status === 'cancelled') throw badRequest('Cancelled bookings cannot be changed');

    const status = requireString(req.body, 'status', { max: 20 });
    if (status === 'cancelled') {
      cancelBooking(db, booking, req.user.id, true);
      return res.json({ ok: true });
    }
    if (status !== 'confirmed') throw badRequest('status must be confirmed or cancelled');
    if (booking.status === 'confirmed') throw badRequest('Booking is already confirmed');

    // Public bookings already have their time from the session.
    if (booking.type === 'public') {
      confirmPublic(db, booking, true);
      audit(db, req.user.id, 'confirm', 'booking', id);
      return res.json({ ok: true });
    }

    const startsAt = requireDate(req.body, 'starts_at');
    const endsAt = requireDate(req.body, 'ends_at');
    if (endsAt <= startsAt) throw badRequest('End time must be after start time');
    if (startsAt <= new Date().toISOString()) throw badRequest('Start time must be in the future');
    const coachId = requireInt(req.body, 'coach_id', { min: 1, optional: true });
    if (coachId && !db.prepare('SELECT 1 FROM coaches WHERE user_id = ?').get(coachId)) throw badRequest('Coach not found');

    const subscriptionId = consumeSession(db, booking.student_id);
    if (!subscriptionId) throw badRequest('The student has no sessions remaining. Renew the plan first');
    db.prepare(
      "UPDATE bookings SET status = 'confirmed', starts_at = ?, ends_at = ?, coach_id = ?, subscription_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(startsAt, endsAt, coachId, subscriptionId, id);
    notify(db, booking.student_id, 'Training confirmed', `Your training at ${booking.venue_address} starts ${new Date(startsAt).toUTCString()}`);
    audit(db, req.user.id, 'confirm', 'booking', id);
    res.json({ ok: true });
  });

  return r;
}
