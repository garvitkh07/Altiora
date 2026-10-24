-- P0 QR/public-access regression coverage.
--
-- These fixtures are transactional and roll back at the end of the file. The
-- tests exercise the local database roles directly; the public menu/order RPCs
-- remain the supported anonymous path.

begin;

create extension if not exists pgtap;

select plan(35);

insert into auth.users (id, aud, role, email)
values
  ('40000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'qr-a@example.test'),
  ('40000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'qr-b@example.test');

insert into public.restaurants (id, name, slug, currency)
values
  ('40000000-0000-4000-8000-000000000101', 'QR Tenant A', 'qr-p0-a', 'INR'),
  ('40000000-0000-4000-8000-000000000102', 'QR Tenant B', 'qr-p0-b', 'INR');

insert into public.restaurant_members (restaurant_id, user_id, role)
values
  ('40000000-0000-4000-8000-000000000101', '40000000-0000-4000-8000-000000000001', 'STAFF'),
  ('40000000-0000-4000-8000-000000000102', '40000000-0000-4000-8000-000000000002', 'STAFF');

insert into public.categories (id, restaurant_id, name)
values
  ('40000000-0000-4000-8000-000000000201', '40000000-0000-4000-8000-000000000101', 'QR Category A'),
  ('40000000-0000-4000-8000-000000000202', '40000000-0000-4000-8000-000000000102', 'QR Category B');

insert into public.menu_items (id, restaurant_id, category_id, name, price)
values
  ('40000000-0000-4000-8000-000000000301', '40000000-0000-4000-8000-000000000101', '40000000-0000-4000-8000-000000000201', 'QR Item A', 10.00),
  ('40000000-0000-4000-8000-000000000302', '40000000-0000-4000-8000-000000000102', '40000000-0000-4000-8000-000000000202', 'QR Item B', 20.00);

insert into public.restaurant_tables (id, restaurant_id, label, qr_token, is_active)
values
  ('40000000-0000-4000-8000-000000000401', '40000000-0000-4000-8000-000000000101', 'QR A Active', 'qr-p0-token-a', true),
  ('40000000-0000-4000-8000-000000000402', '40000000-0000-4000-8000-000000000101', 'QR A Inactive', 'qr-p0-token-inactive', false),
  ('40000000-0000-4000-8000-000000000403', '40000000-0000-4000-8000-000000000102', 'QR B Active', 'qr-p0-token-b', true);

-- Effective privilege checks include table-level and column-level grants.
select ok(not has_table_privilege('anon', 'public.restaurants', 'SELECT'), 'anon cannot directly select restaurants');
select ok(not has_table_privilege('anon', 'public.categories', 'SELECT'), 'anon cannot directly select categories');
select ok(not has_table_privilege('anon', 'public.menu_items', 'SELECT'), 'anon cannot directly select menu items');
select ok(not has_table_privilege('anon', 'public.restaurant_tables', 'SELECT'), 'anon cannot directly select restaurant tables');
select ok(not has_column_privilege('anon', 'public.restaurant_tables', 'qr_token', 'SELECT'), 'anon cannot select qr_token');

select ok(has_column_privilege('authenticated', 'public.restaurant_tables', 'id', 'SELECT'), 'authenticated can select safe table ids');
select ok(has_column_privilege('authenticated', 'public.restaurant_tables', 'restaurant_id', 'SELECT'), 'authenticated can filter safe table metadata by restaurant');
select ok(has_column_privilege('authenticated', 'public.restaurant_tables', 'label', 'SELECT'), 'authenticated can select safe table labels');
select ok(has_column_privilege('authenticated', 'public.restaurant_tables', 'is_active', 'SELECT'), 'authenticated can select safe table activity state');
select ok(not has_column_privilege('authenticated', 'public.restaurant_tables', 'qr_token', 'SELECT'), 'authenticated cannot select qr_token');
select ok(not has_table_privilege('authenticated', 'public.restaurant_tables', 'INSERT'), 'authenticated cannot insert restaurant tables directly');
select ok(not has_table_privilege('authenticated', 'public.restaurant_tables', 'UPDATE'), 'authenticated cannot update restaurant tables directly');
select ok(not has_table_privilege('authenticated', 'public.restaurant_tables', 'DELETE'), 'authenticated cannot delete restaurant tables directly');

select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurants' and policyname = 'restaurants_public_read'), 'restaurant anonymous direct-read policy is absent');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'categories' and policyname = 'categories_public_read'), 'category anonymous direct-read policy is absent');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'menu_items' and policyname = 'menu_items_public_read'), 'menu-item anonymous direct-read policy is absent');
select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurant_tables' and policyname = 'restaurant_tables_public_metadata_read'), 'table anonymous direct-read policy is absent');
select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'restaurant_tables' and policyname = 'restaurant_tables_member_metadata_read'), 'authenticated safe table metadata policy exists');

-- Direct anonymous enumeration is denied at the privilege boundary.
set local role anon;
select throws_ok($$select id from public.restaurants limit 1$$, '42501', 'permission denied for table restaurants', 'anon cannot enumerate restaurants directly');
select throws_ok($$select id from public.categories limit 1$$, '42501', 'permission denied for table categories', 'anon cannot enumerate categories directly');
select throws_ok($$select id from public.menu_items limit 1$$, '42501', 'permission denied for table menu_items', 'anon cannot enumerate menu items directly');
select throws_ok($$select id from public.restaurant_tables limit 1$$, '42501', 'permission denied for table restaurant_tables', 'anon cannot enumerate restaurant tables directly');

select ok(
  (select public.get_public_menu('qr-p0-a', 'qr-p0-token-a') -> 'table' ->> 'label') = 'QR A Active',
  'valid token can resolve the public menu through get_public_menu'
);
select ok(
  (select public.get_public_menu('qr-p0-a', 'qr-p0-token-a')::text not like '%qr-p0-token-a%'),
  'public menu response never contains the raw qr_token'
);
select throws_ok(
  $$select public.get_public_menu('qr-p0-a', 'qr-p0-invalid')$$,
  'P0001',
  'The menu or table is not available',
  'invalid table tokens fail safely'
);
select throws_ok(
  $$select public.get_public_menu('qr-p0-a', 'qr-p0-token-inactive')$$,
  'P0001',
  'The menu or table is not available',
  'inactive tables fail safely'
);

-- A valid member retains only the safe metadata needed by the dashboard and
-- cannot read the other tenant's service points or the QR secret.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000001', true);
select ok(
  (select count(*) from public.restaurant_tables) = 2
    and (select count(*) from public.restaurant_tables where restaurant_id = '40000000-0000-4000-8000-000000000101') = 2
    and (select count(*) from public.restaurant_tables where restaurant_id = '40000000-0000-4000-8000-000000000102') = 0,
  'authenticated members see safe table metadata only within their tenant'
);
select is(
  (select label from public.restaurant_tables where id = '40000000-0000-4000-8000-000000000401'),
  'QR A Active',
  'authorized staff can read the dashboard table label'
);
select throws_ok(
  $$select qr_token from public.restaurant_tables where id = '40000000-0000-4000-8000-000000000401'$$,
  '42501',
  'permission denied for table restaurant_tables',
  'authenticated users cannot read raw qr_token'
);
select throws_ok(
  $$insert into public.restaurant_tables (restaurant_id, label, qr_token) values ('40000000-0000-4000-8000-000000000101', 'QR Direct Insert', 'qr-direct-insert')$$,
  '42501',
  'permission denied for table restaurant_tables',
  'authenticated users cannot insert restaurant tables directly'
);
select throws_ok(
  $$update public.restaurant_tables set label = 'QR Direct Update' where id = '40000000-0000-4000-8000-000000000401'$$,
  '42501',
  'permission denied for table restaurant_tables',
  'authenticated users cannot update restaurant tables directly'
);
select throws_ok(
  $$delete from public.restaurant_tables where id = '40000000-0000-4000-8000-000000000401'$$,
  '42501',
  'permission denied for table restaurant_tables',
  'authenticated users cannot delete restaurant tables directly'
);

-- The public RPCs remain available to anonymous callers. This preserves the
-- existing order/idempotency contract while direct table reads are removed.
reset role;
set local role anon;
select ok(
  not (select replayed from public.create_order(
    'qr-p0-a',
    'qr-p0-token-a',
    jsonb_build_array(jsonb_build_object('menu_item_id', '40000000-0000-4000-8000-000000000301', 'quantity', 1)),
    null,
    'qr-p0-order-key-001'
  )),
  'anonymous order creation with a valid token creates a new order'
);
select ok(
  (select replayed from public.create_order(
    'qr-p0-a',
    'qr-p0-token-a',
    jsonb_build_array(jsonb_build_object('menu_item_id', '40000000-0000-4000-8000-000000000301', 'quantity', 1)),
    null,
    'qr-p0-order-key-001'
  )),
  'matching anonymous order retry is replayed'
);
select throws_ok(
  $$select * from public.create_order(
    'qr-p0-a',
    'qr-p0-token-a',
    jsonb_build_array(jsonb_build_object('menu_item_id', '40000000-0000-4000-8000-000000000301', 'quantity', 2)),
    null,
    'qr-p0-order-key-001'
  )$$,
  'PZ001',
  'Idempotency key was already used for a different request',
  'anonymous idempotency conflicts remain unchanged'
);

select * from finish();

rollback;
