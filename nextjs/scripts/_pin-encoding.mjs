/* Pin the exact abi.encode shape the DEPLOYED pool passes to FHE.checkSignatures.
 * Uses the VALID proof from the successful live fulfill tx 0xe307af... and the true
 * draw-1 plaintexts, testing candidate encodings against the Sepolia KMSVerifier.
 */
import { createPublicClient, decodeFunctionData, http } from "viem";
import { sepolia } from "viem/chains";

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const KMS_VERIFIER = "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A";
const FULFILL_TX = "0xe307af235e3eadcb5e257009cffbb98352c124dbf36fd95967e46a6ee2a93074";
const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });

const fulfillAbi = [
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

const verifierAbi = [
  {
    type: "function",
    name: "verifyDecryptionEIP712KMSSignatures",
    inputs: [
      { name: "handlesList", type: "bytes32[]" },
      { name: "abiEncodedCleartexts", type: "bytes" },
      { name: "decryptionProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "view",
  },
];

const tx = await publicClient.getTransaction({ hash: FULFILL_TX });
console.log("tx from:", tx.from, "to:", tx.to);
const decoded = decodeFunctionData({ abi: fulfillAbi, data: tx.input });
const args = Array.isArray(decoded.args) ? decoded.args : Object.values(decoded.args);
const drawId = args[0],
  revealedSeed = args[1],
  weights = args[2],
  decryptionProof = args[3];
console.log("drawId:", drawId.toString());
console.log("revealedSeed:", revealedSeed.toString());
console.log("weights:", weights.map(String).join(","));
console.log("proof bytes:", (decryptionProof.length - 2) / 2);

// draw-1 handles from the deployed pool
const getDrawAbi = [
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
];
const draw = await publicClient.readContract({
  address: POOL,
  abi: getDrawAbi,
  functionName: "getDraw",
  args: [drawId],
});
const wHandles = [];
for (let i = 0; i < Number(draw.participantCount); i++) {
  wHandles.push(
    await publicClient.readContract({
      address: POOL,
      abi: getDrawAbi,
      functionName: "drawWeightHandle",
      args: [drawId, BigInt(i)],
    }),
  );
}
const handles = [draw.seedIndex, draw.totalWeight, ...wHandles];
console.log("\nhandles:", handles);

const totalWeight = weights.reduce((a, b) => a + b, 0n);
const big = x => BigInt(x);

// candidate encodings (abi.encode variants) — produce bytes, test each
const { encodeAbiParameters, concat } = await import("viem");
const u64 = { type: "uint64" };

const candidates = {
  "abi.encode(uint64 seed, uint64 tw, uint64[] weights)": encodeAbiParameters(
    [u64, u64, { type: "uint64[]" }],
    [big(revealedSeed), totalWeight, weights.map(big)],
  ),
  "abi.encode(uint64[] [seed,tw,...weights])": encodeAbiParameters(
    [{ type: "uint64[]" }],
    [[big(revealedSeed), totalWeight, ...weights.map(big)]],
  ),
  "abi.encode(uint64[5] fixed)": encodeAbiParameters(
    [{ type: "uint64[5]" }],
    [[big(revealedSeed), totalWeight, ...weights.map(big)]],
  ),
  "abi.encodePacked(seed,tw,w...)": concat(weights.map(w => encodeAbiParameters([u64], [big(w)]))),
  "abi.encodePacked(uint64[] arr)": encodeAbiParameters(
    [{ type: "uint64[]" }],
    [[big(revealedSeed), totalWeight, ...weights.map(big)]],
  ).slice(64), // hmm placeholder
};

// abi.encodePacked of dynamic arrays actually drops length+offset; do manually:
const flatPacked = concat(
  [big(revealedSeed), totalWeight, ...weights.map(big)].map(w => encodeAbiParameters([u64], [w])),
);
candidates["abi.encodePacked flat words"] = flatPacked;

for (const [name, bytes] of Object.entries(candidates)) {
  try {
    await publicClient.readContract({
      address: KMS_VERIFIER,
      abi: verifierAbi,
      functionName: "verifyDecryptionEIP712KMSSignatures",
      args: [handles, bytes, decryptionProof],
    });
    console.log(`✅ PASS  ${name}  (${(bytes.length - 2) / 2} bytes)`);
  } catch (e) {
    console.log(`❌ fail  ${name}  -> ${(e?.shortMessage || e?.message || "").slice(0, 60)}`);
  }
}
