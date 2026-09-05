/* Empirical decode of the DEPLOYED intermediate ConfidentialPrizePool on an anvil fork.
 * Run from nextjs/ (so viem resolves). Assumes anvil is already running on :8545.
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";
const RPC = "http://127.0.0.1:8545";
const GATEWAY = "https://relayer.testnet.zama.org/v2";

const pkRaw = fs.readFileSync("/tmp/pk.txt", "utf8").trim();
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);
console.log("admin:", account.address);

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
    name: "seedIndexOf",
    inputs: [{ name: "drawId", type: "uint256" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "draw",
    inputs: [],
    outputs: [{ name: "drawId", type: "uint256" }],
    stateMutability: "nonpayable",
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gatewayPublicDecrypt(handles) {
  const post = await fetch(`${GATEWAY}/public-decrypt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ciphertextHandles: handles, extraData: "0x00" }),
  });
  const queued = await post.json();
  if (queued.status !== "queued") throw new Error(`gateway rejected: ${JSON.stringify(queued)}`);
  const jobId = queued.result.jobId;
  for (let i = 0; i < 120; i++) {
    await sleep(2500);
    const poll = await fetch(`${GATEWAY}/public-decrypt/${jobId}`);
    const res = await poll.json();
    if (res.status === "succeeded") return res.result;
    if (res.status === "failed") throw new Error(`gateway job failed: ${JSON.stringify(res)}`);
  }
  throw new Error("gateway timeout");
}

async function send(label, fn) {
  const hash = await fn();
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(`\n[${label}] tx ${hash} status=${receipt.status} block=${receipt.blockNumber}`);
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  return receipt;
}

const SLOT8 = 8n;
async function slot8Offset(drawId, index) {
  // keccak(abi.encode(index, keccak(abi.encode(drawId, 8))))
  const { encodeAbiParameters, keccak256 } = await import("viem");
  const inner = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [drawId, SLOT8]));
  const key = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [index, inner]));
  return publicClient.getStorageAt({ address: POOL, slot: key });
}

try {
  // 1. draw #2
  const receipt = await send("draw", () =>
    walletClient.writeContract({ address: POOL, abi: poolAbi, functionName: "draw", gas: 20_000_000n }),
  );
  let drawId;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() === POOL.toLowerCase() && log.topics.length >= 2)
      drawId = Number(BigInt(log.topics[1]));
  }
  console.log("DRAW #", drawId);

  const draw = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "getDraw",
    args: [BigInt(drawId)],
  });
  console.log("draw:", {
    seedIndex: draw.seedIndex,
    totalWeight: draw.totalWeight,
    amount: draw.amount,
    winner: draw.winner,
    fulfilled: draw.fulfilled,
    participantCount: Number(draw.participantCount),
  });
  const participants = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "participants" });
  console.log("participants:", participants);

  // 2. draw-time weight handles + slot-8 pre-fulfill
  const n = Number(draw.participantCount);
  const weightHandles = [];
  for (let i = 0; i < n; i++) {
    weightHandles.push(
      await publicClient.readContract({
        address: POOL,
        abi: poolAbi,
        functionName: "drawWeightHandle",
        args: [BigInt(drawId), BigInt(i)],
      }),
    );
    console.log(`slot8[${drawId}][${i}] PRE-fulfill:`, await slot8Offset(BigInt(drawId), BigInt(i)));
  }

  // 3. gateway decrypt
  const allHandles = [draw.seedIndex, draw.totalWeight, ...weightHandles];
  console.log("\ndecrypting", allHandles.length, "handles…");
  const result = await gatewayPublicDecrypt(allHandles);
  const hex = result.decryptedValue.startsWith("0x") ? result.decryptedValue.slice(2) : result.decryptedValue;
  const words = [];
  for (let i = 0; i < hex.length; i += 64) words.push(BigInt(`0x${hex.slice(i, i + 64)}`));
  const revealedSeed = words[0];
  const totalWeight = words[1];
  const weights = words.slice(2);
  console.log(
    "cleartext: seed=",
    revealedSeed.toString(),
    "totalWeight=",
    totalWeight.toString(),
    "weights=",
    weights.map(w => w.toString()),
  );

  let proof = `0x${result.signatures.length.toString(16).padStart(2, "0")}`;
  for (const sig of result.signatures) proof += sig.startsWith("0x") ? sig.slice(2) : sig;
  const extra = result.extraData ?? "0x";
  proof += extra.startsWith("0x") ? extra.slice(2) : extra;

  // 4. fulfill
  await send("fulfillWinner", () =>
    walletClient.writeContract({
      address: POOL,
      abi: poolAbi,
      functionName: "fulfillWinner",
      args: [BigInt(drawId), revealedSeed, weights, proof],
      gas: 8_000_000n,
    }),
  );

  const after = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "getDraw",
    args: [BigInt(drawId)],
  });
  console.log("\npost-fulfill:", {
    winner: after.winner,
    revealedSeed: after.revealedSeed.toString(),
    totalWeightPlaintext: after.totalWeightPlaintext.toString(),
    participantCount: Number(after.participantCount),
  });

  // winner math check: slot = seed % totalWeight; winner = i where cum_i <= slot < cum_i + w_i
  const slot = revealedSeed % totalWeight;
  let cum = 0n,
    expectedWinner = -1;
  for (let i = 0; i < weights.length; i++) {
    cum += weights[i];
    if (slot < cum) {
      expectedWinner = i;
      break;
    }
  }
  const adminIndex = participants.findIndex(p => p.toLowerCase() === account.address.toLowerCase());
  console.log(
    "slot =",
    slot.toString(),
    "expectedWinnerIndex =",
    expectedWinner,
    "adminIndex =",
    adminIndex,
    "winner==admin?",
    after.winner.toLowerCase() === account.address.toLowerCase(),
  );

  // slot-8 post-fulfill: plaintext offsets?
  for (let i = 0; i < n; i++)
    console.log(`slot8[${drawId}][${i}] POST-fulfill:`, await slot8Offset(BigInt(drawId), BigInt(i)));

  // 5. claim matrix
  const winnerIndex = participants.findIndex(p => p.toLowerCase() === after.winner.toLowerCase());
  let expectedOffset = 0n;
  for (let i = 0; i < winnerIndex; i++) expectedOffset += weights[i];

  async function tryClaim(label, index, offset, signer) {
    try {
      const hash = await signer.writeContract({
        address: POOL,
        abi: poolAbi,
        functionName: "claim",
        args: [BigInt(drawId), BigInt(index), offset],
        gas: 5_000_000n,
      });
      const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
      console.log(`[${label}] => SUCCESS status=${r.status}`);
      return "success";
    } catch (e) {
      const msg = e?.shortMessage || e?.message || String(e);
      console.log(`[${label}] => REVERT: ${msg.slice(0, 160)}`);
      return "revert";
    }
  }
  // winner's correct claim (from winner account if we have it, else simulate)
  const { parseEther, toHex } = await import("viem");
  const anvilAccount = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"); // anvil #0
  const anvilWallet = createWalletClient({
    account: anvilAccount,
    chain: sepolia,
    transport: http(RPC, { timeout: 120_000 }),
  });

  if (winnerIndex === adminIndex) {
    // winner == admin → full success path + double-claim
    await tryClaim("winner claim (correct index+offset)", winnerIndex, expectedOffset, walletClient);
    await tryClaim("double claim", winnerIndex, expectedOffset, walletClient);
    await tryClaim("wrong offset (winner, offset-1)", winnerIndex, expectedOffset - 1n, walletClient);
    await tryClaim("wrong index (winner passes other index)", (winnerIndex + 1) % n, expectedOffset, walletClient);
    await tryClaim("non-winner claims (anvil#0)", winnerIndex, expectedOffset, anvilWallet);
  } else {
    await tryClaim("admin claims (non-winner)", winnerIndex, expectedOffset, walletClient);
    await tryClaim("anvil#0 claims (non-winner)", winnerIndex, expectedOffset, anvilWallet);
    await tryClaim("wrong index from anvil#0", 0, 0n, anvilWallet);
  }
  console.log("\nDONE");
} catch (e) {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
