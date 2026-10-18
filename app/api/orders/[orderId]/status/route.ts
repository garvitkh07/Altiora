import { NextResponse } from "next/server";
import { z } from "zod";

import { canTransitionOrderStatus, type DatabaseOrderStatus } from "@/lib/orders/status";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const statusSchema = z
  .object({
    status: z.enum(["new", "preparing", "ready", "completed", "cancelled"]),
  })
  .strict();

const statusMap = {
  new: "NEW",
  preparing: "PREPARING",
  ready: "READY",
  completed: "SERVED",
  cancelled: "CANCELLED",
} as const;

type RouteContext = {
  params: {
    orderId: string;
  };
};

function errorResponse(error: string, status: number, details?: unknown) {
  return NextResponse.json(
    { error, message: error, ...(details ? { details } : {}) },
    { status },
  );
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!z.string().uuid().safeParse(params.orderId).success) {
    return errorResponse("A valid order ID is required", 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON", 400);
  }

  const parsed = statusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("Invalid order status", 400, parsed.error.issues);
  }

  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError) {
      return errorResponse("Your staff session could not be verified", 401);
    }

    if (!user) {
      return errorResponse("Staff authentication is required", 401);
    }

    const { data: currentOrder, error: currentOrderError } = await supabase
      .from("orders")
      .select("status")
      .eq("id", params.orderId)
      .maybeSingle();

    if (currentOrderError) {
      throw currentOrderError;
    }

    if (!currentOrder) {
      return errorResponse("Order not found or not accessible", 404);
    }

    const currentStatus = currentOrder.status as DatabaseOrderStatus;
    const nextStatus = statusMap[parsed.data.status] as DatabaseOrderStatus;

    if (!canTransitionOrderStatus(currentStatus, nextStatus)) {
      return errorResponse("That order status transition is not allowed", 409);
    }

    const { data, error } = await supabase
      .from("orders")
      .update({ status: nextStatus })
      .eq("id", params.orderId)
      .select("id, order_number, status, total_amount")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      return errorResponse("Order not found or not accessible", 404);
    }

    return NextResponse.json({
      order_id: data.id,
      order_number: data.order_number,
      status: data.status,
      total_amount: Number(data.total_amount),
      orderId: data.id,
      order: {
        id: data.id,
        order_number: data.order_number,
        status: data.status,
        total_amount: Number(data.total_amount),
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P0001"
    ) {
      return errorResponse("That order status transition is not allowed", 409);
    }

    return errorResponse("The order status could not be updated", 500);
  }
}
