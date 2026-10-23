import { afterEach, describe, expect, it, vi } from "vitest";

import {
  abandonOrderAttempt,
  createOrderAttempt,
  clearOrderAttempt,
  deserializeOrderAttempt,
  digestTableToken,
  markOrderAttemptConflict,
  markOrderAttemptUncertain,
  pendingOrderStorageKey,
  restoreOrderAttemptState,
  saveOrderAttempt,
  serializeOrderAttempt,
} from "./idempotency";
import { parseIdempotencyKey } from "./validation";
import {
  DataRequestError,
  isDefiniteOrderClientError,
  isOrderIdempotencyConflict,
  isUncertainOrderError,
} from "../data";

const menuItemId = "00000000-0000-4000-8000-000000000003";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("idempotency key validation", () => {
  it("accepts a UUID-shaped opaque key", () => {
    expect(
      parseIdempotencyKey("550e8400-e29b-41d4-a716-446655440000").success,
    ).toBe(true);
  });

  it("rejects missing, short, unsafe, and oversized keys", () => {
    expect(parseIdempotencyKey(null).success).toBe(false);
    expect(parseIdempotencyKey("short").success).toBe(false);
    expect(parseIdempotencyKey("valid-key-with spaces").success).toBe(false);
    expect(parseIdempotencyKey("x".repeat(256)).success).toBe(false);
  });
});

describe("customer order attempt lifecycle", () => {
  const input = {
    restaurant_slug: "altiora-dining",
    table_token: "table-token",
    items: [{ menu_item_id: menuItemId, quantity: 2 }],
    special_instructions: "Window seat",
  };

  it("keeps the same key and exact payload when an outcome is uncertain", () => {
    const attempt = createOrderAttempt(input);
    const uncertain = markOrderAttemptUncertain(attempt);

    expect(uncertain.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(uncertain.input).toEqual(input);
    expect(uncertain.status).toBe("uncertain");
  });

  it("blocks retry when the server reports an idempotency conflict", () => {
    const attempt = createOrderAttempt(input);
    const conflict = markOrderAttemptConflict(attempt);
    const restored = deserializeOrderAttempt(
      serializeOrderAttempt(conflict),
      input.table_token,
    );

    expect(conflict.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(conflict.input).toEqual(input);
    expect(conflict.status).toBe("conflict");
    expect(restored?.status).toBe("conflict");
  });

  it("round-trips reload recovery without persisting the table token", () => {
    const attempt = createOrderAttempt(input);
    const serialized = serializeOrderAttempt(attempt);
    const restored = deserializeOrderAttempt(serialized, input.table_token);

    expect(serialized).not.toContain(input.table_token);
    expect(restored).toEqual({
      ...attempt,
      status: "uncertain",
    });
  });

  it("keeps the saved payload unchanged across a valid restoration", () => {
    const exactInput = {
      ...input,
      items: [{ ...input.items[0], special_instructions: "  No onions  " }],
      special_instructions: "  Window seat  ",
    };
    const attempt = createOrderAttempt(exactInput);
    const restored = deserializeOrderAttempt(
      serializeOrderAttempt(attempt),
      exactInput.table_token,
    );

    expect(restored?.input).toEqual(exactInput);
    expect(restored?.idempotencyKey).toBe(attempt.idempotencyKey);
  });

  it("does not restore a table-bound attempt on another table route", () => {
    const attempt = createOrderAttempt(input, "public-table-a");
    const serialized = serializeOrderAttempt(attempt);

    expect(serialized).toContain("public-table-a");
    expect(serialized).not.toContain(input.table_token);
    expect(
      deserializeOrderAttempt(serialized, input.table_token, "public-table-b"),
    ).toBeNull();
  });

  it("does not substitute a rotated token for the same table id", () => {
    const attempt = createOrderAttempt(input, "public-table-a");

    expect(
      deserializeOrderAttempt(
        serializeOrderAttempt(attempt),
        "rotated-table-token",
        "public-table-a",
      ),
    ).toBeNull();
  });

  it("restores a table-bound attempt on its original table route", () => {
    const attempt = createOrderAttempt(input, "public-table-a");
    const restored = deserializeOrderAttempt(
      serializeOrderAttempt(attempt),
      input.table_token,
      "public-table-a",
    );

    expect(restored?.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(restored?.input).toEqual(input);
    expect(restored?.tableBinding).toEqual({
      kind: "table-id",
      value: "public-table-a",
      tokenDigest: digestTableToken(input.table_token),
    });
  });

  it("uses a normalized SHA-256 token digest when no table id is available", () => {
    const digest = digestTableToken("  table-token  ");

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe("e946524d2489b40914d39ab081eb02aea7e3ede1793d6066c7efb0b4ac8c891a");
    expect(digest).toBe(digestTableToken("table-token"));
    expect(digest).not.toContain("table-token");
    expect(
      deserializeOrderAttempt(
        serializeOrderAttempt(createOrderAttempt(input)),
        "different-table-token",
      ),
    ).toBeNull();
  });
});

describe("order submission error classification", () => {
  it("keeps timeouts and server failures uncertain", () => {
    expect(isUncertainOrderError(new DataRequestError("timeout", 408))).toBe(true);
    expect(isUncertainOrderError(new DataRequestError("rate limited", 429))).toBe(true);
    expect(isUncertainOrderError(new DataRequestError("server", 503))).toBe(true);
    expect(isDefiniteOrderClientError(new DataRequestError("timeout", 408))).toBe(false);
    expect(isDefiniteOrderClientError(new DataRequestError("rate limited", 429))).toBe(false);
  });

  it("treats validation errors as definite and conflicts separately", () => {
    const validationError = new DataRequestError("invalid", 400);
    const conflictError = new DataRequestError("conflict", 409);

    expect(isDefiniteOrderClientError(validationError)).toBe(true);
    expect(isUncertainOrderError(validationError)).toBe(false);
    expect(isOrderIdempotencyConflict(conflictError)).toBe(true);
    expect(isDefiniteOrderClientError(conflictError)).toBe(false);
  });
});

describe("session-backed table attempt isolation", () => {
  const storage = new MemoryStorage();
  const sessionInput = {
    restaurant_slug: "altiora-dining",
    table_token: "table-token",
    items: [{ menu_item_id: menuItemId, quantity: 2 }],
    special_instructions: "Window seat",
  };

  afterEach(() => {
    storage.clear();
    vi.unstubAllGlobals();
  });

  it("keeps table A recoverable when a new checkout is saved on table B", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const tableA = createOrderAttempt(sessionInput, "public-table-a");
    const tableB = createOrderAttempt(
      { ...sessionInput, table_token: "table-token-b" },
      "public-table-b",
    );
    saveOrderAttempt(tableA);
    saveOrderAttempt(tableB);

    const tableARecovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      sessionInput.table_token,
      "public-table-a",
    );
    const tableBRecovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      "table-token-b",
      "public-table-b",
    );

    expect(tableARecovery.mismatch).toBe(false);
    expect(tableARecovery.attempt?.idempotencyKey).toBe(tableA.idempotencyKey);
    expect(tableBRecovery.mismatch).toBe(false);
    expect(tableBRecovery.attempt?.idempotencyKey).toBe(tableB.idempotencyKey);
  });

  it("preserves the current v3 record while scanning legacy records", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const currentAttempt = createOrderAttempt(sessionInput, "public-table-a");
    saveOrderAttempt(currentAttempt);

    const serialized = storage.getItem(
      pendingOrderStorageKey(
        sessionInput.restaurant_slug,
        currentAttempt.tableBinding,
      ),
    );
    expect(serialized).not.toBeNull();
    expect(JSON.parse(serialized as string).version).toBe(3);

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      sessionInput.table_token,
      "public-table-a",
    );

    expect(recovery.attempt?.idempotencyKey).toBe(currentAttempt.idempotencyKey);
    expect(
      storage.getItem(
        pendingOrderStorageKey(
          sessionInput.restaurant_slug,
          currentAttempt.tableBinding,
        ),
      ),
    ).toBe(serialized);
  });

  it("reports a mismatch without restoring a different table's attempt", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const tableA = createOrderAttempt(sessionInput, "public-table-a");
    saveOrderAttempt(tableA);

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      "table-token-b",
      "public-table-b",
    );

    expect(recovery).toEqual({ attempt: null, mismatch: true });
  });

  it("clears only the original attempt storage entry", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const tableA = createOrderAttempt(sessionInput, "public-table-a");
    const tableB = createOrderAttempt(
      { ...sessionInput, table_token: "table-token-b" },
      "public-table-b",
    );
    saveOrderAttempt(tableA);
    saveOrderAttempt(tableB);

    clearOrderAttempt(tableA);

    expect(
      restoreOrderAttemptState(
        sessionInput.restaurant_slug,
        sessionInput.table_token,
        "public-table-a",
      ),
    ).toEqual({ attempt: null, mismatch: true });
    expect(
      restoreOrderAttemptState(
        sessionInput.restaurant_slug,
        "table-token-b",
        "public-table-b",
      )
        .attempt?.idempotencyKey,
    ).toBe(tableB.idempotencyKey);
  });

  it("recognizes a v1 record without restoring it", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const legacyRecord = JSON.stringify({
      version: 1,
      idempotency_key: "legacy-v1-checkout-key",
      restaurant_slug: sessionInput.restaurant_slug,
      items: sessionInput.items,
      special_instructions: sessionInput.special_instructions,
    });
    const storageKey = pendingOrderStorageKey(sessionInput.restaurant_slug);
    storage.setItem(storageKey, legacyRecord);

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      sessionInput.table_token,
      "public-table-a",
    );

    expect(recovery.attempt).toBeNull();
    expect(recovery.mismatch).toBe(false);
    expect(recovery.legacy).toMatchObject({
      kind: "legacy",
      version: 1,
      idempotencyKey: "legacy-v1-checkout-key",
      reason: "missing-table-binding",
    });
    expect(recovery.legacy?.message).toContain("restaurant staff");
    expect(storage.getItem(storageKey)).toBe(legacyRecord);
  });

  it("recognizes a v2 table-id-only record as unsafe", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const legacyRecord = JSON.stringify({
      version: 2,
      idempotency_key: "legacy-v2-table-id-key",
      restaurant_slug: sessionInput.restaurant_slug,
      table_id: "public-table-a",
      items: sessionInput.items,
      special_instructions: sessionInput.special_instructions,
      status: "uncertain",
    });
    const storageKey = pendingOrderStorageKey(sessionInput.restaurant_slug);
    storage.setItem(storageKey, legacyRecord);

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      sessionInput.table_token,
      "public-table-a",
    );

    expect(recovery.attempt).toBeNull();
    expect(recovery.mismatch).toBe(false);
    expect(recovery.legacy).toMatchObject({
      kind: "legacy",
      version: 2,
      reason: "missing-token-digest",
    });
    expect(storage.getItem(storageKey)).toBe(legacyRecord);
  });

  it("restores a v2 record when its token digest proves the route", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const legacyRecord = JSON.stringify({
      version: 2,
      idempotency_key: "legacy-v2-token-digest-key",
      restaurant_slug: sessionInput.restaurant_slug,
      table_token_digest: digestTableToken(sessionInput.table_token),
      items: sessionInput.items,
      special_instructions: sessionInput.special_instructions,
      status: "active",
    });
    storage.setItem(
      pendingOrderStorageKey(sessionInput.restaurant_slug),
      legacyRecord,
    );

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      sessionInput.table_token,
      "public-table-a",
    );

    expect(recovery.legacy).toBeUndefined();
    expect(recovery.mismatch).toBe(false);
    expect(recovery.attempt).toMatchObject({
      idempotencyKey: "legacy-v2-token-digest-key",
      status: "uncertain",
      input: sessionInput,
      tableBinding: {
        kind: "token-digest",
        value: digestTableToken(sessionInput.table_token),
        tokenDigest: digestTableToken(sessionInput.table_token),
      },
    });
  });

  it("keeps an unsafe legacy record until explicit abandonment", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const legacyRecord = JSON.stringify({
      version: 1,
      idempotency_key: "legacy-abandonment-key",
      restaurant_slug: sessionInput.restaurant_slug,
      items: sessionInput.items,
    });
    const storageKey = pendingOrderStorageKey(sessionInput.restaurant_slug);
    storage.setItem(storageKey, legacyRecord);

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      sessionInput.table_token,
    );
    expect(recovery.legacy).toBeDefined();
    expect(storage.getItem(storageKey)).toBe(legacyRecord);

    abandonOrderAttempt(recovery.legacy!);

    expect(storage.getItem(storageKey)).toBeNull();
  });

  it("does not restore a safely bound legacy record on another route", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const legacyRecord = JSON.stringify({
      version: 2,
      idempotency_key: "legacy-route-mismatch-key",
      restaurant_slug: sessionInput.restaurant_slug,
      table_token_digest: digestTableToken(sessionInput.table_token),
      items: sessionInput.items,
      status: "uncertain",
    });
    storage.setItem(
      pendingOrderStorageKey(sessionInput.restaurant_slug),
      legacyRecord,
    );

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      "different-table-token",
      "public-table-b",
    );

    expect(recovery).toEqual({ attempt: null, mismatch: true });
    expect(storage.getItem(pendingOrderStorageKey(sessionInput.restaurant_slug))).toBe(
      legacyRecord,
    );
  });

  it("does not copy a raw legacy table token into a recovery state", () => {
    vi.stubGlobal("window", { sessionStorage: storage });

    const rawToken = "legacy-raw-table-token";
    const legacyRecord = JSON.stringify({
      version: 2,
      idempotency_key: "legacy-raw-token-key",
      restaurant_slug: sessionInput.restaurant_slug,
      table_token: rawToken,
      table_token_digest: digestTableToken(rawToken),
      items: sessionInput.items,
      status: "uncertain",
    });
    storage.setItem(
      pendingOrderStorageKey(sessionInput.restaurant_slug),
      legacyRecord,
    );

    const recovery = restoreOrderAttemptState(
      sessionInput.restaurant_slug,
      rawToken,
      "public-table-a",
    );

    expect(recovery.attempt).toBeNull();
    expect(recovery.legacy?.reason).toBe("raw-table-token");
    expect(JSON.stringify(recovery)).not.toContain(rawToken);
  });
});
