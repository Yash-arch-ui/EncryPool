// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialPrizeVault} from "./ConfidentialPrizeVault.sol";
import {EncryptedBalanceTracker} from "./EncryptedBalanceTracker.sol";

/// @title ConfidentialPrizePool
/// @notice End-to-end encrypted PoolTogether-style single-tier prize pool.
/// @dev
///  Winner selection runs ENTIRELY under FHE — there is no coordinator trust:
///
///    slot       = seed mod totalWeight            (seed stays encrypted forever)
///    O_i        = sum_{j<i} W_j                   (encrypted accumulator)
///    isWinner_i = (slot - O_i) mod 2^64  <  W_i
///
///  Soundness of the wrapping range check: slot < T and O_i <= T, so the
///  subtraction wraps only when slot < O_i, giving values in
///  [2^64 - T, 2^64). While T + W_j <= 2T <= 2^64 - 2 (enforced by
///  MAX_TOTAL_WEIGHT = 2^63 - 1), no non-winner can pass the check, and the
///  cumulative ranges [O_i, O_i + W_i) partition [0, T), so exactly one
///  participant wins.
///
///  Confidentiality budget — the ONLY plaintext financial value ever revealed
///  is the aggregate `totalWeight`, because FHE.rem requires a plaintext
///  modulus. Everything else stays encrypted end-to-end:
///   - balances / deposit / withdraw amounts: encrypted (ERC-7984)
///   - per-participant draw weights: encrypted snapshot handles, never revealed
///   - seed: encrypted forever
///   - win status: per-participant encrypted bool, user-decryptable by its
///     owner only — no index parameter exists to probe other participants
///   - prize amount: encrypted; winner-only after claim
///   - winner identity: hidden until the winner claims (inherent to paying
///     an address on a transparent ledger)
///
///  Residual inference: a persistent observer accumulating the aggregate
///  across many draws may attempt statistical inference (e.g. differencing
///  when participation changes). Individual weights are never revealed.
///
///  Fulfillment is permissionless: `totalWeight` is made publicly decryptable
///  in `draw()`, so anyone can obtain its KMS proof and fulfill. A censor can
///  delay a draw but cannot redirect the winner or fabricate totals.
contract ConfidentialPrizePool is ZamaEthereumConfig {
    struct Draw {
        /// @dev Encrypted seed (euint128 to match the rem modulus); never revealed.
        euint128 seedIndex;
        /// @dev Encrypted aggregate weight (euint128: euint64 aggregates wrap
        ///      at ~7.1M USDT held 30 days, which would corrupt the partition).
        euint128 totalWeight;
        /// @dev Encrypted prize amount snapshot.
        euint64 amount;
        /// @dev Encrypted claim latch: set by the winner's claim only.
        ebool claimed;
        bool fulfilled;
        /// @dev Revealed aggregate total weight (the only public financial value).
        uint128 totalWeightPlaintext;
        /// @dev Participant count snapshotted at draw time.
        uint256 participantCount;
    }

    uint64 public constant MIN_DRAW_INTERVAL = 1 minutes;

    /// @dev Soundness bound for the wrapping range check: totalWeight +
    ///      max(W_i) <= 2 * totalWeight must stay below 2^128. Weights are
    ///      euint64 products (<= 2^64 - 1 each), so a total of at most
    ///      2^63 - 1 bounds any realistic pool.
    uint128 public constant MAX_TOTAL_WEIGHT = (type(uint128).max - 1) / 2;

    IERC7984 public immutable asset;
    ConfidentialPrizeVault public immutable vault;
    EncryptedBalanceTracker public immutable weightSource;

    address[] private _participants;
    mapping(address => bool) private _isParticipant;
    mapping(address => uint256) private _participantIndex;

    /// @dev Draw-time encrypted weight snapshot: drawId => participantIndex => W_i
    ///      (euint64; balance x elapsed, each product below 2^64).
    mapping(uint256 => mapping(uint256 => euint64)) private _drawWeights;

    /// @dev Per-draw encrypted win status: drawId => participantIndex => isWinner.
    mapping(uint256 => mapping(uint256 => ebool)) private _drawWinStatus;

    euint64 private _prizeLiquidity;
    mapping(uint256 => Draw) private _draws;
    uint256 private _drawCount;
    uint64 private _lastDrawAt;

    /// @dev True once any prize has been funded: guarantees the pool's own
    ///      ERC-7984 balance handle is initialized before any transfer.
    bool private _potEverFunded;

    event ParticipantRegistered(address indexed account);
    event PrizeFunded(euint64 amount);
    event WinnerSeeded(uint256 indexed drawId, euint128 seedIndex);
    event WinnerFulfilled(uint256 indexed drawId, uint128 totalWeight);
    event PrizeClaimed(uint256 indexed drawId, address indexed claimer);

    error UnauthorizedCaller(address caller);
    error NoParticipants();
    error DrawTooSoon();
    error DrawNotFound(uint256 drawId);
    error DrawNotFulfilled();
    error DrawAlreadyFulfilled();
    error NotParticipant();
    error NotInThisDraw();
    error NoWinnerInDraw(uint256 drawId);

    constructor(IERC7984 asset_, ConfidentialPrizeVault vault_, EncryptedBalanceTracker tracker_) ZamaEthereumConfig() {
        asset = asset_;
        vault = vault_;
        weightSource = tracker_;
    }

    // ── View helpers ──────────────────────────────────────────────────────────

    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    function participants() external view returns (address[] memory) {
        return _participants;
    }

    function getDraw(uint256 drawId) external view returns (Draw memory) {
        return _draws[drawId];
    }

    function prizeLiquidity() external view returns (euint64) {
        return _prizeLiquidity;
    }

    function seedIndexOf(uint256 drawId) external view returns (euint128) {
        return _draws[drawId].seedIndex;
    }

    // ── Registration (O(1)) ────────────────────────────────────────────────────

    /// @dev Called by the vault on every deposit and withdrawal. Weights are
    ///      snapshotted fresh from the tracker inside draw(), so registration
    ///      is the only bookkeeping the pool needs.
    function registerParticipant(address account) external {
        if (msg.sender != address(vault)) revert UnauthorizedCaller(msg.sender);

        if (!_isParticipant[account]) {
            _isParticipant[account] = true;
            _participantIndex[account] = _participants.length;
            _participants.push(account);
            emit ParticipantRegistered(account);
        }
    }

    // ── Prize funding ─────────────────────────────────────────────────────────

    function fundPrize(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 received = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        (ebool ok, euint64 updated) = FHESafeMath.tryIncrease(_prizeLiquidity, received);
        _prizeLiquidity = FHE.select(ok, updated, _prizeLiquidity);
        FHE.allowThis(_prizeLiquidity);
        _potEverFunded = true;

        emit PrizeFunded(received);
    }

    // ── Draw: O(N) FHE snapshot, nothing revealed ──────────────────────────────

    /// @notice Snapshots every participant's encrypted weight, sums the
    ///         encrypted aggregate, and rolls a fresh encrypted seed. The
    ///         aggregate alone is made publicly decryptable so fulfillment
    ///         stays permissionless; no individual weight is ever revealed.
    function draw() external returns (uint256 drawId) {
        if (_participants.length == 0) revert NoParticipants();
        unchecked {
            if (_lastDrawAt != 0 && block.timestamp - _lastDrawAt < MIN_DRAW_INTERVAL) revert DrawTooSoon();
        }

        drawId = ++_drawCount;
        Draw storage d = _draws[drawId];

        euint128 totalWeight = FHE.asEuint128(uint128(0));
        for (uint256 i = 0; i < _participants.length; i++) {
            euint64 w = weightSource.computeWeight(_participants[i]);
            // Snapshot the tracker-owned handle and keep persistent pool
            // access for the fulfillment pass in a later transaction.
            _drawWeights[drawId][i] = w;
            FHE.allowThis(w);
            totalWeight = FHE.add(totalWeight, FHE.asEuint128(w));
        }
        FHE.allowThis(totalWeight);

        euint128 rand = FHE.randEuint128();
        FHE.allowThis(rand);

        // Snapshot the prize pot; an unfunded pool snapshots an initialized
        // zero so the winner's transfer never touches an uninitialized handle.
        euint64 amount = FHE.asEuint64(0);
        if (FHE.isInitialized(_prizeLiquidity)) {
            amount = _prizeLiquidity;
        }
        FHE.allowThis(amount);

        d.seedIndex = rand;
        d.totalWeight = totalWeight;
        d.amount = amount;
        d.claimed = FHE.asEbool(false);
        FHE.allowThis(d.claimed);
        d.fulfilled = false;
        d.totalWeightPlaintext = 0;
        d.participantCount = _participants.length;

        _prizeLiquidity = FHE.asEuint64(0);
        FHE.allowThis(_prizeLiquidity);
        _lastDrawAt = uint64(block.timestamp);

        FHE.makePubliclyDecryptable(d.totalWeight);

        emit WinnerSeeded(drawId, rand);
    }

    // ── Fulfillment: permissionless, aggregate-only KMS reveal ────────────────

    /// @notice Reveals the aggregate total weight — KMS-proof-bound to the
    ///         stored handle so no one can lie about it — and computes every
    ///         participant's encrypted win status on-chain. Individual
    ///         weights and the seed stay encrypted.
    /// @param drawId The draw to fulfill.
    /// @param totalWeightPlaintext The decrypted aggregate total weight.
    /// @param decryptionProof KMS proof that the stored totalWeight handle
    ///        decrypts to exactly this value.
    function fulfillWinner(uint256 drawId, uint128 totalWeightPlaintext, bytes calldata decryptionProof) external {
        Draw storage d = _draws[drawId];
        if (drawId == 0 || drawId > _drawCount) revert DrawNotFound(drawId);
        if (d.fulfilled) revert DrawAlreadyFulfilled();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint128.unwrap(d.totalWeight);
        FHE.checkSignatures(handles, abi.encode(totalWeightPlaintext), decryptionProof);

        d.totalWeightPlaintext = totalWeightPlaintext;
        d.fulfilled = true;

        // Zero-weight or oversize draws have no winner: the no-loss primitive
        // requires the prize to roll back into the pool for the next draw.
        if (totalWeightPlaintext == 0 || totalWeightPlaintext > MAX_TOTAL_WEIGHT) {
            (ebool ok, euint64 rolled) = FHESafeMath.tryIncrease(_prizeLiquidity, d.amount);
            _prizeLiquidity = FHE.select(ok, rolled, _prizeLiquidity);
            FHE.allowThis(_prizeLiquidity);
            emit WinnerFulfilled(drawId, totalWeightPlaintext);
            return;
        }

        // Encrypted slot in [0, totalWeight): the seed is never revealed.
        euint128 slot = FHE.rem(d.seedIndex, totalWeightPlaintext);

        euint128 cumulative = FHE.asEuint128(uint128(0));
        for (uint256 i = 0; i < d.participantCount; i++) {
            euint64 w = _drawWeights[drawId][i];
            euint128 w128 = FHE.asEuint128(w);

            // Wrapping range check: (slot - O_i) mod 2^128 < W_i
            // holds iff O_i <= slot < O_i + W_i, because slot < T <= 2^127.
            euint128 adjusted = FHE.sub(slot, cumulative);
            ebool isWinner = FHE.lt(adjusted, w128);

            _drawWinStatus[drawId][i] = isWinner;
            FHE.allowThis(isWinner);
            FHE.allow(isWinner, _participants[i]);

            cumulative = FHE.add(cumulative, w128);
        }

        emit WinnerFulfilled(drawId, totalWeightPlaintext);
    }

    // ── Result check: own status only, no oracle ──────────────────────────────

    /// @notice Returns the caller's own encrypted win status for a fulfilled
    ///         draw. Only the caller can user-decrypt the returned handle;
    ///         there is no index parameter to probe other participants.
    function checkResult(uint256 drawId) external view returns (ebool) {
        Draw storage d = _draws[drawId];
        if (drawId == 0 || drawId > _drawCount) revert DrawNotFound(drawId);
        if (!d.fulfilled) revert DrawNotFulfilled();
        if (!_isParticipant[msg.sender]) revert NotParticipant();
        if (d.totalWeightPlaintext == 0 || d.totalWeightPlaintext > MAX_TOTAL_WEIGHT) {
            revert NoWinnerInDraw(drawId);
        }
        uint256 index = _participantIndex[msg.sender];
        if (index >= d.participantCount) revert NotInThisDraw();
        return _drawWinStatus[drawId][index];
    }

    // ── Claim: zero exploitable parameters ─────────────────────────────────────

    /// @notice The winner claims the encrypted prize. The only parameter is
    ///         the draw id: the caller's identity alone selects their
    ///         snapshotted win status, so indexes, offsets, and weights
    ///         cannot be substituted, replayed, or fabricated. A non-winner
    ///         or repeat claim transfers zero and never locks the draw.
    function claim(uint256 drawId) external {
        Draw storage d = _draws[drawId];
        if (drawId == 0 || drawId > _drawCount) revert DrawNotFound(drawId);
        if (!d.fulfilled) revert DrawNotFulfilled();
        if (!_isParticipant[msg.sender]) revert NotParticipant();
        if (d.totalWeightPlaintext == 0 || d.totalWeightPlaintext > MAX_TOTAL_WEIGHT) {
            revert NoWinnerInDraw(drawId);
        }
        uint256 index = _participantIndex[msg.sender];
        if (index >= d.participantCount) revert NotInThisDraw();

        ebool isWinner = _drawWinStatus[drawId][index];

        // claimOk = isWinner AND NOT claimed (all under FHE).
        ebool notYetClaimed = FHE.select(d.claimed, FHE.asEbool(false), FHE.asEbool(true));
        ebool claimOk = FHE.and(isWinner, notYetClaimed);
        d.claimed = FHE.select(isWinner, FHE.asEbool(true), d.claimed);
        FHE.allowThis(d.claimed);

        // An empty pot (never funded since deployment) would revert inside
        // ERC-7984 _update: the pool's own encrypted token balance is
        // uninitialized, so even a zero transfer is rejected. Nothing is owed
        // in that case — skip the transfer. This reveals only whether the pot
        // was ever funded, an aggregate already observable from fundPrize txs.
        if (_potEverFunded) {
            euint64 transferAmount = FHE.select(claimOk, d.amount, FHE.asEuint64(0));
            FHE.allowTransient(transferAmount, address(asset));
            asset.confidentialTransfer(msg.sender, transferAmount);
        }

        emit PrizeClaimed(drawId, msg.sender);
    }
}
