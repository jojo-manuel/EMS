import React from 'react';

function formatDuration(start, end) {
  if (!start) return '—';
  const endMs = end ? new Date(end).getTime() : Date.now();
  const mins = Math.max(0, Math.round((endMs - new Date(start).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function AttendanceView({ records }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Fingerprint Punch In / Out Logs ({records.length})</h3>
      {records.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 14 }}>
          No punch records yet. When an employee punches in via fingerprint on the mobile app, it will appear here in real time.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Status</th>
              <th>Punch In</th>
              <th>Punch Out</th>
              <th>Duration</th>
              <th>Verification / Notes</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>
                  <strong>{r.employee_name}</strong>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{r.employee_email}</div>
                </td>
                <td>
                  <span className={`badge ${r.status === 'punched_in' ? 'badge-live' : 'badge-offline'}`}>
                    {r.status === 'punched_in' ? '● Punched In' : 'Punched Out'}
                  </span>
                </td>
                <td>{new Date(r.punch_in_at).toLocaleString()}</td>
                <td>{r.punch_out_at ? new Date(r.punch_out_at).toLocaleString() : 'Active shift'}</td>
                <td>{formatDuration(r.punch_in_at, r.punch_out_at)}</td>
                <td>
                  <span className={`badge ${r.verified_by === 'auto_gps_off' ? 'badge-rescheduled' : 'badge-pending'}`}>
                    {r.verified_by === 'auto_gps_off' ? '⚠ Auto (GPS Off)' : `👆 ${r.verified_by}`}
                  </span>
                  {r.punch_out_reason ? (
                    <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
                      {r.punch_out_reason}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
