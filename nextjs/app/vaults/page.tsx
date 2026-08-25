"use client";

import Link from "next/link";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import SpotlightCard from "~~/components/encrypool/SpotlightCard";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { useVaultList } from "~~/hooks/encrypool/use-encrypool";

export default function VaultsPage() {
  const vaults = useVaultList();
  return (
    <main className="relative mx-auto min-h-[75vh] max-w-7xl px-5 py-16 lg:px-8">
      <div className="cipher-grid pointer-events-none absolute inset-x-0 top-0 h-96 opacity-30" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[1.15fr_.85fr]">
        <div>
          <p className="font-mono text-xs font-bold text-primary">PRIZE VAULTS</p>
          <h1 className="mt-4 max-w-3xl text-balance font-serif text-5xl font-bold sm:text-7xl">
            Save privately. Win publicly.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Every deposit preserves principal, enters the pooled draw, and remains hidden behind FHE.
          </p>
        </div>
        <div className="glass-panel rounded-[2rem]">
          <FheOrb compact variant="vault" />
        </div>
      </div>
      <div className="relative mt-12 grid gap-6 lg:grid-cols-2">
        {vaults.map(v => (
          <SpotlightCard
            key={v.vaultAddress}
            spotlightColor="rgba(46, 196, 182, 0.16)"
            className="border-border bg-card/80 p-7 text-foreground"
          >
            <div className="relative">
              <div className="flex items-start justify-between gap-5">
                <span className="flex size-14 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                  <LockKeyhole />
                </span>
                <span className="rounded-full border border-secondary/30 bg-secondary/10 px-3 py-1 font-mono text-xs font-bold text-secondary">
                  {v.asset} · LIVE
                </span>
              </div>
              <h2 className="mt-10 font-serif text-3xl font-bold">{v.name}</h2>
              <div className="mt-7 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-border bg-background/60 p-5">
                  <p className="text-[10px] font-bold text-muted-foreground">ENCRYPTED TVL</p>
                  <p className="mt-2 font-mono text-sm font-bold text-secondary">CIPHERTEXT</p>
                </div>
                <div className="rounded-2xl border border-border bg-background/60 p-5">
                  <p className="text-[10px] font-bold text-muted-foreground">EST. CHANCE</p>
                  <p className="mt-2 font-mono text-sm font-bold">{v.chance}</p>
                </div>
              </div>
              <Link
                href={`/vault/${v.chainId}/${v.vaultAddress}`}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-4 font-bold text-background transition-transform hover:-translate-y-0.5"
              >
                Enter vault <ArrowUpRight />
              </Link>
            </div>
          </SpotlightCard>
        ))}
      </div>
    </main>
  );
}
