// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {EncryptedBalanceTracker} from "./EncryptedBalanceTracker.sol";

/// @title ConfidentialPrizeVault
/// @notice No-loss prize savings vault holding Zama's confidential cUSDT (ERC-7984).
/// Deposit and withdrawal amounts are encrypted end-to-end: the contract never stores,
/// emits, or transacts on a plaintext user amount. Positions are tracked as encrypted
/// 1:1 shares (one share per deposited base unit — see "Simplifications" below), and
/// every position change refreshes an encrypted checkpoint in the balance tracker that
/// prize draws use for eligibility weighting.
/// @dev FHEVM ACL rules drive several choices here:
///  1. An `externalEuint64` and its `FHE.fromExternal` result share one handle, and every
///     homomorphic op requires the CALLING contract to hold rights on each operand. So
///     deposits pull funds via the token's external-proof overload of
///     `confidentialTransferFrom` (the token derives the handle itself), while withdrawals
///     grant the token transient access to this contract's handle before payout.
///  2. Handles handed to the balance tracker are re-owned inside the tracker via a no-op
///     select, after this contract grants it transient access.
///  3. Encrypted conditions cannot synchronously revert in FHEVM, so over-withdrawals are
///     clamped to the caller's position with `FHE.min` (mirroring ERC-7984 itself) and
///     share accounting uses FHESafeMath try-patterns with `FHE.select`.
/// @dev Minimal surface the vault needs from its prize pool; defined locally to avoid an
/// import cycle (the pool's constructor references this vault's address).
interface IParticipantRegistry {
    function registerParticipant(address account) external;
    function participantCount() external view returns (uint256);
    function MAX_PARTICIPANTS() external view returns (uint256);
}

contract ConfidentialPrizeVault is ZamaEthereumConfig {
    /// @notice The confidential token accepted by this vault (cUSDT on Sepolia).
    IERC7984 public immutable asset;

    /// @notice Encrypted balance-over-time tracker fed on every deposit/withdraw.
    EncryptedBalanceTracker public immutable balanceTracker;

    /// @notice Prize pool that receives participant registrations; settable once, after
    /// deployment (pool and vault reference each other, so neither can be immutable).
    IParticipantRegistry public prizePool;

    euint64 private _totalShares;
    mapping(address account => euint64) private _shares;

    /// @dev Amounts are intentionally omitted: only handles (opaque ciphertext ids) are
    /// ever emitted, so events leak nothing about deposit sizes.
    event Deposited(address indexed account, euint64 shares);
    event Withdrawn(address indexed account, euint64 shares);
    event PrizePoolSet(address indexed prizePool);

    error PrizePoolAlreadySet();
    error MaxPoolFull();

    constructor(IERC7984 asset_) ZamaEthereumConfig() {
        asset = asset_;
        balanceTracker = new EncryptedBalanceTracker(address(this));
    }

    /// @notice Links the pool that will track participants for prize draws. One-shot.
    function setPrizePool(address pool) external {
        if (address(prizePool) != address(0)) revert PrizePoolAlreadySet();
        prizePool = IParticipantRegistry(pool);
        emit PrizePoolSet(pool);
    }

    /// @notice Total shares minted minus burned, under encryption.
    function totalShares() external view returns (euint64) {
        return _totalShares;
    }

    /// @notice An account's encrypted position in the vault.
    function positionOf(address account) external view returns (euint64) {
        return _shares[account];
    }

    /// @notice Encrypted total assets held: the vault's own confidential token balance.
    function totalAssets() external view returns (euint64) {
        return asset.confidentialBalanceOf(address(this));
    }

    /// @notice Deposits an encrypted amount of the confidential asset and credits an equal
    /// encrypted number of shares. Requires `msg.sender` to have set this vault as a
    /// confidential-token operator (`asset.setOperator`) beforehand.
    /// @param encryptedAmount Handle of the amount to deposit, bound by proof to THIS
    ///        contract (this vault executes `fromExternal` itself, keeping the end-user
    ///        binding intact, then lends the token transient access during the pull).
    /// @param inputProof Zama input verification proof for the encrypted amount.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        // Pull min(requested, wallet balance). The token computes on OUR handle, so lend
        // it transient access first; the returned amount handle comes back transiently
        // allowed to this contract and is the only reliable record of what moved.
        FHE.allowTransient(requested, address(asset));
        euint64 pulled = asset.confidentialTransferFrom(msg.sender, address(this), requested);

        euint64 current = _shares[msg.sender];
        (ebool ok, euint64 updated) = FHESafeMath.tryIncrease(current, pulled);
        euint64 credited = FHE.select(ok, updated, current);

        (ok, updated) = FHESafeMath.tryIncrease(_totalShares, pulled);
        _totalShares = FHE.select(ok, updated, _totalShares);

        _shares[msg.sender] = credited;

        FHE.allowThis(credited);
        FHE.allowThis(_totalShares);
        FHE.allow(credited, msg.sender);

        // Hand the new position to the tracker; it re-owns the handle internally.
        FHE.allowTransient(credited, address(balanceTracker));
        balanceTracker.update(msg.sender, credited);

        // First deposit registers the caller for prize-draw eligibility.
        // Pre-check: reject if the pool is already at capacity (avoids a wasted revert
        // after the expensive deposit FHE ops complete). The pool also enforces this
        // defensively inside registerParticipant.
        if (address(prizePool) != address(0)) {
            if (prizePool.participantCount() >= prizePool.MAX_PARTICIPANTS()) revert MaxPoolFull();
            prizePool.registerParticipant(msg.sender);
        }

        emit Deposited(msg.sender, credited);
    }

    /// @notice Withdraws up to the requested encrypted amount of principal back to the
    /// caller, at any time and with no loss. If the request exceeds the position it is
    /// clamped to the full position instead of reverting (amounts are hidden, so callers
    /// observe the outcome by decrypting their own handles afterwards).
    /// @param encryptedAmount Handle of the amount to withdraw, bound by proof to THIS
    ///        contract (this vault executes `fromExternal` itself).
    /// @param inputProof Zama input verification proof for the encrypted amount.
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 current = _shares[msg.sender];
        if (!FHE.isInitialized(current)) return;

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 amount = FHE.min(requested, current);
        euint64 remaining = FHE.sub(current, amount);

        (ebool ok, euint64 updatedTotal) = FHESafeMath.tryDecrease(_totalShares, amount);
        _totalShares = FHE.select(ok, updatedTotal, _totalShares);

        _shares[msg.sender] = remaining;

        // Payout: the token must be allowed to compute on our handle, so lend it transient
        // access; the recipient's new confidential balance is allowed to them by the token.
        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(msg.sender, amount);

        FHE.allowThis(remaining);
        FHE.allowThis(_totalShares);
        FHE.allow(remaining, msg.sender);

        FHE.allowTransient(remaining, address(balanceTracker));
        balanceTracker.update(msg.sender, remaining);

        emit Withdrawn(msg.sender, amount);
    }

    // ── Simplifications vs PoolTogether V5 ────────────────────────────────────────
    // 1. Share ratio: real ERC-4626 vaults mint shares at a dynamic assets/shares rate as
    //    yield accrues. Under FHE that requires encrypted division per deposit (very
    //    expensive, precision loss); we mint 1:1 and let the PrizePool hold sponsored
    //    prize liquidity instead of yield share. Documented bounty scope cut.
    // 2. TWAB: continuous time-weighted average balances replaced by a single checkpoint
    //    + weight formula (see EncryptedBalanceTracker). Per-change checkpoint arrays,
    //    binary search and windowed summation would multiply HCU cost per user action.
    // 3. No plaintext revert paths: amounts are hidden, so insufficient-balance deposits/
    //    withdrawals clamp via select instead of reverting (outcome visible post-hoc only
    //    through decryption the caller alone can perform).
    // 4. Single tier, single asset, single vault chain (see ConfidentialPrizePool).
}
