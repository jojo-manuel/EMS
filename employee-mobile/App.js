import React, { useEffect, useState, useCallback } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { io } from 'socket.io-client';
import { api } from './src/api';
import { clearAuthData, getAuthData, getServerUrl, saveAuthData } from './src/config';
import { startLiveTracking, stopLiveTracking } from './src/locationTask';
import LoginScreen from './src/screens/LoginScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import TrackingScreen from './src/screens/TrackingScreen';

export default function App() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [tab, setTab] = useState('tracking');
  const [tasks, setTasks] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [lastCoords, setLastCoords] = useState(null);
  const [activePunch, setActivePunch] = useState(null);
  const [punchHistory, setPunchHistory] = useState([]);

  useEffect(() => {
    getAuthData().then(({ token: t, user: u }) => {
      if (t && u) {
        setToken(t);
        setUser(u);
      }
    });
  }, []);

  const loadTasks = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const res = await api.getMyTasks();
      setTasks(res.tasks);
    } catch (err) {
      console.warn('Failed to load tasks:', err.message);
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  const loadAttendance = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.getAttendanceStatus();
      setActivePunch(res.active || null);
      setPunchHistory(res.history || []);
      if (res.active) {
        setIsTracking(true);
        startLiveTracking((coords) => {
          setLastCoords({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy,
            time: new Date().toLocaleTimeString(),
          });
        }).catch(() => {});
      } else {
        setIsTracking(false);
      }
    } catch (err) {
      console.warn('Failed to load attendance:', err.message);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadTasks();
    loadAttendance();

    let socket;
    getServerUrl().then((url) => {
      socket = io(url, { auth: { token }, transports: ['websocket', 'polling'] });
      socket.on('task:created', loadTasks);
      socket.on('task:updated', loadTasks);
      socket.on('task:deleted', loadTasks);
    });

    return () => {
      if (socket) socket.disconnect();
    };
  }, [token, loadTasks, loadAttendance]);

  async function handleLogin(newToken, newUser) {
    await saveAuthData(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
  }

  async function handleLogout() {
    if (isTracking) {
      await stopLiveTracking().catch(() => {});
      setIsTracking(false);
    }
    await clearAuthData();
    setToken(null);
    setUser(null);
    setActivePunch(null);
  }

  if (!token || !user) {
    return (
      <>
        <StatusBar style="light" />
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Hi, {user.name}</Text>
          <Text style={[styles.headerSub, { color: isTracking ? '#10b981' : '#6b7280' }]}>
            {isTracking ? '● Punched In · Live Tracking' : 'Punched Out'}
          </Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {tab === 'schedule' ? (
          <ScheduleScreen tasks={tasks} refreshing={refreshing} onRefresh={loadTasks} />
        ) : (
          <TrackingScreen
            isTracking={isTracking}
            setIsTracking={setIsTracking}
            lastCoords={lastCoords}
            setLastCoords={setLastCoords}
            activePunch={activePunch}
            setActivePunch={setActivePunch}
            punchHistory={punchHistory}
            onRefreshAttendance={loadAttendance}
          />
        )}
      </View>

      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, tab === 'tracking' && styles.tabItemActive]}
          onPress={() => setTab('tracking')}
        >
          <Text style={[styles.tabText, tab === 'tracking' && styles.tabTextActive]}>
            👆 Punch In / Track
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, tab === 'schedule' && styles.tabItemActive]}
          onPress={() => setTab('schedule')}
        >
          <Text style={[styles.tabText, tab === 'schedule' && styles.tabTextActive]}>
            📅 My Schedule ({tasks.length})
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  headerSub: { fontSize: 12, fontWeight: '600', marginTop: 2 },
  logoutBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  logoutText: { fontSize: 13, fontWeight: '600', color: '#374151' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  tabItem: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabItemActive: { borderTopWidth: 3, borderTopColor: '#2563eb' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#6b7280' },
  tabTextActive: { color: '#2563eb' },
});
