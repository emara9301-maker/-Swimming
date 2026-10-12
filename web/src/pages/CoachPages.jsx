import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, put } from '../lib/api.js';
import { useData, useAction, Card, Stat, Table, Form, Notice, Loading, fmtDate } from '../lib/ui.jsx';

const ATTENDANCE_LABELS = { present: 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'بعذر' };

// Coach's own lessons (admins see all lessons).
export function CoachSchedule() {
  const lessons = useData(() => get(`/schedule?from=${new Date(Date.now() - 2 * 864e5).toISOString()}&to=${new Date(Date.now() + 14 * 864e5).toISOString()}`));
  return (
    <Card title="جدول حصصي">
      {lessons.error ? <Loading error={lessons.error} /> : (
        <Table
          rows={lessons.data?.items}
          columns={[
            { key: 'starts_at', label: 'البداية', render: (r) => fmtDate(r.starts_at) },
            { key: 'class_name', label: 'الكلاس' },
            { key: 'sport_name', label: 'الرياضة' },
            { key: 'level_name', label: 'المستوى' },
            { key: 'location', label: 'المكان' },
            { key: 'act', label: '', render: (r) => <Link className="btn ghost" to={`/coach/lessons/${r.id}`}>الحضور</Link> },
          ]}
          empty="لا توجد حصص في الفترة القادمة"
        />
      )}
    </Card>
  );
}

// Attendance for one lesson. Saving sends every row at once so sessions stay in sync.
export function LessonPage() {
  const { id } = useParams();
  const lesson = useData(() => get(`/lessons/${id}`), [id]);
  const roster = useData(() => get(`/lessons/${id}/attendance`), [id]);
  const { run, msg, busy, setMsg } = useAction();
  const [draft, setDraft] = useState({});

  if (roster.error) return <Loading error={roster.error} />;
  if (!roster.data || !lesson.data) return <Loading />;

  const statusOf = (row) => draft[row.student_id] ?? row.status ?? 'absent';
  const save = async () => {
    const records = roster.data.items.map((row) => ({ student_id: row.student_id, status: statusOf(row) }));
    const res = await run(() => put(`/lessons/${id}/attendance`, { records }), 'تم حفظ الحضور');
    if (res?.students_without_sessions?.length) {
      setMsg({ type: 'error', text: 'بعض الطلاب لا تتبقى لهم حصص، وتم إرسال تنبيه لهم' });
    }
    setDraft({});
    roster.reload();
  };

  return (
    <div className="grid">
      <Card title={`${lesson.data.lesson.class_name} — ${fmtDate(lesson.data.lesson.starts_at)}`} className="span-2">
        <Notice msg={msg} />
        <div className="table-wrap">
          <table>
            <thead><tr><th>الطالب</th><th>الحالة</th><th></th></tr></thead>
            <tbody>
              {roster.data.items.map((row) => (
                <tr key={row.student_id}>
                  <td data-label="الطالب">{row.name}</td>
                  <td data-label="الحالة">
                    <div className="segmented" role="radiogroup" aria-label={`حضور ${row.name}`}>
                      {Object.entries(ATTENDANCE_LABELS).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={statusOf(row) === value}
                          className={statusOf(row) === value ? `seg active ${value}` : 'seg'}
                          onClick={() => setDraft((d) => ({ ...d, [row.student_id]: value }))}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td data-label="">
                    <Link className="btn ghost" to={`/coach/students/${row.student_id}`}>ملف الطالب</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {roster.data.items.length === 0 && <p className="muted">لا يوجد طلاب مسجلون في هذا الكلاس</p>}
        <div className="form-submit">
          <button className="btn primary" disabled={busy || roster.data.items.length === 0} onClick={save}>حفظ الحضور</button>
        </div>
      </Card>
    </div>
  );
}

// Coach-facing student record: progress, evaluations, skills, notes and level.
export function CoachStudent() {
  const { id } = useParams();
  const student = useData(() => get(`/students/${id}`), [id]);
  const progress = useData(() => get(`/students/${id}/progress`), [id]);
  const evals = useData(() => get(`/students/${id}/evaluations?limit=10`), [id]);
  const notes = useData(() => get(`/students/${id}/notes`), [id]);
  const levels = useData(() => get('/levels'));
  const skills = useData(() => get('/skills'));
  const { run, msg, busy } = useAction();
  const [level, setLevel] = useState('');
  const [skillId, setSkillId] = useState('');

  if (student.error) return <Loading error={student.error} />;
  if (!student.data) return <Loading />;
  const s = student.data.student;
  const refreshAll = () => { progress.reload(); evals.reload(); notes.reload(); };

  return (
    <div className="grid">
      <Card title={s.name} className="span-2">
        <Notice msg={msg} />
        <div className="stats">
          <Stat label="المستوى" value={s.level_name} />
          <Stat label="حصص متبقية" value={s.sessions_remaining} />
          <Stat label="نسبة الحضور" value={progress.data?.attendance.rate != null ? `${progress.data.attendance.rate}%` : '—'} />
          <Stat label="متوسط التقييم" value={progress.data?.evaluations.average} />
        </div>
        <p className="muted">الهاتف: <span dir="ltr">{s.phone || '—'}</span> · الاشتراكات: {student.data.subscriptions.length}</p>
      </Card>

      <Card title="تقييم الطالب">
        <Form
          fields={[
            { name: 'score', label: 'التقييم (1-5)', type: 'number', min: 1, max: 5, required: true },
            { name: 'comment', label: 'ملاحظة' },
          ]}
          submitLabel="حفظ التقييم"
          busy={busy}
          onSubmit={(v) => run(() => post(`/students/${id}/evaluations`, { score: Number(v.score), comment: v.comment || undefined }), 'تم حفظ التقييم').then((r) => { if (r) refreshAll(); return !!r; })}
        />
        <Table rows={evals.data?.items} columns={[
          { key: 'created_at', label: 'التاريخ', render: (r) => fmtDate(r.created_at) },
          { key: 'score', label: 'التقييم' },
          { key: 'comment', label: 'ملاحظة' },
        ]} empty="لا توجد تقييمات بعد" />
      </Card>

      <Card title="تسجيل مهارة تم تعلمها">
        <div className="inline-form">
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">— اختر المهارة —</option>
            {skills.data?.items.map((k) => <option key={k.id} value={k.id}>{k.sport_name} · {k.name}</option>)}
          </select>
          <button className="btn primary" disabled={!skillId || busy} onClick={() => run(() => post(`/students/${id}/skills`, { skill_id: Number(skillId) }), 'تم تسجيل المهارة').then((r) => { if (r) { setSkillId(''); refreshAll(); } })}>تسجيل</button>
        </div>
        <ul className="chips">{progress.data?.skills.map((k) => <li key={k.id}>{k.name}</li>)}</ul>
      </Card>

      <Card title="تغيير المستوى">
        <div className="inline-form">
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">— اختر المستوى —</option>
            {levels.data?.items.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="btn primary" disabled={!level || busy} onClick={() => run(() => post(`/students/${id}/level`, { level_id: Number(level) }), 'تم تحديث المستوى').then((r) => { if (r) refreshAll(); })}>تحديث</button>
        </div>
        <Table rows={progress.data?.level_history} columns={[
          { key: 'changed_at', label: 'التاريخ', render: (r) => fmtDate(r.changed_at) },
          { key: 'from_level', label: 'من' },
          { key: 'to_level', label: 'إلى' },
        ]} empty="لا يوجد سجل ترقية" />
      </Card>

      <Card title="ملاحظات المدرب (خاصة)">
        <Form
          fields={[{ name: 'body', label: 'ملاحظة جديدة', required: true }]}
          submitLabel="إضافة"
          busy={busy}
          onSubmit={(v) => run(() => post(`/students/${id}/notes`, { body: v.body }), 'تمت إضافة الملاحظة').then((r) => { if (r) refreshAll(); return !!r; })}
        />
        <ul className="list">
          {notes.data?.items.map((n) => <li key={n.id}><span>{n.body}</span><small className="muted">{n.coach_name} · {fmtDate(n.created_at)}</small></li>)}
        </ul>
      </Card>

      <Card title="سجل الحضور">
        <Table rows={student.data.subscriptions} columns={[
          { key: 'plan_name', label: 'الباقة' },
          { key: 'status', label: 'الحالة' },
          { key: 'used', label: 'المستخدم', render: (r) => `${r.sessions_used}/${r.sessions_total}` },
        ]} empty="لا توجد اشتراكات" />
      </Card>
    </div>
  );
}

// Attendance report for one of the coach's classes.
export function CoachReports() {
  const classes = useData(() => get('/classes?limit=200'));
  const [classId, setClassId] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const report = useData(
    () => (classId ? get(`/reports/attendance?class_id=${classId}${range.from ? `&from=${new Date(range.from).toISOString()}` : ''}${range.to ? `&to=${new Date(range.to).toISOString()}` : ''}`) : Promise.resolve({ items: [] })),
    [classId, range.from, range.to]
  );
  return (
    <Card title="تقرير الحضور والتقدم">
      <div className="inline-form wrap">
        <select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">— اختر الكلاس —</option>
          {classes.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" dir="ltr" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="من" />
        <input type="date" dir="ltr" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="إلى" />
      </div>
      <Table
        rows={report.data?.items}
        empty="اختر كلاساً لعرض التقرير"
        columns={[
          { key: 'name', label: 'الطالب', render: (r) => <Link to={`/coach/students/${r.student_id}`}>{r.name}</Link> },
          { key: 'lessons_recorded', label: 'حصص مسجلة' },
          { key: 'present', label: 'حاضر' },
          { key: 'late', label: 'متأخر' },
          { key: 'absent', label: 'غائب' },
          { key: 'excused', label: 'بعذر' },
        ]}
      />
    </Card>
  );
}
