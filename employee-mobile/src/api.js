import { getAuthData, getServerUrl } from './config';

async function request(path, options = {}) {
  const [baseUrl, { token }] = await Promise.all([getServerUrl(), getAuthData()]);
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  login: (email, password) =>
    request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  getMyTasks: () => request('/api/tasks'),
  completeTask: (id, notes, lat = null, lng = null) =>
    request(`/api/tasks/${id}/complete`, {
      method: 'PATCH',
      body: JSON.stringify({ notes, lat, lng }),
    }),
  rescheduleTask: (id, scheduled_start, scheduled_end, reason, lat = null, lng = null) =>
    request(`/api/tasks/${id}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({ scheduled_start, scheduled_end, reason, lat, lng }),
    }),
  sendLocation: (lat, lng, accuracy = 0) =>
    request('/api/locations', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, accuracy, is_tracking: 1 }),
    }),
  sendLocationBatch: (locations) =>
    request('/api/locations/batch', {
      method: 'POST',
      body: JSON.stringify({ locations }),
    }),
  stopTracking: () =>
    request('/api/locations/stop', {
      method: 'POST',
    }),
  getAttendanceStatus: () => request('/api/attendance/status'),
  punchIn: (lat, lng, accuracy = 0, verified_by = 'fingerprint', security = {}) =>
    request('/api/attendance/punch-in', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, accuracy, verified_by, security }),
    }),
  punchOut: (lat, lng, verified_by = 'fingerprint', reason = '', punch_out_at = null) =>
    request('/api/attendance/punch-out', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, verified_by, reason, punch_out_at }),
    }),
};
