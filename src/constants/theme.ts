/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1C1B18',
    textSecondary: '#6B675F',
    placeholder: '#A9A49A',
    background: '#F6F4EF',
    surface: '#FFFFFF',
    backgroundElement: '#EFECE5',
    backgroundSelected: '#E4E0D6',
    border: '#E3DFD5',
    accent: '#0F7A55',
    accentSoft: '#E2F2EA',
    onAccent: '#FFFFFF',
    danger: '#C93A31',
    dangerSoft: '#FBE9E7',
    warning: '#A85F00',
    warningSoft: '#FDF1DC',
  },
  dark: {
    text: '#F3F2EE',
    textSecondary: '#A9A69E',
    placeholder: '#6E6B64',
    background: '#121311',
    surface: '#1C1E1B',
    backgroundElement: '#262925',
    backgroundSelected: '#30342F',
    border: '#2E322D',
    accent: '#3DC48F',
    accentSoft: '#173527',
    onAccent: '#08130D',
    danger: '#F0776E',
    dangerSoft: '#3A1D1A',
    warning: '#F2B45A',
    warningSoft: '#3A2C14',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = { sm: 8, md: 12, lg: 16, full: 999 } as const;

/** Named text styles, so screens never pick font sizes of their own. */
export const Type = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  section: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 720;
