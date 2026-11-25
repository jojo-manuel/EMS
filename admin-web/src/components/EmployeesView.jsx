import React, { useState } from 'react';
import { api } from '../api';

export default function EmployeesView({ employees, onRefresh }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createEmployee(form);
      setForm({ name: '', email: '', phone: '', password: '' });
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(emp) {
    if (!window.confirm(`Remove employee "${emp.name}" and their assigned data?`)) return;
    try {
      await api.deleteEmployee(emp.id);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 20 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Team Members ({employees.length})</h3>
        {employees.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            No employees added yet. Use the form on the right to create your first employee account.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Tracking Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td><strong>{emp.name}</strong></td>
                  <td>{emp.email}</td>
                  <td>{emp.phone || '—'}</td>
                  <td>
                    <span className={`badge ${emp.is_tracking ? 'badge-live' : 'badge-offline'}`}>
                      {emp.is_tracking ? '● Live' : 'Offline'}
                    </span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      onClick={() => handleDelete(emp)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form className="card" onSubmit={handleAdd} style={{ alignSelf: 'start' }}>
        <h3 style={{ marginTop: 0 }}>Add Employee</h3>
        {error && <div className="error-banner">{error}</div>}
        <div className="field">
          <label>Full Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label>Phone</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Adding...' : 'Create Employee Account'}
        </button>
      </form>
    </div>
  );
}
