# Altiora Open Decisions

**Phase:** Product Definition and Requirements Engineering
**Document status:** Decision register; no decision is silently treated as
approved implementation policy
**Scope:** Restaurant QR ordering first, with hotel, inventory, SaaS, analytics,
and billing decisions recorded for later phases.

## 0. How to use this register

Each decision includes:

- **Why it matters** — the ambiguity or risk;
- **Options** — viable policy choices;
- **Recommendation** — only where the repository/product evidence supports one;
- **Risks** — consequences of each direction; and
- **Dependencies** — requirements, schema, security, or operations affected.

Decision statuses:

| Status | Meaning |
| --- | --- |
| **OPEN** | No approved product decision exists. |
| **RECOMMENDATION** | A default is suggested for review, but it is not implementation authority. |
| **BLOCKS P0** | The ambiguity creates a current security, data-integrity, or release-verification blocker. |
| **DEFERRED** | Explicitly postponed to a later phase; no implementation should infer it. |

## 1. Priority decision summary

| ID | Decision | Status | Primary phase |
| --- | --- | --- | --- |
| D-001 | Restaurant-only versus full hotel/PMS scope | **OPEN / BLOCKS P1–P4 boundary** | P1/P4 |
| D-002 | Dine-in QR versus room-service verification | **OPEN / BLOCKS HOTEL SECURITY** | P1/P4 |
| D-003 | High-value order authentication and payment policy | **OPEN / BLOCKS HOTEL SECURITY** | P1/P4 |
| D-004 | Service handoff verification | **OPEN / BLOCKS HANDOFF** | P1 |
| D-005 | Kitchen cancellation rules | **OPEN / BLOCKS CANCELLATION** | P1 |
| D-006 | Inventory deduction timing | **OPEN / BLOCKS INVENTORY** | P3 |
| D-007 | Recipe versioning and effective dates | **OPEN / BLOCKS INVENTORY** | P3 |
| D-008 | Inventory adjustments and approvals | **OPEN / BLOCKS INVENTORY** | P3 |
| D-009 | Multi-branch and tenant hierarchy | **OPEN / BLOCKS SaaS MODEL** | P0/P5 |
| D-010 | Subscription/billing scope | **DEFERRED / OPEN COMMERCIAL POLICY** | P5 |
| D-011 | Operational role granularity | **OPEN / BLOCKS AUTHORIZATION** | P0/P1 |
| D-012 | Public cancellation, refund, and charge policy | **OPEN / BLOCKS CUSTOMER SUPPORT** | P1 |
| D-013 | QR rotation grace period and printed-label lifecycle | **OPEN / BLOCKS QR ADMIN** | P2 |
| D-014 | Reporting timezone and revenue definitions | **OPEN / BLOCKS ANALYTICS** | P5 |
| D-015 | Audit retention and support access | **OPEN / BLOCKS OPERATIONS** | P0/P5 |
| D-016 | Realtime updates versus current polling | **RECOMMENDATION** | P1/P2 |

## 2. D-001 — Restaurant-only versus full hotel/PMS scope

**Status:** OPEN; blocks a clean P1/P4 boundary.

### Why it matters

The current repository is restaurant/table oriented. Hotel room service adds
occupancy, room identity, guest authorization, charges, check-in/out, and
possibly PMS/housekeeping integration. Treating a room label as merely another
table label would create a security and financial authorization gap.

### Options

1. **Restaurant-only first:** deliver a reliable restaurant/table product and
   explicitly reject or defer room-service routes.
2. **Restaurant plus standalone room service:** support rooms without PMS,
   using a separate approved guest/session/charge model.
3. **Full hotel/PMS scope:** include property, room occupancy, check-in/out,
   room assignment, housekeeping, and PMS integration in the next product
   boundary.

### Recommendation

Choose option 1 for P0/P1. Revisit option 2 only after room authorization and
payment decisions are approved. Do not promise option 3 without a named PMS
integration owner and data contract.

### Risks

- Option 1 limits near-term hotel sales but reduces security scope.
- Option 2 can create a fragile duplicate occupancy system.
- Option 3 increases integration, privacy, support, and operational complexity.

### Dependencies

Tenant hierarchy, service-point model, guest identity, payment/room-charge
policy, retention, support, and audit design.

## 3. D-002 — Dine-in QR versus room-service verification

**Status:** OPEN; blocks hotel security.

### Why it matters

A static QR proves possession of a URL, not that a person is at the table or is
the authorized occupant of a room. A room QR photographed from home could be
used to submit expensive orders.

### Options

1. **Dine-in only:** QR opens a public menu and creates an order tied to a table;
   staff verifies handoff.
2. **Guest session:** require a current guest/session token from a guest app,
   authenticated portal, in-room PIN, or short-lived pairing code.
3. **Manual verification:** accept room orders only after reception confirms the
   room/guest, with optional low-value exceptions.
4. **Payment-first:** require an approved payment method before kitchen release.

### Recommendation

Use option 1 for the restaurant MVP. For hotel work, combine a short-lived
guest/session proof with staff handoff verification; do not use a static QR as
the sole authorization factor.

### Risks

- Guest sessions add friction and privacy/data-retention requirements.
- Manual verification increases labor and can slow service.
- Payment-first depends on a processor and refund/chargeback policy.

### Dependencies

Occupancy source, guest identity, payment/room-charge decision, high-value
threshold, rate limiting, abuse detection, and audit events.

## 4. D-003 — High-value order authentication and payment policy

**Status:** OPEN; blocks hotel/high-value security.

### Why it matters

The current public order flow has no payment or high-value authorization. A
restaurant may accept low-risk dine-in orders, while a hotel room charge or
unusually expensive order requires stronger proof.

### Options

1. No threshold; staff verifies every handoff.
2. Amount/quantity thresholds trigger guest re-authentication or a one-time
   code.
3. Card authorization before kitchen release.
4. Room charge only after current occupancy plus guest confirmation/PIN.
5. Hybrid: low-value order is queued; high-value order is held pending payment
   or staff approval.

### Recommendation

Adopt option 5 for hotel expansion: define a configurable threshold, hold the
   order before kitchen release, and require a payment or room-authorization
   result. For restaurant-only P1, keep payment out of scope but document that
   the QR is not proof of identity.

### Risks

- Thresholds can be gamed through multiple small orders.
- Payment introduces PCI, refund, failure, and reconciliation requirements.
- Staff approval can be inconsistent without a clear audit policy.

### Dependencies

Order release state, payment provider, room-charge ledger, refund policy,
fraud/rate limits, and service handoff.

## 5. D-004 — Service handoff verification

**Status:** OPEN; blocks a reliable `SERVED` meaning.

### Why it matters

The current `SERVED` state is a status update, not proof that the correct guest
received the order. Table 3 may be empty, or the guest may have moved.

### Options

1. Table/room label confirmation by staff.
2. Guest states order number at handoff.
3. One-time handoff code shown to guest and staff.
4. Staff marks “served” without extra evidence.
5. Delivery assignment plus recipient confirmation/signature.

### Recommendation

For restaurant dine-in, require staff confirmation of order number plus service
point. For room service/high-value orders, require an additional one-time code,
guest/session proof, or reception confirmation. Preserve “unable to locate” as a
distinct outcome.

### Risks

- More verification slows handoff.
- Order numbers alone may be guessable.
- A code stored in screenshots can still be shared.

### Dependencies

Handoff event model, server/delivery role, transfer policy, cancellation and
unable-to-locate workflow, and reporting.

## 6. D-005 — Kitchen cancellation rules

**Status:** OPEN; blocks cancellation and inventory semantics.

### Why it matters

The current state machine permits cancellation from `NEW`, `PREPARING`, and
`READY`, but there is no reason, approval, food disposition, or inventory event.
Cancellation before preparation is not equivalent to cancelling prepared food.

### Options

1. Customer may cancel only before `PREPARING`.
2. Staff may cancel during `PREPARING` with a reason.
3. Manager approval is required after preparation starts.
4. `READY` cannot be cancelled; use refund/return/complaint instead.
5. Allow cancellation from all pre-served states with a reason and disposition
   workflow.

### Recommendation

Use option 1 for the simple restaurant MVP and option 3 for post-preparation
exceptions. Do not reverse inventory automatically; record the actual
preparation/waste/return outcome.

### Risks

- Restrictive cancellation can create poor guest experience.
- Flexible cancellation increases waste and abuse.
- Without event history, support cannot distinguish cancellation from failure.

### Dependencies

Handoff, inventory deduction timing, waste/return movement types, payment/refund
policy, staff roles, and audit history.

## 7. D-006 — Inventory deduction timing

**Status:** OPEN; blocks P3.

### Why it matters

The same order can be accepted, prepared, cancelled, served, returned, or
wasted. Deducting stock at the wrong point causes false availability, duplicate
deductions, or incorrect restoration.

### Options

1. Deduct expected consumption at order creation.
2. Deduct at kitchen acceptance/`PREPARING`.
3. Deduct at `READY`/production completion.
4. Reserve at order creation, convert reservation to consumption at preparation,
   and record waste/returns separately.
5. Deduct only after `SERVED`.

### Recommendation

Use option 4 if the business needs stock availability forecasting. Otherwise use
option 2 for a simpler restaurant implementation. In either case, keep
reservation, expected consumption, waste, and return movements distinct and
idempotent. Never claim recipe calculation proves physical usage.

### Risks

- Early deduction can overstate usage for cancellations.
- Late deduction can oversell scarce ingredients.
- Reservations add movement and reconciliation complexity.

### Dependencies

Cancellation rules, recipe version selection, order status/event history,
concurrent order handling, stock alerts, and adjustment approvals.

## 8. D-007 — Recipe versioning and effective dates

**Status:** OPEN; blocks historical inventory accuracy.

### Why it matters

A menu item may change ingredients or portion size. Recomputing historical
consumption using the current recipe would rewrite history and invalidate
variance reports.

### Options

1. One mutable recipe per menu item.
2. Append-only recipe versions with effective timestamps.
3. Version per menu item and branch, with owner approval.
4. Version per menu item, branch, and production period/batch.

### Recommendation

Use option 3: immutable recipe versions scoped to the approved branch and menu
item, with effective-from/effective-to timestamps and an approver. Store the
selected version on each consumption event.

### Risks

- Versioning increases authoring and migration complexity.
- Effective-time mistakes can create boundary discrepancies.
- Branch-specific recipes can diverge operationally.

### Dependencies

Tenant/branch hierarchy, menu-item ownership, inventory unit conversions,
order-linked consumption timing, audit, and analytics.

## 9. D-008 — Inventory adjustments and approvals

**Status:** OPEN; blocks stock-integrity controls.

### Why it matters

Physical counts and corrections are unavoidable, but a freely editable stock
number destroys the ability to explain variance.

### Options

1. Any inventory staff member may adjust stock.
2. Small adjustments are self-approved; large/unusual adjustments require a
   manager.
3. All adjustments require manager/owner approval.
4. Counts create proposed movements; approval posts the movement.

### Recommendation

Use option 2 plus option 4: record every count and proposal, auto-approve only
within a configurable low-risk threshold, and require a second person for
unusual/high-value corrections. No prior movement may be edited or deleted by
ordinary users.

### Risks

- Approval friction may delay stock correction.
- Thresholds need tenant-specific calibration.
- Emergency corrections require a documented break-glass path.

### Dependencies

Role granularity, audit retention, physical-count workflow, variance reporting,
and platform support access.

## 10. D-009 — Multi-branch and tenant hierarchy

**Status:** OPEN; blocks SaaS architecture.

### Why it matters

The current schema uses `restaurant_id` directly on most records. The product
vision includes multiple businesses and branches, but it is not selected whether
one restaurant row is a tenant, a property, or a branch.

### Options

1. `restaurant` is the tenant; branches are future child records.
2. `business` is the tenant; restaurants/properties are branches.
3. `organization` is the tenant; properties and service points are nested.
4. Keep one restaurant per account and add platform aggregation later.

### Recommendation

Use option 2 or 3 for the long-term SaaS model, but do not choose between them
without an owner of the commercial/operational terminology. For P1, treat the
current `restaurant_id` as a single-business scope and do not claim branch
support.

### Risks

- Renaming the hierarchy later can require broad data migration and policy
  changes.
- A shared staff member across branches requires explicit selection and
  least-privilege rules.
- Cross-branch reporting can accidentally bypass tenant boundaries.

### Dependencies

Membership model, QR ownership, order/inventory ownership, platform admin,
reporting, retention, onboarding, and billing.

## 11. D-010 — Subscription and billing scope

**Status:** DEFERRED; later P5 module.

### Why it matters

Billing and subscriptions affect tenant lifecycle, limits, invoices, support,
data retention, and payment compliance. They are not needed to define the first
reliable restaurant ordering flow.

### Options

1. No billing until after product/market validation.
2. Manual invoicing outside Altiora.
3. Usage/seat-based SaaS billing.
4. Transaction-fee or order-volume pricing.
5. Plan-based feature and branch limits.

### Recommendation

Keep billing out of P0–P4 implementation. Record only the future boundary that
subscription state must not be used as an informal substitute for tenant/RLS
authorization.

### Risks

- Deferring billing delays commercial automation.
- Introducing it early distracts from order reliability and security.
- Plan limits can leak across tenants if authorization is coupled incorrectly.

### Dependencies

Tenant hierarchy, platform admin, usage metrics, retention, payment provider,
support, and legal/commercial policy.

## 12. D-011 — Operational role granularity

**Status:** OPEN; blocks P0 authorization.

### Why it matters

The current database enum contains only `OWNER`, `MANAGER`, and `STAFF`. The
product needs kitchen, reception, server/delivery, and inventory boundaries.
Treating all `STAFF` users as equivalent can grant excessive status or data
access.

### Options

1. Keep `STAFF` as one broad operational role.
2. Add fixed roles: `RECEPTION`, `KITCHEN`, `SERVER`, `INVENTORY`.
3. Use permissions/capabilities assigned to roles.
4. Use team/shift assignments in addition to base roles.

### Recommendation

Use fixed operational roles plus capability checks for high-risk actions. Keep
`OWNER` and `MANAGER` as management roles. Add team/branch scope only after the
tenant hierarchy is selected. Never rely on UI labels alone.

### Risks

- More roles increase membership/admin complexity.
- Capability systems can become difficult to audit if too granular.
- A broad staff role risks over-privilege and weak separation of duties.

### Dependencies

RLS policies, route authorization, audit events, handoff, inventory approvals,
membership UI, and migration strategy. The current local role/RLS behavior is
not sufficient evidence that this decision is implemented.

## 13. D-012 — Public cancellation, refund, and charge policy

**Status:** OPEN; blocks customer support semantics.

### Why it matters

The current public flow creates an order but has no public cancellation or
payment/refund workflow. A guest request to cancel must not be allowed to rewrite
an order after kitchen preparation or service.

### Options

1. No customer cancellation; contact reception.
2. Customer cancellation while status is `NEW` only.
3. Customer cancellation until `PREPARING`, with staff/manager exception after.
4. Cancellation request creates a queue item; staff approves or rejects.
5. Payment/refund is handled outside Altiora for the first release.

### Recommendation

For P1, use option 3 with a request-to-cancel record and no automatic refund
logic. Keep payment/refund external until a provider and financial policy are
approved. Do not change `SERVED` to `CANCELLED`.

### Risks

- No cancellation can frustrate guests.
- Broad customer cancellation can increase kitchen waste and abuse.
- Refund behavior is legally/financially sensitive.

### Dependencies

Kitchen cancellation rules, payment model, handoff, inventory movements,
support tooling, and audit.

## 14. D-013 — QR rotation grace period and printed-label lifecycle

**Status:** OPEN; blocks QR administration.

### Why it matters

Replacing a token improves security but printed labels may remain in circulation.
Allowing old tokens too long preserves abuse risk; invalidating immediately can
interrupt service.

### Options

1. Immediate invalidation on rotation.
2. Short grace period with old token marked “retiring.”
3. Revoke only on suspected compromise; otherwise keep static token.
4. Versioned QR labels with explicit replacement date.

### Recommendation

Use immediate invalidation by default, with an owner-approved short grace period
only for operational replacement. Show the replacement date on print sheets and
provide an explicit “old token no longer valid” check.

### Risks

- Immediate invalidation can strand customers with old labels.
- Grace periods extend the attack window.
- Token status changes need cache-control and audit clarity.

### Dependencies

Service-point model, public menu caching, session/idempotency recovery, printing,
audit, and support runbook.

## 15. D-014 — Reporting timezone and revenue definitions

**Status:** OPEN; blocks analytics.

### Why it matters

The current dashboard computes “today” from UTC midnight and sums visible
non-cancelled orders. A hospitality business normally expects its local business
timezone, and “revenue” may mean gross orders, net paid, or accounting revenue.

### Options

1. UTC for all reports.
2. Tenant-configured IANA timezone for business-day boundaries.
3. Branch/property timezone with tenant fallback.
4. Report gross order value only.
5. Report gross, discounts, tax/service fees, refunds, and net paid separately.

### Recommendation

Use a configured IANA timezone at the business/branch level and expose separate
gross, tax/fee, refund, and net-paid metrics. For current P1, label the existing
dashboard metric as an operational total rather than accounting revenue until
the definition is approved.

### Risks

- Timezone changes complicate historical reports.
- Payment reconciliation may not match order totals.
- Ambiguous labels create owner distrust.

### Dependencies

Tenant/branch hierarchy, payment/refund policy, order status history, recipe
effective times, and analytics storage.

## 16. D-015 — Audit retention and support access

**Status:** OPEN; blocks trustworthy operations and platform support.

### Why it matters

QR replacement, membership changes, status updates, cancellations, handoffs,
stock adjustments, and exports require investigation history. The current schema
has timestamps but no general audit-event store.

### Options

1. Keep application logs only.
2. Append-only tenant audit events with configurable retention.
3. Platform-wide immutable audit log with tenant-scoped visibility.
4. Dual model: tenant audit plus restricted platform security events.

### Recommendation

Use option 4. Tenant users see relevant business events; platform security and
break-glass events are restricted. Store reason, actor, tenant, entity,
before/after summary, correlation id, and timestamp without raw tokens or
passwords.

### Risks

- Audit data may contain personal information and require retention controls.
- Overly broad support access creates privacy risk.
- Append-only storage requires correction/redaction policy for legal requests.

### Dependencies

Platform admin, tenant hierarchy, privacy/retention policy, support tooling,
incident response, and inventory/handoff workflows.

## 17. D-016 — Realtime updates versus current polling

**Status:** RECOMMENDATION; not a current capability claim.

### Why it matters

The current dashboard refreshes every 30 seconds. Realtime can improve kitchen
latency but introduces subscriptions, reconnect handling, ordering, stale data,
and authorization complexity.

### Options

1. Keep 30-second polling and manual refresh.
2. Add realtime events while retaining polling fallback.
3. Replace polling with realtime only after operational proof.

### Recommendation

Keep the single 30-second loop for P1. Consider option 2 in P2 with a single
refresh/reconciliation path and explicit fallback. Do not add a duplicate polling
loop.

### Risks

- Realtime can deliver duplicate/out-of-order events.
- A broken subscription can make staff believe data is current.
- More connections increase operational cost.

### Dependencies

RLS authorization, event/audit model, dashboard reconciliation, offline/stale
states, and load testing.

## 18. Additional decisions to record before implementation

The following questions are not optional polish decisions because they affect
data integrity or user trust:

### D-017 — Tax, service charge, currency, and rounding

- **Why:** Current local totals use `tax_amount = 0` and currency comes from the
  restaurant. Hospitality pricing needs jurisdiction, inclusive/exclusive tax,
  service charges, and rounding rules.
- **Options:** no charges in P1; restaurant-configured tax; tax/service provider;
  line-level versus order-level rounding.
- **Recommendation:** keep P1 tax/service charges explicitly zero only if the UI
  says so; decide currency/rounding before payment or reporting.
- **Dependencies:** order totals, receipts, refunds, analytics, menu pricing.

### D-018 — Order transfer semantics

- **Why:** Guests may move tables or rooms after submission.
- **Options:** never transfer; reception can transfer with audit; manager-only
  transfer; create a linked replacement order.
- **Recommendation:** preserve original order destination and use an explicit
  authorized transfer event; never mutate from the customer browser.
- **Dependencies:** handoff, reporting, RLS, audit, room service.

### D-019 — Data retention and deletion

- **Why:** Orders, guest notes, staff audit, QR history, and inventory records
  have different operational/legal retention needs.
- **Options:** one tenant retention period; per-domain periods; immutable archive
  plus redacted customer data.
- **Recommendation:** decide by domain before exports/deletion are promised.
- **Dependencies:** platform admin, audit, privacy, reporting, backups/recovery.

### D-020 — Current multi-membership dashboard selection

- **Why:** `getStaffAccess()` currently resolves one active restaurant for a user;
  a future staff member may belong to several branches.
- **Options:** one default membership; explicit tenant switcher; branch-scoped
  URL and session; deny ambiguous access until selected.
- **Recommendation:** explicit tenant/branch selection before any multi-branch
  feature is released; never silently choose a different tenant for a mutation.
- **Dependencies:** D-009 hierarchy, RLS, navigation, audit, support.

## 19. Decision acceptance record

Before implementing a decision marked **OPEN**, record:

```text
Decision ID:
Chosen option:
Scope/tenant/branch affected:
Product owner:
Security reviewer:
Architecture reviewer:
Date approved:
Effective release/phase:
Data/API consequences:
Migration/backfill required:
Rollback or sunset plan:
Acceptance tests:
```

No major decision in this document should be inferred from the presence of a
UI label, a current enum, or an existing SQL function. A decision is approved
only when the product owner and required security/architecture reviewers have
recorded the choice and its release gate.

## 20. Current blockers and next decision meeting

The minimum decision agenda before further feature implementation is:

1. approve restaurant-only P1 boundary and explicitly defer room service;
2. define operational roles and server-side status permissions;
3. define cancellation/handoff states and required audit events;
4. define QR rotation/revocation behavior;
5. verify the local five-argument RPC/RLS contract in a disposable database;
6. choose tenant/branch terminology before SaaS expansion; and
7. decide inventory deduction timing and recipe version policy before P3.

Until those decisions and the corresponding verification gates are complete,
new UI polish or additional feature count should not be treated as product
readiness.

## 21. Evidence used

This register was based on the local repository files below:

- `supabase/migrations/20261018000000_altiora_mvp.sql`
- `supabase/migrations/20261019000000_fix_order_number_ambiguity.sql`
- `supabase/migrations/20261020000000_order_idempotency.sql`
- `supabase/migrations/20261020010000_order_idempotency_hardening.sql`
- `supabase/tests/rls.sql`
- `supabase/tests/order_rpc.sql`
- `lib/staff/auth.ts`
- `lib/orders/status.ts`
- `lib/orders/idempotency.ts`
- `components/kitchen-dashboard.tsx`
- `components/customer-menu.tsx`
- `app/api/orders/route.ts`
- `app/api/orders/[orderId]/status/route.ts`
- `app/api/kitchen/dashboard/route.ts`

No application feature, source code, test, migration, schema, README,
configuration, remote database, credential, commit, push, or deployment was
changed for this register.
