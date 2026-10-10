-- Bolo Dukaan: adds the khata (customer credit) tables and expiry batches to the shop database.
-- How to use: Supabase dashboard > SQL Editor > paste all of this > Run.
-- It is safe to run more than once, and it does not touch any existing data.
-- It is the same as the repo's khata and product_batches migrations, written so a second run is harmless.

create table if not exists public.customers (
  id text primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  phone text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.khata_entries (
  id text primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  customer_id text not null references public.customers (id),
  -- Positive: udhaar given. Negative: payment received.
  amount_paise integer not null,
  note text not null default '',
  bill_id text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  synced_at timestamptz not null default now()
);

create index if not exists customers_store_id_updated_at_idx on public.customers (store_id, updated_at);
create index if not exists khata_entries_store_id_synced_at_idx on public.khata_entries (store_id, synced_at);

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before insert or update on public.customers
  for each row execute function public.touch_updated_at();
drop trigger if exists khata_entries_touch on public.khata_entries;
create trigger khata_entries_touch before insert on public.khata_entries
  for each row execute function public.touch_synced_at();

alter table public.customers enable row level security;
alter table public.khata_entries enable row level security;

drop policy if exists "members read customers" on public.customers;
create policy "members read customers" on public.customers
  for select using (public.is_member(store_id));
drop policy if exists "members add customers" on public.customers;
create policy "members add customers" on public.customers
  for insert with check (public.is_member(store_id));
drop policy if exists "members edit customers" on public.customers;
create policy "members edit customers" on public.customers
  for update using (public.is_member(store_id))
  with check (public.is_member(store_id) and (not deleted or public.can_delete(store_id)));

-- No update or delete rules for khata: an entry cannot be changed once written.
-- A mistake is fixed with a new entry the other way.
drop policy if exists "members read khata" on public.khata_entries;
create policy "members read khata" on public.khata_entries
  for select using (public.is_member(store_id));
drop policy if exists "members write khata" on public.khata_entries;
create policy "members write khata" on public.khata_entries
  for insert with check (
    public.is_member(store_id)
    and exists (select 1 from public.customers c where c.id = customer_id and c.store_id = khata_entries.store_id)
  );

-- Expiry batches: lets every phone see each delivery's own expiry date.
alter table public.products add column if not exists batches jsonb;

-- Tell the API about the new tables straight away.
notify pgrst, 'reload schema';
