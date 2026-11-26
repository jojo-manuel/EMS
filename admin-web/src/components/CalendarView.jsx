import React, { useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { api } from '../api';

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusColor(status) {
  if (status === 'completed') return '#10b981';
  if (status === 'rescheduled') return '#f59e0b';
  if (status === 'cancelled') return '#ef4444';
  return '#2563eb';
}

export default function CalendarView({ tasks, employees, onRefresh, onOpenLeaveTransfer }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [transferToId, setTransferToId] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    address: '',
    assigned_to: '',
    scheduled_start: '',
    scheduled_end: '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const openCreateModal = (startDate) => {
    const start = startDate ? new Date(startDate) : new Date();
    if (start.getHours() === 0 && start.getMinutes() === 0) {
      start.setHours(9, 0, 0, 0);
    }
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const availableEmp = employees.find((e) => !e.on_leave_today) || employees[0];
    setEditingTask(null);
    setTransferToId('');
    setError('');
    setForm({
      title: '',
      description: '',
      address: '',
      assigned_to: availableEmp?.id ? String(availableEmp.id) : '',
      scheduled_start: toLocalInputValue(start.toISOString()),
      scheduled_end: toLocalInputValue(end.toISOString()),
    });
    setModalOpen(true);
  };

  const openEditModal = (task) => {
    const otherEmp = employees.find((e) => String(e.id) !== String(task.assigned_to));
    setEditingTask(task);
    setTransferToId(otherEmp ? String(otherEmp.id) : '');
    setError('');
    setForm({
      title: task.title,
      description: task.description || '',
      address: task.address || '',
      assigned_to: String(task.assigned_to),
      scheduled_start: toLocalInputValue(task.scheduled_start),
      scheduled_end: toLocalInputValue(task.scheduled_end),
    });
    setModalOpen(true);
  };

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        assigned_to: form.assigned_to,
        scheduled_start: new Date(form.scheduled_start).toISOString(),
        scheduled_end: new Date(form.scheduled_end).toISOString(),
      };
      if (editingTask) {
        await api.updateTask(editingTask.id, payload);
      } else {
        await api.createTask(payload);
      }
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickTransfer() {
    if (!editingTask || !transferToId) return;
    setError('');
    setTransferring(true);
    try {
      await api.transferTask(editingTask.id, transferToId);
      setModalOpen(false);
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setTransferring(false);
    }
  }

  async function handleDelete() {
    if (!editingTask) return;
    if (!window.confirm(`Delete "${editingTask.title}"?`)) return;
    await api.deleteTask(editingTask.id);
    setModalOpen(false);
    onRefresh();
  }

  async function handleEventDrop(info) {
    const task = info.event.extendedProps.task;
    try {
      await api.updateTask(task.id, {
        scheduled_start: info.event.start.toISOString(),
        scheduled_end: (info.event.end || new Date(info.event.start.getTime() + 3600000)).toISOString(),
      });
      onRefresh();
    } catch {
      info.revert();
    }
  }

  const events = tasks.map((t) => ({
    id: String(t.id),
    title: `${t.title} (${t.assignee_name})`,
    start: t.scheduled_start,
    end: t.scheduled_end,
    backgroundColor: statusColor(t.status),
    borderColor: statusColor(t.status),
    extendedProps: { task: t },
  }));

  const transferOptions = editingTask
    ? employees.filter((e) => String(e.id) !== String(editingTask.assigned_to))
    : [];

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span className="badge badge-pending">Pending</span>
          <span className="badge badge-rescheduled">Rescheduled</span>
          <span className="badge badge-completed">Completed</span>
          <span className="badge badge-cancelled">Cancelled</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {onOpenLeaveTransfer && (
            <button className="btn btn-secondary" onClick={onOpenLeaveTransfer}>
              🏖️ Mark Leave / Transfer Work
            </button>
          )}
          <button className="btn btn-primary" onClick={() => openCreateModal()}>
            + Assign Work
          </button>
        </div>
      </div>

      <FullCalendar
        plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        headerToolbar={{
          left: 'prev,next today',
          center: 'title',
          right: 'dayGridMonth,timeGridWeek,timeGridDay',
        }}
        height="auto"
        editable={true}
        selectable={true}
        events={events}
        dateClick={(info) => openCreateModal(info.date)}
        eventClick={(info) => openEditModal(info.event.extendedProps.task)}
        eventDrop={handleEventDrop}
      />

      {modalOpen && (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSave}>
            <div className="modal-header">
              <h3>{editingTask ? 'Edit / Transfer Assigned Work' : 'Assign New Work'}</h3>
              {editingTask && (
                <span className={`badge badge-${editingTask.status}`}>{editingTask.status}</span>
              )}
            </div>

            {error && <div className="error-banner">{error}</div>}

            {editingTask?.transferred_from_name && (
              <div className="error-banner" style={{ background: '#eff6ff', color: '#1e40af', borderColor: '#bfdbfe' }}>
                ⇄ <strong>Transferred from:</strong> {editingTask.transferred_from_name}
                {editingTask.transferred_at
                  ? ` on ${new Date(editingTask.transferred_at).toLocaleString()}`
                  : ''}
              </div>
            )}

            {editingTask && transferOptions.length > 0 && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  padding: 12,
                  marginBottom: 14,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>
                  ⇄ Transfer This Work to Another Employee
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={transferToId}
                    onChange={(e) => setTransferToId(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                    }}
                  >
                    {transferOptions.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.name} ({emp.employee_code || emp.unit})
                        {emp.on_leave_today ? ' [🏖️ ON LEAVE]' : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleQuickTransfer}
                    disabled={transferring || !transferToId}
                  >
                    {transferring ? 'Transferring...' : '⇄ Transfer'}
                  </button>
                </div>
              </div>
            )}

            {editingTask?.reschedule_reason && (
              <div className="error-banner" style={{ background: '#fffbeb', color: '#92400e', borderColor: '#fde68a' }}>
                <strong>Reschedule reason:</strong> {editingTask.reschedule_reason}
                {editingTask.rescheduled_lat != null && (
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    📍 Rescheduled at GPS:{' '}
                    <a
                      href={`https://www.google.com/maps?q=${editingTask.rescheduled_lat},${editingTask.rescheduled_lng}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#b45309', fontWeight: 700 }}
                    >
                      {Number(editingTask.rescheduled_lat).toFixed(5)}, {Number(editingTask.rescheduled_lng).toFixed(5)} (View on Map)
                    </a>
                  </div>
                )}
              </div>
            )}

            {editingTask?.completion_notes && (
              <div className="error-banner" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
                <strong>Completion notes:</strong> {editingTask.completion_notes}
              </div>
            )}

            {editingTask?.completed_lat != null && (
              <div className="error-banner" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
                📍 <strong>Marked Complete at GPS:</strong>{' '}
                <a
                  href={`https://www.google.com/maps?q=${editingTask.completed_lat},${editingTask.completed_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#047857', fontWeight: 700 }}
                >
                  {Number(editingTask.completed_lat).toFixed(5)}, {Number(editingTask.completed_lng).toFixed(5)} (View on Map)
                </a>
              </div>
            )}

            {editingTask?.status === 'cancelled' && (
              <div className="error-banner" style={{ background: '#fef2f2', color: '#991b1b', borderColor: '#fecaca' }}>
                <strong>Cancelled by Employee:</strong> {editingTask.cancel_reason || 'No reason provided'}
                {editingTask.cancelled_lat != null && (
                  <div style={{ marginTop: 4, fontSize: 12 }}>
                    📍 Cancelled at GPS:{' '}
                    <a
                      href={`https://www.google.com/maps?q=${editingTask.cancelled_lat},${editingTask.cancelled_lng}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#b91c1c', fontWeight: 700 }}
                    >
                      {Number(editingTask.cancelled_lat).toFixed(5)}, {Number(editingTask.cancelled_lng).toFixed(5)} (View on Map)
                    </a>
                  </div>
                )}
              </div>
            )}

            <div className="field">
              <label>Work Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g., HVAC Inspection - Building B"
                required
              />
            </div>

            <div className="field">
              <label>Assign To Employee</label>
              <select
                value={form.assigned_to}
                onChange={(e) => setForm({ ...form, assigned_to: e.target.value })}
                required
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.employee_code || emp.unit})
                    {emp.active_leave
                      ? ` [🏖️ LEAVE: ${emp.active_leave.start_date}→${emp.active_leave.end_date}]`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid-2">
              <div className="field">
                <label>Start Date & Time</label>
                <input
                  type="datetime-local"
                  value={form.scheduled_start}
                  onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>End Date & Time</label>
                <input
                  type="datetime-local"
                  value={form.scheduled_end}
                  onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="field">
              <label>Job Location / Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="123 Main St, Suite 400"
              />
            </div>

            <div className="field">
              <label>Description / Instructions</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Details for the employee..."
              />
            </div>

            <div className="modal-actions">
              {editingTask && (
                <button type="button" className="btn btn-danger" style={{ marginRight: 'auto' }} onClick={handleDelete}>
                  Delete
                </button>
              )}
              <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : editingTask ? 'Save Changes' : 'Assign Work'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
