import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { api, getToken, API_URL } from '../../src/api';
import { colors, spacing } from '../../src/theme';

export default function OnboardingScreen() {
  const router = useRouter();
  const [status, setStatus] = useState('');

  async function verifyPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setStatus('Camera permission required');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (shot.canceled || !shot.assets[0]) return;

    const token = await getToken();
    const form = new FormData();
    form.append('file', {
      uri: shot.assets[0].uri,
      name: 'verify.jpg',
      type: 'image/jpeg',
    } as unknown as Blob);

    const res = await fetch(`${API_URL}/profiles/me/verify-photo`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (!res.ok) {
      setStatus('Verification upload failed');
      return;
    }
    setStatus('Verified ✓');
  }

  async function boost() {
    await api('/billing/dev/grant', {
      method: 'POST',
      body: JSON.stringify({ boost: true }),
    });
    setStatus('Boost activated for 30 minutes');
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Trust & boosts</Text>
      <Text style={styles.sub}>
        Photo verification unlocks a badge. Boosts raise you in Explore for 30 minutes.
      </Text>
      <Pressable style={styles.cta} onPress={verifyPhoto}>
        <Text style={styles.ctaText}>Take verification selfie</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={boost}>
        <Text style={styles.link}>Dev: activate boost</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.back()}>
        <Text style={styles.link}>Done</Text>
      </Pressable>
      {!!status && <Text style={styles.status}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg, justifyContent: 'center' },
  title: { color: colors.cream, fontSize: 28, fontWeight: '700' },
  sub: { color: colors.muted, marginVertical: spacing.md, lineHeight: 22 },
  cta: {
    backgroundColor: colors.spark,
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaText: { color: colors.bg, fontWeight: '700' },
  secondary: { paddingVertical: spacing.md },
  link: { color: colors.spark },
  status: { color: colors.success, marginTop: spacing.md },
});
