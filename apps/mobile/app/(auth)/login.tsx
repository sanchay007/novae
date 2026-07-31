import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../../src/auth';
import { colors, spacing } from '../../src/theme';

export default function LoginScreen() {
  const { requestOtp, verifyOtp } = useAuth();
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onRequest() {
    setBusy(true);
    setError('');
    try {
      const res = await requestOtp(phone);
      setStep('otp');
      if (res.debugCode) setHint(`Dev OTP: ${res.debugCode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    setBusy(true);
    setError('');
    try {
      await verifyOtp(phone, code);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.screen}
    >
      <Text style={styles.brand}>Novae</Text>
      <Text style={styles.tagline}>New spark everyday</Text>
      <Text style={styles.sub}>
        One AI match a day. Three connections at a time. Keep it intentional.
      </Text>

      {step === 'phone' ? (
        <>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="+91…"
            placeholderTextColor={colors.muted}
            autoFocus
          />
          <Pressable style={styles.cta} onPress={onRequest} disabled={busy}>
            <Text style={styles.ctaText}>{busy ? 'Sending…' : 'Continue'}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            placeholder="6-digit OTP"
            placeholderTextColor={colors.muted}
            maxLength={6}
            autoFocus
          />
          {!!hint && <Text style={styles.hint}>{hint}</Text>}
          <Pressable style={styles.cta} onPress={onVerify} disabled={busy}>
            <Text style={styles.ctaText}>{busy ? 'Verifying…' : 'Enter Novae'}</Text>
          </Pressable>
        </>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  brand: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.cream,
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 20,
    color: colors.spark,
    marginTop: spacing.xs,
    fontStyle: 'italic',
  },
  sub: {
    color: colors.muted,
    marginTop: spacing.md,
    marginBottom: spacing.xl,
    lineHeight: 22,
    maxWidth: 320,
  },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: spacing.md,
    color: colors.cream,
    fontSize: 18,
    marginBottom: spacing.md,
  },
  cta: {
    backgroundColor: colors.spark,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  ctaText: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 16,
  },
  hint: { color: colors.success, marginTop: spacing.sm },
  error: { color: colors.danger, marginTop: spacing.sm },
});
