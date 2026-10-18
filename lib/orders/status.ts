export type DatabaseOrderStatus = "NEW" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";

const allowedTransitions: Record<DatabaseOrderStatus, readonly DatabaseOrderStatus[]> = {
  NEW: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED", "CANCELLED"],
  SERVED: [],
  CANCELLED: [],
};

/** Keeps staff status changes monotonic while allowing an idempotent update. */
export function canTransitionOrderStatus(
  current: DatabaseOrderStatus,
  next: DatabaseOrderStatus,
): boolean {
  return current === next || allowedTransitions[current].includes(next);
}
