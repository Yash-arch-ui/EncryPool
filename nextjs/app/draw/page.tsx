"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Flame, Loader2, Users, Zap } from "lucide-react";
import toast from "react-hot-toast";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { makeSepoliaClient } from "~~/hooks/encrypool/draws";
import { poolDeployment, shortHex } from "~~/hooks/encrypool/shared";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const GATEWAY = "https://relayer.testnet.zama.org/v2";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function gatewayPublicDecrypt(handles: `0x${string}`[]) {
  const post = await fetch(`${GATEWAY}/public-decrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertextHandles: handles, extraData: "0x00" }),
  });
  const queued = await post.json();
  if (queued.status !== "queued") throw new Error(`gateway rejected: ${JSON.stringify(queued.error ?? queued)}`);
  const jobId = queued.result.jobId;
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const poll = await fetch(`${GATEWAY}/public-decrypt/${jobId}`);
    const res = await poll.json();
    if (res.status === "succeeded") return res.result;
    if (res.status === "failed") throw new Error(`gateway job failed: ${JSON.stringify(res.error ?? res)}`);
  }
  throw new Error("gateway job timed out");
}

export default function DrawPage() {
  const [phase, setPhase] = useState<"idle" | "drawing" | "decrypting" | "fulfilling" | "done">("idle");
  const [drawId, setDrawId] = useState<string | null>(null);
  const [winner, setWinner] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [lastDrawTs, setLastDrawTs] = useState<number | null>(null);
  const autoFired = useRef(false);

  const { isConnected } = useAccount();
  const pool = poolDeployment();
  const { writeContractAsync } = useWriteContract();
  const { draws } = useDrawHistory();

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

  // Derive the last draw timestamp from event-driven draw history (works even
  // when on-chain lastDrawAt() reverts on the old contract).
  useEffect(() => {
    if (draws.length > 0 && lastDrawTs === null) {
      const latest = draws[0];
      if (latest) setLastDrawTs(latest.ts);
    }
  }, [draws, lastDrawTs]);

  const MIN_DRAW_INTERVAL_MS = 3_600_000;
  const hasParticipants = typeof participantCount === "bigint" && participantCount > 0n;
  const nextDrawAtMs = lastDrawTs !== null ? lastDrawTs + MIN_DRAW_INTERVAL_MS : null;
  const eligible = nextDrawAtMs === null ? hasParticipants : now !== null && now >= nextDrawAtMs;
  const canDraw = eligible && hasParticipants && phase === "idle";
  const countdown = formatCountdown(nextDrawAtMs, now ?? 0);

  // Auto-trigger: fire once when countdown reaches zero and wallet is connected.
  useEffect(() => {
    if (phase !== "idle" || !isConnected || !canDraw || autoFired.current) return;
    autoFired.current = true;
    doDrawAndFulfill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isConnected, canDraw]);

  const doDrawAndFulfill = async () => {
    if (!isConnected || !pool) {
      toast.error("Connect your wallet first");
      return;
    }

    try {
      // ── Phase 1: draw() ────────────────────────────────────────────────
      setPhase("drawing");
      toast.loading("Submitting draw transaction…", { id: "draw", duration: Infinity });
      const tx = await writeContractAsync({
        address: pool.address,
        abi: pool.abi,
        functionName: "draw",
        gas: 8_000_000n,
      });
      toast.loading("Waiting for draw confirmation…", { id: "draw", duration: Infinity });
      const receipt = await waitForTransactionReceipt(wagmiConfig, { hash: tx });
      toast.dismiss("draw");

      let parsedId: string | null = null;
      for (const l of receipt.logs) {
        if (l.topics.length >= 2) {
          parsedId = BigInt(l.topics[1]!).toString();
          break;
        }
      }
      if (!parsedId) throw new Error("Could not parse drawId from logs");
      setDrawId(parsedId);

      // ── Phase 2: gateway decrypt ───────────────────────────────────────
      setPhase("decrypting");
      toast.loading("Decrypting draw handles via KMS…", { id: "fulfill", duration: Infinity });

      const client = makeSepoliaClient();
      const drawState = await client.readContract({
        address: pool.address,
        abi: pool.abi,
        functionName: "getDraw",
        args: [BigInt(parsedId)],
      });
      const n = Number(drawState.participantCount);

      const weightHandles: `0x${string}`[] = [];
      for (let i = 0; i < n; i++) {
        const h = (await client.readContract({
          address: pool.address,
          abi: pool.abi,
          functionName: "drawWeightHandle",
          args: [BigInt(parsedId), BigInt(i)],
        })) as `0x${string}`;
        weightHandles.push(h);
      }

      const allHandles: `0x${string}`[] = [
        drawState.seedIndex as `0x${string}`,
        drawState.totalWeight as `0x${string}`,
        ...weightHandles,
      ];
      const result = await gatewayPublicDecrypt(allHandles);

      const hex = ((result.decryptedValue as string) ?? "").replace(/^0x/, "");
      const words: bigint[] = [];
      for (let i = 0; i < hex.length; i += 64) words.push(BigInt(`0x${hex.slice(i, i + 64)}`));
      const revealedSeed = words[0];
      const weights = words.slice(2);
      const sum = weights.reduce((a: bigint, w: bigint) => a + w, 0n);
      if (sum !== words[1]) throw new Error(`totalWeight mismatch: sum=${sum} decrypted=${words[1]}`);

      // ── Phase 3: fulfillWinner ─────────────────────────────────────────
      setPhase("fulfilling");
      toast.loading("Submitting fulfillment…", { id: "fulfill", duration: Infinity });

      const sigs = (result.signatures as string[]) ?? [];
      let proofHex = `0x${sigs.length.toString(16).padStart(2, "0")}`;
      for (const sig of sigs) proofHex += sig.startsWith("0x") ? sig.slice(2) : sig;
      proofHex += ((result.extraData as string) ?? "0x").replace(/^0x/, "");

      const fTx = await writeContractAsync({
        address: pool.address,
        abi: pool.abi,
        functionName: "fulfillWinner",
        args: [BigInt(parsedId), revealedSeed, weights, proofHex as `0x${string}`],
        gas: 5_000_000n,
      });
      toast.loading("Waiting for fulfillment confirmation…", { id: "fulfill", duration: Infinity });
      await waitForTransactionReceipt(wagmiConfig, { hash: fTx });
      toast.dismiss("fulfill");

      // ── Read winner ────────────────────────────────────────────────────
      const after = await client.readContract({
        address: pool.address,
        abi: pool.abi,
        functionName: "getDraw",
        args: [BigInt(parsedId)],
      });
      setWinner(after.winner as string);
      setPhase("done");
      toast.success("Draw fulfilled — winner revealed!", { duration: 6000 });
    } catch (e) {
      toast.dismiss("draw");
      toast.dismiss("fulfill");
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("DrawTooSoon")) {
        toast.error("Draw not ready — cooldown hasn't cleared yet.", { duration: 5000 });
      } else if (msg.includes("NoParticipants")) {
        toast.error("No participants registered yet.", { duration: 5000 });
      } else {
        toast.error(msg.length > 200 ? msg.slice(0, 200) : msg, { duration: 5000 });
      }
      setPhase("idle");
    }
  };

  const reset = () => {
    setPhase("idle");
    setDrawId(null);
    setWinner(null);
    autoFired.current = false;
  };

  const phaseLabel: Record<string, string> = {
    idle: "",
    drawing: "Step 1/3 — Submitting draw…",
    decrypting: "Step 2/3 — KMS decryption in progress…",
    fulfilling: "Step 3/3 — Submitting fulfillment…",
    done: "Complete!",
  };

  const isIdle = phase === "idle";

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <div className="grid items-center gap-8 lg:grid-cols-[.85fr_1.15fr]">
        <div>
          <p className="font-mono text-xs font-bold text-accent">PROTOCOL ACTION</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">Draw &amp; reveal.</h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            One click does everything: snapshots encrypted weights, rolls an FHE seed, decrypts via KMS, and reveals the
            winner on-chain. Fully permissionless.
          </p>

          {isIdle && (
            <div className="mt-8">
              <div className="glass-panel rounded-2xl p-6">
                <p className="font-mono text-[10px] text-muted-foreground">NEXT DRAW IN</p>
                <p className="mt-2 font-mono text-3xl font-bold sm:text-4xl">
                  {nextDrawAtMs === null ? (hasParticipants ? "Ready now" : "Waiting for participants") : countdown}
                </p>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">MIN · SEC</p>
                <div className="mt-5 h-px bg-gradient-to-r from-secondary/70 to-transparent" />
                <div className="mt-5 flex items-center gap-3 text-sm text-muted-foreground">
                  <Users className="size-4 shrink-0 text-secondary" />
                  {hasParticipants
                    ? `${participantCount!.toString()} participant${participantCount! === 1n ? "" : "s"} registered`
                    : "No participants registered yet"}
                </div>
                {draws.length > 0 && (
                  <div className="mt-4 rounded-lg bg-muted/40 px-4 py-3">
                    <p className="font-mono text-[10px] text-muted-foreground">LATEST WINNER</p>
                    <p className="mt-1 font-mono text-sm font-bold">
                      {draws[0]?.winnerAddress !== "—" ? draws[0]?.winnerAddress : "—"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Draw #{draws[0]?.drawId} · {draws[0]?.date}
                    </p>
                  </div>
                )}
              </div>

              <button
                onClick={doDrawAndFulfill}
                disabled={!canDraw}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-4 font-bold text-background transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-40"
              >
                {!hasParticipants ? (
                  "No participants yet"
                ) : !eligible ? (
                  <>
                    <Flame className="size-5" />
                    Cooldown active — {countdown}
                  </>
                ) : (
                  <>
                    <Zap className="size-5" />
                    Draw &amp; reveal winner
                  </>
                )}
              </button>

              {isConnected && nextDrawAtMs !== null && (
                <p className="mt-3 text-center font-mono text-[10px] text-muted-foreground">
                  Auto-triggers when the timer ends if you&apos;re connected here.
                </p>
              )}
            </div>
          )}

          {!isIdle && (
            <div className="mt-8">
              <div className="glass-panel rounded-2xl p-6">
                <div className="flex items-center gap-3">
                  {phase === "done" ? (
                    <CheckCircle2 className="size-6 text-accent" />
                  ) : (
                    <Loader2 className="size-6 animate-spin text-accent" />
                  )}
                  <p className="font-mono text-xs font-bold text-accent">{phaseLabel[phase]}</p>
                </div>

                {drawId && (
                  <p className="mt-4 font-mono text-sm text-muted-foreground">
                    Draw <span className="text-foreground">#{drawId}</span>
                    {phase === "decrypting" && " — waiting for KMS gateway…"}
                    {phase === "fulfilling" && " — submitting fulfillWinner…"}
                  </p>
                )}

                {winner && (
                  <div className="mt-5">
                    <p className="font-mono text-[10px] text-muted-foreground">WINNER</p>
                    <p className="mt-1 font-mono text-lg font-bold break-all text-foreground">{shortHex(winner)}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground break-all">{winner}</p>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Prize is encrypted — only the winner can decrypt it.
                    </p>
                    <Link
                      href="/account"
                      className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 font-bold text-background transition-transform hover:-translate-y-0.5"
                    >
                      Go to Account to claim <ArrowRight className="size-4" />
                    </Link>
                  </div>
                )}
              </div>

              {phase === "done" && (
                <button
                  onClick={reset}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full border border-border px-5 py-3 font-bold text-foreground transition-colors hover:bg-muted"
                >
                  Trigger another draw
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-8">
          <FheOrb decrypted={phase === "done"} compact variant="prize" />
          <div className="glass-panel rounded-2xl p-6 text-center">
            <p className="font-mono text-sm font-bold text-accent">NEXT DRAW IN</p>
            <p className="mt-3 font-mono text-4xl font-bold sm:text-5xl">
              {nextDrawAtMs === null ? (hasParticipants ? "Ready" : "—") : countdown}
            </p>
            <p className="mt-2 font-mono text-xs text-muted-foreground">MIN · SEC</p>
          </div>
        </div>
      </div>
    </main>
  );
}
