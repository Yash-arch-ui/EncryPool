"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAllow, useEncrypt, useIsAllowed, useUserDecrypt } from "@zama-fhe/react-sdk";
import { ZERO_HANDLE } from "@zama-fhe/sdk";
import { type Address, bytesToHex } from "viem";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import {
  encrypoolChainId,
  erc7984Abi,
  formatEncryptedAmount,
  isZeroHandle,
  maskHandle,
  vaultDeployment,
} from "~~/hooks/encrypool/shared";

/**
 * Real encrypted position of the connected wallet in ConfidentialPrizeVault.
 *
 * - Reads the position handle via `positionOf` (public ciphertext).
 * - Decrypts ONLY on explicit request (decrypt-on-demand, matching the UI):
 *   Zama user-decryption flow — keypair + EIP-712 credential via useAllow,
 *   then useUserDecrypt. Plaintext never leaves the wallet session.
 * - Builds encrypted deposit/withdraw inputs via the SDK's useEncrypt and
 *   submits `(externalEuint64, inputProof)` pairs to the contract.
 */
export function useEncryptedBalance() {
  const { address, isConnected } = useAccount();
  const vault = vaultDeployment();

  const { data: asset } = useReadContract({
    address: vault?.address,
    abi: vault?.abi,
    functionName: "asset" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(vault) },
  });
  const tokenAddress = asset as `0x${string}` | undefined;

  const { data: symbol } = useReadContract({
    address: tokenAddress,
    abi: erc7984Abi,
    functionName: "symbol" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(tokenAddress) },
  });
  const { data: decimals } = useReadContract({
    address: tokenAddress,
    abi: erc7984Abi,
    functionName: "decimals" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(tokenAddress) },
  });

  const positionResult = useReadContract({
    address: vault?.address,
    abi: vault?.abi,
    functionName: "positionOf" as const,
    args: [address as Address],
    chainId: encrypoolChainId,
    query: { enabled: Boolean(vault && isConnected && address) },
  });

  const handle = useMemo(() => (positionResult.data as string | undefined) ?? undefined, [positionResult.data]);
  const hasPosition = Boolean(handle && !isZeroHandle(handle));
  const encryptedBalance = maskHandle(handle);

  // ── User decryption (on demand only) ─────────────────────────────────────
  const { mutate: allow, isPending: isAllowing } = useAllow();
  const credentialContract = (vault?.address ?? "0x0000000000000000000000000000000000000000") as `0x${string}`;
  const { data: isAllowed } = useIsAllowed({ contractAddresses: [credentialContract] });

  const [decryptRequested, setDecryptRequested] = useState(false);
  useEffect(() => {
    // New wallet or refetched position → previous cleartext is stale.
    setDecryptRequested(false);
  }, [address, handle]);

  const decryptHandles = useMemo(() => {
    if (!handle || isZeroHandle(handle) || !vault) return [];
    return [{ handle: handle as `0x${string}`, contractAddress: vault.address }];
  }, [handle, vault]);

  const decryptQuery = useUserDecrypt({ handles: decryptHandles }, { enabled: decryptRequested && !!isAllowed });

  const decryptedValue = useMemo(() => {
    if (!handle || !decryptQuery.data) return undefined;
    return decryptQuery.data[handle as `0x${string}`];
  }, [handle, decryptQuery.data]);

  const decryptedBalance = useMemo(() => {
    if (decryptedValue === undefined || typeof decryptedValue !== "bigint") return undefined;
    return formatEncryptedAmount(decryptedValue, Number(decimals ?? 6), (symbol as string) ?? "USDC");
  }, [decryptedValue, decimals, symbol]);

  const refreshPosition = useCallback(async () => {
    await positionResult.refetch();
  }, [positionResult]);

  /**
   * Explicit "Decrypt" click. First click acquires the FHE credential
   * (EIP-712 signature) if needed; once allowed, starts the user-decryption
   * query. The plaintext lands via `decryptedBalance` when ready.
   */
  const requestDecrypt = useCallback(() => {
    if (!vault || !hasPosition || !address) return;
    if (!isAllowed) {
      allow([vault.address]);
      return;
    }
    setDecryptRequested(true);
  }, [vault, hasPosition, address, isAllowed, allow]);

  const isDecrypting = decryptQuery.isFetching || isAllowing;

  // ── Encrypted writes (deposit / withdraw / fundPrize-style flows) ────────
  const encrypt = useEncrypt();
  const { writeContractAsync } = useWriteContract();

  const submitEncryptedAmount = useCallback(
    async (amount: bigint, action: "deposit" | "withdraw"): Promise<{ ok: boolean; hash?: string; error?: string }> => {
      if (!vault || !address || !isConnected) return { ok: false, error: "Wallet not connected" };
      try {
        const enc = await encrypt.mutateAsync({
          values: [{ value: amount, type: "euint64" }],
          contractAddress: vault.address,
          userAddress: address,
        });
        // FHE ops are gas-intensive — stay below Sepolia's block gas limit.
        const hash = await writeContractAsync({
          address: vault.address,
          abi: vault.abi,
          functionName: action,
          args: [bytesToHex(enc.handles[0]!), bytesToHex(enc.inputProof)],
          gas: 15_000_000n,
        });
        return { ok: true, hash };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [vault, address, isConnected, encrypt, writeContractAsync],
  );

  return {
    /** masked ciphertext string, e.g. `0x8F3A••••••••B91C` */
    encryptedBalance,
    /** formatted plaintext after explicit decrypt, e.g. `2,480.50 cUSDT` */
    decryptedBalance,
    hasPosition,
    isZero: isZeroHandle(handle),
    handle: handle === ZERO_HANDLE ? ZERO_HANDLE : (handle as `0x${string}` | undefined),
    canDecrypt: Boolean(isConnected && address && hasPosition),
    isDecrypting,
    requestDecrypt,
    refreshPosition,
    submitEncryptedAmount,
    isSubmitting: encrypt.isPending,
    symbol: (symbol as string) ?? "USDC",
    decimals: Number(decimals ?? 6),
    tokenAddress,
  };
}
