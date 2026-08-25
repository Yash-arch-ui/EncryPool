"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useEncryptedBalance } from "~~/hooks/encrypool/use-encrypool";

export function EncryptedBalance({ onDecrypt }: { onDecrypt?: (value: boolean) => void }) {
  const { encryptedBalance, decryptedBalance } = useEncryptedBalance();
  const [decrypted, setDecrypted] = useState(false);
  const toggle = () => {
    setDecrypted(!decrypted);
    onDecrypt?.(!decrypted);
  };
  return (
    <section className="glass-panel rounded-3xl p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-muted-foreground">YOUR ENCRYPTED BALANCE</p>
          <p
            className={`mt-3 font-mono text-xl font-bold sm:text-2xl ${decrypted ? "text-accent" : "text-foreground"}`}
          >
            {decrypted ? decryptedBalance : encryptedBalance}
          </p>
        </div>
        <button
          onClick={toggle}
          className="flex items-center gap-2 rounded-full border border-secondary/40 bg-secondary/10 px-4 py-3 text-sm font-bold text-secondary hover:bg-secondary hover:text-secondary-foreground"
        >
          {decrypted ? <EyeOff /> : <Eye />}
          {decrypted ? "Hide" : "Decrypt"}
        </button>
      </div>
      <div className="mt-6 h-px bg-gradient-to-r from-secondary/70 to-transparent" />
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        Decryption exists only for this wallet session. Plaintext never touches the public chain.
      </p>
    </section>
  );
}
