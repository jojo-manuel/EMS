import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Location from 'expo-location';
import { api } from '../api';
import { startLiveTracking, stopLiveTracking } from '../locationTask';

function formatElapsed(startIso) {
  if (!startIso) return '00:00:00';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const hrs = String(Math.floor(diffSec / 3600)).padStart(2, '0');
  const mins = String(Math.floor((diffSec % 3600) / 60)).padStart(2, '0');
  const secs = String(diffSec % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
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

  useEffect(() => {
    Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ])
      .then(([hasHw, enrolled]) => setBiometricAvailable(hasHw && enrolled))
      .catch(() => setBiometricAvailable(false));
  }, []);

  useEffect(() => {
    if (!activePunch?.punch_in_at) {
      setElapsed('00:00:00');
      return;
    }
    setElapsed(formatElapsed(activePunch.punch_in_at));
    const timer = setInterval(() => {
      setElapsed(formatElapsed(activePunch.punch_in_at));
    }, 1000);
    return () => clearInterval(timer);
  }, [activePunch]);

  async function verifyFingerprint(actionLabel) {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();

    if (!hasHardware || !isEnrolled) {
      Alert.alert(
        'Fingerprint Not Set Up',
        'No fingerprint/biometrics enrolled on this device. Please enroll a fingerprint in phone settings to use biometric punch-in.'
      );
      return null;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: `Scan fingerprint to ${actionLabel}`,
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use Phone PIN',
      disableDeviceFallback: false,
    });

    if (!result.success) {
      if (result.error !== 'user_cancel') {
        Alert.alert('Authentication Failed', 'Fingerprint verification was not recognized.');
      }
      return null;
    }
    return 'fingerprint';
  }

  async function handlePunchToggle() {
    setBusy(true);
    try {
      const actionLabel = isTracking ? 'Punch Out' : 'Punch In';
      const verifiedBy = await verifyFingerprint(actionLabel);
      if (!verifiedBy) {
        setBusy(false);
        return;
      }

      if (!isTracking) {
        // 1. Request location permission & get initial coordinates
        const fg = await Location.requestForegroundPermissionsAsync();
        if (fg.status !== 'granted') {
          throw new Error('Location permission is required to Punch In and track your shift.');
        }

        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        // 2. Record Fingerprint Punch In on backend
        const res = await api.punchIn(
          pos.coords.latitude,
          pos.coords.longitude,
          pos.coords.accuracy || 0,
          verifiedBy
        );
        setActivePunch(res.record);

        // 3. Start continuous live location tracking until Punch Out
        await startLiveTracking((coords) => {
          setLastCoords({
            lat: coords.latitude,
            lng: coords.longitude,
            accuracy: coords.accuracy,
            time: new Date().toLocaleTimeString(),
          });
        });

        setIsTracking(true);
        onRefreshAttendance();
        Alert.alert('Punched In', 'Fingerprint verified! Live location tracking is now active.');
      } else {
        // 1. Grab final coordinates if available
        let lat = lastCoords?.lat ?? null;
        let lng = lastCoords?.lng ?? null;
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {}

        // 2. Stop live GPS tracking
        await stopLiveTracking();

        // 3. Record Fingerprint Punch Out on backend
        await api.punchOut(lat, lng, verifiedBy);
        setActivePunch(null);
        setIsTracking(false);
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
            ? `Punched in at ${new Date(activePunch?.punch_in_at || Date.now()).toLocaleTimeString()}. Location is tracked until you Punch Out.`
            : 'Verify your fingerprint to Punch In and automatically start live location tracking.'}
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
              Accuracy: ~{Math.round(lastCoords.accuracy || 0)}m · Synced at {lastCoords.time}
            </Text>
          </View>
        )}
      </View>

      {punchHistory && punchHistory.length > 0 && (
        <View style={[styles.card, { marginTop: 16, alignItems: 'stretch' }]}>
          <Text style={styles.historyTitle}>Recent Punches</Text>
          {punchHistory.slice(0, 5).map((item) => (
            <View key={item.id} style={styles.historyRow}>
              <View>
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
              </View>
              <Text style={styles.verifiedTag}>👆 {item.verified_by}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f3f4f6' },
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
