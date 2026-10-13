import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { seedBasics, ensureAdmin } from '../src/seed.js';
import { signWebhook } from '../src/payments.js';

let server;
let base;
let db;
const tok = {};

async function api(method, url, { as, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (as) headers.authorization = `Bearer ${tok[as]}`;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

before(async () => {
  process.env.NODE_ENV = 'test';
  db = openDb(':memory:');
  seedBasics(db);
  ensureAdmin(db, { email: 'admin@academy.test', password: 'admin-pass-123' });
  const app = createApp(db);
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      base = `http://127.0.0.1:${server.address().port}/api`;
      resolve();
    });
  });
  tok.admin = (await api('POST', '/auth/login', { body: { email: 'admin@academy.test', password: 'admin-pass-123' } })).body.token;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('student self-registers and logs in; wrong password is rejected', async () => {
  const reg = await api('POST', '/auth/register', {
    body: { name: 'Sara', email: 'sara@test.dev', password: 'secret-pass-1', birth_date: '2015-04-01' },
  });
  assert.equal(reg.status, 201);
  assert.equal(reg.body.user.role, 'student');
  tok.student = reg.body.token;

  const bad = await api('POST', '/auth/login', { body: { email: 'sara@test.dev', password: 'nope-nope' } });
  assert.equal(bad.status, 401);
  const ok = await api('POST', '/auth/login', { body: { email: 'sara@test.dev', password: 'secret-pass-1' } });
  assert.equal(ok.status, 200);
});

test('unauthenticated and student requests to admin areas are refused', async () => {
  assert.equal((await api('GET', '/students')).status, 401);
  assert.equal((await api('GET', '/students', { as: 'student' })).status, 403);
  assert.equal((await api('GET', '/admin/stats', { as: 'student' })).status, 403);
});

test('admin creates a coach, a class, a lesson; student enrolls', async () => {
  const coach = await api('POST', '/admin/users', {
    as: 'admin',
    body: { name: 'Coach Ahmed', email: 'coach@test.dev', password: 'coach-pass-1', role: 'coach', specialty: 'Freestyle' },
  });
  assert.equal(coach.status, 201);
  tok.coach = (await api('POST', '/auth/login', { body: { email: 'coach@test.dev', password: 'coach-pass-1' } })).body.token;

  const cls = await api('POST', '/classes', {
    as: 'admin',
    body: { name: 'Beginners Kids', sport_id: 1, level_id: 1, coach_id: coach.body.id, capacity: 2 },
  });
  assert.equal(cls.status, 201);
  tok.classId = cls.body.id;

  const lesson = await api('POST', `/classes/${cls.body.id}/lessons`, {
    as: 'coach',
    body: { starts_at: '2026-11-01T17:00:00Z', ends_at: '2026-11-01T18:00:00Z', location: 'Pool 1' },
  });
  assert.equal(lesson.status, 201);
  tok.lessonId = lesson.body.id;

  const me = await api('POST', '/auth/login', { body: { email: 'sara@test.dev', password: 'secret-pass-1' } });
  tok.studentId = me.body.user.id;
  const enroll = await api('POST', `/classes/${cls.body.id}/enrollments`, { as: 'student' });
  assert.equal(enroll.status, 201);
});

test('attendance needs an active subscription session; present consumes one', async () => {
  // Plan of 2 sessions, paid through the signed webhook.
  const price = await api('POST', '/prices', {
    as: 'admin',
    body: { name: '2-session plan', sessions_count: 2, validity_days: 30, amount_cents: 50000 },
  });
  const buy = await api('POST', '/subscriptions', { as: 'student', body: { price_id: price.body.id } });
  assert.equal(buy.status, 201);

  const hook = JSON.stringify({ payment_id: buy.body.paymentId, status: 'paid', provider_ref: 'TX-1' });
  const bad = await fetch(base + '/payments/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': 'bogus' }, body: hook,
  });
  assert.equal(bad.status, 401);
  const good = await fetch(base + '/payments/webhook', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-signature': signWebhook(hook) }, body: hook,
  });
  assert.equal(good.status, 200);

  const marked = await api('PUT', `/lessons/${tok.lessonId}/attendance`, {
    as: 'coach', body: { records: [{ student_id: tok.studentId, status: 'present' }] },
  });
  assert.equal(marked.status, 200);

  const sub = await api('GET', '/subscriptions', { as: 'student' });
  assert.equal(sub.body.sessions_remaining, 1);

  // Switching back to absent releases the session again.
  await api('PUT', `/lessons/${tok.lessonId}/attendance`, {
    as: 'coach', body: { records: [{ student_id: tok.studentId, status: 'absent' }] },
  });
  assert.equal((await api('GET', '/subscriptions', { as: 'student' })).body.sessions_remaining, 2);
});

test('coach sees only students of own classes; notes stay hidden from students', async () => {
  assert.equal((await api('GET', `/students/${tok.studentId}`, { as: 'coach' })).status, 200);
  const other = await api('POST', '/auth/register', {
    body: { name: 'Omar', email: 'omar@test.dev', password: 'secret-pass-2' },
  });
  const otherId = other.body.user.id;
  assert.equal((await api('GET', `/students/${otherId}`, { as: 'coach' })).status, 403);

  const note = await api('POST', `/students/${tok.studentId}/notes`, { as: 'coach', body: { body: 'Improved breathing' } });
  assert.equal(note.status, 201);
  assert.equal((await api('GET', `/students/${tok.studentId}/notes`, { as: 'student' })).status, 403);
});

test('level change is recorded and the student is notified', async () => {
  const res = await api('POST', `/students/${tok.studentId}/level`, { as: 'coach', body: { level_id: 2 } });
  assert.equal(res.status, 200);
  const progress = await api('GET', `/students/${tok.studentId}/progress`, { as: 'student' });
  assert.equal(progress.body.level_history.length, 1);
  const notes = await api('GET', '/notifications', { as: 'student' });
  assert.ok(notes.body.items.some((n) => n.title.includes('promoted')));
});

test('evaluation rejects out-of-range scores; payment creates an invoice', async () => {
  assert.equal((await api('POST', `/students/${tok.studentId}/evaluations`, { as: 'coach', body: { score: 9 } })).status, 400);
  assert.equal((await api('POST', `/students/${tok.studentId}/evaluations`, { as: 'coach', body: { score: 4 } })).status, 201);
  const payments = await api('GET', '/payments', { as: 'student' });
  const inv = await api('GET', `/invoices/${payments.body.items[0].id}`, { as: 'student' });
  assert.equal(inv.status, 200);
  assert.match(inv.body.invoice.number, /^INV-\d{4}-\d{6}$/);
});

test('admin stats and audit log are available to admins only', async () => {
  const stats = await api('GET', '/admin/stats', { as: 'admin' });
  assert.equal(stats.status, 200);
  assert.ok(stats.body.students >= 2);
  const audit = await api('GET', '/admin/audit', { as: 'admin' });
  assert.ok(audit.body.items.length > 0);
});

// Pays for a plan as the student and confirms the payment as admin.
async function buyPlan(as, priceId) {
  const buy = await api('POST', '/subscriptions', { as, body: { price_id: priceId } });
  assert.equal(buy.status, 201);
  const paid = await api('POST', `/payments/${buy.body.paymentId}/confirm`, { as: 'admin' });
  assert.equal(paid.status, 200);
}
const remaining = async (as) => (await api('GET', '/subscriptions', { as })).body.sessions_remaining;

test('training attendance by the coach uses the plan; booking alone does not', async () => {
  const days = (n) => new Date(Date.now() + n * 864e5).toISOString();
  const coach = await api('POST', '/admin/users', {
    as: 'admin', body: { name: 'Coach Dina', email: 'dina@test.dev', password: 'coach-pass-3', role: 'coach' },
  });
  tok.dina = (await api('POST', '/auth/login', { body: { email: 'dina@test.dev', password: 'coach-pass-3' } })).body.token;
  tok.dinaId = coach.body.id;

  const price = await api('POST', '/prices', {
    as: 'admin', body: { name: 'Booking plan', sessions_count: 2, validity_days: 30, amount_cents: 1000 },
  });
  const session = await api('POST', '/admin/training-sessions', {
    as: 'admin', body: { title: 'Open water', venue: 'Main pool', starts_at: days(3), ends_at: days(3.05), capacity: 1, coach_id: tok.dinaId },
  });
  assert.equal(session.status, 201);
  assert.ok((await api('GET', '/training-sessions')).body.items.some((s) => s.id === session.body.id));

  // Sign-up without a plan: the booking waits.
  const layla = await api('POST', '/auth/register', {
    body: { name: 'Layla', email: 'layla@test.dev', password: 'secret-pass-3', booking: { type: 'public', training_session_id: session.body.id } },
  });
  assert.equal(layla.status, 201);
  tok.layla = layla.body.token;
  assert.equal((await api('GET', '/bookings', { as: 'layla' })).body.items[0].status, 'pending');

  // Paying a plan confirms the booking, but nothing is deducted yet.
  await buyPlan('layla', price.body.id);
  const laylaBooking = (await api('GET', '/bookings', { as: 'layla' })).body.items[0];
  assert.equal(laylaBooking.status, 'confirmed');
  assert.equal(await remaining('layla'), 2);

  // Coach marks attendance: present uses a session, absent gives it back.
  const bookingUrl = `/bookings/${laylaBooking.id}/attendance`;
  assert.equal((await api('PUT', bookingUrl, { as: 'dina', body: { status: 'present' } })).status, 200);
  assert.equal(await remaining('layla'), 1);
  await api('PUT', bookingUrl, { as: 'dina', body: { status: 'absent' } });
  assert.equal(await remaining('layla'), 2);
  await api('PUT', bookingUrl, { as: 'dina', body: { status: 'late' } });
  assert.equal(await remaining('layla'), 1);

  // Students cannot mark attendance, and cancelling returns the used session.
  assert.equal((await api('PUT', bookingUrl, { as: 'layla', body: { status: 'present' } })).status, 403);
  await api('POST', `/bookings/${laylaBooking.id}/cancel`, { as: 'layla' });
  assert.equal(await remaining('layla'), 2);

  // The freed seat goes to the next student.
  const nour = await api('POST', '/auth/register', {
    body: { name: 'Nour', email: 'nour@test.dev', password: 'secret-pass-4', booking: { type: 'public', training_session_id: session.body.id } },
  });
  tok.nour = nour.body.token;
  await buyPlan('nour', price.body.id);
  assert.equal((await api('GET', '/bookings', { as: 'nour' })).body.items[0].status, 'confirmed');

  // Seat is full: a third student stays pending even with a plan.
  const third = await api('POST', '/auth/register', {
    body: { name: 'Hana', email: 'hana@test.dev', password: 'secret-pass-7', booking: { type: 'public', training_session_id: session.body.id } },
  });
  tok.hana = third.body.token;
  await buyPlan('hana', price.body.id);
  assert.equal((await api('GET', '/bookings', { as: 'hana' })).body.items[0].status, 'pending');
});

test('private training: confirm needs a session, attendance deducts', async () => {
  const priv = await api('POST', '/auth/register', {
    body: {
      name: 'Karim', email: 'karim@test.dev', password: 'secret-pass-5',
      booking: { type: 'private', venue_address: '12 Nile St, Cairo', preferred_times: 'Sat 5-7 PM', contact_phone: '+20 100 000 0000' },
    },
  });
  assert.equal(priv.status, 201);
  tok.karim = priv.body.token;
  const pending = await api('GET', '/bookings?status=pending', { as: 'admin' });
  const req = pending.body.items.find((b) => b.student_id === priv.body.user.id);
  assert.ok(req, 'admin sees the pending request');

  const starts = new Date(Date.now() + 5 * 864e5).toISOString();
  const ends = new Date(Date.now() + 5 * 864e5 + 3600e3).toISOString();
  const body = { status: 'confirmed', starts_at: starts, ends_at: ends, coach_id: tok.dinaId };
  // No plan yet: confirmation is refused.
  assert.equal((await api('PATCH', `/admin/bookings/${req.id}`, { as: 'admin', body })).status, 400);

  const price = await api('GET', '/prices', { as: 'admin' });
  await buyPlan('karim', price.body.items[0].id);
  const before = await remaining('karim');
  assert.equal((await api('PATCH', `/admin/bookings/${req.id}`, { as: 'admin', body })).status, 200);
  assert.equal(await remaining('karim'), before, 'confirming does not deduct');

  assert.equal((await api('PUT', `/bookings/${req.id}/attendance`, { as: 'dina', body: { status: 'present' } })).status, 200);
  assert.equal(await remaining('karim'), before - 1, 'attendance deducts');
});

test('a failed booking during sign-up rolls back the account', async () => {
  const bad = await api('POST', '/auth/register', {
    body: { name: 'Retry', email: 'retry@test.dev', password: 'secret-pass-6', booking: { type: 'private', venue_address: 'x' } },
  });
  assert.equal(bad.status, 400);
  const again = await api('POST', '/auth/register', { body: { name: 'Retry', email: 'retry@test.dev', password: 'secret-pass-6' } });
  assert.equal(again.status, 201);
});

test('students cannot manage training sessions', async () => {
  const res = await api('POST', '/admin/training-sessions', {
    as: 'karim', body: { title: 'x', venue: 'y', starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 1e6).toISOString(), capacity: 2 },
  });
  assert.equal(res.status, 403);
});
