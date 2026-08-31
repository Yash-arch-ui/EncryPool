"use client";

import { type Address, type Log, createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
import { poolDeployment } from "~~/hooks/encrypool/shared";

/** Full on-chain state of one pool draw. */
export type DrawState = {
  drawId: number;
  /** ms epoch of the draw block */
  ts: number;
  seedIndex: `0x${string}`;
  amount: `0x${string}`;
  winner: string;
  fulfilled: boolean;
  claimed: boolean;
};

export function makeSepoliaClient() {
  return createPublicClient({ chain: sepolia, transport: http(undefined, { timeout: 20_000 }) });
}

/**
 * Thirdweb and most public RPCs cap `eth_getLogs` at a 10 000-block window.
 * This helper splits a wide range into chunks and concatenates the results.
 */
const LOG_RANGE_LIMIT = 9_990;

async function getLogsChunked(
  client: ReturnType<typeof makeSepoliaClient>,
  params: {
    address: `0x${string}`;
    event?: Parameters<typeof client.getLogs>[0]["event"];
    events?: Parameters<typeof client.getLogs>[0]["events"];
    fromBlock: bigint;
    toBlock: bigint | "latest";
  },
): Promise<Log[]> {
  const latest = await client.getBlockNumber();
  const to = params.toBlock === "latest" ? latest : params.toBlock;
  const all: Log[] = [];
  let from = params.fromBlock;

  while (from <= to) {
    const chunkEnd = from + BigInt(LOG_RANGE_LIMIT) > to ? to : from + BigInt(LOG_RANGE_LIMIT);
    const logs = await client.getLogs({ ...params, fromBlock: from, toBlock: chunkEnd });
    all.push(...logs);
    from = chunkEnd + 1n;
  }

  return all;
}

/**
 * Enumerate all draws of ConfidentialPrizePool. The pool exposes no public
 * counter, so draw ids come from WinnerSeeded logs (from the deployment
 * block), then getDraw() supplies each draw's state.
 */
export async function fetchDrawStates(): Promise<DrawState[]> {
  const pool = poolDeployment();
  if (!pool) return [];
  const client = makeSepoliaClient();

  const seededLogs = await getLogsChunked(client, {
    address: pool.address,
    event: {
      type: "event",
      name: "WinnerSeeded",
      inputs: [
        { name: "drawId", type: "uint256", indexed: true },
        { name: "seedIndex", type: "bytes32", indexed: false },
      ],
    },
    fromBlock: BigInt(pool.deployedOnBlock),
    toBlock: "latest",
  });

  if (seededLogs.length === 0) return [];

  const ordered = [...seededLogs].sort((a, b) => Number(b.args.drawId) - Number(a.args.drawId));
  const uniqueBlocks = [...new Set(ordered.map(l => l.blockNumber))];
  const blocks = await Promise.all(uniqueBlocks.map(b => client.getBlock({ blockNumber: b })));
  const tsByBlock = new Map(blocks.map(b => [b.number, Number(b.timestamp) * 1000]));

  return Promise.all(
    ordered.map(async log => {
      const state = await client.readContract({
        address: pool.address,
        abi: pool.abi,
        functionName: "getDraw",
        args: [BigInt(Number(log.args.drawId))],
      });
      return {
        drawId: Number(log.args.drawId),
        ts: tsByBlock.get(log.blockNumber) ?? Date.now(),
        seedIndex: log.args.seedIndex as `0x${string}`,
        amount: state.amount,
        winner: state.winner,
        fulfilled: state.fulfilled,
        claimed: state.claimed,
      };
    }),
  );
}

export type ActivityEntry = {
  type: "Deposit" | "Withdraw";
  date: string;
  /** Events carry handles only — amounts are never plaintext on chain. */
  amount: string;
  txHash?: string;
};

/** Deposited/Withdrawn activity for one account, newest first. */
export async function fetchActivity(account: Address): Promise<ActivityEntry[]> {
  const vault = (await import("~~/hooks/encrypool/shared")).vaultDeployment();
  if (!vault) return [];
  const client = makeSepoliaClient();

  const logs = await getLogsChunked(client, {
    address: vault.address,
    events: [
      {
        type: "event",
        name: "Deposited",
        inputs: [
          { name: "account", type: "address", indexed: true },
          { name: "shares", type: "bytes32", indexed: false },
        ],
      },
      {
        type: "event",
        name: "Withdrawn",
        inputs: [
          { name: "account", type: "address", indexed: true },
          { name: "shares", type: "bytes32", indexed: false },
        ],
      },
    ],
    fromBlock: BigInt(vault.deployedOnBlock),
    toBlock: "latest",
  });

  const mine = logs.filter(l => l.args.account?.toLowerCase() === account.toLowerCase());

  const uniqueBlocks = [...new Set(logs.map(l => l.blockNumber))];
  const blocks = await Promise.all(uniqueBlocks.map(b => client.getBlock({ blockNumber: b })));
  const tsByBlock = new Map(blocks.map(b => [b.number, Number(b.timestamp) * 1000]));

  return [...mine]
    .sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber))
    .slice(0, 10)
    .map(log => ({
      type: log.eventName === "Deposited" ? ("Deposit" as const) : ("Withdraw" as const),
      date: new Date(tsByBlock.get(log.blockNumber) ?? Date.now()).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      amount: "🔒 Encrypted",
      txHash: log.transactionHash,
    }));
}
