import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { api } from './api';

export const BACKGROUND_LOCATION_TASK = 'emptracker-background-location';

// Handles GPS updates even when the app is backgrounded or screen is locked
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const { locations } = data;
  const latest = locations && locations[0];
  if (!latest) return;

  try {
    await api.sendLocation(
      latest.coords.latitude,
      latest.coords.longitude,
      latest.coords.accuracy || 0
    );
  } catch (err) {
    console.warn('Background location sync failed:', err.message);
  }
});

let foregroundSubscription = null;

export async function startLiveTracking(onLocationUpdate) {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    throw new Error('Location permission is required to start live tracking.');
  }

  // Send immediate initial position
  const initial = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });
  await api.sendLocation(
    initial.coords.latitude,
    initial.coords.longitude,
    initial.coords.accuracy || 0
  );
  if (onLocationUpdate) onLocationUpdate(initial.coords);

  // Foreground watcher for instant UI feedback
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
      try {
        await api.sendLocation(
          loc.coords.latitude,
          loc.coords.longitude,
          loc.coords.accuracy || 0
        );
        if (onLocationUpdate) onLocationUpdate(loc.coords);
      } catch (err) {
        console.warn('Foreground location sync failed:', err.message);
      }
    }
  );

  // Also enable background tracking if permission is granted
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
          notificationBody: 'Sharing your live location with your admin.',
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

  await api.stopTracking();
}
