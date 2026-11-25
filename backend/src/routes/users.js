const express = require('express');
const { User, EmployeeLocation, hashPassword } = require('../db');
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

module.exports = router;
