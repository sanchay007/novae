import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { colors, spacing } from '../../src/theme';

type MatchItem = {
  matchId: string;
  whyMatched: string[];
  other: { displayName: string; age: number; headline?: string };
  lastMessageAt?: string;
};

export default function MatchesScreen() {
  const router = useRouter();
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [slots, setSlots] = useState(3);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api<{ matches: MatchItem[]; slotsRemaining: number }>('/matches');
      setMatches(res.matches);
      setSlots(res.slotsRemaining);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.spark} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.slots}>{slots} of 3 match slots open</Text>
      <FlatList
        data={matches}
        keyExtractor={(item) => item.matchId}
        ListEmptyComponent={
          <Text style={styles.empty}>No active matches — your next Spark awaits.</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => router.push(`/chat/${item.matchId}`)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>
                {item.other.displayName}, {item.other.age}
              </Text>
              <Text style={styles.sub} numberOfLines={1}>
                {item.other.headline || item.whyMatched[0] || 'Say hello'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  slots: { color: colors.muted, marginBottom: spacing.md, paddingHorizontal: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  name: { color: colors.cream, fontWeight: '700', fontSize: 17 },
  sub: { color: colors.muted, marginTop: 4 },
  chevron: { color: colors.spark, fontSize: 28 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: spacing.xxl },
});
