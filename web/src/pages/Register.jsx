import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Notice } from '../lib/ui.jsx';
import { BookingPicker, emptyBooking, toBookingBody } from '../lib/BookingPicker.jsx';

export default function Register() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', birth_date: '' });
  const [booking, setBooking] = useState(emptyBooking);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...form };
      if (!body.birth_date) delete body.birth_date;
      if (!body.phone) delete body.phone;
      const bookingBody = toBookingBody(booking);
      if (bookingBody) body.booking = bookingBody;
      const d = await post('/auth/register', body);
      login(d.token, d.user);
      navigate('/student');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>Create a student account</h1>
        <label className="field"><span>Full name</span><input value={form.name} onChange={set('name')} required /></label>
        <label className="field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} required /></label>
        <label className="field"><span>Password (at least 8 characters)</span><input type="password" minLength={8} value={form.password} onChange={set('password')} required /></label>
        <label className="field"><span>Mobile number (optional)</span><input type="tel" value={form.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Date of birth (optional)</span><input type="date" value={form.birth_date} onChange={set('birth_date')} /></label>
        <BookingPicker value={booking} onChange={setBooking} />
        <Notice msg={error && { type: 'error', text: error }} />
        <button className="btn primary block" disabled={busy}>{busy ? '…' : 'Create account'}</button>
        <p className="muted center">Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </div>
  );
}
