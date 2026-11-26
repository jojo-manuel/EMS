const express = require('express');
const { Task, Notification, LocationHistory, getAdminUnitScope } = require('../db');
const { authenticate, requireAdmin } = require('../auth');

function formatTask(doc) {
  const assignee = doc.assigned_to && typeof doc.assigned_to === 'object' ? doc.assigned_to : null;
  return {
    id: String(doc._id),
    title: doc.title,
    description: doc.description || '',
    address: doc.address || '',
    assigned_to: assignee ? String(assignee._id) : String(doc.assigned_to),
    created_by: String(doc.created_by),
    scheduled_start: doc.scheduled_start,
    scheduled_end: doc.scheduled_end,
    status: doc.status,
    reschedule_reason: doc.reschedule_reason || '',
    rescheduled_lat: doc.rescheduled_lat ?? null,
    rescheduled_lng: doc.rescheduled_lng ?? null,
    rescheduled_at: doc.rescheduled_at || null,
    completion_notes: doc.completion_notes || '',
    completed_at: doc.completed_at,
    completed_lat: doc.completed_lat ?? null,
    completed_lng: doc.completed_lng ?? null,
    cancel_reason: doc.cancel_reason || '',
    cancelled_at: doc.cancelled_at || null,
    cancelled_lat: doc.cancelled_lat ?? null,
    cancelled_lng: doc.cancelled_lng ?? null,
    transferred_from_name: doc.transferred_from_name || '',
    transferred_at: doc.transferred_at || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at,
    assignee_name: assignee ? assignee.name : '',
    assignee_email: assignee ? assignee.email : '',
    assignee_code: assignee ? assignee.employee_code || '' : '',
    assignee_unit: assignee ? assignee.unit || '' : '',
    assignee_area: assignee ? assignee.area || '' : '',
  };
}

function formatNotification(doc) {
  return {
    id: String(doc._id),
    type: doc.type,
    title: doc.title,
    message: doc.message,
    task_id: doc.task_id ? String(doc.task_id) : null,
    employee_id: doc.employee_id ? String(doc.employee_id) : null,
    is_read: doc.is_read,
    created_at: doc.created_at,
  };
}

function createTasksRouter(io) {
  const router = express.Router();

  router.get('/', authenticate, async (req, res) => {
    try {
      const filter = {};
      if (req.user.role === 'admin' || req.user.role === 'superadmin') {
        const scope = await getAdminUnitScope(req.user);
        if (scope) {
          if (req.query.assigned_to) {
            const allowed = scope.employeeIds.some(
              (id) => String(id) === String(req.query.assigned_to)
            );
            filter.assigned_to = allowed ? req.query.assigned_to : { $in: [] };
          } else {
            filter.assigned_to = { $in: scope.employeeIds };
          }
        } else if (req.query.assigned_to) {
          filter.assigned_to = req.query.assigned_to;
        }
      } else {
        filter.assigned_to = req.user.id;
      }

      const docs = await Task.find(filter)
        .populate('assigned_to', 'name email employee_code unit area')
        .sort({ scheduled_start: 1 })
        .lean();

      return res.json({ tasks: docs.map(formatTask) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load tasks' });
    }
  });

  // Admin OR Employee creates a task (Employee creates self-assigned task)
  router.post('/', authenticate, async (req, res) => {
    try {
      const {
        title,
        description = '',
        address = '',
        assigned_to,
        scheduled_start,
        scheduled_end,
      } = req.body || {};

      const isSelfEmployee = req.user.role === 'employee';
      const targetAssignee = isSelfEmployee ? req.user.id : assigned_to;

      if (!title || !targetAssignee || !scheduled_start || !scheduled_end) {
        return res.status(400).json({
          error: 'title, scheduled_start, and scheduled_end are required',
        });
      }

      if (!isSelfEmployee) {
        const scope = await getAdminUnitScope(req.user);
        if (scope && !scope.employeeIds.some((id) => String(id) === String(targetAssignee))) {
          return res.status(403).json({
            error: `You can only assign tasks to employees in your unit (${scope.unit})`,
          });
        }
      }

      const created = await Task.create({
        title: title.trim(),
        description: description.trim(),
        address: address.trim(),
        assigned_to: targetAssignee,
        created_by: req.user.id,
        scheduled_start,
        scheduled_end,
        status: 'pending',
      });

      const populated = await Task.findById(created._id)
        .populate('assigned_to', 'name email employee_code unit area')
        .lean();
      const task = formatTask(populated);

      const notifDoc = await Notification.create({
        type: 'task_assigned',
        title: isSelfEmployee
          ? `Employee Added Task: ${task.title}`
          : `New Work Assigned: ${task.title}`,
        message: isSelfEmployee
          ? `${task.assignee_name} (${task.assignee_unit || 'No Unit'}) added "${task.title}" to their schedule for ${new Date(task.scheduled_start).toLocaleString()}.`
          : `"${task.title}" was assigned to ${task.assignee_name} (${task.assignee_unit || 'No Unit'}) for ${new Date(task.scheduled_start).toLocaleString()}.`,
        task_id: created._id,
        employee_id: created.assigned_to,
      });

      const notification = formatNotification(notifDoc);
      io.emit('task:created', task);
      io.to('admins').emit('notification:new', notification);
      if (!isSelfEmployee) {
        io.to(`employee:${task.assigned_to}`).emit('notification:assigned', task);
      }
      return res.status(201).json({ task, notification });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to create task' });
    }
  });

  router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      const existing = await Task.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });

      const {
        title = existing.title,
        description = existing.description,
        address = existing.address,
        assigned_to = existing.assigned_to,
        scheduled_start = existing.scheduled_start,
        scheduled_end = existing.scheduled_end,
        status = existing.status,
      } = req.body || {};

      existing.title = title;
      existing.description = description;
      existing.address = address;
      existing.assigned_to = assigned_to;
      existing.scheduled_start = scheduled_start;
      existing.scheduled_end = scheduled_end;
      existing.status = status;
      await existing.save();

      const populated = await Task.findById(existing._id)
        .populate('assigned_to', 'name email employee_code unit area')
        .lean();
      const task = formatTask(populated);
      io.emit('task:updated', task);
      return res.json({ task });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update task' });
    }
  });

  router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
      const deleted = await Task.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Task not found' });

      io.emit('task:deleted', { id: String(deleted._id) });
      return res.json({ deleted: true, id: String(deleted._id) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to delete task' });
    }
  });

  // Employee marks task complete (captures completion GPS coordinates)
  router.patch('/:id/complete', authenticate, async (req, res) => {
    try {
      const existing = await Task.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });

      if (
        req.user.role !== 'admin' &&
        req.user.role !== 'superadmin' &&
        String(existing.assigned_to) !== String(req.user.id)
      ) {
        return res.status(403).json({ error: 'You can only update your own tasks' });
      }

      const { notes = '', lat = null, lng = null } = req.body || {};
      const now = new Date();
      existing.status = 'completed';
      existing.completion_notes = notes.trim();
      existing.completed_at = now;
      if (typeof lat === 'number' && typeof lng === 'number') {
        existing.completed_lat = lat;
        existing.completed_lng = lng;
        await LocationHistory.create({
          employee_id: existing.assigned_to,
          lat,
          lng,
          accuracy: 10,
          recorded_at: now,
        });
      }
      await existing.save();

      const populated = await Task.findById(existing._id)
        .populate('assigned_to', 'name email employee_code unit area')
        .lean();
      const task = formatTask(populated);

      const coordText =
        typeof lat === 'number' && typeof lng === 'number'
          ? ` [Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}]`
          : '';

      const notifDoc = await Notification.create({
        type: 'task_completed',
        title: `Task Completed: ${task.title}`,
        message: `${task.assignee_name} marked "${task.title}" as completed.${notes ? ` Note: ${notes}` : ''}${coordText}`,
        task_id: existing._id,
        employee_id: existing.assigned_to,
      });

      const notification = formatNotification(notifDoc);
      io.emit('task:updated', task);
      io.to('admins').emit('notification:new', notification);

      return res.json({ task, notification });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to complete task' });
    }
  });

  // Employee reschedules task (captures reschedule GPS coordinates)
  router.patch('/:id/reschedule', authenticate, async (req, res) => {
    try {
      const existing = await Task.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });

      if (
        req.user.role !== 'admin' &&
        req.user.role !== 'superadmin' &&
        String(existing.assigned_to) !== String(req.user.id)
      ) {
        return res.status(403).json({ error: 'You can only reschedule your own tasks' });
      }

      const { scheduled_start, scheduled_end, reason = '', lat = null, lng = null } = req.body || {};
      if (!scheduled_start || !scheduled_end) {
        return res.status(400).json({ error: 'scheduled_start and scheduled_end are required' });
      }

      const oldStartStr = new Date(existing.scheduled_start).toLocaleString();
      const newStartStr = new Date(scheduled_start).toLocaleString();
      const now = new Date();

      existing.scheduled_start = scheduled_start;
      existing.scheduled_end = scheduled_end;
      existing.status = 'rescheduled';
      existing.reschedule_reason = reason.trim();
      existing.rescheduled_at = now;
      if (typeof lat === 'number' && typeof lng === 'number') {
        existing.rescheduled_lat = lat;
        existing.rescheduled_lng = lng;
        await LocationHistory.create({
          employee_id: existing.assigned_to,
          lat,
          lng,
          accuracy: 10,
          recorded_at: now,
        });
      }
      await existing.save();

      const populated = await Task.findById(existing._id)
        .populate('assigned_to', 'name email employee_code unit area')
        .lean();
      const task = formatTask(populated);

      const coordText =
        typeof lat === 'number' && typeof lng === 'number'
          ? ` [Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}]`
          : '';

      const notifDoc = await Notification.create({
        type: 'task_rescheduled',
        title: `Task Rescheduled: ${task.title}`,
        message: `${task.assignee_name} rescheduled "${task.title}" from ${oldStartStr} to ${newStartStr}.${reason ? ` Reason: ${reason}` : ''}${coordText}`,
        task_id: existing._id,
        employee_id: existing.assigned_to,
      });

      const notification = formatNotification(notifDoc);
      io.emit('task:updated', task);
      io.to('admins').emit('notification:new', notification);

      return res.json({ task, notification });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to reschedule task' });
    }
  });

  // Employee cancels task (captures cancel reason & GPS coordinates)
  router.patch('/:id/cancel', authenticate, async (req, res) => {
    try {
      const existing = await Task.findById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Task not found' });

      if (
        req.user.role !== 'admin' &&
        req.user.role !== 'superadmin' &&
        String(existing.assigned_to) !== String(req.user.id)
      ) {
        return res.status(403).json({ error: 'You can only cancel your own tasks' });
      }

      const { reason = '', lat = null, lng = null } = req.body || {};
      const now = new Date();

      existing.status = 'cancelled';
      existing.cancel_reason = reason.trim();
      existing.cancelled_at = now;
      if (typeof lat === 'number' && typeof lng === 'number') {
        existing.cancelled_lat = lat;
        existing.cancelled_lng = lng;
        await LocationHistory.create({
          employee_id: existing.assigned_to,
          lat,
          lng,
          accuracy: 10,
          recorded_at: now,
        });
      }
      await existing.save();

      const populated = await Task.findById(existing._id)
        .populate('assigned_to', 'name email employee_code unit area')
        .lean();
      const task = formatTask(populated);

      const coordText =
        typeof lat === 'number' && typeof lng === 'number'
          ? ` [Location: ${lat.toFixed(5)}, ${lng.toFixed(5)}]`
          : '';

      const notifDoc = await Notification.create({
        type: 'task_cancelled',
        title: `Task Cancelled: ${task.title}`,
        message: `${task.assignee_name} cancelled "${task.title}".${reason ? ` Reason: ${reason}` : ''}${coordText}`,
        task_id: existing._id,
        employee_id: existing.assigned_to,
      });

      const notification = formatNotification(notifDoc);
      io.emit('task:updated', task);
      io.to('admins').emit('notification:new', notification);

      return res.json({ task, notification });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to cancel task' });
    }
  });

  // Admin transfers assigned task to another employee
  router.patch('/:id/transfer', authenticate, requireAdmin, async (req, res) => {
    try {
      const existing = await Task.findById(req.params.id).populate('assigned_to', 'name unit');
      if (!existing) return res.status(404).json({ error: 'Task not found' });

      const { new_assigned_to } = req.body || {};
      if (!new_assigned_to) {
        return res.status(400).json({ error: 'new_assigned_to employee ID is required' });
      }

      const scope = await getAdminUnitScope(req.user);
      if (scope && !scope.employeeIds.some((id) => String(id) === String(new_assigned_to))) {
        return res.status(403).json({
          error: `You can only transfer tasks to employees in your unit (${scope.unit})`,
        });
      }

      const previousName =
        existing.assigned_to && existing.assigned_to.name ? existing.assigned_to.name : 'Previous Employee';

      existing.transferred_from_name = previousName;
      existing.transferred_at = new Date();
      existing.assigned_to = new_assigned_to;
      await existing.save();

      const populated = await Task.findById(existing._id)
        .populate('assigned_to', 'name email employee_code unit area')
        .lean();
      const task = formatTask(populated);

      const notifDoc = await Notification.create({
        type: 'task_transferred',
        title: `Work Transferred: ${task.title}`,
        message: `"${task.title}" was transferred from ${previousName} to ${task.assignee_name}.`,
        task_id: existing._id,
        employee_id: existing.assigned_to,
      });

      const notification = formatNotification(notifDoc);
      io.emit('task:updated', task);
      io.to('admins').emit('notification:new', notification);
      io.to(`employee:${task.assigned_to}`).emit('notification:assigned', task);

      return res.json({ task, notification });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to transfer task' });
    }
  });

  return router;
}

module.exports = createTasksRouter;
