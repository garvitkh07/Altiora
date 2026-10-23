import {
  normalizeCreateOrderInput,
  parseCreateOrderInput,
  parseIdempotencyKey,
  type CreateOrderInput,
} from "./validation";

export type OrderAttemptStatus = "active" | "uncertain" | "conflict";

export type OrderAttemptTableBinding =
  | { kind: "table-id"; value: string; tokenDigest: string }
  | { kind: "token-digest"; value: string; tokenDigest: string };

export interface OrderAttempt {
  idempotencyKey: string;
  input: CreateOrderInput;
  status: OrderAttemptStatus;
  /** The restaurant scope used for this attempt's session-storage entry. */
  storageScope: string;
  /** A public table id, or a digest when the public id is unavailable. */
  tableBinding: OrderAttemptTableBinding;
}

export type LegacyOrderAttemptVersion = 1 | 2;

export type LegacyOrderAttemptRecoveryReason =
  | "missing-table-binding"
  | "missing-token-digest"
  | "invalid-table-binding"
  | "raw-table-token"
  | "invalid-request-identity"
  | "invalid-payload";

/**
 * A recognizable pre-v3 record that was kept in sessionStorage, but cannot be
 * resumed safely from the information that it persisted. The record itself is
 * deliberately not exposed here: an older format could have contained data
 * that must not be copied into a new persisted format.
 */
export interface LegacyOrderAttemptRecovery {
  kind: "legacy";
  version: LegacyOrderAttemptVersion;
  idempotencyKey: string | null;
  restaurantSlug: string;
  reason: LegacyOrderAttemptRecoveryReason;
  message: string;
}

interface PersistedOrderAttempt {
  version: 3;
  idempotency_key: string;
  restaurant_slug: string;
  table_id?: string;
  table_token_digest: string;
  items: CreateOrderInput["items"];
  special_instructions?: string;
  status?: OrderAttemptStatus;
}

interface LegacyPersistedOrderAttempt {
  version: LegacyOrderAttemptVersion;
  idempotency_key: string | null;
  restaurant_slug: string;
  table_id?: string;
  table_token_digest?: string;
  items: unknown[];
  special_instructions?: unknown;
  status?: unknown;
  hasRawTableToken: boolean;
  hasTableIdField: boolean;
  hasTokenDigestField: boolean;
  hasInvalidTableBinding: boolean;
}

export interface OrderAttemptRestoreState {
  attempt: OrderAttempt | null;
  /** True when a valid saved attempt exists, but belongs to another route. */
  mismatch: boolean;
  /** A recognizable legacy record that must be explicitly abandoned. */
  legacy?: LegacyOrderAttemptRecovery;
}

const pendingOrderStoragePrefix = "altiora:pending-order:";
const sha256HexPattern = /^[0-9a-f]{64}$/i;

const sha256Constants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b,
  0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7,
  0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152,
  0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f,
  0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const sha256InitialHash = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

function rightRotate(value: number, amount: number) {
  return (value >>> amount) | (value << (32 - amount));
}

/** SHA-256 without a platform-specific or third-party dependency. */
function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const lengthOffset = paddedLength - 8;
  for (let index = 0; index < 8; index += 1) {
    padded[lengthOffset + index] = Math.floor(bitLength / 2 ** (56 - index * 8)) & 0xff;
  }

  const hash: number[] = [...sha256InitialHash];
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const byteOffset = offset + index * 4;
      schedule[index] =
        (padded[byteOffset] << 24) |
        (padded[byteOffset + 1] << 16) |
        (padded[byteOffset + 2] << 8) |
        padded[byteOffset + 3];
    }

    for (let index = 16; index < 64; index += 1) {
      const previous = schedule[index - 15];
      const secondPrevious = schedule[index - 2];
      const smallSigma0 =
        rightRotate(previous, 7) ^ rightRotate(previous, 18) ^ (previous >>> 3);
      const smallSigma1 =
        rightRotate(secondPrevious, 17) ^
        rightRotate(secondPrevious, 19) ^
        (secondPrevious >>> 10);
      schedule[index] =
        (schedule[index - 16] + smallSigma0 + schedule[index - 7] + smallSigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;

    for (let index = 0; index < 64; index += 1) {
      const bigSigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 =
        (h + bigSigma1 + choose + sha256Constants[index] + schedule[index]) >>> 0;
      const bigSigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (bigSigma0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return hash.map((value) => value.toString(16).padStart(8, "0")).join("");
}

export function normalizeTableToken(tableToken: string) {
  return tableToken.trim();
}

export function digestTableToken(tableToken: string) {
  return sha256Hex(normalizeTableToken(tableToken));
}

function normalizeStorageScope(restaurantSlug: string) {
  return restaurantSlug.trim();
}

function normalizeTableId(tableId: string) {
  return tableId.trim();
}

function tableBindingFor(tableToken: string, tableId?: string | null): OrderAttemptTableBinding {
  const normalizedTableId = typeof tableId === "string" ? normalizeTableId(tableId) : "";
  const tokenDigest = digestTableToken(tableToken);

  if (normalizedTableId) {
    return { kind: "table-id", value: normalizedTableId, tokenDigest };
  }

  return { kind: "token-digest", value: tokenDigest, tokenDigest };
}

function cloneOrderInput(input: CreateOrderInput): CreateOrderInput {
  return {
    restaurant_slug: input.restaurant_slug,
    table_token: input.table_token,
    items: input.items.map((item) => ({
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      ...(item.special_instructions !== undefined
        ? { special_instructions: item.special_instructions }
        : {}),
    })),
    ...(input.special_instructions !== undefined
      ? { special_instructions: input.special_instructions }
      : {}),
  };
}

function pendingOrderStorageScopePrefix(restaurantSlug: string) {
  return `${pendingOrderStoragePrefix}${encodeURIComponent(normalizeStorageScope(restaurantSlug))}`;
}

function pendingOrderBindingKey(binding: OrderAttemptTableBinding) {
  return encodeURIComponent(
    `${binding.kind}:${binding.value}:${binding.tokenDigest}`,
  );
}

export function pendingOrderStorageKey(
  restaurantSlug: string,
  tableBinding?: OrderAttemptTableBinding,
) {
  const scopePrefix = pendingOrderStorageScopePrefix(restaurantSlug);
  return tableBinding
    ? `${scopePrefix}:${pendingOrderBindingKey(tableBinding)}`
    : scopePrefix;
}

export function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    throw new Error("Secure random UUID generation is unavailable");
  }

  return globalThis.crypto.randomUUID();
}

export function createOrderAttempt(
  input: CreateOrderInput,
  tableId?: string | null,
): OrderAttempt {
  return {
    idempotencyKey: createIdempotencyKey(),
    input: cloneOrderInput(input),
    status: "active",
    storageScope: normalizeStorageScope(input.restaurant_slug),
    tableBinding: tableBindingFor(input.table_token, tableId),
  };
}

export function markOrderAttemptUncertain(
  attempt: OrderAttempt,
): OrderAttempt {
  return {
    ...attempt,
    status: "uncertain",
  };
}

export function markOrderAttemptConflict(
  attempt: OrderAttempt,
): OrderAttempt {
  return {
    ...attempt,
    status: "conflict",
  };
}

function persistedBinding(attempt: OrderAttempt): Pick<
  PersistedOrderAttempt,
  "table_id" | "table_token_digest"
> {
  if (attempt.tableBinding.kind === "table-id") {
    return {
      table_id: attempt.tableBinding.value,
      table_token_digest: attempt.tableBinding.tokenDigest,
    };
  }

  return { table_token_digest: attempt.tableBinding.tokenDigest };
}

/**
 * The raw table token is deliberately omitted. A public table id is stored
 * when available; otherwise only a SHA-256 digest of its normalized value is
 * persisted so a different table cannot adopt the saved payload.
 */
export function serializeOrderAttempt(attempt: OrderAttempt) {
  const persisted: PersistedOrderAttempt = {
    version: 3,
    idempotency_key: attempt.idempotencyKey,
    restaurant_slug: attempt.storageScope || normalizeStorageScope(attempt.input.restaurant_slug),
    ...persistedBinding(attempt),
    items: attempt.input.items.map((item) => ({
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      ...(item.special_instructions !== undefined
        ? { special_instructions: item.special_instructions }
        : {}),
    })),
    ...(attempt.input.special_instructions !== undefined
      ? { special_instructions: attempt.input.special_instructions }
      : {}),
    status: attempt.status,
  };

  return JSON.stringify(persisted);
}

function parsePersistedRecord(serialized: string): PersistedOrderAttempt | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { version?: unknown }).version !== 3
  ) {
    return null;
  }

  const record = parsed as Partial<PersistedOrderAttempt>;
  const tableId = typeof record.table_id === "string" ? normalizeTableId(record.table_id) : "";
  const tableTokenDigest =
    typeof record.table_token_digest === "string" ? record.table_token_digest.toLowerCase() : "";
  const hasTableId = tableId.length > 0;
  const hasTokenDigest = sha256HexPattern.test(tableTokenDigest);

  if (
    typeof record.idempotency_key !== "string" ||
    !parseIdempotencyKey(record.idempotency_key).success ||
    typeof record.restaurant_slug !== "string" ||
    !Array.isArray(record.items) ||
    (record.status !== undefined &&
      record.status !== "active" &&
      record.status !== "uncertain" &&
      record.status !== "conflict") ||
    !hasTokenDigest
  ) {
    return null;
  }

  return {
    version: 3,
    idempotency_key: record.idempotency_key,
    restaurant_slug: normalizeStorageScope(record.restaurant_slug),
    ...(hasTableId ? { table_id: tableId } : {}),
    table_token_digest: tableTokenDigest,
    items: record.items,
    ...(record.special_instructions !== undefined
      ? { special_instructions: record.special_instructions }
      : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
  };
}

function parseLegacyPersistedRecord(serialized: string): LegacyPersistedOrderAttempt | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as {
    version?: unknown;
    idempotency_key?: unknown;
    restaurant_slug?: unknown;
    table_id?: unknown;
    table_token_digest?: unknown;
    table_token?: unknown;
    items?: unknown;
    special_instructions?: unknown;
    status?: unknown;
  };

  if (record.version !== 1 && record.version !== 2) {
    return null;
  }

  const idempotencyKey =
    typeof record.idempotency_key === "string" &&
    parseIdempotencyKey(record.idempotency_key).success
      ? record.idempotency_key
      : null;
  const restaurantSlug =
    typeof record.restaurant_slug === "string"
      ? normalizeStorageScope(record.restaurant_slug)
      : "";
  const tableId =
    typeof record.table_id === "string" ? normalizeTableId(record.table_id) : "";
  const tableTokenDigest =
    typeof record.table_token_digest === "string"
      ? record.table_token_digest.toLowerCase()
      : "";
  const hasTableIdField = Object.prototype.hasOwnProperty.call(record, "table_id");
  const hasTokenDigestField = Object.prototype.hasOwnProperty.call(
    record,
    "table_token_digest",
  );
  const hasInvalidTableBinding =
    (hasTableIdField &&
      (typeof record.table_id !== "string" ||
        (typeof record.table_id === "string" && !tableId))) ||
    (hasTokenDigestField &&
      (typeof record.table_token_digest !== "string" ||
        (typeof record.table_token_digest === "string" &&
          (!tableTokenDigest || !sha256HexPattern.test(tableTokenDigest)))));

  if (
    typeof record.restaurant_slug !== "string" ||
    !Array.isArray(record.items)
  ) {
    return null;
  }

  return {
    version: record.version,
    idempotency_key: idempotencyKey,
    restaurant_slug: restaurantSlug,
    ...(tableId ? { table_id: tableId } : {}),
    ...(tableTokenDigest ? { table_token_digest: tableTokenDigest } : {}),
    items: record.items,
    ...(record.special_instructions !== undefined
      ? { special_instructions: record.special_instructions }
      : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
    hasRawTableToken: typeof record.table_token === "string",
    hasTableIdField,
    hasTokenDigestField,
    hasInvalidTableBinding,
  };
}

function legacyRecoveryMessage(reason: LegacyOrderAttemptRecoveryReason) {
  const safetyReminder =
    "Please verify with restaurant staff before starting another order.";

  switch (reason) {
    case "missing-table-binding":
      return `We found an older saved checkout without its original table binding. ${safetyReminder} Return to the original table link if you have it, or explicitly start over to remove it.`;
    case "missing-token-digest":
      return `We found an older saved checkout without a verifiable table token. ${safetyReminder} Return to the original table link if you have it, or explicitly start over to remove it.`;
    case "invalid-table-binding":
      return `We found an older saved checkout with an invalid table binding. ${safetyReminder} Return to the original table link if you have it, or explicitly start over to remove it.`;
    case "raw-table-token":
      return `We found an older saved checkout that cannot be resumed safely. ${safetyReminder} Return to the original table link if you have it, or explicitly start over to remove it.`;
    case "invalid-request-identity":
      return `We found an older saved checkout without a valid request identity. ${safetyReminder} Return to the original table link if you have it, or explicitly start over to remove it.`;
    case "invalid-payload":
      return `We found an older saved checkout with invalid order details. ${safetyReminder} Return to the original table link if you have it, or explicitly start over to remove it.`;
  }
}

function createLegacyRecovery(
  record: LegacyPersistedOrderAttempt,
  reason: LegacyOrderAttemptRecoveryReason,
) {
  return {
    kind: "legacy" as const,
    version: record.version,
    idempotencyKey: record.idempotency_key,
    restaurantSlug: record.restaurant_slug,
    reason,
    message: legacyRecoveryMessage(reason),
  } satisfies LegacyOrderAttemptRecovery;
}

interface ParsedOrderAttempt {
  attempt: OrderAttempt;
  matchesRoute: boolean;
}

interface ParsedLegacyOrderAttempt {
  attempt: OrderAttempt | null;
  matchesRoute: boolean;
  recovery?: LegacyOrderAttemptRecovery;
}

function parseOrderAttemptForRoute(
  serialized: string,
  tableToken: string,
  tableId?: string | null,
  restaurantSlug?: string,
): ParsedOrderAttempt | null {
  const record = parsePersistedRecord(serialized);
  if (!record) {
    return null;
  }

  const candidate = {
    restaurant_slug: record.restaurant_slug,
    table_token: normalizeTableToken(tableToken),
    items: record.items,
    ...(record.special_instructions !== undefined
      ? { special_instructions: record.special_instructions }
      : {}),
  };
  const result = parseCreateOrderInput(candidate);

  if (!result.success) {
    return null;
  }

  const normalizedInput = normalizeCreateOrderInput(result.data);
  const restoredInput: CreateOrderInput = {
    restaurant_slug: normalizedInput.restaurant_slug,
    table_token: normalizeTableToken(tableToken),
    items: normalizedInput.items.map((item, index) => ({
      menu_item_id: item.menu_item_id,
      quantity: item.quantity,
      ...(record.items[index].special_instructions !== undefined
        ? { special_instructions: record.items[index].special_instructions }
        : {}),
    })),
    ...(record.special_instructions !== undefined
      ? { special_instructions: record.special_instructions }
      : {}),
  };

  const tableBinding: OrderAttemptTableBinding = record.table_id
    ? {
        kind: "table-id",
        value: record.table_id,
        tokenDigest: record.table_token_digest,
      }
    : {
        kind: "token-digest",
        value: record.table_token_digest,
        tokenDigest: record.table_token_digest,
      };
  const routeMatchesTable =
    digestTableToken(tableToken) === tableBinding.tokenDigest &&
    (tableBinding.kind === "table-id"
      ? typeof tableId === "string" && normalizeTableId(tableId) === tableBinding.value
      : true);
  const routeMatchesRestaurant =
    restaurantSlug === undefined ||
    normalizeStorageScope(restaurantSlug) === record.restaurant_slug;

  return {
    attempt: {
      idempotencyKey: record.idempotency_key,
      input: cloneOrderInput(restoredInput),
      // A reload can happen while the original request is still in flight, so
      // active attempts become uncertain. A confirmed conflict remains blocked
      // after reload and must be explicitly abandoned before a new key is used.
      status: record.status === "conflict" ? "conflict" : "uncertain",
      storageScope: record.restaurant_slug,
      tableBinding,
    },
    matchesRoute: routeMatchesRestaurant && routeMatchesTable,
  };
}

function itemSpecialInstructions(item: unknown) {
  if (!item || typeof item !== "object") {
    return undefined;
  }

  const value = (item as { special_instructions?: unknown }).special_instructions;
  return value;
}

function parseLegacyOrderAttemptForRoute(
  serialized: string,
  tableToken: string,
  tableId?: string | null,
  restaurantSlug?: string,
): ParsedLegacyOrderAttempt | null {
  const record = parseLegacyPersistedRecord(serialized);
  if (!record) {
    return null;
  }

  const routeMatchesRestaurant =
    restaurantSlug === undefined ||
    normalizeStorageScope(restaurantSlug) === record.restaurant_slug;
  const hasTokenDigest =
    typeof record.table_token_digest === "string" &&
    sha256HexPattern.test(record.table_token_digest);
  const hasTableId = Boolean(record.table_id);
  const routeMatchesTableId =
    !hasTableId ||
    (typeof tableId === "string" &&
      normalizeTableId(tableId) === record.table_id);
  const routeMatchesTokenDigest =
    !hasTokenDigest ||
    digestTableToken(tableToken) === record.table_token_digest;
  const matchesRoute =
    routeMatchesRestaurant && routeMatchesTableId && routeMatchesTokenDigest;

  let unsafeReason: LegacyOrderAttemptRecoveryReason | null = null;
  if (record.hasRawTableToken) {
    unsafeReason = "raw-table-token";
  } else if (record.hasInvalidTableBinding) {
    unsafeReason = "invalid-table-binding";
  } else if (record.idempotency_key === null) {
    unsafeReason = "invalid-request-identity";
  } else if (record.version === 1) {
    // v1 did not bind a saved request to a table at all.
    unsafeReason = "missing-table-binding";
  } else if (!record.hasTokenDigestField || !hasTokenDigest) {
    // A table id identifies a public table, but does not prove that the
    // current secret token is the token used by the original request.
    unsafeReason = record.hasTableIdField
      ? "missing-token-digest"
      : "missing-table-binding";
  }

  if (unsafeReason) {
    return {
      attempt: null,
      matchesRoute,
      recovery: createLegacyRecovery(record, unsafeReason),
    };
  }

  if (
    record.status !== undefined &&
    record.status !== "active" &&
    record.status !== "uncertain" &&
    record.status !== "conflict"
  ) {
    return {
      attempt: null,
      matchesRoute,
      recovery: createLegacyRecovery(record, "invalid-payload"),
    };
  }

  // A valid digest is enough to prove the secret-token part of the request
  // identity. Do not parse or restore a v2 record for another route.
  if (!matchesRoute) {
    return { attempt: null, matchesRoute };
  }

  const candidate = {
    restaurant_slug: record.restaurant_slug,
    table_token: normalizeTableToken(tableToken),
    items: record.items,
    ...(record.special_instructions !== undefined
      ? { special_instructions: record.special_instructions }
      : {}),
  };
  const result = parseCreateOrderInput(candidate);

  if (!result.success) {
    return {
      attempt: null,
      matchesRoute: true,
      recovery: createLegacyRecovery(record, "invalid-payload"),
    };
  }

  const normalizedInput = normalizeCreateOrderInput(result.data);
  const restoredInput: CreateOrderInput = {
    restaurant_slug: normalizedInput.restaurant_slug,
    table_token: normalizeTableToken(tableToken),
    items: normalizedInput.items.map((item, index) => {
      const specialInstructions = itemSpecialInstructions(record.items[index]);
      return {
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        ...(specialInstructions !== undefined
          ? { special_instructions: specialInstructions as string }
          : {}),
      };
    }),
    ...(record.special_instructions !== undefined
      ? { special_instructions: record.special_instructions as string }
      : {}),
  };
  const tableBinding: OrderAttemptTableBinding = record.table_id
    ? {
        kind: "table-id",
        value: record.table_id,
        tokenDigest: record.table_token_digest!,
      }
    : {
        kind: "token-digest",
        value: record.table_token_digest!,
        tokenDigest: record.table_token_digest!,
      };

  return {
    attempt: {
      idempotencyKey: record.idempotency_key!,
      input: cloneOrderInput(restoredInput),
      status: record.status === "conflict" ? "conflict" : "uncertain",
      storageScope: record.restaurant_slug,
      tableBinding,
    },
    matchesRoute: true,
  };
}

function getSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

interface SerializedOrderAttemptEntry {
  key: string;
  serialized: string;
}

interface LegacyRecoveryHandle {
  key: string;
  serializedDigest: string;
}

const legacyRecoveryHandles = new WeakMap<
  LegacyOrderAttemptRecovery,
  LegacyRecoveryHandle
>();

function readSerializedOrderAttempts(storageScope: string) {
  const storage = getSessionStorage();
  if (!storage) {
    return [];
  }

  const scopePrefix = `${pendingOrderStorageScopePrefix(storageScope)}:`;
  const legacyKey = pendingOrderStorageKey(storageScope);
  const serializedAttempts: SerializedOrderAttemptEntry[] = [];

  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key !== legacyKey && !key?.startsWith(scopePrefix)) {
        continue;
      }

      const serialized = storage.getItem(key);
      if (serialized) {
        serializedAttempts.push({ key, serialized });
      }
    }
  } catch {
    return [];
  }

  return serializedAttempts;
}

export function saveOrderAttempt(attempt: OrderAttempt) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      pendingOrderStorageKey(
        attempt.storageScope || attempt.input.restaurant_slug,
        attempt.tableBinding,
      ),
      serializeOrderAttempt(attempt),
    );
  } catch {
    // A full or unavailable session store should not prevent an in-memory
    // retry with the same key and payload.
  }
}

export function restoreOrderAttemptState(
  restaurantSlug: string,
  tableToken: string,
  tableId?: string | null,
): OrderAttemptRestoreState {
  const serializedAttempts = readSerializedOrderAttempts(restaurantSlug);
  if (serializedAttempts.length === 0) {
    return { attempt: null, mismatch: false };
  }

  let mismatch = false;
  let legacy: LegacyOrderAttemptRecovery | undefined;
  for (const entry of serializedAttempts) {
    const { key, serialized } = entry;
    const parsed = parseOrderAttemptForRoute(
      serialized,
      tableToken,
      tableId,
      restaurantSlug,
    );
    if (!parsed) {
      continue;
    }

    if (parsed.matchesRoute) {
      return { attempt: parsed.attempt, mismatch: false };
    }

    mismatch = true;

    continue;
  }

  for (const entry of serializedAttempts) {
    const { key, serialized } = entry;
    const parsed = parseLegacyOrderAttemptForRoute(
      serialized,
      tableToken,
      tableId,
      restaurantSlug,
    );
    if (!parsed) {
      continue;
    }

    if (parsed.recovery) {
      legacyRecoveryHandles.set(parsed.recovery, {
        key,
        serializedDigest: sha256Hex(serialized),
      });
      legacy ??= parsed.recovery;
    }

    if (parsed.attempt && parsed.matchesRoute) {
      return { attempt: parsed.attempt, mismatch: false };
    }

    if (!parsed.matchesRoute) {
      mismatch = true;
    }
  }

  return legacy
    ? { attempt: null, mismatch, legacy }
    : { attempt: null, mismatch };
}

export function restoreOrderAttempt(
  restaurantSlug: string,
  tableToken: string,
  tableId?: string | null,
): OrderAttempt | null {
  return restoreOrderAttemptState(restaurantSlug, tableToken, tableId).attempt;
}

export function isOrderAttemptForRoute(
  attempt: OrderAttempt,
  restaurantSlug: string,
  tableToken: string,
  tableId?: string | null,
) {
  const matchesRestaurant =
    normalizeStorageScope(restaurantSlug) ===
    (attempt.storageScope || normalizeStorageScope(attempt.input.restaurant_slug));
  const matchesTable =
    digestTableToken(tableToken) === attempt.tableBinding.tokenDigest &&
    (attempt.tableBinding.kind === "table-id"
      ? typeof tableId === "string" && normalizeTableId(tableId) === attempt.tableBinding.value
      : true);

  return matchesRestaurant && matchesTable;
}

export function deserializeOrderAttempt(
  serialized: string,
  tableToken: string,
  tableId?: string | null,
  restaurantSlug?: string,
): OrderAttempt | null {
  const parsed = parseOrderAttemptForRoute(
    serialized,
    tableToken,
    tableId,
    restaurantSlug,
  );

  if (parsed?.matchesRoute) {
    return parsed.attempt;
  }

  const legacy = parseLegacyOrderAttemptForRoute(
    serialized,
    tableToken,
    tableId,
    restaurantSlug,
  );

  return legacy?.matchesRoute ? legacy.attempt : null;
}

type ClearOrderAttemptTarget =
  | string
  | OrderAttempt
  | LegacyOrderAttemptRecovery;

function isLegacyRecovery(
  value: ClearOrderAttemptTarget,
): value is LegacyOrderAttemptRecovery {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "legacy"
  );
}

function removeLegacyRecovery(
  storage: Storage,
  recovery: LegacyOrderAttemptRecovery,
) {
  const handle = legacyRecoveryHandles.get(recovery);
  if (!handle) {
    return;
  }

  const serialized = storage.getItem(handle.key);
  if (serialized && sha256Hex(serialized) === handle.serializedDigest) {
    storage.removeItem(handle.key);
  }
}

function removeLegacyRecordsForAttempt(
  storage: Storage,
  storageScope: string,
  idempotencyKey: string,
) {
  const normalizedScope = normalizeStorageScope(storageScope);
  for (const entry of readSerializedOrderAttempts(normalizedScope)) {
    const record = parseLegacyPersistedRecord(entry.serialized);
    if (
      record &&
      record.idempotency_key === idempotencyKey &&
      record.restaurant_slug === normalizedScope
    ) {
      storage.removeItem(entry.key);
    }
  }
}

export function clearOrderAttempt(storageScope: ClearOrderAttemptTarget) {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  if (isLegacyRecovery(storageScope)) {
    try {
      removeLegacyRecovery(storage, storageScope);
    } catch {
      // Best effort only; the in-memory attempt is still cleared by the caller.
    }
    return;
  }

  try {
    if (typeof storageScope === "string") {
      // Keep the original scope-only removal behavior for callers that do not
      // have an in-memory attempt. Also remove any recognizable legacy entries
      // under this restaurant scope, but never remove a v3 entry for another
      // table.
      const scope = storageScope;
      storage.removeItem(pendingOrderStorageKey(scope));
      for (const entry of readSerializedOrderAttempts(scope)) {
        if (parseLegacyPersistedRecord(entry.serialized)) {
          storage.removeItem(entry.key);
        }
      }
      return;
    }

    const scope = storageScope.storageScope;
    const expectedIdempotencyKey = storageScope.idempotencyKey;
    const key = pendingOrderStorageKey(scope, storageScope.tableBinding);
    const serialized = storage.getItem(key);
    if (serialized) {
      const record = parsePersistedRecord(serialized);
      if (record) {
        if (record.idempotency_key !== expectedIdempotencyKey) {
          return;
        }
        storage.removeItem(key);
      } else {
        const legacyRecord = parseLegacyPersistedRecord(serialized);
        if (
          !legacyRecord ||
          legacyRecord.idempotency_key !== expectedIdempotencyKey
        ) {
          return;
        }
        storage.removeItem(key);
      }
    }

    removeLegacyRecordsForAttempt(storage, scope, expectedIdempotencyKey);
  } catch {
    // Best effort only; the in-memory attempt is still cleared by the caller.
  }
}

/** Explicitly abandons either a restored attempt or a recoverable legacy record. */
export function abandonOrderAttempt(target: ClearOrderAttemptTarget) {
  clearOrderAttempt(target);
}
