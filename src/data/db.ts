// Products stored on the phone with SQLite, so price questions and edits work
// without internet. Cloud sync comes later on top of this.

import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';

import type { Product } from '@/core/billing';
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
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      sell_paise INTEGER NOT NULL,
      cost_paise INTEGER NOT NULL,
      changed_at TEXT NOT NULL
    );
  `);
}

interface ProductRow {
  id: string;
  names: string;
  unit: string;
  sell_paise: number;
  cost_paise: number;
  stock: number;
  expiry: string | null;
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
  };
}

export async function listProducts(db: SQLiteDatabase): Promise<Product[]> {
  const rows = await db.getAllAsync<ProductRow>('SELECT * FROM products ORDER BY names');
  return rows.map(fromRow);
}

export function newProductId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveProduct(db: SQLiteDatabase, p: Product) {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    const old = await db.getFirstAsync<ProductRow>('SELECT * FROM products WHERE id = ?', p.id);
    await db.runAsync(
      `INSERT INTO products (id, names, unit, sell_paise, cost_paise, stock, expiry, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET names = excluded.names, unit = excluded.unit,
         sell_paise = excluded.sell_paise, cost_paise = excluded.cost_paise,
         stock = excluded.stock, expiry = excluded.expiry, updated_at = excluded.updated_at`,
      p.id, JSON.stringify(p.names), p.unit, p.sellPaise, p.costPaise, p.stock, p.expiry ?? null, now,
    );
    if (!old || old.sell_paise !== p.sellPaise || old.cost_paise !== p.costPaise) {
      await db.runAsync(
        'INSERT INTO price_history (product_id, sell_paise, cost_paise, changed_at) VALUES (?, ?, ?, ?)',
        p.id, p.sellPaise, p.costPaise, now,
      );
    }
  });
}

export async function deleteProduct(db: SQLiteDatabase, id: string) {
  await db.runAsync('DELETE FROM products WHERE id = ?', id);
}

/** Products from the phone's database, reloaded with `refresh()` after a change. */
export function useProducts() {
  const db = useSQLiteContext();
  const [products, setProducts] = useState<Product[]>([]);
  const refresh = useCallback(async () => setProducts(await listProducts(db)), [db]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { db, products, refresh };
}
