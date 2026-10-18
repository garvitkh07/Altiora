import { Icon } from "@/components/icon";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div aria-live="polite" className="flex min-h-[28rem] flex-col items-center justify-center gap-4 text-muted">
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full border border-sage/25 bg-white/60">
        <span className="absolute h-12 w-12 animate-spin rounded-full border-2 border-transparent border-t-sage" />
        <Icon name="utensils" size={21} />
      </span>
      <p className="text-sm font-medium">{label}…</p>
    </div>
  );
}

export function ErrorState({
  title = "We could not load this right now",
  message = "Please try again in a moment.",
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="glass-panel mx-auto flex min-h-[22rem] max-w-xl flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-clay/10 text-clay">
        <Icon name="alert" size={22} />
      </span>
      <div>
        <h2 className="font-display text-2xl text-ink">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
      </div>
      {onRetry ? (
        <button className="button-secondary" onClick={onRetry} type="button">
          <Icon name="refresh" size={17} />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  icon = "sparkles",
}: {
  title: string;
  message: string;
  icon?: "sparkles" | "shopping-bag" | "utensils";
}) {
  return (
    <div className="glass-panel flex min-h-[18rem] flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber/10 text-amber">
        <Icon name={icon} size={22} />
      </span>
      <div>
        <h2 className="font-display text-2xl text-ink">{title}</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted">{message}</p>
      </div>
    </div>
  );
}
