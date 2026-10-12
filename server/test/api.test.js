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
