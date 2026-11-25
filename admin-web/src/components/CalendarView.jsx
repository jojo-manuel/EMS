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
  return '#2563eb';
}

export default function CalendarView({ tasks, employees, onRefresh }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
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
    setEditingTask(null);
    setError('');
    setForm({
      title: '',
      description: '',
      address: '',
      assigned_to: employees[0]?.id ? String(employees[0].id) : '',
      scheduled_start: toLocalInputValue(start.toISOString()),
      scheduled_end: toLocalInputValue(end.toISOString()),
    });
    setModalOpen(true);
  };

  const openEditModal = (task) => {
    setEditingTask(task);
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

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span className="badge badge-pending">Pending</span>
          <span className="badge badge-rescheduled">Rescheduled</span>
          <span className="badge badge-completed">Completed</span>
        </div>
        <button className="btn btn-primary" onClick={() => openCreateModal()}>
          + Assign Work
        </button>
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
              <h3>{editingTask ? 'Edit Assigned Work' : 'Assign New Work'}</h3>
              {editingTask && (
                <span className={`badge badge-${editingTask.status}`}>{editingTask.status}</span>
              )}
            </div>

            {error && <div className="error-banner">{error}</div>}

            {editingTask?.reschedule_reason && (
              <div className="error-banner" style={{ background: '#fffbeb', color: '#92400e', borderColor: '#fde68a' }}>
                <strong>Reschedule reason:</strong> {editingTask.reschedule_reason}
              </div>
            )}

            {editingTask?.completion_notes && (
              <div className="error-banner" style={{ background: '#ecfdf5', color: '#065f46', borderColor: '#a7f3d0' }}>
                <strong>Completion notes:</strong> {editingTask.completion_notes}
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
                    {emp.name} ({emp.email})
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
