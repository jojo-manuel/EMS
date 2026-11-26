const express = require('express');
const { User, Task, EmployeeLocation, LocationHistory, getAdminUnitScope } = require('../db');
const { authenticate, requireAdmin } = require('../auth');

// Haversine distance in kilometers between two consecutive GPS points
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

// Calculates cumulative distance along every segment of the ordered movement path (p[0] -> p[1] -> ... -> p[n-1])
function buildTrackedPathWithDistance(points) {
  if (!points || points.length === 0) {
    return { totalKm: 0, totalMeters: 0, annotatedPoints: [] };
  }
  let cumulativeKm = 0;
  const annotatedPoints = points.map((p, idx) => {
    let segmentKm = 0;
    if (idx > 0) {
      const prev = points[idx - 1];
      const dist = haversineKm(prev.lat, prev.lng, p.lat, p.lng);
      // Filter only stationary sub-1-meter float noise; sum all real path steps
      if (dist >= 0.001) {
        segmentKm = dist;
        cumulativeKm += dist;
      }
    }
    return {
      id: String(p._id || idx),
      index: idx + 1,
      lat: p.lat,
      lng: p.lng,
      accuracy: p.accuracy || 0,
      recorded_at: p.recorded_at,
      segment_meters: Math.round(segmentKm * 1000),
      cumulative_km: Number(cumulativeKm.toFixed(3)),
    };
  });

  return {
    totalKm: Number(cumulativeKm.toFixed(3)),
    totalMeters: Math.round(cumulativeKm * 1000),
    annotatedPoints,
  };
}

function getStartOfTodayWindow() {
  // Use last 24h / local day start so UTC vs IST timezone never hides today's path
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  istNow.setUTCHours(0, 0, 0, 0);
  return new Date(istNow.getTime() - istOffsetMs);
}

async function computeTodayStatsForEmployee(employeeId) {
  const startOfDay = getStartOfTodayWindow();
  const pts = await LocationHistory.find({
    employee_id: employeeId,
    recorded_at: { $gte: startOfDay },
  })
    .sort({ recorded_at: 1 })
    .lean();
  const { totalKm, totalMeters } = buildTrackedPathWithDistance(pts);
  return {
    today_distance_km: totalKm,
    today_distance_meters: totalMeters,
    today_points_count: pts.length,
  };
}

function createLocationsRouter(io) {
  const router = express.Router();

  // Admin (unit-scoped) or Super Admin (all units): get latest live locations + today's full-path distance
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
      const startOfDay = getStartOfTodayWindow();

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
        const { totalKm, totalMeters } = buildTrackedPathWithDistance(pts);
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
          today_distance_km: totalKm,
          today_distance_meters: totalMeters,
          today_points_count: pts.length,
        };
      });

      return res.json({ locations: rows });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch locations' });
    }
  });

  // Get full movement history polyline, cumulative path distance, and task completion/reschedule markers
  router.get('/:employeeId/history', authenticate, requireAdmin, async (req, res) => {
    try {
      const { employeeId } = req.params;
      const scope = await getAdminUnitScope(req.user);
      if (scope && !scope.employeeIds.some((id) => String(id) === String(employeeId))) {
        return res.status(403).json({ error: 'Employee is outside your assigned unit' });
      }

      const { date } = req.query;
      const histFilter = { employee_id: employeeId };
      if (date && date !== 'all') {
        // Parse YYYY-MM-DD in IST (+05:30) so all points recorded on that calendar day are included
        const dayStart = new Date(`${date}T00:00:00.000+05:30`);
        const dayEnd = new Date(`${date}T23:59:59.999+05:30`);
        if (!isNaN(dayStart.getTime())) {
          histFilter.recorded_at = { $gte: dayStart, $lte: dayEnd };
        }
      }

      const [points, currentLoc, tasks] = await Promise.all([
        LocationHistory.find(histFilter).sort({ recorded_at: 1 }).limit(5000).lean(),
        EmployeeLocation.findOne({ employee_id: employeeId }).lean(),
        Task.find({
          assigned_to: employeeId,
          $or: [
            { completed_lat: { $ne: null } },
            { rescheduled_lat: { $ne: null } },
            { cancelled_lat: { $ne: null } },
          ],
        })
          .sort({ updated_at: -1 })
          .lean(),
      ]);

      // Ensure the latest live position is also at the tip of the path if it was recorded today
      const fullPathPoints = [...points];
      if (currentLoc && typeof currentLoc.lat === 'number' && typeof currentLoc.lng === 'number') {
        const lastPt = fullPathPoints[fullPathPoints.length - 1];
        if (!lastPt || lastPt.lat !== currentLoc.lat || lastPt.lng !== currentLoc.lng) {
          if (!date || date === 'all' || new Date(currentLoc.updated_at) >= new Date(`${date}T00:00:00.000+05:30`)) {
            fullPathPoints.push({
              _id: 'live-tip',
              lat: currentLoc.lat,
              lng: currentLoc.lng,
              accuracy: currentLoc.accuracy || 0,
              recorded_at: currentLoc.updated_at || new Date(),
            });
          }
        }
      }

      const { totalKm, totalMeters, annotatedPoints } = buildTrackedPathWithDistance(fullPathPoints);

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
        if (typeof t.cancelled_lat === 'number' && typeof t.cancelled_lng === 'number') {
          taskMarkers.push({
            id: `${t._id}-cancelled`,
            task_id: String(t._id),
            type: 'cancelled',
            title: t.title,
            lat: t.cancelled_lat,
            lng: t.cancelled_lng,
            note: t.cancel_reason || '',
            timestamp: t.cancelled_at || t.updated_at,
          });
        }
      });

      return res.json({
        employee_id: employeeId,
        distance_km: totalKm,
        distance_meters: totalMeters,
        points: annotatedPoints,
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

      const [user, todayStats] = await Promise.all([
        User.findById(employeeId).lean(),
        computeTodayStatsForEmployee(employeeId),
      ]);

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
        ...todayStats,
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

      const [user, todayStats] = await Promise.all([
        User.findById(employeeId).lean(),
        computeTodayStatsForEmployee(employeeId),
      ]);

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
        ...todayStats,
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

      const [user, todayStats] = await Promise.all([
        User.findById(employeeId).lean(),
        computeTodayStatsForEmployee(employeeId),
      ]);

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
        ...todayStats,
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
