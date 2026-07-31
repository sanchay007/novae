import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useEffect, useLayoutEffect, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { io, Socket } from 'socket.io-client';
import { API_URL, api, getToken } from '../../src/api';
import { colors, spacing } from '../../src/theme';

type Message = {
  id: string;
  body?: string;
  sender_id: string;
  created_at: string;
};

export default function ChatScreen() {
  const { matchId } = useLocalSearchParams<{ matchId: string }>();
  const navigation = useNavigation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerStyle: { backgroundColor: colors.bg },
      headerTintColor: colors.cream,
      title: 'Chat',
    });
  }, [navigation]);

  useEffect(() => {
    let active = true;
    (async () => {
      const profile = await api<{ profile: { user_id: string } }>('/profiles/me');
      if (!active) return;
      setMe(profile.profile.user_id);
      const res = await api<{ messages: Message[] }>(`/chat/${matchId}/messages`);
      setMessages(res.messages);
      const token = await getToken();
      const wsBase = API_URL.replace(/\/v1$/, '');
      const s = io(`${wsBase}/ws`, { auth: { token } });
      s.emit('join_match', { matchId });
      s.on('message', (msg: Message) => {
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      });
      setSocket(s);
    })();
    return () => {
      active = false;
      socket?.disconnect();
    };
  }, [matchId]);

  async function send(body: string) {
    if (!body.trim()) return;
    setText('');
    setSuggestions([]);
    const msg = await api<Message>('/chat/messages', {
      method: 'POST',
      body: JSON.stringify({ matchId, body }),
    });
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    socket?.emit('send_message', { matchId, body });
  }

  async function loadSuggestions() {
    const res = await api<{ suggestions: string[] }>('/ai/suggest', {
      method: 'POST',
      body: JSON.stringify({ matchId, tone: 'sincere' }),
    });
    setSuggestions(res.suggestions);
  }

  async function startCall() {
    const res = await api<{ room: string; token: string }>('/calls/token', {
      method: 'POST',
      body: JSON.stringify({ matchId }),
    });
    setSuggestions([`Call room ready: ${res.room} (LiveKit token issued)`]);
  }

  async function unmatch() {
    await api('/matches/unmatch', {
      method: 'POST',
      body: JSON.stringify({
        matchId,
        reason: 'keep_exploring',
        anonymousFeedback: 'Wanted a new spark',
      }),
    });
    navigation.goBack();
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={80}
    >
      <FlatList
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.md }}
        renderItem={({ item }) => {
          const mine = item.sender_id === me;
          return (
            <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={styles.bubbleText}>{item.body}</Text>
            </View>
          );
        }}
      />

      {!!suggestions.length && (
        <View style={styles.suggestRow}>
          <Text style={styles.suggestLabel}>AI drafts — tap to edit/send</Text>
          {suggestions.map((s) => (
            <Pressable key={s} style={styles.chip} onPress={() => setText(s)}>
              <Text style={styles.chipText}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.tools}>
        <Pressable onPress={loadSuggestions}>
          <Text style={styles.tool}>AI suggest</Text>
        </Pressable>
        <Pressable onPress={startCall}>
          <Text style={styles.tool}>Call</Text>
        </Pressable>
        <Pressable onPress={unmatch}>
          <Text style={[styles.tool, { color: colors.danger }]}>Unmatch</Text>
        </Pressable>
      </View>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Say something real…"
          placeholderTextColor={colors.muted}
        />
        <Pressable style={styles.send} onPress={() => send(text)}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bubble: {
    maxWidth: '80%',
    padding: spacing.md,
    borderRadius: 16,
    marginBottom: spacing.sm,
  },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.spark },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.bgElevated },
  bubbleText: { color: colors.cream },
  suggestRow: { paddingHorizontal: spacing.md, gap: spacing.sm },
  suggestLabel: { color: colors.muted, fontSize: 12 },
  chip: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
  },
  chipText: { color: colors.cream },
  tools: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.sm,
  },
  tool: { color: colors.spark, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    color: colors.cream,
  },
  send: {
    backgroundColor: colors.spark,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  sendText: { color: colors.bg, fontWeight: '700' },
});
