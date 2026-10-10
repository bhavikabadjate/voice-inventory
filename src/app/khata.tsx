// Khata tab: who owes what, each customer's udhaar history, writing udhaar or
// a payment by hand, and a WhatsApp reminder with a UPI pay link.

import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, StyleSheet, Text, View } from 'react-native';

import { notify } from '@/components/notify';
import { Button, Card, Chip, Field, Icon, ListRow, pageContent, Screen, ScreenHeader } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { formatRupees } from '@/core/billing';
import { findCustomers, owing, reminderLink, whatsappNumber, type Customer, type KhataEntry } from '@/core/khata';
import type { Lang } from '@/core/units';
import { addKhataEntry, customerEntries, getShop, saveCustomer, subscribeData, useCustomers } from '@/data/db';
import { useTheme } from '@/hooks/use-theme';

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
    return <CustomerKhata customer={current} onBack={() => setView({ kind: 'list' })} onChanged={refresh} />;
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        contentContainerStyle={[pageContent, styles.list]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader
              title="Khata"
              right={<Button title="Add" icon={{ ios: 'person.badge.plus', md: 'person_add' }} onPress={() => setView({ kind: 'new' })} />}
            />
            <Card style={styles.summary}>
              <View style={[styles.summaryIcon, { backgroundColor: totalDue > 0 ? theme.dangerSoft : theme.accentSoft }]}>
                <Icon
                  name={{ ios: 'book.closed.fill', md: 'menu_book' }}
                  size={22}
                  color={totalDue > 0 ? theme.danger : theme.accent}
                />
              </View>
              <View style={styles.flex}>
                <Text style={[Type.caption, { color: theme.textSecondary }]}>
                  {totalDue > 0 ? `${due.length} ${due.length === 1 ? 'customer owes' : 'customers owe'}` : 'Udhaar'}
                </Text>
                <Text style={[styles.big, { color: totalDue > 0 ? theme.danger : theme.text }]}>
                  {totalDue > 0 ? formatRupees(totalDue) : 'Nobody owes anything'}
                </Text>
              </View>
            </Card>
            <View style={styles.row}>
              <Field label="Search a customer" value={search} onChangeText={setSearch} placeholder="Ramesh" />
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={[Type.body, styles.empty, { color: theme.textSecondary }]}>
            {customers.length
              ? `Nobody called “${search}”.`
              : 'No customers yet. Add one here, or say "Ramesh ke khate mein 200 likho" on the Ask tab.'}
          </Text>
        }
        renderItem={({ item, index }) => (
          <ListRow first={index === 0} last={index === shown.length - 1} onPress={() => setView({ kind: 'customer', id: item.id })}>
            <View style={[styles.avatar, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[Type.bodyStrong, { color: theme.textSecondary }]}>{item.name.trim().charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={[Type.bodyStrong, { color: theme.text }]}>{item.name}</Text>
              {item.phone ? <Text style={[Type.caption, { color: theme.textSecondary }]}>{item.phone}</Text> : null}
            </View>
            <Text
              style={[
                Type.bodyStrong,
                { color: item.balancePaise > 0 ? theme.danger : item.balancePaise < 0 ? theme.accent : theme.textSecondary },
              ]}>
              {item.balancePaise > 0 ? formatRupees(item.balancePaise) : item.balancePaise < 0 ? `Advance ${formatRupees(-item.balancePaise)}` : '—'}
            </Text>
          </ListRow>
        )}
      />
    </Screen>
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
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const save = () => {
    if (!name.trim()) return notify('Add the customer’s name');
    if (phone.trim() && !whatsappNumber(phone)) return notify('Phone should be a 10-digit mobile number');
    onSave(name, phone);
  };
  return (
    <>
      <ScreenHeader title={initial ? 'Edit customer' : 'New customer'} />
      <Card>
        <View style={styles.row}>
          <Field label="Name" value={name} onChangeText={setName} placeholder="Ramesh Patil" autoFocus={!initial} />
        </View>
        <View style={styles.row}>
          <Field label="Mobile (for WhatsApp reminders)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" />
        </View>
      </Card>
      <View style={styles.row}>
        <Button style={styles.flex} title="Cancel" kind="secondary" onPress={onCancel} />
        <Button style={styles.flex} title="Save" onPress={save} />
      </View>
    </>
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
  // Udhaar written by voice on the Ask tab shows up here straight away.
  useEffect(() => subscribeData(() => void load()), [load]);

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
      <Screen>
        <CustomerForm
          initial={customer}
          onCancel={() => setEditing(false)}
          onSave={async (name, phone) => {
            await saveCustomer(db, { id: customer.id, name, phone });
            await onChanged();
            setEditing(false);
          }}
        />
      </Screen>
    );
  }

  const balance = customer.balancePaise;
  return (
    <Screen scroll={false}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        contentContainerStyle={[pageContent, styles.list]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topRow}>
              <Button title="Khata" kind="ghost" icon={{ ios: 'chevron.left', md: 'chevron_left' }} onPress={onBack} />
              <Button title="Edit" kind="ghost" icon={{ ios: 'pencil', md: 'edit' }} onPress={() => setEditing(true)} />
            </View>
            <ScreenHeader title={customer.name} subtitle={customer.phone || undefined} />
            <Card>
              <Text style={[Type.caption, { color: theme.textSecondary }]}>
                {balance > 0 ? 'Owes you' : balance < 0 ? 'Advance paid' : 'Balance'}
              </Text>
              <Text style={[styles.balance, { color: balance > 0 ? theme.danger : balance < 0 ? theme.accent : theme.text }]}>
                {balance === 0 ? 'Nothing due' : formatRupees(Math.abs(balance))}
              </Text>
              <View style={styles.row}>
                <Field label="Amount ₹" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="200" />
                <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Atta, oil" />
              </View>
              <View style={styles.row}>
                <Button style={styles.flex} title="Gave udhaar" kind="danger" icon={{ ios: 'arrow.up.right', md: 'north_east' }} onPress={() => write(1)} />
                <Button style={styles.flex} title="Got payment" icon={{ ios: 'arrow.down.left', md: 'south_west' }} onPress={() => write(-1)} />
              </View>
            </Card>

            {balance > 0 ? (
              <Card>
                <Text style={[Type.bodyStrong, { color: theme.text }]}>Remind on WhatsApp</Text>
                <View style={styles.chips}>
                  <Chip label="हिंदी" selected={lang === 'hi'} onPress={() => setLang('hi')} />
                  <Chip label="मराठी" selected={lang === 'mr'} onPress={() => setLang('mr')} />
                  <Chip label="English" selected={lang === 'en'} onPress={() => setLang('en')} />
                </View>
                <Button title="Send reminder" kind="secondary" icon={{ ios: 'paperplane.fill', md: 'send' }} onPress={remind} />
              </Card>
            ) : null}
            <Text style={[Type.section, { color: theme.text }]}>History</Text>
            {entries.length === 0 ? <Text style={[Type.body, { color: theme.textSecondary }]}>No entries yet.</Text> : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <ListRow first={index === 0} last={index === entries.length - 1}>
            <View style={styles.flex}>
              <Text style={[Type.bodyStrong, { color: theme.text }]}>
                {item.amountPaise > 0 ? 'Udhaar' : 'Payment'}
                {item.note ? ` · ${item.note}` : ''}
              </Text>
              <Text style={[Type.caption, { color: theme.textSecondary }]}>{when(item.at)}</Text>
            </View>
            <Text style={[Type.bodyStrong, { color: item.amountPaise > 0 ? theme.danger : theme.accent }]}>
              {item.amountPaise > 0 ? '+' : '−'}
              {formatRupees(Math.abs(item.amountPaise))}
            </Text>
          </ListRow>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: Spacing.three, marginBottom: Spacing.three },
  list: { gap: 0 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: -Spacing.three, marginTop: -Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  summary: { flexDirection: 'row', alignItems: 'center' },
  summaryIcon: { width: 44, height: 44, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  big: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  balance: { fontSize: 32, lineHeight: 38, fontWeight: '800' },
  avatar: { width: 36, height: 36, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', paddingTop: Spacing.three },
});
