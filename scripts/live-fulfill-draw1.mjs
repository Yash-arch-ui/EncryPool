/* Live Sepolia fulfillment of draw #1 (ConfidentialPrizePool 0xD87c...).
 *
 * Fetches a FRESH public decryption of the five draw-time handles straight from
 * the Zama gateway (relayer.testnet.zama.org/v2), assembles the KMS proof, then
 * submits fulfillWinner(drawId, revealedSeed, weights, proof) with the exact
 * BigInt plaintext values returned by the gateway. No Number() anywhere, so the
 * uint64 seed keeps full precision.
 */
import fs from "node:fs";
import { bytesToHex, createPublicClient, createWalletClient, http } from "viem";
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
    .map(l => l.split("=")),
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Fresh public decryption of the given handles via the Zama gateway (V2 async job). */
async function gatewayPublicDecrypt(handles) {
  const post = await fetch(`${GATEWAY}/public-decrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertextHandles: handles, extraData: "0x00" }),
  });
  const queued = await post.json();
  if (queued.status !== "queued") throw new Error(`gateway rejected: ${JSON.stringify(queued.error ?? queued)}`);
  const jobId = queued.result.jobId;
  for (let i = 0; i < 120; i++) {
    await sleep(2500);
    const poll = await fetch(`${GATEWAY}/public-decrypt/${jobId}`);
    const res = await poll.json();
    if (res.status === "succeeded") return res.result;
    if (res.status === "failed") throw new Error(`gateway job failed: ${JSON.stringify(res.error ?? res)}`);
  }
  throw new Error("gateway job timed out");
}

try {
  const drawId = 1n;
  const draw = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [drawId] });
  if (draw.fulfilled) throw new Error("draw 1 already fulfilled");
  console.log("draw 1 unfulfilled ✓ | participantCount:", Number(draw.participantCount));

  const n = Number(draw.participantCount);
  const weightHandles = [];
  for (let i = 0; i < n; i++) {
    weightHandles.push(
      await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "drawWeightHandle", args: [drawId, BigInt(i)] }),
    );
  }
  const allHandles = [draw.seedIndex, draw.totalWeight, ...weightHandles];
  console.log("decrypting", allHandles.length, "handles via gateway…");

  const result = await gatewayPublicDecrypt(allHandles);
  const dv = result.decryptedValue; // concatenated 32-byte words, hex (no 0x prefix expected — handle both)
  const hex = dv.startsWith("0x") ? dv.slice(2) : dv;
  const words = [];
  for (let i = 0; i < hex.length; i += 64) words.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  const revealedSeed = words[0];
  const weights = words.slice(2); // words: [seed, totalWeight, w0..]
  console.log("gateway cleartext:");
  console.log("  revealedSeed =", revealedSeed.toString());
  console.log("  totalWeight  =", words[1].toString());
  console.log("  weights      =", weights.map(w => w.toString()));

  // Sanity: the decrypted totalWeight must equal the sum of decrypted weights.
  const sum = weights.reduce((a, w) => a + w, 0n);
  if (sum !== words[1]) throw new Error(`totalWeight mismatch: sum=${sum} decrypted=${words[1]}`);
  console.log("  Σweights == totalWeight ✓");

  // Assemble decryptionProof: numSigners + 65-byte signatures + extraData.
  let proof = `0x${result.signatures.length.toString(16).padStart(2, "0")}`;
  for (const sig of result.signatures) proof += sig.startsWith("0x") ? sig.slice(2) : sig;
  const extra = result.extraData ?? "0x";
  proof += extra.startsWith("0x") ? extra.slice(2) : extra;
  console.log("proof bytes:", (proof.length - 2) / 2);

  console.log("submitting fulfillWinner…");
  const hash = await walletClient.writeContract({
    address: POOL,
    abi: poolAbi,
    functionName: "fulfillWinner",
    args: [drawId, revealedSeed, weights, proof],
    gas: 5_000_000n,
  });
  console.log("fulfill tx:", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error("fulfillWinner reverted!");
  console.log("fulfillment confirmed in block", receipt.blockNumber);

  const after = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [drawId] });
  console.log("post-fulfill:", { winner: after.winner, fulfilled: after.fulfilled, revealedSeed: after.revealedSeed?.toString(), totalWeightPlaintext: after.totalWeightPlaintext?.toString() });

  // Winner-only data needed for claim: winner index & cumulative offset.
  const participants = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "participants" });
  const winnerIndex = participants.findIndex(p => p.toLowerCase() === after.winner.toLowerCase());
  let offset = 0n;
  for (let i = 0; i < winnerIndex; i++) offset += weights[i];
  console.log("winner index:", winnerIndex, "| offset:", offset.toString());
  fs.writeFileSync(new URL("./live-state.json", import.meta.url), JSON.stringify({ winner: after.winner, winnerIndex, offset: offset.toString(), amountHandle: after.amount }, null, 2));
} catch (e) {
  console.error("LIVE FULFILL FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}