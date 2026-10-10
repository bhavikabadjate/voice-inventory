// The shop in the cloud (Supabase): signing in, joining as staff, managing
// the team, and keeping this phone in sync. The phone keeps working offline;
// changes wait in the outbox until the next sync.

import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import type { SQLiteDatabase } from 'expo-sqlite';
import Storage from 'expo-sqlite/kv-store';
import { AppState } from 'react-native';

import { SUPABASE_KEY, SUPABASE_URL } from '@/config';
import type { Shop } from '@/core/bill-document';
import { syncOnce, type Membership, type Remote, type RemoteShop, type Table } from '@/core/sync';

import {
  emitDataChanged,
  getAccount,
  linkExistingStore,
  linkNewStore,
  onOutbox,
  saveShop,
  getShop,
  sqliteLocal,
  unlinkStore,
} from './db';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    storage: Storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh the login only while the app is open.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function userId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error('Not signed in');
  return id;
}

const CONFLICT_KEY: Record<Table, string> = {
  products: 'id',
  product_costs: 'product_id',
  stock_moves: 'id',
  sales: 'id',
  customers: 'id',
  khata_entries: 'id',
};

function supabaseRemote(storeId: string): Remote {
  return {
    async upsert(table, rows) {
      // Stock movements, sales and khata entries never change once made, so a repeat is skipped.
      const onlyNew = table === 'stock_moves' || table === 'sales' || table === 'khata_entries';
      check(await supabase.from(table).upsert(rows, { onConflict: CONFLICT_KEY[table], ignoreDuplicates: onlyNew }));
    },
    async pull<T>(table: Table, column: string, since: string | null, limit: number) {
      let query = supabase.from(table).select('*').eq('store_id', storeId);
      if (since) query = query.gte(column, since);
      return check(await query.order(column).limit(limit)) as T[];
    },
    async membership() {
      const id = await userId();
      return check(
        await supabase
          .from('members')
          .select('role, name, can_see_cost, can_delete')
          .eq('store_id', storeId)
          .eq('user_id', id)
          .maybeSingle(),
      ) as Membership | null;
    },
    async shop() {
      return check(
        await supabase.from('stores').select('name, code, upi_id, phone').eq('id', storeId).maybeSingle(),
      ) as RemoteShop | null;
    },
  };
}

// ---- Sync ---------------------------------------------------------------

export type SyncState = { status: 'idle' | 'syncing' | 'offline' | 'removed'; lastSynced: Date | null; error?: string };

let syncState: SyncState = { status: 'idle', lastSynced: null };
const stateListeners = new Set<(s: SyncState) => void>();

function setSyncState(s: SyncState) {
  syncState = s;
  for (const l of stateListeners) l(s);
}

export function getSyncState() {
  return syncState;
}

export function subscribeSyncState(listener: (s: SyncState) => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

let running: Promise<void> | null = null;
let again = false;

/** Sync now, or right after the sync already running. */
export function syncNow(db: SQLiteDatabase): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncPass(db);
      } while (again);
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncPass(db: SQLiteDatabase) {
  const { store } = await getAccount(db);
  if (!store) return;
  const { data } = await supabase.auth.getSession();
  if (!data.session) return;
  setSyncState({ ...syncState, status: 'syncing' });
  try {
    // Only the owner edits shop details, so the owner's copy is the one to keep.
    const { membership } = await getAccount(db);
    if (membership?.role === 'owner') await pushShop(db, await getShop(db));
    const result = await syncOnce(sqliteLocal(db), supabaseRemote(store.id), store.id);
    if (!result.membership) {
      // The owner removed this person from the shop.
      setSyncState({ status: 'removed', lastSynced: syncState.lastSynced });
      return;
    }
    setSyncState({ status: 'idle', lastSynced: new Date() });
    emitDataChanged();
  } catch (e) {
    setSyncState({ ...syncState, status: 'offline', error: e instanceof Error ? e.message : String(e) });
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keep this phone in sync: shortly after each local change, whenever the app
 * comes back to the front, and every 30 seconds while it is open.
 */
export function startSync(db: SQLiteDatabase): () => void {
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => syncNow(db), 1500);
  };
  onOutbox(soon);
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') syncNow(db);
  });
  const interval = setInterval(() => {
    if (AppState.currentState === 'active') syncNow(db);
  }, 30_000);
  syncNow(db);
  return () => {
    onOutbox(null);
    appState.remove();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
  };
}

// ---- Owner: sign in with a code sent by email ---------------------------

export async function sendOwnerCode(email: string) {
  check(await supabase.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } }));
}

/**
 * Finish the owner's sign-in. If they already own a shop (a new or reset
 * phone), its data comes down from the cloud. Otherwise a shop is created and
 * this phone's products go up.
 */
export async function verifyOwnerCode(db: SQLiteDatabase, email: string, code: string, ownerName: string) {
  check(await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' }));
  const id = await userId();
  const existing = check(
    await supabase
      .from('members')
      .select('store_id, name, can_see_cost, can_delete, stores(code)')
      .eq('user_id', id)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle(),
  ) as { store_id: string; name: string; can_see_cost: boolean; can_delete: boolean; stores: { code: string } | null } | null;

  if (existing) {
    await linkExistingStore(
      db,
      { id: existing.store_id, code: existing.stores?.code ?? '' },
      { role: 'owner', name: existing.name, can_see_cost: true, can_delete: true },
    );
    await syncNow(db);
    return { restored: true };
  }

  const shop = await getShop(db);
  const store = check(
    await supabase.rpc('create_store', { shop_name: shop.name, owner_name: ownerName.trim() }),
  ) as { id: string; code: string };
  await linkNewStore(db, { id: store.id, code: store.code }, { role: 'owner', name: ownerName.trim(), can_see_cost: true, can_delete: true });
  await pushShop(db, shop);
  await syncNow(db);
  return { restored: false };
}

// ---- Staff: join with the shop's 6-digit code ---------------------------

export async function joinAsStaff(db: SQLiteDatabase, code: string, name: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) check(await supabase.auth.signInAnonymously());
  const store = check(
    await supabase.rpc('join_store', { join_code: code.trim(), staff_name: name.trim() }),
  ) as { id: string; code: string };
  await linkExistingStore(db, { id: store.id, code: store.code }, {
    role: 'staff', name: name.trim(), can_see_cost: false, can_delete: false,
  });
  await syncNow(db);
}

/** Leave the shop on this phone. A staff phone also forgets the shop's data. */
export async function signOut(db: SQLiteDatabase) {
  const { membership } = await getAccount(db);
  await unlinkStore(db, membership?.role !== 'owner');
  await supabase.auth.signOut();
  setSyncState({ status: 'idle', lastSynced: null });
}

// ---- Owner: shop details and the team -----------------------------------

/** Save the shop details on this phone, and in the cloud for the owner. */
export async function updateShop(db: SQLiteDatabase, shop: Shop) {
  await saveShop(db, shop);
  const { membership } = await getAccount(db);
  if (membership?.role === 'owner') await pushShop(db, shop);
}

async function pushShop(db: SQLiteDatabase, shop: Shop) {
  const { store } = await getAccount(db);
  if (!store) return;
  check(await supabase.from('stores').update({ name: shop.name, upi_id: shop.upiId, phone: shop.phone }).eq('id', store.id));
}

export interface TeamMember extends Membership {
  user_id: string;
}

export async function listTeam(db: SQLiteDatabase): Promise<TeamMember[]> {
  const { store } = await getAccount(db);
  if (!store) return [];
  return check(
    await supabase
      .from('members')
      .select('user_id, role, name, can_see_cost, can_delete')
      .eq('store_id', store.id)
      .order('joined_at'),
  ) as TeamMember[];
}

export async function setPermissions(
  db: SQLiteDatabase,
  userIdToChange: string,
  patch: Partial<Pick<Membership, 'can_see_cost' | 'can_delete'>>,
) {
  const { store } = await getAccount(db);
  if (!store) return;
  check(await supabase.from('members').update(patch).eq('store_id', store.id).eq('user_id', userIdToChange));
}

export async function removeMember(db: SQLiteDatabase, userIdToRemove: string) {
  const { store } = await getAccount(db);
  if (!store) return;
  check(await supabase.from('members').delete().eq('store_id', store.id).eq('user_id', userIdToRemove));
}
