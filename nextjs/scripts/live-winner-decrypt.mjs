/* Live winner-only decryption of draw #1's prize amount handle — exactly the
 * useUserDecrypt() sequence the UI performs after a claim. Run from nextjs/.
 */
import { SepoliaConfig } from "@zama-fhe/sdk";
import { RelayerNode } from "@zama-fhe/sdk/node";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";
const RPC = "https://ethereum-sepolia-rpc.publicnode.com";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
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
];

const relayer = new RelayerNode({
  transports: { [SepoliaConfig.chainId]: SepoliaConfig },
  getChainId: async () => 11155111,
  poolSize: 1,
});

try {
  const draw = await publicClient.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [1n] });
  console.log("draw 1:", { fulfilled: draw.fulfilled, claimed: draw.claimed, winner: draw.winner });
  if (draw.winner.toLowerCase() !== account.address.toLowerCase()) throw new Error("not the winner");
  if (!draw.claimed) throw new Error("not claimed yet");

  // The winner never holds `draw.amount` after the FHE-gated transfer: claim()
  // moves a fresh select() ciphertext into the winner's asset balance. Decrypt
  // the winner's confidential balance handle before and after the claim and
  // report the delta — that delta IS the encrypted prize transfer.
  const assetAbi = [
    {
      type: "function",
      name: "confidentialBalanceOf",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "bytes32" }],
      stateMutability: "view",
    },
  ];
  const asset = await publicClient.readContract({
    address: POOL,
    abi: [{ type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" }],
    functionName: "asset",
  });
  const preHandle = await publicClient.readContract({
    address: asset,
    abi: assetAbi,
    functionName: "confidentialBalanceOf",
    args: [account.address],
    blockNumber: 11635993n,
  });
  const postHandle = await publicClient.readContract({
    address: asset,
    abi: assetAbi,
    functionName: "confidentialBalanceOf",
    args: [account.address],
  });
  console.log("pre-claim balance handle:", preHandle);
  console.log("post-claim balance handle:", postHandle);
  const handles = [preHandle, postHandle];
  // Balance handles live under the asset's ACL context (persistAllowed true for
  // asset + winner), not the pool's — decrypt with contractAddress = asset.
  const contractAddress = asset.toLowerCase();

  // 1. keypair
  const { publicKey, privateKey } = await relayer.generateKeypair();
  // 2. EIP-712 credential
  const startTimestamp = Math.floor(Date.now() / 1000);
  const typedData = await relayer.createEIP712(publicKey, [contractAddress], startTimestamp, 1);
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
  console.log("credential signed");

  // 3. user decrypt (winner-only)
  const res = await relayer.userDecrypt({
    handles,
    contractAddress,
    signedContractAddresses: [contractAddress],
    privateKey,
    publicKey,
    signature,
    signerAddress: account.address,
    startTimestamp,
    durationDays: 1,
  });
  const before = BigInt(res[preHandle] ?? 0n);
  const after = BigInt(res[postHandle] ?? 0n);
  console.log("WINNER BALANCE (decrypted) pre-claim :", before.toString());
  console.log("WINNER BALANCE (decrypted) post-claim:", after.toString());
  console.log(
    "PRIZE DELTA (winner-only decryption) :",
    (after - before).toString(),
    "base units →",
    Number(after - before) / 1e6,
    "USDT",
  );
} catch (e) {
  console.error("WINNER DECRYPT FAILED:", e instanceof Error ? e.message : e);
  let c = e.cause;
  let depth = 0;
  while (c && depth++ < 3) {
    console.error("cause:", c.message ?? String(c));
    c = c.cause;
  }
  process.exitCode = 1;
} finally {
  relayer.terminate();
}
