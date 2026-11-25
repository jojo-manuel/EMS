import React, { useState } from 'react';
import { api, UNITS } from '../api';

export default function AdminsView({ admins, currentUser, onRefresh }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    unit: UNITS[0],
    area: '',
    role: 'admin',
    password: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await api.createAdmin(form);
      setForm({
        name: '',
        email: '',
        phone: '',
        unit: UNITS[0],
        area: '',
        role: 'admin',
        password: '',
      });
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(adm) {
    if (!window.confirm(`Remove ${adm.role} "${adm.name}" (${adm.email})?`)) return;
    try {
      await api.deleteAdmin(adm.id);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 20 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Admins & Super Admins ({admins.length})</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Assigned Unit</th>
              <th>Area</th>
              <th>Role</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {admins.map((adm) => (
              <tr key={adm.id}>
                <td><strong>{adm.name}</strong></td>
                <td>{adm.email}</td>
                <td>{adm.phone || '—'}</td>
                <td>
                  <span className="badge badge-offline">
                    {adm.role === 'superadmin' ? 'ALL UNITS' : adm.unit || 'ALL UNITS'}
                  </span>
                </td>
                <td>{adm.area || '—'}</td>
                <td>
                  <span className={`badge ${adm.role === 'superadmin' ? 'badge-rescheduled' : 'badge-pending'}`}>
                    {adm.role === 'superadmin' ? '🛡️ Super Admin' : 'Admin'}
                  </span>
                </td>
                <td>
                  {String(adm.id) !== String(currentUser.id) && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      onClick={() => handleDelete(adm)}
                    >
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="card" onSubmit={handleAdd} style={{ alignSelf: 'start' }}>
        <h3 style={{ marginTop: 0 }}>Create Admin Account</h3>
        {error && <div className="error-banner">{error}</div>}

        <div className="field">
          <label>Full Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div className="field">
          <label>Email *</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>

        <div className="field">
          <label>Phone Number</label>
          <input
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>

        <div className="field">
          <label>Role *</label>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            <option value="admin">Unit Admin (Sees Only Assigned Unit)</option>
            <option value="superadmin">Super Admin (Sees All Units)</option>
          </select>
        </div>

        {form.role === 'admin' && (
          <div className="grid-2">
            <div className="field">
              <label>Assigned Unit *</label>
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
            </div>
            <div className="field">
              <label>Area</label>
              <input
                value={form.area}
                onChange={(e) => setForm({ ...form, area: e.target.value })}
                placeholder="Optional area"
              />
            </div>
          </div>
        )}

        <div className="field">
          <label>Password *</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
        </div>

        <button className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
          {saving ? 'Creating...' : 'Create Admin Account'}
        </button>
      </form>
    </div>
  );
}
