import { NextResponse } from "next/server";

import {
  formatValidationIssues,
  normalizeCreateOrderInput,
  parseCreateOrderInput,
} from "@/lib/orders/validation";
import { SupabaseConfigurationError } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type OrderRpcRow = {
  order_id: string;
  order_number: number | string;
  status: string;
  total_amount: number | string;
};

const knownRpcMessages = new Set([
  "A restaurant slug and table token are required",
  "The restaurant or table is not available",
  "The menu or table is not available",
  "At least one item is required",
  "An order cannot contain more than 50 items",
  "Each item needs a menu_item_id and quantity",
  "A valid menu item is required",
  "Quantity must be an integer between 1 and 99",
  "Each menu item may appear only once",
  "A menu item is not available",
  "Special instructions cannot exceed 500 characters",
]);

function errorResponse(error: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error,
      message: error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function rpcErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return "Order could not be created. Please try again.";
  }

  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && knownRpcMessages.has(message)
    ? message
    : "Order could not be created. Please try again.";
}

function toSafeAmount(value: number | string) {
  const amount = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(amount) || amount < 0 || Math.round(amount * 100) > Number.MAX_SAFE_INTEGER) {
    throw new Error("RPC returned an invalid monetary value");
  }

  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function toOrderNumber(value: number | string) {
  const orderNumber = typeof value === "number" ? value : Number(value);

  if (!Number.isSafeInteger(orderNumber) || orderNumber < 1) {
    throw new Error("RPC returned an invalid order number");
  }

  return orderNumber;
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON", 400);
  }

  const parsed = parseCreateOrderInput(body);

  if (!parsed.success) {
    return errorResponse(
      "Invalid order request",
      400,
      formatValidationIssues(parsed.error),
    );
  }

  const input = normalizeCreateOrderInput(parsed.data);

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.rpc("create_order", {
      p_restaurant_slug: input.restaurant_slug,
      p_table_token: input.table_token,
      p_items: input.items.map((item) => ({
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        ...(item.special_instructions
          ? { special_instructions: item.special_instructions }
          : {}),
      })),
      p_special_instructions: input.special_instructions ?? null,
    });

    if (error) {
      const isClientError = error.code === "P0001";
      const message = isClientError
        ? rpcErrorMessage(error)
        : "Order could not be created. Please try again.";
      return errorResponse(message, isClientError ? 400 : 500);
    }

    const row = (Array.isArray(data) ? data[0] : data) as OrderRpcRow | null;

    if (!row?.order_id || !row.status) {
      return errorResponse("Order could not be created. Please try again.", 500);
    }

    const orderNumber = toOrderNumber(row.order_number);
    const totalAmount = toSafeAmount(row.total_amount);
    const order = {
      id: row.order_id,
      order_number: orderNumber,
      status: row.status,
      total_amount: totalAmount,
      // These aliases keep the existing confirmation component compatible.
      orderNumber: String(orderNumber),
      totalAmount,
    };

    return NextResponse.json(
      {
        order_id: row.order_id,
        order_number: orderNumber,
        status: row.status,
        total_amount: totalAmount,
        order,
        // Safe response compatibility for the existing browser data helper.
        orderId: row.order_id,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SupabaseConfigurationError) {
      return errorResponse("Supabase is not configured on the server", 500);
    }

    return errorResponse("Order could not be created. Please try again.", 500);
  }
}
