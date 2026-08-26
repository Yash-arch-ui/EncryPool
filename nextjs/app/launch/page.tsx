"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useAccount } from "wagmi";

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
    <main className="relative flex min-h-[calc(100svh-73px)] items-center justify-center overflow-hidden">
      <div className="cipher-grid absolute inset-0 opacity-40" />
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-primary/10 to-transparent" />
      <section className="relative flex w-full max-w-xl flex-col items-center gap-9 px-5 py-24 text-center">
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
        <p className="font-mono text-[10px] tracking-widest text-muted-foreground">SEPOLIA TESTNET · WALLET REQUIRED</p>
      </section>
    </main>
  );
}
