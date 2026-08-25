/* Self-contained check of Encrypool hook read-paths against live Sepolia. */
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const VAULT = "0xDD490eD46A6fe28e807500Bf7482b24d9077a812";
const POOL = "0xc866E74cA50f84e7986CE8c92755D50Bd13AB2B6";
const FROM_BLOCK = 11561689n;

const vaultAbi = [
  { type: "function", name: "asset", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "prizePool", inputs: [], outputs: [{ type: "address" }], stateMutability: "view" },
  { type: "function", name: "totalShares", inputs: [], outputs: [{ type: "bytes32" }], stateMutability: "view" },
];
const tokenAbi = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "symbol", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "decimals", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
];
const poolAbi = [
  { type: "function", name: "participantCount", inputs: [], outputs: [{ type: "uint256" }], stateMutability: "view" },
  {
    type: "function",
    name: "getDraw",
    inputs: [{ name: "drawId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "seedIndex", type: "bytes32" },
          { name: "amount", type: "bytes32" },
          { name: "winner", type: "address" },
          { name: "fulfilled", type: "bool" },
          { name: "claimed", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
];

const maskHandle = h => (!h || h.length < 12 ? "0x0000••••••••0000" : `0x${h.slice(2, 6).toUpperCase()}••••••••${h.slice(-4).toUpperCase()}`);
const shortHex = v => `${v.slice(0, 6)}...${v.slice(-4)}`;

const client = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 30000 }) });

console.log("vault:", VAULT, "| pool:", POOL);
const asset = await client.readContract({ address: VAULT, abi: vaultAbi, functionName: "asset" });
const [name, symbol, decimals] = await Promise.all([
  client.readContract({ address: asset, abi: tokenAbi, functionName: "name" }),
  client.readContract({ address: asset, abi: tokenAbi, functionName: "symbol" }),
  client.readContract({ address: asset, abi: tokenAbi, functionName: "decimals" }),
]);
console.log("asset:", asset, "|", name, symbol, "decimals:", decimals);

const prizePool = await client.readContract({ address: VAULT, abi: vaultAbi, functionName: "prizePool" });
console.log("vault.prizePool():", prizePool, prizePool.toLowerCase() === POOL.toLowerCase() ? "(matches deployment ✓)" : "(MISMATCH)");

const participantCount = await client.readContract({ address: POOL, abi: poolAbi, functionName: "participantCount" });
console.log("participantCount:", participantCount.toString());

const totalShares = await client.readContract({ address: VAULT, abi: vaultAbi, functionName: "totalShares" });
console.log("totalShares handle:", maskHandle(totalShares));

const logs = await client.getLogs({
  address: POOL,
  event: {
    type: "event",
    name: "WinnerSeeded",
    inputs: [
      { name: "drawId", type: "uint256", indexed: true },
      { name: "seedIndex", type: "bytes32", indexed: false },
    ],
  },
  fromBlock: FROM_BLOCK,
  toBlock: "latest",
});
console.log("WinnerSeeded logs:", logs.length);
for (const log of [...logs].sort((a, b) => Number(b.args.drawId) - Number(a.args.drawId)).slice(0, 5)) {
  const block = await client.getBlock({ blockNumber: log.blockNumber });
  const draw = await client.readContract({ address: POOL, abi: poolAbi, functionName: "getDraw", args: [log.args.drawId] });
  console.log(
    `DRAW #${log.args.drawId} @ ${new Date(Number(block.timestamp) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
    "| winner:", shortHex(draw.winner), "| fulfilled:", draw.fulfilled, "| claimed:", draw.claimed,
    "| amount handle:", maskHandle(draw.amount),
  );
}
console.log("OK — all hook read paths resolve on live Sepolia");
