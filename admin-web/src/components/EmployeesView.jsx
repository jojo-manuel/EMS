import React, { useState, useMemo } from 'react';
import { api, UNITS } from '../api';

export default function EmployeesView({ employees, currentUser, onRefresh }) {
  const lockedUnit =
    currentUser?.role === 'admin' && currentUser?.unit ? currentUser.unit.toUpperCase() : '';

  const [unitFilter, setUnitFilter] = useState('ALL');
  const [form, setForm] = useState({
    employee_code: '',
    name: '',
    phone: '',
    unit: lockedUnit || UNITS[0],
    area: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [createdCredentials, setCreatedCredentials] = useState(null);
  const [copied, setCopied] = useState(false);

  const visibleEmployees = useMemo(() => {
    if (lockedUnit) return employees;
    if (unitFilter === 'ALL') return employees;
    return employees.filter((e) => (e.unit || '').toUpperCase() === unitFilter);
  }, [employees, lockedUnit, unitFilter]);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    setCreatedCredentials(null);
    setCopied(false);
    try {
      const payload = {
        ...form,
        unit: lockedUnit || form.unit,
      };
      const res = await api.createEmployee(payload);
      setCreatedCredentials({
        name: res.employee.name,
        unit: res.employee.unit,
        username: res.credentials?.username || res.employee.employee_code,
        password: res.credentials?.password || form.password,
      });
      setForm({
        employee_code: '',
        name: '',
        phone: '',
        unit: lockedUnit || form.unit,
        area: '',
        password: '',
      });
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function handleCopyCredentials() {
    if (!createdCredentials) return;
    const text = `Employee: ${createdCredentials.name} (${createdCredentials.unit})\nUsername (Employee ID): ${createdCredentials.username}\nPassword: ${createdCredentials.password}`;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  async function handleDelete(emp) {
    if (!window.confirm(`Remove employee "${emp.name}" (${emp.employee_code}) and their assigned data?`)) return;
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>
            Employees ({visibleEmployees.length})
            {lockedUnit ? ` — ${lockedUnit} Unit` : ''}
          </h3>
          {!lockedUnit && (
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13 }}
            >
              <option value="ALL">All Units ({employees.length})</option>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          )}
        </div>

        {visibleEmployees.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            No employees found for this unit. Use the form on the right to create an employee.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee ID (Username)</th>
                <th>Name</th>
                <th>Phone Number</th>
                <th>Unit</th>
                <th>Area</th>
                <th>Tracking</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp) => (
                <tr key={emp.id}>
                  <td>
                    <span className="badge badge-pending">{emp.employee_code || '—'}</span>
                  </td>
                  <td>
                    <strong>{emp.name}</strong>
                  </td>
                  <td>{emp.phone || '—'}</td>
                  <td>
                    <span className="badge badge-offline">{emp.unit || '—'}</span>
                  </td>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {createdCredentials && (
          <div
            className="card"
            style={{
              background: '#ecfdf5',
              borderColor: '#10b981',
              borderWidth: 2,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ color: '#065f46', fontSize: 15 }}>
                ✓ Employee Created!
              </strong>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '3px 8px', fontSize: 11 }}
                onClick={() => setCreatedCredentials(null)}
              >
                ✕
              </button>
            </div>
            <p style={{ margin: '0 0 10px', fontSize: 12, color: '#047857' }}>
              Share these mobile app login credentials with <strong>{createdCredentials.name}</strong> ({createdCredentials.unit}):
            </p>
            <div
              style={{
                background: '#fff',
                border: '1px solid #a7f3d0',
                borderRadius: 8,
                padding: 12,
                fontSize: 13,
                marginBottom: 10,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: '#6b7280' }}>Username (Emp Code): </span>
                <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>
                  {createdCredentials.username}
                </strong>
              </div>
              <div>
                <span style={{ color: '#6b7280' }}>Password: </span>
                <strong style={{ fontFamily: 'monospace', fontSize: 14 }}>
                  {createdCredentials.password}
                </strong>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', background: '#059669' }}
              onClick={handleCopyCredentials}
            >
              {copied ? '✓ Copied to Clipboard' : '📋 Copy Username & Password'}
            </button>
          </div>
        )}

        <form className="card" onSubmit={handleAdd}>
          <h3 style={{ marginTop: 0 }}>Create New Employee</h3>
          {error && <div className="error-banner">{error}</div>}

          <div className="field">
            <label>Employee ID (Mobile Login Username) *</label>
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
              {lockedUnit ? (
                <input value={lockedUnit} disabled style={{ background: '#f3f4f6', fontWeight: 700 }} />
              ) : (
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  required
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="field">
              <label>Area *</label>
              <input
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="e.g., City Center"
                required
              />
            </div>
          </div>

          <div className="field">
            <label>Password (Optional — Auto-generated if blank)</label>
            <input
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Leave blank to auto-generate password"
            />
          </div>

          <button className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
            {saving ? 'Creating...' : 'Create Employee & Generate Login'}
          </button>
        </form>
      </div>
    </div>
  );
}
