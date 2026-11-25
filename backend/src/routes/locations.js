const express = require('express');
const { User, Task, EmployeeLocation, LocationHistory, getAdminUnitScope } = require('../db');
const { authenticate, requireAdmin } = require('../auth');

// Haversine distance in kilometers between two GPS points
function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // Earth radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function calculateTotalDistanceKm(points) {
  if (!points || points.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const seg = haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
    // Ignore tiny GPS jitter under 5 meters (0.005 km)
    if (seg >= 0.005) {
      total += seg;
    }
  }
  return Number(total.toFixed(3));
}

function createLocationsRouter(io) {
  const router = express.Router();

  // Admin (unit-scoped) or Super Admin (all units): get latest live locations + today's distance
  router.get('/', authenticate, requireAdmin, async (req, res) => {
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

      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [locs, todayHistories] = await Promise.all([
        EmployeeLocation.find({ employee_id: { $in: empIds } }).lean(),
        LocationHistory.find({
          employee_id: { $in: empIds },
          recorded_at: { $gte: startOfDay },
        })
          .sort({ recorded_at: 1 })
          .lean(),
      ]);

      const locMap = new Map(locs.map((l) => [String(l.employee_id), l]));
      const histByEmp = new Map();
      todayHistories.forEach((h) => {
        const key = String(h.employee_id);
        if (!histByEmp.has(key)) histByEmp.set(key, []);
        histByEmp.get(key).push(h);
      });

      const rows = employees.map((u) => {
        const key = String(u._id);
        const loc = locMap.get(key);
        const pts = histByEmp.get(key) || [];
        return {
          employee_id: key,
          employee_code: u.employee_code || '',
          name: u.name,
          email: u.email,
          phone: u.phone || '',
          unit: u.unit || '',
          area: u.area || '',
          lat: loc ? loc.lat : null,
          lng: loc ? loc.lng : null,
          accuracy: loc ? loc.accuracy : null,
          is_tracking: loc ? loc.is_tracking : 0,
          updated_at: loc ? loc.updated_at : null,
          today_distance_km: calculateTotalDistanceKm(pts),
          today_points_count: pts.length,
        };
      });

      return res.json({ locations: rows });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch locations' });
    }
  });

  // Get movement history polyline, total distance covered, and task completion/reschedule markers for an employee
  router.get('/:employeeId/history', authenticate, requireAdmin, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const scope = await getAdminUnitScope(req.user);
      if (scope && !scope.employeeIds.some((id) => String(id) === String(employeeId))) {
        return res.status(403).json({ error: 'Employee is outside your assigned unit' });
      }

      // Optional ?date=YYYY-MM-DD (defaults to today; if ?date=all, returns last 500 points)
      const { date } = req.query;
      const histFilter = { employee_id: employeeId };
      if (date && date !== 'all') {
        const dayStart = new Date(`${date}T00:00:00`);
        const dayEnd = new Date(`${date}T23:59:59.999`);
        if (!isNaN(dayStart.getTime())) {
          histFilter.recorded_at = { $gte: dayStart, $lte: dayEnd };
        }
      }

      const [points, tasks] = await Promise.all([
        LocationHistory.find(histFilter).sort({ recorded_at: 1 }).limit(1000).lean(),
        Task.find({
          assigned_to: employeeId,
          $or: [{ completed_lat: { $ne: null } }, { rescheduled_lat: { $ne: null } }],
        })
          .sort({ updated_at: -1 })
          .lean(),
      ]);

      const distance_km = calculateTotalDistanceKm(points);

      const taskMarkers = [];
      tasks.forEach((t) => {
        if (typeof t.completed_lat === 'number' && typeof t.completed_lng === 'number') {
          taskMarkers.push({
            id: `${t._id}-completed`,
            task_id: String(t._id),
            type: 'completed',
            title: t.title,
            lat: t.completed_lat,
            lng: t.completed_lng,
            note: t.completion_notes || '',
            timestamp: t.completed_at || t.updated_at,
          });
        }
        if (typeof t.rescheduled_lat === 'number' && typeof t.rescheduled_lng === 'number') {
          taskMarkers.push({
            id: `${t._id}-rescheduled`,
            task_id: String(t._id),
            type: 'rescheduled',
            title: t.title,
            lat: t.rescheduled_lat,
            lng: t.rescheduled_lng,
            note: t.reschedule_reason || '',
            timestamp: t.rescheduled_at || t.updated_at,
          });
        }
      });

      return res.json({
        employee_id: employeeId,
        distance_km,
        points: points.map((p) => ({
          id: String(p._id),
          lat: p.lat,
          lng: p.lng,
          accuracy: p.accuracy,
          recorded_at: p.recorded_at,
        })),
        task_markers: taskMarkers,
      });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to load movement history' });
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
        { upsert: true, returnDocument: 'after' }
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
        employee_code: user.employee_code || '',
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        unit: user.unit || '',
        area: user.area || '',
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

  // Bulk upload queued offline GPS coordinates when employee comes back online
  router.post('/batch', authenticate, async (req, res) => {
    try {
      const { locations = [] } = req.body || {};
      if (!Array.isArray(locations) || locations.length === 0) {
        return res.json({ synced: 0 });
      }

      const employeeId = req.user.id;
      const valid = locations
        .filter((pt) => typeof pt.lat === 'number' && typeof pt.lng === 'number')
        .map((pt) => ({
          employee_id: employeeId,
          lat: pt.lat,
          lng: pt.lng,
          accuracy: pt.accuracy || 0,
          recorded_at: pt.recorded_at ? new Date(pt.recorded_at) : new Date(),
        }))
        .sort((a, b) => a.recorded_at - b.recorded_at);

      if (valid.length === 0) {
        return res.json({ synced: 0 });
      }

      await LocationHistory.insertMany(valid);

      const latest = valid[valid.length - 1];
      const loc = await EmployeeLocation.findOneAndUpdate(
        { employee_id: employeeId },
        {
          lat: latest.lat,
          lng: latest.lng,
          accuracy: latest.accuracy,
          updated_at: latest.recorded_at,
        },
        { upsert: true, returnDocument: 'after' }
      ).lean();

      const user = await User.findById(employeeId).lean();
      const payload = {
        employee_id: String(user._id),
        employee_code: user.employee_code || '',
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        unit: user.unit || '',
        area: user.area || '',
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        is_tracking: loc.is_tracking,
        updated_at: loc.updated_at,
      };

      io.to('admins').emit('location:update', payload);
      return res.json({ synced: valid.length, location: payload });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to sync offline locations' });
    }
  });

  router.post('/stop', authenticate, async (req, res) => {
    try {
      const employeeId = req.user.id;
      const loc = await EmployeeLocation.findOneAndUpdate(
        { employee_id: employeeId },
        { is_tracking: 0, updated_at: new Date() },
        { returnDocument: 'after' }
      ).lean();

      const user = await User.findById(employeeId).lean();
      const payload = {
        employee_id: String(user._id),
        employee_code: user.employee_code || '',
        name: user.name,
        email: user.email,
        phone: user.phone || '',
        unit: user.unit || '',
        area: user.area || '',
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
