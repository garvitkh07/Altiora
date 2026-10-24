-- Lock down direct public/catalog and service-point access.
--
-- Public menu access remains available through get_public_menu(slug, token),
-- which validates the restaurant/table pair inside a security-definer RPC.
-- Ordinary authenticated callers retain only the service-point metadata needed
-- by the staff dashboard; qr_token and all direct table DML are removed.

-- Anonymous callers must use the token-validated public RPC instead of direct
-- table reads that can enumerate active catalog data.
drop policy if exists restaurants_public_read on public.restaurants;
drop policy if exists categories_public_read on public.categories;
drop policy if exists menu_items_public_read on public.menu_items;
drop policy if exists restaurant_tables_public_metadata_read on public.restaurant_tables;

revoke select on public.restaurants, public.categories, public.menu_items
  from anon, public;

revoke all privileges on public.restaurant_tables
  from anon, authenticated, public;
revoke all privileges (
  id,
  restaurant_id,
  label,
  qr_token,
  is_active,
  created_at,
  updated_at
)
on public.restaurant_tables
from anon, authenticated, public;

-- The dashboard only needs safe service-point metadata for tenant-scoped table
-- labels. The QR secret is intentionally not granted to authenticated callers.
grant select (id, restaurant_id, label, is_active)
  on public.restaurant_tables
  to authenticated;

drop policy if exists restaurant_tables_member_manage on public.restaurant_tables;
drop policy if exists restaurant_tables_member_metadata_read on public.restaurant_tables;

create policy restaurant_tables_member_metadata_read
on public.restaurant_tables for select
to authenticated
using (public.is_restaurant_member(restaurant_id));
