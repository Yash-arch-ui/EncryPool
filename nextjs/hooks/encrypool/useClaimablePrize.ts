"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAllow, useIsAllowed, usePublicDecrypt, useUserDecrypt } from "@zama-fhe/react-sdk";
import toast from "react-hot-toast";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { type DrawState, fetchDrawStates, makeSepoliaClient } from "~~/hooks/encrypool/draws";
import { encrypoolChainId, erc7984Abi, isZeroHandle, poolDeployment } from "~~/hooks/encrypool/shared";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

/** Zero ciphertext handle — an uninitialized confidential balance. */
const ZERO = ("0x" + "0".repeat(64)) as `0x${string}`;

export type ClaimStatus = {
  /** Draws won by the connected wallet. */
  myWins: DrawState[];
  /** Draws whose winner is not yet KMS-verified on chain (awaiting the trusted coordinator). */
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
 * Claim flow for ConfidentialPrizePool (trusted-coordinator architecture):
 *
 * 1. `draw()` snapshots encrypted draw-time weight handles per participant and
 *    makes them publicly decryptable. Fulfillment is the trusted coordinator's
 *    job: it public-decrypts [seed, totalWeight, drawWeight_0..N-1] via the Zama
 *    relayer, submits `fulfillWinner(drawId, revealedSeed, weights[], proof)`,
 *    and the contract verifies the batch KMS proof against its stored draw-time
 *    handles, then names the winner on-chain.
 * 2. `claim(drawId, participantIndex, offset)` — only the stored winner can
 *    claim. This hook resolves the caller's participant index off-chain (public
 *    participant list) and their cumulative offset by decrypting only the
 *    draw-time weight handles preceding their index; the contract verifies the
 *    offset against storage and FHE-gates the transfer.
 * 3. After claiming, the prize lives in the winner's ERC-7984 ASSET balance.
 *    The winner user-decrypts their confidential balance handle under the
 *    asset contract (pre/post claim delta) — the prize value stays hidden
 *    from everyone else forever. `draw.amount` is never decryptable.
 */
export function useClaimablePrize() {
  const { address } = useAccount();
  const pool = poolDeployment();
  const queryClient = useQueryClient();

  // The confidential asset (ERC-7984 cUSDT). Claim() transfers the prize
  // straight into the winner's ASSET balance, so the prize reveal must decrypt
  // balance handles under this contract — not draw.amount under the pool.
  const { data: asset } = useReadContract({
    address: pool?.address,
    abi: pool?.abi,
    functionName: "asset" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(pool) },
  });
  const assetAddress = asset as `0x${string}` | undefined;

  const statesQuery = useQuery({
    queryKey: ["encrypool", "draws", pool?.address],
    enabled: Boolean(pool),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: fetchDrawStates,
  });
  const states: DrawState[] = useMemo(() => statesQuery.data ?? [], [statesQuery.data]);
  const status: ClaimStatus = useMemo(() => {
    const me = (address ?? "").toLowerCase();
    const mine = address ? states.filter(s => s.winner.toLowerCase() === me) : [];
    const isEmptyPot = (s: DrawState) => isZeroHandle(s.amount);
    return {
      myWins: mine,
      unfulfilled: states.filter(s => !s.fulfilled),
      claimable: mine.find(s => s.fulfilled && !s.claimed && !isEmptyPot(s)) ?? null,
      claimedByMe: mine.find(s => s.claimed) ?? null,
      emptyPotWin: mine.find(s => s.fulfilled && !s.claimed && isEmptyPot(s)) ?? null,
    };
  }, [states, address]);

  // ── Public decryption (KMS relayer) for claim offset resolution ──────────
  const publicDecrypt = usePublicDecrypt();
  const { writeContractAsync } = useWriteContract();

  /**
   * Read-only status check (the UI never performs winner resolution — that is
   * the trusted coordinator's `fulfillWinner` duty). Refreshes draw state and
   * reports how many draws are still pending coordinator fulfillment and
   * whether the connected wallet has won.
   */
  const checkResult = useCallback(async (): Promise<{ revealed: number; iWon: boolean }> => {
    const { data: fresh } = await statesQuery.refetch();
    const list = fresh ?? [];
    const me = (address ?? "").toLowerCase();
    const unfulfilled = list.filter(s => !s.fulfilled).length;
    const iWon = Boolean(
      list.some(s => s.fulfilled && !s.claimed && !isZeroHandle(s.amount) && s.winner.toLowerCase() === me),
    );
    return { revealed: unfulfilled, iWon };
  }, [statesQuery, address]);

  // ── Claim ────────────────────────────────────────────────────────────────
  /** Pre/post-claim confidential balance handles of the winner, used by the
   *  winner-only reveal to decrypt the prize delta. */
  const [revealTargets, setRevealTargets] = useState<{
    pre: `0x${string}`;
    post: `0x${string}`;
  } | null>(null);

  /**
   * Winner claim for a fulfilled draw. Resolves the caller's participant index
   * and cumulative offset from the public participant list and the draw-time
   * weight handles (decrypting only the handles that precede the caller's
   * index), then submits `claim(drawId, participantIndex, offset)`.
   */
  const claim = useCallback(
    async (drawId: number): Promise<boolean> => {
      if (!pool || !address) return false;
      const draw = states.find(s => s.drawId === drawId);
      if (!draw) {
        toast.error("Draw not found — refresh and retry.");
        return false;
      }
      try {
        // The winner is already public after fulfillment; only the winner may
        // pass the contract's msg.sender checks, so resolving the caller's own
        // index and offset never computes a winner for anyone else.
        const client = makeSepoliaClient();
        const participants = (await client.readContract({
          address: pool.address,
          abi: pool.abi,
          functionName: "participants",
        })) as readonly `0x${string}`[];
        const me = (address as `0x${string}`).toLowerCase();
        const myIndex = participants.findIndex(p => p.toLowerCase() === me);
        if (myIndex === -1) {
          toast.error("You are not a participant of this pool.");
          return false;
        }

        // Cumulative offset = Σ draw-time weights of participants before me.
        let offset = 0n;
        if (myIndex > 0) {
          const handles: `0x${string}`[] = [];
          for (let i = 0; i < myIndex; i++) {
            const handle = (await client.readContract({
              address: pool.address,
              abi: pool.abi,
              functionName: "drawWeightHandle",
              args: [BigInt(drawId), BigInt(i)],
            })) as `0x${string}`;
            handles.push(handle);
          }
          const res = await publicDecrypt.mutateAsync(handles);
          for (const handle of handles) {
            offset += BigInt(res.clearValues[handle] ?? 0);
          }
        }

        // Snapshot the winner's confidential balance handle BEFORE the claim
        // tx so the reveal can decrypt the (post − pre) delta instead of
        // showing the winner's entire balance as "prize".
        const preHandle = assetAddress
          ? ((await client.readContract({
              address: assetAddress,
              abi: erc7984Abi,
              functionName: "confidentialBalanceOf",
              args: [address as `0x${string}`],
            })) as `0x${string}`)
          : undefined;

        const tx = await writeContractAsync({
          address: pool.address,
          abi: pool.abi,
          functionName: "claim",
          args: [BigInt(drawId), BigInt(myIndex), offset],
          gas: 3_000_000n,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: tx });
        toast.success("Prize claimed to your confidential balance");

        // After the FHE-gated transfer the prize lives in the winner's asset
        // balance. Capture the post-claim handle — this is what the reveal
        // decrypts (the winner never holds draw.amount).
        if (assetAddress) {
          const postHandle = (await client.readContract({
            address: assetAddress,
            abi: erc7984Abi,
            functionName: "confidentialBalanceOf",
            args: [address as `0x${string}`],
          })) as `0x${string}`;
          setRevealTargets({ pre: preHandle ?? postHandle, post: postHandle });
        }
        await statesQuery.refetch();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message.slice(0, 160) : "Claim failed");
        return false;
      }
    },
    [pool, address, states, publicDecrypt, writeContractAsync, statesQuery, assetAddress],
  );

  // ── Winner-only decryption of the claimed prize amount ───────────────────
  // Claim() transfers the prize into the winner's ERC-7984 ASSET balance, so
  // `draw.amount` is never decryptable by the winner. The reveal instead
  // user-decrypts the winner's confidential balance handle(s) under the ASSET
  // contract (the ACL context that owns balance handles) and reports the
  // post − pre delta.
  const credentialContract = (assetAddress ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const { mutate: allow, isPending: isAllowing } = useAllow();
  const { data: isAllowed } = useIsAllowed({ contractAddresses: [credentialContract] });
  const [decryptEnabled, setDecryptEnabled] = useState(false);

  useEffect(() => {
    // A different wallet must never see a previous session's cleartext.
    setDecryptEnabled(false);
  }, [address]);

  const decryptHandles = useMemo(() => {
    if (!revealTargets || !assetAddress) return [];
    const handles: { handle: `0x${string}`; contractAddress: `0x${string}` }[] = [];
    if (revealTargets.pre !== ZERO) handles.push({ handle: revealTargets.pre, contractAddress: assetAddress });
    if (revealTargets.post !== ZERO) handles.push({ handle: revealTargets.post, contractAddress: assetAddress });
    return handles;
  }, [revealTargets, assetAddress]);

  const decryptQuery = useUserDecrypt({ handles: decryptHandles }, { enabled: decryptEnabled && !!isAllowed });

  const prizeAmountClear = useMemo(() => {
    if (!revealTargets || !decryptQuery.data) return undefined;
    const pre = revealTargets.pre !== ZERO ? BigInt(decryptQuery.data[revealTargets.pre] ?? 0n) : 0n;
    const post = revealTargets.post !== ZERO ? BigInt(decryptQuery.data[revealTargets.post] ?? 0n) : 0n;
    return post - pre;
  }, [revealTargets, decryptQuery.data]);

  /**
   * Explicit "decrypt prize amount" step (winner-only, on demand). The
   * plaintext lands via `prizeAmountClear` once the relayer responds.
   *
   * Works both right after a claim in this session (handles were snapshotted)
   * and after a page reload: if no snapshot exists it lazily reads the
   * winner's post-claim balance handle. In the reload case the pre-claim
   * handle is unrecoverable, so the revealed value is the post-claim balance
   * — exactly the prize when the winner held no prior cUSDT.
   */
  const requestPrizeReveal = useCallback(async () => {
    if (!assetAddress || !address) return;
    try {
      if (!revealTargets) {
        const client = makeSepoliaClient();
        const post = (await client.readContract({
          address: assetAddress,
          abi: erc7984Abi,
          functionName: "confidentialBalanceOf",
          args: [address as `0x${string}`],
        })) as `0x${string}`;
        setRevealTargets({ pre: ZERO, post });
      }
      if (!isAllowed) {
        allow([assetAddress]);
        return;
      }
      setDecryptEnabled(true);
    } catch {
      toast.error("Could not read your balance handle — retry.");
    }
  }, [revealTargets, assetAddress, address, isAllowed, allow]);

  return {
    ...status,
    isLoading: statesQuery.isLoading,
    isChecking: publicDecrypt.isPending || statesQuery.isFetching,
    refresh: () => {
      void statesQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ["encrypool", "draws"] });
    },
    checkResult,
    claim,
    claimedHandle: revealTargets?.post ?? null,
    prizeAmountClear,
    requestPrizeReveal,
    isRevealingPrize: isAllowing || decryptQuery.isFetching,
  };
}
