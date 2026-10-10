// Ask screen: the voice assistant. Tap the mic and talk:
//   "milk kitne ka hai?"                 → selling price
//   "1 litre milk aur 2 kilo cheeni"     → bill with total, then "bill pakka karo"
//   "paneer add karo"                    → asks quantity, cost, selling price, expiry
//   "10 kilo cheeni aayi" / "2 litre dudh becha" / "dudh ka rate 58 kar do"
// When the app asks a question it starts listening again by itself.

import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Accent, Button, Chip, Field } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { alertCount, findAlerts } from '@/core/alerts';
import { formatRupees } from '@/core/billing';
import {
  awaitingYesNo,
  confirmLastBill,
  converse,
  initialState,
  type ConversationState,
  type Turn,
} from '@/core/conversation';
import { unitLabel, type Lang } from '@/core/units';
import { applyAction, getShop, todaysSalesPaise, useProducts } from '@/data/db';
import { shareBill } from '@/data/share-bill';
import { useTheme } from '@/hooks/use-theme';

const LOCALES: Record<Lang, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
const LANG_LABELS: { lang: Lang; label: string }[] = [
  { lang: 'hi', label: 'हिंदी' },
  { lang: 'mr', label: 'मराठी' },
  { lang: 'en', label: 'English' },
];

const HINTS: Record<Lang, string> = {
  hi: 'बोलिए: "दूध कितने का है?", "पनीर ऐड करो", "2 लीटर दूध बेचा"',
  mr: 'बोला: "दूध किती आहे?", "पनीर ऍड करा", "10 किलो साखर आली"',
  en: 'Say: "How much is milk?", "add paneer", "sold 2 litre milk"',
};

const YES_NO: Record<Lang, [string, string]> = {
  hi: ['हाँ', 'नहीं'],
  mr: ['हो', 'नाही'],
  en: ['Yes', 'No'],
};

const LABELS: Record<Lang, { confirmSale: string; share: string; today: string; total: string; attention: (n: number) => string }> = {
  hi: {
    confirmSale: 'बिक्री पक्की करें', share: 'बिल भेजें (WhatsApp)', today: 'आज की बिक्री', total: 'कुल',
    attention: (n) => `⚠ ${n} सामान पर ध्यान दें। Shop टैब देखें।`,
  },
  mr: {
    confirmSale: 'विक्री पक्की करा', share: 'बिल पाठवा (WhatsApp)', today: 'आजची विक्री', total: 'एकूण',
    attention: (n) => `⚠ ${n} वस्तूंकडे लक्ष द्या. Shop टॅब पहा.`,
  },
  en: {
    confirmSale: 'Confirm sale', share: 'Send bill (WhatsApp)', today: "Today's sales", total: 'Total',
    attention: (n) => `⚠ ${n} items need attention. See the Shop tab.`,
  },
};

export default function AskScreen() {
  const theme = useTheme();
  const { db, products, refresh } = useProducts();
  const [lang, setLang] = useState<Lang>('hi');
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [typed, setTyped] = useState('');
  const [reply, setReply] = useState<Turn | null>(null);
  const [error, setError] = useState('');
  const [todayPaise, setTodayPaise] = useState(0);
  const [convo, setConvo] = useState<ConversationState>(initialState);
  // Speech events fire outside React's render cycle, so keep the latest state in a ref.
  const convoRef = useRef(convo);
  const productsRef = useRef(products);
  productsRef.current = products;

  const reload = useCallback(async () => {
    await refresh();
    setTodayPaise(await todaysSalesPaise(db));
  }, [db, refresh]);

  // Products may have changed on the Products tab.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const startListening = useCallback(async () => {
    setError('');
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError('Microphone permission is needed to talk to the app.');
      return;
    }
    Speech.stop();
    setHeard('');
    ExpoSpeechRecognitionModule.start({ lang: LOCALES[lang], interimResults: true });
  }, [lang]);

  const show = useCallback(
    async (turn: Turn) => {
      convoRef.current = turn.state;
      setConvo(turn.state);
      setReply(turn);
      if (turn.action) {
        await applyAction(db, turn.action);
        await reload();
      }
      Speech.stop();
      Speech.speak(turn.say, {
        language: LOCALES[turn.lang],
        // The app asked something: listen for the answer.
        onDone: () => {
          if (turn.state.flow.step !== 'idle') startListening();
        },
      });
    },
    [db, reload, startListening],
  );

  const respond = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setTyped('');
      show(converse(text, convoRef.current, productsRef.current));
    },
    [show],
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

  const toggleMic = () => {
    if (listening) ExpoSpeechRecognitionModule.stop();
    else startListening();
  };

  const replyLang = reply?.lang ?? lang;
  const bill = reply?.bill ?? null;
  const canConfirmSale = convo.flow.step === 'idle' && convo.lastBill !== null && bill === convo.lastBill;
  const attention = alertCount(findAlerts(products, new Date()));

  const sendBill = async () => {
    if (!bill) return;
    try {
      await shareBill(await getShop(db), bill, replyLang);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not share the bill.');
    }
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
          <Text style={[styles.hint, { color: theme.textSecondary }]}>
            {LABELS[lang].today}: {formatRupees(todayPaise)}
          </Text>
          {attention > 0 ? <Text style={styles.warning}>{LABELS[lang].attention(attention)}</Text> : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop listening' : 'Talk'}
            onPress={toggleMic}
            style={({ pressed }) => [
              styles.mic,
              { backgroundColor: listening ? '#D93F3F' : Accent, opacity: pressed ? 0.8 : 1 },
            ]}>
            <Text style={styles.micIcon}>{listening ? '■' : '🎤'}</Text>
            <Text style={styles.micText}>{listening ? 'Listening…' : 'Tap and talk'}</Text>
          </Pressable>

          <Text style={[styles.hint, { color: theme.textSecondary }]}>{HINTS[lang]}</Text>

          {heard ? <Text style={[styles.heard, { color: theme.textSecondary }]}>“{heard}”</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {reply ? (
            <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.answer, { color: theme.text }]}>{reply.say}</Text>
              {bill && bill.lines.length > 1 ? (
                <View style={styles.bill}>
                  {bill.lines.map((line, i) => (
                    <View key={i} style={styles.billRow}>
                      <Text style={[styles.billItem, { color: theme.text }]}>{line.product.names[0]}</Text>
                      <Text style={[styles.billQty, { color: theme.textSecondary }]}>
                        {line.qty} {unitLabel(line.unit, replyLang)}
                      </Text>
                      <Text style={[styles.billAmount, { color: theme.text }]}>
                        {formatRupees(line.amountPaise)}
                      </Text>
                    </View>
                  ))}
                  <View style={[styles.billRow, styles.billTotal]}>
                    <Text style={[styles.billItem, styles.bold, { color: theme.text }]}>
                      {LABELS[replyLang].total}
                    </Text>
                    <Text style={[styles.billAmount, styles.bold, { color: theme.text }]}>
                      {formatRupees(bill.payablePaise)}
                    </Text>
                  </View>
                </View>
              ) : null}
              {awaitingYesNo(convo) ? (
                <View style={styles.row}>
                  <View style={styles.flex}>
                    <Button title={YES_NO[replyLang][0]} onPress={() => respond('yes')} />
                  </View>
                  <View style={styles.flex}>
                    <Button title={YES_NO[replyLang][1]} kind="secondary" onPress={() => respond('no')} />
                  </View>
                </View>
              ) : null}
              {canConfirmSale ? (
                <Button
                  title={LABELS[replyLang].confirmSale}
                  onPress={() => show(confirmLastBill(convoRef.current, productsRef.current))}
                />
              ) : null}
              {bill && !awaitingYesNo(convo) ? (
                <Button title={LABELS[replyLang].share} kind="secondary" onPress={sendBill} />
              ) : null}
            </View>
          ) : null}

          {products.length === 0 ? (
            <Text style={[styles.hint, { color: theme.textSecondary }]}>
              No products yet. Say "paneer add karo", or add them on the Products tab.
            </Text>
          ) : null}

          <View style={styles.typeRow}>
            <Field
              label="Or type"
              value={typed}
              onChangeText={setTyped}
              placeholder="2 ltr milk kitne ka hai"
              returnKeyType="send"
              onSubmitEditing={() => respond(typed)}
            />
          </View>
          <Button title="Send" kind="secondary" onPress={() => respond(typed)} disabled={!typed.trim()} />
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
  warning: { textAlign: 'center', color: '#C77700', fontWeight: '600' },
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
  flex: { flex: 1 },
});
