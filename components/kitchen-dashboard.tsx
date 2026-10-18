"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/feedback";
import { Icon } from "@/components/icon";
import {
  DataRequestError,
  getKitchenDashboard,
  type KitchenDashboardData,
  type KitchenOrder,
  type KitchenOrderStatus,
  updateOrderStatus,
} from "@/lib/data";

type DashboardMode = "kitchen" | "reception";
type LoadStatus = "loading" | "ready" | "error";

const statusMeta: Record<KitchenOrderStatus, { label: string; className: string }> = {
  new: { label: "New", className: "status-new" },
  preparing: { label: "In preparation", className: "status-preparing" },
  ready: { label: "Ready", className: "status-ready" },
  completed: { label: "Completed", className: "status-completed" },
};

function formatCurrency(value: number, currency = "USD") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      currencyDisplay: "code",
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Live data";
  }
  return `Updated ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date)}`;
}

function StatusBadge({ status }: { status: KitchenOrderStatus }) {
  const meta = statusMeta[status] || statusMeta.new;
  return <span className={`status-badge ${meta.className}`}>{meta.label}</span>;
}

const statusOptions: Array<{ value: KitchenOrderStatus; label: string }> = [
  { value: "new", label: "New" },
  { value: "preparing", label: "In preparation" },
  { value: "ready", label: "Ready" },
  { value: "completed", label: "Completed" },
];

function staffErrorMessage(error: unknown, fallback: string) {
  if (error instanceof DataRequestError) {
    if (error.status === 401) {
      return "Your staff session has expired. Sign in again to continue.";
    }
    if (error.status === 403) {
      return "Your staff account does not have permission to change orders.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : fallback;
}

function OrderStatusControl({
  idPrefix,
  order,
  updating,
  onChange,
}: {
  idPrefix: string;
  order: KitchenOrder;
  updating: boolean;
  onChange: (status: KitchenOrderStatus) => void;
}) {
  return (
    <div className="flex min-w-[9.5rem] flex-col items-start gap-2">
      <StatusBadge status={order.status} />
      <label className="sr-only" htmlFor={`${idPrefix}-${order.id}`}>
        Update status for order #{order.orderNumber}
      </label>
      <div className="relative w-full">
        <select
          aria-label={`Update status for order #${order.orderNumber}`}
          className="select-control status-select w-full"
          disabled={updating}
          id={`${idPrefix}-${order.id}`}
          onChange={(event) => onChange(event.target.value as KitchenOrderStatus)}
          value={order.status}
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {updating ? <span aria-hidden="true" className="status-control-spinner motion-reduce:animate-none" /> : null}
      </div>
    </div>
  );
}

function DashboardHeader({ mode, restaurantName }: { mode: DashboardMode; restaurantName?: string }) {
  return (
    <header className="border-b border-ink/10 bg-ivory/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="staff-mark"><Icon name="utensils" size={20} /></div>
          <div className="min-w-0">
            <p className="truncate font-display text-lg text-ink sm:text-xl">{restaurantName || "Altiora operations"}</p>
            <p className="truncate text-xs uppercase tracking-[0.15em] text-muted">{mode === "kitchen" ? "Kitchen command" : "Reception desk"}</p>
          </div>
        </div>
        <div className="staff-lock-badge">
          <Icon name="lock" size={14} />
          <span className="hidden sm:inline">Staff only</span>
          <span className="sm:hidden">Staff</span>
        </div>
      </div>
    </header>
  );
}

function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string | number;
  detail: string;
  icon: "sparkles" | "clock" | "check" | "shopping-bag";
}) {
  return (
    <article className="glass-panel flex items-start justify-between gap-4 p-5">
      <div>
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-3 font-display text-3xl text-ink">{value}</p>
        <p className="mt-1 text-xs text-muted">{detail}</p>
      </div>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sage/10 text-sage-dark">
        <Icon name={icon} size={19} />
      </span>
    </article>
  );
}

function OrderItems({ order }: { order: KitchenOrder }) {
  return (
    <div className="space-y-1 text-sm text-muted">
      {order.items.map((item, index) => (
        <p key={`${order.id}-${item.name}-${index}`}>
          <span className="font-semibold text-ink">{item.quantity}×</span> {item.name}
        </p>
      ))}
      {order.customerNote ? <p className="mt-2 border-l-2 border-amber/50 pl-2 text-xs italic text-amber">“{order.customerNote}”</p> : null}
    </div>
  );
}

function DesktopOrdersTable({
  currency,
  orders,
  onStatusChange,
  updatingOrderId,
}: {
  currency: string;
  orders: KitchenOrder[];
  onStatusChange: (orderId: string, status: KitchenOrderStatus) => void;
  updatingOrderId: string | null;
}) {
  return (
    <div className="hidden overflow-hidden rounded-3xl border border-ink/10 bg-white/40 md:block">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead className="border-b border-ink/10 bg-white/40 text-xs uppercase tracking-[0.13em] text-muted">
            <tr>
              <th className="px-5 py-4 font-semibold">Order</th>
              <th className="px-5 py-4 font-semibold">Table</th>
              <th className="px-5 py-4 font-semibold">Items</th>
              <th className="px-5 py-4 font-semibold">Status</th>
              <th className="px-5 py-4 text-right font-semibold">Total</th>
              <th className="px-5 py-4 text-right font-semibold">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink/10">
            {orders.map((order) => (
              <tr className="align-top transition-colors hover:bg-white/35" key={order.id}>
                <td className="whitespace-nowrap px-5 py-5 font-semibold text-ink">#{order.orderNumber}</td>
                <td className="whitespace-nowrap px-5 py-5 text-sm text-muted">{order.tableLabel}</td>
                <td className="max-w-[20rem] px-5 py-5"><OrderItems order={order} /></td>
                <td className="whitespace-nowrap px-5 py-5">
                  <OrderStatusControl
                    idPrefix="desktop-status"
                    onChange={(status) => onStatusChange(order.id, status)}
                    order={order}
                    updating={updatingOrderId === order.id}
                  />
                </td>
                <td className="whitespace-nowrap px-5 py-5 text-right text-sm font-semibold text-ink">
                  {formatCurrency(order.total, order.currency || currency)}
                </td>
                <td className="whitespace-nowrap px-5 py-5 text-right text-sm text-muted">{formatTime(order.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MobileOrdersList({
  currency,
  orders,
  onStatusChange,
  updatingOrderId,
}: {
  currency: string;
  orders: KitchenOrder[];
  onStatusChange: (orderId: string, status: KitchenOrderStatus) => void;
  updatingOrderId: string | null;
}) {
  return (
    <div className="space-y-3 md:hidden">
      {orders.map((order) => (
        <article className="glass-panel p-4" key={order.id}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-semibold text-ink">#{order.orderNumber}</p>
              <p className="mt-1 text-sm text-muted">{order.tableLabel} · {formatTime(order.createdAt)}</p>
            </div>
            <OrderStatusControl
              idPrefix="mobile-status"
              onChange={(status) => onStatusChange(order.id, status)}
              order={order}
              updating={updatingOrderId === order.id}
            />
          </div>
          <div className="mt-4 flex items-end justify-between gap-4 border-t border-ink/10 pt-4">
            <OrderItems order={order} />
            <p className="shrink-0 text-sm font-semibold text-ink">{formatCurrency(order.total, order.currency || currency)}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

export function KitchenDashboard({ mode = "kitchen" }: { mode?: DashboardMode }) {
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [data, setData] = useState<KitchenDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dashboardErrorStatus, setDashboardErrorStatus] = useState<number | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | KitchenOrderStatus>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);
  const hasLoadedData = useRef(false);

  const loadDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setStatus("loading");
    }
    setError(null);
    if (!isRefresh) {
      setDashboardErrorStatus(null);
    }
    try {
      const result = await getKitchenDashboard();
      setData(result);
      hasLoadedData.current = true;
      setStatus("ready");
      setDashboardErrorStatus(null);
      setRefreshError(null);
      setStatusError(null);
    } catch (requestError) {
      const message = staffErrorMessage(requestError, "The staff dashboard could not be loaded.");
      if (isRefresh && hasLoadedData.current) {
        setRefreshError(message);
      } else {
        setStatus("error");
        setDashboardErrorStatus(requestError instanceof DataRequestError ? requestError.status : null);
        setError(message);
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    const pollId = window.setInterval(() => {
      void loadDashboard(true);
    }, 30_000);

    return () => window.clearInterval(pollId);
  }, [loadDashboard]);

  const handleStatusChange = useCallback(async (orderId: string, nextStatus: KitchenOrderStatus) => {
    const previousOrder = data?.orders.find((order) => order.id === orderId);
    if (!previousOrder || previousOrder.status === nextStatus) {
      return;
    }

    setStatusError(null);
    setUpdatingOrderId(orderId);
    setData((current) =>
      current
        ? {
            ...current,
            orders: current.orders.map((order) =>
              order.id === orderId ? { ...order, status: nextStatus } : order,
            ),
          }
        : current,
    );

    try {
      await updateOrderStatus(orderId, nextStatus);
      await loadDashboard(true);
    } catch (requestError) {
      setData((current) =>
        current
          ? {
              ...current,
              orders: current.orders.map((order) =>
                order.id === orderId ? { ...order, status: previousOrder.status } : order,
              ),
            }
          : current,
      );
      setStatusError(staffErrorMessage(requestError, "The order status could not be updated."));
    } finally {
      setUpdatingOrderId(null);
    }
  }, [data, loadDashboard]);

  const visibleOrders = useMemo(() => {
    if (!data || filter === "all") {
      return data?.orders || [];
    }
    return data.orders.filter((order) => order.status === filter);
  }, [data, filter]);

  if (status === "loading") {
    return (
      <>
        <DashboardHeader mode={mode} />
        <LoadingState label="Loading live orders" />
      </>
    );
  }

  if (status === "error" || !data) {
    return (
      <>
        <DashboardHeader mode={mode} />
        <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
          <p className="eyebrow mb-3 text-center">Protected staff view</p>
          <ErrorState
            message={error || "A staff session may be required to see live orders."}
            onRetry={() => void loadDashboard()}
            title={
              dashboardErrorStatus === 401
                ? "Staff session required"
                : dashboardErrorStatus === 403
                  ? "Access not granted"
                  : "Dashboard unavailable"
            }
          />
        </main>
      </>
    );
  }

  const stats = data.stats || { newOrders: 0, inPreparation: 0, ready: 0, revenue: 0 };
  const dashboardCurrency = data.currency || data.orders.find((order) => order.currency)?.currency || "USD";

  return (
    <>
      <DashboardHeader mode={mode} restaurantName={data.restaurantName} />
      <main className="relative mx-auto max-w-[90rem] px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pt-12">
        <div className="dashboard-ambient" />
        <section className="relative mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="eyebrow">{mode === "kitchen" ? "Service at a glance" : "Front of house"}</p>
            <h1 className="mt-2 font-display text-4xl text-ink sm:text-5xl">Good shift, team.</h1>
            <p className="mt-3 text-sm leading-6 text-muted">Keep the room moving with a clear view of every table.</p>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span aria-live="polite" className="flex items-center gap-2 text-xs font-medium text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sage" />
              {refreshing ? "Refreshing live orders…" : `${formatUpdatedAt(data.updatedAt)} · Auto-refreshes every 30s`}
            </span>
            <button aria-label="Refresh dashboard" className="button-secondary px-3" disabled={refreshing} onClick={() => void loadDashboard(true)} type="button">
              <Icon className={`${refreshing ? "animate-spin " : ""}motion-reduce:animate-none`} name="refresh" size={16} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </section>

        <section aria-label="Order summary" className="relative grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard detail="Awaiting a first touch" icon="sparkles" label="New orders" value={stats.newOrders} />
          <StatCard detail="Currently on the pass" icon="clock" label="In preparation" value={stats.inPreparation} />
          <StatCard detail="Ready for the room" icon="check" label="Ready to serve" value={stats.ready} />
          <StatCard detail="Today, before service fees" icon="shopping-bag" label="Today's revenue" value={formatCurrency(stats.revenue, dashboardCurrency)} />
        </section>

        <section aria-labelledby="orders-title" className="relative mt-10">
          <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">Live queue</p>
              <h2 className="mt-1 font-display text-3xl text-ink" id="orders-title">Today&apos;s orders</h2>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted">
              <span className="sr-only">Filter orders by status</span>
              <select className="select-control" onChange={(event) => setFilter(event.target.value as "all" | KitchenOrderStatus)} value={filter}>
                <option value="all">All statuses</option>
                <option value="new">New</option>
                <option value="preparing">In preparation</option>
                <option value="ready">Ready</option>
                <option value="completed">Completed</option>
              </select>
              <span className="hidden text-xs sm:inline">{visibleOrders.length} shown</span>
            </label>
          </div>

          {statusError ? <p aria-live="assertive" className="status-update-error mb-4" role="alert">{statusError}</p> : null}
          {refreshError ? <p aria-live="polite" className="refresh-error mb-4">{refreshError} We&apos;ll keep trying to refresh.</p> : null}

          {data.orders.length === 0 ? (
            <EmptyState
              message="New table orders will appear here as soon as guests start exploring the menu."
              title="The queue is clear"
              icon="shopping-bag"
            />
          ) : visibleOrders.length === 0 ? (
            <EmptyState message="There are no orders with this status right now." title="Nothing matches this filter" icon="sparkles" />
          ) : (
            <>
              <DesktopOrdersTable
                currency={dashboardCurrency}
                onStatusChange={handleStatusChange}
                orders={visibleOrders}
                updatingOrderId={updatingOrderId}
              />
              <MobileOrdersList
                currency={dashboardCurrency}
                onStatusChange={handleStatusChange}
                orders={visibleOrders}
                updatingOrderId={updatingOrderId}
              />
            </>
          )}
        </section>
      </main>
    </>
  );
}
