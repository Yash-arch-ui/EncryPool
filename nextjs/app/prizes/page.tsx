"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";

export default function PrizesPage() {
  const { draws, nextDrawAtMs, isLoading } = useDrawHistory();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-16 lg:px-8">
      <div className="glass-panel grid items-center overflow-hidden rounded-[2rem] p-7 sm:grid-cols-[1fr_.75fr] sm:p-10">
        <div>
          <p className="font-mono text-xs font-bold text-accent">NEXT VERIFIED DRAW</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">Prize history</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
            Winner addresses are public for proof. Prize amounts stay encrypted for the winner alone.
          </p>
          <div className="mt-8">
            <p className="font-mono text-3xl font-bold sm:text-4xl">{formatCountdown(nextDrawAtMs, now ?? 0)}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">DAYS · HRS · MIN · SEC</p>
          </div>
          <Link
            href="/draw"
            className="mt-6 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-5 py-3 font-bold text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            Trigger a draw <ArrowRight className="size-4" />
          </Link>
        </div>
        <FheOrb compact variant="prize" />
      </div>
      <div className="mt-10 flex flex-col gap-4">
        {isLoading && (
          <article className="glass-panel rounded-2xl p-5">
            <p className="font-mono text-sm text-muted-foreground">Reading draws from Sepolia…</p>
          </article>
        )}
        {!isLoading && draws.length === 0 && (
          <article className="glass-panel rounded-2xl p-5">
            <p className="font-mono text-sm text-muted-foreground">
              No draws yet — the first one opens 1 day after the pool&apos;s first deposit.
            </p>
          </article>
        )}
        {draws.map((draw, i) => (
          <AnimatedContent key={draw.drawId} delay={i * 0.08}>
            <article className="glass-panel grid items-center gap-4 rounded-2xl p-5 sm:grid-cols-[.7fr_1fr_1fr_1fr]">
              <p className="font-mono text-sm font-bold text-primary">DRAW #{draw.drawId}</p>
              <p className="text-sm text-muted-foreground">{draw.date}</p>
              <p className="font-mono text-sm">{draw.winnerAddress}</p>
              <p className="flex items-center gap-2 font-mono text-sm font-bold">
                <LockKeyhole className="text-secondary" />
                {draw.prizeAmount.replace("🔒 ", "")}
              </p>
            </article>
          </AnimatedContent>
        ))}
      </div>
    </main>
  );
}
