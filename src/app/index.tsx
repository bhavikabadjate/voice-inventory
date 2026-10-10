// Ask screen: tap the mic, ask "milk kitne ka hai?" or "1 litre milk aur
// 2 kilo cheeni ka kitna hua?", and hear the selling price or bill total.

import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Accent, Button, Chip, Field } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { answer, type Answer } from '@/core/assistant';
import { formatRupees } from '@/core/billing';
import { parseCommand } from '@/core/parse';
import { unitLabel, type Lang } from '@/core/units';
import { useProducts } from '@/data/db';
import { useTheme } from '@/hooks/use-theme';

const LOCALES: Record<Lang, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
const LANG_LABELS: { lang: Lang; label: string }[] = [
  { lang: 'hi', label: 'हिंदी' },
  { lang: 'mr', label: 'मराठी' },
  { lang: 'en', label: 'English' },
];

const HINTS: Record<Lang, string> = {
  hi: 'बोलिए: "दूध कितने का है?" या "1 लीटर दूध और 2 किलो चीनी का कितना हुआ?"',
  mr: 'बोला: "दूध किती आहे?" किंवा "150 ग्रॅम नाचणी किती?"',
  en: 'Say: "How much is milk?" or "2 litre milk and 1 kg sugar"',
};

export default function AskScreen() {
  const theme = useTheme();
  const { products, refresh } = useProducts();
  const [lang, setLang] = useState<Lang>('hi');
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [reply, setReply] = useState<Answer | null>(null);
  const [error, setError] = useState('');

  // Products may have changed on the Products tab.
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const respond = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const result = answer(parseCommand(text), products);
      setReply(result);
      Speech.stop();
      Speech.speak(result.text, { language: LOCALES[result.lang] });
    },
    [products],
  );

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript ?? '';
    setHeard(transcript);
    if (event.isFinal) respond(transcript);
  });
  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);
    if (event.error !== 'no-speech' && event.error !== 'aborted') setError(event.message);
  });

  const toggleMic = async () => {
    setError('');
    if (listening) {
      ExpoSpeechRecognitionModule.stop();
      return;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone permission is needed to ask by voice.');
      return;
    }
    Speech.stop();
    setHeard('');
    setReply(null);
    ExpoSpeechRecognitionModule.start({ lang: LOCALES[lang], interimResults: true });
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.row}>
            {LANG_LABELS.map((l) => (
              <Chip key={l.lang} label={l.label} selected={lang === l.lang} onPress={() => setLang(l.lang)} />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop listening' : 'Ask by voice'}
            onPress={toggleMic}
            style={({ pressed }) => [
              styles.mic,
              { backgroundColor: listening ? '#D93F3F' : Accent, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Text style={styles.micIcon}>{listening ? '■' : '🎤'}</Text>
            <Text style={styles.micText}>{listening ? 'Listening…' : 'Tap and ask'}</Text>
          </Pressable>

          <Text style={[styles.hint, { color: theme.textSecondary }]}>{HINTS[lang]}</Text>

          {heard ? <Text style={[styles.heard, { color: theme.textSecondary }]}>“{heard}”</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {reply ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.answer, { color: theme.text }]}>{reply.text}</Text>
              {reply.kind === 'price' && reply.bill && reply.bill.lines.length > 1 ? (
                <View style={styles.bill}>
                  {reply.bill.lines.map((line, i) => (
                    <View key={i} style={styles.billRow}>
                      <Text style={[styles.billItem, { color: theme.text }]}>
                        {line.product.names[0]}
                      </Text>
                      <Text style={[styles.billQty, { color: theme.textSecondary }]}>
                        {line.qty} {unitLabel(line.unit, reply.lang)}
                      </Text>
                      <Text style={[styles.billAmount, { color: theme.text }]}>
                        {formatRupees(line.amountPaise)}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.billRow, styles.billTotal]}>
                    <Text style={[styles.billItem, styles.bold, { color: theme.text }]}>Total</Text>
                    <Text style={[styles.billAmount, styles.bold, { color: theme.text }]}>
                      {formatRupees(reply.bill.payablePaise)}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          ) : null}

          {products.length === 0 ? (
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              No products yet. Add some on the Products tab first.
            </Text>
          ) : null}

          <View style={styles.typeRow}>
            <Field
              label="Or type a question"
              value={typed}
              onChangeText={setTyped}
              placeholder="2 ltr milk kitne ka hai"
              returnKeyType="send"
              onSubmitEditing={() => respond(typed)}
            />
          </View>
          <Button title="Ask" kind="secondary" onPress={() => respond(typed)} disabled={!typed.trim()} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: {
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  row: { flexDirection: 'row', gap: Spacing.two, justifyContent: 'center' },
  mic: {
    alignSelf: 'center',
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.three,
  },
  micIcon: { fontSize: 56, color: '#ffffff' },
  micText: { color: '#ffffff', fontSize: 16, fontWeight: '700', marginTop: 4 },
  hint: { textAlign: 'center', fontSize: 14 },
  heard: { textAlign: 'center', fontSize: 18, fontStyle: 'italic' },
  error: { textAlign: 'center', color: '#D93F3F' },
  card: { padding: Spacing.three, borderRadius: 16, gap: Spacing.three },
  answer: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  bill: { gap: Spacing.two },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  billItem: { flex: 1, fontSize: 16 },
  billQty: { fontSize: 14 },
  billAmount: { minWidth: 72, textAlign: 'right', fontSize: 16 },
  billTotal: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#888', paddingTop: Spacing.two },
  bold: { fontWeight: '700' },
  typeRow: { flexDirection: 'row' },
});
