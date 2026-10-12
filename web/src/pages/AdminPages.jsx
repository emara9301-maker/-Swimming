import React, { useState } from 'react';
import { get, post, patch, del } from '../lib/api.js';
import { useData, useAction, Card, Stat, Table, Form, Tabs, Notice, Loading, fmtDate, fmtMoney, toLocalInput } from '../lib/ui.jsx';

const ROLE_LABELS = { student: 'طالب', coach: 'مدرب', admin: 'مدير' };
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
      <Card title="نظرة عامة" className="span-2">
        <div className="stats">
          <Stat label="الطلاب" value={s.students} />
          <Stat label="المدربون" value={s.coaches} />
          <Stat label="كلاسات نشطة" value={s.active_classes} />
          <Stat label="اشتراكات نشطة" value={s.active_subscriptions} />
          <Stat label="الإيراد" value={fmtMoney(s.revenue_cents)} />
          <Stat label="مدفوعات معلّقة" value={s.pending_payments} />
          <Stat label="نسبة الحضور" value={s.attendance_rate != null ? `${s.attendance_rate}%` : '—'} />
        </div>
      </Card>
      <Card title="الإيراد الشهري">
        <Table rows={revenue.data?.items} columns={[
          { key: 'month', label: 'الشهر' },
          { key: 'payments', label: 'عدد المدفوعات' },
          { key: 'total_cents', label: 'الإجمالي', render: (r) => fmtMoney(r.total_cents) },
        ]} />
      </Card>
      <Card title="إرسال إشعار جماعي">
        <Notice msg={msg} />
        <Form
          fields={[
            { name: 'title', label: 'العنوان', required: true },
            { name: 'body', label: 'النص' },
            { name: 'role', label: 'المستهدفون', options: [{ value: 'student', label: 'الطلاب' }, { value: 'coach', label: 'المدربون' }, { value: 'admin', label: 'الإداريون' }] },
          ]}
          submitLabel="إرسال"
          onSubmit={(v) => run(() => post('/notifications/broadcast', { title: v.title, body: v.body || undefined, role: v.role || undefined }), 'تم الإرسال').then((r) => !!r)}
        />
      </Card>
    </div>
  );
}

export function AdminUsers() {
  const [role, setRole] = useState('');
  const users = useData(() => get(`/admin/users?limit=100${role ? `&role=${role}` : ''}`), [role]);
  const { run, msg, busy } = useAction();
  const changeRole = (u, next) => run(() => patch(`/admin/users/${u.id}`, { role: next }), 'تم تحديث الصلاحية').then(users.reload);
  const toggle = (u) => run(() => patch(`/admin/users/${u.id}`, { active: !u.active }), 'تم التحديث').then(users.reload);

  return (
    <div className="grid">
      <Card title="المستخدمون" actions={
        <select value={role} onChange={(e) => setRole(e.target.value)} aria-label="فلترة حسب الدور">
          <option value="">الكل</option>
          <option value="student">الطلاب</option>
          <option value="coach">المدربون</option>
          <option value="admin">الإداريون</option>
        </select>
      } className="span-2">
        <Notice msg={msg} />
        {users.error ? <Loading error={users.error} /> : (
          <Table rows={users.data?.items} columns={[
            { key: 'name', label: 'الاسم' },
            { key: 'email', label: 'البريد', render: (r) => <span dir="ltr">{r.email}</span> },
            { key: 'phone', label: 'الموبايل' },
            { key: 'role', label: 'الدور', render: (r) => (
              <select value={r.role} disabled={busy} onChange={(e) => changeRole(r, e.target.value)} aria-label="الدور">
                {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) },
            { key: 'active', label: 'الحالة', render: (r) => (
              <button className={r.active ? 'btn ghost' : 'btn danger'} disabled={busy} onClick={() => toggle(r)}>{r.active ? 'نشط · تعطيل' : 'معطل · تفعيل'}</button>
            ) },
          ]} />
        )}
      </Card>
      <Card title="إضافة مدرب أو مدير">
        <Form
          fields={[
            { name: 'name', label: 'الاسم', required: true },
            { name: 'email', label: 'البريد', type: 'email', required: true },
            { name: 'password', label: 'كلمة مرور مؤقتة', type: 'password', required: true },
            { name: 'phone', label: 'الموبايل', type: 'tel' },
            { name: 'role', label: 'الدور', required: true, options: [{ value: 'coach', label: 'مدرب' }, { value: 'admin', label: 'مدير' }] },
            { name: 'specialty', label: 'التخصص' },
          ]}
          busy={busy}
          onSubmit={(v) => run(() => post('/admin/users', v), 'تم إنشاء الحساب').then((r) => { if (r) users.reload(); return !!r; })}
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
  const reloadAll = () => classes.reload();

  return (
    <div className="grid">
      <Card title="الكلاسات" className="span-2">
        <Notice msg={msg} />
        <Table rows={classes.data?.items} columns={[
          { key: 'name', label: 'الكلاس' },
          { key: 'sport_name', label: 'الرياضة' },
          { key: 'level_name', label: 'المستوى' },
          { key: 'coach_name', label: 'المدرب', render: (r) => r.coach_name || '—' },
          { key: 'enrolled_count', label: 'المسجلون', render: (r) => `${r.enrolled_count}/${r.capacity}` },
          { key: 'active', label: 'الحالة', render: (r) => (
            <button className="btn ghost" disabled={busy} onClick={() => run(() => patch(`/classes/${r.id}`, { active: !r.active }), 'تم التحديث').then(reloadAll)}>
              {r.active ? 'نشط · إيقاف' : 'موقوف · تفعيل'}
            </button>
          ) },
        ]} />
      </Card>
      <Card title="إضافة كلاس">
        <Form
          busy={busy}
          fields={[
            { name: 'name', label: 'اسم الكلاس', required: true },
            { name: 'sport_id', label: 'الرياضة', required: true, options: toOptions(sports.data?.items) },
            { name: 'level_id', label: 'المستوى', options: toOptions(levels.data?.items) },
            { name: 'coach_id', label: 'المدرب', options: toOptions(coaches.data?.items) },
            { name: 'capacity', label: 'السعة', type: 'number', min: 1, max: 200, required: true },
          ]}
          onSubmit={(v) => run(() => post('/classes', {
            name: v.name, sport_id: Number(v.sport_id), capacity: Number(v.capacity),
            level_id: v.level_id ? Number(v.level_id) : undefined, coach_id: v.coach_id ? Number(v.coach_id) : undefined,
          }), 'تم إنشاء الكلاس').then((r) => { if (r) reloadAll(); return !!r; })}
        />
      </Card>
      <Card title="إضافة حصة إلى جدول">
        <Form
          busy={busy}
          fields={[
            { name: 'class_id', label: 'الكلاس', required: true, options: toOptions(classes.data?.items) },
            { name: 'starts_at', label: 'البداية', type: 'datetime-local', required: true },
            { name: 'ends_at', label: 'النهاية', type: 'datetime-local', required: true },
            { name: 'location', label: 'المكان' },
          ]}
          onSubmit={(v) => run(() => post(`/classes/${v.class_id}/lessons`, {
            starts_at: new Date(v.starts_at).toISOString(), ends_at: new Date(v.ends_at).toISOString(), location: v.location || undefined,
          }), 'تمت إضافة الحصة').then((r) => !!r)}
        />
        <p className="muted">مثال: {toLocalInput(new Date())}</p>
      </Card>
    </div>
  );
}

export function AdminBilling() {
  const [tab, setTab] = useState('payments');
  const prices = useData(() => get('/prices'));
  const payments = useData(() => get('/payments?limit=100'));
  const { run, msg, busy } = useAction();
  const confirm = (p) => run(() => post(`/payments/${p.id}/confirm`), 'تم تأكيد الدفع وتفعيل الاشتراك').then(payments.reload);

  return (
    <div className="grid">
      <Card title="المالية" className="span-2">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'payments', label: 'المدفوعات' }, { value: 'prices', label: 'الباقات' }]} />
        <Notice msg={msg} />
        {tab === 'payments' && (
          <Table rows={payments.data?.items} columns={[
            { key: 'created_at', label: 'التاريخ', render: (r) => fmtDate(r.created_at) },
            { key: 'student_id', label: 'رقم الطالب' },
            { key: 'amount_cents', label: 'المبلغ', render: (r) => fmtMoney(r.amount_cents) },
            { key: 'method', label: 'الطريقة' },
            { key: 'status', label: 'الحالة' },
            { key: 'invoice_number', label: 'الفاتورة' },
            { key: 'act', label: '', render: (r) => r.status === 'pending' && (
              <button className="btn primary" disabled={busy} onClick={() => confirm(r)}>تأكيد الدفع</button>
            ) },
          ]} />
        )}
        {tab === 'prices' && (
          <Table rows={prices.data?.items} columns={[
            { key: 'name', label: 'الباقة' },
            { key: 'sessions_count', label: 'عدد الحصص' },
            { key: 'validity_days', label: 'المدة (يوم)' },
            { key: 'amount_cents', label: 'السعر', render: (r) => fmtMoney(r.amount_cents) },
          ]} />
        )}
      </Card>
      {tab === 'prices' && (
        <Card title="إضافة باقة">
          <Form
            busy={busy}
            fields={[
              { name: 'name', label: 'اسم الباقة', required: true },
              { name: 'sessions_count', label: 'عدد الحصص', type: 'number', min: 1, required: true },
              { name: 'validity_days', label: 'مدة الصلاحية (يوم)', type: 'number', min: 1, required: true },
              { name: 'amount_cents', label: 'السعر بالقرش', type: 'number', min: 0, required: true },
            ]}
            onSubmit={(v) => run(() => post('/prices', {
              name: v.name, sessions_count: Number(v.sessions_count), validity_days: Number(v.validity_days), amount_cents: Number(v.amount_cents),
            }), 'تمت إضافة الباقة').then((r) => { if (r) prices.reload(); return !!r; })}
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
  return (
    <div className="grid">
      <Card title="المحتوى المنشور" className="span-2">
        <Notice msg={msg} />
        <Table rows={items.data?.items} columns={[
          { key: 'title', label: 'العنوان' },
          { key: 'published', label: 'الحالة', render: (r) => (r.published ? 'منشور' : 'مسودة') },
          { key: 'created_at', label: 'التاريخ', render: (r) => fmtDate(r.created_at) },
          { key: 'act', label: '', render: (r) => (
            <div className="row-actions">
              <button className="btn ghost" disabled={busy} onClick={() => run(() => patch(`/content/${r.id}`, { published: !r.published }), 'تم التحديث').then(reload)}>
                {r.published ? 'إخفاء' : 'نشر'}
              </button>
              <button className="btn danger" disabled={busy} onClick={() => confirmDelete(r) && run(() => del(`/content/${r.id}`), 'تم الحذف').then(reload)}>حذف</button>
            </div>
          ) },
        ]} />
      </Card>
      <Card title="إضافة محتوى">
        <Form
          busy={busy}
          fields={[{ name: 'title', label: 'العنوان', required: true }, { name: 'body', label: 'النص', required: true }]}
          onSubmit={(v) => run(() => post('/content', { title: v.title, body: v.body, published: true }), 'تمت الإضافة').then((r) => { if (r) reload(); return !!r; })}
        />
      </Card>
    </div>
  );
}

function confirmDelete(row) {
  return window.confirm(`حذف "${row.title}"؟ لا يمكن التراجع.`);
}

export function AdminSystem() {
  const audit = useData(() => get('/admin/audit?limit=100'));
  const sports = useData(() => get('/sports'));
  const levels = useData(() => get('/levels'));
  const { run, msg, busy } = useAction();
  return (
    <div className="grid">
      <Card title="الإعدادات الأساسية">
        <Notice msg={msg} />
        <h3>إضافة رياضة</h3>
        <Form fields={[{ name: 'name', label: 'اسم الرياضة', required: true }]} busy={busy}
          onSubmit={(v) => run(() => post('/sports', v), 'تمت الإضافة').then((r) => { if (r) sports.reload(); return !!r; })} />
        <h3>إضافة مستوى</h3>
        <Form fields={[{ name: 'name', label: 'اسم المستوى', required: true }, { name: 'sort_order', label: 'الترتيب', type: 'number', min: 0, required: true }]} busy={busy}
          onSubmit={(v) => run(() => post('/levels', { name: v.name, sort_order: Number(v.sort_order) }), 'تمت الإضافة').then((r) => { if (r) levels.reload(); return !!r; })} />
        <p className="muted">الرياضات: {sports.data?.items.map((s) => s.name).join('، ') || '—'}</p>
        <p className="muted">المستويات: {levels.data?.items.map((l) => l.name).join('، ') || '—'}</p>
      </Card>
      <Card title="سجل النشاط (Audit)" className="span-2">
        {audit.error ? <Loading error={audit.error} /> : (
          <Table rows={audit.data?.items} columns={[
            { key: 'created_at', label: 'الوقت', render: (r) => fmtDate(r.created_at) },
            { key: 'user_name', label: 'المستخدم', render: (r) => r.user_name || 'نظام' },
            { key: 'action', label: 'الإجراء' },
            { key: 'entity', label: 'الكيان' },
            { key: 'entity_id', label: 'المعرف' },
          ]} />
        )}
      </Card>
    </div>
  );
}
