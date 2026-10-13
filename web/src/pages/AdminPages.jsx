import React, { useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useData, useAction, Card, Stat, Table, Form, Tabs, Notice, Loading, fmtDate, fmtTime, fmtMoney, toLocalInput } from '../lib/ui.jsx';
import { TrainingAttendance } from '../lib/TrainingAttendance.jsx';

const ROLE_LABELS = { student: 'Student', coach: 'Coach', admin: 'Admin' };
const BOOKING_STATUS = { pending: 'Awaiting confirmation', confirmed: 'Confirmed', cancelled: 'Cancelled' };
const PAY_STATUS = { paid: 'Paid', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' };
const toOptions = (items, labelKey = 'name') => (items || []).map((i) => ({ value: i.id, label: i[labelKey] }));

export function AdminDashboard() {
  const stats = useData(() => get('/admin/stats'));
  const revenue = useData(() => get('/reports/revenue'));
  const { run, msg } = useAction();
  if (stats.error) return <Loading error={stats.error} />;
  if (!stats.data) return <Loading />;
  const s = stats.data;
  return (
    <div className="grid">
      <Card title="Overview" className="span-2">
        <div className="stats">
          <Stat label="Students" value={s.students} />
          <Stat label="Coaches" value={s.coaches} />
          <Stat label="Active classes" value={s.active_classes} />
          <Stat label="Active subscriptions" value={s.active_subscriptions} />
          <Stat label="Revenue" value={fmtMoney(s.revenue_cents)} />
          <Stat label="Pending payments" value={s.pending_payments} />
          <Stat label="Attendance" value={s.attendance_rate != null ? `${s.attendance_rate}%` : '—'} />
        </div>
      </Card>
      <Card title="Monthly revenue">
        <Table rows={revenue.data?.items} columns={[
          { key: 'month', label: 'Month' },
          { key: 'payments', label: 'Payments' },
          { key: 'total_cents', label: 'Total', render: (r) => fmtMoney(r.total_cents) },
        ]} />
      </Card>
      <Card title="Send broadcast notification">
        <Notice msg={msg} />
        <Form
          fields={[
            { name: 'title', label: 'Title', required: true },
            { name: 'body', label: 'Message' },
            { name: 'role', label: 'Recipients', options: [{ value: 'student', label: 'Students' }, { value: 'coach', label: 'Coaches' }, { value: 'admin', label: 'Admins' }] },
          ]}
          submitLabel="Send"
          onSubmit={(v) => run(() => post('/notifications/broadcast', { title: v.title, body: v.body || undefined, role: v.role || undefined }), 'Notification sent').then((r) => !!r)}
        />
      </Card>
    </div>
  );
}

export function AdminUsers() {
  const [role, setRole] = useState('');
  const users = useData(() => get(`/admin/users?limit=100${role ? `&role=${role}` : ''}`), [role]);
  const { run, msg, busy } = useAction();
  const changeRole = (u, next) => run(() => patch(`/admin/users/${u.id}`, { role: next }), 'Role updated').then(users.reload);
  const toggle = (u) => run(() => patch(`/admin/users/${u.id}`, { active: !u.active }), 'Account updated').then(users.reload);

  return (
    <div className="grid">
      <Card title="Users" actions={
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by role">
          <option value="">All</option>
          <option value="student">Students</option>
          <option value="coach">Coaches</option>
          <option value="admin">Admins</option>
        </select>
      } className="span-2">
        <Notice msg={msg} />
        {users.error ? <Loading error={users.error} /> : (
          <Table rows={users.data?.items} columns={[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'phone', label: 'Phone' },
            { key: 'role', label: 'Role', render: (r) => (
              <select value={r.role} disabled={busy} onChange={(e) => changeRole(r, e.target.value)} aria-label="Role">
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) },
            { key: 'active', label: 'Status', render: (r) => (
              <button className={r.active ? 'btn ghost' : 'btn danger'} disabled={busy} onClick={() => toggle(r)}>{r.active ? 'Active · Disable' : 'Disabled · Enable'}</button>
            ) },
          ]} />
        )}
      </Card>
      <Card title="Add coach or admin">
        <Form
          fields={[
            { name: 'name', label: 'Full name', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'password', label: 'Temporary password', type: 'password', required: true },
            { name: 'phone', label: 'Phone', type: 'tel' },
            { name: 'role', label: 'Role', required: true, options: [{ value: 'coach', label: 'Coach' }, { value: 'admin', label: 'Admin' }] },
            { name: 'specialty', label: 'Specialty' },
          ]}
          busy={busy}
          onSubmit={(v) => run(() => post('/admin/users', v), 'Account created').then((r) => { if (r) users.reload(); return !!r; })}
        />
      </Card>
    </div>
  );
}

export function AdminClasses() {
  const classes = useData(() => get('/classes?limit=200'));
  const sports = useData(() => get('/sports'));
  const levels = useData(() => get('/levels'));
  const coaches = useData(() => get('/coaches'));
  const { run, msg, busy } = useAction();
  const reload = () => classes.reload();

  return (
    <div className="grid">
      <Card title="Classes" className="span-2">
        <Notice msg={msg} />
        <Table rows={classes.data?.items} columns={[
          { key: 'name', label: 'Class' },
          { key: 'sport_name', label: 'Sport' },
          { key: 'level_name', label: 'Level' },
          { key: 'coach_name', label: 'Coach', render: (r) => r.coach_name || '—' },
          { key: 'enrolled_count', label: 'Enrolled', render: (r) => `${r.enrolled_count}/${r.capacity}` },
          { key: 'active', label: 'Status', render: (r) => (
            <button className="btn ghost" disabled={busy} onClick={() => run(() => patch(`/classes/${r.id}`, { active: !r.active }), 'Class updated').then(reload)}>
              {r.active ? 'Open · Pause' : 'Paused · Open'}
            </button>
          ) },
        ]} />
      </Card>
      <Card title="Add class">
        <Form
          busy={busy}
          fields={[
            { name: 'name', label: 'Class name', required: true },
            { name: 'sport_id', label: 'Sport', required: true, options: toOptions(sports.data?.items) },
            { name: 'level_id', label: 'Level', options: toOptions(levels.data?.items) },
            { name: 'coach_id', label: 'Coach', options: toOptions(coaches.data?.items) },
            { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 200, required: true },
          ]}
          onSubmit={(v) => run(() => post('/classes', {
            name: v.name, sport_id: Number(v.sport_id), capacity: Number(v.capacity),
            level_id: v.level_id ? Number(v.level_id) : undefined, coach_id: v.coach_id ? Number(v.coach_id) : undefined,
          }), 'Class created').then((r) => { if (r) reload(); return !!r; })}
        />
      </Card>
      <AdminTraining coaches={coaches.data?.items} />
      <Card title="Add lesson to timetable">
        <Form
          busy={busy}
          fields={[
            { name: 'class_id', label: 'Class', required: true, options: toOptions(classes.data?.items) },
            { name: 'starts_at', label: 'Starts', type: 'datetime-local', required: true },
            { name: 'ends_at', label: 'Ends', type: 'datetime-local', required: true },
            { name: 'location', label: 'Location' },
          ]}
          onSubmit={(v) => run(() => post(`/classes/${v.class_id}/lessons`, {
            starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(), location: v.location || undefined,
          }), 'Lesson added').then((r) => !!r)}
        />
        <p className="muted">Example: {toLocalInput(new Date())}</p>
      </Card>
    </div>
  );
}

// Confirms a private request: the admin calls the student, then sets the agreed time.
function ConfirmBooking({ booking, coaches, run, busy, onDone }) {
  const [v, setV] = useState({ starts_at: '', ends_at: '', coach_id: '' });
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }));
  const confirm = () => run(() => patch(`/admin/bookings/${booking.id}`, {
    status: 'confirmed',
    starts_at: new Date(v.starts_at).toISOString(),
    ends_at: new Date(v.ends_at).toISOString(),
    coach_id: v.coach_id ? Number(v.coach_id) : undefined,
  }), 'Booking confirmed and student notified').then(onDone);
  const cancel = () => window.confirm('Cancel this booking?') && run(() => patch(`/admin/bookings/${booking.id}`, { status: 'cancelled' }), 'Booking cancelled').then(onDone);
  return (
    <div className="confirm-booking">
      <input type="datetime-local" value={v.starts_at} onChange={set('starts_at')} aria-label="Start time" />
      <input type="datetime-local" value={v.ends_at} onChange={set('ends_at')} aria-label="End time" />
      <select value={v.coach_id} onChange={set('coach_id')} aria-label="Coach">
        <option value="">No coach yet</option>
        {coaches?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button className="btn primary" disabled={busy || !v.starts_at || !v.ends_at} onClick={confirm}>Confirm</button>
      <button className="btn danger" disabled={busy} onClick={cancel}>Cancel</button>
    </div>
  );
}

// Training sessions (public, with a place and time window) and booking requests.
function AdminTraining({ coaches }) {
  const sessions = useData(() => get('/admin/training-sessions'));
  const bookings = useData(() => get('/bookings?limit=100'));
  const { run, msg, busy } = useAction();
  const reloadAll = () => { sessions.reload(); bookings.reload(); };
  return (
    <>
      <Card title="Public training sessions" className="span-2">
        <Notice msg={msg} />
        <Table rows={sessions.data?.items} columns={[
          { key: 'title', label: 'Session' },
          { key: 'venue', label: 'Place' },
          { key: 'starts_at', label: 'Starts', render: (r) => fmtDate(r.starts_at) },
          { key: 'ends_at', label: 'Ends', render: (r) => fmtTime(r.ends_at) },
          { key: 'booked', label: 'Booked', render: (r) => `${r.booked}/${r.capacity}` },
          { key: 'coach_name', label: 'Coach', render: (r) => r.coach_name || '—' },
          { key: 'active', label: 'Status', render: (r) => (
            <button className="btn ghost" disabled={busy} onClick={() => run(() => patch(`/admin/training-sessions/${r.id}`, { active: !r.active }), 'Session updated').then(reloadAll)}>
              {r.active ? 'Open · Close' : 'Closed · Open'}
            </button>
          ) },
        ]} empty="No sessions yet" />
      </Card>
      <Card title="Add public session">
        <Form
          busy={busy}
          fields={[
            { name: 'title', label: 'Session name', required: true },
            { name: 'venue', label: 'Place (pool address)', required: true },
            { name: 'starts_at', label: 'Starts', type: 'datetime-local', required: true },
            { name: 'ends_at', label: 'Ends', type: 'datetime-local', required: true },
            { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 200, required: true },
            { name: 'coach_id', label: 'Coach', options: toOptions(coaches) },
          ]}
          onSubmit={(v) => run(() => post('/admin/training-sessions', {
            title: v.title, venue: v.venue, capacity: Number(v.capacity),
            starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(),
            coach_id: v.coach_id ? Number(v.coach_id) : undefined,
          }), 'Session added').then((r) => { if (r) reloadAll(); return !!r; })}
        />
      </Card>
      <Card title="Booking requests" className="span-2">
        <Table rows={bookings.data?.items} columns={[
          { key: 'student_name', label: 'Student' },
          { key: 'type', label: 'Type', render: (r) => (r.type === 'public' ? 'Public' : 'Private') },
          { key: 'venue', label: 'Place', render: (r) => r.venue || '—' },
          { key: 'preferred_times', label: 'Preferred times', render: (r) => r.preferred_times || '—' },
          { key: 'contact_phone', label: 'Phone', render: (r) => r.contact_phone || '—' },
          { key: 'starts_at', label: 'Scheduled', render: (r) => (r.starts_at ? `${fmtDate(r.starts_at)}–${fmtTime(r.ends_at)}` : '—') },
          { key: 'attendance', label: 'Attendance', render: (r) => (r.status === 'confirmed' ? <TrainingAttendance booking={r} run={run} busy={busy} onDone={reloadAll} /> : '—') },
          { key: 'status', label: 'Status', render: (r) => BOOKING_STATUS[r.status] },
          { key: 'act', label: '', render: (r) => (
            r.type === 'private' && r.status === 'pending'
              ? <ConfirmBooking booking={r} coaches={coaches} run={run} busy={busy} onDone={reloadAll} />
              : (
                <div className="row-actions">
                  {r.type === 'public' && r.status === 'pending' && (
                    <button className="btn primary" disabled={busy} onClick={() => run(() => patch(`/admin/bookings/${r.id}`, { status: 'confirmed' }), 'Booking confirmed').then(reloadAll)}>Confirm</button>
                  )}
                  {r.status !== 'cancelled' && <button className="btn ghost" disabled={busy} onClick={() => run(() => post(`/bookings/${r.id}/cancel`), 'Booking cancelled').then(reloadAll)}>Cancel</button>}
                </div>
              )
          ) },
        ]} empty="No booking requests yet" />
      </Card>
    </>
  );
}

export function AdminBilling() {
  const [tab, setTab] = useState('payments');
  const prices = useData(() => get('/prices'));
  const payments = useData(() => get('/payments?limit=100'));
  const { run, msg, busy } = useAction();
  const confirm = (p) => run(() => post(`/payments/${p.id}/confirm`), 'Payment confirmed and plan activated').then(payments.reload);

  return (
    <div className="grid">
      <Card title="Billing" className="span-2">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'payments', label: 'Payments' }, { value: 'prices', label: 'Plans' }]} />
        <Notice msg={msg} />
        {tab === 'payments' && (
          <Table rows={payments.data?.items} columns={[
            { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
            { key: 'student_id', label: 'Student ID' },
            { key: 'amount_cents', label: 'Amount', render: (r) => fmtMoney(r.amount_cents) },
            { key: 'method', label: 'Method' },
            { key: 'status', label: 'Status', render: (r) => PAY_STATUS[r.status] },
            { key: 'invoice_number', label: 'Invoice' },
            { key: 'act', label: '', render: (r) => r.status === 'pending' && (
              <button className="btn primary" disabled={busy} onClick={() => confirm(r)}>Confirm payment</button>
            ) },
          ]} />
        )}
        {tab === 'prices' && (
          <Table rows={prices.data?.items} columns={[
            { key: 'name', label: 'Plan' },
            { key: 'sessions_count', label: 'Sessions' },
            { key: 'validity_days', label: 'Validity (days)' },
            { key: 'amount_cents', label: 'Price', render: (r) => fmtMoney(r.amount_cents) },
          ]} />
        )}
      </Card>
      {tab === 'prices' && (
        <Card title="Add plan">
          <Form
            busy={busy}
            fields={[
              { name: 'name', label: 'Plan name', required: true },
              { name: 'sessions_count', label: 'Number of sessions', type: 'number', min: 1, required: true },
              { name: 'validity_days', label: 'Validity (days)', type: 'number', min: 1, required: true },
              { name: 'amount_cents', label: 'Price in piasters (1 EGP = 100)', type: 'number', min: 0, required: true },
            ]}
            onSubmit={(v) => run(() => post('/prices', {
              name: v.name, sessions_count: Number(v.sessions_count), validity_days: Number(v.validity_days), amount_cents: Number(v.amount_cents),
            }), 'Plan added').then((r) => { if (r) prices.reload(); return !!r; })}
          />
        </Card>
      )}
    </div>
  );
}

export function AdminContent() {
  const items = useData(() => get('/content'));
  const { run, msg, busy } = useAction();
  const reload = () => items.reload();
  const remove = (row) => window.confirm(`Delete "${row.title}"? This cannot be undone.`) && run(() => del(`/content/${row.id}`), 'Deleted').then(reload);
  return (
    <div className="grid">
      <Card title="Content" className="span-2">
        <Notice msg={msg} />
        <Table rows={items.data?.items} columns={[
          { key: 'title', label: 'Title' },
          { key: 'published', label: 'Status', render: (r) => (r.published ? 'Published' : 'Draft') },
          { key: 'created_at', label: 'Created', render: (r) => fmtDate(r.created_at) },
          { key: 'act', label: '', render: (r) => (
            <div className="row-actions">
              <button className="btn ghost" disabled={busy} onClick={() => run(() => patch(`/content/${r.id}`, { published: !r.published }), 'Updated').then(reload)}>
                {r.published ? 'Unpublish' : 'Publish'}
              </button>
              <button className="btn danger" disabled={busy} onClick={() => remove(r)}>Delete</button>
            </div>
          ) },
        ]} />
      </Card>
      <Card title="Add content">
        <Form
          busy={busy}
          fields={[{ name: 'title', label: 'Title', required: true }, { name: 'body', label: 'Body', required: true }]}
          onSubmit={(v) => run(() => post('/content', { title: v.title, body: v.body, published: true }), 'Added').then((r) => { if (r) reload(); return !!r; })}
        />
      </Card>
    </div>
  );
}

export function AdminSystem() {
  const audit = useData(() => get('/admin/audit?limit=100'));
  const sports = useData(() => get('/sports'));
  const levels = useData(() => get('/levels'));
  const { run, msg, busy } = useAction();
  return (
    <div className="grid">
      <Card title="Core settings">
        <Notice msg={msg} />
        <h3>Add sport</h3>
        <Form fields={[{ name: 'name', label: 'Sport name', required: true }]} busy={busy}
          onSubmit={(v) => run(() => post('/sports', v), 'Added').then((r) => { if (r) sports.reload(); return !!r; })} />
        <h3>Add level</h3>
        <Form fields={[{ name: 'name', label: 'Level name', required: true }, { name: 'sort_order', label: 'Order', type: 'number', min: 0, required: true }]} busy={busy}
          onSubmit={(v) => run(() => post('/levels', { name: v.name, sort_order: Number(v.sort_order) }), 'Added').then((r) => { if (r) levels.reload(); return !!r; })} />
        <p className="muted">Sports: {sports.data?.items.map((s) => s.name).join(', ') || '—'}</p>
        <p className="muted">Levels: {levels.data?.items.map((l) => l.name).join(', ') || '—'}</p>
      </Card>
      <Card title="Activity log" className="span-2">
        {audit.error ? <Loading error={audit.error} /> : (
          <Table rows={audit.data?.items} columns={[
            { key: 'created_at', label: 'Time', render: (r) => fmtDate(r.created_at) },
            { key: 'user_name', label: 'User', render: (r) => r.user_name || 'System' },
            { key: 'action', label: 'Action' },
            { key: 'entity', label: 'Entity' },
            { key: 'entity_id', label: 'ID' },
          ]} />
        )}
      </Card>
    </div>
  );
}
