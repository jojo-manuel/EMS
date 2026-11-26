import React, { useState, useMemo, useEffect } from 'react';
import { api, UNITS } from '../api';

function todayIsoDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function LeaveTransferView({
  employees = [],
  leaves = [],
  tasks = [],
  currentUser,
  onRefresh,
}) {
  const lockedUnit =
    currentUser?.role === 'admin' && currentUser?.unit ? currentUser.unit.toUpperCase() : '';

  const [unitFilter, setUnitFilter] = useState('ALL');

  const visibleEmployees = useMemo(() => {
    if (lockedUnit) return employees;
    if (unitFilter === 'ALL') return employees;
    return employees.filter((e) => (e.unit || '').toUpperCase() === unitFilter);
  }, [employees, lockedUnit, unitFilter]);

  // 1. Mark Leave & Transfer Form state
  const [leaveEmpId, setLeaveEmpId] = useState('');
  const [leaveType, setLeaveType] = useState('single_day'); // 'single_day' | 'custom'
  const [startDate, setStartDate] = useState(todayIsoDate());
  const [endDate, setEndDate] = useState(todayIsoDate());
  const [reason, setReason] = useState('');
  const [transferToId, setTransferToId] = useState('');
  const [includeAllOpenTasks, setIncludeAllOpenTasks] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [leaveMsg, setLeaveMsg] = useState('');
  const [leaveErr, setLeaveErr] = useState('');
  const [savingLeave, setSavingLeave] = useState(false);

  // 2. Direct Work Transfer state (without marking leave)
  const [fromEmpId, setFromEmpId] = useState('');
  const [directToEmpId, setDirectToEmpId] = useState('');
  const [directTaskIds, setDirectTaskIds] = useState([]);
  const [directMsg, setDirectMsg] = useState('');
  const [directErr, setDirectErr] = useState('');
  const [transferringDirect, setTransferringDirect] = useState(false);

  useEffect(() => {
    if (!leaveEmpId && visibleEmployees.length > 0) {
      setLeaveEmpId(String(visibleEmployees[0].id));
    }
    if (!fromEmpId && visibleEmployees.length > 0) {
      setFromEmpId(String(visibleEmployees[0].id));
    }
  }, [visibleEmployees, leaveEmpId, fromEmpId]);

  const leaveEmp = useMemo(
    () => employees.find((e) => String(e.id) === String(leaveEmpId)) || null,
    [employees, leaveEmpId]
  );

  const leaveTransferCandidates = useMemo(() => {
    if (!leaveEmp) return [];
    return employees.filter(
      (e) =>
        String(e.id) !== String(leaveEmp.id) &&
        (!leaveEmp.unit || (e.unit || '').toUpperCase() === (leaveEmp.unit || '').toUpperCase())
    );
  }, [employees, leaveEmp]);

  useEffect(() => {
    if (
      leaveTransferCandidates.length > 0 &&
      !leaveTransferCandidates.some((c) => String(c.id) === String(transferToId))
    ) {
      setTransferToId(String(leaveTransferCandidates[0].id));
    } else if (leaveTransferCandidates.length === 0) {
      setTransferToId('');
    }
  }, [leaveTransferCandidates, transferToId]);

  // Open tasks belonging to the employee going on leave
  const candidateLeaveTasks = useMemo(() => {
    if (!leaveEmpId) return [];
    const effectiveEnd = leaveType === 'single_day' ? startDate : endDate || startDate;
    const startMs = new Date(`${startDate}T00:00:00`).getTime();
    const endMs = new Date(`${effectiveEnd}T23:59:59.999`).getTime();

    return tasks.filter((t) => {
      if (String(t.assigned_to) !== String(leaveEmpId)) return false;
      if (t.status === 'completed' || t.status === 'cancelled') return false;
      if (includeAllOpenTasks) return true;
      const tMs = new Date(t.scheduled_start).getTime();
      return tMs >= startMs && tMs <= endMs;
    });
  }, [tasks, leaveEmpId, leaveType, startDate, endDate, includeAllOpenTasks]);

  useEffect(() => {
    setSelectedTaskIds(candidateLeaveTasks.map((t) => String(t.id)));
  }, [candidateLeaveTasks]);

  const toggleLeaveTaskSelection = (taskId) => {
    const idStr = String(taskId);
    setSelectedTaskIds((prev) =>
      prev.includes(idStr) ? prev.filter((x) => x !== idStr) : [...prev, idStr]
    );
  };

  async function handleMarkLeaveAndTransfer(e) {
    e.preventDefault();
    if (!leaveEmpId) return;
    setLeaveErr('');
    setLeaveMsg('');
    setSavingLeave(true);
    try {
      const res = await api.markEmployeeLeave(leaveEmpId, {
        leave_type: leaveType,
        start_date: startDate,
        end_date: leaveType === 'single_day' ? startDate : endDate,
        reason,
        transfer_to: transferToId || '',
        task_ids: selectedTaskIds,
      });
      setReason('');
      setLeaveMsg(
        `✓ ${leaveEmp?.name || 'Employee'} marked on leave (${
          leaveType === 'single_day' ? startDate : `${startDate} → ${endDate}`
        }). ${res.transferred_tasks_count || 0} task(s) transferred.`
      );
      onRefresh();
    } catch (err) {
      setLeaveErr(err.message);
    } finally {
      setSavingLeave(false);
    }
  }

  // Direct transfer helpers
  const fromEmp = useMemo(
    () => employees.find((e) => String(e.id) === String(fromEmpId)) || null,
    [employees, fromEmpId]
  );

  const directCandidates = useMemo(() => {
    if (!fromEmp) return [];
    return employees.filter(
      (e) =>
        String(e.id) !== String(fromEmp.id) &&
        (!fromEmp.unit || (e.unit || '').toUpperCase() === (fromEmp.unit || '').toUpperCase())
    );
  }, [employees, fromEmp]);

  useEffect(() => {
    if (
      directCandidates.length > 0 &&
      !directCandidates.some((c) => String(c.id) === String(directToEmpId))
    ) {
      setDirectToEmpId(String(directCandidates[0].id));
    } else if (directCandidates.length === 0) {
      setDirectToEmpId('');
    }
  }, [directCandidates, directToEmpId]);

  const openTasksForFromEmp = useMemo(() => {
    return tasks.filter(
      (t) =>
        String(t.assigned_to) === String(fromEmpId) &&
        t.status !== 'completed' &&
        t.status !== 'cancelled'
    );
  }, [tasks, fromEmpId]);

  useEffect(() => {
    setDirectTaskIds(openTasksForFromEmp.map((t) => String(t.id)));
  }, [openTasksForFromEmp]);

  const toggleDirectTask = (taskId) => {
    const idStr = String(taskId);
    setDirectTaskIds((prev) =>
      prev.includes(idStr) ? prev.filter((x) => x !== idStr) : [...prev, idStr]
    );
  };

  async function handleDirectTransfer(e) {
    e.preventDefault();
    if (!directToEmpId || directTaskIds.length === 0) {
      setDirectErr('Please select at least one task and a target employee.');
      return;
    }
    setDirectErr('');
    setDirectMsg('');
    setTransferringDirect(true);
    try {
      for (const tId of directTaskIds) {
        await api.transferTask(tId, directToEmpId);
      }
      const targetName =
        employees.find((emp) => String(emp.id) === String(directToEmpId))?.name || 'Employee';
      setDirectMsg(`✓ Transferred ${directTaskIds.length} task(s) to ${targetName}.`);
      onRefresh();
    } catch (err) {
      setDirectErr(err.message);
    } finally {
      setTransferringDirect(false);
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

  const visibleLeaves = useMemo(() => {
    if (lockedUnit) return leaves;
    if (unitFilter === 'ALL') return leaves;
    return leaves.filter((lv) => (lv.employee_unit || '').toUpperCase() === unitFilter);
  }, [leaves, lockedUnit, unitFilter]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {!lockedUnit && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 13,
              background: '#fff',
              fontWeight: 600,
            }}
          >
            <option value="ALL">All Units ({employees.length} employees)</option>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Left Card: Mark Employee on Leave & Auto-Transfer Work */}
        <form className="card" onSubmit={handleMarkLeaveAndTransfer}>
          <h3 style={{ marginTop: 0 }}>🏖️ Mark Employee Leave & Transfer Work</h3>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: -6, marginBottom: 16 }}>
            Mark an employee on leave for a single day or custom date range and automatically transfer their scheduled tasks to another employee.
          </p>

          {leaveErr && <div className="error-banner">{leaveErr}</div>}
          {leaveMsg && (
            <div
              className="error-banner"
              style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}
            >
              {leaveMsg}
            </div>
          )}

          <div className="field">
            <label>Select Employee Going on Leave *</label>
            <select
              value={leaveEmpId}
              onChange={(e) => setLeaveEmpId(e.target.value)}
              required
            >
              {visibleEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employee_code || emp.unit}) — {emp.unit}
                  {emp.active_leave ? ` [On Leave: ${emp.active_leave.start_date}]` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Leave Duration *</label>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className={`btn ${leaveType === 'single_day' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => {
                  setLeaveType('single_day');
                  setEndDate(startDate);
                }}
              >
                Single Day Leave
              </button>
              <button
                type="button"
                className={`btn ${leaveType === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setLeaveType('custom')}
              >
                Custom Date Range
              </button>
            </div>
          </div>

          {leaveType === 'single_day' ? (
            <div className="field">
              <label>Leave Date *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setEndDate(e.target.value);
                }}
                required
              />
            </div>
          ) : (
            <div className="grid-2">
              <div className="field">
                <label>From Date *</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label>To Date *</label>
                <input
                  type="date"
                  value={endDate}
                  min={startDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <div className="field">
            <label>Leave Reason</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g., Sick Leave / Personal Leave"
            />
          </div>

          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13, color: '#1e40af' }}>
                ⇄ Transfer Work During Leave ({selectedTaskIds.length} selected)
              </strong>
              <label style={{ fontSize: 12, color: '#1e40af', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <input
                  type="checkbox"
                  checked={includeAllOpenTasks}
                  onChange={(e) => setIncludeAllOpenTasks(e.target.checked)}
                />
                Show all open tasks
              </label>
            </div>

            <div className="field" style={{ marginBottom: 10 }}>
              <label>Transfer Assigned Tasks To Employee ({leaveEmp?.unit || ''})</label>
              <select
                value={transferToId}
                onChange={(e) => setTransferToId(e.target.value)}
              >
                <option value="">— Do Not Transfer Tasks —</option>
                {leaveTransferCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.employee_code || c.unit})
                    {c.on_leave_today ? ' [On Leave]' : ''}
                  </option>
                ))}
              </select>
            </div>

            {candidateLeaveTasks.length === 0 ? (
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                No open tasks scheduled for {leaveEmp?.name || 'this employee'} on the selected date(s).
                {!includeAllOpenTasks && ' Check "Show all open tasks" above to transfer tasks from other dates.'}
              </div>
            ) : (
              <div style={{ maxHeight: 150, overflowY: 'auto', background: '#fff', borderRadius: 8, padding: 8, border: '1px solid #dbeafe' }}>
                {candidateLeaveTasks.map((t) => (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 4px',
                      borderBottom: '1px solid #f3f4f6',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(String(t.id))}
                      onChange={() => toggleLeaveTaskSelection(t.id)}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>{t.title}</strong>
                      <div style={{ color: '#6b7280', fontSize: 11 }}>
                        {new Date(t.scheduled_start).toLocaleString()} {t.address ? `· ${t.address}` : ''}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={savingLeave}>
            {savingLeave ? 'Saving...' : '🏖️ Confirm Leave & Transfer Selected Tasks'}
          </button>
        </form>

        {/* Right Card: Direct Task Transfer Between Employees (Anytime) */}
        <form className="card" onSubmit={handleDirectTransfer}>
          <h3 style={{ marginTop: 0 }}>⇄ Direct Work Transfer Between Employees</h3>
          <p style={{ color: '#6b7280', fontSize: 13, marginTop: -6, marginBottom: 16 }}>
            Transfer one or more assigned tasks from one employee to another anytime without marking leave.
          </p>

          {directErr && <div className="error-banner">{directErr}</div>}
          {directMsg && (
            <div
              className="error-banner"
              style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}
            >
              {directMsg}
            </div>
          )}

          <div className="field">
            <label>Transfer Work From Employee *</label>
            <select
              value={fromEmpId}
              onChange={(e) => setFromEmpId(e.target.value)}
              required
            >
              {visibleEmployees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.employee_code || emp.unit}) — {emp.unit}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Transfer Work To Employee ({fromEmp?.unit || ''}) *</label>
            <select
              value={directToEmpId}
              onChange={(e) => setDirectToEmpId(e.target.value)}
              required
            >
              {directCandidates.length === 0 ? (
                <option value="">No other employees in {fromEmp?.unit || 'this unit'}</option>
              ) : (
                directCandidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.employee_code || c.unit})
                    {c.on_leave_today ? ' [🏖️ On Leave]' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="field">
            <label>
              Select Open Tasks to Transfer ({directTaskIds.length} of {openTasksForFromEmp.length} selected)
            </label>
            {openTasksForFromEmp.length === 0 ? (
              <div
                style={{
                  padding: 16,
                  background: '#f9fafb',
                  borderRadius: 8,
                  border: '1px solid #e5e7eb',
                  color: '#6b7280',
                  fontSize: 13,
                }}
              >
                {fromEmp?.name || 'This employee'} currently has no open tasks to transfer.
              </div>
            ) : (
              <div
                style={{
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: '#f9fafb',
                  borderRadius: 8,
                  padding: 10,
                  border: '1px solid #e5e7eb',
                }}
              >
                {openTasksForFromEmp.map((t) => (
                  <label
                    key={t.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 6px',
                      borderBottom: '1px solid #e5e7eb',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={directTaskIds.includes(String(t.id))}
                      onChange={() => toggleDirectTask(t.id)}
                    />
                    <div style={{ flex: 1 }}>
                      <strong>{t.title}</strong>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>
                        📅 {new Date(t.scheduled_start).toLocaleString()}
                        {t.address ? ` · 📍 ${t.address}` : ''}
                      </div>
                    </div>
                    <span className={`badge badge-${t.status}`}>{t.status}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={transferringDirect || directTaskIds.length === 0 || !directToEmpId}
          >
            {transferringDirect
              ? 'Transferring...'
              : `⇄ Transfer ${directTaskIds.length} Selected Task(s)`}
          </button>
        </form>
      </div>

      {/* Bottom Table: Active & Scheduled Leaves */}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Active & Scheduled Employee Leaves ({visibleLeaves.length})</h3>
        {visibleLeaves.length === 0 ? (
          <p style={{ color: '#6b7280', fontSize: 14 }}>
            No employees are currently marked on leave.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th>Unit</th>
                <th>Leave Type</th>
                <th>Leave Date(s)</th>
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
                  <td>
                    <span className="badge badge-offline">{lv.employee_unit || '—'}</span>
                  </td>
                  <td>
                    <span className="badge badge-rescheduled">
                      {lv.leave_type === 'single_day' ? 'Single Day' : 'Custom Range'}
                    </span>
                  </td>
                  <td>
                    <strong>
                      {lv.start_date === lv.end_date
                        ? lv.start_date
                        : `${lv.start_date} → ${lv.end_date}`}
                    </strong>
                  </td>
                  <td>{lv.reason || '—'}</td>
                  <td>
                    {lv.transfer_to_name ? (
                      <span className="badge badge-live">
                        ⇄ {lv.transfer_to_name} ({lv.transferred_tasks_count} tasks)
                      </span>
                    ) : (
                      'Not transferred'
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-danger"
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      onClick={() => handleCancelLeave(lv)}
                    >
                      End / Cancel Leave
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
