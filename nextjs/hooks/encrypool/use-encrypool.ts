"use client";

/**
 * Encrypool contract hooks — real Sepolia reads/writes.
 * Kept as a barrel so page imports stay `~~/hooks/encrypool/use-encrypool`.
 */
export { useVaultList } from "~~/hooks/encrypool/useVaultList";
export { useEncryptedBalance } from "~~/hooks/encrypool/useEncryptedBalance";
export { useDrawHistory, formatCountdown, type DrawRow, type DrawHistory } from "~~/hooks/encrypool/useDrawHistory";
