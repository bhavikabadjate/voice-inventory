-- Checks the shop access rules. Run with: supabase/tests/run.sh
\set ON_ERROR_STOP 1

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'), -- owner
  ('00000000-0000-0000-0000-00000000000b'), -- staff
  ('00000000-0000-0000-0000-00000000000c'); -- stranger

create function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  perform set_config('role', 'authenticated', false);
end $$;

create function pg_temp.expect_error(stmt text, what text) returns void language plpgsql as $$
begin
  execute stmt;
  raise exception 'FAIL: % was allowed', what;
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'ok: % refused (%)', what, sqlerrm;
end $$;

create function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin
  if not ok then raise exception 'FAIL: %', what; end if;
  raise notice 'ok: %', what;
end $$;

-- Owner creates the shop and a product with a cost price.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table shop as select * from public.create_store('Sharma Kirana', 'Ramesh');
select pg_temp.expect((select code ~ '^\d{6}$' from shop), 'store code is 6 digits');
insert into products (id, store_id, names, unit, sell_paise)
  select 'milk', id, '["Milk","dudh"]', 'l', 5600 from shop;
insert into product_costs (product_id, store_id, cost_paise) select 'milk', id, 4800 from shop;
insert into stock_moves (id, store_id, product_id, delta, reason) select 'm1', id, 'milk', 20, 'create' from shop;

-- Staff joins with the code and sees products but not cost.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 0 from products), 'nobody sees a shop before joining');
select public.join_store((select code from shop), 'Sunil');
select pg_temp.expect((select count(*) = 1 from products), 'staff sees products after joining');
select pg_temp.expect((select count(*) = 0 from product_costs), 'staff cannot see cost price');
select pg_temp.expect_error(
  $q$insert into product_costs (product_id, store_id, cost_paise) select 'milk', id, 1 from shop$q$,
  'staff setting a cost price');
insert into sales (id, store_id, bill_id, product_id, qty, sell_paise, amount_paise, sold_at)
  select 's1', id, 'b1', 'milk', 2, 5600, 11200, now() from shop;
insert into stock_moves (id, store_id, product_id, delta, reason) select 'm2', id, 'milk', -2, 'sale' from shop;
select pg_temp.expect((select sum(delta) = 18 from stock_moves), 'stock moves add up');
select pg_temp.expect_error($q$update products set deleted = true where id = 'milk'$q$, 'staff deleting a product');
-- Staff trying to give themselves cost access changes nothing.
update members set can_see_cost = true where user_id = auth.uid();
select pg_temp.expect(
  (select not can_see_cost from members where user_id = '00000000-0000-0000-0000-00000000000b'),
  'staff permission unchanged');

-- A stranger sees nothing and cannot write.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) = 0 from products), 'stranger sees no products');
select pg_temp.expect((select count(*) = 0 from stores), 'stranger sees no shop');
select pg_temp.expect_error(
  $q$insert into sales (id, store_id, bill_id, product_id, qty, sell_paise, amount_paise, sold_at)
     select 's2', id, 'b2', 'milk', 1, 1, 1, now() from shop$q$,
  'stranger recording a sale');

-- Owner allows staff to see cost; staff now can.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update members set can_see_cost = true where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect_error(
  $q$update members set role = 'owner' where user_id = '00000000-0000-0000-0000-00000000000b'$q$,
  'promoting staff to owner');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect((select count(*) = 1 from product_costs), 'allowed staff sees cost price');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update products set deleted = true where id = 'milk';
select pg_temp.expect((select deleted from products where id = 'milk'), 'owner can delete');
-- Khata: staff write udhaar; nobody can change or delete an entry; strangers see nothing.
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into customers (id, store_id, name) select 'ramesh', id, 'Ramesh' from shop;
insert into khata_entries (id, store_id, customer_id, amount_paise) select 'k1', id, 'ramesh', 20000 from shop;
select pg_temp.expect((select sum(amount_paise) = 20000 from khata_entries), 'staff writes udhaar');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update khata_entries set amount_paise = 0 where id = 'k1';
delete from khata_entries where id = 'k1';
select pg_temp.expect((select amount_paise = 20000 from khata_entries where id = 'k1'),
  'owner cannot change or delete a khata entry');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect((select count(*) = 0 from khata_entries), 'stranger sees no khata');
select pg_temp.expect((select count(*) = 0 from customers), 'stranger sees no customers');
select pg_temp.expect_error(
  $q$insert into khata_entries (id, store_id, customer_id, amount_paise) select 'k2', id, 'ramesh', -100 from shop$q$,
  'stranger writing a khata entry');
\echo ALL ACCESS RULE CHECKS PASSED
