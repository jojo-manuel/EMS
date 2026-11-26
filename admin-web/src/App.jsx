import React, { useEffect, useState, useCallback } from 'react';
import { api, clearAuth, getStoredUser, getToken, setAuth } from './api';
import { createSocket } from './socket';
import LoginPage from './components/LoginPage';
import CalendarView from './components/CalendarView';
import LiveMapView from './components/LiveMapView';
import EmployeesView from './components/EmployeesView';
import AdminsView from './components/AdminsView';
import AttendanceView from './components/AttendanceView';
import NotificationsPanel from './components/NotificationsPanel';

export default function App() {
  const [user, setUser] = useState(getStoredUser());
  const [token, setToken] = useState(getToken());
  const [tab, setTab] = useState('calendar');

  const [tasks, setTasks] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [locations, setLocations] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [toasts, setToasts] = useState([]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    try {
      const promises = [
        api.getTasks(),
        api.getEmployees(),
        api.getLocations(),
        api.getAttendance(),
        api.getNotifications(),
      ];
      if (user?.role === 'superadmin') {
        promises.push(api.getAdmins());
      }
      const [tRes, eRes, lRes, aRes, nRes, admRes] = await Promise.all(promises);
      setTasks(tRes.tasks);
      setEmployees(eRes.employees);
      setLeaves(eRes.leaves || []);
      setLocations(lRes.locations);
      setAttendance(aRes.records);
      setNotifications(nRes.notifications);
      if (admRes) {
        setAdmins(admRes.admins);
      }
    } catch (err) {
      if (String(err.message).includes('Invalid') || String(err.message).includes('Authentication')) {
        clearAuth();
        setToken(null);
        setUser(null);
      }
    }
  }, [token, user?.role]);

  useEffect(() => {
    if (!token) return;
    loadAll();

    const socket = createSocket(token);

    socket.on('task:created', loadAll);
    socket.on('task:updated', loadAll);
    socket.on('task:deleted', loadAll);
    socket.on('attendance:update', loadAll);

    socket.on('location:update', (payload) => {
      setLocations((prev) => {
        const idx = prev.findIndex((l) => l.employee_id === payload.employee_id);
        if (idx === -1) return [...prev, payload];
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...payload };
        return copy;
      });
      setEmployees((prev) =>
        prev.map((e) =>
          e.id === payload.employee_id ? { ...e, is_tracking: payload.is_tracking } : e
        )
      );
    });

    socket.on('notification:new', (notif) => {
      setNotifications((prev) => [notif, ...prev]);
      const toastId = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id: toastId, ...notif }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toastId));
      }, 6500);
    });

    return () => {
      socket.disconnect();
    };
  }, [token, loadAll]);

  useEffect(() => {
    if (!token) return;
    const interval = setInterval(loadAll, 8000);
    return () => clearInterval(interval);
  }, [token, loadAll]);

  function handleLogin(newToken, newUser) {
    setAuth(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
  }

  function handleLogout() {
    clearAuth();
    setToken(null);
    setUser(null);
  }

  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const titles = {
    calendar: 'Work Schedule Calendar',
    map: 'Live Employee Tracking Map',
    attendance: 'Fingerprint Attendance & Punches',
    employees: 'Employees Directory',
    admins: 'Manage Admins (Super Admin)',
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          Emp<span>Tracker</span>
        </div>
        <button className={`nav-btn ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>
          📅 Calendar & Tasks
        </button>
        <button className={`nav-btn ${tab === 'map' ? 'active' : ''}`} onClick={() => setTab('map')}>
          📍 Live Location Map
        </button>
        <button className={`nav-btn ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>
          👆 Punch In / Out Logs
        </button>
        <button className={`nav-btn ${tab === 'employees' ? 'active' : ''}`} onClick={() => setTab('employees')}>
          👥 Employees
        </button>
        {user.role === 'superadmin' && (
          <button className={`nav-btn ${tab === 'admins' ? 'active' : ''}`} onClick={() => setTab('admins')}>
            🛡️ Manage Admins
          </button>
        )}

        <div className="sidebar-footer">
          <div style={{ marginBottom: 6 }}>
            <span className={`badge ${user.role === 'superadmin' ? 'badge-rescheduled' : 'badge-pending'}`}>
              {user.role === 'superadmin'
                ? '🛡️ SUPER ADMIN · ALL UNITS'
                : `ADMIN${user.unit ? ` · ${user.unit}` : ''}`}
            </span>
          </div>
          <div style={{ color: '#fff', fontWeight: 600 }}>{user.name}</div>
          <div style={{ marginBottom: 10 }}>{user.email}</div>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <h2>{titles[tab]}</h2>
          <NotificationsPanel notifications={notifications} onRefresh={loadAll} />
        </header>

        <main className="content">
          {tab === 'calendar' && (
            <CalendarView tasks={tasks} employees={employees} onRefresh={loadAll} />
          )}
          {tab === 'map' && (
            <LiveMapView locations={locations} tasks={tasks} currentUser={user} />
          )}
          {tab === 'attendance' && <AttendanceView records={attendance} />}
          {tab === 'employees' && (
            <EmployeesView
              employees={employees}
              leaves={leaves}
              tasks={tasks}
              currentUser={user}
              onRefresh={loadAll}
            />
          )}
          {tab === 'admins' && user.role === 'superadmin' && (
            <AdminsView admins={admins} currentUser={user} onRefresh={loadAll} />
          )}
        </main>
      </div>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
            <div style={{ color: '#d1d5db' }}>{t.message}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
