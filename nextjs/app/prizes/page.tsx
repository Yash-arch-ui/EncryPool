"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Crown, LockKeyhole, Trophy } from "lucide-react";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { shortHex } from "~~/hooks/encrypool/shared";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";

const MIN_DRAW_INTERVAL_MS = 60_000;

export default function PrizesPage() {
  const { draws, isLoading } = useDrawHistory();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const latestDraw = draws[0] ?? null;
  const lastDrawTs = latestDraw?.ts ?? null;
  const nextDrawAtMs = lastDrawTs !== null ? lastDrawTs + MIN_DRAW_INTERVAL_MS : null;
  const countdown = formatCountdown(nextDrawAtMs, now ?? 0);

  const fulfilledDraws = draws.filter(d => d.fulfilled);
  const pendingDraws = draws.filter(d => !d.fulfilled);

  return (
    <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-16 lg:px-8">
      {/* Hero: latest winner */}
      <div className="glass-panel grid items-center overflow-hidden rounded-[2rem] p-7 sm:grid-cols-[1fr_.75fr] sm:p-10">
        <div>
          <p className="font-mono text-xs font-bold text-accent">VERIFIED DRAWS</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">Prize history</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
            Winner addresses are public for proof. Prize amounts stay encrypted for the winner alone.
          </p>
          <div className="mt-8">
            <p className="font-mono text-3xl font-bold sm:text-4xl">{countdown}</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">NEXT DRAW IN · MIN · SEC</p>
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

      {/* Latest winner hero */}
      {latestDraw && latestDraw.fulfilled && latestDraw.winnerAddress !== "—" && (
        <div className="mt-8">
          <AnimatedContent>
            <div className="glass-panel relative overflow-hidden rounded-2xl p-8">
              <div className="absolute right-4 top-4 opacity-10">
                <Crown className="size-24 text-accent" />
              </div>
              <p className="font-mono text-xs font-bold text-accent">LATEST WINNER</p>
              <div className="mt-3 flex items-center gap-3">
                <Trophy className="size-6 text-accent" />
                <p className="font-mono text-xl font-bold sm:text-2xl">{latestDraw.winnerAddress}</p>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Draw #{latestDraw.drawId} · {latestDraw.date} · Prize encrypted
              </p>
            </div>
          </AnimatedContent>
        </div>
      )}

      {/* Stats bar */}
      <div className="mt-8 grid grid-cols-3 gap-4">
        <div className="glass-panel rounded-xl p-4 text-center">
          <p className="font-mono text-2xl font-bold">{draws.length}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">TOTAL DRAWS</p>
        </div>
        <div className="glass-panel rounded-xl p-4 text-center">
          <p className="font-mono text-2xl font-bold">{fulfilledDraws.length}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">FULFILLED</p>
        </div>
        <div className="glass-panel rounded-xl p-4 text-center">
          <p className="font-mono text-2xl font-bold">{pendingDraws.length}</p>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground">PENDING</p>
        </div>
      </div>

      {/* Draw list */}
      <div className="mt-8 flex flex-col gap-4">
        {isLoading && (
          <article className="glass-panel rounded-2xl p-5">
            <p className="font-mono text-sm text-muted-foreground">Reading draws from Sepolia…</p>
          </article>
        )}
        {!isLoading && draws.length === 0 && (
          <article className="glass-panel rounded-2xl p-5">
            <p className="font-mono text-sm text-muted-foreground">
              No draws yet — the first one opens 1 minute after the pool&apos;s first deposit.
            </p>
          </article>
        )}
        {draws.map((draw, i) => (
          <AnimatedContent key={draw.drawId} delay={i * 0.08}>
            <article className="glass-panel grid items-center gap-4 rounded-2xl p-5 sm:grid-cols-[.5fr_1fr_1fr_1fr_auto]">
              <p className="font-mono text-sm font-bold text-primary">#{draw.drawId}</p>
              <p className="text-sm text-muted-foreground">{draw.date}</p>
              <p className="font-mono text-sm">{draw.winnerAddress !== "—" ? shortHex(draw.winnerAddress) : "—"}</p>
              <p className="flex items-center gap-2 font-mono text-sm font-bold">
                <LockKeyhole className="text-secondary" />
                {draw.prizeAmount.replace("🔒 ", "")}
              </p>
              <p
                className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
                  draw.claimed
                    ? "bg-green-500/10 text-green-500"
                    : draw.fulfilled
                      ? "bg-accent/10 text-accent"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {draw.claimed ? "CLAIMED" : draw.fulfilled ? "FULFILLED" : "PENDING"}
              </p>
            </article>
          </AnimatedContent>
        ))}
      </div>
    </main>
  );
}
