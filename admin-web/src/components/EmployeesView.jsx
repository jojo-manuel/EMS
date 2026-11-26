import React, { useState, useMemo } from 'react';
import { api, UNITS } from '../api';

function todayIsoDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EmployeesView({
  employees,
  leaves = [],
  tasks = [],
  currentUser,
  onRefresh,
}) {
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

  // Leave + Task Transfer Modal state
  const [leaveTargetEmp, setLeaveTargetEmp] = useState(null);
  const [leaveForm, setLeaveForm] = useState({
    leave_type: 'single_day', // 'single_day' | 'custom'
    start_date: todayIsoDate(),
    end_date: todayIsoDate(),
    reason: '',
    transfer_to: '',
  });
  const [leaveError, setLeaveError] = useState('');
  const [savingLeave, setSavingLeave] = useState(false);

  const visibleEmployees = useMemo(() => {
    if (lockedUnit) return employees;
    if (unitFilter === 'ALL') return employees;
    return employees.filter((e) => (e.unit || '').toUpperCase() === unitFilter);
  }, [employees, lockedUnit, unitFilter]);

  const visibleLeaves = useMemo(() => {
    if (lockedUnit) return leaves;
    if (unitFilter === 'ALL') return leaves;
    return leaves.filter((lv) => (lv.employee_unit || '').toUpperCase() === unitFilter);
  }, [leaves, lockedUnit, unitFilter]);

  // Count how many open tasks the selected leave employee has during the chosen date range
  const affectedTasksDuringLeave = useMemo(() => {
    if (!leaveTargetEmp || !leaveForm.start_date) return [];
    const endDate =
      leaveForm.leave_type === 'single_day' ? leaveForm.start_date : leaveForm.end_date || leaveForm.start_date;
    const startMs = new Date(`${leaveForm.start_date}T00:00:00`).getTime();
    const endMs = new Date(`${endDate}T23:59:59.999`).getTime();

    return tasks.filter((t) => {
      if (String(t.assigned_to) !== String(leaveTargetEmp.id)) return false;
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      const tMs = new Date(t.scheduled_start).getTime();
      return tMs >= startMs && tMs <= endMs;
    });
  }, [leaveTargetEmp, leaveForm.leave_type, leaveForm.start_date, leaveForm.end_date, tasks]);

  // Eligible coworkers (same unit, excluding the employee going on leave)
  const transferCandidates = useMemo(() => {
    if (!leaveTargetEmp) return [];
    return employees.filter(
      (e) =>
        String(e.id) !== String(leaveTargetEmp.id) &&
        (!leaveTargetEmp.unit || (e.unit || '').toUpperCase() === (leaveTargetEmp.unit || '').toUpperCase())
    );
  }, [employees, leaveTargetEmp]);

  const openLeaveModal = (emp) => {
    const candidates = employees.filter(
      (e) =>
        String(e.id) !== String(emp.id) &&
        (!emp.unit || (e.unit || '').toUpperCase() === (emp.unit || '').toUpperCase())
    );
    setLeaveTargetEmp(emp);
    setLeaveError('');
    setLeaveForm({
      leave_type: 'single_day',
      start_date: todayIsoDate(),
      end_date: todayIsoDate(),
      reason: '',
      transfer_to: candidates[0]?.id ? String(candidates[0].id) : '',
    });
  };

  async function handleSaveLeave(e) {
    e.preventDefault();
    if (!leaveTargetEmp) return;
    setLeaveError('');
    setSavingLeave(true);
    try {
      const payload = {
        leave_type: leaveForm.leave_type,
        start_date: leaveForm.start_date,
        end_date:
          leaveForm.leave_type === 'single_day' ? leaveForm.start_date : leaveForm.end_date,
        reason: leaveForm.reason,
        transfer_to: leaveForm.transfer_to || '',
      };
      await api.markEmployeeLeave(leaveTargetEmp.id, payload);
      setLeaveTargetEmp(null);
      onRefresh();
    } catch (err) {
      setLeaveError(err.message);
    } finally {
      setSavingLeave(false);
    }
  }

  async function handleCancelLeave(lv) {
    if (!window.confirm(`Cancel leave for ${lv.employee_name} (${lv.start_date} to ${lv.end_date})?`)) return;
    try {
      await api.deleteLeave(lv.id);
      onRefresh();
    } catch (err) {
      alert(err.message);
    }
  }

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Unit / Area</th>
                  <th>Status / Leave</th>
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
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                        {emp.area || '—'}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${emp.is_tracking ? 'badge-live' : 'badge-offline'}`}>
                        {emp.is_tracking ? '● Live' : 'Offline'}
                      </span>
                      {emp.active_leave && (
                        <div style={{ marginTop: 5 }}>
                          <span className="badge badge-rescheduled">
                            🏖️ Leave:{' '}
                            {emp.active_leave.start_date === emp.active_leave.end_date
                              ? emp.active_leave.start_date
                              : `${emp.active_leave.start_date} → ${emp.active_leave.end_date}`}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '5px 10px', fontSize: 12 }}
                          onClick={() => openLeaveModal(emp)}
                        >
                          🏖️ Mark Leave / Transfer
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          style={{ padding: '5px 10px', fontSize: 12 }}
                          onClick={() => handleDelete(emp)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Active & Upcoming Leaves Table */}
        {visibleLeaves.length > 0 && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Active & Scheduled Leaves ({visibleLeaves.length})</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Unit</th>
                  <th>Leave Type</th>
                  <th>Dates</th>
                  <th>Reason</th>
                  <th>Work Transferred To</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {visibleLeaves.map((lv) => (
                  <tr key={lv.id}>
                    <td>
                      <strong>{lv.employee_name}</strong> ({lv.employee_code})
                    </td>
                    <td>{lv.employee_unit || '—'}</td>
                    <td>
                      <span className="badge badge-rescheduled">
                        {lv.leave_type === 'single_day' ? 'Single Day' : 'Custom Range'}
                      </span>
                    </td>
                    <td>
                      {lv.start_date === lv.end_date
                        ? lv.start_date
                        : `${lv.start_date} → ${lv.end_date}`}
                    </td>
                    <td>{lv.reason || '—'}</td>
                    <td>
                      {lv.transfer_to_name
                        ? `${lv.transfer_to_name} (${lv.transferred_tasks_count} tasks)`
                        : 'Not transferred'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '4px 9px', fontSize: 12 }}
                        onClick={() => handleCancelLeave(lv)}
                      >
                        Cancel Leave
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

      {/* Mark Employee on Leave & Transfer Tasks Modal */}
      {leaveTargetEmp && (
        <div className="modal-backdrop" onClick={() => setLeaveTargetEmp(null)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSaveLeave}>
            <div className="modal-header">
              <h3>🏖️ Mark Leave & Transfer Work</h3>
              <span className="badge badge-pending">
                {leaveTargetEmp.name} ({leaveTargetEmp.unit})
              </span>
            </div>

            {leaveError && <div className="error-banner">{leaveError}</div>}

            <div className="field">
              <label>Leave Duration Type</label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className={`btn ${leaveForm.leave_type === 'single_day' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1 }}
                  onClick={() =>
                    setLeaveForm({
                      ...leaveForm,
                      leave_type: 'single_day',
                      end_date: leaveForm.start_date,
                    })
                  }
                >
                  Single Day Leave
                </button>
                <button
                  type="button"
                  className={`btn ${leaveForm.leave_type === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                  style={{ flex: 1 }}
                  onClick={() =>
                    setLeaveForm({
                      ...leaveForm,
                      leave_type: 'custom',
                    })
                  }
                >
                  Custom Date Range
                </button>
              </div>
            </div>

            {leaveForm.leave_type === 'single_day' ? (
              <div className="field">
                <label>Leave Date *</label>
                <input
                  type="date"
                  value={leaveForm.start_date}
                  onChange={(e) =>
                    setLeaveForm({
                      ...leaveForm,
                      start_date: e.target.value,
                      end_date: e.target.value,
                    })
                  }
                  required
                />
              </div>
            ) : (
              <div className="grid-2">
                <div className="field">
                  <label>From Date *</label>
                  <input
                    type="date"
                    value={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, start_date: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>To Date *</label>
                  <input
                    type="date"
                    value={leaveForm.end_date}
                    min={leaveForm.start_date}
                    onChange={(e) => setLeaveForm({ ...leaveForm, end_date: e.target.value })}
                    required
                  />
                </div>
              </div>
            )}

            <div className="field">
              <label>Leave Reason</label>
              <input
                value={leaveForm.reason}
                onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                placeholder="e.g., Medical / Personal leave"
              />
            </div>

            <div
              className="card"
              style={{
                background: '#eff6ff',
                borderColor: '#bfdbfe',
                padding: 14,
                marginBottom: 14,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', marginBottom: 8 }}>
                ⇄ Transfer Scheduled Tasks ({affectedTasksDuringLeave.length} open task(s) during leave)
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Transfer Assigned Work To</label>
                <select
                  value={leaveForm.transfer_to}
                  onChange={(e) => setLeaveForm({ ...leaveForm, transfer_to: e.target.value })}
                >
                  <option value="">— Do Not Transfer Tasks —</option>
                  {transferCandidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.employee_code || c.unit})
                      {c.on_leave_today ? ' [On Leave]' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setLeaveTargetEmp(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={savingLeave}>
                {savingLeave ? 'Saving...' : 'Confirm Leave & Transfer Work'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
