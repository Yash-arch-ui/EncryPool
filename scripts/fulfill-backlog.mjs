/* Batch fulfillment of draws 2, 3, 4 on Sepolia.
 * Uses the same Zama gateway public-decrypt flow as live-fulfill-draw1.mjs.
 * Reads the PK from .env.local; sends from the deployer wallet.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";
const GATEWAY = "https://relayer.testnet.zama.org/v2";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split("=")),
);
const pkRaw = env.PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!pkRaw) throw new Error("no PRIVATE_KEY in .env.local");
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);
console.log("wallet:", account.address);

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC, { timeout: 120_000 }) });

const poolAbi = [
  { type: "function", name: "participants", inputs: [], outputs: [{ type: "address[]" }], stateMutability: "view" },
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
    name: "drawWeightHandle",
    inputs: [
      { name: "drawId", type: "uint256" },
      { name: "participantIndex", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "fulfillWinner",
    inputs: [
      { name: "drawId", type: "uint256" },
      { name: "revealedSeed", type: "uint64" },
      { name: "weights", type: "uint64[]" },
      { name: "decryptionProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gatewayPublicDecrypt(handles) {
  const post = await fetch(`${GATEWAY}/public-decrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertextHandles: handles, extraData: "0x00" }),
  });
  const queued = await post.json();
  if (queued.status !== "queued") throw new Error(`gateway rejected: ${JSON.stringify(queued.error ?? queued)}`);
  const jobId = queued.result.jobId;
  console.log(`  gateway job ${jobId} — polling…`);
  for (let i = 0; i < 120; i++) {
    await sleep(3000);
    const poll = await fetch(`${GATEWAY}/public-decrypt/${jobId}`);
    const res = await poll.json();
    if (res.status === "succeeded") return res.result;
    if (res.status === "failed") throw new Error(`gateway job failed: ${JSON.stringify(res.error ?? res)}`);
  }
  throw new Error("gateway job timed out");
}

async function fulfillDraw(drawId) {
  console.log(`\n━━━ FULFILL DRAW ${drawId} ━━━`);
  const draw = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [BigInt(drawId)] });
  if (draw.fulfilled) { console.log(`  already fulfilled — skipping`); return null; }
  const n = Number(draw.participantCount);
  console.log(`  participantCount: ${n}`);

  const weightHandles = [];
  for (let i = 0; i < n; i++) {
    weightHandles.push(await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "drawWeightHandle", args: [BigInt(drawId), BigInt(i)] }));
  }
  const allHandles = [draw.seedIndex, draw.totalWeight, ...weightHandles];
  console.log(`  decrypting ${allHandles.length} handles…`);

  const result = await gatewayPublicDecrypt(allHandles);
  const hex = result.decryptedValue.startsWith("0x") ? result.decryptedValue.slice(2) : result.decryptedValue;
  const words = [];
  for (let i = 0; i < hex.length; i += 64) words.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  const revealedSeed = words[0];
  const weights = words.slice(2);
  console.log(`  seed: ${revealedSeed}  totalWeight: ${words[1]}  weights: [${weights.map((w) => w.toString())}]`);

  const sum = weights.reduce((a, w) => a + w, 0n);
  if (sum !== words[1]) throw new Error(`totalWeight mismatch: sum=${sum} decrypted=${words[1]}`);

  let proof = `0x${result.signatures.length.toString(16).padStart(2, "0")}`;
  for (const sig of result.signatures) proof += sig.startsWith("0x") ? sig.slice(2) : sig;
  proof += (result.extraData ?? "0x").replace(/^0x/, "");
  console.log(`  proof bytes: ${(proof.length - 2) / 2}`);

  const hash = await walletClient.writeContract({
    address: POOL, abi: poolAbi, functionName: "fulfillWinner",
    args: [BigInt(drawId), revealedSeed, weights, proof], gas: 5_000_000n,
  });
  console.log(`  tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("fulfillWinner reverted!");
  console.log(`  confirmed in block ${receipt.blockNumber}`);

  const after = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [BigInt(drawId)] });
  console.log(`  winner: ${after.winner}  fulfilled: ${after.fulfilled}`);
  return { drawId, txHash: hash, winner: after.winner };
}

try {
  const results = [];
  for (const id of [2, 3, 4]) {
    const r = await fulfillDraw(id);
    if (r) results.push(r);
  }
  console.log("\n━━━ SUMMARY ━━━");
  for (const r of results) console.log(`  Draw ${r.drawId}: tx=${r.txHash} winner=${r.winner}`);
  if (results.length === 0) console.log("  All draws already fulfilled.");
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
