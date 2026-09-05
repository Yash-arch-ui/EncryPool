"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Gift, LockKeyhole } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import { DecryptionProgress } from "~~/components/encrypool/decryption-progress";
import { EncryptedBalance } from "~~/components/encrypool/encrypted-balance";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { fetchActivity } from "~~/hooks/encrypool/draws";
import { formatEncryptedAmount } from "~~/hooks/encrypool/shared";
import { useClaimablePrize } from "~~/hooks/encrypool/useClaimablePrize";
import { useEncryptedBalance } from "~~/hooks/encrypool/useEncryptedBalance";

export default function AccountPage() {
  const [decrypted, setDecrypted] = useState(false);
  const { address, isConnected } = useAccount();
  const {
    checkResult,
    isChecking,
    claimable,
    claimedByMe,
    emptyPotWin,
    claim,
    requestPrizeReveal,
    prizeAmountClear,
    isRevealingPrize,
  } = useClaimablePrize();
  const { symbol, decimals } = useEncryptedBalance();

  const activityQuery = useQuery({
    queryKey: ["encrypool", "activity", address],
    enabled: Boolean(isConnected && address),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    queryFn: () => fetchActivity(address!),
  });
  const activity = activityQuery.data ?? [];

  const onCheckResult = async () => {
    if (!isConnected) {
      toast.error("Connect your wallet first");
      return;
    }
    try {
      const res = await checkResult();
      if (emptyPotWin !== null) {
        toast.success("You won a draw whose pot was never funded — nothing to claim from it.");
      } else if (res.iWon && claimable !== null) {
        toast.success("You won — claim your prize below.");
      } else if (res.revealed > 0) {
        toast.success(
          `${res.revealed} draw${res.revealed > 1 ? "s" : ""} awaiting coordinator fulfillment — the winner is resolved on-chain by the KMS-verified reveal.`,
        );
      } else if (claimedByMe !== null && claimedByMe.claimed) {
        toast.success("Prize already claimed — reveal the amount below.");
      } else {
        toast.success("No pending draws yet — the next draw will appear here after it is fulfilled.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message.slice(0, 160) : "Check result failed");
    }
  };

  // Card content follows the real draw lifecycle while keeping the design:
  // Encrypted -> Check result -> Claim prize -> Reveal amount -> plaintext.
  let actionLabel = "Check result";
  let actionHandler: () => void = onCheckResult;
  if (prizeAmountClear !== undefined || (claimedByMe !== null && claimedByMe.claimed)) {
    actionLabel = "Reveal amount";
    actionHandler = () => requestPrizeReveal();
  } else if (claimable !== null) {
    actionLabel = "Claim prize";
    actionHandler = () => void claim(claimable.drawId);
  }

  return (
    <main className="h-full px-5 py-14 lg:px-8">
      <p className="font-mono text-xs font-bold text-primary">PRIVATE ACCOUNT</p>
      <h1 className="mt-3 text-balance font-serif text-5xl font-bold sm:text-7xl">Your Confidential corner.</h1>
      <div className="mt-10 grid items-center gap-8 lg:grid-cols-2">
        <div className="glass-panel relative rounded-[2rem]">
          <FheOrb decrypted={decrypted} compact variant="vault" />
          <div className="absolute inset-x-6 bottom-5 flex justify-between font-mono text-[10px] text-muted-foreground">
            <span>PERSONAL CIPHER</span>
            <span className={decrypted ? "text-accent" : "text-secondary"}>
              {decrypted ? "LOCALLY REVEALED" : "SEALED"}
            </span>
          </div>
        </div>
        <EncryptedBalance onDecrypt={setDecrypted} />
      </div>
      <div className="mt-12 grid gap-8 lg:grid-cols-[1.4fr_.6fr]">
        <section>
          <h2 className="font-serif text-3xl font-bold">Activity</h2>
          <div className="mt-5 flex flex-col gap-3">
            {!isConnected && (
              <article className="glass-panel flex items-center justify-between gap-4 rounded-2xl p-5">
                <p className="text-sm text-muted-foreground">Connect your wallet to see your encrypted activity.</p>
              </article>
            )}
            {isConnected && activity.length === 0 && (
              <article className="glass-panel flex items-center justify-between gap-4 rounded-2xl p-5">
                <p className="text-sm text-muted-foreground">
                  No deposits or withdrawals yet — your first deposit registers you for draws.
                </p>
              </article>
            )}
            {activity.map((entry, i) => (
              <AnimatedContent key={`${entry.txHash}-${i}`} delay={i * 0.07}>
                <article className="glass-panel flex items-center justify-between gap-4 rounded-2xl p-5">
                  <div className="flex items-center gap-4">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                      {entry.type === "Deposit" ? <ArrowDownLeft /> : <ArrowUpRight />}
                    </span>
                    <div>
                      <p className="font-bold">{entry.type}</p>
                      <p className="text-xs text-muted-foreground">{entry.date}</p>
                    </div>
                  </div>
                  <p className="font-mono text-sm font-bold">{entry.amount}</p>
                </article>
              </AnimatedContent>
            ))}
          </div>
        </section>
        <aside className="rounded-3xl border border-accent/30 bg-accent/10 p-7 text-foreground">
          <Gift className="text-accent" />
          <p className="mt-8 text-xs font-bold text-muted-foreground">CLAIMABLE PRIZE</p>
          <p className="mt-3 font-mono text-xl font-bold">
            <LockKeyhole className="inline text-accent" />{" "}
            {prizeAmountClear !== undefined ? formatEncryptedAmount(prizeAmountClear, decimals, symbol) : "Encrypted"}
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Only your wallet can check and decrypt the result.
          </p>
          <DecryptionProgress active={isRevealingPrize} />
          <button
            onClick={actionHandler}
            disabled={isChecking || isRevealingPrize}
            className="mt-4 w-full rounded-full bg-accent px-4 py-3 font-bold text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {isChecking ? "Checking…" : isRevealingPrize ? "Decrypting…" : actionLabel}
          </button>
        </aside>
      </div>
    </main>
  );
}
