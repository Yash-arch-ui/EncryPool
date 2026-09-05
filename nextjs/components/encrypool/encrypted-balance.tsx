"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { DecryptionProgress } from "~~/components/encrypool/decryption-progress";
import { useEncryptedBalance } from "~~/hooks/encrypool/use-encrypool";

export function EncryptedBalance({ onDecrypt }: { onDecrypt?: (value: boolean) => void }) {
  const { encryptedBalance, decryptedBalance, canDecrypt, isDecrypting, requestDecrypt } = useEncryptedBalance();
  const [decrypted, setDecrypted] = useState(false);
  const [showProgress, setShowProgress] = useState(false);

  useEffect(() => {
    if (decryptedBalance !== undefined && !decrypted) {
      setDecrypted(true);
      setShowProgress(false);
      onDecrypt?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decryptedBalance]);

  useEffect(() => {
    if (!isDecrypting) setShowProgress(false);
  }, [isDecrypting]);

  const toggle = () => {
    if (decrypted) {
      setDecrypted(false);
      onDecrypt?.(false);
      return;
    }
    setShowProgress(true);
    requestDecrypt();
  };

  const display = decrypted && decryptedBalance !== undefined ? decryptedBalance : encryptedBalance;

  return (
    <section className="glass-panel rounded-3xl p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] text-muted-foreground">YOUR ENCRYPTED BALANCE</p>
          <p
            className={`mt-3 font-mono text-xl font-bold sm:text-2xl ${decrypted ? "text-accent" : "text-foreground"}`}
          >
            {display}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={!decrypted && (!canDecrypt || isDecrypting)}
          title={!decrypted && !canDecrypt ? "Connect a wallet with a position in this vault" : undefined}
          className="flex items-center gap-2 rounded-full border border-secondary/40 bg-secondary/10 px-4 py-3 text-sm font-bold text-secondary hover:bg-secondary hover:text-secondary-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {decrypted ? <EyeOff /> : <Eye />}
          {isDecrypting && !decrypted ? "Decrypting…" : decrypted ? "Hide" : "Decrypt"}
        </button>
      </div>
      <div className="mt-6 h-px bg-gradient-to-r from-secondary/70 to-transparent" />
      <DecryptionProgress active={showProgress && isDecrypting && !decrypted} />
      {!showProgress && (
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Decryption exists only for this wallet session. Plaintext never touches the public chain.
        </p>
      )}
    </section>
  );
}
