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
  completeTask: (id, notes) =>
    request(`/api/tasks/${id}/complete`, {
      method: 'PATCH',
      body: JSON.stringify({ notes }),
    }),
  rescheduleTask: (id, scheduled_start, scheduled_end, reason) =>
    request(`/api/tasks/${id}/reschedule`, {
      method: 'PATCH',
      body: JSON.stringify({ scheduled_start, scheduled_end, reason }),
    }),
  sendLocation: (lat, lng, accuracy = 0) =>
    request('/api/locations', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, accuracy, is_tracking: 1 }),
    }),
  stopTracking: () =>
    request('/api/locations/stop', {
      method: 'POST',
    }),
  getAttendanceStatus: () => request('/api/attendance/status'),
  punchIn: (lat, lng, accuracy = 0, verified_by = 'fingerprint') =>
    request('/api/attendance/punch-in', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, accuracy, verified_by }),
    }),
  punchOut: (lat, lng, verified_by = 'fingerprint') =>
    request('/api/attendance/punch-out', {
      method: 'POST',
      body: JSON.stringify({ lat, lng, verified_by }),
    }),
};
