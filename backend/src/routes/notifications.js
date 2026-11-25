const express = require('express');
const { Notification, getAdminUnitScope } = require('../db');
const { authenticate, requireAdmin } = require('../auth');

const router = express.Router();

router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const scope = await getAdminUnitScope(req.user);
    const filter = {};
    if (scope) {
      filter.employee_id = { $in: scope.employeeIds };
    }
    const docs = await Notification.find(filter).sort({ created_at: -1 }).limit(50).lean();
    const notifications = docs.map((doc) => ({
      id: String(doc._id),
      type: doc.type,
      title: doc.title,
      message: doc.message,
      task_id: doc.task_id ? String(doc.task_id) : null,
      employee_id: doc.employee_id ? String(doc.employee_id) : null,
      is_read: doc.is_read,
      created_at: doc.created_at,
    }));
    return res.json({ notifications });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load notifications' });
  }
});

router.patch('/:id/read', authenticate, requireAdmin, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { is_read: 1 });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update notification' });
  }
});

router.patch('/read-all', authenticate, requireAdmin, async (req, res) => {
  try {
    await Notification.updateMany({ is_read: 0 }, { is_read: 1 });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
