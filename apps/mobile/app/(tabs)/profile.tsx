import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { PROMPT_CATALOG } from '@novae/shared';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { colors, spacing } from '../../src/theme';

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [interests, setInterests] = useState('');
  const [promptKey, setPromptKey] = useState(PROMPT_CATALOG[0].key);
  const [promptAnswer, setPromptAnswer] = useState('');
  const [dateIdeas, setDateIdeas] = useState('coffee,walk,dinner');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [status, setStatus] = useState('');
  const [friendInvite, setFriendInvite] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api<{
        profile: {
          display_name?: string;
          headline?: string;
          bio?: string;
          city?: string;
          interests?: string[];
          date_ideas?: string[];
        };
        prompts: { prompt_key: string; answer: string }[];
      }>('/profiles/me');
      setDisplayName(me.profile?.display_name ?? '');
      setHeadline(me.profile?.headline ?? '');
      setBio(me.profile?.bio ?? '');
      setCity(me.profile?.city ?? '');
      setInterests((me.profile?.interests ?? []).join(', '));
      setDateIdeas((me.profile?.date_ideas ?? ['coffee', 'walk']).join(','));
      if (me.prompts[0]) {
        setPromptKey(me.prompts[0].prompt_key);
        setPromptAnswer(me.prompts[0].answer);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function save() {
    setStatus('Saving…');
    await api('/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName,
        headline,
        bio,
        city,
        interests: interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        dateIdeas: dateIdeas
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3),
        birthDate: '1998-06-15',
        gender: 'woman',
        intent: 'long_term',
        latitude: 12.97,
        longitude: 77.59,
      }),
    });
    await api('/profiles/me/prompts', {
      method: 'PUT',
      body: JSON.stringify({
        prompts: promptAnswer
          ? [{ promptKey, answer: promptAnswer, sortOrder: 0 }]
          : [],
      }),
    });
    await api('/profiles/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        genders: ['man', 'woman', 'non_binary'],
        minAge: 21,
        maxAge: 40,
        maxDistanceKm: 40,
      }),
    });
    setStatus('Saved');
  }

  async function saveEmergency() {
    await api('/safety/emergency-contact', {
      method: 'PUT',
      body: JSON.stringify({ name: emergencyName, phone: emergencyPhone }),
    });
    setStatus('Emergency contact saved');
  }

  async function inviteFriend() {
    const res = await api<{ shareUrl: string }>('/friend-sparks/invite', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setFriendInvite(res.shareUrl);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.spark} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={styles.title}>Your profile</Text>
      <Field label="Name" value={displayName} onChangeText={setDisplayName} />
      <Field label="Headline" value={headline} onChangeText={setHeadline} />
      <Field label="Bio" value={bio} onChangeText={setBio} multiline />
      <Field label="City" value={city} onChangeText={setCity} />
      <Field label="Interests (comma-separated)" value={interests} onChangeText={setInterests} />
      <Field label="Date ideas (coffee,walk,dinner…)" value={dateIdeas} onChangeText={setDateIdeas} />
      <Text style={styles.label}>Prompt: {promptKey}</Text>
      <TextInput
        style={[styles.input, { minHeight: 80 }]}
        value={promptAnswer}
        onChangeText={setPromptAnswer}
        placeholderTextColor={colors.muted}
        placeholder="Your answer"
        multiline
      />
      <Pressable style={styles.cta} onPress={save}>
        <Text style={styles.ctaText}>Save profile</Text>
      </Pressable>

      <Text style={[styles.title, { marginTop: spacing.xl }]}>Safety</Text>
      <Field label="Emergency contact name" value={emergencyName} onChangeText={setEmergencyName} />
      <Field label="Emergency phone" value={emergencyPhone} onChangeText={setEmergencyPhone} />
      <Pressable style={styles.secondary} onPress={saveEmergency}>
        <Text style={styles.secondaryText}>Save emergency contact</Text>
      </Pressable>

      <Text style={[styles.title, { marginTop: spacing.xl }]}>Friend's Spark</Text>
      <Pressable style={styles.secondary} onPress={inviteFriend}>
        <Text style={styles.secondaryText}>Create invite link</Text>
      </Pressable>
      {!!friendInvite && <Text style={styles.meta}>{friendInvite}</Text>}

      <Pressable style={styles.secondary} onPress={() => router.push('/paywall')}>
        <Text style={styles.secondaryText}>Novae Plus / Sparks</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => router.push('/onboarding')}>
        <Text style={styles.secondaryText}>Photo verification</Text>
      </Pressable>
      <Pressable
        style={styles.secondary}
        onPress={async () => {
          await signOut();
        }}
      >
        <Text style={[styles.secondaryText, { color: colors.danger }]}>Sign out</Text>
      </Pressable>
      {!!status && <Text style={styles.meta}>{status}</Text>}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { minHeight: 90 }]}
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.muted}
        multiline={multiline}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center' },
  title: { color: colors.cream, fontSize: 24, fontWeight: '700', marginBottom: spacing.md },
  label: { color: colors.muted, marginBottom: 6 },
  input: {
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.cream,
  },
  cta: {
    backgroundColor: colors.spark,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  ctaText: { color: colors.bg, fontWeight: '700' },
  secondary: { paddingVertical: spacing.md },
  secondaryText: { color: colors.spark },
  meta: { color: colors.muted, marginTop: spacing.sm },
});
