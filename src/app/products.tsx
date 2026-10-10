// Products screen: search, add and edit products with several names, a unit,
// cost and selling price, stock and an optional expiry date.

import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import { confirmAction, notify } from '@/components/notify';
import { Button, Card, Chip, Field, ListRow, pageContent, Screen, ScreenHeader } from '@/components/ui';
import { Radius, Spacing, Type } from '@/constants/theme';
import { isLowStock } from '@/core/alerts';
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
    if (!names.length) return notify('Add at least one name');
    if (!draft.sell.trim()) return notify('Add the selling price');
    if (draft.expiry && !/^\d{4}-\d{2}-\d{2}$/.test(draft.expiry)) {
      return notify('Expiry date should look like 2026-10-31');
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
    confirmAction('Delete this product?', draft.names, 'Delete', async () => {
      await deleteProduct(db, id);
      setDraft(null);
      refresh();
    });
  };

  const addSamples = async () => {
    for (const p of SAMPLE_PRODUCTS) await saveProduct(db, { ...p, id: newProductId() });
    refresh();
  };

  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
    return (
      <Screen>
        <ScreenHeader title={draft.id ? 'Edit product' : 'New product'} />
        <Card>
          <View style={styles.row}>
            <Field
              label="Names (comma separated, any language)"
              value={draft.names}
              onChangeText={(names) => set({ names })}
              placeholder="Milk, dudh, दूध"
              autoFocus={!draft.id}
            />
          </View>
          <Text style={[Type.caption, { color: theme.textSecondary }]}>Sold per</Text>
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
        </Card>
        <View style={styles.row}>
          <Button style={styles.flex} title="Cancel" kind="secondary" onPress={() => setDraft(null)} />
          <Button style={styles.flex} title="Save" onPress={save} />
        </View>
        {draft.id && can.canDelete ? (
          <Button title="Delete product" kind="danger" icon={{ ios: 'trash', md: 'delete' }} onPress={remove} />
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <FlatList
        data={shown}
        keyExtractor={(p) => p.id}
        contentContainerStyle={[pageContent, styles.list]}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={styles.header}>
            <ScreenHeader
              title="Products"
              subtitle={products.length ? `${products.length} items` : undefined}
              right={<Button title="Add" icon={{ ios: 'plus', md: 'add' }} onPress={() => setDraft(EMPTY)} />}
            />
            <View style={styles.row}>
              <Field label="Search any name" value={search} onChangeText={setSearch} placeholder="dudh, cheeni…" />
            </View>
          </View>
        }
        ListEmptyComponent={
          products.length === 0 ? (
            <Card style={styles.empty}>
              <Text style={[Type.body, styles.center, { color: theme.textSecondary }]}>
                No products yet. Add your own, or start with a few sample items to try the voice questions.
              </Text>
              <Button title="Add sample items" kind="secondary" onPress={addSamples} />
            </Card>
          ) : (
            <Text style={[Type.body, styles.center, { color: theme.textSecondary }]}>Nothing matches “{search}”.</Text>
          )
        }
        renderItem={({ item, index }) => {
          const low = isLowStock(item);
          return (
            <ListRow first={index === 0} last={index === shown.length - 1} onPress={() => setDraft(toDraft(item))}>
              <View style={styles.flex}>
                <Text style={[Type.bodyStrong, { color: theme.text }]}>{item.names[0]}</Text>
                {item.names.length > 1 ? (
                  <Text style={[Type.caption, { color: theme.textSecondary }]} numberOfLines={1}>
                    {item.names.slice(1).join(', ')}
                  </Text>
                ) : null}
              </View>
              <View style={styles.itemRight}>
                <Text style={[Type.bodyStrong, { color: theme.text }]}>
                  {formatRupees(item.sellPaise)}
                  <Text style={[Type.caption, { color: theme.textSecondary }]}> / {unitLabel(item.unit)}</Text>
                </Text>
                <View style={styles.badges}>
                  {can.canSeeCost ? (
                    <Text style={[Type.caption, { color: theme.textSecondary }]}>Cost {formatRupees(item.costPaise)}</Text>
                  ) : null}
                  <View style={[styles.badge, { backgroundColor: low ? theme.warningSoft : theme.backgroundElement }]}>
                    <Text style={[Type.caption, { color: low ? theme.warning : theme.textSecondary }]}>
                      Stock {item.stock}
                    </Text>
                  </View>
                </View>
              </View>
            </ListRow>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  header: { gap: Spacing.three, marginBottom: Spacing.three },
  row: { flexDirection: 'row', gap: Spacing.three },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  list: { gap: 0 },
  empty: { alignItems: 'stretch' },
  itemRight: { alignItems: 'flex-end', gap: 4 },
  badges: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.full },
});
