// Small shared building blocks for the shop screens: page layout, cards, list
// rows, buttons, chips, text fields and icons, all drawn from the theme.

import { SymbolView, type AndroidSymbol, type SFSymbol } from 'expo-symbols';
import { useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** An SF Symbol on iOS and the matching Material Symbol on Android and the web. */
export type IconName = { ios: SFSymbol; md: AndroidSymbol };

export function Icon({ name, size = 22, color }: { name: IconName; size?: number; color?: string }) {
  const theme = useTheme();
  return (
    <SymbolView
      name={{ ios: name.ios, android: name.md, web: name.md }}
      size={size}
      tintColor={color ?? theme.text}
    />
  );
}

/**
 * A tab's page: the shop background, a readable width, and room for the tab
 * bar. A page with a long list passes `scroll={false}` and gives its list
 * `contentContainerStyle={pageContent}`.
 */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={styles.flex}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** The big title at the top of a page, with an optional line under it and a control on the right. */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.flex}>
        <Text style={[Type.title, { color: theme.text }]}>{title}</Text>
        {subtitle ? <Text style={[Type.body, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={[Type.section, { color: theme.text }]}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      {children}
    </View>
  );
}

/**
 * One row of a grouped list. Rows sit together in one rounded block; `first`
 * and `last` round its corners and a hairline separates the rows.
 */
export function ListRow({
  children,
  onPress,
  first,
  last,
}: {
  children: ReactNode;
  onPress?: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.backgroundElement : theme.surface,
          borderColor: theme.border,
          borderTopWidth: first ? 1 : 0,
          borderTopLeftRadius: first ? Radius.lg : 0,
          borderTopRightRadius: first ? Radius.lg : 0,
          borderBottomLeftRadius: last ? Radius.lg : 0,
          borderBottomRightRadius: last ? Radius.lg : 0,
          borderBottomWidth: last ? 1 : StyleSheet.hairlineWidth,
        },
      ]}>
      {children}
      {onPress ? <Icon name={{ ios: 'chevron.right', md: 'chevron_right' }} size={18} color={theme.placeholder} /> : null}
    </Pressable>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const look = {
    primary: { bg: theme.accent, fg: theme.onAccent, border: theme.accent },
    secondary: { bg: theme.surface, fg: theme.text, border: theme.border },
    danger: { bg: theme.dangerSoft, fg: theme.danger, border: theme.dangerSoft },
    ghost: { bg: 'transparent', fg: theme.accent, border: 'transparent' },
  }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.bg, borderColor: look.border, opacity: disabled ? 0.45 : pressed ? 0.75 : 1 },
        style,
      ]}>
      {icon ? <Icon name={icon} size={20} color={look.fg} /> : null}
      <Text style={[Type.bodyStrong, { color: look.fg }]}>{title}</Text>
    </Pressable>
  );
}

/** A round button with only an icon, such as Send. */
export function IconButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: theme.accent, opacity: disabled ? 0.35 : pressed ? 0.75 : 1 },
      ]}>
      <Icon name={icon} size={22} color={theme.onAccent} />
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? theme.accentSoft : theme.surface,
          borderColor: selected ? theme.accent : theme.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}>
      <Text style={[Type.caption, styles.chipText, { color: selected ? theme.accent : theme.text }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[Type.caption, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.placeholder}
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          Type.body,
          styles.input,
          { color: theme.text, backgroundColor: theme.surface, borderColor: focused ? theme.accent : theme.border },
          props.style,
        ]}
      />
    </View>
  );
}

/** A coloured note across the page, such as "3 items need attention". */
export function Banner({ tone, icon, children }: { tone: 'warning' | 'danger'; icon: IconName; children: ReactNode }) {
  const theme = useTheme();
  const fg = tone === 'warning' ? theme.warning : theme.danger;
  const bg = tone === 'warning' ? theme.warningSoft : theme.dangerSoft;
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Icon name={icon} size={20} color={fg} />
      <Text style={[Type.bodyStrong, styles.flex, { color: fg }]}>{children}</Text>
    </View>
  );
}

export const pageContent: ViewStyle = {
  paddingHorizontal: Spacing.three,
  paddingTop: Spacing.four,
  paddingBottom: BottomTabInset + Spacing.five,
  gap: Spacing.three,
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  page: pageContent,
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, marginBottom: Spacing.one },
  card: { borderWidth: 1, borderRadius: Radius.lg, padding: Spacing.three, gap: Spacing.three },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 14,
    paddingHorizontal: Spacing.three,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  button: {
    minHeight: 48,
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButton: { width: 48, height: 48, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: Radius.full, borderWidth: 1 },
  chipText: { fontWeight: '600' },
  field: { gap: 6, flex: 1 },
  input: {
    minHeight: 48,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    ...Platform.select({ web: { outlineStyle: 'none' } as object }),
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.md,
  },
});
