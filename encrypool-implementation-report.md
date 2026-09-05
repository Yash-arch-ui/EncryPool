# Encrypool Implementation Report

## A. CONTRACT CHANGES

**`contracts/src/ConfidentialPrizePool.sol`** (rewritten core):

- `draw()` snapshots a **fresh encrypted weight handle per participant** into `_drawWeightHandles[drawId][i]`, makes each handle `makePubliclyDecryptable` (preserving the approved coordinator/KMS workflow), and records `participantCount` in the draw struct. The handles are immutable for the draw's lifetime.
- `fulfillWinner(drawId, revealedSeed, weights[], proof)` builds the expected handle array **exclusively from stored draw-time state** — `[seedIndex, totalWeight, drawWeightHandle_0..N-1]` — and verifies it with `FHE.checkSignatures`, which binds each coordinator-supplied plaintext to its exact handle. It rejects `InvalidWeightsLength`, `TotalWeightIsZero`, `DrawAlreadyFulfilled`. Winner is then computed **on-chain** from the KMS-verified plaintexts (`slot = keccak256(seed) % totalWeight`, cumulative-range scan), and cumulative offsets are stored privately in `_drawOffsets` — **no public offset getter**.
- `claim(drawId, participantIndex, offset)` binds `participantIndex` to `msg.sender` (`NotYourIndex`), requires the stored winner (`NotWinner`), verifies the offset against the stored cumulative offset, recomputes the winner check under FHE using **`_drawWeightHandles[drawId][participantIndex]`** (never fresh `computeWeight()`), and gates the transfer with `FHE.select(isWinner, amount, zero)`. Recipient is always `msg.sender`.
- Removed: `checkResult()`, `drawOffset()` getter, `MAX_PARTICIPANTS` cap. Added `revealedSeed`/`totalWeightPlaintext`/`participantCount` to the draw struct and `WinnerFulfilled` event.

**`contracts/src/ConfidentialPrizeVault.sol`**: removed participant cap + `MaxPoolFull`, replaced the registry interface with `updateParticipantWeight(account, oldWeight, newBalance)`, added owner-based pool setting.

## B. TEST RESULTS

**46/46 pass, 0 failed** across 4 suites (`forge test`): `ConfidentialPrizePool.t.sol` (24), `CheckpointGaming.t.sol` (12), `ConfidentialPrizeVault.t.sol` (8), `FHECounter.t.sol` (3). All pre-existing tests preserved; new tests cover draw-snapshot storage, stale-`_participantWeight` proof rejection, wrong-plaintext rejection, zero-total-weight rejection, post-draw deposit/withdrawal immutability, non-winner/cross-index/cross-draw/fabricated-offset/repeated-claim rejection, payout-recipient binding, and deterministic single-winner proof.

## C. DRAW SNAPSHOT

`draw()` stores each participant's fresh `weightSource.computeWeight()` handle in `_drawWeightHandles[drawId][i]` with persistent ACL (`allowThis` + `allow(participant)` + public decryption). Fulfillment and claim read **only** these handles; `_participantWeight` is used solely for incremental current-weight tracking and is never consulted for historical draws.

## D. COORDINATOR/KMS FLOW

Coordinator reads `drawWeightHandle(drawId, i)` for all `i < participantCount`, public-decrypts `[seed, totalWeight, weight_0..N-1]` via the Zama relayer (all handles are `makePubliclyDecryptable`), then submits `fulfillWinner(drawId, revealedSeed, weights, proof)`. The contract builds the handle list from its own snapshot — the coordinator cannot substitute unrelated ciphertexts — and `FHE.checkSignatures` fails any proof over stale or mismatched handles (verified empirically with a scratch probe, then covered by `test_fulfill_rejectsStaleParticipantWeightProof`).

## E. CLAIM SECURITY

- **Caller binding**: `_participants[participantIndex] != msg.sender → NotYourIndex`.
- **Winner binding**: `msg.sender != d.winner → NotWinner`.
- **Weight binding**: winner check uses the draw-time handle; post-draw deposits/withdrawals cannot alter it.
- **Offset binding**: `offsetPlaintext == _drawOffsets[drawId][participantIndex]`, verified against KMS-revealed plaintexts.
- **Replay protection**: `d.claimed` flag; per-draw offsets cannot be reused cross-draw.
- **FHE gate**: `FHE.select(isWinner, amount, zero)`; recipient is always `msg.sender`.

## F. USER PRIVACY / ACL

Deposits/withdrawals remain encrypted end-to-end (handles only, never plaintext). `_participantWeight`, vault shares, and checkpoint state stay user-authorized (`FHE.allow(handle, account)` per participant; verified by existing vault tests `test_twoUsers_positionsAreIndependent`). Only draw-time weight handles — the approved coordinator data — are publicly decryptable; no other user-private state is exposed.

## G. FRONTEND CHANGES

- `nextjs/hooks/encrypool/useClaimablePrize.ts`: rewritten for the coordinator-fulfillment model — resolves caller's own index and cumulative offset from public participant list + public-decrypted draw-time handles, calls `claim(drawId, index, offset)`, adds winner-only `requestPrizeReveal` decryption of the claimed amount.
- `nextjs/app/account/page.tsx`: updated button lifecycle (Check → Claim → Reveal) and messages; no winner computation client-side.
- `nextjs/app/vault/[chainId]/[address]/page.tsx`: removed stale `MaxPoolFull`/`MaxParticipantsReached` handling.
- `nextjs/hooks/encrypool/draws.ts`: `DrawState` gains `totalWeight`, `revealedSeed`, `totalWeightPlaintext`.
- `nextjs/contracts/ConfidentialPrizePool.ts` / `ConfidentialPrizeVault.ts`: regenerated ABIs (`MAX_PARTICIPANTS` gone, new `claim`/`fulfillWinner`/`drawWeightHandle` signatures) with the Sepolia address preserved.
- `nextjs/scripts/e2e-sepolia-draw.mjs`: full live flow — draw → draw-time handles → batch KMS public decrypt → `fulfillWinner` → local offset → `claim` → winner-only prize decryption.

Frontend typecheck: **clean** (`tsc --noEmit --incremental`, exit 0).

## H. DEPLOYMENT

No new deployment performed this pass (contracts changed after the last Sepolia deploy — the on-chain pool `0xc866E74cA50f84e7986CE8c92755D50Bd13AB2B6` still runs the old bytecode). Redeploy the pool+vault pair, update `poolDeployment`/`vaultDeployment` addresses, then run `nextjs/scripts/e2e-sepolia-draw.mjs`.

## I. END-TO-END RESULT

Contract-level e2e (`test_fullCycle_drawFulfillClaimAndPrivacy`) confirms: ✅ encrypted balance → ✅ draw-time weight snapshot → ✅ KMS-verified fulfillment → ✅ winner claim → ✅ FHE-gated transfer → ✅ winner decryption → ✅ non-winner rejection → ✅ cross-user index rejection → ✅ post-draw balance change does not affect winner. Live-Sepolia verification is pending redeployment (H).

## J. REMAINING LIMITATIONS

1. **O(N) draw** — retained per approved scope; practical limit ~15–20 participants on the Sepolia FHE/HCU budget.
2. **Trusted coordinator** — intentional: the coordinator sees draw plaintexts and can censor fulfillment (never falsify a winner, since plaintexts must match the contract's stored handles).
3. **Zero-weight participants** can never win (their range is empty) — mathematically correct, documented behavior.
4. Redeployment + live Sepolia e2e still to be executed.
