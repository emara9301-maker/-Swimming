import crypto from 'node:crypto';
import { HttpError, forbidden } from './http.js';

const isProd = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

// Minimal signed token (HMAC-SHA256). Swap for a standard JWT library if you
// need key rotation or third-party verification.
export function signToken(user, ttlSeconds = 12 * 60 * 60) {
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + ttlSeconds })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return null;
  }
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
  return data;
}

// Loads the user from the token on every request so deactivated accounts
// and role changes take effect immediately.
export function authenticate(db) {
  const findUser = db.prepare('SELECT id, name, email, role, active FROM users WHERE id = ?');
  return (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const claims = match && verifyToken(match[1]);
    if (!claims) return next(new HttpError(401, 'يجب تسجيل الدخول'));
    const user = findUser.get(claims.sub);
    if (!user || !user.active) return next(new HttpError(401, 'الحساب غير متاح'));
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
    next();
  };
}

export function requireRole(...roles) {
  return (req, res, next) => (roles.includes(req.user?.role) ? next() : next(forbidden()));
}
