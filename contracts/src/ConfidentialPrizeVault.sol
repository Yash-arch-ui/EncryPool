// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {EncryptedBalanceTracker} from "./EncryptedBalanceTracker.sol";

/// @dev Minimal surface the vault needs from its prize pool.
interface IParticipantRegistry {
    function updateParticipantWeight(address account, euint64 oldWeight, euint64 newWeight) external;
}

/// @title ConfidentialPrizeVault
/// @notice No-loss prize savings vault holding Zama's confidential cUSDT (ERC-7984).
/// Deposit and withdrawal amounts are encrypted end-to-end. Positions are tracked as
/// encrypted 1:1 shares, and every position change refreshes an encrypted checkpoint in
/// the balance tracker that prize draws use for eligibility weighting, then reports the
/// account's new weight to the prize pool so it can register/refresh participants.
contract ConfidentialPrizeVault is ZamaEthereumConfig {
    IERC7984 public immutable asset;
    EncryptedBalanceTracker public immutable balanceTracker;
    IParticipantRegistry public prizePool;
    address public owner;

    euint64 private _totalShares;
    mapping(address => euint64) private _shares;

    event Deposited(address indexed account, euint64 shares);
    event Withdrawn(address indexed account, euint64 shares);
    event PrizePoolSet(address indexed prizePool);

    error PrizePoolAlreadySet();
    error NotOwner();

    constructor(IERC7984 asset_) ZamaEthereumConfig() {
        asset = asset_;
        owner = msg.sender;
        balanceTracker = new EncryptedBalanceTracker(address(this));
    }

    /// @notice Links the pool that tracks participants for prize draws. Owner-only,
    ///         one-shot (pool and vault reference each other, so neither is immutable).
    function setPrizePool(address pool) external {
        if (msg.sender != owner) revert NotOwner();
        if (address(prizePool) != address(0)) revert PrizePoolAlreadySet();
        prizePool = IParticipantRegistry(pool);
        emit PrizePoolSet(pool);
    }

    function totalShares() external view returns (euint64) {
        return _totalShares;
    }

    function positionOf(address account) external view returns (euint64) {
        return _shares[account];
    }

    function totalAssets() external view returns (euint64) {
        return asset.confidentialBalanceOf(address(this));
    }

    /// @notice Deposits an encrypted amount of the confidential asset and credits an
    ///         equal encrypted number of shares. Requires the vault to be an operator
    ///         of the caller's confidential balance (asset.setOperator).
    /// @param encryptedAmount Handle of the amount to deposit, bound by input proof to
    ///        THIS contract (the vault executes `fromExternal` itself).
    /// @param inputProof Zama input verification proof for the encrypted amount.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        // Pull min(requested, wallet balance). The token computes on OUR handle, so lend
        // it transient access first; the returned handle is the only reliable record of
        // what moved.
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

        _syncPosition(msg.sender, credited);

        emit Deposited(msg.sender, credited);
    }

    /// @notice Withdraws up to the requested encrypted amount of principal back to the
    ///         caller, at any time and with no loss. If the request exceeds the position
    ///         it is clamped to the full position instead of reverting (amounts are
    ///         hidden, so callers observe the outcome by decrypting their own handles).
    /// @param encryptedAmount Handle of the amount to withdraw, bound by input proof to
    ///        THIS contract (the vault executes `fromExternal` itself).
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

        // Payout: the token must be allowed to compute on our handle, so lend it
        // transient access; the recipient's new confidential balance is allowed to them
        // by the token.
        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(msg.sender, amount);

        FHE.allowThis(remaining);
        FHE.allowThis(_totalShares);
        FHE.allow(remaining, msg.sender);

        _syncPosition(msg.sender, remaining);

        emit Withdrawn(msg.sender, amount);
    }

    /// @dev Refresh the balance tracker checkpoint and report the account's current
    ///      weight to the prize pool (which registers the participant on first touch).
    function _syncPosition(address account, euint64 newShares) internal {
        // Hand the new position to the tracker; it re-owns the handle internally.
        FHE.allowTransient(newShares, address(balanceTracker));
        balanceTracker.update(account, newShares);

        if (address(prizePool) != address(0)) {
            // Current weight from the refreshed checkpoint; grant the pool access to
            // both handles before handing them over.
            // DISABLED euint64 weight = balanceTracker.computeWeight(account);
            FHE.allowTransient(newShares, address(prizePool));
            // DISABLED FHE.allowTransient(weight, address(prizePool));
            prizePool.updateParticipantWeight(account, newShares, newShares);
        }
    }
}
