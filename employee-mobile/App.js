import React, { useEffect, useState, useCallback } from 'react';
import { SafeAreaView, View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { StatusBar } from 'expo-status-bar';
import { io } from 'socket.io-client';
import { api } from './src/api';
import { clearAuthData, getAuthData, getServerUrl, saveAuthData } from './src/config';
import {
  startLiveTracking,
  stopLiveTracking,
  flushOfflineLocations,
  flushPendingAutoPunchOut,
} from './src/locationTask';
import LoginScreen from './src/screens/LoginScreen';
import ScheduleScreen from './src/screens/ScheduleScreen';
import TrackingScreen from './src/screens/TrackingScreen';

const BIOMETRIC_SETUP_KEY = 'emptracker_biometric_setup_done';

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
  const [newTaskBanner, setNewTaskBanner] = useState(null);
  const knownTaskIdsRef = React.useRef(null);

  // App-wide Fingerprint Lock state (Initial setup + every app launch)
  const [appUnlocked, setAppUnlocked] = useState(false);
  const [isInitialSetup, setIsInitialSetup] = useState(false);
  const [lockError, setLockError] = useState('');

  const promptFingerprintUnlock = useCallback(async (setupMode = false) => {
    setLockError('');
    try {
      const [hasHardware, isEnrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);

      if (!hasHardware || !isEnrolled) {
        setLockError(
          'Fingerprint is not set up on this phone. Please enroll a fingerprint in your device settings to unlock EmpTracker.'
        );
        return;
      }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: setupMode
          ? 'Initial Setup: Verify Fingerprint to Lock & Secure App'
          : 'EmpTracker Locked: Scan Fingerprint to Unlock',
        cancelLabel: 'Cancel',
        disableDeviceFallback: true,
      });

      if (result.success) {
        await AsyncStorage.setItem(BIOMETRIC_SETUP_KEY, 'true');
        setIsInitialSetup(false);
        setAppUnlocked(true);
      } else {
        setLockError('Fingerprint verification required to access the app.');
      }
    } catch (err) {
      setLockError(err.message || 'Biometric authentication failed.');
    }
  }, []);

  useEffect(() => {
    Promise.all([getAuthData(), AsyncStorage.getItem(BIOMETRIC_SETUP_KEY)]).then(
      ([{ token: t, user: u }, setupDone]) => {
        if (t && u) {
          setToken(t);
          setUser(u);
        }
        const firstTime = !setupDone;
        setIsInitialSetup(firstTime);
        promptFingerprintUnlock(firstTime);
      }
    );
  }, [promptFingerprintUnlock]);

  const loadTasks = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    try {
      const res = await api.getMyTasks();
      const incoming = res.tasks || [];
      if (knownTaskIdsRef.current !== null) {
        const newlyAssigned = incoming.filter((t) => !knownTaskIdsRef.current.has(t.id));
        if (newlyAssigned.length > 0) {
          const latest = newlyAssigned[newlyAssigned.length - 1];
          setNewTaskBanner(latest);
          Alert.alert(
            '🔔 New Work Assigned!',
            `${latest.title}\nScheduled: ${new Date(latest.scheduled_start).toLocaleString()}`
          );
        }
      }
      knownTaskIdsRef.current = new Set(incoming.map((t) => t.id));
      setTasks(incoming);
    } catch (err) {
      console.warn('Failed to load tasks:', err.message);
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  const loadAttendance = useCallback(async () => {
    if (!token) return;
    try {
      await flushPendingAutoPunchOut();
      await flushOfflineLocations();
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
    if (!token || !appUnlocked) return;
    loadTasks();
    loadAttendance();

    let socket;
    getServerUrl().then((url) => {
      socket = io(url, { auth: { token }, transports: ['websocket', 'polling'] });
      socket.on('task:created', loadTasks);
      socket.on('task:updated', loadTasks);
      socket.on('task:deleted', loadTasks);
      socket.on('notification:assigned', (task) => {
        setNewTaskBanner(task);
        loadTasks();
      });
    });

    const pollTimer = setInterval(loadTasks, 10000);

    return () => {
      clearInterval(pollTimer);
      if (socket) socket.disconnect();
    };
  }, [token, appUnlocked, loadTasks, loadAttendance]);

  async function handleLogin(newToken, newUser) {
    await saveAuthData(newToken, newUser);
    setToken(newToken);
    setUser(newUser);
  }

  async function handleLogout() {
    if (isTracking) {
      Alert.alert('Shift Active', 'Please Punch Out with your fingerprint before signing out.');
      return;
    }
    await clearAuthData();
    setToken(null);
    setUser(null);
    setActivePunch(null);
  }

  // Full-Screen Fingerprint App Lock (Initial Setup & App Launch)
  if (!appUnlocked) {
    return (
      <SafeAreaView style={styles.lockScreen}>
        <StatusBar style="light" />
        <View style={styles.lockCard}>
          <Text style={styles.lockIcon}>👆</Text>
          <Text style={styles.lockTitle}>
            {isInitialSetup ? 'Initial Fingerprint Setup' : 'EmpTracker App Locked'}
          </Text>
          <Text style={styles.lockSub}>
            {isInitialSetup
              ? 'For security, EmpTracker requires fingerprint verification during initial setup and whenever you open the app.'
              : 'Verify your fingerprint to unlock and access your work schedule and shift tracker.'}
          </Text>

          {lockError ? <Text style={styles.lockError}>{lockError}</Text> : null}

          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={() => promptFingerprintUnlock(isInitialSetup)}
          >
            <Text style={styles.unlockBtnText}>
              {isInitialSetup ? 'Verify & Enable Fingerprint Lock' : 'Scan Fingerprint to Unlock'}
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
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
          <Text style={styles.headerTitle}>
            Hi, {user.name} {user.employee_code ? `(${user.employee_code})` : ''}
          </Text>
          {(user.unit || user.area) ? (
            <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
              {[user.unit, user.area].filter(Boolean).join(' · ')}
            </Text>
          ) : null}
          <Text style={[styles.headerSub, { color: isTracking ? '#10b981' : '#6b7280' }]}>
            {isTracking ? '● Punched In · Live Tracking' : 'Punched Out'}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={styles.logoutBtn} onPress={() => setAppUnlocked(false)}>
            <Text style={styles.logoutText}>🔒 Lock</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {newTaskBanner && (
          <TouchableOpacity
            style={styles.notifBanner}
            onPress={() => {
              setNewTaskBanner(null);
              setTab('schedule');
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.notifBannerTitle}>🔔 New Task Assigned: {newTaskBanner.title}</Text>
              <Text style={styles.notifBannerSub}>
                {new Date(newTaskBanner.scheduled_start).toLocaleString()} · Tap to view in Schedule
              </Text>
            </View>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        )}
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
  lockScreen: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    padding: 24,
  },
  lockCard: {
    backgroundColor: '#fff',
    borderRadius: 18,
    padding: 28,
    alignItems: 'center',
  },
  lockIcon: { fontSize: 48, marginBottom: 12 },
  lockTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 8, textAlign: 'center' },
  lockSub: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 20, lineHeight: 20 },
  lockError: {
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    padding: 10,
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  unlockBtn: {
    backgroundColor: '#2563eb',
    width: '100%',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
  },
  unlockBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
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
  notifBanner: {
    backgroundColor: '#2563eb',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  notifBannerTitle: { color: '#fff', fontWeight: '700', fontSize: 13 },
  notifBannerSub: { color: '#dbeafe', fontSize: 11, marginTop: 2 },
});
