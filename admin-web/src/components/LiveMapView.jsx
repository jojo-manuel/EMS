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
  const bg = isComplete ? '#059669' : '#d97706';
  const symbol = isComplete ? '✓' : '↻';
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

export default function LiveMapView({ locations, tasks = [], currentUser }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const routeLayerRef = useRef(null);

  const lockedUnit =
    currentUser?.role === 'admin' && currentUser?.unit ? currentUser.unit.toUpperCase() : '';

  const [unitFilter, setUnitFilter] = useState('ALL');
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [historyDate, setHistoryDate] = useState(todayStr());
  const [historyData, setHistoryData] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const filteredLocations = useMemo(() => {
    if (lockedUnit) return locations;
    if (unitFilter === 'ALL') return locations;
    return locations.filter((l) => (l.unit || '').toUpperCase() === unitFilter);
  }, [locations, lockedUnit, unitFilter]);

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const firstValid = locations.find((l) => l.lat != null && l.lng != null);
    const center = firstValid ? [firstValid.lat, firstValid.lng] : [10.8505, 76.2711]; // Kerala default center

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

    // Remove hidden markers when unit filter changes
    Object.keys(markersRef.current).forEach((id) => {
      if (!visibleIds.has(String(id))) {
        markersRef.current[id].remove();
        delete markersRef.current[id];
      }
    });

    filteredLocations.forEach((loc) => {
      if (loc.lat == null || loc.lng == null) return;
      const key = loc.employee_id;
      const popupHtml = `
        <strong>${loc.name}</strong> ${loc.employee_code ? `(${loc.employee_code})` : ''}<br/>
        Unit: <strong>${loc.unit || '—'}</strong> · Area: ${loc.area || '—'}<br/>
        Status: <strong>${loc.is_tracking ? 'Live Tracking' : 'Offline'}</strong><br/>
        Today's Distance: <strong>${loc.today_distance_km ?? 0} km</strong><br/>
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

  // Load movement history & task completion/reschedule markers when employee or date changes
  useEffect(() => {
    if (!selectedEmp) {
      setHistoryData(null);
      if (routeLayerRef.current) routeLayerRef.current.clearLayers();
      return;
    }

    let cancelled = false;
    setLoadingHistory(true);
    api
      .getLocationHistory(selectedEmp.employee_id, historyDate)
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
  }, [selectedEmp, historyDate]);

  // Draw route polyline + task completion/reschedule markers on map
  useEffect(() => {
    const map = mapRef.current;
    const layer = routeLayerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    if (historyData) {
      const pts = historyData.points || [];
      if (pts.length >= 2) {
        const latLngs = pts.map((p) => [p.lat, p.lng]);
        const polyline = L.polyline(latLngs, {
          color: '#2563eb',
          weight: 4,
          opacity: 0.85,
        }).addTo(layer);

        // Start marker
        const first = pts[0];
        L.circleMarker([first.lat, first.lng], {
          radius: 7,
          color: '#1e40af',
          fillColor: '#60a5fa',
          fillOpacity: 1,
        })
          .addTo(layer)
          .bindPopup(
            `<strong>Route Start (${selectedEmp?.name})</strong><br/>Time: ${new Date(first.recorded_at).toLocaleString()}`
          );

        map.fitBounds(polyline.getBounds(), { padding: [40, 40], maxZoom: 16 });
      } else if (pts.length === 1) {
        map.flyTo([pts[0].lat, pts[0].lng], 15, { duration: 0.7 });
      }

      // Plot task completion & reschedule markers for selected employee
      (historyData.task_markers || []).forEach((tm) => {
        const label = tm.type === 'completed' ? '✓ Task Completed Here' : '↻ Task Rescheduled Here';
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
      // When no single employee is selected, show all tasks' completion/reschedule location markers
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
      });
    }
  }, [historyData, selectedEmp, tasks]);

  const selectEmployee = (loc) => {
    setSelectedEmp(loc);
    if (mapRef.current && loc.lat != null && loc.lng != null) {
      mapRef.current.flyTo([loc.lat, loc.lng], 14, { duration: 0.7 });
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
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Movement History Date</div>
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
            Click an employee below to view their movement trail, distance covered, & task pins.
          </div>
        </div>

        {filteredLocations.map((loc) => {
          const isSelected = selectedEmp?.employee_id === loc.employee_id;
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
              <div style={{ fontSize: 12, color: '#2563eb', marginTop: 4, fontWeight: 600 }}>
                🛣️ Today: {loc.today_distance_km ?? 0} km ({loc.today_points_count ?? 0} pts)
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
              — Movement History ({historyDate === 'all' ? 'All Time' : historyDate}):{' '}
              {loadingHistory ? (
                <span>Loading trail...</span>
              ) : (
                <>
                  <strong style={{ color: '#1d4ed8' }}>
                    {historyData?.distance_km ?? 0} km covered
                  </strong>{' '}
                  ({historyData?.points?.length ?? 0} GPS points ·{' '}
                  {historyData?.task_markers?.length ?? 0} task completion/reschedule markers)
                </>
              )}
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '5px 10px', fontSize: 12 }}
              onClick={() => setSelectedEmp(null)}
            >
              Clear Route Trail
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            gap: 14,
            fontSize: 12,
            color: '#4b5563',
            padding: '0 4px',
          }}
        >
          <span>🟢 <strong>Live Employee Pin</strong></span>
          <span>🔵 <strong>Movement Route Line</strong></span>
          <span>✅ <strong>Task Completed Location</strong></span>
          <span>🟠 <strong>Task Rescheduled Location</strong></span>
        </div>

        <div ref={mapElRef} className="map-container" style={{ flex: 1 }} />
      </div>
    </div>
  );
}
