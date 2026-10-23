-- pgTAP contract checks for schema, RLS, grants, functions and triggers.
-- The checks intentionally avoid business fixtures and roll back at the end.

begin;

create extension if not exists pgtap;

select plan(84);

insert into auth.users (id, aud, role, email)
values
  ('30000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'rls-a@example.test'),
  ('30000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'rls-b@example.test');

insert into public.restaurants (id, name, slug, currency)
values
  ('30000000-0000-4000-8000-000000000101', 'RLS Tenant A', 'rls-tenant-a', 'INR'),
  ('30000000-0000-4000-8000-000000000102', 'RLS Tenant B', 'rls-tenant-b', 'INR');

insert into public.restaurant_members (restaurant_id, user_id, role)
values
  ('30000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000001', 'STAFF'),
  ('30000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000002', 'STAFF');

insert into public.categories (id, restaurant_id, name)
values
  ('30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000101', 'RLS Category A'),
  ('30000000-0000-4000-8000-000000000202', '30000000-0000-4000-8000-000000000102', 'RLS Category B');

insert into public.menu_items (id, restaurant_id, category_id, name, price)
values
  ('30000000-0000-4000-8000-000000000301', '30000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000201', 'RLS Item A', 10.00),
  ('30000000-0000-4000-8000-000000000302', '30000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000202', 'RLS Item B', 20.00);

insert into public.restaurant_tables (id, restaurant_id, label, qr_token)
values
  ('30000000-0000-4000-8000-000000000401', '30000000-0000-4000-8000-000000000101', 'RLS A', 'rls-a-table'),
  ('30000000-0000-4000-8000-000000000402', '30000000-0000-4000-8000-000000000102', 'RLS B', 'rls-b-table');

insert into public.orders (
  id, restaurant_id, table_id, status, subtotal_amount, tax_amount, total_amount
)
values
  ('30000000-0000-4000-8000-000000000501', '30000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000401', 'NEW', 10.00, 0, 10.00),
  ('30000000-0000-4000-8000-000000000502', '30000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000402', 'NEW', 20.00, 0, 20.00);

insert into public.order_items (
  id, order_id, restaurant_id, menu_item_id, item_name_snapshot,
  unit_price_snapshot, quantity, line_total
)
values
  ('30000000-0000-4000-8000-000000000601', '30000000-0000-4000-8000-000000000501', '30000000-0000-4000-8000-000000000101', '30000000-0000-4000-8000-000000000301', 'RLS Item A', 10.00, 1, 10.00),
  ('30000000-0000-4000-8000-000000000602', '30000000-0000-4000-8000-000000000502', '30000000-0000-4000-8000-000000000102', '30000000-0000-4000-8000-000000000302', 'RLS Item B', 20.00, 1, 20.00);

select ok(to_regclass('public.restaurants') is not null, 'restaurants table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.restaurants'::regclass), 'RLS is enabled on restaurants');
select ok(to_regclass('public.restaurant_members') is not null, 'restaurant_members table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.restaurant_members'::regclass), 'RLS is enabled on restaurant_members');
select ok(to_regclass('public.categories') is not null, 'categories table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.categories'::regclass), 'RLS is enabled on categories');
select ok(to_regclass('public.menu_items') is not null, 'menu_items table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.menu_items'::regclass), 'RLS is enabled on menu_items');
select ok(to_regclass('public.restaurant_tables') is not null, 'restaurant_tables table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.restaurant_tables'::regclass), 'RLS is enabled on restaurant_tables');
select ok(to_regclass('public.orders') is not null, 'orders table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.orders'::regclass), 'RLS is enabled on orders');
select ok(to_regclass('public.order_items') is not null, 'order_items table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.order_items'::regclass), 'RLS is enabled on order_items');

select ok(to_regclass('public.order_items_restaurant_idx') is not null, 'order_items tenant index exists');
select ok(to_regprocedure('extensions.digest(bytea,text)') is not null, 'pgcrypto digest function exists in the extensions schema');

select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'name'), 'restaurants.name exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'slug'), 'restaurants.slug exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'description'), 'restaurants.description exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'logo_url'), 'restaurants.logo_url exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'address'), 'restaurants.address exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'phone'), 'restaurants.phone exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'currency'), 'restaurants.currency exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'restaurants' and column_name = 'is_active'), 'restaurants.is_active exists');
select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurants'
      and column_name = 'currency'
      and column_default like '%INR%'
  ),
  'restaurants.currency has the INR default'
);

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'menu_items'
      and column_name = 'price'
      and data_type = 'numeric'
      and numeric_precision = 10
      and numeric_scale = 2
  ),
  'menu_items.price is numeric(10,2)'
);

select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'menu_items' and column_name = 'original_price'), 'menu_items.original_price exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'menu_items' and column_name = 'is_veg'), 'menu_items.is_veg exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'menu_items' and column_name = 'is_available'), 'menu_items.is_available exists');

select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'order_number'), 'orders.order_number exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'status'), 'orders.status exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'total_amount'), 'orders.total_amount exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'special_instructions'), 'orders.special_instructions exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'idempotency_key'), 'orders.idempotency_key exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'request_fingerprint'), 'orders.request_fingerprint exists');
select ok((select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'idempotency_key'), 'orders.idempotency_key remains nullable for legacy rows');
select ok((select is_nullable = 'YES' from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'request_fingerprint'), 'orders.request_fingerprint remains nullable for legacy rows');
select ok(
  exists (
    select 1
    from pg_constraint as c
    join pg_class as rel on rel.oid = c.conrelid
    join pg_namespace as n on n.oid = rel.relnamespace
    where n.nspname = 'public'
      and rel.relname = 'orders'
      and c.conname = 'orders_idempotency_key_key'
      and c.contype = 'u'
  ),
  'orders has a unique idempotency-key constraint'
);

select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'item_name_snapshot'), 'order_items.item_name_snapshot exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'unit_price_snapshot'), 'order_items.unit_price_snapshot exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'quantity'), 'order_items.quantity exists');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'order_items' and column_name = 'line_total'), 'order_items.line_total exists');

select ok(not has_column_privilege('anon', 'public.restaurant_tables', 'qr_token', 'SELECT'), 'anon cannot select restaurant_tables.qr_token');
select ok(not has_table_privilege('anon', 'public.restaurant_members', 'SELECT'), 'anon cannot select restaurant_members');
select ok(not has_table_privilege('anon', 'public.orders', 'SELECT'), 'anon cannot select orders');
select ok(not has_table_privilege('anon', 'public.order_items', 'SELECT'), 'anon cannot select order_items');

select ok(has_column_privilege('authenticated', 'public.orders', 'id', 'SELECT'), 'authenticated can select orders.id');
select ok(has_column_privilege('authenticated', 'public.orders', 'order_number', 'SELECT'), 'authenticated can select orders.order_number');
select ok(has_column_privilege('authenticated', 'public.orders', 'restaurant_id', 'SELECT'), 'authenticated can select orders.restaurant_id');
select ok(has_column_privilege('authenticated', 'public.orders', 'table_id', 'SELECT'), 'authenticated can select orders.table_id');
select ok(has_column_privilege('authenticated', 'public.orders', 'status', 'SELECT'), 'authenticated can select orders.status');
select ok(has_column_privilege('authenticated', 'public.orders', 'total_amount', 'SELECT'), 'authenticated can select orders.total_amount');
select ok(has_column_privilege('authenticated', 'public.orders', 'special_instructions', 'SELECT'), 'authenticated can select orders.special_instructions');
select ok(has_column_privilege('authenticated', 'public.orders', 'created_at', 'SELECT'), 'authenticated can select orders.created_at');

select ok(not has_column_privilege('anon', 'public.orders', 'idempotency_key', 'SELECT'), 'anon cannot select orders.idempotency_key');
select ok(not has_column_privilege('anon', 'public.orders', 'request_fingerprint', 'SELECT'), 'anon cannot select orders.request_fingerprint');
select ok(not has_column_privilege('authenticated', 'public.orders', 'idempotency_key', 'SELECT'), 'authenticated cannot select orders.idempotency_key');
select ok(not has_column_privilege('authenticated', 'public.orders', 'request_fingerprint', 'SELECT'), 'authenticated cannot select orders.request_fingerprint');
select ok(not has_column_privilege('authenticated', 'public.orders', 'idempotency_key', 'UPDATE'), 'authenticated cannot update orders.idempotency_key');
select ok(not has_column_privilege('authenticated', 'public.orders', 'request_fingerprint', 'UPDATE'), 'authenticated cannot update orders.request_fingerprint');
select ok(
  not has_table_privilege('authenticated', 'public.orders', 'INSERT')
  and not has_table_privilege('authenticated', 'public.orders', 'DELETE')
  and not has_table_privilege('authenticated', 'public.order_items', 'INSERT')
  and not has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.order_items', 'DELETE'),
  'authenticated has no broad order or order-item mutation privileges'
);
select ok(has_column_privilege('authenticated', 'public.orders', 'status', 'UPDATE'), 'authenticated can update order status');
select ok(
  not has_column_privilege('authenticated', 'public.orders', 'total_amount', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.orders', 'restaurant_id', 'UPDATE')
  and not has_column_privilege('authenticated', 'public.orders', 'table_id', 'UPDATE'),
  'authenticated cannot update protected order fields'
);

select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurants' and policyname = 'restaurants_public_read'), 'active restaurant public policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'categories_public_read'), 'active category public policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'menu_items' and policyname = 'menu_items_public_read'), 'active menu-item public policy exists');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_member_select' and qual like '%is_restaurant_member%'), 'orders SELECT policy is tenant-bound');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_member_status_update' and qual like '%is_restaurant_member%'), 'orders status UPDATE policy is tenant-bound');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'order_items' and policyname = 'order_items_member_select' and qual like '%is_restaurant_member%'), 'order_items SELECT policy is tenant-bound');

select ok(
  exists (
    select 1
    from pg_trigger as tr
    join pg_class as c on c.oid = tr.tgrelid
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and tr.tgname = 'orders_immutable_fields'
      and not tr.tgisinternal
  ),
  'the order immutable-field trigger exists'
);

select ok(
  position('new.idempotency_key is distinct from old.idempotency_key' in lower(pg_get_functiondef('public.prevent_order_immutable_updates()'::regprocedure))) > 0
  and position('new.request_fingerprint is distinct from old.request_fingerprint' in lower(pg_get_functiondef('public.prevent_order_immutable_updates()'::regprocedure))) > 0
  and position('new.total_amount is distinct from old.total_amount' in lower(pg_get_functiondef('public.prevent_order_immutable_updates()'::regprocedure))) > 0
  and position('new.special_instructions is distinct from old.special_instructions' in lower(pg_get_functiondef('public.prevent_order_immutable_updates()'::regprocedure))) > 0,
  'the immutable-order trigger protects financial and idempotency fields'
);

select ok(
  exists (
    select 1
    from pg_trigger as tr
    join pg_class as c on c.oid = tr.tgrelid
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and tr.tgname = 'orders_status_transitions'
      and not tr.tgisinternal
  ),
  'the order status-transition trigger exists'
);

select ok(to_regprocedure('public.get_public_menu(text,text)') is not null, 'get_public_menu(text,text) exists');
select ok(to_regprocedure('public.create_order(text,text,jsonb,text)') is null, 'the historical four-argument create_order overload is absent');
select ok(to_regprocedure('public.create_order(text,text,jsonb,text,text)') is not null, 'the five-argument create_order RPC exists');
select ok(
  pg_get_function_result(to_regprocedure('public.create_order(text,text,jsonb,text,text)')) like '%replayed%',
  'the five-argument RPC returns the replayed marker'
);
select ok(
  position('returning new_order.id, new_order.order_number, new_order.created_at' in lower(pg_get_functiondef(to_regprocedure('public.create_order(text,text,jsonb,text,text)')))) > 0,
  'the installed five-argument RPC uses an unambiguous INSERT alias'
);
select ok(
  position('returning id, order_number, created_at' in lower(pg_get_functiondef(to_regprocedure('public.create_order(text,text,jsonb,text,text)')))) = 0,
  'the installed five-argument RPC has no ambiguous RETURNING clause'
);
select ok(
  has_function_privilege('anon', 'public.get_public_menu(text,text)', 'EXECUTE')
  and has_function_privilege('anon', 'public.create_order(text,text,jsonb,text,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.create_order(text,text,jsonb,text,text)', 'EXECUTE'),
  'public RPC execute grants are present for anon and authenticated'
);
select ok(
  not exists (
    select 1
    from pg_enum as e
    join pg_type as t on t.oid = e.enumtypid
    join pg_namespace as n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'order_status'
      and e.enumlabel not in ('NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED')
  ),
  'order_status contains only the documented statuses'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000000001', true);

select ok(
  (select count(*) from public.orders) = 1
    and (select count(*) from public.orders where restaurant_id = '30000000-0000-4000-8000-000000000101') = 1,
  'an authenticated member sees only orders from its tenant'
);

select ok(
  (select count(*) from public.order_items) = 1
    and (select count(*) from public.order_items where restaurant_id = '30000000-0000-4000-8000-000000000101') = 1,
  'an authenticated member sees only order items from its tenant'
);

update public.orders
set status = 'PREPARING'
where id = '30000000-0000-4000-8000-000000000501';

update public.orders
set status = 'PREPARING'
where id = '30000000-0000-4000-8000-000000000502';

reset role;

select is(
  (select status::text from public.orders where id = '30000000-0000-4000-8000-000000000501'),
  'PREPARING',
  'an authenticated member can update status within its tenant'
);

select is(
  (select status::text from public.orders where id = '30000000-0000-4000-8000-000000000502'),
  'NEW',
  'an authenticated member cannot update another tenant order'
);

select * from finish();

rollback;
