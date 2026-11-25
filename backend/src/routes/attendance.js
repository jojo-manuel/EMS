const express = require('express');
const { Attendance, EmployeeLocation, LocationHistory, Notification, User } = require('../db');
const { authenticate, requireAdmin } = require('../auth');

function formatAttendance(doc) {
  const emp = doc.employee_id && typeof doc.employee_id === 'object' ? doc.employee_id : null;
  return {
    id: String(doc._id),
    employee_id: emp ? String(emp._id) : String(doc.employee_id),
    employee_name: emp ? emp.name : '',
    employee_email: emp ? emp.email : '',
    punch_in_at: doc.punch_in_at,
    punch_in_lat: doc.punch_in_lat,
    punch_in_lng: doc.punch_in_lng,
    punch_out_at: doc.punch_out_at,
    punch_out_lat: doc.punch_out_lat,
    punch_out_lng: doc.punch_out_lng,
    verified_by: doc.verified_by || 'fingerprint',
    status: doc.status,
  };
}

function createAttendanceRouter(io) {
  const router = express.Router();

  // Admin: list all attendance / punch records
  router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
      const docs = await Attendance.find()
        .populate('employee_id', 'name email')
        .sort({ punch_in_at: -1 })
        .limit(100)
        .lean();
      return res.json({ records: docs.map(formatAttendance) });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load attendance records' });
    }
  });

  // Employee: get current active punch status + recent history
  router.get('/status', authenticate, async (req, res) => {
    try {
      const active = await Attendance.findOne({
        employee_id: req.user.id,
        status: 'punched_in',
      })
        .sort({ punch_in_at: -1 })
        .lean();

      const history = await Attendance.find({ employee_id: req.user.id })
        .sort({ punch_in_at: -1 })
        .limit(10)
        .lean();

      return res.json({
        active: active ? formatAttendance(active) : null,
        history: history.map(formatAttendance),
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to check punch status' });
    }
  });

  // Employee: Punch In (fingerprint verified) + start live tracking
  router.post('/punch-in', authenticate, async (req, res) => {
    try {
      const { lat = null, lng = null, accuracy = 0, verified_by = 'fingerprint' } = req.body || {};
      const employeeId = req.user.id;

      // Close any stale open punch if one exists
      await Attendance.updateMany(
        { employee_id: employeeId, status: 'punched_in' },
        { status: 'punched_out', punch_out_at: new Date() }
      );

      const now = new Date();
      const created = await Attendance.create({
        employee_id: employeeId,
        punch_in_at: now,
        punch_in_lat: lat,
        punch_in_lng: lng,
        verified_by,
        status: 'punched_in',
      });

      const user = await User.findById(employeeId).lean();

      if (typeof lat === 'number' && typeof lng === 'number') {
        const loc = await EmployeeLocation.findOneAndUpdate(
          { employee_id: employeeId },
          { lat, lng, accuracy, is_tracking: 1, updated_at: now },
          { upsert: true, returnDocument: 'after' }
        ).lean();

        await LocationHistory.create({
          employee_id: employeeId,
          lat,
          lng,
          accuracy,
          recorded_at: now,
        });

        io.to('admins').emit('location:update', {
          employee_id: String(user._id),
          name: user.name,
          email: user.email,
          phone: user.phone || '',
          lat: loc.lat,
          lng: loc.lng,
          accuracy: loc.accuracy,
          is_tracking: 1,
          updated_at: loc.updated_at,
        });
      }

      const notifDoc = await Notification.create({
        type: 'punch_in',
        title: `Punched In: ${user.name}`,
        message: `${user.name} punched in via ${verified_by} at ${now.toLocaleTimeString()}. Live tracking started.`,
        employee_id: employeeId,
      });

      const populated = await Attendance.findById(created._id)
        .populate('employee_id', 'name email')
        .lean();
      const record = formatAttendance(populated);

      io.to('admins').emit('attendance:update', record);
      io.to('admins').emit('notification:new', {
        id: String(notifDoc._id),
        type: notifDoc.type,
        title: notifDoc.title,
        message: notifDoc.message,
        task_id: null,
        employee_id: String(employeeId),
        is_read: 0,
        created_at: notifDoc.created_at,
      });

      return res.status(201).json({ record });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to punch in' });
    }
  });

  // Employee: Punch Out (fingerprint verified) + stop live tracking
  router.post('/punch-out', authenticate, async (req, res) => {
    try {
      const { lat = null, lng = null, verified_by = 'fingerprint' } = req.body || {};
      const employeeId = req.user.id;
      const now = new Date();

      const active = await Attendance.findOne({
        employee_id: employeeId,
        status: 'punched_in',
      }).sort({ punch_in_at: -1 });

      if (!active) {
        return res.status(400).json({ error: 'No active punch-in shift found' });
      }

      active.punch_out_at = now;
      active.punch_out_lat = lat;
      active.punch_out_lng = lng;
      active.status = 'punched_out';
      await active.save();

      const loc = await EmployeeLocation.findOneAndUpdate(
        { employee_id: employeeId },
        { is_tracking: 0, updated_at: now },
        { returnDocument: 'after' }
      ).lean();

      const user = await User.findById(employeeId).lean();

      io.to('admins').emit('location:update', {
        employee_id: String(user._id),
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        lat: loc ? loc.lat : lat,
        lng: loc ? loc.lng : lng,
        accuracy: loc ? loc.accuracy : 0,
        is_tracking: 0,
        updated_at: now,
      });

      const notifDoc = await Notification.create({
        type: 'punch_out',
        title: `Punched Out: ${user.name}`,
        message: `${user.name} punched out via ${verified_by} at ${now.toLocaleTimeString()}. Live tracking stopped.`,
        employee_id: employeeId,
      });

      const populated = await Attendance.findById(active._id)
        .populate('employee_id', 'name email')
        .lean();
      const record = formatAttendance(populated);

      io.to('admins').emit('attendance:update', record);
      io.to('admins').emit('notification:new', {
        id: String(notifDoc._id),
        type: notifDoc.type,
        title: notifDoc.title,
        message: notifDoc.message,
        task_id: null,
        employee_id: String(employeeId),
        is_read: 0,
        created_at: notifDoc.created_at,
      });

      return res.json({ record });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to punch out' });
    }
  });

  return router;
}

module.exports = createAttendanceRouter;
