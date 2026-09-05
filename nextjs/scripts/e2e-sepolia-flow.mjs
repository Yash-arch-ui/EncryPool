/* End-to-end Encrypool flow against LIVE Sepolia — no browser needed.
 *
 * Mirrors exactly what the wired UI does (same SDK calls the React hooks make):
 *   1. read vault/pool state
 *   2. ERC-7984 setOperator(vault)
 *   3. encrypt euint64 amount via RelayerNode -> vault.deposit()
 *   4. user-decrypt positionOf() handle (keypair + EIP-712 credential)
 *   5. withdraw part, re-decrypt
 *
 * Env: PK (optional, defaults to PRIVATE_KEY / DEPLOYER_PRIVATE_KEY from repo
 * .env.local) and DEPOSIT (optional base-unit amount, default 25_000_000).
 */
import { SepoliaConfig } from "@zama-fhe/sdk";
import { RelayerNode } from "@zama-fhe/sdk/node";
import fs from "node:fs";
import { bytesToHex, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const VAULT = "0xe1e6a91Dd473699F01a06A2929a56aEA10c730D4";
const POOL = "0xD87cd004661efD7ceaE2aA8668eC4F27D7CAbb43";

const vaultAbi = [
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  {
    type: "function",
    name: "positionOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "withdraw",
    inputs: [
      { name: "encryptedAmount", type: "bytes32" },
      { name: "inputProof", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
];
const tokenAbi = [
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  {
    type: "function",
    name: "confidentialBalanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "isOperator",
    inputs: [
      { name: "holder", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "setOperator",
    inputs: [
      { name: "operator", type: "address" },
      { name: "until", type: "uint48" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "wrap",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
];
const underlyingAbi = [
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
];
const poolAbi = [
  { type: "function", name: "participantCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
];

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .map(l => l.split("=")),
);
const pkRaw = process.env.PK || env.PRIVATE_KEY || env.DEPLOYER_PRIVATE_KEY;
if (!pkRaw) throw new Error("no private key in .env.local");
const account = privateKeyToAccount(pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`);

const RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC, { timeout: 60_000 }) });
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC, { timeout: 120_000 }) });

console.log("wallet:", account.address);

// ── Zama relayer (same transport config as DappWrapperWithProviders) ────────
// poolSize 1: each worker loads the full TFHE WASM (~50-100 MB); a bigger
// pool exhausts slow machines and init times out.
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

/** Full UI-equivalent user decryption of a single handle. */
async function userDecrypt(handle, contractAddress) {
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
    handles: [handle],
    contractAddress,
    signedContractAddresses: [contractAddress.toLowerCase()],
    privateKey,
    publicKey,
    signature,
    signerAddress: account.address,
    startTimestamp,
    durationDays: 1,
  });
  return res[handle];
}

try {
  // 1. reads
  const asset = await publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "asset" });
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: asset, abi: tokenAbi, functionName: "symbol" }),
    publicClient.readContract({ address: asset, abi: tokenAbi, functionName: "decimals" }),
  ]);
  console.log(`asset ${asset} (${symbol}, ${decimals} decimals)`);

  let balHandle = await publicClient.readContract({
    address: asset,
    abi: tokenAbi,
    functionName: "confidentialBalanceOf",
    args: [account.address],
  });
  console.log("wallet confidential balance handle:", balHandle);

  if (balHandle === "0x" + "0".repeat(64)) {
    // Zero handle → fund via the official wrapper: mint mock USDT, approve, wrap.
    const USDT = "0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0"; // Tether USD (Mock), per deploy script
    const WRAP_AMOUNT = 1000_000000n;
    console.log("funding confidential balance via wrapper…");
    await txHash("mint", () =>
      walletClient.writeContract({
        address: USDT,
        abi: underlyingAbi,
        functionName: "mint",
        args: [account.address, WRAP_AMOUNT],
        gas: 200_000n,
      }),
    );
    // USDTMock quirk: a non-zero allowance must be reset to 0 before changing it.
    const allowance = await publicClient.readContract({
      address: USDT,
      abi: underlyingAbi,
      functionName: "allowance",
      args: [account.address, asset],
    });
    if (allowance < WRAP_AMOUNT) {
      if (allowance > 0n) {
        await txHash("approve-reset", () =>
          walletClient.writeContract({
            address: USDT,
            abi: underlyingAbi,
            functionName: "approve",
            args: [asset, 0n],
            gas: 200_000n,
          }),
        );
      }
      await txHash("approve", () =>
        walletClient.writeContract({
          address: USDT,
          abi: underlyingAbi,
          functionName: "approve",
          args: [asset, WRAP_AMOUNT],
          gas: 200_000n,
        }),
      );
    } else {
      console.log("underlying allowance sufficient:", allowance.toString());
    }
    await txHash("wrap", () =>
      walletClient.writeContract({
        address: asset,
        abi: tokenAbi,
        functionName: "wrap",
        args: [account.address, WRAP_AMOUNT],
        gas: 10_000_000n,
      }),
    );
    balHandle = await publicClient.readContract({
      address: asset,
      abi: tokenAbi,
      functionName: "confidentialBalanceOf",
      args: [account.address],
    });
    console.log("funded; balance handle:", balHandle);
  }

  // 2. operator approval
  let isOperator = await publicClient.readContract({
    address: asset,
    abi: tokenAbi,
    functionName: "isOperator",
    args: [account.address, VAULT],
  });
  if (!isOperator) {
    const MAX48 = 2 ** 48 - 1;
    await txHash("setOperator", () =>
      walletClient.writeContract({
        address: asset,
        abi: tokenAbi,
        functionName: "setOperator",
        args: [VAULT, MAX48],
        gas: 200_000n,
      }),
    );
    isOperator = true;
  } else {
    console.log("operator already set");
  }

  // 4. decrypt position before/after to verify exact encrypted deltas
  const readPosHandle = () =>
    publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "positionOf", args: [account.address] });

  let before = 0n;
  const beforeHandle = await readPosHandle();
  if (beforeHandle !== "0x" + "0".repeat(64)) {
    before = BigInt(await userDecrypt(beforeHandle, VAULT.toLowerCase()));
    console.log("position BEFORE:", before);
  }

  const DEPOSIT = BigInt(process.env.DEPOSIT || 25_000_000); // 25 tokens @ 6 decimals default
  const enc = await relayer.encrypt({
    values: [{ value: DEPOSIT, type: "euint64" }],
    contractAddress: VAULT,
    userAddress: account.address,
  });
  console.log("encrypted input ready");
  await txHash("deposit", () =>
    walletClient.writeContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "deposit",
      args: [bytesToHex(enc.handles[0]), bytesToHex(enc.inputProof)],
      gas: 10_000_000n,
    }),
  );

  const posHandle = await readPosHandle();
  console.log("position handle:", posHandle);
  const posClear = BigInt(await userDecrypt(posHandle, VAULT.toLowerCase()));
  console.log("DECRYPTED POSITION:", posClear);

  // 5. partial withdraw + verify by decryption
  const WITHDRAW = 5_000_000n; // 5 tokens
  const encW = await relayer.encrypt({
    values: [{ value: WITHDRAW, type: "euint64" }],
    contractAddress: VAULT,
    userAddress: account.address,
  });
  await txHash("withdraw", () =>
    walletClient.writeContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "withdraw",
      args: [bytesToHex(encW.handles[0]), bytesToHex(encW.inputProof)],
      gas: 10_000_000n,
    }),
  );
  const posHandle2 = await readPosHandle();
  const posClear2 = BigInt(await userDecrypt(posHandle2, VAULT.toLowerCase()));
  console.log("POSITION AFTER WITHDRAW:", posClear2);

  const participantCount = await publicClient.readContract({
    address: POOL,
    abi: poolAbi,
    functionName: "participantCount",
  });
  console.log("pool participants after deposit:", participantCount.toString());

  const expectedAfterDeposit = before + DEPOSIT;
  const expectedAfterWithdraw = before + DEPOSIT - WITHDRAW;
  console.log(
    `\nE2E RESULT:`,
    posClear === expectedAfterDeposit && posClear2 === expectedAfterWithdraw
      ? "PASS ✓ (encrypted deltas exact)"
      : `FAIL (expected ${expectedAfterDeposit} then ${expectedAfterWithdraw}, got ${posClear} then ${posClear2})`,
  );
} catch (e) {
  console.error("E2E FAILED:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  relayer.terminate();
}
