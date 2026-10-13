import React from 'react';
import { get } from './api.js';
import { useData, fmtDate, fmtTime, Field, Loading } from './ui.jsx';

// Form state for a booking. type '' means "decide later".
export const emptyBooking = {
  type: '',
  training_session_id: '',
  venue_address: '',
  preferred_times: '',
  contact_phone: '',
  notes: '',
};

// Turns the form state into the API body, or null when nothing is chosen yet.
export function toBookingBody(v) {
  if (v.type === 'public') return { type: 'public', training_session_id: Number(v.training_session_id) || 0 };
  if (v.type === 'private') {
    return {
      type: 'private',
      venue_address: v.venue_address,
      preferred_times: v.preferred_times,
      contact_phone: v.contact_phone,
      notes: v.notes || undefined,
    };
  }
  return null;
}

// Lets a student pick an open public session or request a private training.
export function BookingPicker({ value, onChange }) {
  const sessions = useData(() => get('/training-sessions'));
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const pick = (type) => onChange({ ...value, type });
  const seg = (type) => (value.type === type ? 'seg active' : 'seg');

  return (
    <fieldset className="booking">
      <legend>Training type</legend>
      <div className="segmented">
        <button type="button" className={seg('public')} onClick={() => pick('public')}>Public (group)</button>
        <button type="button" className={seg('private')} onClick={() => pick('private')}>Private (at your pool)</button>
        <button type="button" className={seg('')} onClick={() => pick('')}>Decide later</button>
      </div>

      <p className="muted">A session from your plan is used when your coach marks you as attended. You need a session left to book.</p>
      {value.type === 'public' && (
        sessions.error ? <Loading error={sessions.error} /> : (
          sessions.data?.items.length ? (
            <Field label="Training session">
              <select value={value.training_session_id} onChange={set('training_session_id')} required>
                <option value="">— Select a session —</option>
                {sessions.data.items.map((s) => {
                  const left = s.capacity - s.booked;
                  return (
                    <option key={s.id} value={s.id} disabled={left <= 0}>
                      {`${s.title} · ${fmtDate(s.starts_at)}–${fmtTime(s.ends_at)} · ${s.venue} (${left > 0 ? `${left} seats left` : 'full'})`}
                    </option>
                  );
                })}
              </select>
            </Field>
          ) : <p className="muted">No public sessions are open right now. Choose a private training or decide later.</p>
        )
      )}

      {value.type === 'private' && (
        <>
          <Field label="Pool address">
            <input value={value.venue_address} onChange={set('venue_address')} required />
          </Field>
          <Field label="Preferred days and times">
            <input value={value.preferred_times} onChange={set('preferred_times')} placeholder="e.g. Sat 5–7 PM, Mon 6 PM" required />
          </Field>
          <Field label="Contact phone (optional)">
            <input type="tel" value={value.contact_phone} onChange={set('contact_phone')} />
          </Field>
          <Field label="Notes (optional)">
            <input value={value.notes} onChange={set('notes')} />
          </Field>
          <p className="muted">The academy will call you to confirm the final time.</p>
        </>
      )}
    </fieldset>
  );
}
