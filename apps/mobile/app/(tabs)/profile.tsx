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
import * as Location from 'expo-location';
import { GENDERS, PROMPT_CATALOG, RELATIONSHIP_INTENTS } from '@novae/shared';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { registerForPushNotifications } from '../../src/push';
import { colors, spacing } from '../../src/theme';

const GENDER_LABELS: Record<(typeof GENDERS)[number], string> = {
  woman: 'Woman',
  man: 'Man',
  non_binary: 'Non-binary',
  other: 'Other',
};

const INTENT_LABELS: Record<(typeof RELATIONSHIP_INTENTS)[number], string> = {
  long_term: 'Long-term',
  long_term_open: 'Long-term, open',
  short_term_open: 'Short-term, open',
  short_term: 'Short-term',
  figuring_out: 'Figuring it out',
};

function formatBirthDate(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export default function ProfileScreen() {
  const { signOut } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [city, setCity] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<(typeof GENDERS)[number]>('woman');
  const [intent, setIntent] =
    useState<(typeof RELATIONSHIP_INTENTS)[number]>('long_term');
  const [interests, setInterests] = useState('');
  const [promptKey, setPromptKey] = useState(PROMPT_CATALOG[0].key);
  const [promptAnswer, setPromptAnswer] = useState('');
  const [dateIdeas, setDateIdeas] = useState('coffee,walk,dinner');
  const [prefGenders, setPrefGenders] = useState<(typeof GENDERS)[number][]>([
    'man',
    'woman',
  ]);
  const [minAge, setMinAge] = useState('21');
  const [maxAge, setMaxAge] = useState('40');
  const [maxDistanceKm, setMaxDistanceKm] = useState('40');
  const [latitude, setLatitude] = useState('12.97');
  const [longitude, setLongitude] = useState('77.59');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [status, setStatus] = useState('');
  const [friendInvite, setFriendInvite] = useState('');
  const [pushStatus, setPushStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api<{
        profile: {
          display_name?: string;
          headline?: string;
          bio?: string;
          city?: string;
          birth_date?: string;
          gender?: string;
          intent?: string;
          interests?: string[];
          date_ideas?: string[];
          latitude?: number;
          longitude?: number;
        };
        preferences?: {
          genders?: string[];
          min_age?: number;
          max_age?: number;
          max_distance_km?: number;
        };
        prompts: { prompt_key: string; answer: string }[];
      }>('/profiles/me');
      setDisplayName(me.profile?.display_name ?? '');
      setHeadline(me.profile?.headline ?? '');
      setBio(me.profile?.bio ?? '');
      setCity(me.profile?.city ?? '');
      setBirthDate(formatBirthDate(me.profile?.birth_date) || '1998-06-15');
      if (me.profile?.gender && (GENDERS as readonly string[]).includes(me.profile.gender)) {
        setGender(me.profile.gender as (typeof GENDERS)[number]);
      }
      if (
        me.profile?.intent
        && (RELATIONSHIP_INTENTS as readonly string[]).includes(me.profile.intent)
      ) {
        setIntent(me.profile.intent as (typeof RELATIONSHIP_INTENTS)[number]);
      }
      setInterests((me.profile?.interests ?? []).join(', '));
      setDateIdeas((me.profile?.date_ideas ?? ['coffee', 'walk']).join(','));
      if (me.profile?.latitude != null) setLatitude(String(me.profile.latitude));
      if (me.profile?.longitude != null) setLongitude(String(me.profile.longitude));
      if (me.preferences?.genders?.length) {
        setPrefGenders(
          me.preferences.genders.filter((g) =>
            (GENDERS as readonly string[]).includes(g),
          ) as (typeof GENDERS)[number][],
        );
      }
      if (me.preferences?.min_age != null) setMinAge(String(me.preferences.min_age));
      if (me.preferences?.max_age != null) setMaxAge(String(me.preferences.max_age));
      if (me.preferences?.max_distance_km != null) {
        setMaxDistanceKm(String(me.preferences.max_distance_km));
      }
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

  function togglePrefGender(g: (typeof GENDERS)[number]) {
    setPrefGenders((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g],
    );
  }

  async function useCurrentLocation() {
    setStatus('Getting location…');
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setStatus('Location permission denied — enter lat/lng manually');
      return;
    }
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setLatitude(pos.coords.latitude.toFixed(5));
    setLongitude(pos.coords.longitude.toFixed(5));
    setStatus('Location updated');
  }

  async function enablePush() {
    setPushStatus('Registering…');
    const res = await registerForPushNotifications();
    setPushStatus(res.message);
  }

  async function save() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setStatus('Birth date must be YYYY-MM-DD');
      return;
    }
    if (prefGenders.length === 0) {
      setStatus('Select at least one preferred gender');
      return;
    }
    const min = Number(minAge);
    const max = Number(maxAge);
    const dist = Number(maxDistanceKm);
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (![min, max, dist, lat, lng].every((n) => Number.isFinite(n))) {
      setStatus('Preferences and location must be valid numbers');
      return;
    }
    setStatus('Saving…');
    await api('/profiles/me', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName,
        headline,
        bio,
        city,
        birthDate,
        gender,
        intent,
        interests: interests
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        dateIdeas: dateIdeas
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 3),
        latitude: lat,
        longitude: lng,
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
        genders: prefGenders,
        minAge: min,
        maxAge: max,
        maxDistanceKm: dist,
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
      <Field
        label="Birth date (YYYY-MM-DD)"
        value={birthDate}
        onChangeText={setBirthDate}
      />

      <Text style={styles.label}>Gender</Text>
      <View style={styles.chipRow}>
        {GENDERS.map((g) => (
          <Pressable
            key={g}
            style={[styles.chip, gender === g && styles.chipActive]}
            onPress={() => setGender(g)}
          >
            <Text style={[styles.chipText, gender === g && styles.chipTextActive]}>
              {GENDER_LABELS[g]}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Looking for</Text>
      <View style={styles.chipRow}>
        {RELATIONSHIP_INTENTS.map((i) => (
          <Pressable
            key={i}
            style={[styles.chip, intent === i && styles.chipActive]}
            onPress={() => setIntent(i)}
          >
            <Text style={[styles.chipText, intent === i && styles.chipTextActive]}>
              {INTENT_LABELS[i]}
            </Text>
          </Pressable>
        ))}
      </View>

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

      <Text style={[styles.title, { marginTop: spacing.xl }]}>Discovery preferences</Text>
      <Text style={styles.label}>Show me</Text>
      <View style={styles.chipRow}>
        {GENDERS.map((g) => (
          <Pressable
            key={`pref-${g}`}
            style={[styles.chip, prefGenders.includes(g) && styles.chipActive]}
            onPress={() => togglePrefGender(g)}
          >
            <Text
              style={[
                styles.chipText,
                prefGenders.includes(g) && styles.chipTextActive,
              ]}
            >
              {GENDER_LABELS[g]}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field label="Min age" value={minAge} onChangeText={setMinAge} />
      <Field label="Max age" value={maxAge} onChangeText={setMaxAge} />
      <Field
        label="Max distance (km)"
        value={maxDistanceKm}
        onChangeText={setMaxDistanceKm}
      />

      <Text style={[styles.title, { marginTop: spacing.lg }]}>Location</Text>
      <Field label="Latitude" value={latitude} onChangeText={setLatitude} />
      <Field label="Longitude" value={longitude} onChangeText={setLongitude} />
      <Pressable style={styles.secondary} onPress={useCurrentLocation}>
        <Text style={styles.secondaryText}>Use current location</Text>
      </Pressable>

      <Pressable style={styles.cta} onPress={save}>
        <Text style={styles.ctaText}>Save profile</Text>
      </Pressable>

      <Text style={[styles.title, { marginTop: spacing.xl }]}>Notifications</Text>
      <Pressable style={styles.secondary} onPress={enablePush}>
        <Text style={styles.secondaryText}>Enable push notifications</Text>
      </Pressable>
      {!!pushStatus && <Text style={styles.meta}>{pushStatus}</Text>}

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
        keyboardType={
          label.toLowerCase().includes('age')
          || label.toLowerCase().includes('distance')
          || label.toLowerCase().includes('lat')
          || label.toLowerCase().includes('long')
            ? 'decimal-pad'
            : 'default'
        }
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: spacing.md,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.bgElevated,
  },
  chipActive: {
    borderColor: colors.spark,
    backgroundColor: colors.surface,
  },
  chipText: { color: colors.muted, fontSize: 13 },
  chipTextActive: { color: colors.cream, fontWeight: '600' },
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
