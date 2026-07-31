import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { api } from '../../src/api';
import { purchaseExtraSparkPack, purchasePlus } from '../../src/purchases';
import { colors, spacing } from '../../src/theme';

export default function PaywallScreen() {
  const router = useRouter();
  const [products, setProducts] = useState<
    { id: string; title: string; benefits: string[] }[]
  >([]);
  const [entitlements, setEntitlements] = useState<{
    is_plus?: boolean;
    extra_sparks?: number;
  }>({});
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [prods, ents] = await Promise.all([
      api<{ products: typeof products }>('/billing/products'),
      api<{ is_plus?: boolean; extra_sparks?: number }>('/billing/entitlements'),
    ]);
    setProducts(prods.products);
    setEntitlements(ents);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  async function unlockPlus() {
    setBusy(true);
    setStatus('');
    try {
      const result = await purchasePlus(() =>
        api('/billing/dev/grant', {
          method: 'POST',
          body: JSON.stringify({ plus: true, extraSparks: 3 }),
        }),
      );
      await refresh();
      setStatus(result.message);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      setBusy(false);
    }
  }

  async function buyExtraSpark() {
    setBusy(true);
    setStatus('');
    try {
      const result = await purchaseExtraSparkPack(() =>
        api('/billing/dev/grant', {
          method: 'POST',
          body: JSON.stringify({ extraSparks: 1 }),
        }),
      );
      if (result.ok) {
        await api('/sparks/extra', { method: 'POST', body: JSON.stringify({}) });
      }
      await refresh();
      setStatus(
        result.ok
          ? `${result.message} Worker will assign your Extra Spark shortly.`
          : result.message,
      );
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Purchase failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Novae Plus</Text>
      <Text style={styles.sub}>
        Pay for speed and visibility — never for the right to belong.
      </Text>
      <Text style={styles.meta}>
        Status: {entitlements.is_plus ? 'Plus' : 'Free'} · Extra Sparks:{' '}
        {entitlements.extra_sparks ?? 0}
      </Text>
      {products.map((p) => (
        <View key={p.id} style={styles.card}>
          <Text style={styles.cardTitle}>{p.title}</Text>
          {p.benefits.map((b) => (
            <Text key={b} style={styles.benefit}>
              · {b}
            </Text>
          ))}
        </View>
      ))}
      <Pressable style={styles.cta} onPress={unlockPlus} disabled={busy}>
        <Text style={styles.ctaText}>
          {busy ? 'Working…' : 'Unlock Plus'}
        </Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={buyExtraSpark} disabled={busy}>
        <Text style={styles.link}>Buy Extra Spark</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.back()}>
        <Text style={styles.link}>Close</Text>
      </Pressable>
      {!!status && <Text style={styles.status}>{status}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  title: { color: colors.cream, fontSize: 32, fontWeight: '700', marginTop: spacing.xl },
  sub: { color: colors.muted, marginVertical: spacing.md, lineHeight: 22 },
  meta: { color: colors.spark, marginBottom: spacing.md },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 14,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  cardTitle: { color: colors.cream, fontWeight: '700', marginBottom: 6 },
  benefit: { color: colors.muted },
  cta: {
    backgroundColor: colors.spark,
    padding: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  ctaText: { color: colors.bg, fontWeight: '700' },
  secondary: { paddingVertical: spacing.md },
  link: { color: colors.spark },
  status: { color: colors.success, marginTop: spacing.sm },
});
