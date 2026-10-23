-- Harden the forward-only order idempotency contract.
--
-- Cart item order is not semantically significant: order_items has one row per
-- menu item and the order total does not depend on array position. Canonicalize
-- the item list before hashing so a retry assembled in a different UI order
-- still replays the same order.

create or replace function public.prevent_order_immutable_updates()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.id is distinct from old.id
    or new.order_number is distinct from old.order_number
    or new.restaurant_id is distinct from old.restaurant_id
    or new.table_id is distinct from old.table_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.subtotal_amount is distinct from old.subtotal_amount
    or new.tax_amount is distinct from old.tax_amount
    or new.total_amount is distinct from old.total_amount
    or new.special_instructions is distinct from old.special_instructions
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint then
    raise exception 'Only an order status may be changed' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_order_immutable_updates() from public;

-- The API only needs the columns used by the kitchen dashboard and status
-- route. Column grants avoid exposing the replay key or its payload fingerprint
-- through ordinary authenticated table reads while keeping those API queries
-- valid, including their tenant/time filters.
revoke select on public.orders from public, anon, authenticated;
revoke update (idempotency_key, request_fingerprint)
  on public.orders from public, anon, authenticated;
grant select (
  id,
  order_number,
  restaurant_id,
  table_id,
  status,
  total_amount,
  special_instructions,
  created_at
) on public.orders to authenticated;

create or replace function public.create_order(
  p_restaurant_slug text,
  p_table_token text,
  p_items jsonb,
  p_special_instructions text,
  p_idempotency_key text
)
returns table (
  order_id uuid,
  order_number bigint,
  status public.order_status,
  total_amount numeric(12, 2),
  created_at timestamptz,
  replayed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_menu_item_id uuid;
  v_item_name text;
  v_unit_price numeric(10, 2);
  v_quantity integer;
  v_item_instructions text;
  v_restaurant_slug text;
  v_table_token text;
  v_restaurant_id uuid;
  v_table_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_created_at timestamptz;
  v_total numeric(12, 2) := 0;
  v_seen_item_ids uuid[] := '{}'::uuid[];
  v_order_instructions text;
  v_idempotency_key text;
  v_request_fingerprint text;
  v_legacy_request_fingerprint text;
  v_canonical_items jsonb := '[]'::jsonb;
  v_legacy_items jsonb := '[]'::jsonb;
  v_item_position integer := 0;
  v_existing_fingerprint text;
  v_existing_order_id uuid;
  v_existing_order_number bigint;
  v_existing_status public.order_status;
  v_existing_total numeric(12, 2);
  v_existing_created_at timestamptz;
  v_constraint_name text;
begin
  v_restaurant_slug := nullif(btrim(p_restaurant_slug), '');
  v_table_token := nullif(btrim(p_table_token), '');
  v_order_instructions := nullif(btrim(p_special_instructions), '');
  v_idempotency_key := p_idempotency_key;

  if v_restaurant_slug is null or v_table_token is null then
    raise exception 'A restaurant slug and table token are required'
      using errcode = 'P0001';
  end if;

  if v_idempotency_key is null
    or v_idempotency_key <> btrim(v_idempotency_key)
    or char_length(v_idempotency_key) not between 16 and 255
    or v_idempotency_key !~ '^[A-Za-z0-9._~-]+$' then
    raise exception 'A valid idempotency key is required'
      using errcode = 'P0001';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) < 1 then
    raise exception 'At least one item is required'
      using errcode = 'P0001';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'An order cannot contain more than 50 items'
      using errcode = 'P0001';
  end if;

  if v_order_instructions is not null
    and char_length(v_order_instructions) > 500 then
    raise exception 'Special instructions cannot exceed 500 characters'
      using errcode = 'P0001';
  end if;

  -- Parse and normalize the request before looking at mutable menu state.
  -- Item positions are deliberately omitted from the fingerprint because cart
  -- item order is not part of the order's meaning.
  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_item_position := v_item_position + 1;

    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'menu_item_id')
      or not (v_item ? 'quantity')
      or jsonb_typeof(v_item -> 'menu_item_id') <> 'string'
      or jsonb_typeof(v_item -> 'quantity') <> 'number'
      or (v_item ->> 'quantity') !~ '^[0-9]+$'
      or (
        v_item ? 'special_instructions'
        and jsonb_typeof(v_item -> 'special_instructions')
          not in ('string', 'null')
      )
      or (
        select count(*)
        from jsonb_object_keys(v_item) as keys(key)
        where key not in (
          'menu_item_id',
          'quantity',
          'special_instructions'
        )
      ) > 0 then
      raise exception 'Each item needs a menu_item_id and quantity'
        using errcode = 'P0001';
    end if;

    begin
      v_menu_item_id := (v_item ->> 'menu_item_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'A valid menu item is required'
          using errcode = 'P0001';
    end;

    begin
      v_quantity := (v_item ->> 'quantity')::integer;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Quantity must be an integer between 1 and 99'
          using errcode = 'P0001';
    end;

    if v_quantity < 1 or v_quantity > 99 then
      raise exception 'Quantity must be an integer between 1 and 99'
        using errcode = 'P0001';
    end if;

    v_item_instructions :=
      nullif(btrim(v_item ->> 'special_instructions'), '');

    if v_item_instructions is not null
      and char_length(v_item_instructions) > 500 then
      raise exception 'Special instructions cannot exceed 500 characters'
        using errcode = 'P0001';
    end if;

    if v_menu_item_id = any(v_seen_item_ids) then
      raise exception 'Each menu item may appear only once'
        using errcode = 'P0001';
    end if;

    v_seen_item_ids := array_append(v_seen_item_ids, v_menu_item_id);
    v_legacy_items := v_legacy_items || jsonb_build_array(
      jsonb_build_object(
        'position', v_item_position,
        'menu_item_id', v_menu_item_id::text,
        'quantity', v_quantity,
        'special_instructions', v_item_instructions
      )
    );
    v_canonical_items := v_canonical_items || jsonb_build_array(
      jsonb_build_object(
        'menu_item_id', v_menu_item_id::text,
        'quantity', v_quantity,
        'special_instructions', v_item_instructions
      )
    );
  end loop;

  select coalesce(
    jsonb_agg(
      canonical_item
      order by (canonical_item ->> 'menu_item_id')::uuid
    ),
    '[]'::jsonb
  )
    into v_canonical_items
  from jsonb_array_elements(v_canonical_items) as canonical(canonical_item);

  v_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'restaurant_slug', v_restaurant_slug,
          'table_token', v_table_token,
          'items', v_canonical_items,
          'special_instructions', v_order_instructions
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Existing rows created by the preceding migration include array position in
  -- their fingerprint. Accept that legacy shape during replay while all new
  -- rows store the canonical, order-insensitive fingerprint above.
  v_legacy_request_fingerprint := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'restaurant_slug', v_restaurant_slug,
          'table_token', v_table_token,
          'items', v_legacy_items,
          'special_instructions', v_order_instructions
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- A committed replay returns the current order state before any mutable
  -- restaurant, table, menu, availability, or price checks.
  select
    o.id,
    o.order_number,
    o.status,
    o.total_amount,
    o.created_at,
    o.request_fingerprint
    into
      v_existing_order_id,
      v_existing_order_number,
      v_existing_status,
      v_existing_total,
      v_existing_created_at,
      v_existing_fingerprint
  from public.orders as o
  where o.idempotency_key = v_idempotency_key;

  if found then
    if v_existing_fingerprint is distinct from v_request_fingerprint
      and v_existing_fingerprint is distinct from v_legacy_request_fingerprint then
      raise exception 'Idempotency key was already used for a different request'
        using errcode = 'PZ001';
    end if;

    return query
    select
      v_existing_order_id,
      v_existing_order_number,
      v_existing_status,
      v_existing_total,
      v_existing_created_at,
      true;
    return;
  end if;

  select r.id, rt.id
    into v_restaurant_id, v_table_id
  from public.restaurants as r
  join public.restaurant_tables as rt
    on rt.restaurant_id = r.id
  where r.slug = v_restaurant_slug
    and r.is_active
    and rt.qr_token = v_table_token
    and rt.is_active
  for update of r, rt;

  if not found then
    raise exception 'The restaurant or table is not available'
      using errcode = 'P0001';
  end if;

  -- Validate every item against the current database price and availability.
  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_menu_item_id := (v_item ->> 'menu_item_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    select mi.name, mi.price
      into v_item_name, v_unit_price
    from public.menu_items as mi
    join public.categories as c
      on c.id = mi.category_id
     and c.restaurant_id = mi.restaurant_id
    where mi.id = v_menu_item_id
      and mi.restaurant_id = v_restaurant_id
      and mi.is_available
      and c.is_active
    for update of mi;

    if not found then
      raise exception 'A menu item is not available'
        using errcode = 'P0001';
    end if;

    v_total := v_total + round(v_unit_price * v_quantity, 2);
  end loop;

  begin
    insert into public.orders as new_order (
      restaurant_id,
      table_id,
      created_by,
      status,
      subtotal_amount,
      tax_amount,
      total_amount,
      special_instructions,
      idempotency_key,
      request_fingerprint
    ) values (
      v_restaurant_id,
      v_table_id,
      auth.uid(),
      'NEW',
      v_total,
      0,
      v_total,
      v_order_instructions,
      v_idempotency_key,
      v_request_fingerprint
    )
    returning new_order.id, new_order.order_number, new_order.created_at
      into v_order_id, v_order_number, v_created_at;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name is distinct from 'orders_idempotency_key_key' then
        raise;
      end if;

      select
        o.id,
        o.order_number,
        o.status,
        o.total_amount,
        o.created_at,
        o.request_fingerprint
        into
          v_existing_order_id,
          v_existing_order_number,
          v_existing_status,
          v_existing_total,
          v_existing_created_at,
          v_existing_fingerprint
      from public.orders as o
      where o.idempotency_key = v_idempotency_key;

      if not found then
        raise;
      end if;

      if v_existing_fingerprint is distinct from v_request_fingerprint
        and v_existing_fingerprint is distinct from v_legacy_request_fingerprint then
        raise exception 'Idempotency key was already used for a different request'
          using errcode = 'PZ001';
      end if;

      return query
      select
        v_existing_order_id,
        v_existing_order_number,
        v_existing_status,
        v_existing_total,
        v_existing_created_at,
        true;
      return;
  end;

  for v_item in
    select value
    from jsonb_array_elements(p_items)
  loop
    v_menu_item_id := (v_item ->> 'menu_item_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;
    v_item_instructions :=
      nullif(btrim(v_item ->> 'special_instructions'), '');

    select mi.name, mi.price
      into v_item_name, v_unit_price
    from public.menu_items as mi
    where mi.id = v_menu_item_id
      and mi.restaurant_id = v_restaurant_id;

    insert into public.order_items (
      order_id,
      restaurant_id,
      menu_item_id,
      item_name_snapshot,
      unit_price_snapshot,
      quantity,
      line_total,
      special_instructions
    ) values (
      v_order_id,
      v_restaurant_id,
      v_menu_item_id,
      v_item_name,
      v_unit_price,
      v_quantity,
      round(v_unit_price * v_quantity, 2),
      v_item_instructions
    );
  end loop;

  return query
  select
    v_order_id,
    v_order_number,
    'NEW'::public.order_status,
    v_total,
    v_created_at,
    false;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, text, text) from public;
grant execute on function public.create_order(text, text, jsonb, text, text)
  to anon, authenticated;
