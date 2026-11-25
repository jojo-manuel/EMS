import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

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

function getInitials(name = '') {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function LiveMapView({ locations }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  useEffect(() => {
    if (!mapElRef.current || mapRef.current) return;

    const firstValid = locations.find((l) => l.lat != null && l.lng != null);
    const center = firstValid ? [firstValid.lat, firstValid.lng] : [12.9716, 77.5946];

    const map = L.map(mapElRef.current).setView(center, 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    locations.forEach((loc) => {
      if (loc.lat == null || loc.lng == null) return;
      const key = loc.employee_id;
      const popupHtml = `
        <strong>${loc.name}</strong><br/>
        Status: <strong>${loc.is_tracking ? 'Live Tracking' : 'Offline'}</strong><br/>
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
  }, [locations]);

  const focusEmployee = (loc) => {
    if (!mapRef.current || loc.lat == null || loc.lng == null) return;
    mapRef.current.flyTo([loc.lat, loc.lng], 15, { duration: 0.7 });
    const marker = markersRef.current[loc.employee_id];
    if (marker) marker.openPopup();
  };

  return (
    <div className="map-layout">
      <div className="map-sidebar">
        {locations.map((loc) => (
          <div key={loc.employee_id} className="emp-loc-card" onClick={() => focusEmployee(loc)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{loc.name}</strong>
              <span className={`badge ${loc.is_tracking ? 'badge-live' : 'badge-offline'}`}>
                {loc.is_tracking ? '● Live' : 'Offline'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6 }}>
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
        ))}
      </div>

      <div ref={mapElRef} className="map-container" />
    </div>
  );
}
