"use client";

import { type AbiEvent, type Address, createPublicClient, decodeEventLog, http } from "viem";
import { type Log } from "viem";
import { sepolia } from "viem/chains";
import { poolDeployment } from "~~/hooks/encrypool/shared";

/** Full on-chain state of one pool draw. */
export type DrawState = {
  drawId: number;
  /** ms epoch of the draw block */
  ts: number;
  seedIndex: `0x${string}`;
  totalWeight: `0x${string}`;
  amount: `0x${string}`;
  winner: string;
  fulfilled: boolean;
  claimed: boolean;
  /** Plaintext seed revealed by KMS during fulfillWinner. 0 if not yet fulfilled.
   *  Kept as bigint: a uint64 seed can exceed Number.MAX_SAFE_INTEGER, and
   *  Number() conversion silently corrupts it. */
  revealedSeed: bigint;
  /** Plaintext total weight revealed by KMS during fulfillWinner. 0 if not yet fulfilled. */
  totalWeightPlaintext: bigint;
};

export function makeSepoliaClient() {
  return createPublicClient({ chain: sepolia, transport: http(undefined, { timeout: 20_000 }) });
}

/**
 * Thirdweb and most public RPCs cap `eth_getLogs` at a 10 000-block window.
 * This helper splits a wide range into chunks and concatenates the results.
 */
const LOG_RANGE_LIMIT = 9_990;

type GetLogsParams =
  | {
      address: `0x${string}`;
      event: AbiEvent;
      events?: never;
      fromBlock: bigint;
      toBlock: bigint | "latest";
    }
  | {
      address: `0x${string}`;
      event?: never;
      events: readonly AbiEvent[];
      fromBlock: bigint;
      toBlock: bigint | "latest";
    }
  | {
      address: `0x${string}`;
      event?: never;
      events?: never;
      fromBlock: bigint;
      toBlock: bigint | "latest";
    };

async function getLogsChunked(client: ReturnType<typeof makeSepoliaClient>, params: GetLogsParams): Promise<Log[]> {
  const latest = await client.getBlockNumber();
  const to = params.toBlock === "latest" ? latest : params.toBlock;
  const all: Log[] = [];
  let from = params.fromBlock;

  while (from <= to) {
    const chunkEnd = from + BigInt(LOG_RANGE_LIMIT) > to ? to : from + BigInt(LOG_RANGE_LIMIT);
    const logs = await client.getLogs({ ...params, fromBlock: from, toBlock: chunkEnd } as any);
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

  const winnerSeededAbi: AbiEvent = {
    type: "event",
    name: "WinnerSeeded",
    inputs: [
      { name: "drawId", type: "uint256", indexed: true },
      { name: "seedIndex", type: "bytes32", indexed: false },
    ],
  };

  const decoded = seededLogs.map(log => {
    const d = decodeEventLog({ abi: [winnerSeededAbi], data: log.data, topics: log.topics });
    return { log, args: d.args as { drawId: bigint; seedIndex: `0x${string}` } };
  });

  const ordered = [...decoded].sort((a, b) => Number(b.args.drawId) - Number(a.args.drawId));
  const uniqueBlocks = [...new Set(ordered.map(e => e.log.blockNumber).filter((b): b is bigint => b !== null))];
  const blocks = await Promise.all(uniqueBlocks.map(b => client.getBlock({ blockNumber: b })));
  const tsByBlock = new Map(blocks.map(b => [b.number, Number(b.timestamp) * 1000]));

  return Promise.all(
    ordered.map(async ({ log, args }) => {
      const state = await client.readContract({
        address: pool.address,
        abi: pool.abi,
        functionName: "getDraw",
        args: [args.drawId],
      });
      return {
        drawId: Number(args.drawId),
        ts: (log.blockNumber !== null ? tsByBlock.get(log.blockNumber) : undefined) ?? Date.now(),
        seedIndex: args.seedIndex,
        totalWeight: state.totalWeight,
        amount: state.amount,
        winner: state.winner,
        fulfilled: state.fulfilled,
        claimed: state.claimed,
        revealedSeed: state.revealedSeed ?? 0n,
        totalWeightPlaintext: state.totalWeightPlaintext ?? 0n,
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

  const depositedAbi: AbiEvent = {
    type: "event",
    name: "Deposited",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "shares", type: "bytes32", indexed: false },
    ],
  };
  const withdrawnAbi: AbiEvent = {
    type: "event",
    name: "Withdrawn",
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "shares", type: "bytes32", indexed: false },
    ],
  };
  const eventAbis = [depositedAbi, withdrawnAbi];

  const decoded = logs.map(log => {
    const d = decodeEventLog({ abi: eventAbis, data: log.data, topics: log.topics });
    return { log, args: d.args as { account: `0x${string}` }, eventName: d.eventName };
  });

  const mine = decoded.filter(e => e.args.account.toLowerCase() === account.toLowerCase());

  const uniqueBlocks = [...new Set(decoded.map(e => e.log.blockNumber).filter((b): b is bigint => b !== null))];
  const blocks = await Promise.all(uniqueBlocks.map(b => client.getBlock({ blockNumber: b })));
  const tsByBlock = new Map(blocks.map(b => [b.number, Number(b.timestamp) * 1000]));

  return [...mine]
    .sort((a, b) => Number(b.log.blockNumber ?? 0n) - Number(a.log.blockNumber ?? 0n))
    .slice(0, 10)
    .map(({ log, eventName }) => ({
      type: (eventName === "Deposited" ? "Deposit" : "Withdraw") as "Deposit" | "Withdraw",
      date: new Date(
        (log.blockNumber !== null ? tsByBlock.get(log.blockNumber) : undefined) ?? Date.now(),
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
      amount: "🔒 Encrypted",
      txHash: log.transactionHash ?? undefined,
    }));
}
