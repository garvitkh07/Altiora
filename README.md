# Altiora MVP

Altiora is a warm, responsive restaurant ordering experience built with the
Next.js App Router. This repository contains the MVP UI and backend/data layer:

- guest menu at `/r/[restaurantSlug]/table/[tableToken]`
- cart quantity controls and POST order submission
- confirmation state after an order is accepted
- protected-looking kitchen and reception views at `/kitchen` and `/reception`
- browser-safe typed API access in `lib/data.ts`
- Supabase clients, RLS-backed data access, and transactional order creation
- public menu and authenticated kitchen API routes

The application never reads a Supabase service-role key. Browser and server
clients use the public anon key so Supabase RLS remains the authorization
boundary.

## Requirements

- Node.js `22.14.0` (the version is pinned in `.nvmrc`)
- npm 11+

## Setup

```bash
npm ci
cp .env.example .env.local
```

On Windows PowerShell, use `Copy-Item .env.example .env.local` for the second command. Set the two public Supabase values in `.env.local`; no service-role key is required.

Apply the schema and RLS policies to a Supabase project from the repository root:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
supabase test db
```

The database assertions live in `supabase/tests/rls.sql` and
`supabase/tests/order_rpc.sql`; the latter exercises database-priced totals,
tenant-bound item rejection, malformed quantities, atomic rollback, and status
transitions inside a rollback-only transaction.

The migration under `supabase/migrations/` creates `restaurants`,
`restaurant_members`, `categories`, `menu_items`, `restaurant_tables`, `orders`,
and `order_items`. Public menu reads require active restaurant/category/item/
table records and use the `get_public_menu` RPC, which never returns
`qr_token`. The `create_order` RPC validates the same constraints and uses
database prices for an atomic order plus order-item insert. Order statuses are
`NEW`, `PREPARING`, `READY`, `SERVED`, and `CANCELLED`.

### Provision staff access

Create the first staff user in **Supabase Dashboard → Authentication → Users**.
Then add that user's UUID to the seeded restaurant from the SQL editor (use the
actual UUID from the Auth dashboard; do not put it in source control):

```sql
insert into public.restaurant_members (restaurant_id, user_id, role)
values (
  '10000000-0000-4000-8000-000000000001',
  '<auth-user-uuid>',
  'OWNER'
);
```

The staff dashboard API reads the signed-in Supabase session and RLS limits it
to restaurants where that user is a member. Customers do not need an account;
their QR order uses the narrowly scoped public RPCs instead.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`. A guest QR/deep link has this form:

```text
http://localhost:3000/r/<restaurant-slug>/table/<table-token>
```

The staff views are available at:

```text
http://localhost:3000/staff/login
http://localhost:3000/kitchen
http://localhost:3000/reception
```

Staff sign in at `/staff/login` with their Supabase Auth email and password.
The page stores the session through Supabase SSR cookies; it does not use
custom token storage. Authentication alone is not sufficient: the signed-in
user must also have an `OWNER`, `MANAGER`, or `STAFF` row in
`restaurant_members` for an active restaurant. The dashboards provide a
Sign out action that clears the Supabase session and returns to the login page.

Authenticated staff can update an order through `PATCH
/api/orders/:orderId/status` with `{ "status": "preparing" }` (or `new`,
`ready`, `completed`, or `cancelled`). The API maps these display values to the
database enum, permits only the status column to change, and rejects status
regressions after an order is served or cancelled.

## Frontend API contract

`lib/data.ts` is the shared browser-safe data helper. It expects the backend to provide:

### `GET /api/restaurants/:restaurantSlug/table/:tableToken`

Returns a `RestaurantMenu` object, optionally wrapped in `{ "data": ... }`:

```json
{
  "restaurant": {
    "id": "restaurant-id",
    "name": "The Example House",
    "slug": "example-house",
    "description": "Slow food, bright rooms",
    "logoUrl": null,
    "address": "1 Example Street",
    "phone": "+1 555 0100"
  },
  "table": { "id": "table-id", "label": "12" },
  "currency": "USD",
  "categories": [{ "id": "mains", "name": "Mains" }],
  "items": [
    {
      "id": "dish-id",
      "name": "Dish name",
      "description": "A short description",
      "categoryId": "mains",
      "categoryName": "Mains",
      "price": 18.5,
      "isAvailable": true,
      "isVegetarian": false
    }
  ]
}
```

### `POST /api/orders`

The browser submits:

```json
{
  "restaurant_slug": "example-house",
  "table_token": "table-token",
  "items": [
    {
      "menu_item_id": "00000000-0000-4000-8000-000000000003",
      "quantity": 2,
      "special_instructions": "No onions"
    }
  ],
  "special_instructions": "Window seat"
}
```

The route returns `order_id`, `order_number`, `status`, `total_amount`, and
the database-generated `created_at` timestamp, alongside a compatibility
`order` object. The existing browser helper accepts the documented snake_case
payload; the API also safely accepts the prior camelCase QR-link payload.

### `GET /api/kitchen/dashboard`

Returns `KitchenDashboardData` (or `{ "data": ... }`). The API owns staff authentication and authorization; a `401`/`403` response is presented as a graceful protected-dashboard error state.

## Checks

The single offline-friendly project check is:

```bash
npm test
```

It runs the strict TypeScript check, the configured Next.js lint check, and the
Vitest unit suite. `make test` delegates to the same command when GNU Make is
available. Build the production bundle with:

```bash
npm run build
```

The individual checks are also available as `npm run lint` and `npm run
type-check`. Database policy assertions run separately with `supabase test db`
after the local Supabase stack or a linked project is available.

## Docker

Build and run the standalone Next.js image:

```bash
docker build -t altiora-mvp .
docker run --rm --env-file .env.local -p 3000:3000 altiora-mvp
```

The `Dockerfile` pins the Node image, installs from `package-lock.json`, builds the standalone output, and runs as a non-root user.

## Deploy

For a Node-compatible host, install with `npm ci`, build with `npm run build`, and start with `npm run start`. The same-origin API routes must be deployed behind the same origin as the frontend, or the backend must provide an equivalent reverse proxy. For Vercel, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the project settings. This MVP deliberately does not read a service-role key; if a future administrative integration adds one, keep it server-only and out of `NEXT_PUBLIC_*` variables. For container deployment, use the Docker commands above and supply only deployment-safe environment values from `.env.example`.
