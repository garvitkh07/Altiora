-- Transactional behavior checks for the public menu/order RPCs.
-- These fixtures are rolled back and never touch a linked production project.

begin;

do $$
declare
  restaurant_a constant uuid := '20000000-0000-4000-8000-000000000001';
  category_a constant uuid := '20000000-0000-4000-8000-000000000101';
  item_a constant uuid := '20000000-0000-4000-8000-000000000201';
  restaurant_b constant uuid := '20000000-0000-4000-8000-000000000002';
  category_b constant uuid := '20000000-0000-4000-8000-000000000102';
  item_b constant uuid := '20000000-0000-4000-8000-000000000202';
  order_id uuid;
  total_amount numeric;
  orders_before bigint;
  orders_after bigint;
  rejected boolean;
begin
  insert into public.restaurants (id, name, slug, currency)
  values
    (restaurant_a, 'Phase Six A', 'phase-six-a', 'INR'),
    (restaurant_b, 'Phase Six B', 'phase-six-b', 'INR');

  insert into public.categories (id, restaurant_id, name)
  values
    (category_a, restaurant_a, 'Test category A'),
    (category_b, restaurant_b, 'Test category B');

  insert into public.menu_items (
    id, restaurant_id, category_id, name, price, is_veg, is_available
  ) values
    (item_a, restaurant_a, category_a, 'Test item A', 125.50, true, true),
    (item_b, restaurant_b, category_b, 'Test item B', 999.00, false, true);

  insert into public.restaurant_tables (id, restaurant_id, label, qr_token)
  values (
    '20000000-0000-4000-8000-000000000301',
    restaurant_a,
    'Phase Six Table',
    'phase-six-table'
  );

  select o.order_id, o.total_amount
    into order_id, total_amount
  from public.create_order(
    'phase-six-a',
    'phase-six-table',
    jsonb_build_array(jsonb_build_object('menu_item_id', item_a, 'quantity', 2)),
    null
  ) as o;

  if total_amount <> 251.00 then
    raise exception 'Database-priced total was %, expected 251.00', total_amount;
  end if;

  if not exists (
    select 1
    from public.order_items as oi
    where oi.order_id = order_id
      and oi.restaurant_id = restaurant_a
      and oi.unit_price_snapshot = 125.50
      and oi.line_total = 251.00
      and oi.quantity = 2
  ) then
    raise exception 'Order item snapshot or line total is incorrect';
  end if;

  update public.orders set status = 'PREPARING' where id = order_id;
  update public.orders set status = 'READY' where id = order_id;
  update public.orders set status = 'SERVED' where id = order_id;

  rejected := false;
  begin
    update public.orders set status = 'NEW' where id = order_id;
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A served order was allowed to regress to NEW';
  end if;

  rejected := false;
  begin
    perform public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', item_a, 'quantity', 1.5)),
      null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Fractional quantity was accepted';
  end if;

  rejected := false;
  begin
    perform public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(
        jsonb_build_object('menu_item_id', item_a, 'quantity', 1),
        jsonb_build_object('menu_item_id', item_a, 'quantity', 1)
      ),
      null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Duplicate menu items were accepted';
  end if;

  rejected := false;
  begin
    perform public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', item_b, 'quantity', 1)),
      null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'A menu item from another restaurant was accepted';
  end if;

  update public.menu_items
  set is_available = false
  where id = item_a;

  rejected := false;
  begin
    perform public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(jsonb_build_object('menu_item_id', item_a, 'quantity', 1)),
      null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'An unavailable menu item was accepted';
  end if;

  update public.menu_items
  set is_available = true
  where id = item_a;

  select count(*) into orders_before
  from public.orders
  where restaurant_id = restaurant_a;

  rejected := false;
  begin
    perform public.create_order(
      'phase-six-a',
      'phase-six-table',
      jsonb_build_array(
        jsonb_build_object('menu_item_id', item_a, 'quantity', 1),
        jsonb_build_object('menu_item_id', item_b, 'quantity', 1)
      ),
      null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'Mixed-tenant order was accepted';
  end if;

  select count(*) into orders_after
  from public.orders
  where restaurant_id = restaurant_a;

  if orders_after <> orders_before then
    raise exception 'Rejected order left a partial order row';
  end if;

  rejected := false;
  begin
    perform public.create_order(
      'phase-six-a',
      'wrong-table-token',
      jsonb_build_array(jsonb_build_object('menu_item_id', item_a, 'quantity', 1)),
      null
    );
  exception when sqlstate 'P0001' then
    rejected := true;
  end;
  if not rejected then
    raise exception 'An invalid table token was accepted';
  end if;
end;
$$;

rollback;
