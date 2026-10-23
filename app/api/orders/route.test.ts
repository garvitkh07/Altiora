import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.hoisted(() => vi.fn());
const createSupabaseServerClientMock = vi.hoisted(() =>
  vi.fn(async () => ({ rpc: rpcMock })),
);

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: createSupabaseServerClientMock,
}));

import { POST } from "./route";

const orderInput = {
  restaurant_slug: "altiora-dining",
  table_token: "table-token",
  items: [
    {
      menu_item_id: "00000000-0000-4000-8000-000000000003",
      quantity: 2,
    },
  ],
  special_instructions: "Window seat",
};

function requestWithKey(key = "550e8400-e29b-41d4-a716-446655440000") {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(orderInput),
  });
}

async function responseBody(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/orders", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    createSupabaseServerClientMock.mockClear();
  });

  it.each([null, "too-short", "contains spaces 123456"]) (
    "rejects a missing or malformed Idempotency-Key (%s) with 400",
    async (key) => {
      const request = key === null
        ? new Request("http://localhost/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(orderInput),
          })
        : requestWithKey(key);

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(rpcMock).not.toHaveBeenCalled();
    },
  );

  it("returns 201 for a new order and preserves the response aliases", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          order_id: "10000000-0000-4000-8000-000000000401",
          order_number: "42",
          status: "NEW",
          total_amount: "25.00",
          created_at: "2026-10-20T00:00:00.000Z",
          replayed: false,
        },
      ],
      error: null,
    });

    const response = await POST(requestWithKey());
    const body = await responseBody(response);

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      order_id: "10000000-0000-4000-8000-000000000401",
      order_number: 42,
      status: "NEW",
      total_amount: 25,
      replayed: false,
      orderId: "10000000-0000-4000-8000-000000000401",
      order: {
        id: "10000000-0000-4000-8000-000000000401",
        orderNumber: "42",
        totalAmount: 25,
        createdAt: "2026-10-20T00:00:00.000Z",
      },
    });
    expect(rpcMock).toHaveBeenCalledWith("create_order", expect.objectContaining({
      p_idempotency_key: "550e8400-e29b-41d4-a716-446655440000",
    }));
  });

  it("returns 200 for a matching replay", async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          order_id: "10000000-0000-4000-8000-000000000401",
          order_number: 42,
          status: "SERVED",
          total_amount: 25,
          created_at: "2026-10-20T00:00:00.000Z",
          replayed: true,
        },
      ],
      error: null,
    });

    const response = await POST(requestWithKey());
    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ replayed: true, order_number: 42, status: "SERVED" });
  });

  it("returns a safe 409 for a fingerprint conflict", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "PZ001",
        message: "secret fingerprint and request payload",
        details: "private database details",
      },
    });

    const response = await POST(requestWithKey());
    const body = await responseBody(response);
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "This checkout attempt conflicts with another request. Please start a new order.",
      message: "This checkout attempt conflicts with another request. Please start a new order.",
    });
    expect(serialized).not.toContain("secret fingerprint");
    expect(serialized).not.toContain("private database details");
  });

  it("does not expose unexpected database error details", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: "XX000",
        message: "secret database message",
        details: "secret database details",
        hint: "secret database hint",
      },
    });

    const response = await POST(requestWithKey());
    const body = await responseBody(response);
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Order could not be created. Please try again.",
      message: "Order could not be created. Please try again.",
    });
    expect(serialized).not.toContain("secret database");
  });
});
