# Altiora Product Requirements

**Phase:** Product Definition and Requirements Engineering
**Document status:** Implementation-ready specification; documentation only
**Repository:** `C:\Users\Garvit Khandelwal\Desktop\HMS`
**Important:** This document describes the intended product and the verified
local repository state. It does not claim that planned capabilities exist, that
the current local database contract is deployed, or that the product is
production-ready.

## 0. Evidence and classification rules

The current working tree contains uncommitted application, test, migration,
README, and configuration changes. Those changes were preserved. The evidence
for this document was read from the local repository only; `.env.local` and
credentials were not read.

Every significant capability uses one of these labels:

| Label | Meaning |
| --- | --- |
| **BUILT / PREVIOUSLY TESTED** | The capability exists in the local application and the user previously exercised the relevant flow, or the repository contains a directly corresponding tested flow. This does not prove current remote-database compatibility. |
| **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** | Local code, SQL, or tests express the capability, but the relevant migration/RLS/RPC behavior has not run successfully against PostgreSQL in this workspace. |
| **PARTIALLY IMPLEMENTED** | Some UI, API, schema, or helper behavior exists, but the complete product workflow or authorization boundary is missing. |
| **PLANNED** | Required by the product vision but not represented by the current repository implementation. |
| **DECISION REQUIRED** | The requirement cannot be implemented safely until a business or architecture policy is selected. |
| **BLOCKED BY VERIFICATION** | The intended behavior is specified locally but cannot be accepted until a named runtime, database, security, or operational check passes. |

### Evidence boundaries

- The local Vitest/TypeScript/lint suite was previously run successfully; the
  current repository test suite contains 48 passing tests across six test
  files at the time of this definition.
- `supabase/tests/rls.sql` and `supabase/tests/order_rpc.sql` are written
  database assertions, not evidence that PostgreSQL executed them.
- The local `create_order` contract now expects five arguments, including an
  idempotency key. The linked/remote database has not been verified against
  the two local idempotency migrations.
- No requirement in this document authorizes a migration, schema change,
  deployment, remote Supabase action, or source-code implementation.

## 1. Product vision

Altiora is a multi-tenant hospitality operations SaaS. A restaurant, hotel, or
approved hospitality business should be able to run customer ordering and
service operations in its own tenant without seeing another business's private
data.

The first reliable product is a restaurant QR-ordering workflow connected to a
kitchen queue and a reception/service view. The longer-term product may add:

- owner and manager operations dashboards;
- QR/service-point provisioning and lifecycle management;
- inventory, ingredients, recipes, and procurement;
- business analytics and audit reporting;
- hotel room-service workflows;
- room occupancy and availability, if the hotel scope is approved;
- multi-business and multi-branch SaaS administration; and
- later onboarding, billing, and subscription modules.

The product must distinguish:

1. what the current MVP can demonstrate;
2. what is implemented in local code but not database-verified;
3. what is an approved future requirement; and
4. what still requires a product or security decision.

## 2. Product scope and boundaries

### 2.1 Minimum reliable restaurant product

The minimum reliable restaurant product consists of:

1. a business-owned menu and active service points;
2. a QR link that resolves only to an active restaurant and active service
   point;
3. a public menu and cart with server-side validation;
4. atomic order creation using database prices and availability;
5. safe handling of duplicate submissions and uncertain network outcomes;
6. a kitchen queue with controlled forward status transitions;
7. a front-of-house/reception view of the same tenant's orders;
8. staff authentication plus membership-based tenant access; and
9. auditable cancellation, handoff, and staff actions once those workflows are
   approved.

### 2.2 Explicitly out of the current implementation

The repository does not currently demonstrate:

- a platform administrator console;
- an owner/manager dashboard beyond the existing staff views;
- QR creation, printable sheet generation, token rotation, or QR revocation;
- separate receptionist, kitchen, server, delivery, inventory, or purchasing
  roles;
- payment, refunds, room charges, or card authorization;
- public customer order tracking or customer accounts;
- a public cancellation endpoint;
- staff handoff confirmation or proof of guest/table presence;
- inventory balances, recipes, stock movements, suppliers, or wastage;
- recipe-based consumption accounting;
- hotel occupancy, PMS, housekeeping, check-in, or check-out integration;
- branch hierarchy, tenant switching, billing, subscriptions, or plan limits;
- a general audit-event store; or
- real-time updates. The dashboard currently uses one 30-second polling loop.

These are requirements or decisions below, not claims of existing behavior.

## 3. Current repository baseline

### 3.1 Verified route inventory

The current App Router pages are:

| Route | Current behavior | Status |
| --- | --- | --- |
| `/` | Marketing/entry page linking staff users to the kitchen dashboard and explaining that guest menus open from QR links. | **BUILT / PREVIOUSLY TESTED** |
| `/staff/login` | Supabase email/password sign-in with an allowlisted internal return path. | **BUILT / PREVIOUSLY TESTED** |
| `/staff/forgot-password` | Password-reset request form using Supabase Auth. | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** |
| `/staff/reset-password` | Recovery-link inspection, in-memory token use, password update, and session termination. | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** |
| `/kitchen` | Protected `KitchenDashboard` in kitchen mode. | **BUILT / PREVIOUSLY TESTED** |
| `/reception` | Protected `KitchenDashboard` in reception mode; the current component and data are otherwise shared with kitchen. | **PARTIALLY IMPLEMENTED** |
| `/r/[restaurantSlug]/table/[tableToken]` | Public customer menu and cart for a table QR link. | **BUILT / PREVIOUSLY TESTED; CURRENT RPC COMPATIBILITY BLOCKED** |

The current API route inventory is:

| Route | Current contract | Status |
| --- | --- | --- |
| `GET /api/restaurants/:restaurantSlug/table/:tableToken` | Calls `get_public_menu`; returns restaurant, table label/id, categories, and available menu items without returning `qr_token`. | **BUILT / PREVIOUSLY TESTED; CURRENT RPC COMPATIBILITY BLOCKED** |
| `POST /api/orders` | Validates a strict snake-case request, accepts a safe legacy camel-case body, requires `Idempotency-Key`, calls the five-argument `create_order`, maps new/replay/conflict responses to `201/200/409`, and hides unexpected database details. | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** |
| `GET /api/kitchen/dashboard` | Authenticates staff membership, selects today's tenant orders, maps database statuses to dashboard statuses, and returns order items and summary counts. | **BUILT / PREVIOUSLY TESTED; CURRENT RLS/DB COMPATIBILITY BLOCKED** |
| `PATCH /api/orders/:orderId/status` | Authenticates the user, checks local transition rules, updates only `orders.status`, and returns the updated order. | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** |

### 3.2 Verified current database model

The local SQL migrations define these entities and relationships:

```text
restaurants
  ├── restaurant_members (restaurant_id, user_id, role)
  ├── categories (restaurant_id)
  │     └── menu_items (restaurant_id, category_id)
  ├── restaurant_tables (restaurant_id, label, qr_token, is_active)
  └── orders (restaurant_id, table_id, created_by, status, totals, idempotency metadata)
          └── order_items (order_id, restaurant_id, menu_item_id, snapshots)
```

Verified current fields include:

- `restaurants`: name, slug, description, branding/contact fields, currency,
  active flag, timestamps;
- `restaurant_members`: restaurant, Auth user, and enum role
  `OWNER | MANAGER | STAFF`;
- `categories`: restaurant ownership, name, ordering, active flag;
- `menu_items`: restaurant/category ownership, name, price, availability,
  dietary/allergen/display fields;
- `restaurant_tables`: restaurant ownership, human label, secret `qr_token`,
  active flag;
- `orders`: restaurant/table ownership, optional `created_by`, enum status,
  subtotal/tax/total, instructions, timestamps, and the new nullable
  `idempotency_key` plus `request_fingerprint`; and
- `order_items`: tenant/order/menu ownership plus name, price, quantity, line
  total, and instruction snapshots.

The current SQL defines `order_status` as:

```text
NEW -> PREPARING -> READY -> SERVED
  \        \          \
   -> CANCELLED   -> CANCELLED
```

The database trigger and local helper allow same-status updates and the
forward/cancellation transitions shown above. `SERVED` and `CANCELLED` are
terminal in the current contract.

### 3.3 Current implementation classification

| Capability | Classification | Evidence and limitation |
| --- | --- | --- |
| Public menu loading and table-label display | **BUILT / PREVIOUSLY TESTED** | `app/api/restaurants/[restaurantSlug]/table/[tableToken]/route.ts`, `components/customer-menu.tsx`, and the user's earlier menu test. The current local RPC still needs database compatibility verification. |
| Cart quantity and instruction validation | **BUILT / PREVIOUSLY TESTED** | `components/order-cart.tsx`, `lib/orders/validation.ts`, and unit tests. Browser-level accessibility and boundary testing remain future quality work. |
| Earlier order creation flow | **BUILT / PREVIOUSLY TESTED** | The user previously tested order creation against the earlier database/API contract. |
| Five-argument idempotent order creation | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** | `app/api/orders/route.ts`, `20261020000000_order_idempotency.sql`, and `20261020010000_order_idempotency_hardening.sql`. The remote or local PostgreSQL contract has not executed successfully here. |
| Client uncertain-order recovery | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** | `lib/orders/idempotency.ts` and tests preserve the same key/payload, isolate table bindings, and block conflicts. End-to-end acceptance depends on the five-argument RPC. |
| Kitchen NEW/PREPARING/READY/SERVED display | **BUILT / PREVIOUSLY TESTED** | `components/kitchen-dashboard.tsx` and `GET /api/kitchen/dashboard`; the user previously saw kitchen/reception status propagation. |
| Status transition hardening | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** | Local helper, API, trigger, and SQL tests exist. PostgreSQL trigger/RLS execution is unverified. |
| Reception operations | **PARTIALLY IMPLEMENTED** | `/reception` reuses the kitchen dashboard and exposes the same order/status data; it has no distinct handoff, transfer, verification, or cancellation workflow. |
| Staff authentication and membership gate | **BUILT / PREVIOUSLY TESTED** | Supabase Auth plus `getStaffAccess`, page guards, middleware, and the user's earlier staff-login test. Multi-membership selection and role-specific authorization are unresolved. |
| Password recovery | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** | Local forms/helpers and unit tests exist; the callback is hard-coded to local development at `http://localhost:3000/staff/reset-password`. |
| Current RLS and grants | **IMPLEMENTED LOCALLY / DATABASE-UNVERIFIED** | RLS, policies, security-definer RPCs, grants, and static assertions exist in migrations/tests. They have not been run against PostgreSQL in this workspace. |
| Separate operational roles | **PLANNED** | The only current enum is `OWNER`, `MANAGER`, `STAFF`. Do not treat `STAFF` as proof of separate kitchen/reception/inventory permissions. |
| QR administration | **PLANNED** | No current staff UI or route creates, prints, rotates, revokes, or audits QR labels. |
| Inventory and recipe accounting | **PLANNED** | No current inventory tables, recipes, purchase movements, wastage, or reconciliation workflow. |
| Hotel room service/PMS | **DECISION REQUIRED** | The repository is restaurant/table oriented. Room identity, occupancy, authorization, charges, and PMS scope are not selected. |
| SaaS onboarding, branch hierarchy, billing | **PLANNED / DECISION REQUIRED** | The current schema has restaurant-level ownership but no platform-tenant or branch model. Billing is explicitly later scope. |

## 4. User types and permission boundaries

### 4.1 General authorization rule

Hiding a button is never an authorization control. Every protected action must
be enforced at the server boundary and, where the database is directly
reachable through Supabase, by RLS and column/function grants. A route must
resolve the signed-in user, tenant membership, role, active business, and
resource ownership before it reads or mutates private data.

For high-risk mutations, use a transaction or a security-definer RPC with a
fixed `search_path`, explicit input validation, tenant checks, and an audit
event. The UI may improve usability but cannot grant permission.

### 4.2 Platform administrator — future role

**Responsibilities**

- Provision and support tenants, branches, and platform-level configuration.
- Manage platform health, abuse response, retention, and support escalation.
- Perform controlled break-glass support only under an approved policy.

**May read**

- Tenant directory and operational metadata needed for support.
- Aggregated platform health and audit events.
- Business data only when a support case and approved break-glass reason exist.

**May perform**

- Suspend or restore a tenant at the platform boundary.
- Assign platform administrators and resolve ownership/support cases.
- Export or delete data only under documented retention/legal procedures.

**Must not perform**

- Read tenant customer/order content by default.
- Change business menu, prices, stock, or staff roles silently.
- Bypass tenant RLS through an ordinary browser session.

**Approval and audit**

- Break-glass access requires a reason, ticket/reference, time limit, affected
  tenant, and immutable audit event.
- Destructive or export actions require a second approver unless an emergency
  policy explicitly says otherwise.

**Current status:** **PLANNED**. No platform-admin identity or tenant registry
exists in the current repository.

### 4.3 Business owner

**Responsibilities**

- Own the business profile, service points, menu, staff membership, and
  operational policies.
- Approve high-risk changes such as QR rotation, price changes, stock
  corrections, refunds, and staff removal.

**May read**

- All operational data inside the owned tenant(s), subject to retention and
  privacy policy.
- Menu, order, service-point, inventory, supplier, and audit data for owned
  businesses.

**May perform**

- Manage business configuration and approved staff roles.
- Create/disable/rotate QR service points.
- Approve cancellations after preparation, stock adjustments, wastage, and
  refunds where those modules exist.

**Must not perform**

- Access another tenant without an explicit platform support grant.
- Alter immutable order snapshots, historical recipe versions, or audit events.
- Use a customer-facing QR token as proof of staff authorization.

**Current mapping:** `OWNER` exists in `public.member_role`, and owner policies
manage memberships. A complete owner dashboard and granular approval workflow
do not exist.

### 4.4 Manager

**Responsibilities**

- Run a business shift and manage day-to-day menu, service-point, staff, and
  operational exceptions within delegated scope.

**May read**

- Tenant orders, menu, service points, operational metrics, and approved
  inventory views.

**May perform**

- Update menu availability and service-point state.
- Manage non-owner staff memberships if the owner policy allows.
- Coordinate preparation, handoff, and permitted cancellations.

**Must not perform**

- Transfer ownership, remove the final owner, export another tenant's data, or
  approve their own sensitive correction where separation of duties is needed.

**Approval and audit**

- Manager actions that change menu availability, service points, staff access,
  or operational exceptions are recorded with actor, tenant, target, reason,
  and timestamp.
- Owner approval is required for ownership transfer, final-owner removal,
  high-value corrections, and any break-glass exception.

**Current mapping:** `MANAGER` exists. Current SQL policies and `getStaffAccess`
do not yet express every intended manager restriction or approval step.

### 4.5 Reception/front-desk staff

**Responsibilities**

- Monitor incoming orders, verify the service point/guest context, coordinate
  service handoff, and record exceptions.

**May read**

- Orders, items, quantities, special instructions, service-point labels,
  status, timestamps, and handoff state for the assigned tenant/branch.

**May perform**

- Acknowledge or assign a ready order, record handoff verification, initiate a
  permitted table/room transfer, and request cancellation/escalation.

**Must not perform**

- Change menu prices, rotate QR secrets, edit immutable order totals, approve
  inventory corrections, or view other tenants.

**Approval and audit**

- Transfers, failed handoffs, post-preparation cancellations, and guest/room
  verification failures require a reason and staff identity.

**Current status:** **PLANNED / PARTIALLY IMPLEMENTED**. The current `STAFF`
  role is not a receptionist role, and `/reception` shares the kitchen UI.

### 4.6 Kitchen staff

**Responsibilities**

- Accept new orders, prepare items, mark them ready, and report preparation
  failures or shortages.

**May read**

- Order items, quantities, item instructions/allergen notes approved for the
  kitchen, service-point label, order time, and status.

**May perform**

- Move an order through the kitchen-approved state transitions and record
  preparation exceptions.

**Must not perform**

- Change price, quantity, table/room identity, customer charge, staff role,
  QR token, or stock history without a separate approved permission.

**Approval and audit**

- Cancelling after preparation begins, discarding prepared food, and declaring
  an item unavailable require a reason and audit event.

**Current status:** **PLANNED / PARTIALLY IMPLEMENTED**. Current API/RLS
  behavior authenticates membership but does not distinguish kitchen role from
  other staff.

### 4.7 Server/delivery staff

**Responsibilities**

- Collect ready orders, verify the destination, deliver/serve, and record the
  result.

**May read**

- Assigned ready orders, destination label, service instructions, and the
  minimum customer/room verification data required for handoff.

**May perform**

- Claim/assign a handoff, confirm served/delivered, record unable-to-locate,
  failed delivery, return, or waste events.

**Must not perform**

- Change menu/price, change order contents, approve refunds, or access
  unrelated tenant data.

**Approval and audit**

- Pickup, delivery, transfer, failed handoff, unable-to-locate, return, and
  waste events require the server/delivery actor, timestamp, destination,
  outcome, and reason where applicable.
- A post-preparation cancellation, refund, or charge exception requires the
  approved manager/owner workflow.

**Current status:** **PLANNED**.

### 4.8 Inventory/purchasing staff

**Responsibilities**

- Maintain ingredient catalogue, receive purchases, record wastage, count stock,
  reconcile variance, and manage suppliers.

**May read**

- Ingredient, supplier, purchase, recipe-version, stock-movement, order-linked
  consumption, wastage, and reconciliation data for the assigned tenant.

**May perform**

- Record receipts and routine wastage within policy; propose adjustments and
  low-stock actions.

**Must not perform**

- Rewrite historical recipes or consumption, erase stock movements, or approve
  their own unusual adjustment when separation of duties is required.

**Approval and audit**

- Routine receiving and wastage follow the tenant policy and record supplier or
  source reference, quantity, unit, actor, and timestamp.
- Unusual, high-value, or corrective movements require a separate approver and
  preserve the original count/movement evidence.

**Current status:** **PLANNED**.

### 4.9 Customer/guest

**Responsibilities**

- Scan a QR, review the public menu, submit an order, and communicate
  instructions or cancellation requests through the approved channel.

**May read**

- Public data for the resolved active restaurant/service point and available
  menu items.

**May perform**

- Create a public order with validated quantities and instructions.
- Retry the same uncertain request using the same idempotency key.

**Must not perform**

- Read staff dashboards, other orders, QR secrets, inventory, memberships, or
  private tenant data.
- Change a saved order to another table/room silently.
- Reuse an idempotency key for different order details.

**Approval and audit**

- No staff approval is required for an ordinary public order submission, but
  the system records the order id, service point, request correlation, and
  idempotency result without exposing secrets.
- Customer cancellation, refund, room charge, and handoff actions follow the
  business policy and are not implied by the public QR flow.

**Current status:** **BUILT / PREVIOUSLY TESTED** for public menu/cart/order
  submission, subject to current database compatibility verification.

## 5. Functional requirements

The requirement identifiers below are stable references for future tickets,
tests, and release gates.

### 5.1 Tenant and identity requirements

- **FR-TEN-001:** Every private record must have an unambiguous tenant owner.
  A future branch/property may belong to a tenant, but the final hierarchy
  must be selected before branch features are built.
- **FR-TEN-002:** Every staff request must resolve the Auth user, active
  membership, role, tenant, and branch/resource scope server-side.
- **FR-TEN-003:** RLS must deny cross-tenant reads and writes even when a user
  crafts a direct API/Supabase request.
- **FR-TEN-004:** Membership revocation must take effect for new requests and
  must not rely on a stale UI session. Existing sessions must be rechecked at
  privileged boundaries.
- **FR-TEN-005:** Tenant deletion, export, retention, and recovery must be
  policy-driven and auditable. Billing is not part of this phase.

### 5.2 Authentication and staff access

- **FR-AUTH-001:** Staff sign-in must use the configured Auth provider and must
  not expose passwords or recovery tokens in custom storage, logs, or URLs.
- **FR-AUTH-002:** Authentication alone must not grant dashboard access; an
  active membership is required.
- **FR-AUTH-003:** Login return paths must remain restricted to approved internal
  staff paths; external and protocol-relative paths must be rejected.
- **FR-AUTH-004:** Password reset requests should avoid account enumeration and
  recovery errors should be user-safe.
- **FR-AUTH-005:** Role-specific actions must be enforced by server/database
  authorization, not just by hiding controls.

### 5.3 Service-point and QR management

- **FR-QR-001:** A service point has a tenant-owned human-readable `label`
  (for example `Table 03`, `A`, `Room 1001`) and a separate opaque QR token.
- **FR-QR-002:** Labels need only be unique within their approved tenant/branch
  scope; they must not be assumed numeric, sequential, or table-only.
- **FR-QR-003:** QR token creation must use cryptographically strong random
  material and must never expose stored secrets in public menu responses.
- **FR-QR-004:** A service-point record must be activatable/deactivatable
  without deleting historical orders.
- **FR-QR-005:** Replacing or rotating a token must invalidate the previous
  token immediately according to the selected grace-period policy.
- **FR-QR-006:** A revoked/inactive token must not resolve a public ordering
  session, and a stale cart must not silently submit against a new token.
- **FR-QR-007:** Owners/managers must be able to preview, download, and print
  QR labels/sheets once the QR-admin module is approved.
- **FR-QR-008:** QR creation, replacement, rotation, deactivation, reactivation,
  and print/export events require actor, tenant, service point, timestamp,
  reason where applicable, and old/new token references represented safely
  (never raw secrets in ordinary audit text).
- **FR-QR-009:** A QR scan proves possession of a link, not physical presence.
  Room-service and high-value ordering require additional controls.

### 5.4 Menu and public ordering

- **FR-ORD-001:** Public menu resolution must validate restaurant slug, token,
  restaurant active state, service-point active state, and menu visibility in a
  single server/database boundary.
- **FR-ORD-002:** Invalid, revoked, inactive, cross-tenant, or malformed links
  must return a safe unavailable response and must not reveal whether another
  tenant or table exists.
- **FR-ORD-003:** The server/database is the source of truth for current price,
  availability, restaurant ownership, table ownership, and totals.
- **FR-ORD-004:** An order must contain at least one item, no duplicate menu
  item, no fractional quantity, and quantities within the approved limit. The
  current local contract is 1–99 per item and at most 50 distinct items.
- **FR-ORD-005:** Empty carts, unavailable items, invalid instructions, and
  invalid identity fields must fail before an order is created.
- **FR-ORD-006:** A successful order returns a stable order identifier,
  order number, status, database-generated timestamp, and server-calculated
  total while preserving the current response aliases until an approved API
  version change.
- **FR-ORD-007:** The public customer does not need an account for the current
  restaurant MVP, but the system must not infer physical presence from a QR
  link.

### 5.5 Idempotency and uncertain outcomes

- **FR-IDEMP-001:** Every new submission must have a unique opaque
  `Idempotency-Key` within the applicable system scope.
- **FR-IDEMP-002:** Same key plus same normalized payload must return the
  original order/result without inserting another order or item.
- **FR-IDEMP-003:** Same key plus different restaurant, service point, item,
  quantity, or instructions must return a conflict and must not create a second
  order.
- **FR-IDEMP-004:** Timeouts, network failures, HTTP 408/429, and 5xx responses
  are uncertain. The client preserves the original key and exact payload for an
  explicit retry.
- **FR-IDEMP-005:** Definite non-conflict validation failures may clear the
  saved attempt and return an editable cart.
- **FR-IDEMP-006:** A customer reload during an uncertain outcome must not
  generate a new key automatically.
- **FR-IDEMP-007:** A saved attempt must be bound to the original restaurant and
  service point. Table changes, token rotation, or route changes must not adopt
  the saved payload silently.
- **FR-IDEMP-008:** Legacy persisted attempts that cannot prove request identity
  and table binding remain preserved until explicit user abandonment; they are
  not automatically submitted.

### 5.6 Kitchen, reception, and service operations

- **FR-OPS-001:** Kitchen staff see only tenant-scoped orders and item details
  needed for preparation.
- **FR-OPS-002:** Status transitions must be forward-only or explicitly
  cancellation transitions; terminal orders must not regress.
- **FR-OPS-003:** Every status mutation must identify actor, previous status,
  next status, timestamp, and reason when required by policy.
- **FR-OPS-004:** The dashboard must show service-point label, quantities,
  special instructions, order time, status, and total according to role and
  privacy policy.
- **FR-OPS-005:** Reception must distinguish ready-to-serve, handed-off,
  delivered/served, failed handoff, and cancellation once those states are
  approved. The current `SERVED` state is not sufficient evidence of a verified
  handoff.
- **FR-OPS-006:** The current dashboard may continue its single 30-second
  refresh loop. A future realtime channel must replace or coordinate with that
  loop rather than add a duplicate polling loop.
- **FR-OPS-007:** Repeated or concurrent status actions must be idempotent or
  fail safely without regressing state or producing duplicate audit events.

### 5.7 Cancellation and exception handling

- **FR-CANCEL-001:** Cancellation before preparation begins is distinct from
  cancellation after preparation begins.
- **FR-CANCEL-002:** A cancellation after preparation begins requires a reason,
  actor, approval policy, and explicit food/waste/charge outcome.
- **FR-CANCEL-003:** An unable-to-locate guest or failed delivery is a service
  exception, not automatically a customer cancellation.
- **FR-CANCEL-004:** Inventory restoration must depend on whether ingredients
  were reserved, consumed, prepared, returned safely, or wasted; there is no
  universal automatic reversal.

### 5.8 Inventory and recipe accounting

- **FR-INV-001:** Stock changes occur through immutable or append-only stock
  movements, not through an unreasoned editable balance.
- **FR-INV-002:** An ingredient has a standard unit, purchase unit, and approved
  conversion rules. Ambiguous conversions require configuration or rejection.
- **FR-INV-003:** Receipts record supplier, quantity, unit cost, receiving date,
  actor, and optional batch/expiry metadata where approved.
- **FR-INV-004:** A versioned recipe/BOM records ingredient quantity per menu
  item/portion, effective dates, and approver. Historical versions remain
  immutable.
- **FR-INV-005:** Order-linked expected consumption is calculated from the
  recipe version effective at the selected event time. A three-portion order of
  a 180 g recipe consumes an expected 540 g, not proof of physical usage.
- **FR-INV-006:** Consumption events must be idempotent and linked to the order
  and order item so retries cannot deduct twice.
- **FR-INV-007:** Wastage, spoilage, valid returns, corrections, and manual
  adjustments are separate movement types with reasons and approvals.
- **FR-INV-008:** Reconciliation shows calculated stock, physical count,
  expected consumption, recorded wastage, and unexplained variance.
- **FR-INV-009:** Variance is an operational signal requiring investigation; it
  must not be presented as automatic proof that a worker stole stock.

### 5.9 Hotel and room-service expansion

- **FR-HOTEL-001:** Room service is not treated as dine-in table service until
  occupancy, guest authorization, charge/payment, and failed-verification
  policies are approved.
- **FR-HOTEL-002:** A room QR alone must not authorize an expensive room charge.
- **FR-HOTEL-003:** A future room workflow must resolve property, room, current
  occupancy/guest session, order authorization, and service handoff.
- **FR-HOTEL-004:** PMS, check-in/out, housekeeping, room assignment, and room
  availability are optional modules until explicitly included in the approved
  hotel scope.

### 5.10 Reporting

- **FR-REPORT-001:** Each owner metric has an exact formula, time zone, tenant
  scope, status inclusion rule, refund/cancellation rule, and source tables.
- **FR-REPORT-002:** Reports must distinguish gross order value, net revenue,
  refunded/cancelled value, expected recipe consumption, recorded movements,
  physical count, and unexplained variance.
- **FR-REPORT-003:** Historical reports use immutable order/item/recipe snapshots
  and must not change when the current menu price or recipe changes.

### 5.11 Audit and retention

- **FR-AUDIT-001:** Security, membership, QR, menu-price, status, cancellation,
  handoff, inventory, procurement, and export events must be auditable.
- **FR-AUDIT-002:** Audit records are append-only to ordinary business users and
  contain actor, tenant, action, entity, before/after summary, reason, request
  correlation id, and timestamp without secrets.
- **FR-AUDIT-003:** Retention, export, deletion, and recovery policies must be
  selected before promising compliance or long-term analytics.

## 6. Non-functional requirements

### NFR-SEC — Security and privacy

- Tenant isolation must be enforced in PostgreSQL RLS and in every server/API
  query. A client-supplied tenant, restaurant, table, branch, or order id is
  never trusted without an ownership check.
- Public RPCs must return only the minimum public data. QR secrets,
  idempotency keys, request fingerprints, staff membership records, and
  private operational data must not be returned to anonymous callers.
- Security-definer functions must fix `search_path`, validate every input, and
  have narrowly scoped execute grants.
- Staff authorization must be rechecked at the action boundary. A previously
  rendered dashboard is not proof that the session or membership is still valid.
- Secrets and passwords must not appear in URLs, browser storage, logs, audit
  events, test fixtures, or documentation.
- Rate limits, abuse detection, and safe error responses are required before
  exposing public order creation to hostile traffic.

### NFR-REL — Reliability and consistency

- Order creation must be atomic: either the order and all order items commit,
  or neither commits.
- Repeated requests with the same key and normalized payload must be safe under
  retries and same-key concurrency.
- Order totals and item prices must be calculated from database state and
  snapshotted at creation.
- Status updates must not regress terminal orders or create contradictory
  handoff states.
- A lost HTTP response after a committed order must be recoverable without
  creating a duplicate.
- Local and remote RPC signatures must be verified before a release is called
  compatible.

### NFR-PERF — Performance

- Public menu responses should be bounded by an approved maximum number of
  categories/items and should not expose unrelated tenant records.
- Dashboard reads should be tenant-filtered and paginated or bounded; the
  current local route limits today's orders to 100.
- The current single dashboard refresh loop is 30 seconds. Any realtime design
  must define reconnect, stale-data, and fallback behavior before replacing it.

### NFR-OBS — Operability

- Every order/request should have a correlation id suitable for support, without
  exposing secrets.
- Errors presented to customers and staff must be safe and actionable; raw
  database/provider messages remain server-side diagnostics only.
- Health checks must distinguish application availability, Auth availability,
  database availability, and migration/RPC compatibility.
- Operational dashboards must display the data freshness timestamp and stale
  state when refresh fails.

### NFR-ACC — Accessibility and usability

- Public and staff flows must support keyboard navigation, visible focus,
  labels, live-region updates, and non-color-only status meaning.
- Loading, empty, unavailable, unauthorized, stale, conflict, and uncertain
  states must be explicit.
- A customer must never lose an order silently because a double-click or reload
  occurred.

### NFR-TEST — Verification

Every release candidate must have evidence for the relevant layer:

1. unit tests for validation, normalization, state transitions, and idempotency;
2. API tests for status codes, redaction, and compatibility aliases;
3. PostgreSQL tests for RPC behavior, atomic rollback, triggers, and grants;
4. RLS tests for same-tenant and cross-tenant reads/writes;
5. concurrent-request tests for same-key replay and conflict;
6. browser end-to-end tests for QR, cart, reload, uncertain outcome, and
   staff workflows; and
7. manual operational checks for QR replacement, handoff, cancellation, and
   recovery.

The current local suite covers the first two categories and helper behavior.
PostgreSQL, RLS, concurrency, and browser end-to-end evidence are not yet
complete.

## 7. Abuse and exception requirements

The following cases are mandatory design inputs, not optional edge cases.

### 7.1 Scenario A — Customer moves from Table 3 to Table 4

**Preventive controls**

1. Bind a saved cart/order attempt to the original restaurant and service point
   using a public table id plus a token digest, or a token digest when no public
   id is available.
2. Scope stored attempts by tenant and service-point binding rather than one
   restaurant-wide mutable slot.
3. On route change, clear the in-memory active attempt for the old route and
   load only a matching attempt for the new route.
4. Do not replace the old `table_token`, generate a new idempotency key, or
   submit the old payload against Table 4 automatically.
5. Require the customer to return to the original link, explicitly abandon the
   old attempt, or start a separate new order.

**Detection and audit**

- Record route/table mismatch and token-rotation recovery events without
  storing the raw token.
- The server must validate table ownership again at order creation.

**Staff recovery**

- Staff may help the customer identify the original table or cancel the old
  attempt according to the selected policy.
- If an order already committed to Table 3, reception handles transfer as an
  explicit operational action; the customer cannot rewrite `orders.table_id`.

**Acceptance criteria**

- A Table 3 saved attempt never appears as an editable/submittable Table 4
  attempt without explicit user action.
- A rotated Table 3 token cannot restore or submit an old attempt silently.
- A direct API request with Table 4's token and Table 3's idempotency key either
  replays the exact original order only when the fingerprint matches or returns
  conflict; it never creates a second order.

### 7.2 Scenario B — Order submitted at Table 3, table later empty

**Preventive controls**

- Treat the QR/table association as an order destination, not as proof that a
  guest is still present.
- Require a service-point label and order reference on the operational queue.
- Introduce explicit handoff states before promising “served”.

**Detection and audit**

- Record who claimed the order, when it became ready, where the handoff was
  attempted, and the result: served, unable to locate, returned, cancelled, or
  wasted.
- A staff note must not overwrite the original order destination.

**Staff recovery**

1. Server/reception checks Table 3 and nearby approved contact channels.
2. If the guest is found elsewhere, use an authorized transfer workflow with a
   reason and new destination; preserve the original destination in history.
3. If the guest cannot be located, mark an unable-to-locate exception and follow
   the approved hold/return/waste/charge policy.

**Acceptance criteria**

- The order is never silently reassigned because the original table is empty.
- A handoff cannot be marked served without the required verification for the
  selected service model.
- An unable-to-locate event is distinguishable from customer cancellation and
  appears in reporting/audit.

### 7.3 Scenario C — Photographed hotel room QR used from home

**Preventive controls**

- Do not treat a room QR as authorization. Resolve the property and room, then
  require a current occupancy/guest session or an approved room-service
  authentication method.
- Require step-up verification or staff confirmation for high-value items,
  unusual quantities, alcohol/regulated items, or room charges.
- Select a payment model before implementing room charge: card payment,
  in-room PIN, guest app/session, front-desk approval, or a combination.
- Apply rate limits, anomaly detection, maximum order values, and suspicious
  device/session controls where proportionate.

**Detection and audit**

- Log failed room/guest verification, high-value challenges, overrides,
  repeated QR use, and charge attempts with tenant/property, room, session,
  actor, timestamp, and reason. Do not log raw secrets.

**Staff recovery**

- A failed verification holds the order in an unapproved state; it must not be
  sent to the kitchen or charged to the room.
- Reception contacts the authorized guest or confirms in person before release.
- Abuse investigations can suspend the room QR/session without deleting prior
  records.

**Acceptance criteria**

- A photographed room QR alone cannot create an expensive room charge.
- An order cannot enter kitchen preparation until required room/guest/payment
  authorization succeeds.
- Expired occupancy or a checked-out room cannot authorize a new order.
- Every failed verification and override is visible to authorized staff.

### 7.4 Scenario D — Prepared order cancelled or guest cannot be located

The system must distinguish at least these states/events:

| Situation | Required meaning | Inventory/financial treatment |
| --- | --- | --- |
| Cancelled before preparation | The kitchen has not started work. | Release any reservation; no physical-consumption movement. Refund/charge treatment follows payment policy. |
| Cancelled after preparation starts | Work and possibly ingredients have been consumed. | Do not automatically restore all ingredients. Record cancellation reason and actual/estimated waste or return. |
| Food already prepared | Food exists physically and may be served, held, returned, or wasted. | Record a preparation/finished-food exception and disposition. |
| Food safely returned | Only valid, policy-approved returns may be reusable. | Record returned quantity and quality control; never assume all returned food is reusable. |
| Food wasted/spoiled | Food cannot be served or reused. | Record wastage movement with reason, quantity, actor, and approval if required. |
| Guest cannot be located | Service failed; this is not automatically a customer cancellation. | Record unable-to-locate, hold/return/waste/charge outcome separately. |

**Acceptance criteria**

- The UI and API cannot collapse all cases into one generic `CANCELLED` event.
- The selected policy determines whether cancellation is allowed from each
  preparation state.
- Inventory movements are linked to the event and are idempotent; no duplicate
  deduction or blanket restoration occurs.

## 8. Reporting definitions

The following definitions are the minimum acceptable starting point. Metrics
marked “not currently available” must not be presented as existing dashboard
features.

| Metric | Definition | Include/exclude rules | Current data status |
| --- | --- | --- | --- |
| Order count | Count of distinct `orders.id` in tenant/time scope. | Default operational count includes `NEW`, `PREPARING`, `READY`, `SERVED`; cancelled count is shown separately. | Available from `orders`; current dashboard uses a bounded daily read but does not expose a general report. |
| Gross order value | Sum of immutable `orders.total_amount` for selected order states. | Must state whether cancelled/refunded orders are included; recommended default excludes cancelled and refunded. | Available from `orders`; current dashboard sums visible non-cancelled statuses. |
| Cancelled orders | Count of orders whose final status is `CANCELLED`, plus cancellation reason/event counts when available. | Do not infer cancellation from missing handoff. | Status exists; reason/history does not. |
| Average order value | Gross order value divided by qualifying distinct orders. | Exclude cancelled/refunded orders by default; define zero-order result as null, not zero. | Derivable from current orders; not currently exposed as a metric. |
| Popular dishes | Sum of `order_items.quantity` grouped by menu item snapshot/id. | Select a status window; recommended include only accepted/prepared/served orders, exclude cancelled before preparation. | Item snapshots exist; final business rule not selected. |
| Preparation time | Timestamp from preparation start to ready. | Requires event timestamps for both transitions; current `updated_at` is not sufficient if statuses change repeatedly. | Not currently available. |
| Recorded purchases | Sum of received stock movements by ingredient and period. | Only valid received purchase movements count. | Not available; inventory is planned. |
| Expected recipe usage | Sum of effective recipe quantity × qualifying order quantity. | Must use historical recipe version and selected deduction event. | Not available; inventory/recipes planned. |
| Recorded wastage | Sum of approved wastage movements. | Must remain separate from expected consumption and returns. | Not available. |
| Physical stock variance | Physical count − calculated book stock, with unexplained variance flagged. | Variance is an investigation signal, not proof of theft. | Not available. |

The business timezone, tax/service-charge treatment, payment/refund treatment,
and qualifying order statuses must be selected before owner analytics are
implemented.

## 9. Prioritisation and release gates

### P0 — Existing reliability and security blockers

Scope:

- verify the local five-argument RPC against a disposable PostgreSQL/Supabase
  environment;
- run RLS, grants, trigger, rollback, and same-key concurrency tests;
- confirm the remote database is not being assumed compatible;
- close role-specific authorization gaps for status changes;
- decide whether public base-table menu policies expose more data than intended;
- define audit requirements for status, cancellation, and QR actions; and
- preserve safe table binding/idempotency behavior across reload and QR rotation.

**Exit conditions:** database/RLS/concurrency evidence is recorded; cross-tenant
tests pass; role permissions are explicit; no unresolved critical security
finding remains; and current API response compatibility is documented.

### P1 — Minimum reliable restaurant-ordering product

Scope:

- verified public menu and atomic order creation;
- customer order confirmation and uncertain-result recovery;
- explicit customer cancellation/request-to-cancel path if required;
- kitchen queue with status transition audit;
- reception-ready/service handoff workflow;
- tenant-scoped staff membership and role enforcement; and
- operational error/stale-data handling.

**Dependencies:** P0 database and authorization verification.
**Exit conditions:** browser E2E covers QR-to-handoff, reload, double-click,
network failure, invalid item, conflict, table switch, and cancellation paths.

### P2 — QR administration and improved operations

Scope:

- service-point CRUD with arbitrary labels;
- token generation, rotation, revocation, and safe print/export;
- QR preview/sheet generation;
- distinct reception, kitchen, server, and manager permissions;
- explicit assignment/transfer/handoff states; and
- operational audit and exception reporting.

**Dependencies:** P0 tenant/auth/audit decisions and P1 order lifecycle.
**Exit conditions:** old tokens fail immediately or within the selected grace
period; historical orders retain their original destination; and all QR/admin
actions are auditable.

### P3 — Inventory and purchasing

Scope:

- ingredient catalogue and unit conversions;
- supplier and receiving records;
- immutable/versioned recipes;
- idempotent order-linked expected consumption;
- wastage, returns, adjustments, approvals, and reconciliation; and
- low-stock and variance reporting.

**Dependencies:** P1 order/cancellation semantics and decisions on deduction
timing, recipe versions, and approvals.
**Exit conditions:** the paneer example can be reproduced from movements and
recipe versions, duplicate order retries do not double-deduct, and variance is
clearly labelled as expected-versus-physical rather than proof of theft.

### P4 — Hotel and room-service expansion

Scope:

- property/room/service-point model;
- occupancy and guest/session verification;
- high-value authorization/payment/room-charge policy;
- room-service handoff and unable-to-locate workflow; and
- optional PMS/housekeeping integrations only if approved.

**Dependencies:** P0 security/audit, P1 handoff, and explicit hotel-scope
decisions.
**Exit conditions:** a photographed room QR cannot authorize an unverified
charge; checked-out/empty rooms cannot receive unauthorized orders; and all
overrides are auditable.

### P5 — Analytics, onboarding, billing, and later growth

Scope:

- owner dashboards and exact metrics;
- tenant/branch onboarding;
- exports, retention, and recovery tooling;
- platform administration;
- subscriptions, paid plans, and billing; and
- later integrations.

**Dependencies:** stable tenant hierarchy, immutable audit/data models, and
approved commercial policy. Billing is deliberately not part of this task.

## 10. Acceptance criteria catalogue

The following measurable criteria are release-gate examples. They should be
translated into the test layers listed in Section 6.

### Public menu and QR

- Given an active restaurant, active service point, and valid token, the public
  route returns only the intended tenant's active menu and table label.
- Given an invalid, inactive, revoked, or cross-tenant token, the route returns
  a safe unavailable response and no private record details.
- The response never contains `qr_token`.
- A label such as `A`, `Table 03`, or `Room 1001` is accepted without numeric or
  sequential assumptions.

### Order submission

- Empty, duplicate, fractional, out-of-range, unavailable, and cross-tenant
  item requests are rejected before an order row is committed.
- The persisted total equals database price × quantity plus approved charges;
  client-reported prices are ignored.
- Same key/same normalized payload returns the same order id and does not add
  rows, including after the menu price or availability changes.
- Same key/different payload returns `409` and does not add rows.
- A lost response can be retried with the same key and produces one order.
- A double-click produces at most one order.

### Table switching and recovery

- A saved Table 3 attempt cannot be submitted from Table 4 without explicit
  abandonment/new-order action.
- A legacy attempt without verifiable binding is preserved and blocked until
  explicit abandonment.
- No raw QR/table token appears in persisted recovery records or recovery UI.

### Staff and tenant security

- An unauthenticated user cannot load or mutate staff dashboards.
- An authenticated user without active membership cannot access a tenant.
- A member of Tenant A cannot read, update, or infer Tenant B's orders, menu
  management, QR data, or inventory.
- Role-specific status/menu/QR/inventory actions are denied server-side and in
  RLS when the role lacks permission.
- Revoking membership prevents the next protected request from succeeding.

### Kitchen and handoff

- Only approved forward transitions and cancellation transitions are accepted;
  terminal orders cannot regress.
- Concurrent status updates never produce a forbidden final state.
- A ready order cannot be marked served without the selected handoff evidence.
- Unable-to-locate, returned, wasted, cancelled-before-preparation, and
  cancelled-after-preparation outcomes remain distinct.

### Inventory

- Receiving 10 kg (10,000 g) of paneer and consuming three 180 g portions
  produces 540 g expected consumption and 9,460 g calculated remaining stock,
  before other movements.
- Repeating the same order-linked consumption event does not deduct twice.
- A recipe change affects future consumption only; historical order usage keeps
  its effective recipe version.
- A physical variance is reported with movement evidence and is not labelled as
  proof of theft.

## 11. Repository evidence index

The specification was based on these local files:

- `app/page.tsx`
- `app/staff/login/page.tsx`
- `app/staff/forgot-password/page.tsx`
- `app/staff/reset-password/page.tsx`
- `app/kitchen/page.tsx`
- `app/reception/page.tsx`
- `app/r/[restaurantSlug]/table/[tableToken]/page.tsx`
- `app/api/restaurants/[restaurantSlug]/table/[tableToken]/route.ts`
- `app/api/orders/route.ts`
- `app/api/orders/[orderId]/status/route.ts`
- `app/api/kitchen/dashboard/route.ts`
- `components/customer-menu.tsx`
- `components/order-cart.tsx`
- `components/kitchen-dashboard.tsx`
- `lib/data.ts`
- `lib/orders/validation.ts`
- `lib/orders/status.ts`
- `lib/orders/idempotency.ts`
- `lib/staff/auth.ts`
- `lib/staff/redirect.ts`
- `lib/staff/forgot-password.ts`
- `lib/staff/reset-password.ts`
- `middleware.ts`
- `lib/supabase/server.ts`
- `lib/supabase/client.ts`
- `supabase/migrations/20261018000000_altiora_mvp.sql`
- `supabase/migrations/20261019000000_fix_order_number_ambiguity.sql`
- `supabase/migrations/20261020000000_order_idempotency.sql`
- `supabase/migrations/20261020010000_order_idempotency_hardening.sql`
- `supabase/tests/rls.sql`
- `supabase/tests/order_rpc.sql`
- `supabase/seed.sql`
- `app/api/orders/route.test.ts`
- `lib/orders/idempotency.test.ts`
- `lib/orders/validation.test.ts`
- `lib/staff/redirect.test.ts`
- `lib/staff/forgot-password.test.ts`
- `lib/staff/reset-password.test.ts`
- `package.json`
- `vitest.config.ts`
- `tsconfig.json`

`README.md` was inspected for the documented contract but was not modified.
`.env.local` was not read.
