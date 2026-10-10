// Products stored on the phone with SQLite, so price questions and edits work
// without internet. Once the phone is linked to a shop in the cloud, every
// change is also written to an outbox that `src/data/cloud.ts` sends up.

import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import { emptyShop, type Shop } from '@/core/bill-document';
import type { Product } from '@/core/billing';
import type { Action } from '@/core/conversation';
import {
  newSyncId,
  type Local,
  type Membership,
  type OutboxEntry,
  type RemoteMove,
  type RemoteProduct,
  type Table,
} from '@/core/sync';
import type { Unit } from '@/core/units';

export const DATABASE_NAME = 'dukaan.db';

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
      names TEXT NOT NULL,
      unit TEXT NOT NULL,
      sell_paise INTEGER NOT NULL,
      cost_paise INTEGER NOT NULL,
      stock REAL NOT NULL DEFAULT 0,
      expiry TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bill_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      qty REAL NOT NULL,
      sell_paise INTEGER NOT NULL,
      amount_paise INTEGER NOT NULL,
      sold_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      sell_paise INTEGER NOT NULL,
      cost_paise INTEGER NOT NULL,
      changed_at TEXT NOT NULL
    );
  `);
  // Later schema changes, applied once each, in order.
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version < 1) {
    await db.execAsync(`
      ALTER TABLE products ADD COLUMN low_stock_at REAL;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  }
  if (version < 2) {
    await db.execAsync(`
      ALTER TABLE products ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE sales ADD COLUMN sync_id TEXT;
      UPDATE sales SET sync_id = 's_' || lower(hex(randomblob(10))) WHERE sync_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS sales_sync_id ON sales (sync_id);
      CREATE TABLE IF NOT EXISTS stock_moves (
        id TEXT PRIMARY KEY NOT NULL,
        product_id TEXT NOT NULL,
        delta REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      PRAGMA user_version = 2;
    `);
  }
}

// ---- Change notifications -------------------------------------------------

type Listener = () => void;
const dataListeners = new Set<Listener>();
let outboxListener: Listener | null = null;

/** Called when synced data arrives, so screens reload. */
export function subscribeData(listener: Listener): () => void {
  dataListeners.add(listener);
  return () => dataListeners.delete(listener);
}

export function emitDataChanged() {
  for (const l of dataListeners) l();
}

/** Called after something is queued for the cloud (cloud.ts starts a sync). */
export function onOutbox(listener: Listener | null) {
  outboxListener = listener;
}

// ---- Settings -----------------------------------------------------------

async function getSetting<T>(db: SQLiteDatabase, key: string): Promise<T | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row ? (JSON.parse(row.value) as T) : null;
}

async function setSetting(db: SQLiteDatabase, key: string, value: unknown) {
  if (value === null) {
    await db.runAsync('DELETE FROM settings WHERE key = ?', key);
    return;
  }
  await db.runAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key, JSON.stringify(value),
  );
}

/** The cloud shop this phone belongs to, if any. */
export interface StoreLink {
  id: string;
  code: string;
}

export interface Account {
  store: StoreLink | null;
  membership: Membership | null;
}

export async function getAccount(db: SQLiteDatabase): Promise<Account> {
  return {
    store: await getSetting<StoreLink>(db, 'store'),
    membership: await getSetting<Membership>(db, 'membership'),
  };
}

/** What this phone's user may do. A phone not linked to a shop belongs to the owner. */
export function permissions(account: Account) {
  const m = account.membership;
  const full = !account.store || !m || m.role === 'owner';
  return {
    isOwner: full,
    canSeeCost: full || !!m?.can_see_cost,
    canDelete: full || !!m?.can_delete,
  };
}

export async function getShop(db: SQLiteDatabase): Promise<Shop> {
  const shop = await getSetting<Shop>(db, 'shop');
  return shop ? { ...emptyShop, ...shop } : emptyShop;
}

export async function saveShop(db: SQLiteDatabase, shop: Shop) {
  await setSetting(db, 'shop', shop);
}

// ---- Products -----------------------------------------------------------

interface ProductRow {
  id: string;
  names: string;
  unit: string;
  sell_paise: number;
  cost_paise: number;
  stock: number;
  expiry: string | null;
  low_stock_at: number | null;
  deleted: number;
}

function fromRow(row: ProductRow): Product {
  return {
    id: row.id,
    names: JSON.parse(row.names),
    unit: row.unit as Unit,
    sellPaise: row.sell_paise,
    costPaise: row.cost_paise,
    stock: row.stock,
    expiry: row.expiry ?? undefined,
    lowStockAt: row.low_stock_at ?? undefined,
  };
}

function toRemote(row: ProductRow): Omit<RemoteProduct, 'store_id'> {
  return {
    id: row.id,
    names: JSON.parse(row.names),
    unit: row.unit,
    sell_paise: row.sell_paise,
    expiry: row.expiry,
    low_stock_at: row.low_stock_at,
    deleted: !!row.deleted,
  };
}

export async function listProducts(db: SQLiteDatabase): Promise<Product[]> {
  const rows = await db.getAllAsync<ProductRow>('SELECT * FROM products WHERE deleted = 0 ORDER BY names');
  return rows.map(fromRow);
}

export function newProductId(): string {
  return newSyncId('p');
}

/** Queue a change for the cloud, but only once the phone belongs to a shop. */
async function enqueue(db: SQLiteDatabase, entry: Omit<OutboxEntry, 'id'>) {
  if (!(await getSetting<StoreLink>(db, 'store'))) return;
  await db.runAsync('INSERT INTO outbox (kind, payload) VALUES (?, ?)', entry.kind, JSON.stringify(entry.row));
}

async function enqueueProduct(db: SQLiteDatabase, id: string) {
  const row = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  if (row) await enqueue(db, { kind: 'product', row: toRemote(row) });
}

async function enqueueCost(db: SQLiteDatabase, id: string) {
  const row = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', id);
  if (row) await enqueue(db, { kind: 'cost', row: { product_id: id, cost_paise: row.cost_paise } });
}

/** Record a stock change that was already applied to the product's stock. */
async function recordMove(db: SQLiteDatabase, productId: string, delta: number, reason: RemoteMove['reason'], now: string) {
  if (delta === 0 && reason !== 'create') return;
  const move = { id: newSyncId('m'), product_id: productId, delta, reason, created_at: now };
  await db.runAsync(
    'INSERT INTO stock_moves (id, product_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)',
    move.id, productId, delta, reason, now,
  );
  await enqueue(db, { kind: 'move', row: move });
}

function changed() {
  outboxListener?.();
}

export async function saveProduct(db: SQLiteDatabase, p: Product) {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const old = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', p.id);
    await db.runAsync(
      `INSERT INTO products (id, names, unit, sell_paise, cost_paise, stock, expiry, low_stock_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET names = excluded.names, unit = excluded.unit,
         sell_paise = excluded.sell_paise, cost_paise = excluded.cost_paise,
         stock = excluded.stock, expiry = excluded.expiry, low_stock_at = excluded.low_stock_at,
         updated_at = excluded.updated_at`,
      p.id, JSON.stringify(p.names), p.unit, p.sellPaise, p.costPaise, p.stock, p.expiry ?? null,
      p.lowStockAt ?? null, now,
    );
    if (!old || old.sell_paise !== p.sellPaise || old.cost_paise !== p.costPaise) {
      await db.runAsync(
        'INSERT INTO price_history (product_id, sell_paise, cost_paise, changed_at) VALUES (?, ?, ?, ?)',
        p.id, p.sellPaise, p.costPaise, now,
      );
    }
    await enqueueProduct(db, p.id);
    if (!old || old.cost_paise !== p.costPaise) await enqueueCost(db, p.id);
    // Typed-in stock becomes a movement, so other phones' sales still count.
    await recordMove(db, p.id, old ? p.stock - old.stock : p.stock, old ? 'set' : 'create', now);
  });
  changed();
}

/** Hides the product everywhere; its past sales stay in the records. */
export async function deleteProduct(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE products SET deleted = 1, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
  await enqueueProduct(db, id);
  changed();
}

async function recordPrice(db: SQLiteDatabase, productId: string, now: string) {
  await db.runAsync(
    `INSERT INTO price_history (product_id, sell_paise, cost_paise, changed_at)
     SELECT id, sell_paise, cost_paise, ? FROM products WHERE id = ?`,
    now, productId,
  );
}

/** Save what the shopkeeper confirmed in the conversation. */
export async function applyAction(db: SQLiteDatabase, action: Action) {
  const now = new Date().toISOString();
  switch (action.type) {
    case 'create':
      await saveProduct(db, { ...action.product, id: newProductId() });
      return;
    case 'restock':
      await db.withTransactionAsync(async () => {
        for (const item of action.items) {
          await db.runAsync(
            'UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ?',
            item.qty, now, item.productId,
          );
          await recordMove(db, item.productId, item.qty, 'restock', now);
          if (action.sellPaise !== undefined) {
            const priceChange = await db.runAsync(
              'UPDATE products SET sell_paise = ? WHERE id = ? AND sell_paise != ?',
              action.sellPaise, item.productId, action.sellPaise,
            );
            if (priceChange.changes) {
              await recordPrice(db, item.productId, now);
              await enqueueProduct(db, item.productId);
            }
          }
        }
      });
      break;
    case 'setPrice':
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          'UPDATE products SET sell_paise = ?, updated_at = ? WHERE id = ?',
          action.sellPaise, now, action.productId,
        );
        await recordPrice(db, action.productId, now);
        await enqueueProduct(db, action.productId);
      });
      break;
    case 'sell': {
      const billId = newSyncId('b');
      await db.withTransactionAsync(async () => {
        for (const line of action.lines) {
          const sale = {
            id: newSyncId('s'),
            bill_id: billId,
            product_id: line.productId,
            qty: line.qty,
            sell_paise: line.sellPaise,
            amount_paise: line.amountPaise,
            sold_at: now,
          };
          await db.runAsync(
            `INSERT INTO sales (sync_id, bill_id, product_id, qty, sell_paise, amount_paise, sold_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            sale.id, billId, line.productId, line.qty, line.sellPaise, line.amountPaise, now,
          );
          // Stock can go below zero if a sale was recorded before restocking;
          // the shopkeeper sees it and corrects it.
          await db.runAsync(
            'UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?',
            line.qty, now, line.productId,
          );
          await recordMove(db, line.productId, -line.qty, 'sale', now);
          await enqueue(db, { kind: 'sale', row: sale });
        }
      });
      break;
    }
  }
  changed();
}

/** Total of today's sales, in paise. */
export async function todaysSalesPaise(db: SQLiteDatabase): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const row = await db.getFirstAsync<{ total: number | null }>(
    'SELECT SUM(amount_paise) AS total FROM sales WHERE sold_at >= ?',
    start.toISOString(),
  );
  return row?.total ?? 0;
}

// ---- Linking to a cloud shop --------------------------------------------

/**
 * Link this phone to a new shop and queue everything already on it, so the
 * owner's existing products, stock and sales go up with the first sync.
 */
export async function linkNewStore(db: SQLiteDatabase, store: StoreLink, membership: Membership) {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await setSetting(db, 'store', store);
    await setSetting(db, 'membership', membership);
    await db.runAsync('DELETE FROM outbox');
    const products = await db.getAllAsync<ProductRow>('SELECT * FROM products');
    for (const p of products) {
      await enqueue(db, { kind: 'product', row: toRemote(p) });
      await enqueue(db, { kind: 'cost', row: { product_id: p.id, cost_paise: p.cost_paise } });
      // Earlier movements stay on this phone; the shop starts from today's stock.
      await recordMove(db, p.id, p.stock, 'create', now);
    }
    const sales = await db.getAllAsync<{
      sync_id: string; bill_id: string; product_id: string; qty: number;
      sell_paise: number; amount_paise: number; sold_at: string;
    }>('SELECT * FROM sales WHERE product_id IN (SELECT id FROM products)');
    for (const s of sales) {
      await enqueue(db, {
        kind: 'sale',
        row: {
          id: s.sync_id, bill_id: s.bill_id, product_id: s.product_id, qty: s.qty,
          sell_paise: s.sell_paise, amount_paise: s.amount_paise, sold_at: s.sold_at,
        },
      });
    }
  });
  changed();
}

/** Link this phone to a shop that already has data (staff joining, owner on a new phone). */
export async function linkExistingStore(db: SQLiteDatabase, store: StoreLink, membership: Membership) {
  await db.withTransactionAsync(async () => {
    await clearShopData(db);
    await setSetting(db, 'store', store);
    await setSetting(db, 'membership', membership);
  });
  emitDataChanged();
}

/** Forget the shop. Staff phones also drop the shop's data. */
export async function unlinkStore(db: SQLiteDatabase, dropData: boolean) {
  await db.withTransactionAsync(async () => {
    if (dropData) await clearShopData(db);
    await db.runAsync('DELETE FROM outbox');
    await db.runAsync("DELETE FROM settings WHERE key IN ('store', 'membership') OR key LIKE 'cursor:%'");
  });
  emitDataChanged();
}

async function clearShopData(db: SQLiteDatabase) {
  await db.execAsync(`
    DELETE FROM products;
    DELETE FROM sales;
    DELETE FROM stock_moves;
    DELETE FROM price_history;
    DELETE FROM outbox;
    DELETE FROM settings WHERE key LIKE 'cursor:%' OR key = 'shop';
  `);
}

/** The phone's side of a sync (see src/core/sync.ts). */
export function sqliteLocal(db: SQLiteDatabase): Local {
  return {
    async outbox() {
      const rows = await db.getAllAsync<{ id: number; kind: OutboxEntry['kind']; payload: string }>(
        'SELECT * FROM outbox ORDER BY id',
      );
      return rows.map((r) => ({ id: r.id, kind: r.kind, row: JSON.parse(r.payload) }) as OutboxEntry);
    },
    async clearOutbox(ids) {
      if (!ids.length) return;
      await db.runAsync(`DELETE FROM outbox WHERE id <= ?`, Math.max(...ids));
    },
    cursor: (table: Table) => getSetting<string>(db, `cursor:${table}`),
    setCursor: (table: Table, value: string) => setSetting(db, `cursor:${table}`, value),
    async putProduct(p) {
      await db.runAsync(
        `INSERT INTO products (id, names, unit, sell_paise, cost_paise, stock, expiry, low_stock_at, deleted, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET names = excluded.names, unit = excluded.unit,
           sell_paise = excluded.sell_paise, expiry = excluded.expiry, low_stock_at = excluded.low_stock_at,
           deleted = excluded.deleted, updated_at = excluded.updated_at`,
        p.id, JSON.stringify(p.names), p.unit, p.sell_paise, p.expiry, p.low_stock_at, p.deleted ? 1 : 0,
        p.updated_at ?? new Date().toISOString(),
      );
    },
    async putCost(c) {
      await db.runAsync('UPDATE products SET cost_paise = ? WHERE id = ?', c.cost_paise, c.product_id);
    },
    async applyMove(m) {
      // No transaction here: a sync can run while the shopkeeper's own change
      // holds one, and SQLite can't nest them.
      const added = await db.runAsync(
        'INSERT OR IGNORE INTO stock_moves (id, product_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)',
        m.id, m.product_id, m.delta, m.reason, m.created_at,
      );
      if (added.changes) {
        await db.runAsync('UPDATE products SET stock = stock + ? WHERE id = ?', m.delta, m.product_id);
      }
    },
    async putSale(s) {
      await db.runAsync(
        `INSERT OR IGNORE INTO sales (sync_id, bill_id, product_id, qty, sell_paise, amount_paise, sold_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        s.id, s.bill_id, s.product_id, s.qty, s.sell_paise, s.amount_paise, s.sold_at,
      );
    },
    async setMembership(m) {
      await setSetting(db, 'membership', m);
      if (m.role !== 'owner' && !m.can_see_cost) {
        // Cost permission taken away: forget cost prices on this phone.
        await db.runAsync('UPDATE products SET cost_paise = 0 WHERE cost_paise != 0');
        await setSetting(db, 'cursor:product_costs', null);
      }
    },
    async setShop(s) {
      const store = await getSetting<StoreLink>(db, 'store');
      if (store) await setSetting(db, 'store', { ...store, code: s.code });
      await saveShop(db, { name: s.name, upiId: s.upi_id, phone: s.phone });
    },
  };
}

// ---- Hooks --------------------------------------------------------------

/** Products from the phone's database, reloaded with `refresh()` after a change. */
export function useProducts() {
  const db = useSQLiteContext();
  const [products, setProducts] = useState<Product[]>([]);
  const refresh = useCallback(async () => setProducts(await listProducts(db)), [db]);
  useEffect(() => {
    refresh();
    return subscribeData(refresh);
  }, [refresh]);
  return { db, products, refresh };
}

/** The shop this phone belongs to and what its user may do. */
export function useAccount() {
  const db = useSQLiteContext();
  const [account, setAccount] = useState<Account>({ store: null, membership: null });
  const refresh = useCallback(async () => setAccount(await getAccount(db)), [db]);
  useEffect(() => {
    refresh();
    return subscribeData(refresh);
  }, [refresh]);
  return { account, can: permissions(account), refresh };
}
