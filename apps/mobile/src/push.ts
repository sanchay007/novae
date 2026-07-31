import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<{
  ok: boolean;
  message: string;
  token?: string;
}> {
  if (!Device.isDevice) {
    // Simulators still get a deterministic local token so API wiring can be tested
    const fake = `ExpoPushToken[novae-sim-${Platform.OS}]`;
    try {
      await api('/safety/device-token', {
        method: 'POST',
        body: JSON.stringify({ token: fake, platform: Platform.OS }),
      });
      return {
        ok: true,
        message: 'Simulator token registered (use a device for real Expo push)',
        token: fake,
      };
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : 'Failed to register simulator token',
      };
    }
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const asked = await Notifications.requestPermissionsAsync();
    finalStatus = asked.status;
  }
  if (finalStatus !== 'granted') {
    return { ok: false, message: 'Notification permission not granted' };
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId
    ?? Constants.easConfig?.projectId;

  const tokenRes = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const token = tokenRes.data;

  await api('/safety/device-token', {
    method: 'POST',
    body: JSON.stringify({
      token,
      platform: Platform.OS,
    }),
  });

  return { ok: true, message: 'Push enabled', token };
}
