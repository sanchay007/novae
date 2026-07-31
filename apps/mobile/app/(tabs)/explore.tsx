import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api } from '../../src/api';
import { colors, spacing } from '../../src/theme';

type Card = {
  userId: string;
  displayName: string;
  age: number;
  headline?: string;
  bio?: string;
  city?: string;
  interests: string[];
  prompts: { id: string; promptKey: string; answer: string }[];
};

export default function ExploreScreen() {
  const router = useRouter();
  const [cards, setCards] = useState<Card[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [likesBlurred, setLikesBlurred] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const feed = await api<{ cards: Card[] }>('/explore/feed');
      setCards(feed.cards);
      setIndex(0);
      const likes = await api<{ upgradeRequired: boolean }>('/explore/likes-you');
      setLikesBlurred(likes.upgradeRequired);
    } catch {
      setCards([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function swipe(action: 'like' | 'pass' | 'super_spark') {
    const card = cards[index];
    if (!card) return;
    try {
      const res = await api<{ matched?: boolean; matchId?: string; heldForSlot?: boolean }>(
        '/matches/swipe',
        {
          method: 'POST',
          body: JSON.stringify({
            targetUserId: card.userId,
            action,
            targetPromptId: card.prompts[0]?.id,
          }),
        },
      );
      if (res.matchId) router.push(`/chat/${res.matchId}`);
    } finally {
      setIndex((i) => i + 1);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.spark} />
      </View>
    );
  }

  const card = cards[index];
  if (!card) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>You're caught up on Explore</Text>
        <Pressable onPress={load}>
          <Text style={styles.link}>Refresh</Text>
        </Pressable>
        <Pressable onPress={() => router.push('/paywall')} style={{ marginTop: spacing.md }}>
          <Text style={styles.link}>
            {likesBlurred ? 'See who liked you (Plus)' : 'Manage Plus'}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.kicker}>Explore</Text>
      <Text style={styles.name}>
        {card.displayName}, {card.age}
      </Text>
      {!!card.headline && <Text style={styles.headline}>{card.headline}</Text>}
      {!!card.bio && <Text style={styles.bio}>{card.bio}</Text>}
      {card.prompts.slice(0, 2).map((p) => (
        <View key={p.id} style={styles.prompt}>
          <Text style={styles.promptKey}>{p.promptKey}</Text>
          <Text style={styles.promptAnswer}>{p.answer}</Text>
        </View>
      ))}
      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.pass]} onPress={() => swipe('pass')}>
          <Text style={styles.btnText}>Pass</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.super]} onPress={() => swipe('super_spark')}>
          <Text style={[styles.btnText, { color: colors.bg }]}>Super</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.like]} onPress={() => swipe('like')}>
          <Text style={[styles.btnText, { color: colors.bg }]}>Like</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  center: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  kicker: { color: colors.spark, letterSpacing: 2, textTransform: 'uppercase', fontSize: 12 },
  name: { color: colors.cream, fontSize: 32, fontWeight: '700', marginTop: spacing.sm },
  headline: { color: colors.spark, fontStyle: 'italic', marginTop: spacing.xs },
  bio: { color: colors.cream, marginTop: spacing.md, lineHeight: 22 },
  prompt: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
  },
  promptKey: { color: colors.muted, fontSize: 12, marginBottom: 4 },
  promptAnswer: { color: colors.cream, fontSize: 16 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: 'auto', paddingBottom: spacing.lg },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  pass: { backgroundColor: colors.surface },
  like: { backgroundColor: colors.spark },
  super: { backgroundColor: colors.sparkHot },
  btnText: { color: colors.cream, fontWeight: '700' },
  empty: { color: colors.cream, fontSize: 18, marginBottom: spacing.md },
  link: { color: colors.spark },
});
