"use client";

/**
 * Placeholder Encrypool hooks — mock data only, kept so the merged routes
 * compile. Real contract reads/writes land in the integration pass (see
 * hooks/encrypool/ once wired).
 */

export function useVaultList() {
  return [
    {
      vaultAddress: "0x71c9...F4A2",
      chainId: 11155111,
      name: "Encrypool USDC Vault",
      asset: "USDC",
      chance: "1 in 842",
    },
  ];
}

export function useEncryptedBalance() {
  return { encryptedBalance: "0x8F3A••••••••B91C", decryptedBalance: "2,480.50 USDC" };
}

export function useDrawHistory() {
  return [
    { drawId: 1042, date: "Aug 24, 2026", winnerAddress: "0x7B3a...91F2", prizeAmount: "🔒 Encrypted" },
    { drawId: 1041, date: "Aug 17, 2026", winnerAddress: "0x18D4...A0C9", prizeAmount: "🔒 Encrypted" },
    { drawId: 1040, date: "Aug 10, 2026", winnerAddress: "0xC2F1...44B8", prizeAmount: "🔒 Encrypted" },
  ];
}
