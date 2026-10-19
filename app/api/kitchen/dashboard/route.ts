import { NextResponse } from "next/server";

import { getStaffAccess } from "@/lib/staff/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardStatus = "new" | "preparing" | "ready" | "completed";

const statusMap: Record<string, DashboardStatus | null> = {
  NEW: "new",
  PREPARING: "preparing",
  READY: "ready",
  SERVED: "completed",
  CANCELLED: null,
};

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error, message: error }, { status });
}

export async function GET() {
  try {
    const staffAccess = await getStaffAccess();

    if (!staffAccess.ok) {
      if (staffAccess.errorCode === "unauthenticated") {
        return errorResponse("Staff authentication is required", 401);
      }

      if (
        staffAccess.errorCode === "unassigned" ||
        staffAccess.errorCode === "inactive"
      ) {
        return errorResponse("You are not a member of an active restaurant", 403);
      }

      if (staffAccess.errorCode === "configuration") {
        return errorResponse("Supabase is not configured on the server", 503);
      }

      return errorResponse("Your staff session could not be verified", 500);
    }

    const supabase = await createSupabaseServerClient();
    const { restaurant: staffRestaurant } = staffAccess.access;
    const restaurantId = staffRestaurant.id;

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id, order_number, status, created_at, total_amount, special_instructions, table_id")
      .eq("restaurant_id", restaurantId)
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

    if (ordersError) {
      throw ordersError;
    }

    const orderRows = (orders ?? []) as Array<{
      id: string;
      order_number: number | string;
      status: string;
      created_at: string;
      total_amount: number | string;
      special_instructions: string | null;
      table_id: string;
    }>;
    const orderIds = orderRows.map((order) => order.id);

    const [tablesResult, itemsResult] = await Promise.all([
      supabase
        .from("restaurant_tables")
        .select("id, label")
        .eq("restaurant_id", restaurantId),
      orderIds.length > 0
        ? supabase
            .from("order_items")
            .select("order_id, item_name_snapshot, quantity")
            .in("order_id", orderIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (tablesResult.error) {
      throw tablesResult.error;
    }

    if (itemsResult.error) {
      throw itemsResult.error;
    }

    const tableLabels = new Map(
      ((tablesResult.data ?? []) as Array<{ id: string; label: string }>).map((table) => [
        table.id,
        table.label,
      ]),
    );
    const itemsByOrder = new Map<string, Array<{ name: string; quantity: number }>>();

    for (const item of (itemsResult.data ?? []) as Array<{
      order_id: string;
      item_name_snapshot: string;
      quantity: number;
    }>) {
      const orderItems = itemsByOrder.get(item.order_id) ?? [];
      orderItems.push({ name: item.item_name_snapshot, quantity: item.quantity });
      itemsByOrder.set(item.order_id, orderItems);
    }

    const visibleOrders = orderRows
      .map((order) => ({ ...order, dashboardStatus: statusMap[order.status] ?? null }))
      .filter(
        (order): order is typeof order & { dashboardStatus: DashboardStatus } =>
          order.dashboardStatus !== null,
      );

    const revenue = visibleOrders.reduce((sum, order) => sum + Number(order.total_amount), 0);

    return NextResponse.json({
      restaurantName: staffRestaurant.name,
      currency: staffRestaurant.currency,
      updatedAt: new Date().toISOString(),
      stats: {
        newOrders: visibleOrders.filter((order) => order.dashboardStatus === "new").length,
        inPreparation: visibleOrders.filter((order) => order.dashboardStatus === "preparing").length,
        ready: visibleOrders.filter((order) => order.dashboardStatus === "ready").length,
        revenue: Math.round(revenue * 100) / 100,
      },
      orders: visibleOrders.map((order) => ({
        id: order.id,
        orderNumber: String(order.order_number),
        tableLabel: tableLabels.get(order.table_id) ?? "Unknown table",
        status: order.dashboardStatus,
        createdAt: order.created_at,
        items: itemsByOrder.get(order.id) ?? [],
        total: Number(order.total_amount),
        customerNote: order.special_instructions,
      })),
    });
  } catch {
    return errorResponse("The staff dashboard could not be loaded right now", 500);
  }
}
