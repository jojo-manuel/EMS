import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SERVER_URL_KEY = 'emptracker_server_url';
const TOKEN_KEY = 'emptracker_token';
const USER_KEY = 'emptracker_user';

export const DEFAULT_API_URL = 'http://192.168.1.12:4000';

export async function getServerUrl() {
  const saved = await AsyncStorage.getItem(SERVER_URL_KEY);
  if (!saved || saved.includes('10.0.2.2')) {
    return DEFAULT_API_URL;
  }
  return saved;
}

export async function setServerUrl(url) {
  const cleaned = url.trim().replace(/\/+$/, '');
  await AsyncStorage.setItem(SERVER_URL_KEY, cleaned);
  return cleaned;
}

export async function getAuthData() {
  const [token, userJson] = await Promise.all([
    AsyncStorage.getItem(TOKEN_KEY),
    AsyncStorage.getItem(USER_KEY),
  ]);
  return {
    token,
    user: userJson ? JSON.parse(userJson) : null,
  };
}

export async function saveAuthData(token, user) {
  await Promise.all([
    AsyncStorage.setItem(TOKEN_KEY, token),
    AsyncStorage.setItem(USER_KEY, JSON.stringify(user)),
  ]);
}

export async function clearAuthData() {
  await Promise.all([
    AsyncStorage.removeItem(TOKEN_KEY),
    AsyncStorage.removeItem(USER_KEY),
  ]);
}
