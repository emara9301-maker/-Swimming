import React, { useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useData, useAction, Card, Stat, Table, Form, Tabs, Notice, Loading, fmtDate, fmtMoney } from '../lib/ui.jsx';

export function StudentHome() {
  const { user } = useAuth();
  const schedule = useData(() => get(`/schedule?from=${new Date().toISOString()}`));
  const notes = useData(() => get('/notifications?unread=true&limit=5'));
  const progress = useData(() => get(`/students/${user.id}/progress`));
  return (
    <div className="grid">
      <Card title={`أهلاً ${user.name}`} className="span-2">
        <div className="stats">
          <Stat label="حصص متبقية" value={user.sessions_remaining} />
          <Stat label="المستوى" value={user.level_name} />
          <Stat label="نسبة الحضور" value={progress.data?.attendance.rate != null ? `${progress.data.attendance.rate}%` : '—'} />
          <Stat label="متوسط التقييم" value={progress.data?.evaluations.average} />
        </div>
      </Card>
      <Card title="الحصص القادمة" actions={<a href="/student/schedule">الجدول كامل</a>}>
        {schedule.error ? <Loading error={schedule.error} /> : (
          <Table
            rows={schedule.data?.items.slice(0, 5)}
            columns={[
              { key: 'starts_at', label: 'الموعد', render: (r) => fmtDate(r.starts_at) },
              { key: 'class_name', label: 'الكلاس' },
              { key: 'coach_name', label: 'المدرب' },
            ]}
            empty="لا توجد حصص قادمة"
          />
        )}
      </Card>
      <Card title="إشعارات جديدة" actions={<a href="/notifications">الكل</a>}>
        {notes.data?.items.length ? (
          <ul className="list">{notes.data.items.map((n) => <li key={n.id}><strong>{n.title}</strong><span className="muted">{n.body}</span></li>)}</ul>
        ) : <p className="muted">لا توجد إشعارات غير مقروءة</p>}
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

  const enroll = (id) => run(() => post(`/classes/${id}/enrollments`), 'تم الاشتراك في الكلاس').then(() => {
    mine.reload();
    lessons.reload();
  });
  const leave = (id) => run(() => del(`/classes/${id}/enrollments/${user.id}`), 'تم إلغاء الاشتراك').then(() => {
    mine.reload();
    lessons.reload();
  });

  return (
    <div className="grid">
      <Card title="الكلاسات المتاحة">
        <Notice msg={msg} />
        <Table
          rows={classes.data?.items}
          columns={[
            { key: 'name', label: 'الكلاس' },
            { key: 'sport_name', label: 'الرياضة' },
            { key: 'level_name', label: 'المستوى' },
            { key: 'coach_name', label: 'المدرب' },
            { key: 'enrolled_count', label: 'المسجلون', render: (r) => `${r.enrolled_count}/${r.capacity}` },
            {
              key: 'act', label: '',
              render: (r) => enrolled.has(r.id)
                ? <button className="btn ghost" disabled={busy} onClick={() => leave(r.id)}>إلغاء</button>
                : <button className="btn primary" disabled={busy || r.enrolled_count >= r.capacity} onClick={() => enroll(r.id)}>اشتراك</button>,
            },
          ]}
        />
      </Card>
      <Card title="جدول حصصي">
        <Table
          rows={lessons.data?.items.filter((l) => enrolled.has(l.class_id))}
          columns={[
            { key: 'starts_at', label: 'البداية', render: (r) => fmtDate(r.starts_at) },
            { key: 'class_name', label: 'الكلاس' },
            { key: 'coach_name', label: 'المدرب' },
            { key: 'location', label: 'المكان' },
          ]}
          empty="أنت غير مشترك في أي كلاس بعد"
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
      <Card title="ملخص التقدم" className="span-2">
        <div className="stats">
          <Stat label="الحضور" value={p.attendance.rate != null ? `${p.attendance.rate}%` : '—'} />
          <Stat label="عدد التقييمات" value={p.evaluations.count} />
          <Stat label="متوسط التقييم" value={p.evaluations.average} />
          <Stat label="المهارات المكتسبة" value={p.skills.length} />
        </div>
      </Card>
      <Card title="المهارات التي تعلمتها">
        {p.skills.length ? (
          <ul className="chips">{p.skills.map((s) => <li key={s.id}>{s.name}</li>)}</ul>
        ) : <p className="muted">لم تُسجَّل مهارات بعد</p>}
      </Card>
      <Card title="تاريخ المستوى">
        <Table rows={p.level_history} columns={[
          { key: 'changed_at', label: 'التاريخ', render: (r) => fmtDate(r.changed_at) },
          { key: 'from_level', label: 'من' },
          { key: 'to_level', label: 'إلى' },
        ]} empty="لا يوجد تغيير في المستوى بعد" />
      </Card>
      <Card title="آخر التقييمات">
        <Table rows={evals.data?.items} columns={[
          { key: 'created_at', label: 'التاريخ', render: (r) => fmtDate(r.created_at) },
          { key: 'score', label: 'التقييم', render: (r) => `${r.score} / 5` },
          { key: 'comment', label: 'ملاحظة' },
        ]} />
      </Card>
      <Card title="سجل الحضور">
        <Table rows={att.data?.items} columns={[
          { key: 'starts_at', label: 'الحصة', render: (r) => fmtDate(r.starts_at) },
          { key: 'class_name', label: 'الكلاس' },
          { key: 'status', label: 'الحالة', render: (r) => ({ present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' })[r.status] },
        ]} />
      </Card>
    </div>
  );
}

export function StudentBilling() {
  const { user } = useAuth();
  const { run, msg, busy } = useAction();
  const prices = useData(() => get('/prices'));
  const subs = useData(() => get('/subscriptions'));
  const payments = useData(() => get('/payments?limit=50'));
  const [invoice, setInvoice] = useState(null);

  const buy = (priceId) => run(() => post('/subscriptions', { price_id: priceId }), 'تم إنشاء الطلب. أكمل الدفع لتفعيل الاشتراك').then(() => {
    subs.reload();
    payments.reload();
  });
  const renew = (subId) => run(() => post(`/subscriptions/${subId}/renew`), 'تم إنشاء طلب التجديد').then(() => {
    subs.reload();
    payments.reload();
  });
  const showInvoice = async (paymentId) => setInvoice((await get(`/invoices/${paymentId}`)).invoice);

  return (
    <div className="grid">
      <Card title="الباقات" className="span-2">
        <Notice msg={msg} />
        <div className="plans">
          {prices.data?.items.map((p) => (
            <div key={p.id} className="plan">
              <strong>{p.name}</strong>
              <span>{p.sessions_count} حصة · صالحة {p.validity_days} يوم</span>
              <span className="price">{fmtMoney(p.amount_cents)}</span>
              <button className="btn primary block" disabled={busy} onClick={() => buy(p.id)}>اشتراك</button>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`اشتراكاتي — المتبقي ${subs.data?.sessions_remaining ?? '…'} حصة`}>
        <Table rows={subs.data?.items} columns={[
          { key: 'plan_name', label: 'الباقة' },
          { key: 'status', label: 'الحالة', render: (r) => ({ active: 'نشط', pending: 'بانتظار الدفع', expired: 'منتهي', cancelled: 'ملغي' })[r.status] },
          { key: 'used', label: 'المستخدم', render: (r) => `${r.sessions_used}/${r.sessions_total}` },
          { key: 'ends_at', label: 'ينتهي', render: (r) => fmtDate(r.ends_at) },
          { key: 'act', label: '', render: (r) => (r.status === 'active' || r.status === 'expired') && (
            <button className="btn ghost" disabled={busy} onClick={() => renew(r.id)}>تجديد</button>
          ) },
        ]} />
      </Card>
      <Card title="المدفوعات والفواتير">
        <Table rows={payments.data?.items} columns={[
          { key: 'created_at', label: 'التاريخ', render: (r) => fmtDate(r.created_at) },
          { key: 'amount_cents', label: 'المبلغ', render: (r) => fmtMoney(r.amount_cents) },
          { key: 'status', label: 'الحالة', render: (r) => ({ paid: 'مدفوع', pending: 'معلّق', failed: 'فشل', refunded: 'مسترد' })[r.status] },
          { key: 'act', label: '', render: (r) => r.status === 'paid' && <button className="btn ghost" onClick={() => showInvoice(r.id)}>الفاتورة</button> },
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
  const [pw, setPw] = useState({ current_password: '', new_password: '' });
  const details = useData(() => get(`/students/${user.id}`));
  const s = details.data?.student;
  return (
    <div className="grid">
      <Card title="بياناتي">
        <Form
          initial={{ name: user.name, phone: user.phone || '' }}
          fields={[{ name: 'name', label: 'الاسم', required: true }, { name: 'phone', label: 'الموبايل', type: 'tel' }]}
          onSubmit={(v) => run(() => patch('/auth/me', v), 'تم تحديث البيانات').then((r) => { if (r) refresh(); return !!r; })}
        />
        <p className="muted">البريد: <span dir="ltr">{user.email}</span> · المستوى: {s?.level_name || 'غير محدد'}</p>
      </Card>
      <Card title="تغيير كلمة المرور">
        <Form
          fields={[
            { name: 'current_password', label: 'كلمة المرور الحالية', type: 'password', required: true },
            { name: 'new_password', label: 'كلمة المرور الجديدة', type: 'password', required: true },
          ]}
          submitLabel="تغيير"
          initial={pw}
          onSubmit={(v) => run(() => patch('/auth/me', v), 'تم تغيير كلمة المرور').then((r) => !!r)}
        />
        <Notice msg={msg} />
      </Card>
    </div>
  );
}

export function Notifications() {
  const { run, msg } = useAction();
  const list = useData(() => get('/notifications?limit=100'));
  const markAll = () => run(() => post('/notifications/read-all'), 'تم وضع علامة مقروء على الكل').then(list.reload);
  return (
    <Card title="الإشعارات" actions={<button className="btn ghost" onClick={markAll}>قراءة الكل</button>}>
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
          {list.data?.items.length === 0 && <p className="muted">لا توجد إشعارات</p>}
        </ul>
      )}
    </Card>
  );
}
