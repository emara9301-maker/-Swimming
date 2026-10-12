import React, { useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useData, useAction, Card, Stat, Table, Form, Notice, Loading, fmtDate, fmtMoney } from '../lib/ui.jsx';

const SUB_STATUS = { active: 'Active', pending: 'Awaiting payment', expired: 'Expired', cancelled: 'Cancelled' };
const PAY_STATUS = { paid: 'Paid', pending: 'Pending', failed: 'Failed', refunded: 'Refunded' };
const ATTENDANCE = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };

export function StudentHome() {
  const { user } = useAuth();
  const schedule = useData(() => get(`/schedule?from=${new Date().toISOString()}`));
  const notes = useData(() => get('/notifications?unread=true&limit=5'));
  const progress = useData(() => get(`/students/${user.id}/progress`));
  return (
    <div className="grid">
      <Card title={`Welcome, ${user.name}`} className="span-2">
        <div className="stats">
          <Stat label="Sessions left" value={user.sessions_remaining} />
          <Stat label="Level" value={user.level_name} />
          <Stat label="Attendance" value={progress.data?.attendance.rate != null ? `${progress.data.attendance.rate}%` : '—'} />
          <Stat label="Avg. rating" value={progress.data?.evaluations.average} />
        </div>
      </Card>
      <Card title="Upcoming lessons" actions={<a href="/student/schedule">Full schedule</a>}>
        {schedule.error ? <Loading error={schedule.error} /> : (
          <Table
            rows={schedule.data?.items.slice(0, 5)}
            columns={[
              { key: 'starts_at', label: 'When', render: (r) => fmtDate(r.starts_at) },
              { key: 'class_name', label: 'Class' },
              { key: 'coach_name', label: 'Coach' },
            ]}
            empty="No upcoming lessons"
          />
        )}
      </Card>
      <Card title="New notifications" actions={<a href="/notifications">All</a>}>
        {notes.data?.items.length ? (
          <ul className="list">{notes.data.items.map((n) => <li key={n.id}><strong>{n.title}</strong><span className="muted">{n.body}</span></li>)}</ul>
        ) : <p className="muted">No unread notifications</p>}
      </Card>
    </div>
  );
}

export function StudentSchedule() {
  const { user } = useAuth();
  const { run, msg, busy } = useAction();
  const classes = useData(() => get('/classes?limit=100'));
  const mine = useData(() => get(`/students/${user.id}/classes`));
  const lessons = useData(() => get(`/schedule?from=${new Date(Date.now() - 864e5).toISOString()}&to=${new Date(Date.now() + 30 * 864e5).toISOString()}`));
  const enrolled = new Set(mine.data?.items.map((c) => c.id));

  const refreshAll = () => {
    mine.reload();
    lessons.reload();
  };
  const enroll = (id) => run(() => post(`/classes/${id}/enrollments`), 'You are enrolled in the class').then(refreshAll);
  const leave = (id) => run(() => del(`/classes/${id}/enrollments/${user.id}`), 'You left the class').then(refreshAll);

  return (
    <div className="grid">
      <Card title="Available classes">
        <Notice msg={msg} />
        <Table
          rows={classes.data?.items}
          columns={[
            { key: 'name', label: 'Class' },
            { key: 'sport_name', label: 'Sport' },
            { key: 'level_name', label: 'Level' },
            { key: 'coach_name', label: 'Coach' },
            { key: 'enrolled_count', label: 'Enrolled', render: (r) => `${r.enrolled_count}/${r.capacity}` },
            {
              key: 'act', label: '',
              render: (r) => enrolled.has(r.id)
                ? <button className="btn ghost" disabled={busy} onClick={() => leave(r.id)}>Leave</button>
                : <button className="btn primary" disabled={busy || r.enrolled_count >= r.capacity} onClick={() => enroll(r.id)}>Enroll</button>,
            },
          ]}
        />
      </Card>
      <Card title="My timetable">
        <Table
          rows={lessons.data?.items.filter((l) => enrolled.has(l.class_id))}
          columns={[
            { key: 'starts_at', label: 'Starts', render: (r) => fmtDate(r.starts_at) },
            { key: 'class_name', label: 'Class' },
            { key: 'coach_name', label: 'Coach' },
            { key: 'location', label: 'Location' },
          ]}
          empty="You are not enrolled in any class yet"
        />
      </Card>
    </div>
  );
}

export function StudentProgress() {
  const { user } = useAuth();
  const progress = useData(() => get(`/students/${user.id}/progress`));
  const evals = useData(() => get(`/students/${user.id}/evaluations?limit=20`));
  const att = useData(() => get(`/students/${user.id}/attendance`));
  if (progress.error) return <Loading error={progress.error} />;
  if (!progress.data) return <Loading />;
  const p = progress.data;
  return (
    <div className="grid">
      <Card title="Progress summary" className="span-2">
        <div className="stats">
          <Stat label="Attendance" value={p.attendance.rate != null ? `${p.attendance.rate}%` : '—'} />
          <Stat label="Evaluations" value={p.evaluations.count} />
          <Stat label="Avg. rating" value={p.evaluations.average} />
          <Stat label="Skills learned" value={p.skills.length} />
        </div>
      </Card>
      <Card title="Skills learned">
        {p.skills.length ? (
          <ul className="chips">{p.skills.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
        ) : <p className="muted">No skills recorded yet</p>}
      </Card>
      <Card title="Level history">
        <Table rows={p.level_history} columns={[
          { key: 'changed_at', label: 'Date', render: (r) => fmtDate(r.changed_at) },
          { key: 'from_level', label: 'From' },
          { key: 'to_level', label: 'To' },
        ]} empty="No level changes yet" />
      </Card>
      <Card title="Recent evaluations">
        <Table rows={evals.data?.items} columns={[
          { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
          { key: 'score', label: 'Rating', render: (r) => `${r.score} / 5` },
          { key: 'comment', label: 'Comment' },
        ]} />
      </Card>
      <Card title="Attendance history">
        <Table rows={att.data?.items} columns={[
          { key: 'starts_at', label: 'Lesson', render: (r) => fmtDate(r.starts_at) },
          { key: 'class_name', label: 'Class' },
          { key: 'status', label: 'Status', render: (r) => ATTENDANCE[r.status] },
        ]} />
      </Card>
    </div>
  );
}

export function StudentBilling() {
  const { run, msg, busy } = useAction();
  const prices = useData(() => get('/prices'));
  const subs = useData(() => get('/subscriptions'));
  const payments = useData(() => get('/payments?limit=50'));
  const [invoice, setInvoice] = useState(null);

  const refreshAll = () => {
    subs.reload();
    payments.reload();
  };
  const buy = (priceId) => run(() => post('/subscriptions', { price_id: priceId }), 'Order created. Complete the payment to activate your plan').then(refreshAll);
  const renew = (subId) => run(() => post(`/subscriptions/${subId}/renew`), 'Renewal order created').then(refreshAll);
  const showInvoice = async (paymentId) => setInvoice((await get(`/invoices/${paymentId}`)).invoice);

  return (
    <div className="grid">
      <Card title="Plans" className="span-2">
        <Notice msg={msg} />
        <div className="plans">
          {prices.data?.items.map((p) => (
            <div key={p.id} className="plan">
              <strong>{p.name}</strong>
              <span>{p.sessions_count} sessions · valid {p.validity_days} days</span>
              <span className="price">{fmtMoney(p.amount_cents)}</span>
              <button className="btn primary block" disabled={busy} onClick={() => buy(p.id)}>Subscribe</button>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`My subscriptions — ${subs.data?.sessions_remaining ?? '…'} sessions left`}>
        <Table rows={subs.data?.items} columns={[
          { key: 'plan_name', label: 'Plan' },
          { key: 'status', label: 'Status', render: (r) => SUB_STATUS[r.status] },
          { key: 'used', label: 'Used', render: (r) => `${r.sessions_used}/${r.sessions_total}` },
          { key: 'ends_at', label: 'Ends', render: (r) => fmtDate(r.ends_at) },
          { key: 'act', label: '', render: (r) => (r.status === 'active' || r.status === 'expired') && (
            <button className="btn ghost" disabled={busy} onClick={() => renew(r.id)}>Renew</button>
          ) },
        ]} />
      </Card>
      <Card title="Payments & invoices">
        <Table rows={payments.data?.items} columns={[
          { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
          { key: 'amount_cents', label: 'Amount', render: (r) => fmtMoney(r.amount_cents) },
          { key: 'status', label: 'Status', render: (r) => PAY_STATUS[r.status] },
          { key: 'act', label: '', render: (r) => r.status === 'paid' && <button className="btn ghost" onClick={() => showInvoice(r.id)}>Invoice</button> },
        ]} />
        {invoice && (
          <div className="invoice">
            <h3>{invoice.number}</h3>
            <p>{invoice.student_name} · {invoice.plan_name}</p>
            <p>{fmtMoney(invoice.total_cents)} · {fmtDate(invoice.issued_at)}</p>
          </div>
        )}
      </Card>
    </div>
  );
}

export function StudentProfile() {
  const { user, refresh } = useAuth();
  const { run, msg } = useAction();
  const details = useData(() => get(`/students/${user.id}`));
  const s = details.data?.student;
  return (
    <div className="grid">
      <Card title="My details">
        <Form
          initial={{ name: user.name, phone: user.phone || '' }}
          fields={[{ name: 'name', label: 'Full name', required: true }, { name: 'phone', label: 'Mobile', type: 'tel' }]}
          onSubmit={(v) => run(() => patch('/auth/me', v), 'Profile updated').then((r) => { if (r) refresh(); return !!r; })}
        />
        <p className="muted">Email: {user.email} · Level: {s?.level_name || 'Not set'}</p>
      </Card>
      <Card title="Change password">
        <Form
          fields={[
            { name: 'current_password', label: 'Current password', type: 'password', required: true },
            { name: 'new_password', label: 'New password', type: 'password', required: true },
          ]}
          submitLabel="Change password"
          onSubmit={(v) => run(() => patch('/auth/me', v), 'Password changed').then((r) => !!r)}
        />
        <Notice msg={msg} />
      </Card>
    </div>
  );
}

export function Notifications() {
  const { run, msg } = useAction();
  const list = useData(() => get('/notifications?limit=100'));
  const markAll = () => run(() => post('/notifications/read-all'), 'All notifications marked as read').then(list.reload);
  return (
    <Card title="Notifications" actions={<button className="btn ghost" onClick={markAll}>Mark all as read</button>}>
      <Notice msg={msg} />
      {list.error ? <Loading error={list.error} /> : (
        <ul className="list">
          {list.data?.items.map((n) => (
            <li key={n.id} className={n.read_at ? 'read' : 'unread'} onClick={() => !n.read_at && post(`/notifications/${n.id}/read`).then(list.reload)}>
              <strong>{n.title}</strong>
              {n.body && <span>{n.body}</span>}
              <small className="muted">{fmtDate(n.created_at)}</small>
            </li>
          ))}
          {list.data?.items.length === 0 && <p className="muted">No notifications</p>}
        </ul>
      )}
    </Card>
  );
}
