/* Live Sepolia claim of draw #1 by the winner (participant index 0, offset 0).
 * Only the stored winner may pass; recipient is always msg.sender.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .map(l => l.split("=")),
);
const pkRaw = env.PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);
console.log("wallet:", account.address);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC, { timeout: 120_000 }) });

const poolAbi = [
  {
    type: "function",
    name: "getDraw",
    inputs: [{ name: "drawId", type: "uint256" }],
    outputs: [
      {
        components: [
          { name: "seedIndex", type: "bytes32" },
          { name: "totalWeight", type: "bytes32" },
          { name: "amount", type: "bytes32" },
          { name: "winner", type: "address" },
          { name: "fulfilled", type: "bool" },
          { name: "claimed", type: "bool" },
          { name: "revealedSeed", type: "uint64" },
          { name: "totalWeightPlaintext", type: "uint64" },
          { name: "participantCount", type: "uint256" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "claim",
    inputs: [
      { name: "drawId", type: "uint256" },
      { name: "participantIndex", type: "uint256" },
      { name: "offsetPlaintext", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

try {
  const drawId = 1n;
  const draw = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [drawId] });
  console.log("pre-claim:", { fulfilled: draw.fulfilled, claimed: draw.claimed, winner: draw.winner });
  if (!draw.fulfilled) throw new Error("draw not fulfilled");
  if (draw.claimed) throw new Error("draw already claimed");
  if (draw.winner.toLowerCase() !== account.address.toLowerCase()) throw new Error("this wallet is not the stored winner");

  // winnerIndex 0 → offset 0 (no preceding draw-time weights)
  const hash = await walletClient.writeContract({
    address: POOL,
    abi: poolAbi,
    functionName: "claim",
    args: [drawId, 0n, 0n],
    gas: 3_000_000n,
  });
  console.log("claim tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("claim reverted!");
  console.log("claim confirmed in block", receipt.blockNumber);

  const after = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [drawId] });
  console.log("post-claim:", { claimed: after.claimed, winner: after.winner, amountHandle: after.amount });
} catch (e) {
  console.error("CLAIM FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}