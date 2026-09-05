/* Winner claim + winner-only decryption + live attack checks against Sepolia.
 *
 * Mirrors useClaimablePrize(): resolves the caller's participant index and
 * cumulative offset from the public participant list + KMS public decryption of
 * the draw-time weight handles preceding the caller, then submits
 * claim(drawId, participantIndex, offset). After a successful claim the pot
 * handle is user-decrypted (winner-only).
 *
 * Env:
 *   PK       - wallet private key (defaults to PRIVATE_KEY / DEPLOYER_PRIVATE_KEY)
 *   DRAW_ID  - the fulfilled draw to operate on (required)
 *   ATTACKS  - set to "1" to also simulate wrong-index / wrong-offset /
 *              cross-draw / double-claim attempts via eth_call (no gas spent)
 */
import { SepoliaConfig } from "@zama-fhe/sdk";
import { RelayerNode } from "@zama-fhe/sdk/node";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";
const VAULT = "0xe1e6a91Dd473699F01a06A2929a56aEA10c730D4";

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

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .map(l => l.split("=")),
);
const pkRaw = process.env.PK || env.PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!pkRaw) throw new Error("no private key (set PK)");
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);
const DRAW_ID = BigInt(env.DRAW_ID || 0);
if (DRAW_ID === 0n) throw new Error("DRAW_ID env required");

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC, { timeout: 120_000 }) });
console.log("wallet:", account.address, "| draw:", DRAW_ID.toString());

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
  return receipt;
}

/** Simulate claim with given args; returns { reverted, message } without spending gas. */
async function simulateClaim(args) {
  try {
    const { request } = await publicClient.simulateContract({
      address: POOL,
      abi: poolAbi,
      functionName: "claim",
      args,
      account: account.address,
    });
    return { reverted: false, message: "ok" };
  } catch (e) {
    return { reverted: true, message: (e.shortMessage || e.message || "").slice(0, 140) };
  }
}

/** Winner-only user decryption (same keypair+EIP-712 sequence as the UI). */
async function userDecrypt(handles, contractAddress) {
  const { publicKey, privateKey } = await relayer.generateKeypair();
  const startTimestamp = Math.floor(Date.now() / 1000);
  const typedData = await relayer.createEIP712(publicKey, [contractAddress.toLowerCase()], startTimestamp, 1);
  const signature = await walletClient.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType ?? "UserDecryptRequestVerification",
    message: {
      publicKey: typedData.message.publicKey,
      contractAddresses: typedData.message.contractAddresses,
      startTimestamp: typedData.message.startTimestamp,
      durationDays: typedData.message.durationDays,
      extraData: typedData.message.extraData,
    },
  });
  const res = await relayer.userDecrypt({
    handles,
    contractAddress,
    signedContractAddresses: [contractAddress.toLowerCase()],
    privateKey,
    publicKey,
    signature,
    signerAddress: account.address,
    startTimestamp,
    durationDays: 1,
  });
  return res;
}

try {
  const draw = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "getDraw",
    args: [DRAW_ID],
  });
  if (!draw.fulfilled) throw new Error("draw not fulfilled yet — run the coordinator flow first");
  const participants = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "participants" });
  const me = account.address.toLowerCase();
  const myIndex = participants.findIndex(p => p.toLowerCase() === me);
  console.log("winner:", draw.winner, "| iAmWinner:", draw.winner.toLowerCase() === me);

  // Cumulative offset = Σ draw-time weights of participants before me.
  let offset = 0n;
  if (myIndex > 0) {
    const handles = [];
    for (let i = 0; i < myIndex; i++) {
      handles.push(
        await publicClient.readContract({
          address: POOL,
          abi: poolAbi,
          functionName: "drawWeightHandle",
          args: [DRAW_ID, BigInt(i)],
        }),
      );
    }
    console.log("public-decrypting", handles.length, "preceding draw-time weight handles…");
    const res = await relayer.publicDecrypt(handles);
    for (const h of handles) offset += BigInt(res.clearValues[h] ?? 0);
  }
  console.log("myIndex:", myIndex, "| offset:", offset.toString());

  const correctArgs = [DRAW_ID, BigInt(myIndex), offset];

  // ── live attack checks (eth_call simulations, no gas) ────────────────────
  if (env.ATTACKS === "1") {
    const other = participants.find(p => p.toLowerCase() !== me);
    const otherIndex = other ? participants.findIndex(p => p.toLowerCase() === other.toLowerCase()) : -1;

    // Attack 1: wrong participant index (mine is bound to msg.sender, so use another's).
    const a1 = await simulateClaim([DRAW_ID, BigInt(otherIndex), offset]);
    console.log("ATTACK wrong index   →", a1.reverted ? `REVERTED ✓ (${a1.message})` : "DID NOT REVERT ✗");

    // Attack 2: wrong offset.
    const a2 = await simulateClaim([DRAW_ID, BigInt(myIndex), offset + 1n]);
    console.log("ATTACK wrong offset  →", a2.reverted ? `REVERTED ✓ (${a2.message})` : "DID NOT REVERT ✗");

    // Attack 5: cross-draw offset (same args but for a different draw id, if one exists).
    const otherDrawId = DRAW_ID > 1n ? DRAW_ID - 1n : DRAW_ID + 1n;
    const otherDraw = await publicClient
      .readContract({
        address: POOL,
        abi: poolAbi,
        functionName: "getDraw",
        args: [otherDrawId],
      })
      .catch(() => null);
    if (otherDraw && otherDraw.fulfilled) {
      const a5 = await simulateClaim([otherDrawId, BigInt(myIndex), offset]);
      console.log("ATTACK cross-draw    →", a5.reverted ? `REVERTED ✓ (${a5.message})` : "DID NOT REVERT ✗");
    } else {
      console.log("ATTACK cross-draw    → skipped (no second fulfilled draw to cross with)");
    }

    // Attack 3/4 only meaningful for the winner (NotWinner / DrawAlreadyClaimed).
    if (draw.winner.toLowerCase() === me && !draw.claimed) {
      // Attack 4: double claim — simulate claiming twice; second must revert.
      await simulateClaim(correctArgs); // first is fine
      const a4 = await simulateClaim(correctArgs);
      console.log("ATTACK double claim  →", a4.reverted ? `REVERTED ✓ (${a4.message})` : "DID NOT REVERT ✗");
    }
  }

  // ── real claim from the actual winner wallet ─────────────────────────────
  if (draw.winner.toLowerCase() !== me) {
    console.log("not the winner — claim skipped (run this script with PK of the winner).");
    process.exit(0);
  }
  if (draw.claimed) {
    console.log("already claimed — verifying winner-only decryption below.");
  } else {
    await txHash("claim", () =>
      walletClient.writeContract({
        address: POOL,
        abi: poolAbi,
        functionName: "claim",
        args: correctArgs,
        gas: 3_000_000n,
      }),
    );
  }
  const after = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "getDraw",
    args: [DRAW_ID],
  });
  console.log("post-claim:", { claimed: after.claimed, winner: after.winner });

  // ── winner-only decryption of the prize amount ───────────────────────────
  const clear = await userDecrypt([after.amount], POOL.toLowerCase());
  console.log("WINNER PRIZE AMOUNT (decrypted):", clear[after.amount]);
} catch (e) {
  console.error("CLAIM E2E FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  relayer.terminate();
}
