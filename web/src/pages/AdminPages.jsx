import React, { useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useData, useAction, Card, Stat, Table, Form, Tabs, Notice, Loading, fmtDate, fmtMoney, toLocalInput } from '../lib/ui.jsx';

const ROLE_LABELS = { student: 'Student', coach: 'Coach', admin: 'Admin' };
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
