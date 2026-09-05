// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title EncryptedBalanceTracker
/// @notice Checkpointed encrypted balance-over-time tracker. Lightweight stand-in for
/// PoolTogether V5's TWAB Controller: instead of a continuous piecewise time-weighted
/// average (one checkpoint per balance change, binary-searched and summed over the draw
/// window), it keeps a single (encrypted balance, encrypted timestamp) checkpoint per
/// account, refreshed by the vault on every deposit/withdraw. At draw time it yields an
/// eligibility weight of balance x min(elapsed, window), evaluated fully under encryption.
contract EncryptedBalanceTracker is ZamaEthereumConfig {
    struct Checkpoint {
        euint64 balance;
        euint64 timestamp;
    }

    /// @dev Upper bound on the weight's time factor so stale checkpoints cannot dominate
    ///      draws forever and weight products stay far from euint128 truncation.
    uint64 public constant MAX_WEIGHT_WINDOW = 30 days;

    /// @dev The only address allowed to move balances (the vault owning this tracker).
    address public immutable vault;

    /// @dev The only address allowed to read weights (the prize pool). This is a
    ///      confidentiality requirement, not an access-control nicety: if anyone
    ///      could call computeWeight for an arbitrary account, they could
    ///      makePubliclyDecryptable the returned handle (they receive transient
    ///      ACL) and public-decrypt the account's exact weight, from which the
    ///      account's balance is directly computable.
    address public weightReader;

    mapping(address account => Checkpoint) private _checkpoints;

    error UnauthorizedCaller(address caller);

    constructor(address vault_) ZamaEthereumConfig() {
        vault = vault_;
        weightReader = address(0);
    }

    /// @dev Wire-up for the vault: records which pool may read weights. Only
    ///      callable once, by the vault, so the ACL cannot be reassigned.
    function setWeightReader(address pool) external {
        if (msg.sender != vault) revert UnauthorizedCaller(msg.sender);
        if (weightReader != address(0)) revert UnauthorizedCaller(msg.sender);
        weightReader = pool;
    }

    /// @notice Records a new encrypted checkpoint for `account`.
    /// @dev The vault must grant this contract transient access to `newBalance`
    /// (`FHE.allowTransient`) before calling. The stored handle is re-derived here via a
    /// no-op select so its persistent ACL owner is this tracker, not the vault.
    function update(address account, euint64 newBalance) external {
        if (msg.sender != vault) revert UnauthorizedCaller(msg.sender);

        Checkpoint storage checkpoint = _checkpoints[account];
        checkpoint.balance = FHE.select(FHE.asEbool(true), newBalance, FHE.asEuint64(0));
        // Transaction timestamps are public on any chain, so encryption adds no on-chain
        // secrecy; keeping them as ciphertexts lets duration math run purely under FHE and
        // keeps plaintext columns out of storage for off-chain analysts.
        checkpoint.timestamp = FHE.asEuint64(uint64(block.timestamp));

        FHE.allowThis(checkpoint.balance);
        FHE.allowThis(checkpoint.timestamp);
        FHE.allow(checkpoint.balance, account);
        FHE.allow(checkpoint.timestamp, account);
    }

    /// @notice Encrypted checkpoint accessors. Uninitialized accounts return zero handles.
    function checkpointOf(address account) external view returns (euint64 balance, euint64 timestamp) {
        Checkpoint storage checkpoint = _checkpoints[account];
        return (checkpoint.balance, checkpoint.timestamp);
    }

    /// @notice Computes the account's current eligibility weight:
    ///         checkpointed balance x min(seconds since checkpoint, MAX_WEIGHT_WINDOW),
    ///         entirely under encryption into a fresh euint64 handle owned by this
    ///         tracker; the caller receives transient access so it can consume the handle
    ///         in the same transaction without ever seeing the plaintext.
    /// @dev Weights are euint64: sane testnet balances (<= ~10^6 base units) times the
    ///      30-day cap (2_592_000 s) fit in euint64 (max ~1.8×10^19). This keeps the
    ///      per-participant HCU cost at 596k (FheMul euint64) vs 1.69M (FheMul euint128),
    ///      which is critical for staying under the 20M HCU/tx limit on real Sepolia.
    function computeWeight(address account) external returns (euint64 weight) {
        // Only the pool may pull weights. A permissionless computeWeight would
        // leak balances: any caller receives transient ACL on the fresh handle
        // and could makePubliclyDecryptable + public-decrypt it.
        if (msg.sender != weightReader) revert UnauthorizedCaller(msg.sender);

        Checkpoint storage checkpoint = _checkpoints[account];
        if (!FHE.isInitialized(checkpoint.balance)) {
            return FHE.asEuint64(0);
        }

        euint64 elapsed = FHE.sub(FHE.asEuint64(uint64(block.timestamp)), checkpoint.timestamp);
        euint64 capped = FHE.min(elapsed, FHE.asEuint64(MAX_WEIGHT_WINDOW));
        weight = FHE.mul(capped, checkpoint.balance);

        FHE.allowThis(weight);
        FHE.allow(weight, account);
        FHE.allowTransient(weight, msg.sender);
    }
}
