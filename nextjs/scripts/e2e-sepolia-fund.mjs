/* One-shot: fund ConfidentialPrizePool prizeLiquidity with an encrypted amount
 * (same useEncrypt -> fundPrize path a sponsor would take in the UI).
 * Leaves the pool ready so the next draw's pot is claimable.
 */
import fs from "node:fs";
import { bytesToHex, createPublicClient, createWalletClient, http } from "viem";
import { sepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { RelayerNode } from "@zama-fhe/sdk/node";
import { SepoliaConfig } from "@zama-fhe/sdk";

const POOL = "0xc866E74cA50f84e7986CE8c92755D50Bd13AB2B6";
const VAULT = "0xDD490eD46A6fe28e807500Bf7482b24d9077a812";

const tokenAbi = [
  { type: "function", name: "isOperator", inputs: [{ name: "holder", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" },
  { type: "function", name: "setOperator", inputs: [{ name: "operator", type: "address" }, { name: "until", type: "uint48" }], outputs: [], stateMutability: "nonpayable" },
];
const vaultAbi = [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }];
const poolAbi = [
  { type: "function", name: "fundPrize", inputs: [{ name: "encryptedAmount", type: "bytes32" }, { name: "inputProof", type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
];

const env = Object.fromEntries(
  fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8").trim().split(/\r?\n/).map(l => l.split("=")),
);
const pkRaw = env.PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC, { timeout: 120_000 }) });
console.log("wallet:", account.address);

const relayer = new RelayerNode({
  transports: { [SepoliaConfig.chainId]: SepoliaConfig },
  getChainId: async () => 11155111,
  poolSize: 1,
});

async function txHash(label, fn) {
  const hash = await fn();
  console.log(`${label} tx:`, hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  console.log(`${label} confirmed in block`, receipt.blockNumber);
}

try {
  const asset = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "asset" });

  let isOperator = await publicClient.readContract({ address: asset, abi: tokenAbi, functionName: "isOperator", args: [account.address, POOL] });
  if (!isOperator) {
    await txHash("setOperator(pool)", () => walletClient.writeContract({ address: asset, abi: tokenAbi, functionName: "setOperator", args: [POOL, 2 ** 48 - 1], gas: 200_000n }));
  }

  const AMOUNT = 100_000000n; // 100 tokens of sponsored prize liquidity
  const enc = await relayer.encrypt({ values: [{ value: AMOUNT, type: "euint64" }], contractAddress: POOL, userAddress: account.address });
  await txHash("fundPrize", () => walletClient.writeContract({ address: POOL, abi: poolAbi, functionName: "fundPrize", args: [bytesToHex(enc.handles[0]), bytesToHex(enc.inputProof)], gas: 10_000_000n }));
  console.log("\nPRIZE FUNDED ✓ — next draw (after 24h cooldown) carries a claimable pot");
} catch (e) {
  console.error("FUND FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  relayer.terminate();
}
