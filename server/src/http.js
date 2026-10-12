export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (msg) => new HttpError(400, msg);
export const forbidden = () => new HttpError(403, 'ليس لديك صلاحية لهذا الإجراء');
export const notFound = (what = 'العنصر') => new HttpError(404, `${what} غير موجود`);

// Returns a positive integer from a route param or body field, or throws 400.
export function toId(value, name = 'id') {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`${name} غير صالح`);
  return n;
}

export function requireString(body, field, { max = 255, optional = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`الحقل ${field} مطلوب`);
  }
  if (typeof v !== 'string' || v.trim().length > max) throw badRequest(`الحقل ${field} غير صالح`);
  return v.trim();
}

export function requireInt(body, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`الحقل ${field} مطلوب`);
  }
  if (!Number.isInteger(v) || v < min || v > max) throw badRequest(`الحقل ${field} خارج النطاق المسموح`);
  return v;
}

export function requireDate(body, field, { optional = false } = {}) {
  const v = body?.[field];
  if (v === undefined || v === null || v === '') {
    if (optional) return null;
    throw badRequest(`الحقل ${field} مطلوب`);
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`تاريخ ${field} غير صالح`);
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
