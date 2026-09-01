"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAllow, useIsAllowed, usePublicDecrypt, useUserDecrypt } from "@zama-fhe/react-sdk";
import toast from "react-hot-toast";
import { useAccount, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { type DrawState, fetchDrawStates } from "~~/hooks/encrypool/draws";
import { poolDeployment } from "~~/hooks/encrypool/shared";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

export type ClaimStatus = {
  /** Draws won by the connected wallet. */
  myWins: DrawState[];
  /** Draws whose winner index is not yet KMS-verified on chain. */
  unfulfilled: DrawState[];
  /** The win this wallet can claim right now, if any. */
  claimable: DrawState | null;
  /** A win already claimed by this wallet (amount decryptable by them). */
  claimedByMe: DrawState | null;
  /** Won + fulfilled but the pot handle is the all-zero handle: the draw
   *  snapshot was taken while prizeLiquidity was never funded, and claim()
   *  would revert on the uninitialized handle. Surface instead of reverting. */
  emptyPotWin: DrawState | null;
};

/**
 * Real claim flow for ConfidentialPrizePool:
 *
 * 1. `checkResult()` — permissionless reveal: every unfulfilled draw's
 *    publicly-decryptable seedIndex is decrypted via the Zama relayer
 *    (KMS-signed proof), and `fulfillWinner(drawId, index, proof)` verifies
 *    that proof on-chain via FHE.checkSignatures before naming the winner.
 * 2. `claim(drawId)` — only the winner can call it; the encrypted pot is
 *    transferred to their wallet (granting decryption rights on the amount).
 * 3. After claiming, the winner can user-decrypt the draw's amount handle —
 *    the prize value stays hidden from everyone else forever.
 */
export function useClaimablePrize() {
  const { address } = useAccount();
  const pool = poolDeployment();
  const queryClient = useQueryClient();

  const statesQuery = useQuery({
    queryKey: ["encrypool", "draws", pool?.address],
    enabled: Boolean(pool),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: fetchDrawStates,
  });
  const states: DrawState[] = useMemo(() => statesQuery.data ?? [], [statesQuery.data]);
  const status: ClaimStatus = useMemo(() => {
    const mine = address ? states.filter(s => s.winner.toLowerCase() === (address as string).toLowerCase()) : [];
    const ZERO_HANDLE = "0x" + "0".repeat(64);
    const isEmptyPot = (s: DrawState) => s.amount === ZERO_HANDLE;
    return {
      myWins: mine,
      unfulfilled: states.filter(s => !s.fulfilled),
      claimable: mine.find(s => s.fulfilled && !s.claimed && !isEmptyPot(s)) ?? null,
      claimedByMe: mine.find(s => s.claimed) ?? null,
      emptyPotWin: mine.find(s => s.fulfilled && !s.claimed && isEmptyPot(s)) ?? null,
    };
  }, [states, address]);
  // ── Public decryption (KMS-verified) + fulfillWinner submission ──────────
  const publicDecrypt = usePublicDecrypt();
  const { writeContractAsync } = useWriteContract();

  const checkResult = useCallback(async (): Promise<{ revealed: number; iWon: boolean }> => {
    if (!pool) return { revealed: 0, iWon: false };
    let revealed = 0;
    for (const draw of states.filter(s => !s.fulfilled)) {
      try {
        const res = await publicDecrypt.mutateAsync([draw.seedIndex]);
        const clearValue = res.clearValues[draw.seedIndex];
        if (clearValue === undefined) continue;
        const winnerIndex = Number(clearValue);
        const tx = await writeContractAsync({
          address: pool.address,
          abi: pool.abi,
          functionName: "fulfillWinner",
          args: [BigInt(draw.drawId), winnerIndex, res.decryptionProof],
          gas: 3_000_000n,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: tx });
        revealed += 1;
      } catch (e) {
        // Race with another revealer or relayer hiccup — keep revealing the rest.
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("DrawAlreadyFulfilled")) console.warn(`reveal draw ${draw.drawId}:`, msg);
      }
    }
    const { data: fresh } = await statesQuery.refetch();
    const iWon = Boolean(
      address && (fresh ?? []).some(s => !s.claimed && s.winner.toLowerCase() === (address as string).toLowerCase()),
    );
    return { revealed, iWon };
  }, [pool, states, publicDecrypt, writeContractAsync, statesQuery, address]);

  // ── Claim ────────────────────────────────────────────────────────────────
  const [claimedHandle, setClaimedHandle] = useState<`0x${string}` | null>(null);

  const claim = useCallback(
    async (drawId: number): Promise<boolean> => {
      if (!pool || !address) return false;
      try {
        const tx = await writeContractAsync({
          address: pool.address,
          abi: pool.abi,
          functionName: "claim",
          args: [BigInt(drawId)],
          gas: 3_000_000n,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: tx });
        toast.success("Prize claimed to your confidential balance");
        // Only after the transfer does the winner hold decryption rights on
        // the pot handle.
        setClaimedHandle(states.find(s => s.drawId === drawId)?.amount ?? null);
        await statesQuery.refetch();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message.slice(0, 160) : "Claim failed");
        return false;
      }
    },
    [pool, address, writeContractAsync, states, statesQuery],
  );

  // ── Winner-only decryption of the claimed prize amount ───────────────────
  const credentialContract = (pool?.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const { mutate: allow, isPending: isAllowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: [credentialContract] });
  const [decryptEnabled, setDecryptEnabled] = useState(false);

  useEffect(() => {
    setDecryptEnabled(false);
  }, [address, claimedHandle]);

  const ZERO = "0x" + "0".repeat(64);
  const decryptHandles = useMemo(() => {
    if (!claimedHandle || !pool || claimedHandle === ZERO) return [];
    return [{ handle: claimedHandle, contractAddress: pool.address }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimedHandle, pool]);

  const decryptQuery = useUserDecrypt({ handles: decryptHandles }, { enabled: decryptEnabled && !!isAllowed });

  const prizeAmountClear = useMemo(() => {
    if (!claimedHandle || !decryptQuery.data) return undefined;
    const v = decryptQuery.data[claimedHandle];
    return typeof v === "bigint" ? v : undefined;
  }, [claimedHandle, decryptQuery.data]);

  /**
   * Explicit "decrypt prize amount" step (winner-only, on demand). The
   * plaintext lands via `prizeAmountClear` once the relayer responds.
   */
  const requestPrizeReveal = useCallback(() => {
    if (!claimedHandle || !pool) return;
    if (!isAllowed) {
      allow([pool.address]);
      return;
    }
    setDecryptEnabled(true);
  }, [claimedHandle, pool, isAllowed, allow]);

  return {
    ...status,
    isLoading: statesQuery.isLoading,
    isChecking: publicDecrypt.isPending,
    refresh: () => {
      void statesQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["encrypool", "draws"] });
    },
    checkResult,
    claim,
    claimedHandle,
    prizeAmountClear,
    requestPrizeReveal,
    isRevealingPrize: isAllowing || decryptQuery.isFetching,
  };
}
