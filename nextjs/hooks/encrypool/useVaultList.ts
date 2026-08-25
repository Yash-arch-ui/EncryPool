"use client";

import { useMemo } from "react";
import { useReadContract } from "wagmi";
import { encrypoolChainId, erc7984Abi, poolDeployment, vaultDeployment } from "~~/hooks/encrypool/shared";

/**
 * Real vault list read from the deployed ConfidentialPrizeVault. There is a
 * single live vault; its asset symbol, prize pool linkage and participant
 * count are all read on-chain (Sepolia). Amounts stay encrypted on-chain, so
 * TVL remains ciphertext by design.
 */
export function useVaultList() {
  const vault = vaultDeployment();
  const pool = poolDeployment();

  const { data: asset } = useReadContract({
    address: vault?.address,
    abi: vault?.abi,
    functionName: "asset" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(vault) },
  });

  const { data: symbol } = useReadContract({
    address: asset as `0x${string}` | undefined,
    abi: erc7984Abi,
    functionName: "symbol" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(asset) },
  });

  const { data: participantCount } = useReadContract({
    address: pool?.address,
    abi: pool?.abi,
    functionName: "participantCount" as const,
    chainId: encrypoolChainId,
    query: { enabled: Boolean(pool) },
  });

  return useMemo(() => {
    if (!vault) return [];
    const label = (symbol as string) || "USDC";
    const count = typeof participantCount === "bigint" ? Number(participantCount) : 0;
    return [
      {
        vaultAddress: vault.address as string,
        chainId: encrypoolChainId,
        name: `Encrypool ${label} Vault`,
        asset: label,
        chance: count > 0 ? `1 in ${count.toLocaleString("en-US")}` : "—",
      },
    ];
  }, [vault, symbol, participantCount]);
}
