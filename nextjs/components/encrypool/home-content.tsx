"use client";

import Link from "next/link";
import { ArrowRight, EyeOff, Gauge, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import BlurText from "~~/components/encrypool/BlurText";
import PrivacyGuardian from "~~/components/encrypool/PrivacyGuardian";
import TrueFocus from "~~/components/encrypool/TrueFocus";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { useDrawHistory } from "~~/hooks/encrypool/use-encrypool";

const steps = [
  ["01", "Encrypt on deposit", "Your browser encrypts your balance before it leaves the wallet."],
  ["02", "Pool sealed", "Deposits accumulate together while each balance stays encrypted."],
  ["03", "Draw on-chain", "A verifiable draw selects winners without exposing any balances."],
  ["04", "Decrypt & claim", "Only the winning wallet can decrypt and reveal its prize."],
];
const reasons = [
  [
    EyeOff,
    "Balances stay encrypted on-chain",
    "Observers see only a ciphertext hash — your balance is never published.",
  ],
  [
    Gauge,
    "Encrypted amounts, no targeting",
    "Since balances are sealed, attackers cannot front-run or target high-value accounts.",
  ],
  [
    ShieldCheck,
    "Winners reveal, everyone else stays hidden",
    "Decryption only works for the winning wallet, so all other balances stay sealed.",
  ],
];

export function HomeContent() {
  const { drawCount, isLoading: drawsLoading } = useDrawHistory();
  const drawCountLabel = drawsLoading ? "…" : String(drawCount);
  return (
    <main className="overflow-hidden">
      <section className="relative min-h-[calc(100svh-73px)] border-b border-border/70">
        <div className="cipher-grid absolute inset-0 opacity-45" />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-primary/10 to-transparent" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-6 px-5 py-12 lg:min-h-[760px] lg:grid-cols-[.95fr_1.05fr] lg:px-8 lg:py-20">
          <div className="z-10 flex flex-col items-start gap-7">
            <div className="flex items-center gap-2 rounded-full border border-secondary/30 bg-secondary/10 px-4 py-2 font-mono text-xs text-secondary">
              <span className="size-1.5 rounded-full bg-secondary shadow-[0_0_10px_var(--secondary)]" /> PRIVATE SAVINGS
              · PUBLIC PROOF
            </div>
            <BlurText
              text="Save encrypted. Win verified."
              animateBy="words"
              delay={120}
              className="text-balance font-serif text-[2.7rem] font-bold leading-[.96] tracking-tight sm:text-[4.05rem] lg:text-[5.4rem] max-w-3xl"
            />
            <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Deposit and withdraw anytime — your balance stays encrypted the whole time you hold it. Prizes are funded
              by the pool and every draw is provably fair on-chain.
            </p>
            <div className="flex flex-wrap items-center gap-5">
              <Link
                href="/launch"
                aria-label="Use Encrypool"
                className="group relative flex size-32 shrink-0 items-center justify-center overflow-hidden rounded-[1.75rem] bg-primary text-primary-foreground shadow-[0_0_44px_color-mix(in_srgb,var(--primary)_38%,transparent)] transition-transform duration-300 hover:-translate-y-1"
              >
                <span
                  aria-hidden
                  className="absolute inset-0 animate-glowpulse rounded-[1.75rem] bg-secondary/40 blur-xl"
                />
                <span
                  aria-hidden
                  className="absolute -inset-12 animate-spinslow bg-[conic-gradient(from_0deg,transparent_0%,transparent_58%,color-mix(in_srgb,var(--secondary)_80%,transparent)_78%,transparent_96%)]"
                />
                <span aria-hidden className="absolute inset-[3px] rounded-[1.45rem] bg-primary" />
                <span className="relative flex flex-col items-center gap-1.5 font-mono text-xs font-bold leading-relaxed tracking-[0.18em]">
                  <span>USE</span>
                  <span>ENCRYPOOL</span>
                  <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
                </span>
              </Link>
              <span className="font-mono text-xs text-muted-foreground">NO CUSTODY · NO BALANCE LEAKS</span>
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-x-[15%] top-[15%] aspect-square rounded-full bg-primary/10 blur-3xl" />
            <FheOrb />
            <div className="glass-panel absolute bottom-8 left-[55%] -translate-x-1/2 rounded-2xl px-5 py-3 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_30px_color-mix(in_srgb,var(--secondary)_30%,transparent)]">
              <p className="font-mono text-[10px] text-muted-foreground">ENCRYPTION STATUS</p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <span className="size-2 rounded-full bg-secondary shadow-[0_0_10px_var(--secondary)]" />
                FHE circuit online
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-border bg-card/45">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-3 lg:px-8">
          {[
            ["TOTAL DEPOSITED", "ENCRYPTED"],
            ["DRAWS VERIFIED", drawCountLabel],
            ["NETWORK", "SEPOLIA"],
          ].map(([k, v], index) => (
            <div
              key={k}
              className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/40 px-5 py-4"
            >
              <span className="font-mono text-[10px] text-muted-foreground">{k}</span>
              <strong className={`font-mono text-sm ${index === 0 ? "text-secondary" : ""}`}>{v}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-5 py-24 lg:px-8">
        <AnimatedContent>
          <TrueFocus
            sentence="THE ENCRYPTED DRAW CYCLE"
            blurAmount={4}
            borderColor="var(--primary)"
            glowColor="rgba(255, 107, 74, 0.5)"
            animationDuration={0.6}
            pauseBetweenAnimations={1.2}
            className="text-3xl sm:text-4xl md:text-5xl tracking-wider"
          />
        </AnimatedContent>
        <div className="loop-wire-container mt-20">
          <svg className="loop-wire-svg" viewBox="0 0 1100 480" preserveAspectRatio="xMidYMid meet">
            <defs>
              <filter id="wire-glow">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="node-glow">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="wire-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.1" />
                <stop offset="50%" stopColor="var(--secondary)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.1" />
              </linearGradient>
              <linearGradient id="wire-grad-v" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="var(--secondary)" stopOpacity="0.1" />
                <stop offset="50%" stopColor="var(--secondary)" stopOpacity="0.9" />
                <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.1" />
              </linearGradient>
              <radialGradient id="node-fill">
                <stop offset="0%" stopColor="var(--secondary)" stopOpacity="1" />
                <stop offset="100%" stopColor="var(--secondary)" stopOpacity="0.4" />
              </radialGradient>
            </defs>
            <path
              className="loop-wire-path"
              d="M 250 130 L 850 130"
              fill="none"
              stroke="url(#wire-grad)"
              strokeWidth="1.5"
              filter="url(#wire-glow)"
              strokeDasharray="10 6"
            />
            <path
              className="loop-wire-path"
              d="M 850 130 L 850 390"
              fill="none"
              stroke="url(#wire-grad-v)"
              strokeWidth="1.5"
              filter="url(#wire-glow)"
              strokeDasharray="10 6"
            />
            <path
              className="loop-wire-path"
              d="M 850 390 L 250 390"
              fill="none"
              stroke="url(#wire-grad)"
              strokeWidth="1.5"
              filter="url(#wire-glow)"
              strokeDasharray="10 6"
            />
            <path
              className="loop-wire-path"
              d="M 250 390 L 250 130"
              fill="none"
              stroke="url(#wire-grad-v)"
              strokeWidth="1.5"
              filter="url(#wire-glow)"
              strokeDasharray="10 6"
            />
            <circle cx="250" cy="130" r="5" fill="url(#node-fill)" filter="url(#node-glow)" className="loop-node" />
            <circle cx="850" cy="130" r="5" fill="url(#node-fill)" filter="url(#node-glow)" className="loop-node" />
            <circle cx="850" cy="390" r="5" fill="url(#node-fill)" filter="url(#node-glow)" className="loop-node" />
            <circle cx="250" cy="390" r="5" fill="url(#node-fill)" filter="url(#node-glow)" className="loop-node" />
          </svg>
          <div className="loop-wire-grid">
            {steps.map(([num, title, text], i) => (
              <AnimatedContent key={title} delay={i * 0.1}>
                <article className="loop-card group relative h-full overflow-hidden rounded-2xl p-4">
                  <div className="absolute right-0 top-0 size-20 bg-gradient-to-bl from-primary/8 to-transparent" />
                  <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-secondary/5 via-transparent to-transparent" />
                  <span className="relative font-mono text-[10px] font-semibold text-primary/80 tracking-wider">
                    {num}
                  </span>
                  <div className="relative mt-5 size-2 rounded-full bg-secondary shadow-[0_0_14px_var(--secondary),0_0_28px_var(--secondary)]" />
                  <h3 className="relative mt-3 font-serif text-lg font-bold text-foreground/90">{title}</h3>
                  <p className="relative mt-2 text-xs leading-relaxed text-muted-foreground/80">{text}</p>
                </article>
              </AnimatedContent>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-border bg-card/35">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 py-20 lg:grid-cols-2 lg:px-8">
          <div>
            <p className="font-mono text-xs font-bold text-secondary">CONFIDENTIAL BY DESIGN</p>
            <h2 className="mt-4 text-balance font-serif text-4xl font-bold sm:text-6xl">
              Privacy is the protocol, not a setting.
            </h2>
            <div className="mt-9 flex flex-col gap-4">
              {reasons.map(([Icon, title, text]) => {
                const I = Icon as typeof LockKeyhole;
                return (
                  <article
                    key={String(title)}
                    className="flex gap-4 rounded-2xl border border-border/70 bg-background/50 p-5"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <I />
                    </span>
                    <div>
                      <h3 className="font-serif text-xl font-bold">{String(title)}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{String(text)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-center">
            <PrivacyGuardian />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-24 text-center">
        <Sparkles className="mx-auto text-accent" />
        <h2 className="mt-5 text-balance font-serif text-4xl font-bold sm:text-6xl">
          <span className="energy-text">Your balance belongs to you.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-2xl text-muted-foreground">
          Deposit, hold, and verify — all without revealing your balance.
        </p>
        <Link
          href="/vaults"
          className="mt-8 inline-flex items-center gap-3 rounded-full border border-primary/50 bg-primary/10 px-6 py-4 font-mono text-sm font-bold text-primary hover:bg-primary hover:text-primary-foreground"
        >
          Explore active vaults <ArrowRight />
        </Link>
      </section>
    </main>
  );
}
