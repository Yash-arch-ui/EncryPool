"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Trophy } from "lucide-react";
import { useAccount } from "wagmi";
import { EncrypoolConnectButton } from "~~/components/encrypool/EncrypoolConnectButton";
import { shortHex } from "~~/hooks/encrypool/shared";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";

const MIN_DRAW_INTERVAL_MS = 3_600_000;

export default function PrizesPage() {
  const { draws, isLoading, drawCount } = useDrawHistory();
  const { isConnected } = useAccount();
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

  return (
    <main className="min-h-[85vh] px-5 py-12 sm:px-8 lg:px-12">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Prizes</h1>
        <EncrypoolConnectButton />
      </div>

      <div className="mt-8 border-t border-white/10 pt-8">
        {/* ── Grand Prize Hero ──────────────────────────────────────── */}
        <div className="glass-heavy relative overflow-hidden rounded-2xl sm:grid sm:grid-cols-[1fr_auto]">
          {/* Left: Grand Prize */}
          <div className="relative z-10 p-8 sm:p-10">
            <p className="text-xs font-bold tracking-[0.2em] text-primary/80 uppercase">Grand Prize</p>
            <div className="mt-6 flex items-center gap-4">
              <Image src="/images/lock-icon.svg" alt="" width={48} height={48} className="shrink-0" />
              <p className="text-lg text-muted-foreground">Encrypted</p>
            </div>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground/80">
              One winner per draw. Your odds are weighted by deposit size and time held. Prize amounts stay encrypted
              until the winner claims. Fully on-chain, verifiable, noLoss.
            </p>
          </div>

          {/* Right: Countdown */}
          <div className="glow-coral relative flex flex-col justify-between border-t border-white/10 p-8 sm:border-l sm:border-t-0 sm:p-10">
            <div className="relative z-10">
              <p className="text-xs font-bold tracking-[0.25em] text-muted-foreground/60 uppercase">Next draw</p>
              <p className="mt-3 font-mono text-5xl font-bold tracking-tight text-foreground sm:text-6xl">
                {countdown}
              </p>
            </div>
            <div className="relative z-10 mt-10">
              <p className="text-xs font-bold tracking-[0.25em] text-muted-foreground/60 uppercase">
                Last awarded draw
              </p>
              <p className="mt-2 font-mono text-3xl font-bold text-foreground">
                #{latestDraw?.drawId ?? drawCount ?? "—"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Prize Structure ─────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Prize Structure</h2>
        <p className="mt-2 text-sm text-muted-foreground/70">
          Single-tier, deposit-weighted, fully encrypted until claimed.
        </p>

        <div className="glass-heavy mt-6 rounded-2xl p-8">
          <div className="flex items-start gap-6">
            <Image src="/images/lock-icon.svg" alt="" width={40} height={40} className="mt-1 shrink-0" />
            <div>
              <p className="text-sm font-bold text-primary">Grand Prize — 1 winner per draw</p>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground/80">
                The entire accrued yield from the pool is awarded to a single randomly selected winner each draw cycle.
                Your probability of winning is proportional to your time-weighted deposit. Larger or longer-held
                deposits receive proportionally higher odds. The prize amount stays encrypted end-to-end — only the
                winner can decrypt and claim it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Leaderboard ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Leaderboard</h2>
        <p className="mt-2 text-sm text-muted-foreground/70">Past winners, most recent first.</p>

        <div className="glass-heavy mt-6 overflow-hidden rounded-2xl">
          <div className="grid grid-cols-[4rem_1fr_1fr_1fr_1fr] border-b border-white/10 px-6 py-3">
            <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/50 uppercase">#</p>
            <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/50 uppercase">User</p>
            <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/50 uppercase">Score</p>
            <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/50 uppercase">Streak</p>
            <p className="text-[10px] font-bold tracking-[0.2em] text-muted-foreground/50 uppercase">Lives</p>
          </div>

          {fulfilledDraws.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground/60">
                {isLoading ? "Reading draws from Sepolia…" : "No draws fulfilled yet."}
              </p>
            </div>
          ) : (
            fulfilledDraws.slice(0, 5).map((draw, i) => {
              const rank = i + 1;
              const rankBg =
                rank === 1 ? "bg-green-500" : rank === 2 ? "bg-blue-400" : rank === 3 ? "bg-purple-400" : "bg-white/10";
              const rankText = rank <= 3 ? "text-white" : "text-muted-foreground";
              const rankLabel = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}`;

              return (
                <div
                  key={draw.drawId}
                  className={`grid grid-cols-[4rem_1fr_1fr_1fr_1fr] items-center px-6 py-4 transition-colors hover:bg-white/[0.02] ${
                    i < fulfilledDraws.length - 1 ? "border-b border-white/5" : ""
                  }`}
                >
                  <div className="flex items-center">
                    <span
                      className={`flex size-8 items-center justify-center rounded-full font-mono text-xs font-bold ${rankBg} ${rankText}`}
                    >
                      {rankLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="font-mono text-sm text-foreground/90">
                      {draw.winnerAddress !== "—" ? shortHex(draw.winnerAddress) : "—"}
                    </p>
                    {draw.winnerAddress !== "—" && <Trophy className="size-3 text-primary" />}
                  </div>
                  <p className="font-mono text-sm font-bold text-foreground/70">🔒</p>
                  <p className="font-mono text-sm text-muted-foreground/60">0 w</p>
                  <p className="font-mono text-sm text-muted-foreground/60">{draw.claimed ? "1 ♡" : "0 ♡"}</p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ── Your Prizes ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">Your Prizes</h2>
        <p className="mt-2 text-sm text-muted-foreground/70">Connect wallet to see your wins.</p>

        <div className="glass-heavy mt-6 overflow-hidden rounded-2xl">
          {isConnected ? (
            fulfilledDraws.filter(d => d.winnerAddress !== "—").length > 0 ? (
              fulfilledDraws
                .filter(d => d.winnerAddress !== "—")
                .slice(0, 3)
                .map((draw, i, arr) => (
                  <div
                    key={draw.drawId}
                    className={`flex items-center justify-between px-6 py-4 transition-colors hover:bg-white/[0.02] ${
                      i < arr.length - 1 ? "border-b border-white/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Image src="/images/lock-icon.svg" alt="" width={20} height={20} />
                      <div>
                        <p className="text-sm font-bold text-foreground/90">Draw #{draw.drawId}</p>
                        <p className="text-xs text-muted-foreground/60">{draw.date}</p>
                      </div>
                    </div>
                    <span className={`text-xs font-bold ${draw.claimed ? "text-[#2ec4b6]" : "text-primary/70"}`}>
                      {draw.claimed ? "CLAIMED" : "UNCLAIMED"}
                    </span>
                  </div>
                ))
            ) : (
              <div className="px-6 py-10 text-center">
                <p className="text-sm text-muted-foreground/60">No prizes won yet. Keep saving!</p>
              </div>
            )
          ) : (
            <div className="px-6 py-10 text-center">
              <p className="text-sm text-muted-foreground/60">Connect wallet to view your prize history.</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer CTA ─────────────────────────────────────────────── */}
      <div className="mt-12 border-t border-white/10 pt-8 text-center">
        <Link
          href="/draw"
          className="inline-flex items-center gap-2 rounded-full bg-primary/90 px-6 py-3 text-sm font-bold text-primary-foreground shadow-[0_0_30px_color-mix(in_srgb,var(--primary)_20%,transparent)] transition-all hover:shadow-[0_0_40px_color-mix(in_srgb,var(--primary)_30%,transparent)]"
        >
          Go to Draw <ArrowRight className="size-4" />
        </Link>
      </div>
    </main>
  );
}
