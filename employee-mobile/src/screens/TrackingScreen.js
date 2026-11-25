import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  Dimensions,
  AppState,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import { api } from '../api';
import {
  startLiveTracking,
  stopLiveTracking,
  getOfflineLocationsQueue,
  flushOfflineLocations,
  queuePendingAutoPunchOut,
  flushPendingAutoPunchOut,
} from '../locationTask';

function formatElapsed(startIso) {
  if (!startIso) return '00:00:00';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const hrs = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const secs = String(diffSec % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

function isSplitOrOverlayLayout() {
  const win = Dimensions.get('window');
  const scr = Dimensions.get('screen');
  if (!scr.width || !scr.height) return false;
  const widthRatio = win.width / scr.width;
  const heightRatio = win.height / scr.height;
  // In split-screen, pop-up view, or floating window, window dimensions shrink relative to full screen
  return widthRatio < 0.9 || heightRatio < 0.8 || AppState.currentState !== 'active';
}

export default function TrackingScreen({
  isTracking,
  setIsTracking,
  lastCoords,
  setLastCoords,
  activePunch,
  setActivePunch,
  punchHistory,
  onRefreshAttendance,
}) {
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState('00:00:00');
  const [biometricAvailable, setBiometricAvailable] = useState(true);
  const [isOnline, setIsOnline] = useState(true);
  const [isVpnActive, setIsVpnActive] = useState(false);
  const [isOverlayMode, setIsOverlayMode] = useState(false);
  const [offlineCount, setOfflineCount] = useState(0);
  const autoPunchingOutRef = useRef(false);

  const refreshQueueCount = useCallback(async () => {
    const q = await getOfflineLocationsQueue();
    setOfflineCount(q.length);
  }, []);

  useEffect(() => {
    Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
      .then(([hasHw, enrolled]) => setBiometricAvailable(hasHw && enrolled))
      .catch(() => setBiometricAvailable(false));

    refreshQueueCount();
  }, [refreshQueueCount]);

  // Monitor network state (Online/Offline + VPN detection) & auto-upload offline queue when back online
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const connected = Boolean(state.isConnected);
      setIsOnline(connected);
      setIsVpnActive(state.type === 'vpn');

      if (connected) {
        const flushedPunchOut = await flushPendingAutoPunchOut();
        const syncedPts = await flushOfflineLocations();
        await refreshQueueCount();
        if (flushedPunchOut || syncedPts > 0) {
          onRefreshAttendance();
        }
      } else {
        await refreshQueueCount();
      }
    });

    return () => unsubscribe();
  }, [onRefreshAttendance, refreshQueueCount]);

  // Monitor window dimensions for split-screen / floating overlay layout changes
  useEffect(() => {
    setIsOverlayMode(isSplitOrOverlayLayout());
    const sub = Dimensions.addEventListener('change', () => {
      setIsOverlayMode(isSplitOrOverlayLayout());
    });
    return () => sub?.remove?.();
  }, []);

  // Shift elapsed timer
  useEffect(() => {
    if (!activePunch?.punch_in_at) {
      setElapsed('00:00:00');
      return;
    }
    setElapsed(formatElapsed(activePunch.punch_in_at));
    const timer = setInterval(() => {
      setElapsed(formatElapsed(activePunch.punch_in_at));
      refreshQueueCount();
    }, 1000);
    return () => clearInterval(timer);
  }, [activePunch, refreshQueueCount]);

  // Watchdog: Auto Punch-Out immediately if employee turns off GPS while punched in
  useEffect(() => {
    if (!isTracking) return;

    const gpsWatchdog = setInterval(async () => {
      if (autoPunchingOutRef.current) return;
      try {
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        const provider = await Location.getProviderStatusAsync();
        const gpsOff = !servicesEnabled || provider.gpsAvailable === false;

        if (gpsOff) {
          autoPunchingOutRef.current = true;
          const lat = lastCoords?.lat ?? null;
          const lng = lastCoords?.lng ?? null;
          const reason = 'Auto punch-out: Employee turned off GPS';

          await stopLiveTracking();
          setIsTracking(false);
          setActivePunch(null);

          try {
            await api.punchOut(lat, lng, 'auto_gps_off', reason, new Date().toISOString());
            onRefreshAttendance();
          } catch {
            // If offline when GPS was turned off, queue auto punch-out for upload when back online
            await queuePendingAutoPunchOut(lat, lng, reason);
          }

          Alert.alert(
            'Auto Punched Out (GPS Turned Off)',
            'You turned off GPS Location Services, so your shift was automatically punched out.'
          );
          autoPunchingOutRef.current = false;
        }
      } catch {
        autoPunchingOutRef.current = false;
      }
    }, 3000);

    return () => clearInterval(gpsWatchdog);
  }, [isTracking, lastCoords, onRefreshAttendance, setActivePunch, setIsTracking]);

  async function verifyFingerprint(actionLabel) {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      Alert.alert(
        'Fingerprint Required',
        'No fingerprint enrolled on this device. Please enroll a fingerprint in your phone settings.'
      );
      return null;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Scan fingerprint to ${actionLabel}`,
      cancelLabel: 'Cancel',
      disableDeviceFallback: true,
    });

    if (!result.success) {
      if (result.error !== 'user_cancel') {
        Alert.alert('Fingerprint Failed', 'Fingerprint verification was not recognized.');
      }
      return null;
    }
    return 'fingerprint';
  }

  async function handlePunchToggle() {
    setBusy(true);
    try {
      if (!isTracking) {
        // 1. Block Punch-In if Split-Screen / Floating Window ("other app layout") is active
        if (isSplitOrOverlayLayout()) {
          Alert.alert(
            'Punch-In Blocked (App Layout)',
            'Split-screen or floating overlay window detected. Please switch EmpTracker to full-screen mode before punching in.'
          );
          setBusy(false);
          return;
        }

        // 2. Block Punch-In if VPN is active
        const netState = await NetInfo.fetch();
        if (netState.type === 'vpn') {
          Alert.alert(
            'Punch-In Blocked (VPN Detected)',
            'An active VPN connection was detected. Please turn off your VPN before punching in.'
          );
          setBusy(false);
          return;
        }
        if (!netState.isConnected) {
          Alert.alert(
            'Internet Required to Punch In',
            'Please connect to the internet to Punch In. Once punched in, location tracking will work offline too.'
          );
          setBusy(false);
          return;
        }

        // 3. Check GPS is enabled before Punch-In
        const servicesEnabled = await Location.hasServicesEnabledAsync();
        if (!servicesEnabled) {
          Alert.alert(
            'GPS Required',
            'Please turn on GPS Location Services before punching in.'
          );
          setBusy(false);
          return;
        }

        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted') {
          throw new Error('Location permission is required to Punch In and track your shift.');
        }

        // 4. Verify Fingerprint
        const verifiedBy = await verifyFingerprint('Punch In');
        if (!verifiedBy) {
          setBusy(false);
          return;
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

        // 5. Block Punch-In if Mock / Fake GPS app is active
        if (pos.mocked) {
          Alert.alert(
            'Punch-In Blocked (Mock GPS)',
            'Fake GPS / Mock Location app detected. Disable mock locations to Punch In.'
          );
          setBusy(false);
          return;
        }

        // 6. Send Punch-In with security checks to backend
        const res = await api.punchIn(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy || 0,
          verifiedBy,
          {
            is_vpn: netState.type === 'vpn',
            is_mock_location: Boolean(pos.mocked),
            is_overlay_layout: isSplitOrOverlayLayout(),
          }
        );
        setActivePunch(res.record);

        // 7. Start continuous live location tracking (online + offline queue) until Punch Out
        await startLiveTracking((coords) => {
          setLastCoords({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy,
            time: new Date().toLocaleTimeString(),
          });
          refreshQueueCount();
        });

        setIsTracking(true);
        onRefreshAttendance();
        Alert.alert('Punched In', 'Fingerprint verified! Live location tracking is now active.');
      } else {
        // Manual Fingerprint Punch Out
        const verifiedBy = await verifyFingerprint('Punch Out');
        if (!verifiedBy) {
          setBusy(false);
          return;
        }

        let lat = lastCoords?.lat ?? null;
        let lng = lastCoords?.lng ?? null;
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {}

        await stopLiveTracking();
        await flushOfflineLocations();
        await api.punchOut(lat, lng, verifiedBy, 'Manual fingerprint punch-out');
        setActivePunch(null);
        setIsTracking(false);
        await refreshQueueCount();
        onRefreshAttendance();
        Alert.alert('Punched Out', 'Shift ended and live location tracking has stopped.');
      }
    } catch (err) {
      Alert.alert('Punch Error', err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 36 }}>
      {/* Security & Connectivity Status Bar */}
      <View style={styles.securityBar}>
        <View style={[styles.pill, { backgroundColor: isOnline ? '#d1fae5' : '#fef3c7' }]}>
          <Text style={{ fontSize: 11, fontWeight: '700', color: isOnline ? '#065f46' : '#92400e' }}>
            {isOnline ? '● Online' : '● Offline Mode (Queueing GPS)'}
          </Text>
        </View>
        {offlineCount > 0 && (
          <View style={[styles.pill, { backgroundColor: '#dbeafe' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#1e40af' }}>
              📦 {offlineCount} offline GPS pts queued
            </Text>
          </View>
        )}
        {isVpnActive && (
          <View style={[styles.pill, { backgroundColor: '#fee2e2' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#991b1b' }}>
              🚫 VPN Active (Punch-In Blocked)
            </Text>
          </View>
        )}
        {isOverlayMode && (
          <View style={[styles.pill, { backgroundColor: '#fee2e2' }]}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#991b1b' }}>
              🚫 Split/Overlay Layout Blocked
            </Text>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <View style={[styles.badge, { backgroundColor: isTracking ? '#d1fae5' : '#f3f4f6' }]}>
          <View style={[styles.dot, { backgroundColor: isTracking ? '#10b981' : '#9ca3af' }]} />
          <Text style={[styles.badgeText, { color: isTracking ? '#065f46' : '#4b5563' }]}>
            {isTracking ? 'PUNCHED IN · LIVE TRACKING' : 'PUNCHED OUT · SHIFT OFFLINE'}
          </Text>
        </View>

        <Text style={styles.timer}>{elapsed}</Text>
        <Text style={styles.statusSub}>
          {isTracking
            ? `Punched in at ${new Date(activePunch?.punch_in_at || Date.now()).toLocaleTimeString()}. Turning off GPS will automatically punch you out.`
            : 'Scan fingerprint to Punch In (requires full-screen layout, no VPN, and GPS enabled).'}
        </Text>

        <TouchableOpacity
          style={[styles.mainBtn, { backgroundColor: isTracking ? '#ef4444' : '#10b981' }]}
          onPress={handlePunchToggle}
          disabled={busy}
        >
          <Text style={styles.mainBtnText}>
            {busy
              ? 'Verifying...'
              : isTracking
              ? '👆 Fingerprint Punch Out'
              : '👆 Fingerprint Punch In'}
          </Text>
        </TouchableOpacity>

        {!biometricAvailable && (
          <Text style={styles.warnText}>
            ⚠ Fingerprint hardware/enrollment not detected on this device.
          </Text>
        )}

        {lastCoords && (
          <View style={styles.coordsBox}>
            <Text style={styles.coordsLabel}>Live GPS Coordinates</Text>
            <Text style={styles.coordsVal}>
              {lastCoords.lat.toFixed(6)}, {lastCoords.lng.toFixed(6)}
            </Text>
            <Text style={styles.coordsMeta}>
              Accuracy: ~{Math.round(lastCoords.accuracy || 0)}m · Captured at {lastCoords.time}
            </Text>
          </View>
        )}
      </View>

      {punchHistory && punchHistory.length > 0 && (
        <View style={[styles.card, { marginTop: 16, alignItems: 'stretch' }]}>
          <Text style={styles.historyTitle}>Recent Punches</Text>
          {punchHistory.slice(0, 5).map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.historyDate}>
                  {new Date(item.punch_in_at).toLocaleDateString()}
                </Text>
                <Text style={styles.historyTimes}>
                  In: {new Date(item.punch_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {'  ·  '}
                  Out:{' '}
                  {item.punch_out_at
                    ? new Date(item.punch_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : 'Active'}
                </Text>
                {item.punch_out_reason ? (
                  <Text style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>
                    {item.punch_out_reason}
                  </Text>
                ) : null}
              </View>
              <Text
                style={[
                  styles.verifiedTag,
                  item.verified_by === 'auto_gps_off' && {
                    backgroundColor: '#fef3c7',
                    color: '#92400e',
                  },
                ]}
              >
                {item.verified_by === 'auto_gps_off' ? '⚠ GPS Off' : `👆 ${item.verified_by}`}
              </Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
  securityBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 14,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  timer: { fontSize: 38, fontWeight: '800', color: '#111827', letterSpacing: 1, marginBottom: 8 },
  statusSub: { fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: 20 },
  mainBtn: { width: '100%', paddingVertical: 16, borderRadius: 12, alignItems: 'center' },
  mainBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  warnText: { marginTop: 12, fontSize: 12, color: '#b45309', textAlign: 'center' },
  coordsBox: {
    marginTop: 20,
    width: '100%',
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  coordsLabel: { fontSize: 12, fontWeight: '600', color: '#6b7280' },
  coordsVal: { fontSize: 15, fontWeight: '700', color: '#111827', marginTop: 4 },
  coordsMeta: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  historyTitle: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 10 },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderColor: '#f3f4f6',
  },
  historyDate: { fontSize: 13, fontWeight: '600', color: '#111827' },
  historyTimes: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  verifiedTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1e40af',
    backgroundColor: '#dbeafe',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    textTransform: 'capitalize',
  },
});
