import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api } from './api';

export const BACKGROUND_LOCATION_TASK = 'emptracker-background-location';
const OFFLINE_QUEUE_KEY = 'emptracker_offline_locations_queue';
const PENDING_PUNCHOUT_KEY = 'emptracker_pending_auto_punchout';

export async function getOfflineLocationsQueue() {
  try {
    const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function enqueueOfflineLocation(lat, lng, accuracy = 0) {
  const queue = await getOfflineLocationsQueue();
  queue.push({
    lat,
    lng,
    accuracy,
    recorded_at: new Date().toISOString(),
  });
  // Keep up to 1000 points
  const trimmed = queue.slice(-1000);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(trimmed));
  return trimmed.length;
}

export async function flushOfflineLocations() {
  const queue = await getOfflineLocationsQueue();
  if (queue.length === 0) return 0;

  const net = await NetInfo.fetch();
  if (!net.isConnected) return 0;

  try {
    await api.sendLocationBatch(queue);
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
    return queue.length;
  } catch {
    return 0;
  }
}

export async function queuePendingAutoPunchOut(lat, lng, reason) {
  const payload = {
    lat,
    lng,
    verified_by: 'auto_gps_off',
    reason,
    punch_out_at: new Date().toISOString(),
  };
  await AsyncStorage.setItem(PENDING_PUNCHOUT_KEY, JSON.stringify(payload));
}

export async function flushPendingAutoPunchOut() {
  try {
    const raw = await AsyncStorage.getItem(PENDING_PUNCHOUT_KEY);
    if (!raw) return false;
    const net = await NetInfo.fetch();
    if (!net.isConnected) return false;

    const payload = JSON.parse(raw);
    await api.punchOut(
      payload.lat,
      payload.lng,
      payload.verified_by,
      payload.reason,
      payload.punch_out_at
    );
    await AsyncStorage.removeItem(PENDING_PUNCHOUT_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function recordOrSyncLocation(lat, lng, accuracy = 0) {
  const net = await NetInfo.fetch();
  if (!net.isConnected) {
    await enqueueOfflineLocation(lat, lng, accuracy);
    return { synced: false, queued: true };
  }

  try {
    await flushOfflineLocations();
    await api.sendLocation(lat, lng, accuracy);
    return { synced: true, queued: false };
  } catch {
    await enqueueOfflineLocation(lat, lng, accuracy);
    return { synced: false, queued: true };
  }
}

// Handles GPS updates even when the app is backgrounded or screen is locked (online or offline)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  const latest = locations && locations[0];
  if (!latest) return;

  await recordOrSyncLocation(
    latest.coords.latitude,
    latest.coords.longitude,
    latest.coords.accuracy || 0
  );
});

let foregroundSubscription = null;

export async function startLiveTracking(onLocationUpdate) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    throw new Error('Location permission is required to start live tracking.');
  }

  const initial = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  await recordOrSyncLocation(
    initial.coords.latitude,
    initial.coords.longitude,
    initial.coords.accuracy || 0
  );
  if (onLocationUpdate) onLocationUpdate(initial.coords);

  if (foregroundSubscription) {
    foregroundSubscription.remove();
  }
  foregroundSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 20,
    },
    async (loc) => {
      await recordOrSyncLocation(
        loc.coords.latitude,
        loc.coords.longitude,
        loc.coords.accuracy || 0
      );
      if (onLocationUpdate) onLocationUpdate(loc.coords);
    }
  );

  const bg = await Location.requestBackgroundPermissionsAsync();
  if (bg.status === 'granted') {
    const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(
      BACKGROUND_LOCATION_TASK
    );
    if (!alreadyStarted) {
      await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 15000,
        distanceInterval: 20,
        foregroundService: {
          notificationTitle: 'EmpTracker Live Shift Active',
          notificationBody: 'Tracking location (works offline & syncs when online).',
        },
      });
    }
  }
}

export async function stopLiveTracking() {
  if (foregroundSubscription) {
    foregroundSubscription.remove();
    foregroundSubscription = null;
  }

  const started = await Location.hasStartedLocationUpdatesAsync(
    BACKGROUND_LOCATION_TASK
  ).catch(() => false);
  if (started) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  try {
    await api.stopTracking();
  } catch {
    // Ignore network error if stopping while offline
  }
}
