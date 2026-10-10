// Khata tab: who owes what, each customer's udhaar history, writing udhaar or
// a payment by hand, and a WhatsApp reminder with a UPI pay link.

import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState, type ReactNode } from 'react';
import { FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { notify } from '@/components/notify';
import { Button, Chip, Field } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing, TopTabInset } from '@/constants/theme';
import { formatRupees } from '@/core/billing';
import { findCustomers, owing, reminderLink, whatsappNumber, type Customer, type KhataEntry } from '@/core/khata';
import type { Lang } from '@/core/units';
import { addKhataEntry, customerEntries, getShop, saveCustomer, useCustomers } from '@/data/db';
import { useTheme } from '@/hooks/use-theme';

const RED = '#D93F3F';
const GREEN = '#2E9E5B';

function toPaise(text: string): number {
  return Math.round(Number(text.replace(/[^\d.]/g, '')) * 100);
}

function when(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'customer'; id: string };

export default function KhataScreen() {
  const theme = useTheme();
  const { db, customers, refresh } = useCustomers();
  const [view, setView] = useState<Mode>({ kind: 'list' });
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const due = owing(customers);
  const totalDue = due.reduce((sum, c) => sum + c.balancePaise, 0);
  const shown = search.trim() ? findCustomers(search, customers) : [...due, ...customers.filter((c) => c.balancePaise <= 0)];

  const current = view.kind === 'customer' ? customers.find((c) => c.id === view.id) : undefined;

  if (view.kind === 'new') {
    return (
      <Screen>
        <CustomerForm
          onCancel={() => setView({ kind: 'list' })}
          onSave={async (name, phone) => {
            const id = await saveCustomer(db, { id: null, name, phone });
            await refresh();
            setView({ kind: 'customer', id });
          }}
        />
      </Screen>
    );
  }

  if (current) {
    return (
      <Screen>
        <CustomerKhata customer={current} onBack={() => setView({ kind: 'list' })} onChanged={refresh} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.text }]}>Khata</Text>
        <Text style={{ color: theme.textSecondary }}>
          {totalDue > 0 ? `${due.length} customers owe ${formatRupees(totalDue)}` : 'Nobody owes anything.'}
        </Text>
        <View style={styles.row}>
          <Field label="Search a customer" value={search} onChangeText={setSearch} placeholder="Ramesh" />
        </View>
        <Button title="+ Add customer" onPress={() => setView({ kind: 'new' })} />
      </View>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: theme.textSecondary }]}>
            {customers.length
              ? `Nobody called “${search}”.`
              : 'No customers yet. Add one here, or say "Ramesh ke khate mein 200 likho" on the Ask tab.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setView({ kind: 'customer', id: item.id })}
            style={({ pressed }) => [styles.item, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemName, { color: theme.text }]}>{item.name}</Text>
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{item.phone || ' '}</Text>
            </View>
            <Text style={[styles.amount, { color: item.balancePaise > 0 ? RED : theme.textSecondary }]}>
              {item.balancePaise > 0 ? formatRupees(item.balancePaise) : item.balancePaise < 0 ? `Advance ${formatRupees(-item.balancePaise)}` : '—'}
            </Text>
          </Pressable>
        )}
      />
    </Screen>
  );
}

function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>{children}</SafeAreaView>
    </View>
  );
}

function CustomerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: { name: string; phone: string };
  onSave: (name: string, phone: string) => Promise<void>;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const save = () => {
    if (!name.trim()) return notify('Add the customer’s name');
    if (phone.trim() && !whatsappNumber(phone)) return notify('Phone should be a 10-digit mobile number');
    onSave(name, phone);
  };
  return (
    <View style={styles.form}>
      <Text style={[styles.title, { color: theme.text }]}>{initial ? 'Edit customer' : 'New customer'}</Text>
      <View style={styles.row}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="Ramesh Patil" autoFocus={!initial} />
      </View>
      <View style={styles.row}>
        <Field label="Mobile (for WhatsApp reminders)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" />
      </View>
      <Button title="Save" onPress={save} />
      <Button title="Cancel" kind="secondary" onPress={onCancel} />
    </View>
  );
}

function CustomerKhata({
  customer,
  onBack,
  onChanged,
}: {
  customer: Customer;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const theme = useTheme();
  const db = useSQLiteContext();
  const [entries, setEntries] = useState<KhataEntry[]>([]);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [lang, setLang] = useState<Lang>('hi');

  const load = useCallback(async () => setEntries(await customerEntries(db, customer.id)), [db, customer.id]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const write = async (sign: 1 | -1) => {
    const paise = toPaise(amount);
    if (!paise) return notify('Enter an amount');
    await addKhataEntry(db, customer.id, sign * paise, note.trim());
    setAmount('');
    setNote('');
    await onChanged();
    await load();
  };

  const remind = async () => {
    const link = reminderLink(await getShop(db), customer, lang);
    if (!link) return notify('Add a mobile number for this customer first');
    Linking.openURL(link).catch(() => notify('Could not open WhatsApp'));
  };

  if (editing) {
    return (
      <CustomerForm
        initial={customer}
        onCancel={() => setEditing(false)}
        onSave={async (name, phone) => {
          await saveCustomer(db, { id: customer.id, name, phone });
          await onChanged();
          setEditing(false);
        }}
      />
    );
  }

  const balance = customer.balancePaise;
  return (
    <FlatList
      data={entries}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.detailHeader}>
          <View style={styles.topRow}>
            <Button title="‹ Back" kind="secondary" onPress={onBack} />
            <Button title="Edit" kind="secondary" onPress={() => setEditing(true)} />
          </View>
          <Text style={[styles.title, { color: theme.text }]}>{customer.name}</Text>
          {customer.phone ? <Text style={{ color: theme.textSecondary }}>{customer.phone}</Text> : null}
          <Text style={[styles.balance, { color: balance > 0 ? RED : balance < 0 ? GREEN : theme.text }]}>
            {balance > 0 ? `Owes ${formatRupees(balance)}` : balance < 0 ? `Advance ${formatRupees(-balance)}` : 'Nothing due'}
          </Text>

          <View style={styles.row}>
            <Field label="Amount ₹" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="200" />
            <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Atta, oil" />
          </View>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Button title="Gave udhaar" kind="danger" onPress={() => write(1)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Got payment" onPress={() => write(-1)} />
            </View>
          </View>

          {balance > 0 ? (
            <>
              <View style={styles.chips}>
                <Chip label="हिंदी" selected={lang === 'hi'} onPress={() => setLang('hi')} />
                <Chip label="मराठी" selected={lang === 'mr'} onPress={() => setLang('mr')} />
                <Chip label="English" selected={lang === 'en'} onPress={() => setLang('en')} />
              </View>
              <Button title="Send reminder on WhatsApp" kind="secondary" onPress={remind} />
            </>
          ) : null}
          <Text style={[styles.subtitle, { color: theme.text }]}>History</Text>
          {entries.length === 0 ? <Text style={{ color: theme.textSecondary }}>No entries yet.</Text> : null}
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '600' }}>
              {item.amountPaise > 0 ? 'Udhaar' : 'Payment'}
              {item.note ? ` · ${item.note}` : ''}
            </Text>
            <Text style={{ color: theme.textSecondary, fontSize: 13 }}>{when(item.at)}</Text>
          </View>
          <Text style={[styles.amount, { color: item.amountPaise > 0 ? RED : GREEN }]}>
            {item.amountPaise > 0 ? '+' : '−'}
            {formatRupees(Math.abs(item.amountPaise))}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth, paddingTop: TopTabInset },
  header: { padding: Spacing.three, gap: Spacing.three },
  detailHeader: { gap: Spacing.three, paddingTop: Spacing.three, paddingBottom: Spacing.two },
  topRow: { flexDirection: 'row', justifyContent: 'space-between' },
  form: { padding: Spacing.four, gap: Spacing.three },
  title: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 18, fontWeight: '700', marginTop: Spacing.two },
  balance: { fontSize: 28, fontWeight: '800' },
  row: { flexDirection: 'row', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  list: { paddingHorizontal: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  empty: { textAlign: 'center', fontSize: 15, paddingTop: Spacing.four },
  item: { flexDirection: 'row', alignItems: 'center', padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  itemName: { fontSize: 17, fontWeight: '700' },
  amount: { fontSize: 17, fontWeight: '700' },
});
