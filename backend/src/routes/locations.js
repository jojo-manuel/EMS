const express = require('express');
const { User, EmployeeLocation, LocationHistory } = require('../db');
const { authenticate, requireAdmin } = require('../auth');

function createLocationsRouter(io) {
  const router = express.Router();

  router.get('/', authenticate, requireAdmin, async (req, res) => {
    try {
      const employees = await User.find({ role: 'employee' }).sort({ name: 1 }).lean();
      const locs = await EmployeeLocation.find({
        employee_id: { $in: employees.map((e) => e._id) },
      }).lean();

      const locMap = new Map(locs.map((l) => [String(l.employee_id), l]));

      const rows = employees.map((u) => {
        const loc = locMap.get(String(u._id));
        return {
          employee_id: String(u._id),
          name: u.name,
          email: u.email,
          phone: u.phone || '',
          lat: loc ? loc.lat : null,
          lng: loc ? loc.lng : null,
          accuracy: loc ? loc.accuracy : null,
          is_tracking: loc ? loc.is_tracking : 0,
          updated_at: loc ? loc.updated_at : null,
        };
      });

      return res.json({ locations: rows });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch locations' });
    }
  });

  router.post('/', authenticate, async (req, res) => {
    try {
      const { lat, lng, accuracy = 0, is_tracking = 1 } = req.body || {};
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        return res.status(400).json({ error: 'Numeric lat and lng are required' });
      }

      const employeeId = req.user.id;
      const now = new Date();

      const loc = await EmployeeLocation.findOneAndUpdate(
        { employee_id: employeeId },
        {
          lat,
          lng,
          accuracy,
          is_tracking: is_tracking ? 1 : 0,
          updated_at: now,
        },
        { upsert: true, new: true }
      ).lean();

      await LocationHistory.create({
        employee_id: employeeId,
        lat,
        lng,
        accuracy,
        recorded_at: now,
      });

      const user = await User.findById(employeeId).lean();
      const payload = {
        employee_id: String(user._id),
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        is_tracking: loc.is_tracking,
        updated_at: loc.updated_at,
      };

      io.to('admins').emit('location:update', payload);
      return res.json({ location: payload });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to update location' });
    }
  });

  router.post('/stop', authenticate, async (req, res) => {
    try {
      const employeeId = req.user.id;
      const loc = await EmployeeLocation.findOneAndUpdate(
        { employee_id: employeeId },
        { is_tracking: 0, updated_at: new Date() },
        { new: true }
      ).lean();

      const user = await User.findById(employeeId).lean();
      const payload = {
        employee_id: String(user._id),
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        lat: loc ? loc.lat : null,
        lng: loc ? loc.lng : null,
        accuracy: loc ? loc.accuracy : null,
        is_tracking: 0,
        updated_at: loc ? loc.updated_at : new Date(),
      };

      io.to('admins').emit('location:update', payload);
      return res.json({ location: payload });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to stop tracking' });
    }
  });

  return router;
}

module.exports = createLocationsRouter;
