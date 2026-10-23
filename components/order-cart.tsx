"use client";

import { Icon } from "@/components/icon";

export interface CartLine {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

interface OrderCartProps {
  items: CartLine[];
  itemCount: number;
  subtotal: number;
  currency: string;
  tableLabel: string;
  submitting?: boolean;
  attemptFrozen?: boolean;
  attemptConflict?: boolean;
  recoveryBlocked?: boolean;
  submitError?: string | null;
  specialInstructions?: string;
  onQuantityChange: (id: string, quantity: number) => void;
  onSpecialInstructionsChange: (value: string) => void;
  onSubmit: () => void;
  onAbandonAttempt?: () => void;
  headingId?: string;
}

function formatPrice(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function OrderCart({
  items,
  itemCount,
  subtotal,
  currency,
  tableLabel,
  submitting = false,
  attemptFrozen = false,
  attemptConflict = false,
  recoveryBlocked = false,
  submitError,
  specialInstructions = "",
  onQuantityChange,
  onSpecialInstructionsChange,
  onSubmit,
  onAbandonAttempt,
  headingId = "cart-title",
}: OrderCartProps) {
  return (
    <section aria-labelledby={headingId} className="glass-panel flex flex-col overflow-hidden">
      <div className="border-b border-ink/10 px-5 py-5 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="eyebrow">Your order</p>
            <h2 className="mt-1 font-display text-2xl text-ink" id={headingId}>
              Table {tableLabel}
            </h2>
          </div>
          <span className="flex h-10 min-w-10 items-center justify-center rounded-full bg-sage/10 px-3 text-sm font-semibold text-sage-dark">
            {itemCount}
          </span>
        </div>
      </div>

      <div className="max-h-[28rem] flex-1 overflow-y-auto px-5 py-3 sm:px-6">
        {items.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-muted">
            <Icon name="shopping-bag" size={24} />
            <div>
              <p className="font-medium text-ink">Your cart is ready</p>
              <p className="mt-1 text-sm">Add a dish to start your order.</p>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-ink/10">
            {items.map((item) => (
              <li className="flex gap-3 py-4 first:pt-3 last:pb-4" key={item.id}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
                  <p className="mt-1 text-sm text-muted">{formatPrice(item.price, currency)}</p>
                </div>
                <div className="flex h-9 items-center gap-2 rounded-full border border-ink/10 bg-white/50 px-1">
                  <button
                    aria-label={`Remove one ${item.name}`}
                    className="icon-button"
                    disabled={submitting || attemptFrozen || recoveryBlocked}
                    onClick={() => onQuantityChange(item.id, item.quantity - 1)}
                    type="button"
                  >
                    <Icon name="minus" size={15} />
                  </button>
                  <span aria-live="polite" className="w-4 text-center text-sm font-semibold text-ink">
                    {item.quantity}
                  </span>
                  <button
                    aria-label={`Add one ${item.name}`}
                    className="icon-button"
                    disabled={submitting || attemptFrozen || recoveryBlocked}
                    onClick={() => onQuantityChange(item.id, item.quantity + 1)}
                    type="button"
                  >
                    <Icon name="plus" size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-ink/10 bg-white/30 px-5 py-5 sm:px-6">
        {submitError ? (
          <div className="mb-3 rounded-xl bg-clay/10 px-3 py-2 text-sm leading-5 text-clay">
            <p aria-live="assertive">{submitError}</p>
            {(attemptFrozen || recoveryBlocked) && onAbandonAttempt ? (
              <button
                className="mt-2 text-xs font-semibold underline underline-offset-2"
                disabled={submitting}
                onClick={onAbandonAttempt}
                type="button"
              >
                Start over and edit order
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="flex items-center justify-between text-sm text-muted">
          <span>Subtotal</span>
          <span className="font-semibold text-ink">{formatPrice(subtotal, currency)}</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted">Taxes and service charges are confirmed at the table.</p>
        {items.length > 0 ? (
          <div className="mt-4">
            <label className="mb-2 flex items-center justify-between gap-3 text-sm font-semibold text-ink" htmlFor={`${headingId}-instructions`}>
              <span>Special instructions</span>
              <span className="text-xs font-normal text-muted">Optional</span>
            </label>
            <textarea
              aria-describedby={`${headingId}-instructions-count`}
              className="text-area-control"
              disabled={submitting || attemptFrozen || recoveryBlocked}
              id={`${headingId}-instructions`}
              maxLength={500}
              onChange={(event) => onSpecialInstructionsChange(event.target.value)}
              placeholder="Allergies, preferences, or a note for the team"
              rows={3}
              value={specialInstructions}
            />
            <p className="mt-1 text-right text-[0.68rem] text-muted" id={`${headingId}-instructions-count`}>
              {specialInstructions.length}/500
            </p>
          </div>
        ) : null}
        <button
          className="button-primary mt-4 w-full"
          disabled={
            (items.length === 0 && !attemptFrozen) ||
            submitting ||
            attemptConflict ||
            recoveryBlocked
          }
          onClick={onSubmit}
          type="button"
        >
          {submitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Sending order…
            </>
          ) : (
            <>
              {recoveryBlocked
                ? "Start over to continue"
                : attemptConflict
                ? "Start over to retry"
                : attemptFrozen
                  ? "Retry saved order"
                  : "Place order"}
              <Icon name="arrow-right" size={17} />
            </>
          )}
        </button>
      </div>
    </section>
  );
}
