// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FhevmTest} from "forge-fhevm/FhevmTest.sol";
import {ERC20} from "@openzeppelin-contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {
    ERC7984ERC20Wrapper
} from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ConfidentialPrizeVault} from "../src/ConfidentialPrizeVault.sol";
import {ConfidentialPrizePool} from "../src/ConfidentialPrizePool.sol";
import {EncryptedBalanceTracker} from "../src/EncryptedBalanceTracker.sol";
import {ebool, euint64, euint128, externalEuint64} from "encrypted-types/EncryptedTypes.sol";
import {EmptyUUPSProxy} from "@fhevm/host-contracts/contracts/emptyProxy/EmptyUUPSProxy.sol";
import {hcuLimitAdd} from "@fhevm/host-contracts/addresses/FHEVMHostAddresses.sol";
import {HCULimitNoCap} from "../dependencies/forge-fhevm-eba2324/src/HCULimitNoCap.sol";

contract PoolTestUSDT is ERC20 {
    constructor() ERC20("Pool Test USDT", "USDT") {
        _mint(msg.sender, 1_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract PoolTestCUSDT is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(IERC20 underlying_)
        ZamaEthereumConfig()
        ERC7984("cUSDT", "cUSDT", "")
        ERC7984ERC20Wrapper(underlying_)
    {}
}

/**
 * @dev Test helpers for the end-to-end encrypted architecture.
 *
 * Off-chain knowledge in tests mimics what the relayer KMS can produce:
 * individual draw-time weights are only ever obtained through test-decryption
 * of the contract's stored snapshot handles (as the KMS would see them), never
 * from contract getters.
 */
contract PoolTestBase is FhevmTest {
    PoolTestUSDT internal usdt;
    PoolTestCUSDT internal cusdt;
    ConfidentialPrizeVault internal vault;
    ConfidentialPrizePool internal pool;
    EncryptedBalanceTracker internal tracker;

    address internal alice;
    address internal bob;
    address internal carol;
    address internal sponsor;
    uint256 internal alicePk;
    uint256 internal bobPk;
    uint256 internal carolPk;
    uint256 internal sponsorPk;

    function _disableHCUCap() internal {
        address noCap = address(new HCULimitNoCap());
        vm.prank(PROXY_OWNER);
        EmptyUUPSProxy(payable(hcuLimitAdd)).upgradeToAndCall(noCap, "");
    }

    function setUp() public virtual override {
        super.setUp();
        disableHCUDepthLimit();
        _disableHCUCap();

        usdt = new PoolTestUSDT();
        cusdt = new PoolTestCUSDT(IERC20(address(usdt)));
        vault = new ConfidentialPrizeVault(cusdt);
        pool = new ConfidentialPrizePool(cusdt, vault, vault.balanceTracker());
        vault.setPrizePool(address(pool));
        tracker = vault.balanceTracker();

        alicePk = 0xA11CE;
        bobPk = 0xB0B00;
        carolPk = 0xCA701;
        sponsorPk = 0x504CE0;
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
        sponsor = vm.addr(sponsorPk);

        dealConfidential(cusdt, alice, 10_000e6);
        dealConfidential(cusdt, bob, 10_000e6);
        dealConfidential(cusdt, carol, 10_000e6);
        dealConfidential(cusdt, sponsor, 100_000e6);

        vm.startPrank(alice);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(bob);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(carol);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(sponsor);
        cusdt.setOperator(address(pool), type(uint48).max);
        vm.stopPrank();
    }

    // ── Action helpers ─────────────────────────────────────────────────────────

    function _deposit(address user, uint256 pk, uint64 amount) internal {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amount, user, address(vault));
        vm.prank(user);
        vault.deposit(enc, proof);
    }

    function _withdraw(address user, uint256 pk, uint64 amount) internal {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amount, user, address(vault));
        vm.prank(user);
        vault.withdraw(enc, proof);
    }

    function _fundPrize(uint64 amount) internal {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amount, sponsor, address(pool));
        vm.prank(sponsor);
        pool.fundPrize(enc, proof);
    }

    function _userDecryptUint64(euint64 handle, address user, uint256 pk, address contractAddress)
        internal
        returns (uint64)
    {
        bytes memory sig = signUserDecrypt(pk, contractAddress);
        return uint64(userDecrypt(euint64.unwrap(handle), user, contractAddress, sig));
    }

    function _userDecryptBool(ebool handle, address user, uint256 pk, address contractAddress) internal returns (bool) {
        bytes memory sig = signUserDecrypt(pk, contractAddress);
        return userDecrypt(ebool.unwrap(handle), user, contractAddress, sig) != 0;
    }

    function _balanceOf(address user, uint256 pk) internal returns (uint64) {
        return _userDecryptUint64(cusdt.confidentialBalanceOf(user), user, pk, address(cusdt));
    }

    // ── Draw/fulfill helpers (relayer-equivalent knowledge) ────────────────────

    /// @dev Aggregate total weight, decrypted for fulfillment.
    function _fulfill(uint256 drawId) internal {
        euint128 twHandle = pool.getDraw(drawId).totalWeight;
        uint128 tw = uint128(decrypt(twHandle));
        bytes memory proof = buildDecryptionProof(euint128.unwrap(twHandle), abi.encode(tw));
        pool.fulfillWinner(drawId, tw, proof);
    }

    /// @dev Full pipeline: fund, draw, fulfill. Returns drawId and a plaintext
    ///      copy of the draw-time weights captured via the tracker at the exact
    ///      draw moment (test-side snapshot; the contract snapshots internally).
    function _drawAndFulfill(uint64 prizeAmount) internal returns (uint256 drawId, uint256[] memory weights) {
        _fundPrize(prizeAmount);
        (drawId, weights) = _drawCapturingWeights();
        _fulfill(drawId);
    }

    /// @dev Draw and capture draw-time weights (tracker values at draw instant).
    ///      The tracker only allows the pool to pull weights, so the test reads
    ///      them while pranked as the pool (test-only introspection of the same
    ///      values the contract snapshots internally).
    function _drawCapturingWeights() internal returns (uint256 drawId, uint256[] memory weights) {
        address[] memory parts = _participants();
        uint256 n = parts.length;
        weights = new uint256[](n);
        vm.startPrank(address(pool));
        for (uint256 i = 0; i < n; i++) {
            weights[i] = uint256(decrypt(tracker.computeWeight(parts[i])));
        }
        vm.stopPrank();
        drawId = pool.draw();
    }

    // ── Winner computation (plaintext oracle for assertions) ───────────────────

    /// @dev Who SHOULD win per the mathematical protocol, from draw-time weights.
    function _expectedWinnerFromWeights(uint256[] memory weights, uint256 drawId, uint128 tw)
        internal
        returns (uint256 winnerIndex)
    {
        uint256 n = weights.length;
        assertGt(tw, 0, "total weight must be positive");
        uint256 seed = uint256(decrypt(pool.seedIndexOf(drawId)));
        uint256 slot = seed % tw;
        uint256 cum = 0;
        uint256 found = 0;
        for (uint256 i = 0; i < n; i++) {
            if (slot >= cum && slot < cum + weights[i]) {
                winnerIndex = i;
                found++;
            }
            cum += weights[i];
        }
        assertEq(found, 1, "exactly one winner must exist");
        assertEq(cum, tw, "draw-time weights must sum to total");
    }

    function _participants() internal view returns (address[] memory) {
        return pool.participants();
    }

    /// @dev Aggregate total weight decryption (relayer view).
    function _revealedTotal(uint256 drawId) internal returns (uint128) {
        return uint128(decrypt(pool.getDraw(drawId).totalWeight));
    }

    /// @dev Caller's win status via the contract's own checkResult + user decrypt.
    function _myWinStatus(uint256 drawId, address user, uint256 pk) internal returns (bool) {
        vm.prank(user);
        ebool status = pool.checkResult(drawId);
        return _userDecryptBool(status, user, pk, address(pool));
    }

    function _claim(uint256 drawId, address user) internal {
        vm.prank(user);
        pool.claim(drawId);
    }
}
