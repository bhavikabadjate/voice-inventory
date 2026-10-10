// In a browser the tabs become a side menu on wide screens and a bar at the
// bottom on phones, with the app's name at the top.

import { TabList, TabSlot, TabTrigger, Tabs, type TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View, type View as ViewType } from 'react-native';

import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { TABS } from './tabs';
import { Icon, type IconName } from './ui';

const WIDE = 900;

export default function AppTabs() {
  const theme = useTheme();
  const wide = useWindowDimensions().width >= WIDE;

  const items = TABS.map((tab) => (
    <TabTrigger key={tab.name} name={tab.name} asChild>
      <NavItem title={tab.title} icon={tab.icon} wide={wide} />
    </TabTrigger>
  ));

  return (
    <Tabs style={[styles.root, { flexDirection: wide ? 'row' : 'column', backgroundColor: theme.background }]}>
      {wide ? (
        <View style={[styles.sidebar, { backgroundColor: theme.surface, borderRightColor: theme.border }]}>
          <Brand />
          <View style={styles.sideItems}>{items}</View>
        </View>
      ) : (
        <View style={[styles.topBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
          <Brand />
        </View>
      )}
      <TabSlot style={styles.slot} />
      {wide ? null : (
        <View style={[styles.bottomBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>{items}</View>
      )}
      <TabList style={styles.hidden}>
        {TABS.map((tab) => (
          <TabTrigger key={tab.name} name={tab.name} href={tab.href} />
        ))}
      </TabList>
    </Tabs>
  );
}

function Brand() {
  const theme = useTheme();
  return (
    <View style={styles.brand}>
      <View style={[styles.logo, { backgroundColor: theme.accent }]}>
        <Icon name={{ ios: 'storefront.fill', md: 'storefront' }} size={20} color={theme.onAccent} />
      </View>
      <Text style={[Type.section, { color: theme.text }]}>Dukaan Voice</Text>
    </View>
  );
}

type NavItemProps = TabTriggerSlotProps & { title: string; icon: IconName; wide: boolean };

const NavItem = forwardRef<ViewType, NavItemProps>(function NavItem({ title, icon, wide, isFocused, ...props }, ref) {
  const theme = useTheme();
  const color = isFocused ? theme.accent : theme.textSecondary;
  return (
    <Pressable
      ref={ref}
      {...props}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      style={({ pressed }) => [
        wide ? styles.sideItem : styles.bottomItem,
        wide && isFocused ? { backgroundColor: theme.accentSoft } : null,
        { opacity: pressed ? 0.7 : 1 },
      ]}>
      <View style={!wide && isFocused ? [styles.pill, { backgroundColor: theme.accentSoft }] : styles.pillOff}>
        <Icon name={icon} size={22} color={color} />
      </View>
      <Text style={[Type.caption, wide ? styles.sideLabel : null, { color: isFocused ? theme.accent : theme.textSecondary }]}>
        {title}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1 },
  hidden: { display: 'none' },
  sidebar: { width: 240, paddingHorizontal: Spacing.three, paddingVertical: Spacing.four, gap: Spacing.four, borderRightWidth: 1 },
  sideItems: { gap: Spacing.one },
  sideItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 10,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.md,
  },
  sideLabel: { fontSize: 15, fontWeight: '600' },
  topBar: { paddingHorizontal: Spacing.three, paddingVertical: 12, borderBottomWidth: 1 },
  bottomBar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 6, paddingBottom: 10 },
  bottomItem: { flex: 1, alignItems: 'center', gap: 2 },
  pill: { paddingHorizontal: 18, paddingVertical: 4, borderRadius: Radius.full },
  pillOff: { paddingHorizontal: 18, paddingVertical: 4 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two + Spacing.one },
  logo: { width: 34, height: 34, borderRadius: Radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
});
