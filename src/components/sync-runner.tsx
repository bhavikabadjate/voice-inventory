// Keeps the phone in sync with the shop's cloud copy while the app is open.

import { useSQLiteContext } from 'expo-sqlite';
import { useEffect } from 'react';

import { startSync } from '@/data/cloud';

export function SyncRunner() {
  const db = useSQLiteContext();
  useEffect(() => startSync(db), [db]);
  return null;
}
