// Shop tab: what needs attention (expiring and low-stock items), the shop
// details printed on bills (name, phone, UPI ID for the payment QR code), and
// cloud backup with staff logins.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AccountSection } from '@/components/account-section';
import { notify } from '@/components/notify';
import { Button, Card, Field, Icon, ListRow, Screen, ScreenHeader, SectionTitle } from '@/components/ui';
import { Spacing, Type } from '@/constants/theme';
import { alertCount, findAlerts } from '@/core/alerts';
import { emptyShop, type Shop } from '@/core/bill-document';
import { unitLabel } from '@/core/units';
import { updateShop } from '@/data/cloud';
import { getShop, subscribeData, useAccount, useProducts } from '@/data/db';
import { useTheme } from '@/hooks/use-theme';

export default function ShopScreen() {
  const theme = useTheme();
  const { db, products, refresh } = useProducts();
  const [shop, setShop] = useState<Shop>(emptyShop);
  const { can } = useAccount();

  useFocusEffect(
    useCallback(() => {
      refresh();
      getShop(db).then(setShop);
    }, [db, refresh]),
  );
  // The owner's changes to shop details reach staff phones with a sync.
  useEffect(() => subscribeData(() => void getShop(db).then(setShop)), [db]);

  const alerts = findAlerts(products, new Date());
  const save = async () => {
    if (shop.upiId && !/^[\w.-]+@[\w.-]+$/.test(shop.upiId.trim())) {
      return notify('UPI ID should look like name@okaxis');
    }
    try {
      await updateShop(db, shop);
      notify('Saved');
    } catch {
      notify('Saved on this phone', 'It will reach staff phones at the next sync.');
    }
  };

  const rows = [
    ...alerts.expiring.map(({ product, daysLeft }) => ({
      key: `e-${product.id}`,
      name: product.names[0],
      text: daysLeft < 0 ? 'Expired' : daysLeft === 0 ? 'Expires today' : `Expires in ${daysLeft} days`,
      urgent: daysLeft <= 0,
    })),
    ...alerts.lowStock.map((p) => ({
      key: `l-${p.id}`,
      name: p.names[0],
      text: p.stock <= 0 ? 'Out of stock' : `Only ${p.stock} ${unitLabel(p.unit)} left`,
      urgent: p.stock <= 0,
    })),
  ];

  return (
    <Screen>
      <ScreenHeader title="Shop" />

      <SectionTitle>Needs attention</SectionTitle>
      {alertCount(alerts) === 0 ? (
        <Card style={styles.allGood}>
          <Icon name={{ ios: 'checkmark.seal.fill', md: 'verified' }} size={22} color={theme.accent} />
          <Text style={[Type.body, { color: theme.textSecondary }]}>Nothing is expiring or running low.</Text>
        </Card>
      ) : (
        <View>
          {rows.map((r, i) => (
            <ListRow key={r.key} first={i === 0} last={i === rows.length - 1}>
              <Text style={[Type.bodyStrong, styles.flex, { color: theme.text }]}>{r.name}</Text>
              <Text style={[Type.caption, styles.strong, { color: r.urgent ? theme.danger : theme.warning }]}>{r.text}</Text>
            </ListRow>
          ))}
        </View>
      )}

      {can.isOwner ? (
        <>
          <SectionTitle>Shop details for bills</SectionTitle>
          <Card>
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
          </Card>
        </>
      ) : null}

      <AccountSection />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  strong: { fontWeight: '700' },
  row: { flexDirection: 'row' },
  allGood: { flexDirection: 'row', alignItems: 'center' },
});
