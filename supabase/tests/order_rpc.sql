-- pgTAP coverage for the public menu/order RPCs.
-- All fixtures are transactional and are rolled back at the end of the file.

begin;

create extension if not exists pgtap;

create function public.test_order_items_post_order_failure()
returns trigger
language plpgsql
as $$
begin
  if new.special_instructions = 'force-post-order-insert-failure' then
    raise exception 'Deliberate order item failure for atomicity testing'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger test_order_items_post_order_failure
before insert on public.order_items
for each row execute function public.test_order_items_post_order_failure();

select plan(33);

insert into public.restaurants (id, name, slug, currency)
values
  ('20000000-0000-4000-8000-000000000001', 'Phase Six A', 'phase-six-a', 'INR'),
  ('20000000-0000-4000-8000-000000000002', 'Phase Six B', 'phase-six-b', 'INR');

insert into public.categories (id, restaurant_id, name)
values
  ('20000000-0000-4000-8000-000000000101', '20000000-0000-4000-8000-000000000001', 'Test category A'),
  ('20000000-0000-4000-8000-000000000102', '20000000-0000-4000-8000-000000000002', 'Test category B');

insert into public.menu_items (
  id, restaurant_id, category_id, name, price, is_veg, is_available
)
values
  ('20000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000101', 'Test item A', 125.50, true, true),
  ('20000000-0000-4000-8000-000000000202', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000102', 'Test item B', 999.00, false, true),
  ('20000000-0000-4000-8000-000000000203', '20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000101', 'Test item C', 10.00, true, true);

insert into public.restaurant_tables (id, restaurant_id, label, qr_token)
values (
  '20000000-0000-4000-8000-000000000301',
  '20000000-0000-4000-8000-000000000001',
  'Phase Six Table',
  'phase-six-table'
);

create temporary table first_order on commit drop as
select o.order_id, o.order_number, o.status, o.total_amount, o.created_at, o.replayed
from public.create_order(
  'phase-six-a',
  'phase-six-table',
  jsonb_build_array(jsonb_build_object(
    'menu_item_id', '20000000-0000-4000-8000-000000000201',
    'quantity', 2,
    'special_instructions', '  No onions  '
  )),
  '  Window seat  ',
  'phase-six-order-1'
) as o;

select ok(
  not (select replayed from first_order),
  'a new order is not marked as a replay'
);

select is(
  (select total_amount from first_order),
  251.00::numeric,
  'the order total uses the database menu price'
);

select ok(
  exists (
    select 1
    from public.order_items as oi
    where oi.order_id = (select order_id from first_order)
      and oi.restaurant_id = '20000000-0000-4000-8000-000000000001'
      and oi.unit_price_snapshot = 125.50
      and oi.line_total = 251.00
      and oi.quantity = 2
      and oi.special_instructions = 'No onions'
  ),
  'order item name/price/quantity snapshots are created correctly'
);

select ok(
  (select idempotency_key = 'phase-six-order-1'
     and request_fingerprint is not null
     and request_fingerprint ~ '^[0-9a-f]{64}$'
   from public.orders
   where id = (select order_id from first_order)),
  'idempotency metadata is stored on the order'
);

select ok(
  (select request_fingerprint = encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'restaurant_slug', 'phase-six-a',
          'table_token', 'phase-six-table',
          'items', jsonb_build_array(jsonb_build_object(
            'menu_item_id', '20000000-0000-4000-8000-000000000201',
            'quantity', 2,
            'special_instructions', 'No onions'
          )),
          'special_instructions', 'Window seat'
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) from public.orders where id = (select order_id from first_order)),
  'the stored fingerprint uses the canonical normalized payload'
);

select throws_ok(
  $$
    update public.orders
    set idempotency_key = 'phase-six-order-replacement'
    where id = (select order_id from first_order)
  $$,
  'P0001',
  'Only an order status may be changed',
  'the idempotency key is immutable'
);

select throws_ok(
  $$
    update public.orders
    set request_fingerprint = null
    where id = (select order_id from first_order)
  $$,
  'P0001',
  'Only an order status may be changed',
  'the request fingerprint is immutable'
);

select ok(
  (select idempotency_key = 'phase-six-order-1'
     and request_fingerprint is not null
   from public.orders
   where id = (select order_id from first_order)),
  'rejected metadata updates leave the original metadata unchanged'
);

create temporary table atomic_before on commit drop as
select
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001') as order_count,
  (select count(*) from public.order_items where restaurant_id = '20000000-0000-4000-8000-000000000001') as item_count;

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(
        jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1),
        jsonb_build_object(
          'menu_item_id', '20000000-0000-4000-8000-000000000203',
          'quantity', 1,
          'special_instructions', 'force-post-order-insert-failure'
        )
      ),
      null,
      'phase-six-post-insert-failure'
    )
  $$,
  'P0001',
  'Deliberate order item failure for atomicity testing',
  'a failure during order-item insertion is surfaced'
);

select ok(
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select order_count from atomic_before)
  and (select count(*) from public.order_items where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select item_count from atomic_before),
  'a failed order creation rolls back the order and all order items'
);

select ok(
  not exists (
    select 1 from public.orders where idempotency_key = 'phase-six-post-insert-failure'
  ),
  'a rolled-back order does not reserve its idempotency key'
);

create temporary table unordered_before on commit drop as
select
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001') as order_count,
  (select count(*) from public.order_items where restaurant_id = '20000000-0000-4000-8000-000000000001') as item_count;

create temporary table unordered_first on commit drop as
select o.order_id, o.replayed
from public.create_order(
  'phase-six-a',
  'phase-six-table',
  jsonb_build_array(
    jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1),
    jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000203', 'quantity', 1)
  ),
  null,
  'phase-six-order-order-insensitive'
) as o;

select ok(
  not (select replayed from unordered_first),
  'the first canonical-order request is not a replay'
);

create temporary table unordered_replay on commit drop as
select o.order_id, o.replayed
from public.create_order(
  'phase-six-a',
  'phase-six-table',
  jsonb_build_array(
    jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000203', 'quantity', 1),
    jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1)
  ),
  null,
  'phase-six-order-order-insensitive'
) as o;

select ok(
  (select replayed from unordered_replay)
    and (select order_id from unordered_replay) = (select order_id from unordered_first),
  'reordering cart items replays the same canonical request'
);

select ok(
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select order_count + 1 from unordered_before)
  and (select count(*) from public.order_items where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select item_count + 2 from unordered_before),
  'an order-insensitive replay does not insert a duplicate order or items'
);

update public.orders
set status = 'PREPARING'
where id = (select order_id from first_order);

update public.orders
set status = 'READY'
where id = (select order_id from first_order);

update public.orders
set status = 'SERVED'
where id = (select order_id from first_order);

update public.menu_items
set is_available = false,
    price = 999.00
where id = '20000000-0000-4000-8000-000000000201';

create temporary table replay_before on commit drop as
select
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001') as order_count,
  (select count(*) from public.order_items where order_id = (select order_id from first_order)) as item_count;

create temporary table matching_replay on commit drop as
select o.order_id, o.order_number, o.status, o.total_amount, o.created_at, o.replayed
from public.create_order(
  ' phase-six-a ',
  ' phase-six-table ',
  jsonb_build_array(jsonb_build_object(
    'menu_item_id', '20000000-0000-4000-8000-000000000201',
    'quantity', 2,
    'special_instructions', 'No onions'
  )),
  'Window seat',
  'phase-six-order-1'
) as o;

select ok(
  (select replayed from matching_replay)
    and (select order_id from matching_replay) = (select order_id from first_order),
  'a matching request replays the existing order before mutable menu checks'
);

select is(
  (select status::text from matching_replay),
  'SERVED',
  'a replay returns the current order status'
);

select is(
  (select total_amount from matching_replay),
  251.00::numeric,
  'a replay returns the original database-priced total'
);

select ok(
  (select created_at from matching_replay) = (select created_at from first_order),
  'a replay returns the original creation timestamp'
);

select ok(
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select order_count from replay_before)
  and (select count(*) from public.order_items where order_id = (select order_id from first_order))
    = (select item_count from replay_before),
  'a replay does not insert another order or order item'
);

create temporary table conflict_before on commit drop as
select
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001') as order_count,
  (select count(*) from public.order_items where restaurant_id = '20000000-0000-4000-8000-000000000001') as item_count;

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1)),
      null,
      'phase-six-order-1'
    )
  $$,
  'PZ001',
  'Idempotency key was already used for a different request',
  'the same key with a different payload is rejected'
);

select ok(
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select order_count from conflict_before)
  and (select count(*) from public.order_items where restaurant_id = '20000000-0000-4000-8000-000000000001')
    = (select item_count from conflict_before),
  'an idempotency conflict inserts no rows'
);

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-b',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 2)),
      'Window seat',
      'phase-six-order-1'
    )
  $$,
  'PZ001',
  'Idempotency key was already used for a different request',
  'the same key with a different restaurant is rejected'
);

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'another-table-token',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 2)),
      'Window seat',
      'phase-six-order-1'
    )
  $$,
  'PZ001',
  'Idempotency key was already used for a different request',
  'the same key with a different table is rejected'
);

update public.menu_items
set is_available = true,
    price = 125.50
where id = '20000000-0000-4000-8000-000000000201';

select throws_ok(
  $$
    update public.orders
    set status = 'NEW'
    where id = (select order_id from first_order)
  $$,
  'P0001',
  'Invalid order status transition',
  'a served order cannot regress to NEW'
);

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1.5)),
      null,
      'phase-six-invalid-fractional'
    )
  $$,
  'P0001',
  'Each item needs a menu_item_id and quantity',
  'fractional quantities are rejected'
);

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(
        jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1),
        jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1)
      ),
      null,
      'phase-six-invalid-duplicate'
    )
  $$,
  'P0001',
  'Each menu item may appear only once',
  'duplicate menu items are rejected'
);

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000202', 'quantity', 1)),
      null,
      'phase-six-invalid-cross-tenant'
    )
  $$,
  'P0001',
  'A menu item is not available',
  'a menu item from another tenant is rejected'
);

update public.menu_items
set is_available = false
where id = '20000000-0000-4000-8000-000000000201';

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1)),
      null,
      'phase-six-validation-retry'
    )
  $$,
  'P0001',
  'A menu item is not available',
  'an unavailable menu item is rejected'
);

select ok(
  not exists (
    select 1 from public.orders where idempotency_key = 'phase-six-validation-retry'
  ),
  'failed validation does not reserve an idempotency key'
);

update public.menu_items
set is_available = true
where id = '20000000-0000-4000-8000-000000000201';

create temporary table validation_retry on commit drop as
select o.order_id, o.replayed
from public.create_order(
  'phase-six-a',
  'phase-six-table',
  jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1)),
  null,
  'phase-six-validation-retry'
) as o;

select ok(
  (select order_id is not null and not replayed from validation_retry),
  'a key from a failed validation can be used later'
);

create temporary table mixed_before on commit drop as
select count(*) as order_count
from public.orders
where restaurant_id = '20000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(
        jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1),
        jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000202', 'quantity', 1)
      ),
      null,
      'phase-six-invalid-mixed'
    )
  $$,
  'P0001',
  'A menu item is not available',
  'a mixed-tenant order is rejected'
);

select is(
  (select count(*) from public.orders where restaurant_id = '20000000-0000-4000-8000-000000000001'),
  (select order_count from mixed_before),
  'a rejected mixed-tenant order leaves no partial order row'
);

select throws_ok(
  $$
    select * from public.create_order(
      'phase-six-a',
      'wrong-table-token',
      jsonb_build_array(jsonb_build_object('menu_item_id', '20000000-0000-4000-8000-000000000201', 'quantity', 1)),
      null,
      'phase-six-invalid-table'
    )
  $$,
  'P0001',
  'The restaurant or table is not available',
  'an invalid table token is rejected'
);

select * from finish();

rollback;
