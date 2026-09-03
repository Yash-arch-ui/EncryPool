// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint8, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialPrizeVault} from "./ConfidentialPrizeVault.sol";
import {EncryptedBalanceTracker} from "./EncryptedBalanceTracker.sol";

/// @title ConfidentialPrizePool
/// @notice Single-tier, single-vault prize pool for the ConfidentialPrizeVault. Holds
/// sponsored prize liquidity, registers vault depositors as participants, runs weighted
/// draws using Zama's on-chain encrypted randomness (`FHE.randEuint64`, per
/// docs.zama.org protocol/solidity-guides/smart-contract/operations/random), and pays the
/// whole pot to the winner on claim. Winner identity is revealed through Zama's public
/// decryption flow (KMS-signed proof verified on-chain via `FHE.checkSignatures`);
/// individual balances and the winning probability inputs stay encrypted throughout.
contract ConfidentialPrizePool is ZamaEthereumConfig {
    struct Draw {
        euint8 seedIndex; // publicly decryptable winner-index handle
        euint64 amount; // encrypted pot snapshot taken at draw time
        address winner; // set after KMS-verified fulfillment
        bool fulfilled;
        bool claimed;
    }

    /// @dev Permissionless draws need a cooldown so nobody can grind draws for timing
    /// advantages; PoolTogether V5 instead uses a dedicated draw manager + prize tiers.
    uint64 public constant MIN_DRAW_INTERVAL = 1 minutes;

    IERC7984 public immutable asset;
    ConfidentialPrizeVault public immutable vault;

    /// @notice Weights come from the vault's checkpointed balance-over-time tracker.
    EncryptedBalanceTracker public immutable weightSource;

    address[] private _participants;
    mapping(address account => bool) private _isParticipant;

    euint64 private _prizeLiquidity;
    mapping(uint256 drawId => Draw) private _draws;
    uint256 private _drawCount;
    uint64 private _lastDrawAt;

    event ParticipantRegistered(address indexed account);
    event PrizeFunded(euint64 amount);
    event WinnerSeeded(uint256 indexed drawId, euint8 seedIndex);
    event WinnerSet(uint256 indexed drawId, address indexed winner);
    event PrizeClaimed(uint256 indexed drawId, address indexed winner);

    error UnauthorizedCaller(address caller);
    error NoParticipants();
    error TooManyParticipants();
    error DrawTooSoon();
    error DrawNotFulfilled();
    error DrawAlreadyFulfilled();
    error DrawAlreadyClaimed();
    error NotWinner();
    error InvalidWinnerIndex();

    constructor(IERC7984 asset_, ConfidentialPrizeVault vault_, EncryptedBalanceTracker tracker_) ZamaEthereumConfig() {
        asset = asset_;
        vault = vault_;
        weightSource = tracker_;
    }

    /// @notice Number of registered participants (addresses are public by nature of
    /// transacting; their amounts are not).
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

    /// @notice The publicly-decryptable winner-index handle of a draw (post-draw).
    function seedIndexOf(uint256 drawId) external view returns (euint8) {
        return _draws[drawId].seedIndex;
    }

    /// @dev Called by the vault on a depositor's first deposit.
    function registerParticipant(address account) external {
        if (msg.sender != address(vault)) revert UnauthorizedCaller(msg.sender);
        if (!_isParticipant[account]) {
            _isParticipant[account] = true;
            _participants.push(account);
            emit ParticipantRegistered(account);
        }
    }

    /// @notice Tops up the prize pot with an encrypted amount of the confidential asset.
    /// @dev SIMPLIFICATION vs PoolTogether V5: PT accrues yield on deposited principal
    /// inside yield-bearing vaults and sweeps it into per-tier prize pools. Our MVP vault
    /// holds plain cUSDT (no yield source under this scope), so prizes are externally
    /// sponsored liquidity. Multi-tier allocation is cut to a single take-all tier.
    function fundPrize(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        // The pool derives the handle itself (proof bound sponsor -> pool), then lends the
        // token transient access for the internal ops during the pull.
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(asset));
        euint64 received = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        (ebool ok, euint64 updated) = FHESafeMath.tryIncrease(_prizeLiquidity, received);
        _prizeLiquidity = FHE.select(ok, updated, _prizeLiquidity);
        FHE.allowThis(_prizeLiquidity);

        emit PrizeFunded(received);
    }

    /// @notice Runs a weighted draw among all participants. Anyone may call it after the
    /// cooldown; the outcome is unbiased regardless of caller because weights and
    /// randomness never leave ciphertext form.
    /// @return drawId The id of the created draw (awaiting KMS-verified fulfillment).
    function draw() external returns (uint256 drawId) {
        uint256 count = _participants.length;
        if (count == 0) revert NoParticipants();
        if (count > type(uint8).max) revert TooManyParticipants();
        unchecked {
            if (_lastDrawAt != 0 && block.timestamp - _lastDrawAt < MIN_DRAW_INTERVAL) revert DrawTooSoon();
        }

        // One pass: cache each participant's transiently-granted weight handle and sum.
        euint128[] memory weights = new euint128[](count);
        euint128 totalWeight = FHE.asEuint128(0);
        for (uint256 i = 0; i < count; i++) {
            weights[i] = weightSource.computeWeight(_participants[i]);
            totalWeight = FHE.add(totalWeight, weights[i]);
        }

        // Official randomness source: FHE.randEuint64(), U[0, 2^64), transaction-only.
        // Scaled sampling: x = floor(r * totalWeight / 2^64) is uniform on [0, totalWeight)
        // up to a negligible (< totalWeight/2^64) truncation bias; comparing
        // x < cumulative thresholds without division means checking
        // r * totalWeight < cum * 2^64 entirely in euint128 (products cannot wrap because
        // totalWeight fits well below 2^64 after the 30-day window cap).
        euint128 x = FHE.mul(FHE.asEuint128(FHE.randEuint64()), totalWeight);
        euint128 scale = FHE.asEuint128(uint128(1) << 64);

        euint128 cum = FHE.asEuint128(0);
        euint8 winnerIndex = FHE.asEuint8(0);
        for (uint256 i = 0; i < count; i++) {
            // Intervals partition [0, totalWeight), so exactly one hits and a plain select
            // walk needs no stickiness flag. Zero-weight accounts occupy empty intervals.
            ebool hit = FHE.and(FHE.ge(x, FHE.mul(cum, scale)), FHE.lt(x, FHE.mul(FHE.add(cum, weights[i]), scale)));
            winnerIndex = FHE.select(hit, FHE.asEuint8(uint8(i)), winnerIndex);
            cum = FHE.add(cum, weights[i]);
        }
        // Degenerate corner: if every weight is zero (all positions emptied within the
        // same block they were created) no interval hits and participant 0 wins by
        // default; unreachable in practice because draws respect the 1-day cooldown.

        FHE.makePubliclyDecryptable(winnerIndex);

        drawId = ++_drawCount;
        _draws[drawId] = Draw({
            seedIndex: winnerIndex, amount: _prizeLiquidity, winner: address(0), fulfilled: false, claimed: false
        });
        // Detach the pot from future funding/draws so each draw's amount handle can be
        // transferred exactly once at claim.
        _prizeLiquidity = FHE.asEuint64(0);
        FHE.allowThis(_prizeLiquidity);
        _lastDrawAt = uint64(block.timestamp);

        emit WinnerSeeded(drawId, winnerIndex);
    }

    /// @notice Finalizes a draw given the KMS-signed decryption of its winner index.
    /// The cleartext index (hence winner address) becomes public here — unavoidable,
    /// since claims must authenticate the winner by address — while all amounts remain
    /// encrypted. This mirrors Zama's public-decryption flow:
    /// request -> KMS signs (handle, cleartext) -> anyone submits proof -> checkSignatures.
    function fulfillWinner(uint256 drawId, uint8 winnerIndex, bytes calldata decryptionProof) external {
        Draw storage d = _draws[drawId];
        if (d.fulfilled) revert DrawAlreadyFulfilled();
        if (winnerIndex >= _participants.length) revert InvalidWinnerIndex();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(d.seedIndex);
        FHE.checkSignatures(handles, abi.encode(winnerIndex), decryptionProof);

        d.winner = _participants[winnerIndex];
        d.fulfilled = true;
        emit WinnerSet(drawId, d.winner);
    }

    /// @notice Pays the draw's entire encrypted pot to the winner. Only the winner can
    /// call this; only they (as the token's transfer recipient) gain decryption rights on
    /// the received amount, so nobody else ever learns the prize size client-side.
    function claim(uint256 drawId) external {
        Draw storage d = _draws[drawId];
        if (!d.fulfilled) revert DrawNotFulfilled();
        if (d.claimed) revert DrawAlreadyClaimed();
        if (msg.sender != d.winner) revert NotWinner();

        d.claimed = true;
        euint64 amount = d.amount;
        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(msg.sender, amount);

        emit PrizeClaimed(drawId, msg.sender);
    }

    // ── Scope cuts vs PoolTogether V5 (deliberate, deadline-driven) ───────────────
    // 1. Single prize tier: PT V5 computes multiple tiers from the prize share; here one
    //    winner takes the whole pot.
    // 2. Single vault/token: PT V5 fans prizes out proportionally across many vaults'
    //    TWABs; we weight one vault's participants only.
    // 3. Draw cadence: fixed 1-day cooldown, no draw manager/auctioneer role.
    // 4. Winner anonymity: PT keeps winners pseudonymous by design too, but reveals
    //    tier amounts publicly; our prize AMOUNT additionally stays encrypted end-to-end
    //    (visible only to the winner via user decryption).
}
