// Shop tab: what needs attention (expiring and low-stock items) and the shop
// details printed on bills (name, phone, UPI ID for the payment QR code).

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field } from '@/components/ui';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { alertCount, findAlerts } from '@/core/alerts';
import { emptyShop, type Shop } from '@/core/bill-document';
import { unitLabel } from '@/core/units';
import { getShop, saveShop, useProducts } from '@/data/db';
import { useTheme } from '@/hooks/use-theme';

export default function ShopScreen() {
  const theme = useTheme();
  const { db, products, refresh } = useProducts();
  const [shop, setShop] = useState<Shop>(emptyShop);

  useFocusEffect(
    useCallback(() => {
      refresh();
      getShop(db).then(setShop);
    }, [db, refresh]),
  );

  const alerts = findAlerts(products, new Date());
  const save = async () => {
    if (shop.upiId && !/^[\w.-]+@[\w.-]+$/.test(shop.upiId.trim())) {
      return Alert.alert('UPI ID should look like name@okaxis');
    }
    await saveShop(db, shop);
    Alert.alert('Saved');
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.title, { color: theme.text }]}>Needs attention</Text>
          {alertCount(alerts) === 0 ? (
            <Text style={{ color: theme.textSecondary }}>Nothing is expiring or running low.</Text>
          ) : null}
          {alerts.expiring.map(({ product, daysLeft }) => (
            <View key={`e-${product.id}`} style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.itemName, { color: theme.text }]}>{product.names[0]}</Text>
              <Text style={{ color: daysLeft < 0 ? '#D93F3F' : '#C77700', fontWeight: '600' }}>
                {daysLeft < 0 ? 'Expired' : daysLeft === 0 ? 'Expires today' : `Expires in ${daysLeft} days`}
              </Text>
            </View>
          ))}
          {alerts.lowStock.map((p) => (
            <View key={`l-${p.id}`} style={[styles.item, { backgroundColor: theme.backgroundElement }]}>
              <Text style={[styles.itemName, { color: theme.text }]}>{p.names[0]}</Text>
              <Text style={{ color: p.stock <= 0 ? '#D93F3F' : '#C77700', fontWeight: '600' }}>
                {p.stock <= 0 ? 'Out of stock' : `Only ${p.stock} ${unitLabel(p.unit)} left`}
              </Text>
            </View>
          ))}

          <Text style={[styles.title, { color: theme.text }]}>Shop details for bills</Text>
          <View style={styles.row}>
            <Field label="Shop name" value={shop.name} onChangeText={(name) => setShop({ ...shop, name })} placeholder="Sharma Kirana Store" />
          </View>
          <View style={styles.row}>
            <Field label="Phone" value={shop.phone} onChangeText={(phone) => setShop({ ...shop, phone })} keyboardType="phone-pad" placeholder="98765 43210" />
          </View>
          <View style={styles.row}>
            <Field
              label="UPI ID (for the payment QR on bills)"
              value={shop.upiId}
              onChangeText={(upiId) => setShop({ ...shop, upiId })}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="sharma@okaxis"
            />
          </View>
          <Button title="Save" onPress={save} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: { padding: Spacing.four, paddingBottom: BottomTabInset + Spacing.four, gap: Spacing.three },
  title: { fontSize: 20, fontWeight: '700', marginTop: Spacing.two },
  row: { flexDirection: 'row' },
  item: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: Spacing.three, borderRadius: 12 },
  itemName: { fontSize: 16, fontWeight: '600' },
});
