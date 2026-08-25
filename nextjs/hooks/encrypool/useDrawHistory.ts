"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
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
 * Real draw history from ConfidentialPrizePool (Sepolia). Draw ids are
 * enumerated from WinnerSeeded logs (the pool has no public counter), then
 * each draw's state comes from getDraw(). Prize amounts stay "🔒 Encrypted":
 * the amount handle is decryptable by the winner alone.
 *
 * Also exposes the public draw clock: MIN_DRAW_INTERVAL is 1 day, so
 * nextDrawAtMs = lastDrawBlock.timestamp + 1 day.
 */
export function useDrawHistory(): DrawHistory {
  const pool = poolDeployment();

  const publicClient = useMemo(
    () =>
      createPublicClient({
        chain: sepolia,
        transport: http(undefined, { timeout: 20_000 }),
      }),
    [],
  );

  const query = useQuery({
    queryKey: ["encrypool", "draws", pool?.address],
    enabled: Boolean(pool),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: async () => {
      const fromBlock = BigInt(pool!.deployedOnBlock);
      const seededLogs = await publicClient.getLogs({
        address: pool!.address,
        event: {
          type: "event",
          name: "WinnerSeeded",
          inputs: [
            { name: "drawId", type: "uint256", indexed: true },
            { name: "seedIndex", type: "bytes32", indexed: false },
          ],
        },
        fromBlock,
        toBlock: "latest",
      });

      if (seededLogs.length === 0) return { draws: [] as DrawRow[], lastDrawAtMs: null as number | null };

      // Newest first, capped to a reasonable page size.
      const ordered = [...seededLogs].sort((a, b) => Number(b.args.drawId) - Number(a.args.drawId)).slice(0, 12);

      const blocks = await Promise.all(
        [...new Set(ordered.map(l => l.blockNumber))].map(b => publicClient.getBlock({ blockNumber: b })),
      );
      const tsByBlock = new Map(blocks.map(b => [b.number, Number(b.timestamp) * 1000]));

      const draws = await Promise.all(
        ordered.map(async log => {
          const drawId = Number(log.args.drawId);
          const state = await publicClient.readContract({
            address: pool!.address,
            abi: pool!.abi,
            functionName: "getDraw",
            args: [BigInt(drawId)],
          });
          const winner = state.winner;
          const fulfilled = state.fulfilled;
          const claimed = state.claimed;
          return {
            drawId,
            date: formatDrawDate(tsByBlock.get(log.blockNumber) ?? Date.now()),
            winnerAddress:
              fulfilled && winner && winner !== "0x0000000000000000000000000000000000000000" ? shortHex(winner) : "—",
            prizeAmount: "🔒 Encrypted",
            fulfilled,
            claimed,
          } satisfies DrawRow;
        }),
      );

      const lastTs = tsByBlock.get(ordered[0].blockNumber) ?? null;
      return { draws, lastDrawAtMs: lastTs };
    },
  });

  const [nowTick, setNowTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setNowTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => {
    void nowTick; // recompute nextDrawAtMs countdown source each second
    const lastDrawAtMs = query.data?.lastDrawAtMs ?? null;
    return {
      draws: query.data?.draws ?? [],
      nextDrawAtMs: lastDrawAtMs === null ? null : lastDrawAtMs + DAY_MS,
      drawCount: query.data?.draws.length ?? 0,
      isLoading: query.isLoading,
      refetch: () => query.refetch(),
    };
  }, [query.data, query.isLoading, nowTick]);
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
