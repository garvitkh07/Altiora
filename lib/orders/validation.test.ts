import { describe, expect, it } from "vitest";

import {
  calculateOrderTotal,
  calculateOrderTotals,
  formatValidationIssues,
  normalizeCreateOrderInput,
  parseCreateOrderInput,
} from "./validation";

const menuItemId = "00000000-0000-4000-8000-000000000003";

describe("create order validation", () => {
  it("accepts the documented strict snake_case body and trims instructions", () => {
    const result = parseCreateOrderInput({
      restaurant_slug: "altiora-dining",
      table_token: "0123456789abcdef",
      items: [{ menu_item_id: menuItemId, quantity: 2, special_instructions: "  No onions  " }],
      special_instructions: "  Window seat  ",
    });

    expect(result.success).toBe(true);
    if (result.success && "restaurant_slug" in result.data) {
      expect(result.data.special_instructions).toBe("Window seat");
      expect(result.data.items[0].special_instructions).toBe("No onions");
    }
  });

  it("rejects unknown fields and duplicate menu items", () => {
    const result = parseCreateOrderInput({
      restaurant_slug: "altiora-dining",
      table_token: "0123456789abcdef",
      items: [
        { menu_item_id: menuItemId, quantity: 1 },
        { menu_item_id: menuItemId, quantity: 2 },
      ],
      unexpected: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = formatValidationIssues(result.error);
      expect(issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "body", message: expect.stringContaining("unexpected") }),
          expect.objectContaining({ path: "items.1" }),
        ]),
      );
    }
  });

  it("accepts the safe legacy camelCase body and normalizes it", () => {
    const result = parseCreateOrderInput({
      restaurantSlug: "altiora-dining",
      tableToken: "0123456789abcdef",
      items: [{ menuItemId, quantity: 1 }],
      customerNote: "  Window seat  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(normalizeCreateOrderInput(result.data)).toEqual({
        restaurant_slug: "altiora-dining",
        table_token: "0123456789abcdef",
        items: [{ menu_item_id: menuItemId, quantity: 1 }],
        special_instructions: "Window seat",
      });
    }
  });

  it("rejects non-integer and out-of-range quantities", () => {
    const result = parseCreateOrderInput({
      restaurant_slug: "altiora-dining",
      table_token: "0123456789abcdef",
      items: [{ menu_item_id: menuItemId, quantity: 0.5 }],
    });

    expect(result.success).toBe(false);
  });
});

describe("order totals", () => {
  it("calculates numeric(10,2)-compatible totals", () => {
    const lines = [
      { unitPrice: 12.5, quantity: 2 },
      { unitPrice: 7.99, quantity: 1 },
    ];

    expect(calculateOrderTotal(lines)).toBe(32.99);
    expect(calculateOrderTotals(lines)).toEqual({
      subtotalAmount: 32.99,
      taxAmount: 0,
      totalAmount: 32.99,
    });
  });

  it("rejects invalid priced lines", () => {
    expect(() => calculateOrderTotal([{ unitPrice: -1, quantity: 1 }])).toThrow(/non-negative/);
  });
});
