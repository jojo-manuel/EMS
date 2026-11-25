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
const { authenticate, requireAdmin, requireSuperAdmin } = require('../auth');

const router = express.Router();

// Admin or Super Admin: list all employees
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
        employee_code: u.employee_code || '',
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        unit: u.unit || '',
        area: u.area || '',
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

// Admin or Super Admin: create a new employee (Employee ID, Name, Phone, Unit, Area, Email, Password)
router.post('/employees', authenticate, requireAdmin, async (req, res) => {
  const {
    employee_code = '',
    name,
    phone = '',
    unit = '',
    area = '',
    email = '',
    password,
  } = req.body || {};

  if (!employee_code.trim() || !name || !phone.trim() || !unit.trim() || !area.trim() || !password) {
    return res.status(400).json({
      error: 'Employee ID, Name, Phone Number, Unit, Area, and Password are required',
    });
  }

  try {
    const cleanCode = employee_code.trim();
    const existingCode = await User.findOne({
      employee_code: new RegExp(`^${cleanCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
    if (existingCode) {
      return res.status(409).json({ error: `Employee ID "${cleanCode}" already exists` });
    }

    const finalEmail = email.trim()
      ? email.trim().toLowerCase()
      : `${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}@emptracker.local`;

    const created = await User.create({
      employee_code: cleanCode,
      name: name.trim(),
      email: finalEmail,
      phone: phone.trim(),
      unit: unit.trim(),
      area: area.trim(),
      password_hash: hashPassword(password),
      role: 'employee',
    });

    return res.status(201).json({
      employee: {
        id: String(created._id),
        employee_code: created.employee_code,
        name: created.name,
        email: created.email,
        phone: created.phone,
        unit: created.unit,
        area: created.area,
        role: created.role,
        created_at: created.created_at,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email or Employee ID already exists' });
    }
    return res.status(500).json({ error: 'Failed to create employee' });
  }
});

// Admin or Super Admin: delete an employee
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

// Super Admin: list all Admins & Super Admins
router.get('/admins', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const admins = await User.find({ role: { $in: ['admin', 'superadmin'] } })
      .sort({ role: -1, name: 1 })
      .lean();
    return res.json({
      admins: admins.map((a) => ({
        id: String(a._id),
        name: a.name,
        email: a.email,
        phone: a.phone || '',
        unit: a.unit || '',
        area: a.area || '',
        role: a.role,
        created_at: a.created_at,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load admins' });
  }
});

// Super Admin: create a new Admin (or Super Admin)
router.post('/admins', authenticate, requireSuperAdmin, async (req, res) => {
  const { name, email, phone = '', unit = '', area = '', password, role = 'admin' } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  const targetRole = role === 'superadmin' ? 'superadmin' : 'admin';

  try {
    const created = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      unit: unit.trim(),
      area: area.trim(),
      password_hash: hashPassword(password),
      role: targetRole,
    });

    return res.status(201).json({
      admin: {
        id: String(created._id),
        name: created.name,
        email: created.email,
        phone: created.phone,
        unit: created.unit,
        area: created.area,
        role: created.role,
        created_at: created.created_at,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }
    return res.status(500).json({ error: 'Failed to create admin' });
  }
});

// Super Admin: delete an Admin account
router.delete('/admins/:id', authenticate, requireSuperAdmin, async (req, res) => {
  try {
    const adminId = req.params.id;
    if (String(req.user.id) === String(adminId)) {
      return res.status(400).json({ error: 'You cannot delete your own Super Admin account' });
    }
    const deleted = await User.findOneAndDelete({
      _id: adminId,
      role: { $in: ['admin', 'superadmin'] },
    });
    if (!deleted) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    return res.json({ deleted: true, id: adminId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete admin' });
  }
});

module.exports = router;
