import React, { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { post } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Notice } from '../lib/ui.jsx';

export default function Login() {
  const { login, user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const d = await post('/auth/login', { email, password });
      login(d.token, d.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <h1>تسجيل الدخول</h1>
        <label className="field"><span>البريد الإلكتروني</span>
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </label>
        <label className="field"><span>كلمة المرور</span>
          <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
        </label>
        <Notice msg={error && { type: 'error', text: error }} />
        <button className="btn primary block" disabled={busy}>{busy ? '…' : 'دخول'}</button>
        <p className="muted center">طالب جديد؟ <Link to="/register">إنشاء حساب</Link></p>
      </form>
    </div>
  );
}
