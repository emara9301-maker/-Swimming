import React from 'react';
import { put } from './api.js';

const LABELS = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };

// Attendance buttons for one training. Present or late uses a session from the student's plan.
export function TrainingAttendance({ booking, run, busy, onDone }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={`Attendance for ${booking.student_name}`}>
      {Object.entries(LABELS).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={booking.attendance === value}
          className={booking.attendance === value ? `seg active ${value}` : 'seg'}
          disabled={busy}
          onClick={() => run(() => put(`/bookings/${booking.id}/attendance`, { status: value }), 'Attendance saved').then(() => onDone?.())}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
