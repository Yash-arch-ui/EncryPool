"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDrawStates } from "~~/hooks/encrypool/draws";
import { poolDeployment, shortHex } from "~~/hooks/encrypool/shared";

export type DrawRow = {
  drawId: number;
  date: string;
  /** ms epoch of the draw block. */
  ts: number;
  /** `0x7B3a...91F2`, or "—" while the KMS reveal is pending. */
  winnerAddress: string;
  /** Prize amounts are encrypted end-to-end — only the winner can decrypt. */
  prizeAmount: string;
  fulfilled: boolean;
  claimed: boolean;
};

export type DrawHistory = {
  draws: DrawRow[];
  /** ms epoch of the next drawable moment (last draw + MIN_DRAW_INTERVAL), null if none */
  nextDrawAtMs: number | null;
  drawCount: number;
  isLoading: boolean;
  refetch: () => void;
};

const DAY_MS = 60 * 1000; // matches MIN_DRAW_INTERVAL = 1 minute

function formatDrawDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Real draw history from ConfidentialPrizePool (Sepolia). Prize amounts stay
 * "🔒 Encrypted": the amount handle is decryptable by the winner alone.
 * Also exposes the public draw clock: MIN_DRAW_INTERVAL is 1 minute, so
 * nextDrawAtMs = lastDrawBlock.timestamp + 1 minute.
 */
export function useDrawHistory(): DrawHistory {
  const pool = poolDeployment();

  const query = useQuery({
    queryKey: ["encrypool", "draws", pool?.address],
    enabled: Boolean(pool),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: fetchDrawStates,
  });

  // Keep the countdown source fresh.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const { data: drawStates, isLoading, refetch } = query;

  return useMemo(() => {
    void nowTick;
    const states = drawStates ?? [];
    const draws: DrawRow[] = states.slice(0, 12).map(s => ({
      drawId: s.drawId,
      date: formatDrawDate(s.ts),
      ts: s.ts,
      winnerAddress:
        s.fulfilled && s.winner && s.winner !== "0x0000000000000000000000000000000000000000" ? shortHex(s.winner) : "—",
      prizeAmount: "🔒 Encrypted",
      fulfilled: s.fulfilled,
      claimed: s.claimed,
    }));
    const lastDrawAtMs = states.length > 0 ? Math.max(...states.map(s => s.ts)) : null;
    return {
      draws,
      nextDrawAtMs: lastDrawAtMs === null ? null : lastDrawAtMs + DAY_MS,
      // Total draws on-chain — the home page stat shouldn't be capped by the
      // 12-row history slice.
      drawCount: states.length,
      isLoading,
      refetch: () => refetch(),
    };
  }, [drawStates, isLoading, refetch, nowTick]);
}

/**
 * Countdown formatter. The pool's MIN_DRAW_INTERVAL is 1 minute, so the
 * common case renders `MM:SS`; longer waits widen to `HH:MM:SS` / `DD:HH:MM:SS`
 * automatically instead of always showing four groups of which two are 00.
 */
export function formatCountdown(targetMs: number | null, now: number): string {
  if (targetMs === null) return "--:--";
  const diff = Math.max(0, targetMs - now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);
  if (days > 0) return `${pad(days)}:${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  if (hours > 0) return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
  return `${pad(mins)}:${pad(secs)}`;
}
