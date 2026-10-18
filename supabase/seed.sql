-- Safe local/demo data for Shreenath Palace.
-- No auth users, passwords, API keys, or production QR tokens are seeded.

insert into public.restaurants (
  id,
  name,
  slug,
  description,
  logo_url,
  address,
  phone,
  currency,
  is_active
) values (
  '10000000-0000-4000-8000-000000000001',
  'Shreenath Palace',
  'shreenath-palace',
  'Royal Indian dining with a modern table-side experience.',
  null,
  '12 Palace Road, Udaipur',
  '+91 98765 43210',
  'INR',
  true
)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  logo_url = excluded.logo_url,
  address = excluded.address,
  phone = excluded.phone,
  currency = excluded.currency,
  is_active = excluded.is_active;

insert into public.categories (
  id,
  restaurant_id,
  name,
  description,
  sort_order,
  is_active
) values (
  '10000000-0000-4000-8000-000000000101',
  '10000000-0000-4000-8000-000000000001',
  'House Favourites',
  'Signature dishes from the palace kitchen.',
  1,
  true
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into public.menu_items (
  id,
  restaurant_id,
  category_id,
  name,
  description,
  price,
  original_price,
  is_veg,
  is_available,
  sort_order
) values
(
  '10000000-0000-4000-8000-000000000201',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  'Royal Paneer Tikka',
  'Charred paneer, saffron yogurt, and palace spices.',
  320.00,
  360.00,
  true,
  true,
  1
),
(
  '10000000-0000-4000-8000-000000000202',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000101',
  'Dal Shreenath',
  'Slow-cooked black lentils finished with cultured butter.',
  280.00,
  null,
  true,
  true,
  2
)
on conflict (id) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  original_price = excluded.original_price,
  is_veg = excluded.is_veg,
  is_available = excluded.is_available,
  sort_order = excluded.sort_order;

insert into public.restaurant_tables (
  id,
  restaurant_id,
  label,
  qr_token,
  is_active
) values (
  '10000000-0000-4000-8000-000000000301',
  '10000000-0000-4000-8000-000000000001',
  'Demo 1',
  'demo-shreenath-palace-table-1',
  true
)
on conflict (id) do update set
  label = excluded.label,
  qr_token = excluded.qr_token,
  is_active = excluded.is_active;
