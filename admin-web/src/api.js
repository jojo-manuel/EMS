export const API_URL = import.meta.env.VITE_API_URL || '';
export const UNITS = ['KOZHIKODE', 'KOCHI', 'TRIVANDRUM', 'KANNUR', 'THRISSUR', 'KOTTAYAM'];

export function getToken() {
  return localStorage.getItem('emptracker_token');
}

export function setAuth(token, user) {
  localStorage.setItem('emptracker_token', token);
  localStorage.setItem('emptracker_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('emptracker_token');
  localStorage.removeItem('emptracker_user');
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('emptracker_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_URL}${path}`, {
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
  getEmployees: () => request('/api/users/employees'),
  createEmployee: (payload) =>
    request('/api/users/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteEmployee: (id) =>
    request(`/api/users/employees/${id}`, {
      method: 'DELETE',
    }),
  getAdmins: () => request('/api/users/admins'),
  createAdmin: (payload) =>
    request('/api/users/admins', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAdmin: (id) =>
    request(`/api/users/admins/${id}`, {
      method: 'DELETE',
    }),
  getTasks: () => request('/api/tasks'),
  createTask: (payload) =>
    request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTask: (id, payload) =>
    request(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteTask: (id) =>
    request(`/api/tasks/${id}`, {
      method: 'DELETE',
    }),
  getLocations: () => request('/api/locations'),
  getLocationHistory: (employeeId, date = 'all') =>
    request(`/api/locations/${employeeId}/history?date=${encodeURIComponent(date)}`),
  getAttendance: () => request('/api/attendance'),
  getNotifications: () => request('/api/notifications'),
  markNotificationRead: (id) =>
    request(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllNotificationsRead: () =>
    request('/api/notifications/read-all', { method: 'PATCH' }),
};
