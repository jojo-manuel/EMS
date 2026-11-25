const express = require('express');
const {
  User,
  Task,
  EmployeeLocation,
  LocationHistory,
  Attendance,
  Notification,
  hashPassword,
} = require('../db');
const { authenticate, requireAdmin } = require('../auth');

const router = express.Router();

router.get('/employees', authenticate, requireAdmin, async (req, res) => {
  try {
    const employees = await User.find({ role: 'employee' }).sort({ name: 1 }).lean();
    const locs = await EmployeeLocation.find({
      employee_id: { $in: employees.map((e) => e._id) },
    }).lean();

    const locMap = new Map(locs.map((l) => [String(l.employee_id), l]));

    const rows = employees.map((u) => {
      const loc = locMap.get(String(u._id));
      return {
        id: String(u._id),
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        role: u.role,
        created_at: u.created_at,
        lat: loc ? loc.lat : null,
        lng: loc ? loc.lng : null,
        accuracy: loc ? loc.accuracy : null,
        is_tracking: loc ? loc.is_tracking : 0,
        location_updated_at: loc ? loc.updated_at : null,
      };
    });

    return res.json({ employees: rows });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

router.post('/employees', authenticate, requireAdmin, async (req, res) => {
  const { name, email, password, phone = '' } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  try {
    const created = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      password_hash: hashPassword(password),
      role: 'employee',
    });

    return res.status(201).json({
      employee: {
        id: String(created._id),
        name: created.name,
        email: created.email,
        phone: created.phone,
        role: created.role,
        created_at: created.created_at,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    return res.status(500).json({ error: 'Failed to create employee' });
  }
});

router.delete('/employees/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const empId = req.params.id;
    const deleted = await User.findOneAndDelete({ _id: empId, role: 'employee' });
    if (!deleted) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    await Promise.all([
      Task.deleteMany({ assigned_to: empId }),
      EmployeeLocation.deleteMany({ employee_id: empId }),
      LocationHistory.deleteMany({ employee_id: empId }),
      Attendance.deleteMany({ employee_id: empId }),
      Notification.deleteMany({ employee_id: empId }),
    ]);
    return res.json({ deleted: true, id: empId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete employee' });
  }
});

module.exports = router;
