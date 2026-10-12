import React, { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Notice } from '../lib/ui.jsx';

export default function Register() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', birth_date: '' });
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
        <h1>إنشاء حساب طالب</h1>
        <label className="field"><span>الاسم</span><input value={form.name} onChange={set('name')} required /></label>
        <label className="field"><span>البريد الإلكتروني</span><input type="email" dir="ltr" value={form.email} onChange={set('email')} required /></label>
        <label className="field"><span>كلمة المرور (8 أحرف على الأقل)</span><input type="password" dir="ltr" minLength={8} value={form.password} onChange={set('password')} required /></label>
        <label className="field"><span>رقم الموبايل (اختياري)</span><input type="tel" dir="ltr" value={form.phone} onChange={set('phone')} /></label>
        <label className="field"><span>تاريخ الميلاد (اختياري)</span><input type="date" dir="ltr" value={form.birth_date} onChange={set('birth_date')} /></label>
        <Notice msg={error && { type: 'error', text: error }} />
        <button className="btn primary block" disabled={busy}>{busy ? '…' : 'إنشاء الحساب'}</button>
        <p className="muted center">لديك حساب؟ <Link to="/login">تسجيل الدخول</Link></p>
      </form>
    </div>
  );
}
