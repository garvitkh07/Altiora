import Link from "next/link";
import { Icon } from "@/components/icon";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section className="glass-panel max-w-lg px-6 py-12 text-center sm:px-12">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber/10 text-amber">
          <Icon name="alert" size={22} />
        </span>
        <p className="eyebrow mt-6">Nothing on this table</p>
        <h1 className="mt-2 font-display text-4xl text-ink">That link has wandered off.</h1>
        <p className="mt-4 text-sm leading-6 text-muted">Ask your server for a fresh menu link, or return to the Altiora welcome page.</p>
        <Link className="button-secondary mt-7" href="/">
          Back to welcome
          <Icon name="arrow-right" size={17} />
        </Link>
      </section>
    </main>
  );
}
