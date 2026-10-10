// Browser version of notify.ts.

export function notify(title: string, message?: string) {
  window.alert(message ? `${title}\n\n${message}` : title);
}

export function confirmAction(title: string, message: string, _action: string, onConfirm: () => void) {
  if (window.confirm(message ? `${title}\n\n${message}` : title)) onConfirm();
}
