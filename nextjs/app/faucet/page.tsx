"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Droplets, ExternalLink, TestTubeDiagonal } from "lucide-react";
import toast from "react-hot-toast";
import { type Address, formatUnits, parseUnits } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import AnimatedContent from "~~/components/encrypool/AnimatedContent";
import { wagmiConfig } from "~~/services/web3/wagmiConfig";

const USDT_MOCK_ADDRESS = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0" as Address;
const CUSDT_WRAPPER_ADDRESS = "0x4E7B06D78965594eB5EF5414c357ca21E1554491" as Address;
const MINT_AMOUNT = 1_000;
const DECIMALS = 6;
const SEPOLIA_CHAIN_ID = 11155111;

const usdtMockAbi = [
  {
    type: "function" as const,
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "MAX_MINT_AMOUNT_TOKENS",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view" as const,
  },
] as const;

const cusdtWrapperAbi = [
  {
    type: "function" as const,
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view" as const,
  },
  {
    type: "function" as const,
    name: "wrap",
    inputs: [
      { name: "account", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable" as const,
  },
  {
    type: "function" as const,
    name: "confidentialBalanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view" as const,
  },
] as const;

function formatBalance(raw: bigint | undefined): string {
  if (raw === undefined) return "—";
  return Number(formatUnits(raw, DECIMALS)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function FaucetPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [isMinting, setIsMinting] = useState(false);

  const { data: underlyingBalance, refetch: refetchUnderlying } = useQuery({
    queryKey: ["faucet", "underlying", address],
    enabled: Boolean(address),
    queryFn: async () => {
      const { createPublicClient, http } = await import("viem");
      const { sepolia } = await import("viem/chains");
      const client = createPublicClient({ chain: sepolia, transport: http() });
      return client.readContract({
        address: USDT_MOCK_ADDRESS,
        abi: usdtMockAbi,
        functionName: "balanceOf",
        args: [address!],
      });
    },
  });

  const { data: confidentialBalance, refetch: refetchConfidential } = useQuery({
    queryKey: ["faucet", "confidential", address],
    enabled: Boolean(address),
    queryFn: async () => {
      const { createPublicClient, http } = await import("viem");
      const { sepolia } = await import("viem/chains");
      const client = createPublicClient({ chain: sepolia, transport: http() });
      return client.readContract({
        address: CUSDT_WRAPPER_ADDRESS,
        abi: cusdtWrapperAbi,
        functionName: "balanceOf",
        args: [address!],
      });
    },
  });

  useEffect(() => {
    if (!address) return;
    const id = setInterval(() => {
      void refetchUnderlying();
      void refetchConfidential();
    }, 8_000);
    return () => clearInterval(id);
  }, [address, refetchUnderlying, refetchConfidential]);

  const onMint = useCallback(async () => {
    if (!address) return;
    setIsMinting(true);
    try {
      toast.loading("Minting test tokens…", { id: "faucet-mint" });

      const mintAmount = parseUnits(String(MINT_AMOUNT), DECIMALS);

      toast.loading("Step 1/3 — Minting underlying USDTMock…", { id: "faucet-mint" });
      const mintTx = await writeContractAsync({
        address: USDT_MOCK_ADDRESS,
        abi: usdtMockAbi,
        functionName: "mint",
        args: [address, mintAmount],
        chainId: SEPOLIA_CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: mintTx });

      toast.loading("Step 2/3 — Approving wrapper…", { id: "faucet-mint" });
      const approveTx = await writeContractAsync({
        address: USDT_MOCK_ADDRESS,
        abi: usdtMockAbi,
        functionName: "approve",
        args: [CUSDT_WRAPPER_ADDRESS, mintAmount],
        chainId: SEPOLIA_CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTx });

      toast.loading("Step 3/3 — Wrapping into confidential cUSDT…", { id: "faucet-mint" });
      const wrapTx = await writeContractAsync({
        address: CUSDT_WRAPPER_ADDRESS,
        abi: cusdtWrapperAbi,
        functionName: "wrap",
        args: [address, mintAmount],
        chainId: SEPOLIA_CHAIN_ID,
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: wrapTx });

      toast.success(`${MINT_AMOUNT.toLocaleString()} cUSDT minted & wrapped!`, { id: "faucet-mint" });
      void refetchUnderlying();
      void refetchConfidential();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(msg.length > 160 ? msg.slice(0, 160) : msg, { id: "faucet-mint" });
    } finally {
      setIsMinting(false);
    }
  }, [address, writeContractAsync, refetchUnderlying, refetchConfidential]);

  return (
    <main className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <p className="font-mono text-xs font-bold text-secondary">TESTNET UTILITY</p>
      <h1 className="mt-3 text-balance font-serif text-5xl font-bold sm:text-7xl">Token faucet.</h1>
      <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
        Mint free test cUSDT to explore Encrypool&apos;s confidential vault. These tokens have no real value — they
        exist only on Sepolia for demonstration.
      </p>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_.6fr]">
        <section className="flex flex-col gap-6">
          {!isConnected && (
            <AnimatedContent>
              <article className="glass-panel flex items-center gap-4 rounded-2xl p-6">
                <Droplets className="size-8 text-secondary opacity-60" />
                <div>
                  <p className="font-bold">Connect your wallet</p>
                  <p className="text-sm text-muted-foreground">
                    Link your wallet to check balances and mint test tokens.
                  </p>
                </div>
              </article>
            </AnimatedContent>
          )}

          {isConnected && (
            <>
              <AnimatedContent>
                <article className="glass-panel rounded-2xl p-6">
                  <p className="font-mono text-[10px] text-muted-foreground">UNDERLYING USDTMock BALANCE</p>
                  <p className="mt-3 font-mono text-2xl font-bold">
                    {formatBalance(underlyingBalance)} <span className="text-sm text-muted-foreground">USDTMock</span>
                  </p>
                  <div className="mt-4 h-px bg-gradient-to-r from-secondary/70 to-transparent" />
                  <p className="mt-3 text-xs text-muted-foreground">
                    The plaintext token. Wrapping it converts it to confidential cUSDT used by the vault.
                  </p>
                </article>
              </AnimatedContent>

              <AnimatedContent delay={0.07}>
                <article className="glass-panel rounded-2xl p-6">
                  <p className="font-mono text-[10px] text-muted-foreground">CONFIDENTIAL cUSDT BALANCE</p>
                  <p className="mt-3 font-mono text-2xl font-bold">
                    {formatBalance(confidentialBalance)} <span className="text-sm text-muted-foreground">cUSDT</span>
                  </p>
                  <div className="mt-4 h-px bg-gradient-to-r from-primary/70 to-transparent" />
                  <p className="mt-3 text-xs text-muted-foreground">
                    The encrypted token held by the vault. Only you can decrypt its value.
                  </p>
                </article>
              </AnimatedContent>

              <AnimatedContent delay={0.14}>
                <article className="glass-panel rounded-2xl p-6">
                  <p className="font-mono text-[10px] text-muted-foreground">HOW IT WORKS</p>
                  <ol className="mt-3 flex flex-col gap-3 text-sm text-muted-foreground">
                    <li className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 font-mono text-xs font-bold text-secondary">
                        1
                      </span>
                      <span>
                        <strong className="text-foreground">Mint</strong> 1,000 USDTMock — the underlying test token.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 font-mono text-xs font-bold text-secondary">
                        2
                      </span>
                      <span>
                        <strong className="text-foreground">Approve</strong> the confidential wrapper to handle your
                        tokens.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary/15 font-mono text-xs font-bold text-secondary">
                        3
                      </span>
                      <span>
                        <strong className="text-foreground">Wrap</strong> into cUSDT — the encrypted balance recognized
                        by the vault.
                      </span>
                    </li>
                  </ol>
                </article>
              </AnimatedContent>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-6">
          <div className="rounded-3xl border border-accent/30 bg-accent/10 p-7 text-foreground">
            <TestTubeDiagonal className="text-accent" />
            <p className="mt-8 text-xs font-bold text-muted-foreground">MINT TEST cUSDT</p>
            <p className="mt-3 font-mono text-xl font-bold">
              {MINT_AMOUNT.toLocaleString()} <span className="text-sm text-muted-foreground">cUSDT</span>
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Fixed amount per request. No real value — Sepolia testnet only.
            </p>
            <button
              onClick={() => void onMint()}
              disabled={!isConnected || isMinting}
              className="mt-8 w-full rounded-full bg-accent px-4 py-3 font-bold text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              {isMinting ? "Minting…" : "Mint 1,000 test cUSDT"}
            </button>
          </div>

          <AnimatedContent delay={0.2}>
            <article className="glass-panel rounded-2xl p-6">
              <p className="font-mono text-[10px] text-muted-foreground">CONTRACT ADDRESSES</p>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">USDTMock</span>
                  <a
                    href={`https://sepolia.etherscan.io/address/${USDT_MOCK_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-xs text-secondary hover:text-foreground"
                  >
                    {USDT_MOCK_ADDRESS.slice(0, 6)}…{USDT_MOCK_ADDRESS.slice(-4)}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">cUSDT Wrapper</span>
                  <a
                    href={`https://sepolia.etherscan.io/address/${CUSDT_WRAPPER_ADDRESS}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 font-mono text-xs text-secondary hover:text-foreground"
                  >
                    {CUSDT_WRAPPER_ADDRESS.slice(0, 6)}…{CUSDT_WRAPPER_ADDRESS.slice(-4)}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              </div>
            </article>
          </AnimatedContent>
        </aside>
      </div>
    </main>
  );
}
