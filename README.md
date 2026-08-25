# Confidential Prize Vault

A confidential no-loss prize savings dApp for the [Zama Developer Program](https://www.zama.ai/developer-program) (Season 4 bounty track) — a privacy-preserving take on PoolTogether built on FHEVM. Depositors pool their funds for a chance at periodic prizes, but every deposit amount, account balance, and win stays encrypted end-to-end: amounts are held and computed on as FHEVM ciphertexts on-chain, and only each depositor can decrypt their own position. No one — not other users, not the protocol — can see who deposited how much or who won what. Built on the official [`zama-ai/fhevm-react-template`](https://github.com/zama-ai/fhevm-react-template); the template's example `FHECounter` contract is currently the placeholder while the prize-vault contracts are developed.

## Contracts (`contracts/`)

| Contract                      | What it does                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConfidentialPrizeVault.sol`  | No-loss vault for cUSDT (ERC-7984). Encrypted deposits/withdrawals, encrypted 1:1 shares, no plaintext amounts in storage or events.                                        |
| `EncryptedBalanceTracker.sol` | Checkpointed encrypted balance + timestamp per account; emits an encrypted eligibility weight (balance × min(elapsed, 30d)) for draws. Lightweight TWAB stand-in.           |
| `ConfidentialPrizePool.sol`   | Single-tier prize pool: sponsored encrypted prize liquidity, weighted draw via `FHE.randEuint64`, KMS-verified winner reveal, winner-only claim of the fully-encrypted pot. |

Deployed on Sepolia (Wrappers-Registry cUSDTMock `0x4E7B06D78965594eB5EF5414c357ca21E1554491`):

- ConfidentialPrizeVault [`0xDD490eD46A6fe28e807500Bf7482b24d9077a812`](https://sepolia.etherscan.io/address/0xDD490eD46A6fe28e807500Bf7482b24d9077a812)
- ConfidentialPrizePool [`0xc866E74cA50f84e7986CE8c92755D50Bd13AB2B6`](https://sepolia.etherscan.io/address/0xc866E74cA50f84e7986CE8c92755D50Bd13AB2B6)

Redeploy with `pnpm deploy:vault:sepolia` or `pnpm deploy:vault:localhost`.

## Stack

- **Contracts** — Foundry, Solidity 0.8.27, [forge-fhevm](https://github.com/zama-ai/forge-fhevm) for host contracts + testing helpers
- **Frontend** — Next.js 15 (App Router), React 19, wagmi, viem, RainbowKit, Tailwind + daisyUI
- **FHE SDK** — `@zama-fhe/sdk` + `@zama-fhe/react-sdk` v3; `RelayerCleartext` on localhost, `RelayerWeb` on Sepolia

## Prerequisites

Node.js ≥ 20, pnpm, [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge` / `anvil` / `cast`), `jq`, MetaMask.

## Quick start

```bash
pnpm install            # node deps + husky + regenerate ABIs
pnpm contracts:install  # forge soldeer install — required before `pnpm chain`
```

### Local

```bash
# Terminal 1 — anvil + FHEVM cleartext host + FHECounter
pnpm chain

# Terminal 2 — frontend (http://localhost:3000)
pnpm start
```

Add the local network to MetaMask: RPC `http://127.0.0.1:8545`, chain id `31337`. Import any anvil dev account (e.g. private key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`, address `0xf39F…2266`, 10 000 ETH).

To redeploy `FHECounter` without restarting anvil: `pnpm deploy:localhost`.

### Sepolia

```bash
cp .env.example .env.local   # then fill in the three values below
```

```bash
DEPLOYER_PRIVATE_KEY=0x...                         # deployer funded with Sepolia ETH
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
ETHERSCAN_API_KEY=...                              # optional, enables --verify
```

Add an Alchemy key to `packages/nextjs/.env.local`:

```bash
NEXT_PUBLIC_ALCHEMY_API_KEY=YOUR_KEY
```

Deploy + run:

```bash
pnpm deploy:sepolia
pnpm start
```

## Scripts

| Command                  | What it does                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `pnpm chain`             | Anvil + FHEVM cleartext host + `FHECounter` on port 8545                                     |
| `pnpm deploy:localhost`  | Deploys `FHECounter` to local anvil, then regenerates frontend ABIs                          |
| `pnpm deploy:sepolia`    | Deploys to Sepolia (reads `.env.local`), then regenerates frontend ABIs                      |
| `pnpm contracts:install` | `forge soldeer install` — fetches forge-fhevm and other contract deps                        |
| `pnpm contracts:build`   | `forge build` in `packages/foundry`                                                          |
| `pnpm contracts:test`    | `forge test -vv` in `packages/foundry`                                                       |
| `pnpm generate`          | Emits `packages/nextjs/contracts/<Name>.ts` + `<Name>.local.ts` from forge broadcasts + out/ |
| `pnpm start`             | `next dev`                                                                                   |
| `pnpm next:build`        | Production build of the frontend                                                             |
| `pnpm next:check-types`  | TypeScript check on the frontend                                                             |
| `pnpm lint`              | Lint the frontend                                                                            |
| `pnpm format`            | Prettier over the whole repo (`format:check` for no-write)                                   |

## Project structure

```
confidential-prize-vault/
├── scripts/                       # chain.sh, deploy-*.sh, generateTsAbis.ts
├── packages/foundry/              # Solidity contracts
│   ├── src/FHECounter.sol
│   ├── script/DeployFHECounter.s.sol
│   └── test/FHECounter.t.sol      # inherits forge-fhevm's FhevmTest
└── packages/nextjs/               # Frontend
    ├── components/DappWrapperWithProviders.tsx   # wires ZamaProvider + relayer
    ├── hooks/fhecounter-example/useFHECounterWagmi.tsx
    ├── contracts/
    │   ├── FHECounter.ts          # non-local (Sepolia, …) — tracked
    │   └── FHECounter.local.ts    # chainId 31337 overlay — gitignored
    └── utils/contract.ts          # ContractDeployment + deploymentFor()
```

The per-contract `Name.ts` imports `Name.local.ts` and merges at module load, so consumer code is agnostic to which chain a deployment lives on. `postinstall` regenerates both on every `pnpm install`, including an empty stub sidecar on a fresh clone.

## Troubleshooting

- **MetaMask nonce mismatch after restarting anvil** — MetaMask → Settings → Advanced → _Clear activity tab data_.
- **Stale view-function results** — MetaMask caches across reloads; restart the browser (not the tab).
- **`Contract address is not a valid address`** — the relayer SDK requires EIP-55 checksummed addresses. Rerun `pnpm generate`.
- **`pnpm install` asks for a package manager version** — the root pins `packageManager: "pnpm@10.18.3"`. `corepack prepare pnpm@10.18.3 --activate` or match locally.

## FHEVM notes

- **ACL is mandatory.** Every encrypted value needs `FHE.allowThis(handle)` + `FHE.allow(handle, user)` — reads silently fail without it. `FHECounter.sol` does this explicitly.
- **Types are baked into ciphertext handles.** The frontend's `type: "euint32"` must match the contract's `externalEuint32` parameter — mismatch reverts with `InvalidType()`.
- **Local runs cleartext mode.** Anvil hosts a `CleartextFHEVMExecutor` that mirrors every FHE op into a `plaintexts(bytes32)` mapping. No KMS, no gateway, no WASM — `RelayerCleartext` reads plaintext directly. Dev-only.
- **Sepolia uses the real relayer.** `RelayerWeb` spins up a Web Worker and pulls FHE crypto from Zama's CDN. Needs `NEXT_PUBLIC_ALCHEMY_API_KEY`.

## References

[Zama Protocol docs](https://docs.zama.org/) · [`@zama-fhe/sdk`](https://github.com/zama-ai/sdk) · [forge-fhevm](https://github.com/zama-ai/forge-fhevm) · [OpenZeppelin Confidential Contracts](https://github.com/OpenZeppelin/openzeppelin-confidential-contracts) · [Discord](https://discord.com/invite/zama)

## License

BSD-3-Clause-Clear. See [LICENSE](LICENSE).
