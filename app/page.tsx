import Link from "next/link";
import { Icon } from "@/components/icon";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen items-center overflow-hidden px-4 py-12 sm:px-6">
      <div className="customer-ambient" />
      <section className="glass-panel relative mx-auto w-full max-w-3xl px-6 py-12 text-center sm:px-12 sm:py-16">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-sage text-white shadow-soft">
          <Icon name="sparkles" size={25} />
        </span>
        <p className="eyebrow mt-7">Altiora</p>
        <h1 className="mt-3 font-display text-5xl leading-tight text-ink sm:text-7xl">Make room for good things.</h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
          A warm, table-side ordering experience for restaurants that care about every detail.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link className="button-primary" href="/kitchen">
            Open staff dashboard
            <Icon name="arrow-right" size={17} />
          </Link>
          <p className="rounded-full border border-ink/10 bg-white/45 px-4 py-3 text-xs text-muted">Guest menus open from a table QR link.</p>
        </div>
      </section>
    </main>
  );
}
