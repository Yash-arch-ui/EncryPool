"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, LockKeyhole } from "lucide-react";
import toast from "react-hot-toast";
import { parseUnits } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { EncryptedBalance } from "~~/components/encrypool/encrypted-balance";
import { FheOrb } from "~~/components/encrypool/fhe-orb";
import { MetallicVaultMark } from "~~/components/encrypool/metallic-vault-mark";
import { encrypoolChainId, erc7984Abi, poolDeployment, vaultDeployment } from "~~/hooks/encrypool/shared";
import { formatCountdown, useDrawHistory } from "~~/hooks/encrypool/use-encrypool";
import { useEncryptedBalance } from "~~/hooks/encrypool/useEncryptedBalance";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

// abitype maps uint48 -> number (fits safely); MaxUint48 as a plain number
const MAX_UINT48 = 2 ** 48 - 1;

export default function VaultDetailPage() {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const energized = mode === "deposit" && Number(amount) > 0;

  const { address, isConnected } = useAccount();
  const vault = vaultDeployment();
  const pool = poolDeployment();
  const { nextDrawAtMs } = useDrawHistory();
  const { refreshPosition, submitEncryptedAmount, symbol, decimals, tokenAddress, hasPosition } = useEncryptedBalance();

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── ERC-7984 operator approval (required once before the first deposit):
  // the vault pulls confidential tokens on the user's behalf.
  const { data: isOperator, refetch: refetchOperator } = useReadContract({
    address: tokenAddress,
    abi: erc7984Abi,
    functionName: "isOperator" as const,
    args: [address!, vault!.address],
    query: { enabled: Boolean(tokenAddress && address && vault && isConnected) },
  });

  const { writeContractAsync } = useWriteContract();

  const { data: participantCount, refetch: refetchParticipantCount } = useReadContract({
    address: pool?.address,
    abi: pool?.abi,
    functionName: "participantCount" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(pool) },
  });
  const [latestCount, setLatestCount] = useState<bigint | undefined>(
    typeof participantCount === "bigint" ? participantCount : undefined,
  );
  useEffect(() => {
    if (typeof participantCount === "bigint") setLatestCount(participantCount);
  }, [participantCount]);

  const parsedAmount = useMemo(() => {
    try {
      if (!amount || Number(amount) <= 0) return undefined;
      return parseUnits(amount as `${number}`, decimals);
    } catch {
      return undefined;
    }
  }, [amount, decimals]);

  const needsApproval = mode === "deposit" && isConnected && isOperator === false;

  const submit = async () => {
    if (!isConnected || !address || !vault) {
      toast.error("Connect your wallet first");
      return;
    }
    if (!parsedAmount) {
      toast.error("Enter a valid amount");
      return;
    }
    const isFirstDeposit = !hasPosition;
    setBusy(true);
    try {
      if (mode === "deposit" && !isOperator && tokenAddress) {
        toast.loading("Approving vault as confidential operator…", { id: "approve", duration: Infinity });
        const approveTx = await writeContractAsync({
          address: tokenAddress,
          abi: erc7984Abi,
          functionName: "setOperator",
          args: [vault.address, MAX_UINT48],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveTx });
        toast.dismiss("approve");
        toast.success("Vault approved as operator");
        refetchOperator();
      }

      toast.loading(`Encrypting ${mode} amount client-side…`, { id: "tx", duration: Infinity });
      const res = await submitEncryptedAmount(parsedAmount, mode);
      toast.dismiss("tx");
      if (res.ok) {
        let freshCount: bigint | undefined;
        if (res.hash && isFirstDeposit && mode === "deposit") {
          toast.loading("Waiting for confirmation…", { id: "tx", duration: Infinity });
          await waitForTransactionReceipt(wagmiConfig, { hash: res.hash as `0x${string}` });
          const result = await refetchParticipantCount();
          if (typeof result.data === "bigint") {
            freshCount = result.data;
            setLatestCount(freshCount);
          }
          toast.dismiss("tx");
        }
        if (isFirstDeposit && mode === "deposit") {
          const count = freshCount ?? (typeof latestCount === "bigint" ? latestCount : undefined);
          const nextCount = count !== undefined ? Number(count) + 1 : "?";
          toast.success(
            <span>
              <strong>Welcome to the pool! You are registered as participant #{nextCount}!</strong>
              <br />
              <span style={{ fontSize: "0.85em", opacity: 0.85 }}>
                You&apos;re now eligible for every future draw. Good luck!
              </span>
            </span>,
            { duration: 10000, icon: "🎉" },
          );
        } else {
          toast.success(`${mode === "deposit" ? "Deposit" : "Withdraw"} submitted — ciphertext sealed on Sepolia`, {
            duration: 6000,
          });
        }
        setAmount("");
        await refreshPosition();
      } else {
        const msg = res.error ?? "";
        if (msg.includes("MaxPoolFull") || msg.includes("MaxParticipantsReached")) {
          toast.error("This vault is full — maximum participants reached. Try again after the next draw.", {
            duration: 8000,
          });
        } else {
          toast.error(msg || "Transaction failed");
        }
      }
    } catch (e) {
      toast.dismiss("tx");
      toast.dismiss("approve");
      toast.error(e instanceof Error ? e.message.slice(0, 160) : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl px-5 py-14 lg:px-8">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-xs font-bold text-primary">{symbol.toUpperCase()} · SEPOLIA · LIVE</p>
          <h1 className="mt-3 text-balance font-serif text-4xl font-bold sm:text-6xl">
            Encrypool {symbol.toUpperCase()} Vault
          </h1>
        </div>
        <div className="flex gap-3">
          <div className="glass-panel rounded-2xl p-4">
            <p className="font-mono text-[10px] text-muted-foreground">PARTICIPANTS</p>
            <p className="mt-1 font-mono text-xl font-bold">
              {typeof latestCount === "bigint" ? latestCount.toString() : "—"}
            </p>
          </div>
          <div className="glass-panel rounded-2xl p-4">
            <p className="font-mono text-[10px] text-muted-foreground">NEXT DRAW</p>
            <p className="mt-1 font-mono text-xl font-bold text-accent">{formatCountdown(nextDrawAtMs, now ?? 0)}</p>
          </div>
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
              onChange={event => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              className="min-w-0 flex-1 bg-transparent py-5 font-mono text-2xl outline-none"
            />
            <strong className="font-mono">{symbol.toUpperCase()}</strong>
          </div>
          <p className="mt-3 flex gap-2 text-sm leading-relaxed text-muted-foreground">
            <LockKeyhole className="mt-0.5 shrink-0 text-secondary" />
            Your input is encrypted client-side before it reaches the chain.
          </p>
          <button
            onClick={submit}
            disabled={busy || !parsedAmount}
            className="mt-8 flex w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 py-4 font-bold text-background disabled:pointer-events-none disabled:opacity-50"
          >
            {mode === "deposit" ? <ArrowDownToLine /> : <ArrowUpFromLine />}
            {busy
              ? "Waiting for confirmation…"
              : mode === "deposit"
                ? needsApproval
                  ? "Approve & encrypt-deposit"
                  : hasPosition
                    ? "Encrypt & deposit"
                    : "Join vault"
                : "Decrypt & withdraw"}
          </button>
        </section>
        <div className="flex flex-col gap-6">
          <div className="glass-panel relative rounded-3xl">
            <MetallicVaultMark symbol={symbol} />
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
