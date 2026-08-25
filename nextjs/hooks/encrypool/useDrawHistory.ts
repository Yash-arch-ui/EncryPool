"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDrawStates } from "~~/hooks/encrypool/draws";
import { poolDeployment, shortHex } from "~~/hooks/encrypool/shared";

export type DrawRow = {
  drawId: number;
  date: string;
  /** `0x7B3a...91F2`, or "—" while the KMS reveal is pending. */
  winnerAddress: string;
  /** Prize amounts are encrypted end-to-end — only the winner can decrypt. */
  prizeAmount: string;
  fulfilled: boolean;
  claimed: boolean;
};

export type DrawHistory = {
  draws: DrawRow[];
  /** ms epoch of the next drawable moment (last draw + 1 day), null if none */
  nextDrawAtMs: number | null;
  drawCount: number;
  isLoading: boolean;
  refetch: () => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatDrawDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Real draw history from ConfidentialPrizePool (Sepolia). Prize amounts stay
 * "🔒 Encrypted": the amount handle is decryptable by the winner alone.
 * Also exposes the public draw clock: MIN_DRAW_INTERVAL is 1 day, so
 * nextDrawAtMs = lastDrawBlock.timestamp + 1 day.
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
      drawCount: draws.length,
      isLoading,
      refetch: () => refetch(),
    };
  }, [drawStates, isLoading, refetch, nowTick]);
}

/** Countdown formatter for the `DD:HH:MM:SS` displays ("02:14:37:09"). */
export function formatCountdown(targetMs: number | null, now: number): string {
  if (targetMs === null) return "--:--:--:--";
  const diff = Math.max(0, targetMs - now);
  const days = Math.floor(diff / DAY_MS);
  const hours = Math.floor((diff % DAY_MS) / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  const secs = Math.floor((diff % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(days)}:${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}
