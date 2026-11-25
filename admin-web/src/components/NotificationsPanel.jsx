import React, { useState } from 'react';
import { api } from '../api';

export default function NotificationsPanel({ notifications, onRefresh }) {
  const [open, setOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  async function handleReadAll() {
    await api.markAllNotificationsRead();
    onRefresh();
  }

  return (
    <div className="notif-wrapper">
      <button className="notif-bell" onClick={() => setOpen((v) => !v)}>
        🔔 Alerts
        {unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 14px',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <strong style={{ fontSize: 13 }}>Admin Notifications</strong>
            {unreadCount > 0 && (
              <button
                className="btn btn-secondary"
                style={{ padding: '4px 8px', fontSize: 12 }}
                onClick={handleReadAll}
              >
                Mark all read
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
              No notifications yet.
            </div>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className={`notif-item ${n.is_read ? '' : 'unread'}`}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{n.title}</div>
                <div style={{ color: '#4b5563' }}>{n.message}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
