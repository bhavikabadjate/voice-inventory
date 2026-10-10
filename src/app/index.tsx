// Ask screen: the voice assistant. Tap the mic and talk:
//   "milk kitne ka hai?"                 → selling price
//   "1 litre milk aur 2 kilo cheeni"     → bill with total, then "bill pakka karo"
//   "paneer add karo"                    → asks quantity, cost, selling price, expiry
//   "10 kilo cheeni aayi" / "2 litre dudh becha" / "dudh ka rate 58 kar do"
// When the app asks a question it starts listening again by itself.

import * as Speech from 'expo-speech';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Card, Chip, Field, Icon, IconButton, Screen, ScreenHeader } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
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
import { applyAction, getShop, subscribeData, todaysSalesPaise, useAccount, useCustomers, useProducts } from '@/data/db';
import { shareBill } from '@/data/share-bill';
import { useTheme } from '@/hooks/use-theme';

const LOCALES: Record<Lang, string> = { hi: 'hi-IN', mr: 'mr-IN', en: 'en-IN' };
const LANG_LABELS: { lang: Lang; label: string }[] = [
  { lang: 'hi', label: 'हिंदी' },
  { lang: 'mr', label: 'मराठी' },
  { lang: 'en', label: 'English' },
];

// Things to try saying. Tapping one asks it, the same as saying it.
const HINTS: Record<Lang, string[]> = {
  hi: ['दूध कितने का है?', 'पनीर ऐड करो', 'रमेश के खाते में 200 लिखो'],
  mr: ['दूध किती आहे?', 'पनीर ऍड करा', 'रमेशच्या खात्यात 200 लिहा'],
  en: ['How much is milk?', 'add paneer', 'add 200 to Ramesh khata'],
};

const YES_NO: Record<Lang, [string, string]> = {
  hi: ['हाँ', 'नहीं'],
  mr: ['हो', 'नाही'],
  en: ['Yes', 'No'],
};

// Firefox and some other browsers can't listen; Chrome and Edge can.
const NO_VOICE: Record<Lang, string> = {
  hi: 'इस ब्राउज़र में बोलकर नहीं पूछ सकते। Chrome या Edge खोलें, या नीचे लिखें।',
  mr: 'या ब्राउझरमध्ये बोलून विचारता येत नाही. Chrome किंवा Edge उघडा, किंवा खाली लिहा.',
  en: "This browser can't listen. Open the app in Chrome or Edge, or type below.",
};

// In a browser the bill is printed or saved as a PDF instead of shared.
const PRINT: Record<Lang, string> = { hi: 'बिल प्रिंट करें', mr: 'बिल प्रिंट करा', en: 'Print bill' };

const LABELS: Record<
  Lang,
  {
    title: string; talk: string; listening: string; tryThis: string; orType: string;
    confirmSale: string; share: string; today: string; total: string; attention: (n: number) => string;
  }
> = {
  hi: {
    title: 'पूछिए', talk: 'दबाकर बोलिए', listening: 'सुन रहा हूँ…', tryThis: 'ऐसे बोलिए', orType: 'या लिखिए',
    confirmSale: 'बिक्री पक्की करें', share: 'बिल भेजें (WhatsApp)', today: 'आज की बिक्री', total: 'कुल',
    attention: (n) => `${n} सामान पर ध्यान दें। Shop टैब देखें।`,
  },
  mr: {
    title: 'विचारा', talk: 'दाबून बोला', listening: 'ऐकत आहे…', tryThis: 'असे बोला', orType: 'किंवा लिहा',
    confirmSale: 'विक्री पक्की करा', share: 'बिल पाठवा (WhatsApp)', today: 'आजची विक्री', total: 'एकूण',
    attention: (n) => `${n} वस्तूंकडे लक्ष द्या. Shop टॅब पहा.`,
  },
  en: {
    title: 'Ask', talk: 'Tap and talk', listening: 'Listening…', tryThis: 'Try saying', orType: 'Or type',
    confirmSale: 'Confirm sale', share: 'Send bill (WhatsApp)', today: "Today's sales", total: 'Total',
    attention: (n) => `${n} items need attention. See the Shop tab.`,
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
  const { customers, refresh: refreshCustomers } = useCustomers();
  const customersRef = useRef(customers);
  customersRef.current = customers;
  const { can } = useAccount();
  const canSeeCostRef = useRef(can.canSeeCost);
  canSeeCostRef.current = can.canSeeCost;

  const reload = useCallback(async () => {
    await Promise.all([refresh(), refreshCustomers()]);
    setTodayPaise(await todaysSalesPaise(db));
  }, [db, refresh, refreshCustomers]);

  // Products may have changed on the Products tab.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  // Sales made on other phones arrive with a sync.
  useEffect(() => subscribeData(() => void todaysSalesPaise(db).then(setTodayPaise)), [db]);

  const startListening = useCallback(async () => {
    setError('');
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError(NO_VOICE[lang]);
      return;
    }
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
      show(
        converse(
          text,
          { ...convoRef.current, askCost: canSeeCostRef.current },
          productsRef.current,
          new Date(),
          customersRef.current,
        ),
      );
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

  const words = LABELS[lang];
  return (
    <Screen>
      <ScreenHeader
        title={words.title}
        right={
          <View style={styles.chips}>
            {LANG_LABELS.map((l) => (
              <Chip key={l.lang} label={l.label} selected={lang === l.lang} onPress={() => setLang(l.lang)} />
            ))}
          </View>
        }
      />

      <Card style={styles.today}>
        <View style={[styles.todayIcon, { backgroundColor: theme.accentSoft }]}>
          <Icon name={{ ios: 'indianrupeesign', md: 'currency_rupee' }} size={22} color={theme.accent} />
        </View>
        <View style={styles.flex}>
          <Text style={[Type.caption, { color: theme.textSecondary }]}>{words.today}</Text>
          <Text style={[styles.todayAmount, { color: theme.text }]}>{formatRupees(todayPaise)}</Text>
        </View>
      </Card>
      {attention > 0 ? (
        <Banner tone="warning" icon={{ ios: 'exclamationmark.triangle.fill', md: 'warning' }}>
          {words.attention(attention)}
        </Banner>
      ) : null}

      <View style={styles.micArea}>
        <View style={[styles.halo, { backgroundColor: listening ? theme.dangerSoft : theme.accentSoft }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={listening ? 'Stop listening' : 'Talk'}
            onPress={toggleMic}
            style={({ pressed }) => [
              styles.mic,
              { backgroundColor: listening ? theme.danger : theme.accent, transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}>
            <Icon
              name={listening ? { ios: 'stop.fill', md: 'stop' } : { ios: 'mic.fill', md: 'mic' }}
              size={56}
              color={theme.onAccent}
            />
          </Pressable>
        </View>
        <Text style={[Type.section, { color: theme.text }]}>{listening ? words.listening : words.talk}</Text>
        {heard ? <Text style={[styles.heard, { color: theme.textSecondary }]}>“{heard}”</Text> : null}
      </View>

      {error ? (
        <Banner tone="danger" icon={{ ios: 'exclamationmark.circle.fill', md: 'error' }}>
          {error}
        </Banner>
      ) : null}

      {reply ? (
        <Card>
          <Text style={[styles.answer, { color: theme.text }]}>{reply.say}</Text>
          {bill && bill.lines.length > 1 ? (
            <View style={[styles.bill, { backgroundColor: theme.background }]}>
              {bill.lines.map((line, i) => (
                <View key={i} style={styles.billRow}>
                  <Text style={[Type.body, styles.flex, { color: theme.text }]}>{line.product.names[0]}</Text>
                  <Text style={[Type.caption, { color: theme.textSecondary }]}>
                    {line.qty} {unitLabel(line.unit, replyLang)}
                  </Text>
                  <Text style={[Type.body, styles.billAmount, { color: theme.text }]}>
                    {formatRupees(line.amountPaise)}
                  </Text>
                </View>
              ))}
              <View style={[styles.billRow, styles.billTotal, { borderTopColor: theme.border }]}>
                <Text style={[Type.bodyStrong, styles.flex, { color: theme.text }]}>{LABELS[replyLang].total}</Text>
                <Text style={[Type.bodyStrong, styles.billAmount, { color: theme.text }]}>
                  {formatRupees(bill.payablePaise)}
                </Text>
              </View>
            </View>
          ) : null}
          {awaitingYesNo(convo) ? (
            <View style={styles.actions}>
              <Button style={styles.flex} title={YES_NO[replyLang][0]} onPress={() => respond('yes')} />
              <Button style={styles.flex} title={YES_NO[replyLang][1]} kind="secondary" onPress={() => respond('no')} />
            </View>
          ) : null}
          {canConfirmSale ? (
            <Button
              title={LABELS[replyLang].confirmSale}
              icon={{ ios: 'checkmark.circle.fill', md: 'check_circle' }}
              onPress={() => show(confirmLastBill(convoRef.current, productsRef.current))}
            />
          ) : null}
          {bill && !awaitingYesNo(convo) ? (
            <Button
              title={Platform.OS === 'web' ? PRINT[replyLang] : LABELS[replyLang].share}
              icon={Platform.OS === 'web' ? { ios: 'printer.fill', md: 'print' } : { ios: 'square.and.arrow.up', md: 'share' }}
              kind="secondary"
              onPress={sendBill}
            />
          ) : null}
        </Card>
      ) : null}

      {products.length === 0 ? (
        <Text style={[Type.body, styles.center, { color: theme.textSecondary }]}>
          No products yet. Say "paneer add karo", or add them on the Products tab.
        </Text>
      ) : null}

      <Card>
        <Text style={[Type.caption, { color: theme.textSecondary }]}>{words.tryThis}</Text>
        <View style={styles.hints}>
          {HINTS[lang].map((hint) => (
            <Chip key={hint} label={hint} selected={false} onPress={() => respond(hint)} />
          ))}
        </View>
        <View style={styles.composer}>
          <Field
            label={words.orType}
            value={typed}
            onChangeText={setTyped}
            placeholder="2 ltr milk kitne ka hai"
            returnKeyType="send"
            onSubmitEditing={() => respond(typed)}
          />
          <IconButton
            icon={{ ios: 'arrow.up', md: 'send' }}
            label="Send"
            onPress={() => respond(typed)}
            disabled={!typed.trim()}
          />
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  chips: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', justifyContent: 'flex-end' },
  today: { flexDirection: 'row', alignItems: 'center' },
  todayIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  todayAmount: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  micArea: { alignItems: 'center', gap: Spacing.three, paddingVertical: Spacing.three },
  halo: { padding: 14, borderRadius: Radius.full },
  mic: { width: 148, height: 148, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  heard: { textAlign: 'center', fontSize: 18, fontStyle: 'italic' },
  answer: { fontSize: 22, lineHeight: 30, fontWeight: '700' },
  bill: { gap: Spacing.two, padding: Spacing.three, borderRadius: Radius.md },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  billAmount: { minWidth: 72, textAlign: 'right' },
  billTotal: { borderTopWidth: 1, paddingTop: Spacing.two, marginTop: Spacing.one },
  actions: { flexDirection: 'row', gap: Spacing.two },
  hints: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two },
});
