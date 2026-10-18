import { z } from "zod";

const uuidSchema = z.string().uuid("Must be a valid UUID");
const instructionsSchema = z
  .string()
  .trim()
  .max(500, "Special instructions cannot exceed 500 characters")
  .optional();

const snakeOrderItemSchema = z
  .object({
    menu_item_id: uuidSchema,
    quantity: z
      .number({ invalid_type_error: "Quantity must be a number" })
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(99, "Quantity cannot exceed 99"),
    special_instructions: instructionsSchema,
  })
  .strict();

const camelOrderItemSchema = z
  .object({
    menuItemId: uuidSchema,
    quantity: z
      .number({ invalid_type_error: "Quantity must be a number" })
      .int("Quantity must be a whole number")
      .min(1, "Quantity must be at least 1")
      .max(99, "Quantity cannot exceed 99"),
    specialInstructions: instructionsSchema,
  })
  .strict();

const itemsSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z
    .array(itemSchema)
    .min(1, "At least one item is required")
    .max(50, "An order cannot contain more than 50 distinct items");

function addDuplicateItemIssues<T extends { items: readonly { id: string }[] }>(
  order: T,
  context: z.RefinementCtx,
) {
  const itemIds = new Set<string>();

  order.items.forEach((item, index) => {
    if (itemIds.has(item.id)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["items", index],
        message: "Each menu item may appear only once",
      });
    }

    itemIds.add(item.id);
  });
}

const snakeOrderBaseSchema = z.object({
  restaurant_slug: z
    .string()
    .trim()
    .min(1, "Restaurant slug is required")
    .max(100, "Restaurant slug is too long")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Restaurant slug is invalid"),
  table_token: z.string().trim().min(1, "Table token is required").max(128, "Table token is too long"),
  items: itemsSchema(snakeOrderItemSchema),
  special_instructions: instructionsSchema,
});

const camelOrderBaseSchema = z.object({
  restaurantSlug: z
    .string()
    .trim()
    .min(1, "Restaurant slug is required")
    .max(100, "Restaurant slug is too long")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Restaurant slug is invalid"),
  tableToken: z.string().trim().min(1, "Table token is required").max(128, "Table token is too long"),
  items: itemsSchema(camelOrderItemSchema),
  customerNote: instructionsSchema,
});

export const orderItemSchema = snakeOrderItemSchema;

/** Canonical public API body documented for the MVP. */
export const createOrderSchema = snakeOrderBaseSchema
  .strict()
  .superRefine((order, context) =>
    addDuplicateItemIssues(
      {
        items: order.items.map((item) => ({ id: item.menu_item_id })),
      },
      context,
    ),
  );

/** Safe legacy compatibility for the existing browser helper. */
export const legacyCreateOrderSchema = camelOrderBaseSchema
  .strict()
  .superRefine((order, context) =>
    addDuplicateItemIssues(
      {
        items: order.items.map((item) => ({ id: item.menuItemId })),
      },
      context,
    ),
  );

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type LegacyCreateOrderInput = z.infer<typeof legacyCreateOrderSchema>;
export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type ParsedCreateOrderInput = CreateOrderInput | LegacyCreateOrderInput;

export function parseCreateOrderInput(input: unknown) {
  if (
    typeof input === "object" &&
    input !== null &&
    ("restaurant_slug" in input || "table_token" in input || "special_instructions" in input)
  ) {
    return createOrderSchema.safeParse(input);
  }

  const canonicalResult = createOrderSchema.safeParse(input);
  if (canonicalResult.success) {
    return canonicalResult;
  }

  const legacyResult = legacyCreateOrderSchema.safeParse(input);
  return legacyResult.success ? legacyResult : canonicalResult;
}

export function normalizeCreateOrderInput(input: ParsedCreateOrderInput): CreateOrderInput {
  if ("restaurant_slug" in input) {
    return input;
  }

  return {
    restaurant_slug: input.restaurantSlug,
    table_token: input.tableToken,
    items: input.items.map((item) => ({
      menu_item_id: item.menuItemId,
      quantity: item.quantity,
      ...(item.specialInstructions ? { special_instructions: item.specialInstructions } : {}),
    })),
    ...(input.customerNote ? { special_instructions: input.customerNote } : {}),
  };
}

export function formatValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));
}

export interface PricedOrderLine {
  unitPrice: number;
  quantity: number;
}

function assertPrice(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("unitPrice must be a non-negative finite number");
  }
}

function assertQuantity(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("quantity must be a positive safe integer");
  }
}

function roundMoney(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;

  if (!Number.isSafeInteger(Math.round(rounded * 100))) {
    throw new RangeError("Order total exceeds the safe integer range");
  }

  return rounded;
}

/** Calculates a decimal-money subtotal; the database remains the price source of truth. */
export function calculateOrderTotal(lines: readonly PricedOrderLine[]): number {
  return roundMoney(
    lines.reduce((total, line) => {
      assertPrice(line.unitPrice);
      assertQuantity(line.quantity);
      return total + line.unitPrice * line.quantity;
    }, 0),
  );
}

export function calculateOrderTotals(lines: readonly PricedOrderLine[]) {
  const subtotalAmount = calculateOrderTotal(lines);

  return {
    subtotalAmount,
    taxAmount: 0,
    totalAmount: subtotalAmount,
  };
}
