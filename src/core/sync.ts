// Keeps every phone of a shop in step through the cloud.
//
// Each local change is written to an outbox first, so it survives being
// offline. A sync pushes the outbox, then pulls what other phones changed
// since the last pull. Stock travels as movements (+10 restock, -2 sale), so
// two phones selling at once both count. Product details and prices are
// "last change wins". Cost prices only travel for people allowed to see them.
// Khata entries are like stock movements: added, never changed.
//
// This file only holds the logic; `src/data/cloud.ts` connects it to SQLite
// on the phone and to Supabase.

export interface RemoteProduct {
  id: string;
  store_id: string;
  names: string[];
  unit: string;
  sell_paise: number;
  expiry: string | null;
  low_stock_at: number | null;
  deleted: boolean;
  updated_at?: string;
}

export interface RemoteCost {
  product_id: string;
  store_id: string;
  cost_paise: number;
  updated_at?: string;
}

export interface RemoteMove {
  id: string;
  store_id: string;
  product_id: string;
  delta: number;
  reason: 'restock' | 'sale' | 'set' | 'create';
  created_at: string;
  synced_at?: string;
}

export interface RemoteSale {
  id: string;
  store_id: string;
  bill_id: string;
  product_id: string;
  qty: number;
  sell_paise: number;
  amount_paise: number;
  sold_at: string;
  synced_at?: string;
}

export interface RemoteCustomer {
  id: string;
  store_id: string;
  name: string;
  phone: string;
  deleted: boolean;
  updated_at?: string;
}

export interface RemoteKhataEntry {
  id: string;
  store_id: string;
  customer_id: string;
  amount_paise: number;
  note: string;
  bill_id: string | null;
  created_at: string;
  synced_at?: string;
}

export interface Membership {
  role: 'owner' | 'staff';
  name: string;
  can_see_cost: boolean;
  can_delete: boolean;
}

export interface RemoteShop {
  name: string;
  code: string;
  upi_id: string;
  phone: string;
}

/** Outbox entries, without store_id (added at push time). */
export type OutboxEntry =
  | { id: number; kind: 'product'; row: Omit<RemoteProduct, 'store_id'> }
  | { id: number; kind: 'cost'; row: Omit<RemoteCost, 'store_id'> }
  | { id: number; kind: 'move'; row: Omit<RemoteMove, 'store_id'> }
  | { id: number; kind: 'sale'; row: Omit<RemoteSale, 'store_id'> }
  | { id: number; kind: 'customer'; row: Omit<RemoteCustomer, 'store_id'> }
  | { id: number; kind: 'khata'; row: Omit<RemoteKhataEntry, 'store_id'> };

export type Table = 'products' | 'product_costs' | 'stock_moves' | 'sales' | 'customers' | 'khata_entries';

export interface Local {
  outbox(): Promise<OutboxEntry[]>;
  clearOutbox(ids: number[]): Promise<void>;
  cursor(table: Table): Promise<string | null>;
  setCursor(table: Table, value: string): Promise<void>;
  /** Product details from another phone; stock and cost are left alone. */
  putProduct(p: RemoteProduct): Promise<void>;
  putCost(c: RemoteCost): Promise<void>;
  /** Record the movement and change stock, unless it was already applied. */
  applyMove(m: RemoteMove): Promise<void>;
  /** Store the sale unless it is already there. */
  putSale(s: RemoteSale): Promise<void>;
  /** Customer details from another phone (the balance comes from khata entries). */
  putCustomer(c: RemoteCustomer): Promise<void>;
  /** Store the khata entry unless it is already there. */
  putKhata(k: RemoteKhataEntry): Promise<void>;
  setMembership(m: Membership): Promise<void>;
  setShop(s: RemoteShop): Promise<void>;
}

export interface Remote {
  upsert(table: Table, rows: object[]): Promise<void>;
  /** Rows of `table` for the shop whose `column` is at or after `since`, oldest first. */
  pull<T>(table: Table, column: string, since: string | null, limit: number): Promise<T[]>;
  membership(): Promise<Membership | null>;
  shop(): Promise<RemoteShop | null>;
}

export const PAGE = 500;

const TABLE_OF: Record<OutboxEntry['kind'], Table> = {
  product: 'products',
  cost: 'product_costs',
  move: 'stock_moves',
  sale: 'sales',
  customer: 'customers',
  khata: 'khata_entries',
};

// Parents before children, so the server's foreign keys are satisfied.
const PUSH_ORDER: OutboxEntry['kind'][] = ['product', 'cost', 'customer', 'move', 'sale', 'khata'];

const CURSOR_COLUMN: Record<Table, string> = {
  products: 'updated_at',
  product_costs: 'updated_at',
  stock_moves: 'synced_at',
  sales: 'synced_at',
  customers: 'updated_at',
  khata_entries: 'synced_at',
};

export async function push(local: Local, remote: Remote, storeId: string, canSeeCost: boolean): Promise<number> {
  const entries = await local.outbox();
  if (!entries.length) return 0;
  for (const kind of PUSH_ORDER) {
    const ofKind = entries.filter((e) => e.kind === kind);
    if (!ofKind.length || (kind === 'cost' && !canSeeCost)) continue;
    // Only the newest version of each product or cost needs to go up.
    const latest = new Map<string, object>();
    for (const e of ofKind) {
      const key = 'product_id' in e.row && kind === 'cost' ? e.row.product_id : (e.row as { id: string }).id;
      latest.set(key, { ...e.row, store_id: storeId });
    }
    await remote.upsert(TABLE_OF[kind], [...latest.values()]);
  }
  await local.clearOutbox(entries.map((e) => e.id));
  return entries.length;
}

async function pullTable<T>(
  local: Local,
  remote: Remote,
  table: Table,
  apply: (row: T) => Promise<void>,
): Promise<number> {
  const column = CURSOR_COLUMN[table];
  let since = await local.cursor(table);
  let count = 0;
  for (;;) {
    const rows = await remote.pull<T>(table, column, since, PAGE);
    for (const row of rows) await apply(row);
    count += rows.length;
    if (!rows.length) break;
    const last = (rows[rows.length - 1] as Record<string, string>)[column];
    // Pulls start at the cursor itself (rows sharing a timestamp aren't
    // skipped); applying a row twice is harmless.
    if (last === since && rows.length < PAGE) break;
    if (last === since) throw new Error(`More than ${PAGE} ${table} rows share one timestamp`);
    since = last;
    await local.setCursor(table, since);
    if (rows.length < PAGE) break;
  }
  return count;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  membership: Membership | null;
}

/** One full sync: push local changes, then pull everyone else's. */
export async function syncOnce(local: Local, remote: Remote, storeId: string): Promise<SyncResult> {
  const membership = await remote.membership();
  if (!membership) return { pushed: 0, pulled: 0, membership: null };
  await local.setMembership(membership);
  const canSeeCost = membership.role === 'owner' || membership.can_see_cost;

  const pushed = await push(local, remote, storeId, canSeeCost);

  const shop = await remote.shop();
  if (shop) await local.setShop(shop);

  let pulled = 0;
  pulled += await pullTable<RemoteProduct>(local, remote, 'products', (p) => local.putProduct(p));
  if (canSeeCost) {
    pulled += await pullTable<RemoteCost>(local, remote, 'product_costs', (c) => local.putCost(c));
  }
  pulled += await pullTable<RemoteMove>(local, remote, 'stock_moves', (m) => local.applyMove(m));
  pulled += await pullTable<RemoteSale>(local, remote, 'sales', (s) => local.putSale(s));
  pulled += await pullTable<RemoteCustomer>(local, remote, 'customers', (c) => local.putCustomer(c));
  pulled += await pullTable<RemoteKhataEntry>(local, remote, 'khata_entries', (k) => local.putKhata(k));
  return { pushed, pulled, membership };
}

/** Random id for rows made on this phone, unique across phones. */
export function newSyncId(prefix: string): string {
  const rand = Array.from({ length: 12 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}
