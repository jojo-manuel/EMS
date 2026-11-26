const express = require('express');
const {
  UNITS,
  User,
  Task,
  EmployeeLocation,
  LocationHistory,
  Attendance,
  Notification,
  Leave,
  getAdminUnitScope,
  hashPassword,
} = require('../db');
const { authenticate, requireAdmin, requireSuperAdmin } = require('../auth');

const router = express.Router();

function todayDateStr() {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

router.get('/units', authenticate, (req, res) => {
  return res.json({ units: UNITS });
});

// Admin (unit-scoped) or Super Admin (all units): list employees + active/upcoming leaves
router.get('/employees', authenticate, requireAdmin, async (req, res) => {
  try {
    const scope = await getAdminUnitScope(req.user);
    const filter = { role: 'employee' };
    if (scope) {
      filter._id = { $in: scope.employeeIds };
    } else if (req.query.unit) {
      filter.unit = new RegExp(`^${String(req.query.unit).trim()}$`, 'i');
    }

    const employees = await User.find(filter).sort({ name: 1 }).lean();
    const empIds = employees.map((e) => e._id);
    const today = todayDateStr();

    const [locs, leaves] = await Promise.all([
      EmployeeLocation.find({ employee_id: { $in: empIds } }).lean(),
      Leave.find({
        employee_id: { $in: empIds },
        end_date: { $gte: today },
      })
        .populate('employee_id', 'name employee_code unit')
        .populate('transfer_to', 'name employee_code')
        .sort({ start_date: 1 })
        .lean(),
    ]);

    const locMap = new Map(locs.map((l) => [String(l.employee_id), l]));
    const leaveMap = new Map();
    leaves.forEach((lv) => {
      const empKey = String(lv.employee_id?._id || lv.employee_id);
      // Prefer currently active leave (start_date <= today <= end_date), otherwise earliest upcoming
      if (!leaveMap.has(empKey) || (lv.start_date <= today && lv.end_date >= today)) {
        leaveMap.set(empKey, lv);
      }
    });

    const rows = employees.map((u) => {
      const key = String(u._id);
      const loc = locMap.get(key);
      const lv = leaveMap.get(key);
      const isOnLeaveToday = Boolean(lv && lv.start_date <= today && lv.end_date >= today);

      return {
        id: key,
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
        on_leave_today: isOnLeaveToday,
        active_leave: lv
          ? {
              id: String(lv._id),
              leave_type: lv.leave_type,
              start_date: lv.start_date,
              end_date: lv.end_date,
              reason: lv.reason || '',
              transfer_to_name: lv.transfer_to ? lv.transfer_to.name : '',
              transferred_tasks_count: lv.transferred_tasks_count || 0,
            }
          : null,
      };
    });

    const formattedLeaves = leaves.map((lv) => ({
      id: String(lv._id),
      employee_id: String(lv.employee_id?._id || lv.employee_id),
      employee_name: lv.employee_id?.name || '',
      employee_code: lv.employee_id?.employee_code || '',
      employee_unit: lv.employee_id?.unit || '',
      leave_type: lv.leave_type,
      start_date: lv.start_date,
      end_date: lv.end_date,
      reason: lv.reason || '',
      transfer_to_name: lv.transfer_to?.name || '',
      transferred_tasks_count: lv.transferred_tasks_count || 0,
    }));

    return res.json({ employees: rows, leaves: formattedLeaves, units: UNITS });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// Admin marks an employee on leave (single_day or custom date range) & optionally transfers their tasks to another employee
router.post('/employees/:id/leave', authenticate, requireAdmin, async (req, res) => {
  try {
    const empId = req.params.id;
    const {
      leave_type = 'single_day',
      start_date,
      end_date,
      reason = '',
      transfer_to = '',
    } = req.body || {};

    if (!start_date) {
      return res.status(400).json({ error: 'Leave start_date (YYYY-MM-DD) is required' });
    }

    const finalEndDate = leave_type === 'single_day' || !end_date ? start_date : end_date;
    if (finalEndDate < start_date) {
      return res.status(400).json({ error: 'End date cannot be earlier than start date' });
    }

    const scope = await getAdminUnitScope(req.user);
    if (scope && !scope.employeeIds.some((id) => String(id) === String(empId))) {
      return res.status(403).json({ error: 'You can only manage employees in your assigned unit' });
    }

    const employee = await User.findById(empId).lean();
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    let transferredCount = 0;
    let targetEmp = null;

    if (transfer_to && String(transfer_to) !== String(empId)) {
      if (scope && !scope.employeeIds.some((id) => String(id) === String(transfer_to))) {
        return res.status(403).json({
          error: 'Target employee for work transfer must be in your assigned unit',
        });
      }
      targetEmp = await User.findById(transfer_to).lean();
      if (!targetEmp) {
        return res.status(404).json({ error: 'Target transfer employee not found' });
      }

      // Transfer all open tasks scheduled during the leave window [start_date 00:00 IST, finalEndDate 23:59:59 IST]
      const rangeStartIso = new Date(`${start_date}T00:00:00.000+05:30`).toISOString();
      const rangeEndIso = new Date(`${finalEndDate}T23:59:59.999+05:30`).toISOString();

      const tasksToTransfer = await Task.find({
        assigned_to: empId,
        status: { $in: ['pending', 'in_progress', 'rescheduled'] },
        scheduled_start: { $gte: rangeStartIso, $lte: rangeEndIso },
      });

      const now = new Date();
      for (const t of tasksToTransfer) {
        t.transferred_from_name = employee.name;
        t.transferred_at = now;
        t.assigned_to = targetEmp._id;
        await t.save();
        transferredCount += 1;
      }
    }

    const leaveDoc = await Leave.create({
      employee_id: empId,
      leave_type: leave_type === 'custom' ? 'custom' : 'single_day',
      start_date,
      end_date: finalEndDate,
      reason: reason.trim(),
      transfer_to: targetEmp ? targetEmp._id : null,
      transferred_tasks_count: transferredCount,
      created_by: req.user.id,
    });

    const dateLabel =
      start_date === finalEndDate ? start_date : `${start_date} to ${finalEndDate}`;
    const transferMsg = targetEmp
      ? ` ${transferredCount} scheduled task(s) transferred to ${targetEmp.name}.`
      : '';

    await Notification.create({
      type: 'employee_leave',
      title: `Employee on Leave: ${employee.name}`,
      message: `${employee.name} (${employee.unit || ''}) marked on leave for ${dateLabel}.${reason ? ` Reason: ${reason}.` : ''}${transferMsg}`,
      employee_id: empId,
    });

    return res.status(201).json({
      leave: {
        id: String(leaveDoc._id),
        employee_id: empId,
        leave_type: leaveDoc.leave_type,
        start_date: leaveDoc.start_date,
        end_date: leaveDoc.end_date,
        reason: leaveDoc.reason,
        transfer_to_name: targetEmp ? targetEmp.name : '',
        transferred_tasks_count: transferredCount,
      },
      transferred_tasks_count: transferredCount,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to mark leave' });
  }
});

// Admin removes/cancels a leave record
router.delete('/leaves/:leaveId', authenticate, requireAdmin, async (req, res) => {
  try {
    const deleted = await Leave.findByIdAndDelete(req.params.leaveId);
    if (!deleted) {
      return res.status(404).json({ error: 'Leave record not found' });
    }
    return res.json({ deleted: true, id: req.params.leaveId });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to delete leave record' });
  }
});

// Admin or Super Admin: create a new employee (Employee ID, Name, Phone, Unit, Area, optional Password)
router.post('/employees', authenticate, requireAdmin, async (req, res) => {
  const {
    employee_code = '',
    name,
    phone = '',
    unit = '',
    area = '',
    email = '',
    password = '',
  } = req.body || {};

  try {
    const scope = await getAdminUnitScope(req.user);
    const effectiveUnit = scope ? scope.unit : unit.trim().toUpperCase();

    if (!employee_code.trim() || !name || !phone.trim() || !effectiveUnit || !area.trim()) {
      return res.status(400).json({
        error: 'Employee ID, Name, Phone Number, Unit, and Area are required',
      });
    }

    const cleanCode = employee_code.trim();
    const existingCode = await User.findOne({
      employee_code: new RegExp(`^${cleanCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
    if (existingCode) {
      return res.status(409).json({ error: `Employee ID "${cleanCode}" already exists` });
    }

    const finalPassword = password.trim()
      ? password.trim()
      : `${cleanCode}@${Math.floor(1000 + Math.random() * 9000)}`;

    const finalEmail = email.trim()
      ? email.trim().toLowerCase()
      : `${cleanCode.toLowerCase().replace(/[^a-z0-9]/g, '')}.${Date.now()}@emptracker.local`;

    const created = await User.create({
      employee_code: cleanCode,
      name: name.trim(),
      email: finalEmail,
      phone: phone.trim(),
      unit: effectiveUnit,
      area: area.trim(),
      password_hash: hashPassword(finalPassword),
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
      credentials: {
        username: created.employee_code,
        password: finalPassword,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'An account with this email or Employee ID already exists' });
    }
    return res.status(500).json({ error: 'Failed to create employee' });
  }
});

// Admin or Super Admin: delete an employee (Admin can only delete within their unit)
router.delete('/employees/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const empId = req.params.id;
    const scope = await getAdminUnitScope(req.user);
    if (scope && !scope.employeeIds.some((id) => String(id) === String(empId))) {
      return res.status(403).json({ error: 'You can only manage employees in your assigned unit' });
    }

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
      Leave.deleteMany({ employee_id: empId }),
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
      units: UNITS,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load admins' });
  }
});

// Super Admin: create a new Admin (assigned to a Unit) or Super Admin
router.post('/admins', authenticate, requireSuperAdmin, async (req, res) => {
  const { name, email, phone = '', unit = '', area = '', password, role = 'admin' } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  const targetRole = role === 'superadmin' ? 'superadmin' : 'admin';
  if (targetRole === 'admin' && !unit.trim()) {
    return res.status(400).json({ error: 'Please select a Unit for the Admin' });
  }

  try {
    const created = await User.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      unit: targetRole === 'superadmin' ? '' : unit.trim().toUpperCase(),
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
