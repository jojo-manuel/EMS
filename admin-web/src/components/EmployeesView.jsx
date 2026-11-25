import React, { useState } from 'react';
import { api } from '../api';

export default function EmployeesView({ employees, onRefresh }) {
  const [form, setForm] = useState({
    employee_code: '',
    name: '',
    phone: '',
    unit: '',
    area: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createEmployee(form);
      setForm({
        employee_code: '',
        name: '',
        phone: '',
        unit: '',
        area: '',
        email: '',
        password: '',
      });
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(emp) {
    if (!window.confirm(`Remove employee "${emp.name}" (${emp.employee_code || emp.email}) and their assigned data?`)) return;
    try {
      await api.deleteEmployee(emp.id);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Employees ({employees.length})</h3>
        {employees.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            No employees added yet. Use the form on the right to create an employee with Employee ID, Name, Phone Number, Unit, and Area.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee ID</th>
                <th>Name</th>
                <th>Phone Number</th>
                <th>Unit</th>
                <th>Area</th>
                <th>Tracking</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <span className="badge badge-pending">{emp.employee_code || '—'}</span>
                  </td>
                  <td>
                    <strong>{emp.name}</strong>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{emp.email}</div>
                  </td>
                  <td>{emp.phone || '—'}</td>
                  <td>{emp.unit || '—'}</td>
                  <td>{emp.area || '—'}</td>
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
        <h3 style={{ marginTop: 0 }}>Create New Employee</h3>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label>Employee ID *</label>
          <input
            value={form.employee_code}
            onChange={(e) => setForm({ ...form, employee_code: e.target.value })}
            placeholder="e.g., EMP-001"
            required
          />
        </div>

        <div className="field">
          <label>Full Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Employee full name"
            required
          />
        </div>

        <div className="field">
          <label>Phone Number *</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="e.g., +91 9876543210"
            required
          />
        </div>

        <div className="grid-2">
          <div className="field">
            <label>Unit *</label>
            <input
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
              placeholder="e.g., Unit 1 / Field"
              required
            />
          </div>

          <div className="field">
            <label>Area *</label>
            <input
              value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })}
              placeholder="e.g., North Zone"
              required
            />
          </div>
        </div>

        <div className="field">
          <label>Email (Optional)</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Leave blank to use Employee ID login"
          />
        </div>

        <div className="field">
          <label>Login Password *</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder="Set password for mobile app login"
            required
          />
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Creating...' : 'Create Employee'}
        </button>
      </form>
    </div>
  );
}
