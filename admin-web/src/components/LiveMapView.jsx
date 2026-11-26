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

export default function LiveMapView({ locations, tasks = [], currentUser }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const routeLayerRef = useRef(null);
  const fittedEmpIdRef = useRef(null);

  const lockedUnit =
    currentUser?.role === 'admin' && currentUser?.unit ? currentUser.unit.toUpperCase() : '';

  const [unitFilter, setUnitFilter] = useState('ALL');
  const [selectedEmpId, setSelectedEmpId] = useState(null);
  const [historyDate, setHistoryDate] = useState(todayStr());
  const [historyData, setHistoryData] = useState(null);
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

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const firstValid = locations.find((l) => l.lat != null && l.lng != null);
    const center = firstValid ? [firstValid.lat, firstValid.lng] : [10.8505, 76.2711];

    const map = L.map(mapElRef.current).setView(center, 8);
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
        Full Path Distance Today: <strong>${distLabel}</strong> (${loc.today_points_count ?? 0} waypoints)<br/>
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
      fittedEmpIdRef.current = null;
      if (routeLayerRef.current) routeLayerRef.current.clearLayers();
      return;
    }

    let cancelled = false;
    setLoadingHistory((prev) => (!historyData ? true : prev));
    api
      .getLocationHistory(selectedEmpId, historyDate)
      .then((res) => {
        if (cancelled) return;
        setHistoryData(res);
      })
      .catch(() => {
        if (!cancelled) setHistoryData(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEmpId, historyDate, selectedEmp?.updated_at, selectedEmp?.today_points_count]);

  // Draw full multi-segment path polyline + all intermediate path waypoints + task action markers
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    if (historyData) {
      const pts = historyData.points || [];
      if (pts.length >= 2) {
        const latLngs = pts.map((p) => [p.lat, p.lng]);

        // Outer halo for high visibility of the full tracked path
        L.polyline(latLngs, {
          color: '#ffffff',
          weight: 8,
          opacity: 0.9,
        }).addTo(layer);

        // Main continuous path polyline connecting every recorded waypoint in order
        const polyline = L.polyline(latLngs, {
          color: '#2563eb',
          weight: 4,
          opacity: 0.95,
        }).addTo(layer);

        // Draw every waypoint along the path so the entire tracked path is inspectable
        pts.forEach((pt, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === pts.length - 1;
          const radius = isFirst || isLast ? 7 : 4;
          const fillColor = isFirst ? '#10b981' : isLast ? '#ef4444' : '#3b82f6';
          const borderColor = isFirst ? '#065f46' : isLast ? '#991b1b' : '#1d4ed8';
          const title = isFirst
            ? `🟢 Path Start (Point #1 of ${pts.length})`
            : isLast
            ? `🔴 Latest Path Point (Point #${idx + 1} of ${pts.length})`
            : `🔵 Path Waypoint #${idx + 1} of ${pts.length}`;

          L.circleMarker([pt.lat, pt.lng], {
            radius,
            color: borderColor,
            weight: 2,
            fillColor,
            fillOpacity: 1,
          })
            .addTo(layer)
            .bindPopup(
              `<strong>${title}</strong><br/>
               Employee: ${selectedEmp?.name || ''}<br/>
               Segment Step: <strong>+${pt.segment_meters ?? 0} m</strong><br/>
               Cumulative Path Distance: <strong>${pt.cumulative_km ?? 0} km</strong><br/>
               Coords: ${Number(pt.lat).toFixed(6)}, ${Number(pt.lng).toFixed(6)}<br/>
               Time: ${pt.recorded_at ? new Date(pt.recorded_at).toLocaleString() : ''}`
            );
        });

        const fitKey = `${selectedEmpId}:${historyDate}`;
        if (fittedEmpIdRef.current !== fitKey) {
          fittedEmpIdRef.current = fitKey;
          map.fitBounds(polyline.getBounds(), { padding: [45, 45], maxZoom: 16 });
        }
      } else if (pts.length === 1) {
        const pt = pts[0];
        L.circleMarker([pt.lat, pt.lng], {
          radius: 7,
          color: '#065f46',
          fillColor: '#10b981',
          fillOpacity: 1,
        })
          .addTo(layer)
          .bindPopup(
            `<strong>🟢 First Recorded Point (#1)</strong><br/>
             Move at least 5 meters while punched in to add segments to the path.<br/>
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
  }, [historyData, selectedEmp, selectedEmpId, historyDate, tasks]);

  const selectEmployee = (loc) => {
    setSelectedEmpId(loc.employee_id);
    if (mapRef.current && loc.lat != null && loc.lng != null) {
      mapRef.current.flyTo([loc.lat, loc.lng], 15, { duration: 0.7 });
      const marker = markersRef.current[loc.employee_id];
      if (marker) marker.openPopup();
    }
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
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Movement Path Date</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="date"
              value={historyDate === 'all' ? '' : historyDate}
              onChange={(e) => setHistoryDate(e.target.value || 'all')}
              style={{ flex: 1, padding: '5px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
            />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '5px 8px', fontSize: 11 }}
              onClick={() => setHistoryDate('all')}
            >
              All
            </button>
          </div>
          <div style={{ marginTop: 6, color: '#6b7280', fontSize: 11 }}>
            Click an employee below to view their full multi-point path & total distance covered.
          </div>
        </div>

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
                🛣️ Path Distance: {formatDistanceLabel(loc.today_distance_km, loc.today_distance_meters)} ({loc.today_points_count ?? 0} pts)
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
              — Full Tracked Path ({historyDate === 'all' ? 'All Time' : historyDate}):{' '}
              {loadingHistory && !historyData ? (
                <span>Loading path...</span>
              ) : (
                <>
                  <strong style={{ color: '#1d4ed8' }}>
                    {formatDistanceLabel(historyData?.distance_km, historyData?.distance_meters)} covered
                  </strong>{' '}
                  across <strong>{historyData?.points?.length ?? 0}</strong> path waypoints (every segment summed in order)
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => setSelectedEmpId(null)}
            >
              Clear Path
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
          <span>🟢 <strong>Path Start (#1)</strong></span>
          <span>🔵 <strong>Tracked Waypoints & Route Line</strong></span>
          <span>🔴 <strong>Latest Path Point</strong></span>
          <span>✅ <strong>Task Completed Location</strong></span>
          <span>🟠 <strong>Task Rescheduled Location</strong></span>
        </div>

        <div ref={mapElRef} className="map-container" style={{ flex: 1 }} />
      </div>
    </div>
  );
}
