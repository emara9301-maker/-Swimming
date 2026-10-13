export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const forbidden = () => new HttpError(403, 'You do not have permission for this action');
export const notFound = (what = 'Item') => new HttpError(404, `${what} not found`);

// Returns a positive integer from a route param or body field, or throws 400.
export function toId(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${name}`);
  return n;
}

export function requireString(body, field, { max = 255, optional = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`Field ${field} is required`);
  }
  if (typeof v !== 'string' || v.trim().length > max) throw badRequest(`Field ${field} is invalid`);
  return v.trim();
}

export function requireInt(body, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`Field ${field} is required`);
  }
  if (!Number.isInteger(v) || v < min || v > max) throw badRequest(`Field ${field} is out of the allowed range`);
  return v;
}

export function requireDate(body, field, { optional = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`Field ${field} is required`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`Invalid date for ${field}`);
  return d.toISOString();
}

// Offset pagination with a hard cap so list endpoints stay bounded.
export function paging(query) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
}

export function audit(db, userId, action, entity, entityId, meta = null) {
  db.prepare(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, meta) VALUES (?, ?, ?, ?, ?)'
  ).run(userId ?? null, action, entity, entityId == null ? null : String(entityId), meta ? JSON.stringify(meta) : null);
}

export function notify(db, userId, title, body = null) {
  db.prepare('INSERT INTO notifications (user_id, title, body) VALUES (?, ?, ?)').run(userId, title, body);
}
