/**
 * Browser-safe data access for the Altiora UI.
 *
 * This module deliberately talks to same-origin API routes only. It does not
 * import a Supabase client or contain service-role credentials; the backend
 * agent owns those details and only needs to satisfy these typed contracts.
 */

export interface RestaurantSummary {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
}

export interface RestaurantTable {
  id?: string;
  // Public menu RPCs intentionally omit qr_token.
  token?: string;
  label: string;
}

export interface MenuCategory {
  id: string;
  name: string;
  description?: string | null;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  price: number;
  originalPrice?: number | null;
  imageUrl?: string | null;
  isVegetarian?: boolean;
  isAvailable?: boolean;
  allergens?: string[];
}

export interface RestaurantMenu {
  restaurant: RestaurantSummary;
  table: RestaurantTable;
  currency: string;
  categories: MenuCategory[];
  items: MenuItem[];
}

export type KitchenOrderStatus = "new" | "preparing" | "ready" | "completed";

export interface KitchenOrderItem {
  name: string;
  quantity: number;
}

export interface KitchenOrder {
  id: string;
  orderNumber: string;
  tableLabel: string;
  currency?: string | null;
  status: KitchenOrderStatus;
  createdAt: string;
  items: KitchenOrderItem[];
  total: number;
  customerNote?: string | null;
}

export interface KitchenDashboardData {
  restaurantName: string;
  currency?: string | null;
  updatedAt: string;
  stats: {
    newOrders: number;
    inPreparation: number;
    ready: number;
    revenue: number;
  };
  orders: KitchenOrder[];
}

export interface OrderLineInput {
  menu_item_id: string;
  quantity: number;
  special_instructions?: string;
}

export interface SubmitOrderInput {
  restaurant_slug: string;
  table_token: string;
  items: OrderLineInput[];
  special_instructions?: string;
}

export interface OrderConfirmation {
  orderId: string;
  orderNumber?: string | number | null;
  estimatedMinutes?: number | null;
  status?: string | null;
  totalAmount?: number | null;
  createdAt?: string | null;
}

interface NestedOrderResponse {
  order: {
    id?: string;
    orderId?: string;
    order_number?: string | number | null;
    orderNumber?: string | number | null;
    total_amount?: number | null;
    totalAmount?: number | null;
    created_at?: string | null;
    createdAt?: string | null;
    estimatedMinutes?: number | null;
    status?: string | null;
  };
  order_id?: string;
  order_number?: string | number | null;
  created_at?: string | null;
}

export interface OrderStatusUpdate {
  orderId: string;
  status: KitchenOrderStatus;
}

interface OrderStatusResponse {
  id?: string;
  orderId?: string;
  status?: string | null;
  order?: {
    id?: string;
    orderId?: string;
    status?: string | null;
  };
}

export class DataRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DataRequestError";
    this.status = status;
  }
}

/**
 * A transport failure, gateway/server failure, or HTTP 408/429 may occur after
 * the database accepted the request. Keep the original key and payload for
 * those cases. HTTP 409 is handled separately as an idempotency conflict.
 */
export function isUncertainOrderError(error: unknown) {
  return (
    !(error instanceof DataRequestError) ||
    error.status >= 500 ||
    error.status === 408 ||
    error.status === 429
  );
}

export function isOrderIdempotencyConflict(error: unknown) {
  return error instanceof DataRequestError && error.status === 409;
}

export function isDefiniteOrderClientError(error: unknown) {
  // Future client statuses that can represent an accepted-but-unconfirmed
  // request must be excluded here and handled as uncertain instead.
  return (
    error instanceof DataRequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429 &&
    error.status !== 409
  );
}

type ApiEnvelope<T> = T | { data: T };

function unwrap<T>(payload: ApiEnvelope<T>): T {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "data" in payload &&
    payload.data !== undefined
  ) {
    return payload.data;
  }

  return payload as T;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "message" in payload
        ? String(payload.message)
        : typeof payload === "object" && payload !== null && "error" in payload
          ? String(payload.error)
          : `Request failed with status ${response.status}`;
    throw new DataRequestError(message, response.status);
  }

  return unwrap(payload as ApiEnvelope<T>);
}

/**
 * Public menu contract. The backend should expose this route without
 * requiring a privileged browser credential.
 */
export function getRestaurantMenu(
  restaurantSlug: string,
  tableToken: string,
): Promise<RestaurantMenu> {
  const slug = encodeURIComponent(restaurantSlug);
  const token = encodeURIComponent(tableToken);
  return requestJson<RestaurantMenu>(`/api/restaurants/${slug}/table/${token}`);
}

/** Staff dashboard contract. Authentication/authorization belongs to the API. */
export function getKitchenDashboard(): Promise<KitchenDashboardData> {
  return requestJson<KitchenDashboardData>("/api/kitchen/dashboard");
}

export function submitOrder(
  input: SubmitOrderInput,
  idempotencyKey: string,
): Promise<OrderConfirmation> {
  return requestJson<OrderConfirmation | NestedOrderResponse>("/api/orders", {
    method: "POST",
    headers: {
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  }).then((payload) => {
    if (payload && typeof payload === "object" && "order" in payload && payload.order) {
      return {
        orderId: payload.order.id || payload.order.orderId || payload.order_id || "",
        orderNumber:
          payload.order.orderNumber !== undefined && payload.order.orderNumber !== null
            ? String(payload.order.orderNumber)
            : payload.order.order_number !== undefined && payload.order.order_number !== null
              ? String(payload.order.order_number)
              : null,
        estimatedMinutes: payload.order.estimatedMinutes,
        status: payload.order.status,
        totalAmount:
          payload.order.totalAmount !== undefined
            ? payload.order.totalAmount
            : payload.order.total_amount,
        createdAt:
          payload.order.createdAt !== undefined
            ? payload.order.createdAt
            : payload.order.created_at,
      };
    }

    if (payload && typeof payload === "object" && "order_id" in payload && payload.order_id) {
      return {
        orderId: payload.order_id,
        orderNumber:
          payload.order_number !== undefined && payload.order_number !== null
            ? String(payload.order_number)
            : null,
        status: "status" in payload && typeof payload.status === "string" ? payload.status : null,
        totalAmount:
          "total_amount" in payload && typeof payload.total_amount === "number"
            ? payload.total_amount
            : null,
        createdAt: "created_at" in payload && typeof payload.created_at === "string" ? payload.created_at : null,
      };
    }

    return payload as OrderConfirmation;
  });
}

function normalizeKitchenStatus(value: string | null | undefined, fallback: KitchenOrderStatus): KitchenOrderStatus {
  if (value === "NEW" || value === "pending" || value === "confirmed" || value === "new") {
    return "new";
  }
  if (value === "PREPARING" || value === "preparing") {
    return "preparing";
  }
  if (value === "READY" || value === "ready") {
    return "ready";
  }
  if (value === "SERVED" || value === "completed") {
    return "completed";
  }
  return fallback;
}

/**
 * Staff status updates are intentionally routed through the backend. The
 * browser never talks to Supabase directly and can safely handle a 204 or a
 * nested `{ order: ... }` response from the status endpoint.
 */
export function updateOrderStatus(
  orderId: string,
  status: KitchenOrderStatus,
): Promise<OrderStatusUpdate> {
  const encodedOrderId = encodeURIComponent(orderId);
  return requestJson<OrderStatusResponse | null>(`/api/orders/${encodedOrderId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  }).then((payload) => {
    const response = payload && typeof payload === "object" ? payload : {};
    const order = response.order && typeof response.order === "object" ? response.order : response;
    return {
      orderId: order.orderId || order.id || orderId,
      status: normalizeKitchenStatus(order.status, status),
    };
  });
}
