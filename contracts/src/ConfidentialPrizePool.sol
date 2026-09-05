// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialPrizeVault} from "./ConfidentialPrizeVault.sol";
import {EncryptedBalanceTracker} from "./EncryptedBalanceTracker.sol";

/// @title ConfidentialPrizePool
/// @notice Single-tier prize pool for the ConfidentialPrizeVault. Runs weighted draws
///         with encrypted randomness (FHE.randEuint64) and snapshots every participant's
///         draw-time weight as an encrypted handle. A trusted coordinator performs Zama's
///         public-decryption flow (KMS-signed batch proof) on the draw-time handles and
///         fulfills the draw on-chain: the revealed seed selects the winner by weighted
///         slot math (`slot = seed % totalWeight`), the winner address becomes public,
///         and the whole encrypted pot is paid out to the winner on claim.
///
///  Confidentiality budget — the only values that ever leave ciphertext form are the
///  aggregate `totalWeight` and the winning address (both inherent to the
///  public-decryption fulfillment flow approved for this deployment). Per-participant
///  weights are revealed to the trusted coordinator for fulfillment; balances, deposit
///  amounts, the prize size and every non-winning participant's status stay encrypted.
contract ConfidentialPrizePool is ZamaEthereumConfig {
    struct Draw {
        /// @dev Encrypted seed handle (euint64) rolled by draw(); publicly decryptable.
        euint64 seedIndex;
        /// @dev Encrypted aggregate weight handle (euint64); publicly decryptable.
        euint64 totalWeight;
        /// @dev Encrypted pot snapshot taken at draw time.
        euint64 amount;
        /// @dev Winner address, revealed at KMS-verified fulfillment.
        address winner;
        bool fulfilled;
        bool claimed;
        /// @dev Revealed seed plaintext (set by fulfillWinner).
        uint64 revealedSeed;
        /// @dev Revealed aggregate weight plaintext (set by fulfillWinner).
        uint64 totalWeightPlaintext;
        /// @dev Participant count snapshotted at draw time.
        uint256 participantCount;
    }

    uint64 public constant MIN_DRAW_INTERVAL = 60 minutes;

    IERC7984 public immutable asset;
    ConfidentialPrizeVault public immutable vault;
    EncryptedBalanceTracker public immutable weightSource;

    /// @notice The only address permitted to call draw(). Set by the vault
    ///         owner (deployer) at construction; rotatable via setKeeper().
    address public keeper;

    address[] private _participants;
    mapping(address => bool) private _isParticipant;
    mapping(address => uint256) private _participantIndex;
    mapping(address => euint64) private _participantWeights;

    /// @dev Draw-time encrypted weight snapshot: drawId => participantIndex => W_i.
    mapping(uint256 => mapping(uint256 => euint64)) private _drawWeights;

    euint64 private _prizeLiquidity;
    mapping(uint256 => Draw) private _draws;
    uint256 private _drawCount;
    uint64 private _lastDrawAt;

    /// @dev Plaintext cumulative offset stored per participant at fulfillment:
    ///      offset[i] = Σ_{j<i} weight[j]. Verified by claim() against the caller's
    ///      passed offset so a participant cannot claim with a fabricated offset.
    mapping(uint256 => mapping(uint256 => uint64)) private _drawOffsets;

    event ParticipantRegistered(address indexed account);
    event PrizeFunded(euint64 amount);
    event WinnerSeeded(uint256 indexed drawId, euint64 seedIndex);
    event WinnerFulfilled(uint256 indexed drawId, address indexed winner, uint64 revealedSeed, uint64 totalWeight);
    event PrizeClaimed(uint256 indexed drawId, address indexed winner);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);

    error UnauthorizedCaller(address caller);
    error NotKeeper();
    error NoParticipants();
    error DrawTooSoon();
    error DrawNotFulfilled();
    error DrawAlreadyFulfilled();
    error DrawAlreadyClaimed();
    error NotWinner();
    error NotYourIndex();
    error TotalWeightIsZero();
    error InvalidWeightsLength();
    error ZeroKeeper();

    constructor(IERC7984 asset_, ConfidentialPrizeVault vault_, EncryptedBalanceTracker tracker_, address keeper_)
        ZamaEthereumConfig()
    {
        asset = asset_;
        vault = vault_;
        weightSource = tracker_;
        keeper = keeper_;
        emit KeeperUpdated(address(0), keeper_);
    }

    // ── Keeper management (admin only) ────────────────────────────────────────

    /// @notice Rotates the keeper address. Only callable by the vault owner
    ///         (deployer / admin).
    function setKeeper(address newKeeper) external {
        if (msg.sender != vault.owner()) revert UnauthorizedCaller(msg.sender);
        if (newKeeper == address(0)) revert ZeroKeeper();
        address old = keeper;
        keeper = newKeeper;
        emit KeeperUpdated(old, newKeeper);
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

    /// @notice The publicly-decryptable seed handle of a draw (post-draw).
    function seedIndexOf(uint256 drawId) external view returns (euint64) {
        return _draws[drawId].seedIndex;
    }

    /// @notice The participant's last-reported weight handle (maintained by the vault).
    function participantWeight(address account) external view returns (euint64) {
        return _participantWeights[account];
    }

    /// @notice The draw-time encrypted weight snapshot handle for a participant.
    function drawWeightHandle(uint256 drawId, uint256 participantIndex) external view returns (euint64) {
        return _drawWeights[drawId][participantIndex];
    }

    /// @notice Total number of draws performed.
    function drawCount() external view returns (uint256) {
        return _drawCount;
    }

    /// @notice Timestamp of the last draw (0 if none).
    function lastDrawAt() external view returns (uint64) {
        return _lastDrawAt;
    }

    /// @notice When the next draw becomes eligible. 0 = due now (if participants
    ///         exist); otherwise _lastDrawAt + MIN_DRAW_INTERVAL.
    function nextDrawAt() external view returns (uint64) {
        if (_lastDrawAt == 0) return 0;
        return _lastDrawAt + MIN_DRAW_INTERVAL;
    }

    /// @notice Convenience: whether the keeper may call draw() right now.
    function isDrawDue() external view returns (bool) {
        if (_participants.length == 0) return false;
        return _lastDrawAt == 0 || block.timestamp >= _lastDrawAt + MIN_DRAW_INTERVAL;
    }

    // ── Participant bookkeeping (vault-driven) ────────────────────────────────

    /// @dev Called by the vault after every deposit/withdrawal. Registers the account
    ///      on first touch and refreshes its current weight handle. The pool only ever
    ///      reads draw-time snapshots for draws; this keeps the interface used by the
    ///      vault and exposes the current-weight view to the frontend.
    function updateParticipantWeight(address account, euint64 oldWeight, euint64 newWeight) external {
        if (msg.sender != address(vault)) revert UnauthorizedCaller(msg.sender);

        if (!_isParticipant[account]) {
            _isParticipant[account] = true;
            _participantIndex[account] = _participants.length;
            _participants.push(account);
            emit ParticipantRegistered(account);
        }

        _participantWeights[account] = newWeight;
        FHE.allowThis(newWeight);
        FHE.allow(newWeight, account);
    }

    // ── Prize funding ─────────────────────────────────────────────────────────

    /// @notice Tops up the prize pot with an encrypted amount of the confidential asset.
    function fundPrize(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 received = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        (ebool ok, euint64 updated) = FHESafeMath.tryIncrease(_prizeLiquidity, received);
        _prizeLiquidity = FHE.select(ok, updated, _prizeLiquidity);
        FHE.allowThis(_prizeLiquidity);

        emit PrizeFunded(received);
    }

    // ── Draw: encrypted weight snapshot + encrypted seed, nothing revealed ────

    /// @notice Keeper-only automation. The keeper (set at deployment, rotatable
    ///         by the vault owner) triggers the draw once the cooldown clears.
    ///         Participants cannot trigger draws. Snapshots each participant's
    ///         encrypted draw-time weight, rolls a fresh encrypted seed
    ///         (FHE.randEuint64), and makes the seed/totalWeight/weight handles
    ///         publicly decryptable so the trusted coordinator can KMS-reveal them.
    function draw() external returns (uint256 drawId) {
        if (msg.sender != keeper) revert NotKeeper();
        uint256 count = _participants.length;
        if (count == 0) revert NoParticipants();
        unchecked {
            if (_lastDrawAt != 0 && block.timestamp - _lastDrawAt < MIN_DRAW_INTERVAL) revert DrawTooSoon();
        }

        drawId = ++_drawCount;
        Draw storage d = _draws[drawId];

        euint64 totalWeight = FHE.asEuint64(0);
        for (uint256 i = 0; i < count; i++) {
            euint64 w = weightSource.computeWeight(_participants[i]);
            _drawWeights[drawId][i] = w;
            FHE.allowThis(w);
            totalWeight = FHE.add(totalWeight, w);
        }
        FHE.allowThis(totalWeight);

        euint64 seed = FHE.randEuint64();
        FHE.allowThis(seed);

        euint64 amount = _prizeLiquidity;
        FHE.allowThis(amount);

        d.seedIndex = seed;
        d.totalWeight = totalWeight;
        d.amount = amount;
        d.winner = address(0);
        d.fulfilled = false;
        d.claimed = false;
        d.revealedSeed = 0;
        d.totalWeightPlaintext = 0;
        d.participantCount = count;

        // The coordinator's public-decryption flow needs KMS access to every
        // draw-time handle: seed, aggregate weight, and each participant weight.
        FHE.makePubliclyDecryptable(seed);
        FHE.makePubliclyDecryptable(totalWeight);
        for (uint256 i = 0; i < count; i++) {
            FHE.makePubliclyDecryptable(_drawWeights[drawId][i]);
        }

        // Detach the pot: each draw's amount handle is transferred exactly once at claim.
        _prizeLiquidity = FHE.asEuint64(0);
        FHE.allowThis(_prizeLiquidity);
        _lastDrawAt = uint64(block.timestamp);

        emit WinnerSeeded(drawId, seed);
    }

    // ── Fulfillment: trusted-coordinator KMS reveal + on-chain winner selection ──

    /// @notice Finalizes a draw given the KMS-signed decryption of its draw-time
    ///         handles. The proof binds the revealed seed and per-participant weights
    ///         to the stored encrypted handles, so no one can fabricate an outcome.
    ///         The winner is then selected by weighted slot math entirely in plaintext
    ///         (the seed is public from this point): slot = seed % totalWeight, and the
    ///         winner is the participant whose cumulative weight interval contains slot.
    function fulfillWinner(
        uint256 drawId,
        uint64 revealedSeed,
        uint64[] calldata weights,
        bytes calldata decryptionProof
    ) external {
        Draw storage d = _draws[drawId];
        if (d.fulfilled) revert DrawAlreadyFulfilled();
        if (weights.length != d.participantCount) revert InvalidWeightsLength();

        uint64 totalWeight = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            totalWeight += weights[i];
        }
        if (totalWeight == 0) revert TotalWeightIsZero();

        // Handles in exactly the order the draw() made publicly decryptable:
        // [seedIndex, totalWeight, drawWeight_0, ..., drawWeight_N-1].
        bytes32[] memory handles = new bytes32[](2 + weights.length);
        handles[0] = euint64.unwrap(d.seedIndex);
        handles[1] = euint64.unwrap(d.totalWeight);
        for (uint256 i = 0; i < weights.length; i++) {
            handles[2 + i] = euint64.unwrap(_drawWeights[drawId][i]);
        }

        // Cleartexts in the same order, packed as 32-byte words (matching the
        // relayer's signed payload — verified against the deployed KMSVerifier).
        uint64[] memory clearValues = new uint64[](2 + weights.length);
        clearValues[0] = revealedSeed;
        clearValues[1] = totalWeight;
        for (uint256 i = 0; i < weights.length; i++) {
            clearValues[2 + i] = weights[i];
        }
        FHE.checkSignatures(handles, abi.encodePacked(clearValues), decryptionProof);

        uint64 slot = revealedSeed % totalWeight;
        uint64 cum = 0;
        address winner = address(0);
        for (uint256 i = 0; i < weights.length; i++) {
            _drawOffsets[drawId][i] = cum;
            if (winner == address(0) && slot < cum + weights[i]) {
                winner = _participants[i];
            }
            cum += weights[i];
        }

        d.winner = winner;
        d.revealedSeed = revealedSeed;
        d.totalWeightPlaintext = totalWeight;
        d.fulfilled = true;

        emit WinnerFulfilled(drawId, winner, revealedSeed, totalWeight);
    }

    // ── Claim ─────────────────────────────────────────────────────────────────

    /// @notice Pays the draw's encrypted pot to the winner. Only the winner may call
    ///         this; they must identify their own participant index and the cumulative
    ///         plaintext offset stored at fulfillment (`offset[i] = Σ_{j<i} weight[j]`),
    ///         both of which are verified against storage. Only the winner (as the
    ///         token transfer recipient) gains decryption rights on the prize size.
    function claim(uint256 drawId, uint256 participantIndex, uint256 offsetPlaintext) external {
        Draw storage d = _draws[drawId];
        if (!d.fulfilled) revert DrawNotFulfilled();
        if (d.claimed) revert DrawAlreadyClaimed();
        if (d.totalWeightPlaintext == 0) revert TotalWeightIsZero();
        if (participantIndex >= _participants.length || _participants[participantIndex] != msg.sender) {
            revert NotYourIndex();
        }
        if (d.winner != msg.sender) revert NotWinner();
        if (_drawOffsets[drawId][participantIndex] != offsetPlaintext) revert("invalid offset");

        d.claimed = true;
        euint64 amount = d.amount;
        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(msg.sender, amount);

        emit PrizeClaimed(drawId, msg.sender);
    }
}
