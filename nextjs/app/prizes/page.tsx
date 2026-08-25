"use client";

import { LockKeyhole } from "lucide-react";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { useDrawHistory } from "~~/hooks/encrypool/use-encrypool";

export default function PrizesPage() {
  const draws = useDrawHistory();
  return (
    <main className="mx-auto min-h-[75vh] max-w-6xl px-5 py-16 lg:px-8">
      <div className="glass-panel grid items-center overflow-hidden rounded-[2rem] p-7 sm:grid-cols-[1fr_.75fr] sm:p-10">
        <div>
          <p className="font-mono text-xs font-bold text-accent">NEXT VERIFIED DRAW</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">Prize history</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
            Winner addresses are public for proof. Prize amounts stay encrypted for the winner alone.
          </p>
          <div className="mt-8">
            <p className="font-mono text-3xl font-bold sm:text-4xl">02:14:37:09</p>
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">DAYS · HRS · MIN · SEC</p>
          </div>
        </div>
        <FheOrb compact variant="prize" />
      </div>
      <div className="mt-10 flex flex-col gap-4">
        {draws.map((draw, i) => (
          <AnimatedContent key={draw.drawId} delay={i * 0.08}>
            <article className="glass-panel grid items-center gap-4 rounded-2xl p-5 sm:grid-cols-[.7fr_1fr_1fr_1fr]">
              <p className="font-mono text-sm font-bold text-primary">DRAW #{draw.drawId}</p>
              <p className="text-sm text-muted-foreground">{draw.date}</p>
              <p className="font-mono text-sm">{draw.winnerAddress}</p>
              <p className="flex items-center gap-2 font-mono text-sm font-bold">
                <LockKeyhole className="text-secondary" />
                {draw.prizeAmount.replace("🔒 ", "")}
              </p>
            </article>
          </AnimatedContent>
        ))}
      </div>
    </main>
  );
}
