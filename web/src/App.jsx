import React from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import { StudentHome, StudentSchedule, StudentProgress, StudentBilling, StudentProfile, Notifications } from './pages/StudentPages.jsx';
import { CoachSchedule, LessonPage, CoachStudent, CoachReports } from './pages/CoachPages.jsx';
import { AdminDashboard, AdminUsers, AdminClasses, AdminBilling, AdminContent, AdminSystem } from './pages/AdminPages.jsx';

const NAV = {
  student: [
    { to: '/student', label: 'الرئيسية', end: true },
    { to: '/student/schedule', label: 'الجدول' },
    { to: '/student/progress', label: 'تقدمي' },
    { to: '/student/billing', label: 'الاشتراك' },
    { to: '/student/profile', label: 'حسابي' },
    { to: '/notifications', label: 'الإشعارات' },
  ],
  coach: [
    { to: '/coach', label: 'حصصي', end: true },
    { to: '/coach/reports', label: 'التقارير' },
    { to: '/notifications', label: 'الإشعارات' },
  ],
  admin: [
    { to: '/admin', label: 'لوحة التحكم', end: true },
    { to: '/admin/users', label: 'المستخدمون' },
    { to: '/admin/classes', label: 'الكلاسات' },
    { to: '/admin/billing', label: 'المالية' },
    { to: '/admin/content', label: 'المحتوى' },
    { to: '/admin/system', label: 'النظام' },
  ],
};

const HOME = { student: '/student', coach: '/coach', admin: '/admin' };

function Shell({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const links = NAV[user.role];
  return (
    <div className="app">
      <header className="topbar">
        <strong className="brand">أكاديمية السباحة</strong>
        <nav className="desktop-nav">
          {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
        </nav>
        <div className="top-user">
          <span className="muted hide-sm">{user.name}</span>
          <button className="btn ghost" onClick={() => { logout(); navigate('/login'); }}>خروج</button>
        </div>
      </header>
      <main className="content">{children}</main>
      <nav className="bottom-nav" aria-label="القائمة الرئيسية">
        {links.map((l) => <NavLink key={l.to} to={l.to} end={l.end}>{l.label}</NavLink>)}
      </nav>
    </div>
  );
}

function RequireAuth({ roles, children }) {
  const { user, ready } = useAuth();
  if (!ready) return <p className="muted center">جارٍ التحميل…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={HOME[user.role]} replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  const { user, ready } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={ready && user ? <Navigate to={HOME[user.role]} replace /> : <Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Navigate to={user ? HOME[user.role] : '/login'} replace />} />

      <Route path="/student" element={<RequireAuth roles={['student']}><StudentHome /></RequireAuth>} />
      <Route path="/student/schedule" element={<RequireAuth roles={['student']}><StudentSchedule /></RequireAuth>} />
      <Route path="/student/progress" element={<RequireAuth roles={['student']}><StudentProgress /></RequireAuth>} />
      <Route path="/student/billing" element={<RequireAuth roles={['student']}><StudentBilling /></RequireAuth>} />
      <Route path="/student/profile" element={<RequireAuth roles={['student']}><StudentProfile /></RequireAuth>} />
      <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />

      <Route path="/coach" element={<RequireAuth roles={['coach']}><CoachSchedule /></RequireAuth>} />
      <Route path="/coach/lessons/:id" element={<RequireAuth roles={['coach', 'admin']}><LessonPage /></RequireAuth>} />
      <Route path="/coach/students/:id" element={<RequireAuth roles={['coach', 'admin']}><CoachStudent /></RequireAuth>} />
      <Route path="/coach/reports" element={<RequireAuth roles={['coach', 'admin']}><CoachReports /></RequireAuth>} />

      <Route path="/admin" element={<RequireAuth roles={['admin']}><AdminDashboard /></RequireAuth>} />
      <Route path="/admin/users" element={<RequireAuth roles={['admin']}><AdminUsers /></RequireAuth>} />
      <Route path="/admin/classes" element={<RequireAuth roles={['admin']}><AdminClasses /></RequireAuth>} />
      <Route path="/admin/billing" element={<RequireAuth roles={['admin']}><AdminBilling /></RequireAuth>} />
      <Route path="/admin/content" element={<RequireAuth roles={['admin']}><AdminContent /></RequireAuth>} />
      <Route path="/admin/system" element={<RequireAuth roles={['admin']}><AdminSystem /></RequireAuth>} />

      <Route path="*" element={<p className="center">الصفحة غير موجودة</p>} />
    </Routes>
  );
}
