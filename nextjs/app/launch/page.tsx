"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useAccount } from "wagmi";
import GlowCursor from "~~/components/encrypool/glow-cursor";

export default function LaunchPage() {
  const router = useRouter();
  const { isConnected, status } = useAccount();
  const { openConnectModal } = useConnectModal();

  useEffect(() => {
    if (isConnected) router.push("/vaults");
  }, [isConnected, router]);

  const connecting = status === "connecting";

  const handleUseEncrypool = () => {
    if (isConnected) {
      router.push("/vaults");
      return;
    }
    openConnectModal?.();
  };

  return (
    <main className="relative h-[calc(100svh-73px)] overflow-hidden">
      <GlowCursor
        color="#67E8F9"
        secondaryColor="#A78BFA"
        trailLength={40}
        trailWidth={8}
        trailTaper={0.8}
        followSpeed={0.16}
        glowIntensity={1.9}
        glowSpread={1.8}
        hotspot={0.65}
        brightness={1.25}
        opacity={1}
        pulseSpeed={1.1}
        noiseStrength={0.035}
        idleFade
        idleTimeout={750}
        fadeDuration={800}
        blendMode="screen"
        className="absolute inset-0"
      >
        <div className="cipher-grid absolute inset-0 opacity-40" />
        <section className="absolute left-1/2 top-1/2 z-10 flex w-full max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-9 px-5 py-24 text-center">
          <span className="flex size-16 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary shadow-[0_0_36px_color-mix(in_srgb,var(--primary)_30%,transparent)]">
            <LockKeyhole />
          </span>
          <div>
            <p className="font-mono text-xs font-bold text-secondary">LAUNCH SEQUENCE</p>
            <h1 className="mt-4 text-balance font-serif text-4xl font-bold sm:text-6xl">Ready to vanish?</h1>
            <p className="mt-4 text-pretty text-lg leading-relaxed text-muted-foreground">
              Connect a wallet to enter the encrypted vaults. Balances stay sealed — only winners ever decrypt.
            </p>
          </div>
          <button
            type="button"
            onClick={handleUseEncrypool}
            disabled={connecting}
            className="group flex w-full max-w-sm items-center justify-between gap-4 rounded-xl border border-primary/60 bg-primary px-7 py-4 font-mono text-sm font-bold tracking-widest text-primary-foreground shadow-[0_0_44px_color-mix(in_srgb,var(--primary)_34%,transparent)] transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
          >
            {connecting ? "CONNECTING…" : "USE ENCRYPOOL"}
            <ArrowRight className="transition-transform group-hover:translate-x-1" />
          </button>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground">
            SEPOLIA TESTNET · WALLET REQUIRED
          </p>
        </section>
      </GlowCursor>
    </main>
  );
}
