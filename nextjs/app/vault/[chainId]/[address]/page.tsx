"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, LockKeyhole } from "lucide-react";
import { EncryptedBalance } from "~~/components/encrypool/encrypted-balance";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { MetallicVaultMark } from "~~/components/encrypool/metallic-vault-mark";

export default function VaultDetailPage() {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const energized = mode === "deposit" && Number(amount) > 0;
  return (
    <main className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs font-bold text-primary">USDC · SEPOLIA · LIVE</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">Encrypool USDC Vault</h1>
        </div>
        <div className="glass-panel rounded-2xl p-4">
          <p className="font-mono text-[10px] text-muted-foreground">NEXT DRAW</p>
          <p className="mt-1 font-mono text-xl font-bold text-accent">02:14:37:09</p>
        </div>
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section className="glass-panel rounded-3xl p-6">
          <div className="grid grid-cols-2 gap-2 rounded-full border border-border bg-background/70 p-1.5">
            <button
              onClick={() => setMode("deposit")}
              className={`rounded-full px-4 py-3 font-bold ${mode === "deposit" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Deposit
            </button>
            <button
              onClick={() => setMode("withdraw")}
              className={`rounded-full px-4 py-3 font-bold ${mode === "withdraw" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              Withdraw
            </button>
          </div>
          <label htmlFor="amount" className="mt-8 block font-mono text-[10px] text-muted-foreground">
            AMOUNT
          </label>
          <div className="mt-2 flex items-center rounded-2xl border border-input bg-background/70 px-4 focus-within:border-primary">
            <input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={event => setAmount(event.target.value)}
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent py-5 font-mono text-2xl outline-none"
            />
            <strong className="font-mono">USDC</strong>
          </div>
          <p className="mt-3 flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <LockKeyhole className="mt-0.5 shrink-0 text-secondary" />
            Your input is encrypted client-side before it reaches the chain.
          </p>
          <button className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-4 font-bold text-background">
            {mode === "deposit" ? <ArrowDownToLine /> : <ArrowUpFromLine />}
            {mode === "deposit" ? "Encrypt & deposit" : "Decrypt & withdraw"}
          </button>
        </section>
        <div className="flex flex-col gap-6">
          <div className="glass-panel relative rounded-3xl">
            <MetallicVaultMark />
            <div className="mt-6">
              <FheOrb decrypted={energized} compact variant="vault" />
            </div>
            <p className="absolute inset-x-5 bottom-4 text-center font-mono text-[10px] text-secondary">
              {energized ? "ENCRYPTION FIELD CHARGED" : "ENCRYPTION FIELD STANDBY"}
            </p>
          </div>
          <EncryptedBalance />
        </div>
      </div>
    </main>
  );
}
