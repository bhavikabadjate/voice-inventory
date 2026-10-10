import { describe, expect, it } from 'vitest';

import {
  syncOnce,
  type Local,
  type Membership,
  type OutboxEntry,
  type Remote,
  type RemoteCustomer,
  type RemoteKhataEntry,
  type RemoteMove,
  type RemoteProduct,
  type RemoteSale,
  type Table,
} from '../sync';

const STORE = 'store-1';

/** A tiny in-memory stand-in for the cloud, shared by several phones. */
class FakeCloud {
  rows: Record<Table, Record<string, any>[]> = {
    products: [], product_costs: [], stock_moves: [], sales: [], customers: [], khata_entries: [],
  };
  clock = 0;
  members = new Map<string, Membership>();

  remoteFor(user: string): Remote {
    return {
      upsert: async (table, rows) => {
        for (const row of rows as Record<string, any>[]) {
          const key = table === 'product_costs' ? 'product_id' : 'id';
          const list = this.rows[table];
          const i = list.findIndex((r) => r[key] === row[key]);
          const insertOnly = table === 'stock_moves' || table === 'sales' || table === 'khata_entries';
          if (i >= 0 && insertOnly) continue;
          if (table === 'product_costs' && !this.canSeeCost(user)) throw new Error('not allowed');
          const stamp = String(++this.clock).padStart(6, '0');
          const stamped = { ...row, updated_at: stamp, synced_at: stamp };
          if (i >= 0) list.splice(i, 1);
          list.push(stamped);
        }
      },
      pull: async (table, column, since, limit) => {
        if (table === 'product_costs' && !this.canSeeCost(user)) return [];
        return this.rows[table]
          .filter((r) => since === null || r[column] >= since)
          .sort((a, b) => (a[column] < b[column] ? -1 : 1))
          .slice(0, limit) as any;
      },
      membership: async () => this.members.get(user) ?? null,
      shop: async () => ({ name: 'Sharma Kirana', code: '123456', upi_id: '', phone: '' }),
    };
  }

  canSeeCost(user: string) {
    const m = this.members.get(user);
    return !!m && (m.role === 'owner' || m.can_see_cost);
  }
}

/** A phone: products with stock and cost, plus its outbox. */
class FakePhone implements Local {
  products = new Map<string, { meta: RemoteProduct; stock: number; cost: number }>();
  moves = new Set<string>();
  sales = new Map<string, RemoteSale>();
  customers = new Map<string, { meta: RemoteCustomer; balance: number }>();
  khata = new Set<string>();
  box: OutboxEntry[] = [];
  cursors = new Map<Table, string>();
  membership: Membership | null = null;
  nextId = 1;

  // Changes made on this phone (what the app's database layer does).
  addProduct(id: string, stock: number, cost: number) {
    const meta = { id, store_id: STORE, names: [id], unit: 'kg', sell_paise: 100, expiry: null, low_stock_at: null, deleted: false };
    this.products.set(id, { meta, stock, cost });
    this.box.push({ id: this.nextId++, kind: 'product', row: meta });
    this.box.push({ id: this.nextId++, kind: 'cost', row: { product_id: id, cost_paise: cost } });
    this.move(`${id}-create`, id, stock, 'create');
  }
  move(id: string, productId: string, delta: number, reason: RemoteMove['reason']) {
    const p = this.products.get(productId)!;
    if (reason !== 'create') p.stock += delta;
    this.moves.add(id);
    this.box.push({ id: this.nextId++, kind: 'move', row: { id, product_id: productId, delta, reason, created_at: 'now' } });
  }
  sell(id: string, productId: string, qty: number) {
    const sale = { id, bill_id: id, product_id: productId, qty, sell_paise: 100, amount_paise: 100 * qty, sold_at: 'now' };
    this.sales.set(id, { ...sale, store_id: STORE });
    this.box.push({ id: this.nextId++, kind: 'sale', row: sale });
    this.move(`${id}-move`, productId, -qty, 'sale');
  }

  giveUdhaar(id: string, customerId: string, amount: number) {
    if (!this.customers.has(customerId)) {
      const meta = { id: customerId, store_id: STORE, name: customerId, phone: '', deleted: false };
      this.customers.set(customerId, { meta, balance: 0 });
      this.box.push({ id: this.nextId++, kind: 'customer', row: meta });
    }
    this.customers.get(customerId)!.balance += amount;
    this.khata.add(id);
    this.box.push({
      id: this.nextId++,
      kind: 'khata',
      row: { id, customer_id: customerId, amount_paise: amount, note: '', bill_id: null, created_at: 'now' },
    });
  }

  async outbox() { return [...this.box]; }
  async clearOutbox(ids: number[]) { this.box = this.box.filter((e) => !ids.includes(e.id)); }
  async cursor(t: Table) { return this.cursors.get(t) ?? null; }
  async setCursor(t: Table, v: string) { this.cursors.set(t, v); }
  async putProduct(p: RemoteProduct) {
    const cur = this.products.get(p.id);
    this.products.set(p.id, { meta: p, stock: cur?.stock ?? 0, cost: cur?.cost ?? 0 });
  }
  async putCost(c: { product_id: string; cost_paise: number }) {
    const cur = this.products.get(c.product_id);
    if (cur) cur.cost = c.cost_paise;
  }
  async applyMove(m: RemoteMove) {
    if (this.moves.has(m.id)) return;
    this.moves.add(m.id);
    const p = this.products.get(m.product_id);
    if (p) p.stock += m.delta;
  }
  async putSale(s: RemoteSale) { if (!this.sales.has(s.id)) this.sales.set(s.id, s); }
  async putCustomer(c: RemoteCustomer) {
    this.customers.set(c.id, { meta: c, balance: this.customers.get(c.id)?.balance ?? 0 });
  }
  async putKhata(k: RemoteKhataEntry) {
    if (this.khata.has(k.id)) return;
    this.khata.add(k.id);
    const c = this.customers.get(k.customer_id);
    if (c) c.balance += k.amount_paise;
  }
  async setMembership(m: Membership) { this.membership = m; }
  async setShop() {}
}

const owner: Membership = { role: 'owner', name: 'Ramesh', can_see_cost: false, can_delete: false };
const staff: Membership = { role: 'staff', name: 'Sunil', can_see_cost: false, can_delete: false };

function setup() {
  const cloud = new FakeCloud();
  cloud.members.set('owner', owner);
  cloud.members.set('staff', staff);
  const a = new FakePhone();
  const b = new FakePhone();
  const sync = (phone: FakePhone, user: string) => syncOnce(phone, cloud.remoteFor(user), STORE);
  return { cloud, a, b, sync };
}

describe('sync between phones', () => {
  it('sends products and stock to another phone', async () => {
    const { a, b, sync } = setup();
    a.addProduct('sugar', 50, 4000);
    await sync(a, 'owner');
    await sync(b, 'owner');
    expect(b.products.get('sugar')).toMatchObject({ stock: 50, cost: 4000 });
    expect(a.box).toEqual([]);
  });

  it('counts sales made on two phones at the same time', async () => {
    const { a, b, sync } = setup();
    a.addProduct('sugar', 50, 4000);
    await sync(a, 'owner');
    await sync(b, 'staff');
    a.sell('s1', 'sugar', 2);
    b.sell('s2', 'sugar', 3);
    await sync(a, 'owner');
    await sync(b, 'staff');
    await sync(a, 'owner');
    expect(a.products.get('sugar')!.stock).toBe(45);
    expect(b.products.get('sugar')!.stock).toBe(45);
    expect(a.sales.size).toBe(2);
    expect(b.sales.size).toBe(2);
  });

  it('does not apply the same movement twice', async () => {
    const { a, sync } = setup();
    a.addProduct('sugar', 50, 4000);
    a.move('r1', 'sugar', 10, 'restock');
    await sync(a, 'owner');
    a.cursors.clear(); // e.g. a reinstall pulling everything again
    await sync(a, 'owner');
    expect(a.products.get('sugar')!.stock).toBe(60);
  });

  it('keeps cost prices away from staff who may not see them', async () => {
    const { cloud, a, b, sync } = setup();
    a.addProduct('sugar', 50, 4000);
    await sync(a, 'owner');
    await sync(b, 'staff');
    expect(b.products.get('sugar')!.cost).toBe(0);
    cloud.members.set('staff', { ...staff, can_see_cost: true });
    await sync(b, 'staff');
    expect(b.products.get('sugar')!.cost).toBe(4000);
  });

  it("doesn't push a staff member's cost entries they aren't allowed to send", async () => {
    const { cloud, a, sync } = setup();
    a.addProduct('rice', 10, 5000);
    await expect(sync(a, 'staff')).resolves.toMatchObject({ pushed: 3 });
    expect(cloud.rows.product_costs).toEqual([]);
    expect(cloud.rows.products.length).toBe(1);
  });

  it('shares udhaar written on two phones, each entry once', async () => {
    const { a, b, sync } = setup();
    a.giveUdhaar('k1', 'ramesh', 20000);
    await sync(a, 'owner');
    await sync(b, 'staff');
    b.giveUdhaar('k2', 'ramesh', -5000);
    await sync(b, 'staff');
    await sync(a, 'owner');
    a.cursors.clear();
    await sync(a, 'owner');
    expect(a.customers.get('ramesh')!.balance).toBe(15000);
    expect(b.customers.get('ramesh')!.balance).toBe(15000);
  });

  it('does nothing for someone who is not a member', async () => {
    const { a, cloud } = setup();
    a.addProduct('rice', 10, 5000);
    const r = await syncOnce(a, cloud.remoteFor('stranger'), STORE);
    expect(r).toEqual({ pushed: 0, pulled: 0, membership: null });
    expect(a.box.length).toBe(3);
  });
});
