import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post, put } from '../lib/api.js';
import { useData, useAction, Card, Stat, Table, Form, Notice, Loading, fmtDate, fmtTime } from '../lib/ui.jsx';
import { TrainingAttendance } from '../lib/TrainingAttendance.jsx';

const ATTENDANCE_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };
const SUB_STATUS = { active: 'Active', pending: 'Pending', expired: 'Expired', cancelled: 'Cancelled' };

// Coach's trainings (public or private) that they lead and that are confirmed.
function CoachTrainings() {
  const bookings = useData(() => get('/bookings?limit=100'));
  const { run, msg, busy } = useAction();
  const rows = bookings.data?.items.filter((b) => b.status === 'confirmed');
  return (
    <Card title="My trainings">
      <Notice msg={msg} />
      <Table
        rows={rows}
        empty="No confirmed trainings"
        columns={[
          { key: 'starts_at', label: 'Starts', render: (r) => `${fmtDate(r.starts_at)}–${fmtTime(r.ends_at)}` },
          { key: 'student_name', label: 'Student' },
          { key: 'type', label: 'Type', render: (r) => (r.type === 'public' ? 'Public' : 'Private') },
          { key: 'venue', label: 'Place' },
          { key: 'attendance', label: 'Attendance', render: (r) => <TrainingAttendance booking={r} run={run} busy={busy} onDone={bookings.reload} /> },
        ]}
      />
    </Card>
  );
}

// Coach's own lessons (admins see all lessons).
export function CoachSchedule() {
  const lessons = useData(() => get(`/schedule?from=${new Date(Date.now() - 2 * 864e5).toISOString()}&to=${new Date(Date.now() + 14 * 864e5).toISOString()}`));
  return (
    <div className="grid">
    <Card title="My lessons">
      {lessons.error ? <Loading error={lessons.error} /> : (
        <Table
          rows={lessons.data?.items}
          columns={[
            { key: 'starts_at', label: 'Starts', render: (r) => fmtDate(r.starts_at) },
            { key: 'class_name', label: 'Class' },
            { key: 'sport_name', label: 'Sport' },
            { key: 'level_name', label: 'Level' },
            { key: 'location', label: 'Location' },
            { key: 'act', label: '', render: (r) => <Link className="btn ghost" to={`/coach/lessons/${r.id}`}>Attendance</Link> },
          ]}
          empty="No lessons in the next two weeks"
        />
      )}
    </Card>
    <CoachTrainings />
    </div>
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
    const res = await run(() => put(`/lessons/${id}/attendance`, { records }), 'Attendance saved');
    if (res?.students_without_sessions?.length) {
      setMsg({ type: 'error', text: 'Some students have no sessions left. They have been notified.' });
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
            <thead><tr><th>Student</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {roster.data.items.map((row) => (
                <tr key={row.student_id}>
                  <td data-label="Student">{row.name}</td>
                  <td data-label="Status">
                    <div className="segmented" role="radiogroup" aria-label={`Attendance for ${row.name}`}>
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
                    <Link className="btn ghost" to={`/coach/students/${row.student_id}`}>Student file</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {roster.data.items.length === 0 && <p className="muted">No students enrolled in this class</p>}
        <div className="form-submit">
          <button className="btn primary" disabled={busy || roster.data.items.length === 0} onClick={save}>Save attendance</button>
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
          <Stat label="Level" value={s.level_name} />
          <Stat label="Sessions left" value={s.sessions_remaining} />
          <Stat label="Attendance" value={progress.data?.attendance.rate != null ? `${progress.data.attendance.rate}%` : '—'} />
          <Stat label="Avg. rating" value={progress.data?.evaluations.average} />
        </div>
        <p className="muted">Phone: {s.phone || '—'} · Subscriptions: {student.data.subscriptions.length}</p>
      </Card>

      <Card title="Evaluate student">
        <Form
          fields={[
            { name: 'score', label: 'Rating (1–5)', type: 'number', min: 1, max: 5, required: true },
            { name: 'comment', label: 'Comment' },
          ]}
          submitLabel="Save rating"
          busy={busy}
          onSubmit={(v) => run(() => post(`/students/${id}/evaluations`, { score: Number(v.score), comment: v.comment || undefined }), 'Rating saved').then((r) => { if (r) refreshAll(); return !!r; })}
        />
        <Table rows={evals.data?.items} columns={[
          { key: 'created_at', label: 'Date', render: (r) => fmtDate(r.created_at) },
          { key: 'score', label: 'Rating' },
          { key: 'comment', label: 'Comment' },
        ]} empty="No ratings yet" />
      </Card>

      <Card title="Record a skill learned">
        <div className="inline-form">
          <select value={skillId} onChange={(e) => setSkillId(e.target.value)}>
            <option value="">— Select skill —</option>
            {skills.data?.items.map((k) => <option key={k.id} value={k.id}>{k.sport_name} · {k.name}</option>)}
          </select>
          <button className="btn primary" disabled={!skillId || busy} onClick={() => run(() => post(`/students/${id}/skills`, { skill_id: Number(skillId) }), 'Skill recorded').then((r) => { if (r) { setSkillId(''); refreshAll(); } })}>Record</button>
        </div>
        <ul className="chips">{progress.data?.skills.map((k) => <li key={k.id}>{k.name}</li>)}</ul>
      </Card>

      <Card title="Change level">
        <div className="inline-form">
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">— Select level —</option>
            {levels.data?.items.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button className="btn primary" disabled={!level || busy} onClick={() => run(() => post(`/students/${id}/level`, { level_id: Number(level) }), 'Level updated').then((r) => { if (r) refreshAll(); })}>Update</button>
        </div>
        <Table rows={progress.data?.level_history} columns={[
          { key: 'changed_at', label: 'Date', render: (r) => fmtDate(r.changed_at) },
          { key: 'from_level', label: 'From' },
          { key: 'to_level', label: 'To' },
        ]} empty="No level history yet" />
      </Card>

      <Card title="Coach notes (private)">
        <Form
          fields={[{ name: 'body', label: 'New note', required: true }]}
          submitLabel="Add note"
          busy={busy}
          onSubmit={(v) => run(() => post(`/students/${id}/notes`, { body: v.body }), 'Note added').then((r) => { if (r) refreshAll(); return !!r; })}
        />
        <ul className="list">
          {notes.data?.items.map((n) => <li key={n.id}><span>{n.body}</span><small className="muted">{n.coach_name} · {fmtDate(n.created_at)}</small></li>)}
        </ul>
      </Card>

      <Card title="Subscriptions">
        <Table rows={student.data.subscriptions} columns={[
          { key: 'plan_name', label: 'Plan' },
          { key: 'status', label: 'Status', render: (r) => SUB_STATUS[r.status] },
          { key: 'used', label: 'Used', render: (r) => `${r.sessions_used}/${r.sessions_total}` },
        ]} empty="No subscriptions" />
      </Card>
    </div>
  );
}

// Attendance report for one class.
export function CoachReports() {
  const classes = useData(() => get('/classes?limit=200'));
  const [classId, setClassId] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const report = useData(
    () => (classId ? get(`/reports/attendance?class_id=${classId}${range.from ? `&from=${new Date(range.from).toISOString()}` : ''}${range.to ? `&to=${new Date(range.to).toISOString()}` : ''}`) : Promise.resolve({ items: [] })),
    [classId, range.from, range.to]
  );
  return (
    <Card title="Attendance report">
      <div className="inline-form wrap">
        <select value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="">— Select class —</option>
          {classes.data?.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} aria-label="From" />
        <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} aria-label="To" />
      </div>
      <Table
        rows={report.data?.items}
        empty="Select a class to see its report"
        columns={[
          { key: 'name', label: 'Student', render: (r) => <Link to={`/coach/students/${r.student_id}`}>{r.name}</Link> },
          { key: 'lessons_recorded', label: 'Lessons recorded' },
          { key: 'present', label: 'Present' },
          { key: 'late', label: 'Late' },
          { key: 'absent', label: 'Absent' },
          { key: 'excused', label: 'Excused' },
        ]}
      />
    </Card>
  );
}
