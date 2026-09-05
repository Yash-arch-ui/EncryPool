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
import {euint64, externalEuint64} from "encrypted-types/EncryptedTypes.sol";

contract TestUSDT is ERC20 {
    constructor() ERC20("Test USDT", "USDT") {
        _mint(msg.sender, 1_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

/// @dev Local stand-in for Zama's officially deployed cUSDT: same base contract
/// (OZ ERC7984ERC20Wrapper over a 6-decimal ERC20) that production wrappers derive from.
contract TestCUSDT is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(IERC20 underlying_)
        ZamaEthereumConfig()
        ERC7984("cUSDT", "cUSDT", "")
        ERC7984ERC20Wrapper(underlying_)
    {}
}

contract ConfidentialPrizeVaultTest is FhevmTest {
    TestUSDT internal usdt;
    TestCUSDT internal cusdt;
    ConfidentialPrizeVault internal vault;
    ConfidentialPrizePool internal pool;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B00;
    address internal alice;
    address internal bob;

    uint64 internal constant DEPOSIT = 1000e6;

    function setUp() public override {
        super.setUp();

        usdt = new TestUSDT();
        cusdt = new TestCUSDT(IERC20(address(usdt)));
        vault = new ConfidentialPrizeVault(cusdt);
        pool = new ConfidentialPrizePool(cusdt, vault, vault.balanceTracker(), vm.addr(0x5E4E8C));
        vault.setPrizePool(address(pool));

        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);

        dealConfidential(cusdt, alice, 10_000e6);
        dealConfidential(cusdt, bob, 10_000e6);

        vm.startPrank(alice);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(bob);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
    }

    function _deposit(address user, uint256 pk, uint64 amount) internal {
        // Proof binds the VAULT: the vault executes fromExternal itself on deposit.
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amount, user, address(vault));
        vm.prank(user);
        vault.deposit(enc, proof);
    }

    function _withdraw(address user, uint256 pk, uint64 amount) internal {
        // Proof binds the VAULT: this contract executes fromExternal itself on withdraw.
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amount, user, address(vault));
        vm.prank(user);
        vault.withdraw(enc, proof);
    }

    function _userDecryptUint64(euint64 handle, address user, uint256 pk, address contractAddress)
        internal
        returns (uint64)
    {
        bytes memory sig = signUserDecrypt(pk, contractAddress);
        return uint64(userDecrypt(euint64.unwrap(handle), user, contractAddress, sig));
    }

    function _tracker() internal view returns (EncryptedBalanceTracker) {
        return vault.balanceTracker();
    }

    function test_deposit_creditsEncryptedPositionAndVaultHoldsAssets() public {
        uint64 t0 = uint64(vm.getBlockTimestamp());
        _deposit(alice, ALICE_PK, DEPOSIT);

        assertEq(_userDecryptUint64(vault.positionOf(alice), alice, ALICE_PK, address(vault)), DEPOSIT);
        assertEq(uint128(decrypt(vault.totalShares())), DEPOSIT);
        assertEq(uint128(decrypt(vault.totalAssets())), DEPOSIT);
        assertEq(uint128(decrypt(cusdt.confidentialBalanceOf(alice))), 10_000e6 - DEPOSIT);

        (euint64 cpBalance,) = _tracker().checkpointOf(alice);
        assertEq(_userDecryptUint64(cpBalance, alice, ALICE_PK, address(_tracker())), DEPOSIT);
        (, euint64 cpTimestamp) = _tracker().checkpointOf(alice);
        assertEq(_userDecryptUint64(cpTimestamp, alice, ALICE_PK, address(_tracker())), t0);
    }

    function test_withdraw_returnsPrincipalWithoutLoss() public {
        _deposit(alice, ALICE_PK, DEPOSIT);
        vm.warp(1 days);
        _withdraw(alice, ALICE_PK, 400e6);

        assertEq(_userDecryptUint64(vault.positionOf(alice), alice, ALICE_PK, address(vault)), DEPOSIT - 400e6);
        assertEq(uint128(decrypt(vault.totalShares())), DEPOSIT - 400e6);
        assertEq(uint128(decrypt(vault.totalAssets())), DEPOSIT - 400e6);
        // No-loss property: wallet = 10_000 - 1_000 deposited + 400 withdrawn.
        assertEq(uint128(decrypt(cusdt.confidentialBalanceOf(alice))), 9400e6);

        (euint64 cpBalance,) = _tracker().checkpointOf(alice);
        assertEq(_userDecryptUint64(cpBalance, alice, ALICE_PK, address(_tracker())), DEPOSIT - 400e6);
    }

    function test_withdraw_clampsToFullPositionWhenRequestExceedsBalance() public {
        _deposit(alice, ALICE_PK, 500e6);
        _withdraw(alice, ALICE_PK, 999e6);

        assertEq(_userDecryptUint64(vault.positionOf(alice), alice, ALICE_PK, address(vault)), 0);
        assertEq(uint128(decrypt(vault.totalShares())), 0);
        assertEq(uint128(decrypt(vault.totalAssets())), 0);
        assertEq(uint128(decrypt(cusdt.confidentialBalanceOf(alice))), 10_000e6);
    }

    function test_withdraw_forUnknownAccountIsNoop() public {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(123e6, bob, address(vault));
        vm.prank(bob);
        vault.withdraw(enc, proof);

        assertEq(uint128(decrypt(vault.totalShares())), 0);
        assertEq(uint128(decrypt(cusdt.confidentialBalanceOf(bob))), 10_000e6);
    }

    function test_weight_growsWithTimeHeld() public {
        _deposit(alice, ALICE_PK, DEPOSIT);
        uint64 elapsed = 1 hours;
        vm.warp(block.timestamp + elapsed);

        // The tracker only allows the pool to pull weights.
        EncryptedBalanceTracker t = vault.balanceTracker();
        vm.prank(address(pool));
        euint64 weight = t.computeWeight(alice);
        assertEq(uint256(decrypt(weight)), uint256(DEPOSIT) * elapsed);
    }

    function test_weight_capsAtMaxWindow() public {
        _deposit(alice, ALICE_PK, DEPOSIT);
        vm.warp(block.timestamp + 40 days);

        EncryptedBalanceTracker t = vault.balanceTracker();
        vm.prank(address(pool));
        euint64 weight = t.computeWeight(alice);
        assertEq(uint256(decrypt(weight)), uint256(DEPOSIT) * t.MAX_WEIGHT_WINDOW());
    }

    function test_earlierDepositorEarnsHigherWeightForSameAmount() public {
        _deposit(alice, ALICE_PK, DEPOSIT);
        vm.warp(block.timestamp + 100);
        _deposit(bob, BOB_PK, DEPOSIT);
        vm.warp(block.timestamp + 100);

        EncryptedBalanceTracker t = vault.balanceTracker();
        vm.startPrank(address(pool));
        uint256 weightAlice = uint256(decrypt(t.computeWeight(alice)));
        uint256 weightBob = uint256(decrypt(t.computeWeight(bob)));
        vm.stopPrank();
        assertEq(weightAlice, uint256(DEPOSIT) * 200);
        assertEq(weightBob, uint256(DEPOSIT) * 100);
        assertGt(weightAlice, weightBob);
    }

    function test_twoUsers_positionsAreIndependent() public {
        _deposit(alice, ALICE_PK, DEPOSIT);
        _deposit(bob, BOB_PK, 250e6);

        assertEq(_userDecryptUint64(vault.positionOf(alice), alice, ALICE_PK, address(vault)), DEPOSIT);
        assertEq(_userDecryptUint64(vault.positionOf(bob), bob, BOB_PK, address(vault)), 250e6);
        assertEq(uint128(decrypt(vault.totalShares())), DEPOSIT + 250e6);
    }
}
