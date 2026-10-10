// Messages and yes/no questions that work the same on phones and on the web
// (React Native's Alert does nothing in a browser; see notify.web.ts).

import { Alert } from 'react-native';

export function notify(title: string, message?: string) {
  Alert.alert(title, message);
}

/** Ask before doing something that can't be undone. */
export function confirmAction(title: string, message: string, action: string, onConfirm: () => void) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
