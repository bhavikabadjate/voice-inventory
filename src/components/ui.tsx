// Small shared building blocks for the shop screens.

import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export const Accent = '#208AEF';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const background =
    kind === 'primary' ? Accent : kind === 'danger' ? '#D93F3F' : theme.backgroundElement;
  const color = kind === 'secondary' ? theme.text : '#ffffff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}>
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
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
      style={[
        styles.chip,
        { backgroundColor: selected ? Accent : theme.backgroundElement },
      ]}>
      <Text style={{ color: selected ? '#ffffff' : theme.text, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.textSecondary }]}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        {...props}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement },
          props.style,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: Spacing.three - 4,
    paddingHorizontal: Spacing.three,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999 },
  field: { gap: 4, flex: 1 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { fontSize: 16, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10 },
});
