"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Flame, Users } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { poolDeployment } from "~~/hooks/encrypool/shared";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

export default function DrawPage() {
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [drawId, setDrawId] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const { isConnected } = useAccount();
  const pool = poolDeployment();
  const { nextDrawAtMs } = useDrawHistory();
  const { writeContractAsync } = useWriteContract();

  const { data: participantCount } = useReadContract({
    address: pool?.address,
    abi: pool?.abi,
    functionName: "participantCount" as const,
    chainId: 11155111,
    query: { enabled: Boolean(pool) },
  });

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const hasParticipants = typeof participantCount === "bigint" && participantCount > 0n;
  const noPreviousDraws = nextDrawAtMs === null;
  const eligible = noPreviousDraws ? hasParticipants : nextDrawAtMs !== null && now !== null && now >= nextDrawAtMs;
  const canDraw = eligible && hasParticipants && !busy && !drawn;
  const countdown = formatCountdown(nextDrawAtMs, now ?? 0);

  const triggerDraw = async () => {
    if (!isConnected || !pool) {
      toast.error("Connect your wallet first");
      return;
    }
    setBusy(true);
    try {
      toast.loading("Submitting draw transaction…", { id: "draw", duration: Infinity });
      const tx = await writeContractAsync({
        address: pool.address,
        abi: pool.abi,
        functionName: "draw",
        gas: 3_000_000n,
      });
      toast.loading("Waiting for confirmation…", { id: "draw", duration: Infinity });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: tx });
      toast.dismiss("draw");
      toast.success("Draw triggered successfully!", { duration: 6000 });

      let parsedId: string | null = null;
      for (const l of receipt.logs) {
        if (l.topics.length >= 2) {
          parsedId = BigInt(l.topics[1]!).toString();
          break;
        }
      }

      setDrawId(parsedId);
      setDrawn(true);
    } catch (e) {
      toast.dismiss("draw");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("DrawNotReady")) {
        toast.error("Draw not ready — cooldown hasn't cleared yet.", { duration: 5000 });
      } else if (msg.includes("NoParticipants")) {
        toast.error("No participants registered yet — nothing to draw for.", { duration: 5000 });
      } else {
        toast.error(msg.length > 200 ? msg.slice(0, 200) : msg, { duration: 5000 });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="font-mono text-xs font-bold text-accent">PROTOCOL ACTION</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">Trigger a draw.</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Permissionless — anyone can trigger a draw once the cooldown clears. The pool selects an encrypted winner
            via FHE.
          </p>

          {!drawn && (
            <div className="mt-8">
              <div className="glass-panel rounded-2xl p-6">
                <p className="font-mono text-[10px] text-muted-foreground">NEXT DRAW IN</p>
                <p className="mt-2 font-mono text-3xl font-bold sm:text-4xl">
                  {noPreviousDraws ? (hasParticipants ? "Ready now" : "Waiting for participants") : countdown}
                </p>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">DAYS · HRS · MIN · SEC</p>
                <div className="mt-5 h-px bg-gradient-to-r from-secondary/70 to-transparent" />
                <div className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
                  <Users className="size-4 shrink-0 text-secondary" />
                  {hasParticipants
                    ? `${participantCount!.toString()} participant${participantCount! === 1n ? "" : "s"} registered`
                    : "No participants registered yet"}
                </div>
              </div>

              <button
                onClick={triggerDraw}
                disabled={!canDraw}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-4 font-bold text-background transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40"
              >
                {busy ? (
                  "Submitting…"
                ) : !hasParticipants ? (
                  "No participants yet"
                ) : !eligible ? (
                  noPreviousDraws ? (
                    <>
                      <Flame className="size-5" />
                      Waiting for participants
                    </>
                  ) : (
                    <>
                      <Flame className="size-5" />
                      Cooldown active — {countdown}
                    </>
                  )
                ) : (
                  <>
                    <Flame className="size-5" />
                    Trigger draw
                  </>
                )}
              </button>
            </div>
          )}

          {drawn && (
            <div className="mt-8">
              <div className="glass-panel rounded-2xl p-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="size-6 text-accent" />
                  <p className="font-mono text-xs font-bold text-accent">DRAW TRIGGERED</p>
                </div>
                <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                  A <code className="font-mono text-foreground">WinnerSeeded</code> event was emitted. The pool has
                  selected an encrypted winner — no one can see who it is yet.
                </p>
                {drawId && (
                  <p className="mt-3 font-mono text-sm text-muted-foreground">
                    Draw ID: <span className="text-foreground">#{drawId}</span>
                  </p>
                )}
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  Head to your account to reveal the winner via KMS and claim if it&apos;s you.
                </p>
                <Link
                  href="/account"
                  className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 font-bold text-background transition-transform hover:-translate-y-0.5"
                >
                  Go to Account <ArrowRight className="size-4" />
                </Link>
              </div>

              <button
                onClick={() => {
                  setDrawn(false);
                  setDrawId(null);
                }}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-3 font-bold text-foreground transition-colors hover:bg-muted"
              >
                Trigger another draw
              </button>
            </div>
          )}
        </div>

        <div className="flex min-h-0 items-center justify-center">
          <FheOrb decrypted={drawn} compact variant="prize" />
        </div>
      </div>
    </main>
  );
}
