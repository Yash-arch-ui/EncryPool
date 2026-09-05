"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Fingerprint, KeyRound, Lock, Shield } from "lucide-react";

const STEPS = [
  { label: "Generating FHE keypair", sublabel: "EIP-712 credential", icon: KeyRound, duration: 3_000 },
  { label: "Signing with wallet", sublabel: "Secure session", icon: Fingerprint, duration: 4_000 },
  { label: "Requesting KMS relay", sublabel: "Zama infrastructure", icon: Shield, duration: 6_000 },
  { label: "Decrypting ciphertext", sublabel: "FHE circuit", icon: Lock, duration: 8_000 },
] as const;

export function DecryptionProgress({ active }: { active: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(0);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      setCompletedSteps(0);
      startRef.current = null;
      return;
    }
    startRef.current = performance.now();

    const tick = () => {
      if (!startRef.current) return;
      const now = performance.now();
      setElapsed(now - startRef.current);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let acc = 0;
    for (let i = 0; i < STEPS.length; i++) {
      acc += STEPS[i].duration;
      if (elapsed < acc) {
        setCompletedSteps(i);
        return;
      }
    }
    setCompletedSteps(STEPS.length);
  }, [elapsed, active]);

  if (!active) return null;

  const totalDuration = STEPS.reduce((s, step) => s + step.duration, 0);
  const progress = Math.min((elapsed / totalDuration) * 100, 95);
  const secs = Math.floor(elapsed / 1000);
  const estimated = Math.ceil((totalDuration - elapsed) / 1000);

  return (
    <div className="mt-4 space-y-3">
      {/* Animated progress bar */}
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-secondary via-accent to-secondary transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
        <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {STEPS.map((step, i) => {
          const done = i < completedSteps;
          const current = i === completedSteps;
          const Icon = done ? CheckCircle2 : step.icon;
          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 text-xs transition-opacity duration-300 ${
                current ? "opacity-100" : done ? "opacity-60" : "opacity-30"
              }`}
            >
              <span className="relative flex size-5 shrink-0 items-center justify-center">
                <Icon
                  className={`size-4 ${done ? "text-accent" : current ? "text-secondary animate-pulse" : "text-muted-foreground"}`}
                />
                {current && <span className="absolute inset-0 animate-ping rounded-full bg-secondary/20" />}
              </span>
              <div className="flex-1 min-w-0">
                <span className={`font-mono font-bold ${current ? "text-foreground" : ""}`}>{step.label}</span>
                <span className="ml-1.5 text-muted-foreground">· {step.sublabel}</span>
              </div>
              {done && <span className="font-mono text-accent text-[10px]">✓</span>}
            </div>
          );
        })}
      </div>

      {/* Timer */}
      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground pt-1">
        <span>
          <span className="text-foreground font-bold">{secs}s</span> elapsed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-1.5 rounded-full bg-secondary animate-pulse" />~{estimated}s remaining
        </span>
      </div>
    </div>
  );
}
