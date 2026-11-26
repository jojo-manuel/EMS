import React, { useEffect, useRef, useState, useMemo } from 'react';
import L from 'leaflet';
import { api, UNITS } from '../api';

function makeMarkerIcon(isTracking, initials) {
  const bg = isTracking ? '#10b981' : '#6b7280';
  return L.divIcon({
    className: 'custom-emp-marker',
    html: `<div style="
      width: 34px; height: 34px; border-radius: 50%;
      background: ${bg}; color: #fff; font-weight: 700; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
      border: 3px solid #fff; box-shadow: 0 3px 10px rgba(0,0,0,0.3);
    ">${initials}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

function makeWaypointBadgeIcon(number, isFirst, isLast) {
  const bg = isFirst ? '#10b981' : isLast ? '#ef4444' : '#2563eb';
  const size = isFirst || isLast ? 24 : 20;
  return L.divIcon({
    className: 'custom-waypoint-marker',
    html: `<div style="
      width: ${size}px; height: ${size}px; border-radius: 50%;
      background: ${bg}; color: #fff; font-weight: 800; font-size: 10px;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.35);
    ">${number}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeDirectionArrowIcon(angleDeg) {
  return L.divIcon({
    className: 'custom-dir-arrow',
    html: `<div style="
      transform: rotate(${angleDeg}deg);
      color: #1d4ed8;
      font-size: 14px;
      font-weight: 900;
      text-shadow: 0 0 3px #fff, 0 0 3px #fff;
      line-height: 16px;
      text-align: center;
    ">▲</div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

function bearingDegrees(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lng2 - lng1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function makeTaskActionIcon(type) {
  const isComplete = type === 'completed';
  const isCancelled = type === 'cancelled';
  const bg = isComplete ? '#059669' : isCancelled ? '#dc2626' : '#d97706';
  const symbol = isComplete ? '✓' : isCancelled ? '✕' : '↻';
  return L.divIcon({
    className: 'custom-task-action-marker',
    html: `<div style="
      width: 28px; height: 28px; border-radius: 8px;
      background: ${bg}; color: #fff; font-weight: 800; font-size: 15px;
      display: flex; align-items: center; justify-content: center;
      border: 2px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    ">${symbol}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function getInitials(name = '') {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDistanceLabel(km = 0, meters = null) {
  const m = meters != null ? meters : Math.round((km || 0) * 1000);
  if (m < 1000) {
    return `${Number(km || 0).toFixed(3)} km (${m} m)`;
  }
  return `${Number(km || 0).toFixed(2)} km (${m.toLocaleString()} m)`;
}

// Fetch road-snapped route geometry connecting the employee's ordered waypoints via OSRM
async function fetchRoadSnappedGeometry(points) {
  if (!points || points.length < 2) return null;

  // Deduplicate identical consecutive points and sample up to 80 waypoints for OSRM URL limit
  const distinct = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = distinct[distinct.length - 1];
    const curr = points[i];
    if (Math.abs(prev.lat - curr.lat) > 0.00003 || Math.abs(prev.lng - curr.lng) > 0.00003) {
      distinct.push(curr);
    }
  }
  if (distinct.length < 2) return null;

  let sampled = distinct;
  if (distinct.length > 80) {
    const step = (distinct.length - 1) / 79;
    sampled = [];
    for (let i = 0; i < 79; i++) {
      sampled.push(distinct[Math.round(i * step)]);
    }
    sampled.push(distinct[distinct.length - 1]);
  }

  const coordsStr = sampled.map((p) => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route?.geometry?.coordinates) return null;
    return {
      latLngs: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
      roadDistanceMeters: Math.round(route.distance || 0),
      roadDistanceKm: Number(((route.distance || 0) / 1000).toFixed(3)),
    };
  } catch {
    return null;
  }
}

const ROUTE_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#db2777', '#ea580c', '#059669'];

export default function LiveMapView({ locations, tasks = [], currentUser }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const routeLayerRef = useRef(null);
  const fittedKeyRef = useRef(null);

  const lockedUnit =
    currentUser?.role === 'admin' && currentUser?.unit ? currentUser.unit.toUpperCase() : '';

  const [unitFilter, setUnitFilter] = useState('ALL');
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const [historyDate, setHistoryDate] = useState('all'); // Default to 'all' so every recorded point is connected immediately
  const [routeMode, setRouteMode] = useState('both'); // 'both' (Road + Direct Points) | 'direct' (Connect Exact Points)
  const [historyData, setHistoryData] = useState(null);
  const [roadRoute, setRoadRoute] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const filteredLocations = useMemo(() => {
    if (lockedUnit) return locations;
    if (unitFilter === 'ALL') return locations;
    return locations.filter((l) => (l.unit || '').toUpperCase() === unitFilter);
  }, [locations, lockedUnit, unitFilter]);

  const selectedEmp = useMemo(
    () => locations.find((l) => String(l.employee_id) === String(selectedEmpId)) || null,
    [locations, selectedEmpId]
  );

  // Auto-select the first employee with a tracked path so their full connected route is visible immediately
  useEffect(() => {
    if (selectedEmpId) return;
    const withPath =
      filteredLocations.find((l) => (l.today_points_count || 0) >= 2 || l.is_tracking) ||
      filteredLocations.find((l) => l.lat != null && l.lng != null);
    if (withPath) {
      setSelectedEmpId(withPath.employee_id);
    }
  }, [filteredLocations, selectedEmpId]);

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const firstValid = locations.find((l) => l.lat != null && l.lng != null);
    const center = firstValid ? [firstValid.lat, firstValid.lng] : [10.8505, 76.2711];

    const map = L.map(mapElRef.current).setView(center, 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    routeLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
      routeLayerRef.current = null;
    };
  }, []);

  // Plot live employee pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visibleIds = new Set(filteredLocations.map((l) => String(l.employee_id)));

    Object.keys(markersRef.current).forEach((id) => {
      if (!visibleIds.has(String(id))) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    filteredLocations.forEach((loc) => {
      if (loc.lat == null || loc.lng == null) return;
      const key = loc.employee_id;
      const distLabel = formatDistanceLabel(loc.today_distance_km, loc.today_distance_meters);
      const popupHtml = `
        <strong>${loc.name}</strong> ${loc.employee_code ? `(${loc.employee_code})` : ''}<br/>
        Unit: <strong>${loc.unit || '—'}</strong> · Area: ${loc.area || '—'}<br/>
        Status: <strong>${loc.is_tracking ? 'Live Tracking' : 'Offline'}</strong><br/>
        Connected Path Today: <strong>${distLabel}</strong> (${loc.today_points_count ?? 0} points)<br/>
        Coords: ${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}<br/>
        Updated: ${loc.updated_at ? new Date(loc.updated_at).toLocaleTimeString() : 'N/A'}
      `;

      if (markersRef.current[key]) {
        markersRef.current[key]
          .setLatLng([loc.lat, loc.lng])
          .setIcon(makeMarkerIcon(loc.is_tracking, getInitials(loc.name)))
          .setPopupContent(popupHtml);
      } else {
        markersRef.current[key] = L.marker([loc.lat, loc.lng], {
          icon: makeMarkerIcon(loc.is_tracking, getInitials(loc.name)),
        })
          .addTo(map)
          .bindPopup(popupHtml);
      }
    });
  }, [filteredLocations]);

  // Fetch & auto-refresh full movement path whenever selected employee, date, or live location updates
  useEffect(() => {
    if (!selectedEmpId) {
      setHistoryData(null);
      setRoadRoute(null);
      fittedKeyRef.current = null;
      return;
    }

    let cancelled = false;
    setLoadingHistory((prev) => (!historyData ? true : prev));
    api
      .getLocationHistory(selectedEmpId, historyDate)
      .then(async (res) => {
        if (cancelled) return;
        setHistoryData(res);
        if (res.points && res.points.length >= 2) {
          const snapped = await fetchRoadSnappedGeometry(res.points);
          if (!cancelled) setRoadRoute(snapped);
        } else {
          setRoadRoute(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryData(null);
          setRoadRoute(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEmpId, historyDate, selectedEmp?.updated_at, selectedEmp?.today_points_count]);

  // Draw connected route connecting all points + numbered waypoints + direction arrows
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    if (selectedEmpId && historyData) {
      const pts = historyData.points || [];
      if (pts.length >= 2) {
        const directLatLngs = pts.map((p) => [p.lat, p.lng]);

        // 1. If road-snapped route is enabled & available, draw the road-following path
        if (routeMode === 'both' && roadRoute?.latLngs?.length >= 2) {
          L.polyline(roadRoute.latLngs, {
            color: '#ffffff',
            weight: 9,
            opacity: 0.9,
          }).addTo(layer);

          L.polyline(roadRoute.latLngs, {
            color: '#10b981',
            weight: 5,
            opacity: 0.9,
          })
            .addTo(layer)
            .bindPopup(
              `<strong>🛣️ Exact Road Route (${selectedEmp?.name})</strong><br/>Road Distance: ${formatDistanceLabel(
                roadRoute.roadDistanceKm,
                roadRoute.roadDistanceMeters
              )}`
            );
        }

        // 2. Always connect all recorded GPS points in exact sequential order (#1 -> #2 -> ... -> #N)
        L.polyline(directLatLngs, {
          color: '#ffffff',
          weight: routeMode === 'direct' ? 8 : 5,
          opacity: 0.85,
        }).addTo(layer);

        const directLine = L.polyline(directLatLngs, {
          color: '#2563eb',
          weight: routeMode === 'direct' ? 4 : 3,
          opacity: 0.95,
          dashArray: routeMode === 'both' && roadRoute ? '6, 6' : null,
        }).addTo(layer);

        // 3. Draw directional arrows along each connected segment so travel direction is clear
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const segDist = Math.abs(prev.lat - curr.lat) + Math.abs(prev.lng - curr.lng);
          if (segDist > 0.00008) {
            const midLat = (prev.lat + curr.lat) / 2;
            const midLng = (prev.lng + curr.lng) / 2;
            const angle = bearingDegrees(prev.lat, prev.lng, curr.lat, curr.lng);
            L.marker([midLat, midLng], {
              icon: makeDirectionArrowIcon(angle),
              interactive: false,
            }).addTo(layer);
          }
        }

        // 4. Draw numbered waypoint markers (#1, #2, #3, ..., #N) at every connected point
        pts.forEach((pt, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === pts.length - 1;
          const title = isFirst
            ? `🟢 Start Point (#1 of ${pts.length})`
            : isLast
            ? `🔴 Latest Point (#${idx + 1} of ${pts.length})`
            : `🔵 Route Point #${idx + 1} of ${pts.length}`;

          L.marker([pt.lat, pt.lng], {
            icon: makeWaypointBadgeIcon(idx + 1, isFirst, isLast),
          })
            .addTo(layer)
            .bindPopup(
              `<strong>${title}</strong><br/>
               Employee: ${selectedEmp?.name || ''}<br/>
               Segment from Point #${idx}: <strong>+${pt.segment_meters ?? 0} m</strong><br/>
               Cumulative Connected Distance: <strong>${formatDistanceLabel(pt.cumulative_km)}</strong><br/>
               Coords: ${Number(pt.lat).toFixed(6)}, ${Number(pt.lng).toFixed(6)}<br/>
               Time: ${pt.recorded_at ? new Date(pt.recorded_at).toLocaleString() : ''}`
            );
        });

        const fitKey = `${selectedEmpId}:${historyDate}`;
        if (fittedKeyRef.current !== fitKey) {
          fittedKeyRef.current = fitKey;
          map.fitBounds(directLine.getBounds(), { padding: [50, 50], maxZoom: 17 });
        }
      } else if (pts.length === 1) {
        const pt = pts[0];
        L.marker([pt.lat, pt.lng], {
          icon: makeWaypointBadgeIcon(1, true, false),
        })
          .addTo(layer)
          .bindPopup(
            `<strong>🟢 Point #1 (${selectedEmp?.name || ''})</strong><br/>
             Only 1 GPS point recorded so far. As the employee moves while punched in, all points will connect automatically.<br/>
             Coords: ${Number(pt.lat).toFixed(6)}, ${Number(pt.lng).toFixed(6)}`
          );
        map.flyTo([pt.lat, pt.lng], 15, { duration: 0.7 });
      }

      // Plot task completion, reschedule & cancel markers for selected employee
      (historyData.task_markers || []).forEach((tm) => {
        const label =
          tm.type === 'completed'
            ? '✓ Task Completed Here'
            : tm.type === 'cancelled'
            ? '✕ Task Cancelled Here'
            : '↻ Task Rescheduled Here';
        L.marker([tm.lat, tm.lng], { icon: makeTaskActionIcon(tm.type) })
          .addTo(layer)
          .bindPopup(
            `<strong>${label}</strong><br/>
             Task: <strong>${tm.title}</strong><br/>
             Employee: ${selectedEmp?.name}<br/>
             ${tm.note ? `Note/Reason: ${tm.note}<br/>` : ''}
             Coords: ${Number(tm.lat).toFixed(5)}, ${Number(tm.lng).toFixed(5)}<br/>
             Time: ${tm.timestamp ? new Date(tm.timestamp).toLocaleString() : ''}`
          );
      });
    } else {
      // "Show All Employees' Routes" mode: connect today_path for every employee on the map!
      const allBounds = [];
      filteredLocations.forEach((loc, empIdx) => {
        const pts = loc.today_path || [];
        if (pts.length >= 2) {
          const color = ROUTE_COLORS[empIdx % ROUTE_COLORS.length];
          const latLngs = pts.map((p) => [p.lat, p.lng]);
          allBounds.push(...latLngs);

          L.polyline(latLngs, { color: '#ffffff', weight: 6, opacity: 0.85 }).addTo(layer);
          L.polyline(latLngs, { color, weight: 3.5, opacity: 0.95 })
            .addTo(layer)
            .bindPopup(
              `<strong>${loc.name} — Connected Route</strong><br/>Distance: ${formatDistanceLabel(
                loc.today_distance_km,
                loc.today_distance_meters
              )} (${pts.length} points)`
            );

          pts.forEach((pt, idx) => {
            L.circleMarker([pt.lat, pt.lng], {
              radius: idx === 0 || idx === pts.length - 1 ? 6 : 3.5,
              color: '#fff',
              weight: 1.5,
              fillColor: color,
              fillOpacity: 1,
            })
              .addTo(layer)
              .bindPopup(
                `<strong>${loc.name} — Point #${idx + 1} of ${pts.length}</strong><br/>
                 Step: +${pt.segment_meters ?? 0} m · Total: ${formatDistanceLabel(pt.cumulative_km)}<br/>
                 Time: ${pt.recorded_at ? new Date(pt.recorded_at).toLocaleString() : ''}`
              );
          });
        }
      });

      if (allBounds.length >= 2 && fittedKeyRef.current !== 'ALL') {
        fittedKeyRef.current = 'ALL';
        map.fitBounds(L.latLngBounds(allBounds), { padding: [50, 50], maxZoom: 16 });
      }

      tasks.forEach((t) => {
        if (typeof t.completed_lat === 'number' && typeof t.completed_lng === 'number') {
          L.marker([t.completed_lat, t.completed_lng], { icon: makeTaskActionIcon('completed') })
            .addTo(layer)
            .bindPopup(
              `<strong>✓ Task Completed Location</strong><br/>
               Task: <strong>${t.title}</strong><br/>
               Employee: ${t.assignee_name} (${t.assignee_unit || ''})<br/>
               ${t.completion_notes ? `Note: ${t.completion_notes}<br/>` : ''}
               Coords: ${Number(t.completed_lat).toFixed(5)}, ${Number(t.completed_lng).toFixed(5)}`
            );
        }
        if (typeof t.rescheduled_lat === 'number' && typeof t.rescheduled_lng === 'number') {
          L.marker([t.rescheduled_lat, t.rescheduled_lng], { icon: makeTaskActionIcon('rescheduled') })
            .addTo(layer)
            .bindPopup(
              `<strong>↻ Task Rescheduled Location</strong><br/>
               Task: <strong>${t.title}</strong><br/>
               Employee: ${t.assignee_name} (${t.assignee_unit || ''})<br/>
               ${t.reschedule_reason ? `Reason: ${t.reschedule_reason}<br/>` : ''}
               Coords: ${Number(t.rescheduled_lat).toFixed(5)}, ${Number(t.rescheduled_lng).toFixed(5)}`
            );
        }
        if (typeof t.cancelled_lat === 'number' && typeof t.cancelled_lng === 'number') {
          L.marker([t.cancelled_lat, t.cancelled_lng], { icon: makeTaskActionIcon('cancelled') })
            .addTo(layer)
            .bindPopup(
              `<strong>✕ Task Cancelled Location</strong><br/>
               Task: <strong>${t.title}</strong><br/>
               Employee: ${t.assignee_name} (${t.assignee_unit || ''})<br/>
               ${t.cancel_reason ? `Reason: ${t.cancel_reason}<br/>` : ''}
               Coords: ${Number(t.cancelled_lat).toFixed(5)}, ${Number(t.cancelled_lng).toFixed(5)}`
            );
        }
      });
    }
  }, [historyData, roadRoute, routeMode, selectedEmp, selectedEmpId, historyDate, filteredLocations, tasks]);

  const selectEmployee = (loc) => {
    fittedKeyRef.current = null;
    setSelectedEmpId(loc.employee_id);
  };

  return (
    <div className="map-layout">
      <div className="map-sidebar">
        {!lockedUnit && (
          <select
            value={unitFilter}
            onChange={(e) => setUnitFilter(e.target.value)}
            style={{
              padding: '9px 10px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              fontSize: 13,
              background: '#fff',
              fontWeight: 600,
            }}
          >
            <option value="ALL">All Units ({locations.length})</option>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        )}

        <div
          style={{
            background: '#fff',
            padding: 10,
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Route Points Filter</div>
          <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
            <button
              type="button"
              className={`btn ${historyDate === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, padding: '5px 8px', fontSize: 11 }}
              onClick={() => {
                fittedKeyRef.current = null;
                setHistoryDate('all');
              }}
            >
              All Points
            </button>
            <button
              type="button"
              className={`btn ${historyDate === todayStr() ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, padding: '5px 8px', fontSize: 11 }}
              onClick={() => {
                fittedKeyRef.current = null;
                setHistoryDate(todayStr());
              }}
            >
              Today
            </button>
          </div>
          <input
            type="date"
            value={historyDate === 'all' ? '' : historyDate}
            onChange={(e) => {
              fittedKeyRef.current = null;
              setHistoryDate(e.target.value || 'all');
            }}
            style={{ width: '100%', padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
          />
          <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
            <button
              type="button"
              className={`btn ${routeMode === 'both' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, padding: '5px 6px', fontSize: 11 }}
              onClick={() => setRouteMode('both')}
            >
              🛣️ Road + Points
            </button>
            <button
              type="button"
              className={`btn ${routeMode === 'direct' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, padding: '5px 6px', fontSize: 11 }}
              onClick={() => setRouteMode('direct')}
            >
              📏 Direct Points
            </button>
          </div>
        </div>

        <button
          type="button"
          className={`btn ${!selectedEmpId ? 'btn-primary' : 'btn-secondary'}`}
          style={{ width: '100%', fontSize: 12 }}
          onClick={() => {
            fittedKeyRef.current = null;
            setSelectedEmpId(null);
          }}
        >
          🗺️ Show All Employees&apos; Connected Routes
        </button>

        {filteredLocations.map((loc) => {
          const isSelected = String(selectedEmpId) === String(loc.employee_id);
          return (
            <div
              key={loc.employee_id}
              className="emp-loc-card"
              style={isSelected ? { borderColor: '#2563eb', borderWidth: 2, background: '#eff6ff' } : {}}
              onClick={() => selectEmployee(loc)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>
                  {loc.name} {loc.employee_code ? `(${loc.employee_code})` : ''}
                </strong>
                <span className={`badge ${loc.is_tracking ? 'badge-live' : 'badge-offline'}`}>
                  {loc.is_tracking ? '● Live' : 'Offline'}
                </span>
              </div>
              <div style={{ fontSize: 12, color: '#374151', marginTop: 4, fontWeight: 600 }}>
                {loc.unit || 'No Unit'} {loc.area ? `· ${loc.area}` : ''}
              </div>
              <div style={{ fontSize: 12, color: '#2563eb', marginTop: 4, fontWeight: 700 }}>
                🛣️ Connected Path: {formatDistanceLabel(loc.today_distance_km, loc.today_distance_meters)} ({loc.today_points_count ?? 0} pts)
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                {loc.lat != null
                  ? `${Number(loc.lat).toFixed(5)}, ${Number(loc.lng).toFixed(5)}`
                  : 'No GPS signal yet'}
              </div>
              {loc.updated_at && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  Last seen: {new Date(loc.updated_at).toLocaleString()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
        {selectedEmp && (
          <div
            className="card"
            style={{
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#eff6ff',
              borderColor: '#bfdbfe',
            }}
          >
            <div style={{ fontSize: 13 }}>
              <strong>
                {selectedEmp.name} ({selectedEmp.unit || '—'})
              </strong>{' '}
              — Exact Travel Route ({historyDate === 'all' ? 'All Recorded Points' : historyDate}):{' '}
              {loadingHistory && !historyData ? (
                <span>Connecting route points...</span>
              ) : (
                <>
                  <strong style={{ color: '#1d4ed8' }}>
                    GPS Point-to-Point: {formatDistanceLabel(historyData?.distance_km, historyData?.distance_meters)}
                  </strong>
                  {roadRoute ? (
                    <span style={{ marginLeft: 10, color: '#047857', fontWeight: 700 }}>
                      · 🛣️ Road Distance: {formatDistanceLabel(roadRoute.roadDistanceKm, roadRoute.roadDistanceMeters)}
                    </span>
                  ) : null}{' '}
                  (<strong>{historyData?.points?.length ?? 0}</strong> connected points:{' '}
                  <code>#1 → #{historyData?.points?.length || 1}</code>)
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => {
                fittedKeyRef.current = null;
                setSelectedEmpId(null);
              }}
            >
              Show All Employees
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            fontSize: 12,
            color: '#4b5563',
            padding: '0 4px',
          }}
        >
          <span>🟢 <strong>#1 Start Point</strong></span>
          <span>🔵 <strong>#2..#N Connected Route Points & Arrows (▲)</strong></span>
          <span>🟩 <strong>Exact Road-Snapped Travel Route</strong></span>
          <span>🔴 <strong>Latest Point</strong></span>
          <span>✅ <strong>Task Done</strong></span>
          <span>🟠 <strong>Task Rescheduled</strong></span>
          <span>❌ <strong>Task Cancelled</strong></span>
        </div>

        <div ref={mapElRef} className="map-container" style={{ flex: 1 }} />
      </div>
    </div>
  );
}
