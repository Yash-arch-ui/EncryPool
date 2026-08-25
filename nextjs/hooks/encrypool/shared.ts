import { formatUnits } from "viem";
import { ConfidentialPrizePool } from "~~/contracts/ConfidentialPrizePool";
import { ConfidentialPrizeVault } from "~~/contracts/ConfidentialPrizeVault";
import { deploymentFor } from "~~/utils/contract";

/** Shared config + helpers for the Encrypool contract hooks. */

/**
 * Encrypool is deployed on Sepolia only. Reads are pinned to this chain so
 * public state renders regardless of which network the wallet is on; writes
 * additionally require the wallet itself to be on Sepolia.
 */
export const encrypoolChainId = 11155111;

export const vaultDeployment = () => deploymentFor(ConfidentialPrizeVault, encrypoolChainId);
export const poolDeployment = () => deploymentFor(ConfidentialPrizePool, encrypoolChainId);

/** Minimal read/write surface of the vault's confidential asset (ERC-7984). */
export const erc7984Abi = [
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string", internalType: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8", internalType: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "confidentialBalanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bytes32", internalType: "euint64" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isOperator",
    inputs: [
      { name: "holder", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setOperator",
    inputs: [
      { name: "operator", type: "address", internalType: "address" },
      { name: "until", type: "uint48", internalType: "uint48" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

/** `0x8F3A••••••••B91C` — masked ciphertext display for a handle. */
export function maskHandle(handle: string | undefined | null): string {
  if (!handle || handle.length < 12) return "0x0000••••••••0000";
  return `0x${handle.slice(2, 6).toUpperCase()}••••••••${handle.slice(-4).toUpperCase()}`;
}

/** `0x7B3a...91F2` — short address/handle form used across the UI. */
export function shortHex(value: string): string {
  if (!value || value.length < 12) return value ?? "";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function formatEncryptedAmount(value: bigint, decimals: number, symbol: string): string {
  return `${Number(formatUnits(value, decimals)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${symbol}`;
}

export function isZeroHandle(handle: string | undefined | null): boolean {
  return !handle || /^0x0+$/.test(handle);
}
