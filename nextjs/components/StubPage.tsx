import Link from "next/link";

/** Shared placeholder for routes that ship next (vaults / account / prizes). */
export function StubPage({ route, blurb }: { route: string; blurb: string }) {
  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center bg-void px-6 text-ghost">
      <p className="font-data text-xs tracking-[0.3em] text-cipher">
        {"// "}
        {route.toUpperCase()}
      </p>
      <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">
        <span className="text-vault">$</span> module under construction
      </h1>
      <p className="mt-4 max-w-md text-center text-sm leading-relaxed text-ghost/60">{blurb}</p>
      <Link
        href="/"
        className="mt-8 border border-static/70 px-5 py-2.5 font-data text-xs tracking-widest text-ghost/70 transition-colors hover:border-vault hover:text-vault"
      >
        {"< "}back_to_landing
      </Link>
    </main>
  );
}
