// Payment provider boundary. The app only talks to this module, so a real
// gateway (Paymob, Fawry, Stripe, ...) can be plugged in here without touching
// the billing routes. Today: a signed webhook plus manual confirmation.
import crypto from 'node:crypto';

const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret';

export function signWebhook(rawBody) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex');
}

export function verifyWebhook(rawBody, signature) {
  const expected = Buffer.from(signWebhook(rawBody));
  const given = Buffer.from(String(signature || ''));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}
