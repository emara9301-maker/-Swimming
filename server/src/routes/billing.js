import express from 'express';
import { requireRole } from '../auth.js';
import { requireString, requireInt, badRequest, notFound, forbidden, HttpError, toId, paging, audit, notify } from '../http.js';
import { expireSubscriptions, remainingSessions } from '../access.js';
import { verifyWebhook } from '../payments.js';
import { confirmPendingPublic } from '../bookings.js';

const pad = (n) => String(n).padStart(6, '0');

// Marks a payment as paid, activates its subscription and issues an invoice.
// Runs in one transaction so a partial failure cannot charge without activating.
function markPaid(db, paymentId, providerRef, actorId) {
  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  if (!payment) throw notFound('Payment');
  if (payment.status === 'paid') return payment;
  if (payment.status !== 'pending') throw badRequest('This payment cannot be confirmed');

  db.transaction(() => {
    db.prepare("UPDATE payments SET status = 'paid', paid_at = datetime('now'), provider_ref = COALESCE(?, provider_ref) WHERE id = ?")
      .run(providerRef, paymentId);
    const sub = db.prepare('SELECT p.validity_days FROM subscriptions s JOIN prices p ON p.id = s.price_id WHERE s.id = ?')
      .get(payment.subscription_id);
    db.prepare(
      `UPDATE subscriptions SET status = 'active', starts_at = datetime('now'),
       ends_at = datetime('now', '+' || ? || ' days') WHERE id = ?`
    ).run(sub.validity_days, payment.subscription_id);
    const info = db.prepare('INSERT INTO invoices (payment_id, number, total_cents) VALUES (?, ?, ?)')
      .run(paymentId, 'TMP', payment.amount_cents);
    db.prepare("UPDATE invoices SET number = ? WHERE id = ?")
      .run(`INV-${new Date().getFullYear()}-${pad(info.lastInsertRowid)}`, info.lastInsertRowid);
    notify(db, payment.student_id, 'Payment confirmed', 'Your subscription is now active');
    confirmPendingPublic(db, payment.student_id);
    audit(db, actorId, 'payment_paid', 'payment', paymentId, { provider_ref: providerRef });
  })();
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
}

export default function billingRoutes(db) {
  const r = express.Router();

  r.get('/prices', (req, res) => {
    const rows = db.prepare(
      `SELECT id, name, sessions_count, validity_days, amount_cents FROM prices
       ${req.user.role === 'admin' ? '' : 'WHERE active = 1'} ORDER BY amount_cents`
    ).all();
    res.json({ items: rows });
  });

  r.post('/prices', requireRole('admin'), (req, res) => {
    const name = requireString(req.body, 'name', { max: 120 });
    const sessions = requireInt(req.body, 'sessions_count', { min: 1, max: 1000 });
    const validity = requireInt(req.body, 'validity_days', { min: 1, max: 730 });
    const amount = requireInt(req.body, 'amount_cents', { min: 0 });
    const info = db.prepare('INSERT INTO prices (name, sessions_count, validity_days, amount_cents) VALUES (?, ?, ?, ?)')
      .run(name, sessions, validity, amount);
    audit(db, req.user.id, 'create', 'price', info.lastInsertRowid);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  r.patch('/prices/:id', requireRole('admin'), (req, res) => {
    const id = toId(req.params.id);
    if (typeof req.body.active === 'boolean') {
      db.prepare('UPDATE prices SET active = ? WHERE id = ?').run(req.body.active ? 1 : 0, id);
    }
    if (req.body.amount_cents !== undefined) {
      db.prepare('UPDATE prices SET amount_cents = ? WHERE id = ?').run(requireInt(req.body, 'amount_cents', { min: 0 }), id);
    }
    audit(db, req.user.id, 'update', 'price', id);
    res.json({ ok: true });
  });

  function startSubscription(req, res, { studentId, priceId, method, confirm }) {
    if (req.user.role === 'coach') throw forbidden();
    if (!['online', 'card', 'cash', 'transfer'].includes(method)) throw badRequest('Invalid payment method');
    if (method !== 'online' && req.user.role !== 'admin') throw badRequest('This payment method is not available to students');

    const price = db.prepare('SELECT * FROM prices WHERE id = ? AND active = 1').get(priceId);
    if (!price) throw notFound('Plan');
    if (!db.prepare('SELECT 1 FROM students WHERE user_id = ?').get(studentId)) throw notFound('Student');

    const result = db.transaction(() => {
      const sub = db.prepare(
        `INSERT INTO subscriptions (student_id, price_id, sessions_total, status) VALUES (?, ?, ?, 'pending')`
      ).run(studentId, price.id, price.sessions_count);
      const pay = db.prepare(
        `INSERT INTO payments (student_id, subscription_id, amount_cents, method, status) VALUES (?, ?, ?, ?, 'pending')`
      ).run(studentId, sub.lastInsertRowid, price.amount_cents, method);
      return { subscriptionId: Number(sub.lastInsertRowid), paymentId: Number(pay.lastInsertRowid) };
    })();
    audit(db, req.user.id, 'subscribe', 'subscription', result.subscriptionId, { price_id: price.id });

    // Cash/transfer are confirmed by an admin; online waits for the webhook.
    if (method !== 'online' && req.user.role === 'admin' && confirm === true) {
      markPaid(db, result.paymentId, null, req.user.id);
    }
    res.status(201).json({ ...result, amount_cents: price.amount_cents });
  }

  // Buy a plan. Students buy for themselves; admins can act for any student.
  r.post('/subscriptions', (req, res) => {
    const studentId = req.user.role === 'student' ? req.user.id : requireInt(req.body, 'student_id', { min: 1 });
    startSubscription(req, res, {
      studentId,
      priceId: requireInt(req.body, 'price_id', { min: 1 }),
      method: req.body.method || 'online',
      confirm: req.body.confirm,
    });
  });

  // Renewal: same plan as an existing subscription.
  r.post('/subscriptions/:id/renew', (req, res) => {
    const old = db.prepare('SELECT student_id, price_id FROM subscriptions WHERE id = ?').get(toId(req.params.id));
    if (!old) throw notFound('Subscription');
    if (req.user.role !== 'admin' && req.user.id !== old.student_id) throw forbidden();
    startSubscription(req, res, {
      studentId: old.student_id,
      priceId: old.price_id,
      method: req.body?.method || 'online',
      confirm: req.body?.confirm,
    });
  });

  r.get('/subscriptions', (req, res) => {
    expireSubscriptions(db);
    const studentId = req.user.role === 'student' ? req.user.id : toId(req.query.student_id, 'student_id');
    if (req.user.role === 'coach') throw forbidden();
    const rows = db.prepare(
      `SELECT s.id, s.status, s.sessions_total, s.sessions_used, s.starts_at, s.ends_at, p.name AS plan_name, p.amount_cents
       FROM subscriptions s JOIN prices p ON p.id = s.price_id WHERE s.student_id = ? ORDER BY s.id DESC`
    ).all(studentId);
    res.json({ items: rows, sessions_remaining: remainingSessions(db, studentId) });
  });

  // Manual confirmation for cash/transfer payments (admin only).
  r.post('/payments/:id/confirm', requireRole('admin'), (req, res) => {
    const payment = markPaid(db, toId(req.params.id), requireString(req.body, 'provider_ref', { max: 120, optional: true }), req.user.id);
    res.json({ payment });
  });

  r.get('/payments', (req, res) => {
    if (req.user.role === 'coach') throw forbidden();
    const { limit, offset } = paging(req.query);
    const where = [];
    const args = [];
    if (req.user.role !== 'admin') {
      where.push('p.student_id = ?');
      args.push(req.user.id);
    } else if (req.query.student_id) {
      where.push('p.student_id = ?');
      args.push(toId(req.query.student_id, 'student_id'));
    }
    const rows = db.prepare(
      `SELECT p.id, p.student_id, p.amount_cents, p.method, p.status, p.created_at, p.paid_at, i.number AS invoice_number
       FROM payments p LEFT JOIN invoices i ON i.payment_id = p.id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY p.id DESC LIMIT ? OFFSET ?`
    ).all(...args, limit, offset);
    res.json({ items: rows });
  });

  r.get('/invoices/:paymentId', (req, res) => {
    const inv = db.prepare(
      `SELECT i.number, i.total_cents, i.issued_at, p.id AS payment_id, p.student_id, p.method, p.provider_ref,
              u.name AS student_name, pr.name AS plan_name
       FROM invoices i
       JOIN payments p ON p.id = i.payment_id
       JOIN users u ON u.id = p.student_id
       JOIN subscriptions s ON s.id = p.subscription_id
       JOIN prices pr ON pr.id = s.price_id
       WHERE p.id = ?`
    ).get(toId(req.params.paymentId, 'payment_id'));
    if (!inv) throw notFound('Invoice');
    if (req.user.role !== 'admin' && req.user.id !== inv.student_id) throw forbidden();
    res.json({ invoice: inv });
  });

  return r;
}

// Provider webhook: public route, authenticated by HMAC signature instead of a user token.
export function paymentWebhookRouter(db) {
  const r = express.Router();
  // Signed over the raw request body (captured in app.js).
  r.post('/payments/webhook', (req, res) => {
    if (!verifyWebhook(req.rawBody || '', req.get('x-signature'))) throw new HttpError(401, 'Invalid signature');
    const paymentId = requireInt(req.body, 'payment_id', { min: 1 });
    const status = req.body.status;
    const providerRef = requireString(req.body, 'provider_ref', { max: 120, optional: true });
    if (status !== 'paid') {
      db.prepare("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'pending'").run(paymentId);
      return res.json({ ok: true });
    }
    markPaid(db, paymentId, providerRef, null);
    res.json({ ok: true });
  });
  return r;
}
