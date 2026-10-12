import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { authenticate } from './auth.js';
import authRoutes from './routes/auth.js';
import classRoutes from './routes/classes.js';
import studentRoutes from './routes/students.js';
import attendanceRoutes from './routes/attendance.js';
import progressRoutes from './routes/progress.js';
import billingRoutes, { paymentWebhookRouter } from './routes/billing.js';
import notificationRoutes from './routes/notifications.js';
import adminRoutes from './routes/admin.js';
import { HttpError } from './http.js';

// One line per request: method, path, status, duration. Never logs bodies or tokens.
function requestLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    if (process.env.NODE_ENV !== 'test') {
      console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    }
  });
  next();
}

export function createApp(db, { webDistDir } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(requestLogger);
  // Keep the raw body so webhook signatures can be verified exactly as sent.
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes(db));
  app.use('/api', paymentWebhookRouter(db));

  // Authenticated routers. Order matters only for the admin router, which
  // applies admin-only middleware to everything that reaches it, so it goes last.
  app.use(
    '/api',
    authenticate(db),
    classRoutes(db),
    studentRoutes(db),
    attendanceRoutes(db),
    progressRoutes(db),
    billingRoutes(db),
    notificationRoutes(db)
  );
  app.use('/api', adminRoutes(db));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

  if (webDistDir && fs.existsSync(webDistDir)) {
    app.use(express.static(webDistDir));
    app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(webDistDir, 'index.html')));
  }

  // Error handler: known HTTP errors pass their message; anything else is logged and hidden.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.status === 413) return res.status(413).json({ error: 'Payload too large' });
    if (err.code === 'ERR_SQLITE_CONSTRAINT' || /constraint failed/i.test(err.message || '')) {
      return res.status(409).json({ error: 'The data conflicts with an existing record' });
    }
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
