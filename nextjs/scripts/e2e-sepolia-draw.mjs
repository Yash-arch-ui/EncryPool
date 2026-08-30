/* Draw → KMS reveal → fulfillWinner → claim → winner-only prize decryption,
 * against LIVE Sepolia. Mirrors useClaimablePrize() in the UI.
 * Run AFTER e2e-sepolia-flow.mjs has registered a participant.
 */
import { SepoliaConfig } from "@zama-fhe/sdk";
import { RelayerNode } from "@zama-fhe/sdk/node";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const VAULT = "0xDD490eD46A6fe28e807500Bf7482b24d9077a812";
const POOL = "0xc866E74cA50f84e7986CE8c92755D50Bd13AB2B6";

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
          { name: "amount", type: "bytes32" },
          { name: "winner", type: "address" },
          { name: "fulfilled", type: "bool" },
          { name: "claimed", type: "bool" },
        ],
        type: "tuple",
      },
    ],
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
      { name: "winnerIndex", type: "uint8" },
      { name: "decryptionProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "claim",
    inputs: [{ name: "drawId", type: "uint256" }],
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
  return receipt;
}

/** Same keypair+EIP-712+userDecrypt sequence the UI's useUserDecrypt performs. */
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
  return relayer.userDecrypt({
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
}

try {
  // ── 1. run a draw (permissionless; cooldown only applies after the first) ──
  const receipt = await txHash("draw", () =>
    walletClient.writeContract({ address: POOL, abi: poolAbi, functionName: "draw", gas: 15_000_000n }),
  );

  // WinnerSeeded(uint256 indexed drawId, bytes32 seedIndex) — topic1 = drawId
  let drawId;
  for (const log of receipt.logs) {
    if (log.topics.length === 2 && log.address.toLowerCase() === POOL.toLowerCase()) {
      drawId = Number(BigInt(log.topics[1]));
    }
  }
  if (!drawId) throw new Error("could not read drawId");
  console.log("DRAW #", drawId);

  const draw = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "getDraw",
    args: [BigInt(drawId)],
  });
  console.log("pre-reveal:", { fulfilled: draw.fulfilled, winner: draw.winner, seedIndex: draw.seedIndex });

  // ── 2. public decryption via Zama relayer (KMS-signed proof) ──────────────
  console.log("requesting public decryption of seedIndex…");
  const pub = await relayer.publicDecrypt([draw.seedIndex]);
  const winnerIndex = Number(pub.clearValues[draw.seedIndex]);
  console.log("KMS cleartext winnerIndex:", winnerIndex, "| proof:", `${pub.decryptionProof.slice(0, 20)}…`);

  // ── 3. fulfillWinner verifies the KMS proof on-chain ──────────────────────
  await txHash("fulfillWinner", () =>
    walletClient.writeContract({
      address: POOL,
      abi: poolAbi,
      functionName: "fulfillWinner",
      args: [BigInt(drawId), winnerIndex, pub.decryptionProof],
      gas: 3_000_000n,
    }),
  );
  const revealed = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "getDraw",
    args: [BigInt(drawId)],
  });
  console.log(
    "post-reveal winner:",
    revealed.winner,
    "| iAmWinner:",
    revealed.winner.toLowerCase() === account.address.toLowerCase(),
  );

  if (revealed.winner.toLowerCase() !== account.address.toLowerCase()) {
    console.log("not the winner this draw — reveal path verified, skipping claim");
  } else {
    // ── 4. claim (transfers the encrypted pot, granting decryption rights) ──
    await txHash("claim", () =>
      walletClient.writeContract({
        address: POOL,
        abi: poolAbi,
        functionName: "claim",
        args: [BigInt(drawId)],
        gas: 3_000_000n,
      }),
    );
    const claimed = await publicClient.readContract({
      address: POOL,
      abi: poolAbi,
      functionName: "getDraw",
      args: [BigInt(drawId)],
    });
    console.log("claimed:", claimed.claimed);

    // ── 5. winner-only decryption of the prize amount ───────────────────────
    const clear = await userDecrypt([claimed.amount], POOL.toLowerCase());
    console.log("PRIZE AMOUNT (winner-only view):", clear[claimed.amount]);
  }
  console.log("\nDRAW E2E RESULT: PASS ✓ (draw → KMS reveal → fulfill verified on Sepolia)");
} catch (e) {
  console.error("DRAW E2E FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  relayer.terminate();
}
