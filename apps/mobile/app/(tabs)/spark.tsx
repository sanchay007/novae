import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { colors, spacing } from '../../src/theme';

type SparkResponse = {
  sparkId?: string;
  status?: string;
  whyMatched?: string[];
  expiresAt?: string;
  acceptedByMe?: boolean;
  slotsRemaining?: number;
  isPaidExtra?: boolean;
  kind?: 'daily' | 'extra';
  extrasPending?: number;
  profile?: {
    displayName: string;
    age: number;
    headline?: string;
    bio?: string;
    city?: string;
    interests: string[];
    dateIdeas?: string[];
    verified?: boolean;
  };
  message?: string;
  spark?: null;
};

export default function SparkScreen() {
  const router = useRouter();
  const [data, setData] = useState<SparkResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api<SparkResponse>('/sparks/today');
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Spark');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function decide(accept: boolean) {
    if (!data?.sparkId) return;
    setActing(true);
    try {
      const res = await api<{ status: string; matchId?: string; message?: string }>(
        '/sparks/decide',
        {
          method: 'POST',
          body: JSON.stringify({ sparkId: data.sparkId, accept }),
        },
      );
      if (res.matchId) router.push(`/chat/${res.matchId}`);
      else await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setActing(false);
    }
  }

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.spark} />
      </View>
    );
  }

  if (!data?.profile) {
    return (
      <ScrollView
        contentContainerStyle={styles.center}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.spark} />}
      >
        <Text style={styles.brandMark}>✦</Text>
        <Text style={styles.emptyTitle}>Your Daily Spark is brewing</Text>
        <Text style={styles.emptySub}>
          {data?.message
            ?? 'Come back at noon — one curated introduction, every day.'}
        </Text>
        <Text style={styles.slots}>
          Slots open: {data?.slotsRemaining ?? '—'} / 3
        </Text>
        <Pressable style={styles.secondary} onPress={() => router.push('/paywall')}>
          <Text style={styles.secondaryText}>Need another Spark?</Text>
        </Pressable>
        {!!error && <Text style={styles.error}>{error}</Text>}
      </ScrollView>
    );
  }

  const p = data.profile;
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.spark} />}
    >
      <Text style={styles.kicker}>
        {data.kind === 'extra' ? 'Extra Spark' : "Today's Spark"}
        {data.isPaidExtra ? ' · paid' : ''}
      </Text>
      {!!data.extrasPending && data.extrasPending > 0 && data.kind !== 'extra' && (
        <Text style={styles.meta}>{data.extrasPending} Extra Spark(s) waiting after this</Text>
      )}
      <Text style={styles.name}>
        {p.displayName}, {p.age}
        {p.verified ? ' ✓' : ''}
      </Text>
      {!!p.headline && <Text style={styles.headline}>{p.headline}</Text>}
      {!!p.city && <Text style={styles.meta}>{p.city}</Text>}
      {!!p.bio && <Text style={styles.bio}>{p.bio}</Text>}

      <View style={styles.whyBox}>
        <Text style={styles.whyTitle}>Why you matched</Text>
        {(data.whyMatched ?? []).map((w) => (
          <Text key={w} style={styles.whyItem}>
            · {w}
          </Text>
        ))}
      </View>

      {!!p.interests?.length && (
        <Text style={styles.meta}>Interests: {p.interests.join(' · ')}</Text>
      )}
      {!!p.dateIdeas?.length && (
        <Text style={styles.meta}>Date ideas: {p.dateIdeas.join(', ')}</Text>
      )}

      <Text style={styles.slots}>Match slots left: {data.slotsRemaining ?? 0} / 3</Text>

      {data.acceptedByMe ? (
        <Text style={styles.waiting}>Waiting for them to accept…</Text>
      ) : (
        <View style={styles.row}>
          <Pressable
            style={[styles.btn, styles.pass]}
            onPress={() => decide(false)}
            disabled={acting}
          >
            <Text style={styles.btnText}>Pass</Text>
          </Pressable>
          <Pressable
            style={[styles.btn, styles.accept]}
            onPress={() => decide(true)}
            disabled={acting}
          >
            <Text style={[styles.btnText, { color: colors.bg }]}>Accept</Text>
          </Pressable>
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: {
    flexGrow: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  brandMark: { fontSize: 48, color: colors.spark, marginBottom: spacing.md },
  emptyTitle: { color: colors.cream, fontSize: 24, fontWeight: '700', textAlign: 'center' },
  emptySub: {
    color: colors.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  kicker: { color: colors.spark, textTransform: 'uppercase', letterSpacing: 2, fontSize: 12 },
  name: { color: colors.cream, fontSize: 36, fontWeight: '700', marginTop: spacing.sm },
  headline: { color: colors.spark, fontSize: 18, marginTop: spacing.xs, fontStyle: 'italic' },
  bio: { color: colors.cream, marginTop: spacing.md, lineHeight: 22 },
  meta: { color: colors.muted, marginTop: spacing.sm },
  whyBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
  },
  whyTitle: { color: colors.cream, fontWeight: '700', marginBottom: spacing.sm },
  whyItem: { color: colors.muted, marginBottom: 4 },
  slots: { color: colors.muted, marginTop: spacing.lg },
  waiting: { color: colors.success, marginTop: spacing.lg, fontWeight: '600' },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  btn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  pass: { backgroundColor: colors.surface },
  accept: { backgroundColor: colors.spark },
  btnText: { color: colors.cream, fontWeight: '700' },
  secondary: { marginTop: spacing.lg, padding: spacing.md },
  secondaryText: { color: colors.spark },
  error: { color: colors.danger, marginTop: spacing.md },
});
