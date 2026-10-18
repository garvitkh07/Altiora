-- Static, database-side contract checks for `supabase test db`.
-- The assertions deliberately avoid fixture data so they also run against a
-- freshly migrated project. Public menu access is tested through the RPC
-- contract rather than granting anonymous access to restaurant_tables.qr_token.

begin;

do $$
declare
  table_name text;
  required_tables constant text[] := array[
    'restaurants',
    'restaurant_members',
    'categories',
    'menu_items',
    'restaurant_tables',
    'orders',
    'order_items'
  ];
  required_column text;
begin
  foreach table_name in array required_tables loop
    if to_regclass(format('public.%s', table_name)) is null then
      raise exception 'Missing required table public.%', table_name;
    end if;

    if not exists (
      select 1
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = table_name
        and c.relrowsecurity
    ) then
      raise exception 'RLS is not enabled on public.%', table_name;
    end if;
  end loop;

  if to_regclass('public.order_items_restaurant_idx') is null then
    raise exception 'Missing tenant index on public.order_items';
  end if;

  foreach required_column in array array[
    'name', 'slug', 'description', 'logo_url', 'address', 'phone', 'currency', 'is_active'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'restaurants'
        and column_name = required_column
    ) then
      raise exception 'restaurants is missing required column %', required_column;
    end if;
  end loop;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'restaurants'
      and column_name = 'currency'
      and column_default like '%INR%'
  ) then
    raise exception 'restaurants.currency must have an explicit INR default';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'menu_items'
      and column_name = 'price'
      and data_type = 'numeric'
      and numeric_precision = 10
      and numeric_scale = 2
  ) then
    raise exception 'menu_items.price must be numeric(10,2)';
  end if;

  foreach required_column in array array[
    'original_price', 'is_veg', 'is_available'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'menu_items'
        and column_name = required_column
    ) then
      raise exception 'menu_items is missing required column %', required_column;
    end if;
  end loop;

  foreach required_column in array array[
    'order_number', 'status', 'total_amount', 'special_instructions'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'orders'
        and column_name = required_column
    ) then
      raise exception 'orders is missing required column %', required_column;
    end if;
  end loop;

  foreach required_column in array array[
    'item_name_snapshot', 'unit_price_snapshot', 'quantity', 'line_total'
  ] loop
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'order_items'
        and column_name = required_column
    ) then
      raise exception 'order_items is missing required column %', required_column;
    end if;
  end loop;

  if has_column_privilege('anon', 'public.restaurant_tables', 'qr_token', 'SELECT') then
    raise exception 'anon must not have SELECT on restaurant_tables.qr_token';
  end if;

  foreach table_name in array array['restaurant_members', 'orders', 'order_items'] loop
    if has_table_privilege('anon', format('public.%s', table_name), 'SELECT') then
      raise exception 'anon must not SELECT from public.%', table_name;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.orders', 'INSERT')
    or has_table_privilege('authenticated', 'public.orders', 'DELETE')
    or has_table_privilege('authenticated', 'public.order_items', 'INSERT')
    or has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
    or has_table_privilege('authenticated', 'public.order_items', 'DELETE') then
    raise exception 'authenticated has broad order/order_item mutation privileges';
  end if;

  if not has_column_privilege('authenticated', 'public.orders', 'status', 'UPDATE') then
    raise exception 'authenticated must be able to update order status';
  end if;

  if has_column_privilege('authenticated', 'public.orders', 'total_amount', 'UPDATE')
    or has_column_privilege('authenticated', 'public.orders', 'restaurant_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.orders', 'table_id', 'UPDATE') then
    raise exception 'authenticated must not update protected order columns';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'restaurants'
      and policyname = 'restaurants_public_read'
  ) then
    raise exception 'Missing active-restaurant public policy';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'categories'
      and policyname = 'categories_public_read'
  ) then
    raise exception 'Missing active-category public policy';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'menu_items'
      and policyname = 'menu_items_public_read'
  ) then
    raise exception 'Missing active-menu-item public policy';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'orders_member_select'
      and qual like '%is_restaurant_member%'
  ) then
    raise exception 'Missing tenant-bound order SELECT policy';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'orders'
      and policyname = 'orders_member_status_update'
      and qual like '%is_restaurant_member%'
  ) then
    raise exception 'Missing tenant-bound order status UPDATE policy';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'order_items'
      and policyname = 'order_items_member_select'
      and qual like '%is_restaurant_member%'
  ) then
    raise exception 'Missing tenant-bound order item SELECT policy';
  end if;

  if not exists (
    select 1
    from pg_trigger as tr
    join pg_class as c on c.oid = tr.tgrelid
    join pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and tr.tgname = 'orders_immutable_fields'
      and not tr.tgisinternal
  ) then
    raise exception 'Missing order immutable-field trigger';
  end if;

  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'get_public_menu'
  ) then
    raise exception 'Missing get_public_menu() RPC';
  end if;

  if not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'create_order'
  ) then
    raise exception 'Missing create_order() RPC';
  end if;

  if not has_function_privilege('anon', 'public.get_public_menu(text,text)', 'EXECUTE')
    or not has_function_privilege('anon', 'public.create_order(text,text,jsonb,text)', 'EXECUTE') then
    raise exception 'Anonymous public RPC grants are missing';
  end if;

  if exists (
    select 1
    from pg_enum as e
    join pg_type as t on t.oid = e.enumtypid
    join pg_namespace as n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'order_status'
      and e.enumlabel not in ('NEW', 'PREPARING', 'READY', 'SERVED', 'CANCELLED')
  ) then
    raise exception 'order_status contains a non-contract status';
  end if;
end;
$$;

rollback;
