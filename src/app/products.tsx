// Products screen: search, add and edit products with several names, a unit,
// cost and selling price, stock and an optional expiry date.

import { useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Chip, Field } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { formatRupees, type Product } from '@/core/billing';
import { findProducts } from '@/core/names';
import { unitLabel, type Unit } from '@/core/units';
import { deleteProduct, newProductId, saveProduct, useAccount, useProducts } from '@/data/db';
import { SAMPLE_PRODUCTS } from '@/data/samples';
import { useTheme } from '@/hooks/use-theme';

const UNITS: { unit: Unit; label: string }[] = [
  { unit: 'l', label: 'Litre' },
  { unit: 'kg', label: 'Kg' },
  { unit: 'piece', label: 'Piece' },
  { unit: 'dozen', label: 'Dozen' },
  { unit: 'custom:packet', label: 'Packet' },
  { unit: 'custom:box', label: 'Box' },
  { unit: 'custom:bottle', label: 'Bottle' },
];

interface Draft {
  id: string | null;
  names: string;
  unit: Unit;
  sell: string;
  cost: string;
  stock: string;
  expiry: string;
  lowAt: string;
}

const EMPTY: Draft = { id: null, names: '', unit: 'kg', sell: '', cost: '', stock: '', expiry: '', lowAt: '' };

function toDraft(p: Product): Draft {
  return {
    id: p.id,
    names: p.names.join(', '),
    unit: p.unit,
    sell: String(p.sellPaise / 100),
    cost: String(p.costPaise / 100),
    stock: String(p.stock),
    expiry: p.expiry ?? '',
    lowAt: p.lowStockAt !== undefined ? String(p.lowStockAt) : '',
  };
}

function toPaise(text: string): number {
  return Math.round(Number(text.replace(/[^\d.]/g, '')) * 100);
}

export default function ProductsScreen() {
  const theme = useTheme();
  const { db, products, refresh } = useProducts();
  const { can } = useAccount();
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const shown = search.trim() ? findProducts(search, products).map((m) => m.product) : products;

  const save = async () => {
    if (!draft) return;
    const names = draft.names.split(/[,\n]/).map((n) => n.trim()).filter(Boolean);
    if (!names.length) return Alert.alert('Add at least one name');
    if (!draft.sell.trim()) return Alert.alert('Add the selling price');
    if (draft.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(draft.expiry)) {
      return Alert.alert('Expiry date should look like 2026-10-31');
    }
    await saveProduct(db, {
      id: draft.id ?? newProductId(),
      names,
      unit: draft.unit,
      sellPaise: toPaise(draft.sell),
      costPaise: draft.cost.trim() ? toPaise(draft.cost) : 0,
      stock: Number(draft.stock) || 0,
      expiry: draft.expiry || undefined,
      lowStockAt: draft.lowAt.trim() ? Number(draft.lowAt) || 0 : undefined,
    });
    setDraft(null);
    refresh();
  };

  const remove = () => {
    if (!draft?.id) return;
    const id = draft.id;
    Alert.alert('Delete this product?', draft.names, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteProduct(db, id);
          setDraft(null);
          refresh();
        },
      },
    ]);
  };

  const addSamples = async () => {
    for (const p of SAMPLE_PRODUCTS) await saveProduct(db, { ...p, id: newProductId() });
    refresh();
  };

  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.form}>
            <Text style={[styles.title, { color: theme.text }]}>
              {draft.id ? 'Edit product' : 'New product'}
            </Text>
            <View style={styles.row}>
              <Field
                label="Names (comma separated, any language)"
                value={draft.names}
                onChangeText={(names) => set({ names })}
                placeholder="Milk, dudh, दूध"
                autoFocus={!draft.id}
              />
            </View>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Sold per</Text>
            <View style={styles.chips}>
              {UNITS.map((u) => (
                <Chip key={u.unit} label={u.label} selected={draft.unit === u.unit} onPress={() => set({ unit: u.unit })} />
              ))}
            </View>
            <View style={styles.row}>
              <Field label="Selling price ₹" value={draft.sell} onChangeText={(sell) => set({ sell })} keyboardType="decimal-pad" placeholder="56" />
              {can.canSeeCost ? (
                <Field label="Cost price ₹ (never spoken)" value={draft.cost} onChangeText={(cost) => set({ cost })} keyboardType="decimal-pad" placeholder="48" />
              ) : null}
            </View>
            <View style={styles.row}>
              <Field label={`Stock (${unitLabel(draft.unit)})`} value={draft.stock} onChangeText={(stock) => set({ stock })} keyboardType="decimal-pad" placeholder="20" />
              <Field label="Expiry (optional)" value={draft.expiry} onChangeText={(expiry) => set({ expiry })} placeholder="2026-10-31" />
            </View>
            <View style={styles.row}>
              <Field
                label={`Warn when stock is at or below (${unitLabel(draft.unit)}, optional)`}
                value={draft.lowAt}
                onChangeText={(lowAt) => set({ lowAt })}
                keyboardType="decimal-pad"
                placeholder="5"
              />
            </View>
            <Button title="Save" onPress={save} />
            <Button title="Cancel" kind="secondary" onPress={() => setDraft(null)} />
            {draft.id && can.canDelete ? <Button title="Delete" kind="danger" onPress={remove} /> : null}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <View style={styles.row}>
            <Field label="Search any name" value={search} onChangeText={setSearch} placeholder="dudh, cheeni…" />
          </View>
          <Button title="+ Add product" onPress={() => setDraft(EMPTY)} />
        </View>
        <FlatList
          data={shown}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            products.length === 0 ? (
              <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
                  No products yet. Add your own, or start with a few sample items to try the voice questions.
                </Text>
                <Button title="Add sample items" kind="secondary" onPress={addSamples} />
              </View>
            ) : (
              <Text style={[styles.emptyText, { color: theme.textSecondary }]}>Nothing matches “{search}”.</Text>
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setDraft(toDraft(item))}
              style={({ pressed }) => [styles.item, { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.itemName, { color: theme.text }]}>{item.names[0]}</Text>
                <Text style={[styles.itemSub, { color: theme.textSecondary }]} numberOfLines={1}>
                  {item.names.slice(1).join(', ') || ' '}
                </Text>
              </View>
              <View style={styles.itemRight}>
                <Text style={[styles.itemPrice, { color: theme.text }]}>
                  {formatRupees(item.sellPaise)} / {unitLabel(item.unit)}
                </Text>
                <Text style={[styles.itemSub, { color: theme.textSecondary }]}>
                  Stock {item.stock}
                  {can.canSeeCost ? ` · Cost ${formatRupees(item.costPaise)}` : ''}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  header: { padding: Spacing.three, gap: Spacing.three },
  form: { padding: Spacing.four, gap: Spacing.three },
  title: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  list: { paddingHorizontal: Spacing.three, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.two },
  empty: { gap: Spacing.three, paddingTop: Spacing.four },
  emptyText: { textAlign: 'center', fontSize: 15 },
  item: { flexDirection: 'row', padding: Spacing.three, borderRadius: 12, gap: Spacing.two },
  itemName: { fontSize: 17, fontWeight: '700' },
  itemSub: { fontSize: 13 },
  itemRight: { alignItems: 'flex-end', justifyContent: 'center' },
  itemPrice: { fontSize: 16, fontWeight: '600' },
});
