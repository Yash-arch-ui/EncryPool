"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Gift, LockKeyhole } from "lucide-react";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import { EncryptedBalance } from "~~/components/encrypool/encrypted-balance";
import { FheOrb } from "~~/components/encrypool/fhe-orb";

const activity = [
  ["Deposit", "+ 500.00 USDC", "Aug 22, 2026"],
  ["Withdraw", "− 120.00 USDC", "Aug 05, 2026"],
  ["Deposit", "+ 2,100.50 USDC", "Jul 18, 2026"],
];
export default function AccountPage() {
  const [decrypted, setDecrypted] = useState(false);
  return (
    <main className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <p className="font-mono text-xs font-bold text-primary">PRIVATE ACCOUNT</p>
      <h1 className="mt-3 text-balance font-serif text-5xl font-bold sm:text-7xl">Your quiet corner.</h1>
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
            {activity.map(([type, amount, date], i) => (
              <AnimatedContent key={date} delay={i * 0.07}>
                <article className="glass-panel flex items-center justify-between gap-4 rounded-2xl p-5">
                  <div className="flex items-center gap-4">
                    <span className="flex size-10 items-center justify-center rounded-full bg-muted">
                      {type === "Deposit" ? <ArrowDownLeft /> : <ArrowUpRight />}
                    </span>
                    <div>
                      <p className="font-bold">{type}</p>
                      <p className="text-xs text-muted-foreground">{date}</p>
                    </div>
                  </div>
                  <p className="font-mono text-sm font-bold">{amount}</p>
                </article>
              </AnimatedContent>
            ))}
          </div>
        </section>
        <aside className="rounded-3xl border border-accent/30 bg-accent/10 p-7 text-foreground">
          <Gift className="text-accent" />
          <p className="mt-8 text-xs font-bold text-muted-foreground">CLAIMABLE PRIZE</p>
          <p className="mt-3 font-mono text-xl font-bold">
            <LockKeyhole className="inline text-accent" /> Encrypted
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
            Only your wallet can check and decrypt the result.
          </p>
          <button className="mt-8 w-full rounded-full bg-accent px-4 py-3 font-bold text-accent-foreground">
            Check result
          </button>
        </aside>
      </div>
    </main>
  );
}
