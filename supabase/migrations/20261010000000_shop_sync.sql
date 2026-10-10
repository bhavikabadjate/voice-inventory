-- Shop data in the cloud: one row per shop, its members (owner and staff), and
-- the products, cost prices, stock movements, sales and price history that
-- every phone of the shop syncs.
--
-- Access rules:
--   * Only members of a shop can see or change its data.
--   * Cost prices live in their own table, readable only by the owner and by
--     staff the owner has allowed (can_see_cost).
--   * Only the owner changes members and permissions.
--   * Stock is a list of movements (+10 restock, -2 sale), so two phones
--     changing stock at the same time never overwrite each other.

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  code text not null unique,
  upi_id text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now()
);

create table public.members (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff')),
  name text not null default '',
  can_see_cost boolean not null default false,
  can_delete boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create table public.products (
  id text primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  names jsonb not null,
  unit text not null,
  sell_paise integer not null,
  expiry date,
  low_stock_at real,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.product_costs (
  product_id text primary key references public.products (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  cost_paise integer not null,
  updated_at timestamptz not null default now()
);

create table public.stock_moves (
  id text primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  delta real not null,
  reason text not null check (reason in ('restock', 'sale', 'set', 'create')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  -- When the row reached the server; phones pull by this, not by their own clocks.
  synced_at timestamptz not null default now()
);

create table public.sales (
  id text primary key,
  store_id uuid not null references public.stores (id) on delete cascade,
  bill_id text not null,
  product_id text not null references public.products (id) on delete cascade,
  qty real not null,
  sell_paise integer not null,
  amount_paise integer not null,
  sold_at timestamptz not null,
  sold_by uuid default auth.uid(),
  synced_at timestamptz not null default now()
);

create index on public.products (store_id, updated_at);
create index on public.stock_moves (store_id, synced_at);
create index on public.sales (store_id, synced_at);

-- The server sets these times, so a phone with a wrong clock can't hide its
-- changes from the others.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function public.touch_synced_at() returns trigger
language plpgsql as $$
begin
  new.synced_at := now();
  return new;
end $$;

create trigger products_touch before insert or update on public.products
  for each row execute function public.touch_updated_at();
create trigger product_costs_touch before insert or update on public.product_costs
  for each row execute function public.touch_updated_at();
create trigger stock_moves_touch before insert or update on public.stock_moves
  for each row execute function public.touch_synced_at();
create trigger sales_touch before insert or update on public.sales
  for each row execute function public.touch_synced_at();

-- Membership checks used by the access rules. `security definer` lets them
-- read members without recursing into the members table's own rules.
create function public.is_member(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where store_id = s and user_id = auth.uid());
$$;

create function public.is_owner(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where store_id = s and user_id = auth.uid() and role = 'owner');
$$;

create function public.can_see_cost(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where store_id = s and user_id = auth.uid() and (role = 'owner' or can_see_cost)
  );
$$;

create function public.can_delete(s uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members
    where store_id = s and user_id = auth.uid() and (role = 'owner' or can_delete)
  );
$$;

alter table public.stores enable row level security;
alter table public.members enable row level security;
alter table public.products enable row level security;
alter table public.product_costs enable row level security;
alter table public.stock_moves enable row level security;
alter table public.sales enable row level security;

create policy "members read their shop" on public.stores
  for select using (public.is_member(id));
create policy "owner updates the shop" on public.stores
  for update using (public.is_owner(id));

create policy "members see the team" on public.members
  for select using (public.is_member(store_id));
create policy "owner changes the team" on public.members
  for update using (public.is_owner(store_id));
create policy "owner removes members" on public.members
  for delete using (public.is_owner(store_id) and role = 'staff');

create policy "members read products" on public.products
  for select using (public.is_member(store_id));
create policy "members add products" on public.products
  for insert with check (public.is_member(store_id));
-- Deleting is a soft delete (deleted = true), so it needs the delete permission.
create policy "members edit products" on public.products
  for update using (public.is_member(store_id))
  with check (public.is_member(store_id) and (not deleted or public.can_delete(store_id)));

create policy "cost readers see costs" on public.product_costs
  for select using (public.can_see_cost(store_id));
create policy "cost readers set costs" on public.product_costs
  for insert with check (public.can_see_cost(store_id));
create policy "cost readers change costs" on public.product_costs
  for update using (public.can_see_cost(store_id)) with check (public.can_see_cost(store_id));

create policy "members read stock" on public.stock_moves
  for select using (public.is_member(store_id));
create policy "members move stock" on public.stock_moves
  for insert with check (public.is_member(store_id));

create policy "members read sales" on public.sales
  for select using (public.is_member(store_id));
create policy "members record sales" on public.sales
  for insert with check (public.is_member(store_id));

-- Create a shop and become its owner. Returns the new shop with its join code.
create function public.create_store(shop_name text, owner_name text default '')
returns public.stores
language plpgsql security definer set search_path = public as $$
declare
  s stores;
  new_code text;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  loop
    new_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (select 1 from stores where code = new_code);
  end loop;
  insert into stores (name, code) values (shop_name, new_code) returning * into s;
  insert into members (store_id, user_id, role, name) values (s.id, auth.uid(), 'owner', owner_name);
  return s;
end $$;

-- Join a shop as staff with its 6-digit code.
create function public.join_store(join_code text, staff_name text)
returns public.stores
language plpgsql security definer set search_path = public as $$
declare
  s stores;
begin
  if auth.uid() is null then
    raise exception 'sign in first';
  end if;
  select * into s from stores where code = trim(join_code);
  if not found then
    raise exception 'no shop with that code';
  end if;
  insert into members (store_id, user_id, role, name)
    values (s.id, auth.uid(), 'staff', staff_name)
    on conflict (store_id, user_id) do update set name = excluded.name;
  return s;
end $$;

-- Members may not promote themselves: only role-preserving updates by the owner.
create function public.guard_member_update() returns trigger
language plpgsql as $$
begin
  if new.role <> old.role or new.user_id <> old.user_id or new.store_id <> old.store_id then
    raise exception 'role and membership cannot be changed';
  end if;
  return new;
end $$;

create trigger members_guard before update on public.members
  for each row execute function public.guard_member_update();

revoke all on function public.create_store(text, text) from public, anon;
revoke all on function public.join_store(text, text) from public, anon;
grant execute on function public.create_store(text, text) to authenticated;
grant execute on function public.join_store(text, text) to authenticated;
