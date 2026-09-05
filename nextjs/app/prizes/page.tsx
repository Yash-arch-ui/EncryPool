"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, LockKeyhole, Trophy } from "lucide-react";
import { useAccount } from "wagmi";
import { EncrypoolConnectButton } from "~~/components/encrypool/EncrypoolConnectButton";
import { shortHex } from "~~/hooks/encrypool/shared";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";

const MIN_DRAW_INTERVAL_MS = 3_600_000;

export default function PrizesPage() {
  const { draws, isLoading, drawCount } = useDrawHistory();
  const { isConnected } = useAccount();
  const [now, setNow] = useState<number | null>(null);
  const [leaderboardTab, setLeaderboardTab] = useState<"savers" | "groups">("savers");

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
    <main className="mx-auto min-h-[85vh] max-w-6xl px-5 py-12 lg:px-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-sm font-bold tracking-[0.25em] text-foreground/80 uppercase">Prizes</h1>
        <EncrypoolConnectButton />
      </div>

      <div className="mt-8 border-t border-border/50 pt-8">
        {/* ── Grand Prize Hero ──────────────────────────────────────── */}
        <div className="glass-panel grid overflow-hidden rounded-xl sm:grid-cols-[1fr_auto]">
          <div className="p-8 sm:p-10">
            <span className="inline-block rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] font-bold tracking-wider text-primary uppercase">
              Grand Prize
            </span>
            <div className="mt-5 flex items-baseline gap-3">
              <LockKeyhole className="size-8 text-secondary" />
              <span className="font-serif text-5xl font-bold tracking-tight sm:text-6xl">🔒</span>
              <span className="text-xl font-medium text-muted-foreground">Encrypted</span>
            </div>
            <p className="mt-3 italic text-muted-foreground">
              5 ways to win every draw. Your win probability reflects your time-weighted balance. Stay deposited and let
              your real odds kick in. Withdraw anytime.
            </p>
          </div>

          <div className="flex flex-col justify-between border-t border-border/40 p-8 sm:border-l sm:border-t-0 sm:p-10">
            <div>
              <span className="inline-block rounded-full border border-secondary/40 bg-secondary/10 px-3 py-1 font-mono text-[10px] font-bold tracking-wider text-secondary uppercase">
                Next Draw
              </span>
              <p className="mt-4 font-mono text-4xl font-bold tracking-tight sm:text-5xl">{countdown}</p>
            </div>
            <div className="mt-8">
              <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Last Awarded Draw</p>
              <p className="mt-1 font-mono text-2xl font-bold">#{latestDraw?.drawId ?? drawCount ?? "—"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Prize Tiers ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold tracking-tight">Prize Tiers</h2>
        <p className="mt-2 italic text-muted-foreground">
          Each tier has a different prize size and number of winners per draw.
        </p>

        <div className="glass-panel mt-6 overflow-hidden rounded-xl">
          <div className="grid grid-cols-4 border-b border-border/50 px-6 py-3">
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Tier</p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Prize Size</p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase text-center">
              Winners / Draw
            </p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase text-right">
              Total
            </p>
          </div>

          <div className="grid grid-cols-4 border-b border-border/30 px-6 py-4">
            <p className="font-mono text-sm font-bold text-primary">Grand Prize</p>
            <p className="font-mono text-sm text-muted-foreground">🔒 Encrypted</p>
            <p className="text-center font-mono text-sm text-muted-foreground">1</p>
            <p className="text-right font-mono text-sm font-bold">1 winner</p>
          </div>
          <div className="grid grid-cols-4 border-b border-border/30 px-6 py-4 bg-foreground/[0.02]">
            <p className="font-mono text-sm font-bold">Tier 1</p>
            <p className="font-mono text-sm text-muted-foreground">Coming soon</p>
            <p className="text-center font-mono text-sm text-muted-foreground">4</p>
            <p className="text-right font-mono text-sm font-bold">4 winners</p>
          </div>
          <div className="grid grid-cols-4 border-b border-border/30 px-6 py-4">
            <p className="font-mono text-sm font-bold">Tier 2</p>
            <p className="font-mono text-sm text-muted-foreground">Coming soon</p>
            <p className="text-center font-mono text-sm text-muted-foreground">16</p>
            <p className="text-right font-mono text-sm font-bold">16 winners</p>
          </div>
          <div className="grid grid-cols-4 border-b border-border/30 px-6 py-4 bg-foreground/[0.02]">
            <p className="font-mono text-sm font-bold">Tier 3</p>
            <p className="font-mono text-sm text-muted-foreground">Coming soon</p>
            <p className="text-center font-mono text-sm text-muted-foreground">64</p>
            <p className="text-right font-mono text-sm font-bold">64 winners</p>
          </div>
          <div className="grid grid-cols-4 px-6 py-4">
            <p className="font-mono text-sm font-bold">Tier 4</p>
            <p className="font-mono text-sm text-muted-foreground">Coming soon</p>
            <p className="text-center font-mono text-sm text-muted-foreground">256</p>
            <p className="text-right font-mono text-sm font-bold">256 winners</p>
          </div>
        </div>
      </section>

      {/* ── Leaderboard ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl font-bold tracking-tight">Leaderboard</h2>
          <div className="flex overflow-hidden rounded-full border border-border/60 bg-card/40">
            <button
              onClick={() => setLeaderboardTab("savers")}
              className={`px-4 py-1.5 font-mono text-xs font-bold transition-colors ${
                leaderboardTab === "savers"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Savers
            </button>
            <button
              onClick={() => setLeaderboardTab("groups")}
              className={`px-4 py-1.5 font-mono text-xs font-bold transition-colors ${
                leaderboardTab === "groups"
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Groups
            </button>
          </div>
        </div>
        <p className="mt-2 italic text-muted-foreground">
          Score = streak × balance. Top savers get extra lives and better prize odds.
        </p>

        <div className="glass-panel mt-6 overflow-hidden rounded-xl">
          <div className="grid grid-cols-[4rem_1fr_1fr_1fr_1fr] border-b border-border/50 px-6 py-3">
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">#</p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">User</p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Score</p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Streak</p>
            <p className="font-mono text-[10px] font-bold tracking-wider text-muted-foreground uppercase">Lives</p>
          </div>

          {fulfilledDraws.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="font-mono text-sm text-muted-foreground">
                {isLoading ? "Reading draws from Sepolia…" : "No draws fulfilled yet."}
              </p>
            </div>
          ) : (
            fulfilledDraws.slice(0, 5).map((draw, i) => {
              const rank = i + 1;
              const rankBg =
                rank === 1 ? "bg-green-500" : rank === 2 ? "bg-blue-400" : rank === 3 ? "bg-purple-400" : "bg-muted";
              const rankText = rank <= 3 ? "text-white" : "text-muted-foreground";
              const rankLabel = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}`;

              return (
                <div
                  key={draw.drawId}
                  className={`grid grid-cols-[4rem_1fr_1fr_1fr_1fr] items-center px-6 py-4 transition-colors hover:bg-foreground/[0.02] ${
                    i < fulfilledDraws.length - 1 ? "border-b border-border/30" : ""
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
                    <p className="font-mono text-sm">
                      {draw.winnerAddress !== "—" ? shortHex(draw.winnerAddress) : "—"}
                    </p>
                    {draw.winnerAddress !== "—" && <Trophy className="size-3 text-accent" />}
                  </div>
                  <p className="font-mono text-sm font-bold">🔒</p>
                  <p className="font-mono text-sm text-muted-foreground">0 w</p>
                  <p className="font-mono text-sm text-muted-foreground">{draw.claimed ? "1 ♡" : "0 ♡"}</p>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ── Your Prizes ─────────────────────────────────────────────── */}
      <section className="mt-12">
        <h2 className="font-serif text-2xl font-bold tracking-tight">Your Prizes</h2>
        <p className="mt-2 text-sm text-muted-foreground">Connect wallet to see your wins</p>

        <div className="glass-panel mt-6 overflow-hidden rounded-xl">
          {isConnected ? (
            fulfilledDraws.filter(d => d.winnerAddress !== "—").length > 0 ? (
              fulfilledDraws
                .filter(d => d.winnerAddress !== "—")
                .slice(0, 3)
                .map((draw, i, arr) => (
                  <div
                    key={draw.drawId}
                    className={`flex items-center justify-between px-6 py-4 transition-colors hover:bg-foreground/[0.02] ${
                      i < arr.length - 1 ? "border-b border-border/30" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <LockKeyhole className="size-4 text-secondary" />
                      <div>
                        <p className="font-mono text-sm font-bold">Draw #{draw.drawId}</p>
                        <p className="font-mono text-xs text-muted-foreground">{draw.date}</p>
                      </div>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
                        draw.claimed ? "bg-green-500/10 text-green-500" : "bg-accent/10 text-accent"
                      }`}
                    >
                      {draw.claimed ? "CLAIMED" : "UNCLAIMED"}
                    </span>
                  </div>
                ))
            ) : (
              <div className="px-6 py-8 text-center">
                <p className="font-mono text-sm text-muted-foreground">No prizes won yet. Keep saving!</p>
              </div>
            )
          ) : (
            <div className="px-6 py-8 text-center">
              <p className="font-mono text-sm text-muted-foreground">Connect wallet to view your prize history</p>
            </div>
          )}
        </div>
      </section>

      {/* ── Footer CTA ─────────────────────────────────────────────── */}
      <div className="mt-12 border-t border-border/50 pt-8 text-center">
        <p className="italic text-muted-foreground">Connect wallet to view your prize history</p>
        <Link
          href="/draw"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-6 py-3 font-bold text-accent transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Go to Draw <ArrowRight className="size-4" />
        </Link>
      </div>
    </main>
  );
}
