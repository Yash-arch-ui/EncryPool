// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {FHESafeMath} from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {EncryptedBalanceTracker} from "./EncryptedBalanceTracker.sol";

/// @dev Minimal surface the vault needs from its prize pool.
interface IParticipantRegistry {
    function registerParticipant(address account) external;
    function participantCount() external view returns (uint256);
}

/// @title ConfidentialPrizeVault
/// @notice No-loss prize savings vault holding Zama's confidential cUSDT (ERC-7984).
/// Deposit and withdrawal amounts are encrypted end-to-end. Positions are tracked as
/// encrypted 1:1 shares, and every position change refreshes an encrypted checkpoint
/// in the balance tracker that prize draws use for eligibility weighting.
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

    function setPrizePool(address pool) external {
        if (msg.sender != owner) revert NotOwner();
        if (address(prizePool) != address(0)) revert PrizePoolAlreadySet();
        prizePool = IParticipantRegistry(pool);
        // Grant the pool the exclusive right to read weights from the tracker.
        balanceTracker.setWeightReader(pool);
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

    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

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

        FHE.allowTransient(credited, address(balanceTracker));
        balanceTracker.update(msg.sender, credited);

        if (address(prizePool) != address(0)) {
            prizePool.registerParticipant(msg.sender);
        }

        emit Deposited(msg.sender, credited);
    }

    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 current = _shares[msg.sender];
        if (!FHE.isInitialized(current)) return;

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 amount = FHE.min(requested, current);
        euint64 remaining = FHE.sub(current, amount);

        (ebool ok, euint64 updatedTotal) = FHESafeMath.tryDecrease(_totalShares, amount);
        _totalShares = FHE.select(ok, updatedTotal, _totalShares);

        _shares[msg.sender] = remaining;

        FHE.allowTransient(amount, address(asset));
        asset.confidentialTransfer(msg.sender, amount);

        FHE.allowThis(remaining);
        FHE.allowThis(_totalShares);
        FHE.allow(remaining, msg.sender);

        FHE.allowTransient(remaining, address(balanceTracker));
        balanceTracker.update(msg.sender, remaining);

        if (address(prizePool) != address(0)) {
            prizePool.registerParticipant(msg.sender);
        }

        emit Withdrawn(msg.sender, amount);
    }
}
