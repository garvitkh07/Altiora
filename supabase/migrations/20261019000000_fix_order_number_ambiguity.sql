CREATE OR REPLACE FUNCTION public.create_order(
  p_restaurant_slug text,
  p_table_token text,
  p_items jsonb,
  p_special_instructions text DEFAULT NULL
)
RETURNS TABLE (
  order_id uuid,
  order_number bigint,
  status public.order_status,
  total_amount numeric(12, 2),
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_menu_item_id uuid;
  v_item_name text;
  v_unit_price numeric(10, 2);
  v_quantity integer;
  v_item_instructions text;
  v_restaurant_id uuid;
  v_table_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_created_at timestamptz;
  v_total numeric(12, 2) := 0;
  v_seen_item_ids uuid[] := '{}'::uuid[];
  v_order_instructions text := NULLIF(BTRIM(p_special_instructions), '');
BEGIN
  IF p_restaurant_slug IS NULL
    OR BTRIM(p_restaurant_slug) = ''
    OR p_table_token IS NULL
    OR BTRIM(p_table_token) = '' THEN
    RAISE EXCEPTION 'A restaurant slug and table token are required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_items IS NULL
    OR jsonb_typeof(p_items) <> 'array'
    OR jsonb_array_length(p_items) < 1 THEN
    RAISE EXCEPTION 'At least one item is required'
      USING ERRCODE = 'P0001';
  END IF;

  IF jsonb_array_length(p_items) > 50 THEN
    RAISE EXCEPTION 'An order cannot contain more than 50 items'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_order_instructions IS NOT NULL
    AND char_length(v_order_instructions) > 500 THEN
    RAISE EXCEPTION 'Special instructions cannot exceed 500 characters'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT r.id, rt.id
    INTO v_restaurant_id, v_table_id
  FROM public.restaurants AS r
  JOIN public.restaurant_tables AS rt
    ON rt.restaurant_id = r.id
  WHERE r.slug = BTRIM(p_restaurant_slug)
    AND r.is_active
    AND rt.qr_token = BTRIM(p_table_token)
    AND rt.is_active
  FOR UPDATE OF r, rt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The restaurant or table is not available'
      USING ERRCODE = 'P0001';
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    IF jsonb_typeof(v_item) <> 'object'
      OR NOT (v_item ? 'menu_item_id')
      OR NOT (v_item ? 'quantity')
      OR jsonb_typeof(v_item -> 'menu_item_id') <> 'string'
      OR jsonb_typeof(v_item -> 'quantity') <> 'number'
      OR (v_item ->> 'quantity') !~ '^[0-9]+$'
      OR (
        v_item ? 'special_instructions'
        AND jsonb_typeof(v_item -> 'special_instructions')
          NOT IN ('string', 'null')
      )
      OR (
        SELECT COUNT(*)
        FROM jsonb_object_keys(v_item) AS keys(key)
        WHERE key NOT IN (
          'menu_item_id',
          'quantity',
          'special_instructions'
        )
      ) > 0 THEN
      RAISE EXCEPTION 'Each item needs a menu_item_id and quantity'
        USING ERRCODE = 'P0001';
    END IF;

    BEGIN
      v_menu_item_id := (v_item ->> 'menu_item_id')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'A valid menu item is required'
          USING ERRCODE = 'P0001';
    END;

    BEGIN
      v_quantity := (v_item ->> 'quantity')::integer;
    EXCEPTION
      WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RAISE EXCEPTION 'Quantity must be an integer between 1 and 99'
          USING ERRCODE = 'P0001';
    END;

    IF v_quantity < 1 OR v_quantity > 99 THEN
      RAISE EXCEPTION 'Quantity must be an integer between 1 and 99'
        USING ERRCODE = 'P0001';
    END IF;

    v_item_instructions :=
      NULLIF(BTRIM(v_item ->> 'special_instructions'), '');

    IF v_item_instructions IS NOT NULL
      AND char_length(v_item_instructions) > 500 THEN
      RAISE EXCEPTION 'Special instructions cannot exceed 500 characters'
        USING ERRCODE = 'P0001';
    END IF;

    IF v_menu_item_id = ANY(v_seen_item_ids) THEN
      RAISE EXCEPTION 'Each menu item may appear only once'
        USING ERRCODE = 'P0001';
    END IF;

    v_seen_item_ids := array_append(v_seen_item_ids, v_menu_item_id);

    SELECT mi.name, mi.price
      INTO v_item_name, v_unit_price
    FROM public.menu_items AS mi
    JOIN public.categories AS c
      ON c.id = mi.category_id
     AND c.restaurant_id = mi.restaurant_id
    WHERE mi.id = v_menu_item_id
      AND mi.restaurant_id = v_restaurant_id
      AND mi.is_available
      AND c.is_active
    FOR UPDATE OF mi;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A menu item is not available'
        USING ERRCODE = 'P0001';
    END IF;

    v_total := v_total + ROUND(v_unit_price * v_quantity, 2);
  END LOOP;
  INSERT INTO public.orders AS inserted_order (
  restaurant_id,
  table_id,
  created_by,
  status,
  subtotal_amount,
  tax_amount,
  total_amount,
  special_instructions
)
VALUES (
  v_restaurant_id,
  v_table_id,
  auth.uid(),
  'NEW',
  v_total,
  0,
  v_total,
  v_order_instructions
)
RETURNING
  inserted_order.id,
  inserted_order.order_number,
  inserted_order.created_at
INTO
  v_order_id,
  v_order_number,
  v_created_at;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_items)
  LOOP
    v_menu_item_id := (v_item ->> 'menu_item_id')::uuid;
    v_quantity := (v_item ->> 'quantity')::integer;

    v_item_instructions :=
      NULLIF(BTRIM(v_item ->> 'special_instructions'), '');

    SELECT mi.name, mi.price
      INTO v_item_name, v_unit_price
    FROM public.menu_items AS mi
    WHERE mi.id = v_menu_item_id
      AND mi.restaurant_id = v_restaurant_id;

    INSERT INTO public.order_items (
      order_id,
      restaurant_id,
      menu_item_id,
      item_name_snapshot,
      unit_price_snapshot,
      quantity,
      line_total,
      special_instructions
    )
    VALUES (
      v_order_id,
      v_restaurant_id,
      v_menu_item_id,
      v_item_name,
      v_unit_price,
      v_quantity,
      ROUND(v_unit_price * v_quantity, 2),
      v_item_instructions
    );
  END LOOP;

  RETURN QUERY
  SELECT
    v_order_id,
    v_order_number,
    'NEW'::public.order_status,
    v_total,
    v_created_at;
END;
$$;

REVOKE ALL
ON FUNCTION public.create_order(text, text, jsonb, text)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.create_order(text, text, jsonb, text)
TO anon, authenticated;