-- Customer khata (udhaar ledger). Entries are only ever added: nobody, not
-- even the owner, can change or delete one, so the history can be trusted.
-- A mistake is fixed with a new entry the other way.

create table public.customers (
  id text primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null,
  phone text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.khata_entries (
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

create index on public.customers (store_id, updated_at);
create index on public.khata_entries (store_id, synced_at);

create trigger customers_touch before insert or update on public.customers
  for each row execute function public.touch_updated_at();
create trigger khata_entries_touch before insert on public.khata_entries
  for each row execute function public.touch_synced_at();

alter table public.customers enable row level security;
alter table public.khata_entries enable row level security;

create policy "members read customers" on public.customers
  for select using (public.is_member(store_id));
create policy "members add customers" on public.customers
  for insert with check (public.is_member(store_id));
create policy "members edit customers" on public.customers
  for update using (public.is_member(store_id))
  with check (public.is_member(store_id) and (not deleted or public.can_delete(store_id)));

-- No update or delete rules: entries can't be changed once written.
create policy "members read khata" on public.khata_entries
  for select using (public.is_member(store_id));
create policy "members write khata" on public.khata_entries
  for insert with check (
    public.is_member(store_id)
    and exists (select 1 from public.customers c where c.id = customer_id and c.store_id = khata_entries.store_id)
  );
