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
import {euint64, euint8, externalEuint64} from "encrypted-types/EncryptedTypes.sol";

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

/// @notice Full-cycle tests: multiple users deposit into the vault, a sponsor funds the
/// prize pot, a draw runs on encrypted randomness + encrypted weights, the winner index
/// is revealed via the KMS public-decryption proof flow, and only the winner claims —
/// with explicit assertions that non-winners' data stays unreadable to everyone else.
contract ConfidentialPrizePoolTest is FhevmTest {
    PoolTestUSDT internal usdt;
    PoolTestCUSDT internal cusdt;
    ConfidentialPrizeVault internal vault;
    ConfidentialPrizePool internal pool;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B00;
    uint256 internal constant CAROL_PK = 0xCA701; // prize sponsor
    address internal alice;
    address internal bob;
    address internal carol;

    function setUp() public override {
        super.setUp();
        disableHCUDepthLimit(); // draw loops chain many ops; per-tx HCU accounting stays on

        usdt = new PoolTestUSDT();
        cusdt = new PoolTestCUSDT(IERC20(address(usdt)));
        vault = new ConfidentialPrizeVault(cusdt);
        pool = new ConfidentialPrizePool(cusdt, vault, vault.balanceTracker());
        vault.setPrizePool(address(pool));

        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        carol = vm.addr(CAROL_PK);

        dealConfidential(cusdt, alice, 10_000e6);
        dealConfidential(cusdt, bob, 10_000e6);
        dealConfidential(cusdt, carol, 10_000e6);

        // Deposits pull via operator approval on the confidential token.
        vm.startPrank(alice);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(bob);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        // Prize funding pulls via operator approval for the pool.
        vm.startPrank(carol);
        cusdt.setOperator(address(pool), type(uint48).max);
        vm.stopPrank();
    }

    function _deposit(address user, uint256 pk, uint64 amount) internal {
        (externalEuint64 enc, bytes memory proof) = encryptUint64(amount, user, address(vault));
        vm.prank(user);
        vault.deposit(enc, proof);
    }

    function _fundPrize(address sponsor, uint256 pk, uint64 amount) internal {
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

    function test_participantsRegisterOnFirstDepositOnly() public {
        assertEq(pool.participantCount(), 0);

        _deposit(alice, ALICE_PK, 1000e6);
        assertEq(pool.participantCount(), 1);

        _deposit(alice, ALICE_PK, 500e6); // second deposit must not duplicate
        assertEq(pool.participantCount(), 1);

        _deposit(bob, BOB_PK, 500e6);
        assertEq(pool.participantCount(), 2);
    }

    function test_fullCycle_drawFulfillClaimAndPrivacy() public {
        _deposit(alice, ALICE_PK, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, BOB_PK, 500e6);
        _fundPrize(carol, CAROL_PK, 777e6);

        assertEq(uint128(decrypt(pool.prizeLiquidity())), 777e6);

        vm.warp(block.timestamp + 3600); // past cooldown, both weights > 0
        uint256 drawId = pool.draw();
        assertEq(drawId, 1);

        // Winner index is publicly decryptable by design (KMS-gated): read it here via
        // the test backdoor, then submit a KMS-signed proof like a real frontend would.
        euint8 seedIndex = pool.seedIndexOf(drawId);
        uint8 clearIndex = uint8(decrypt(seedIndex));
        assertTrue(clearIndex < 2);

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(seedIndex);
        bytes memory proof = buildDecryptionProof(handles, abi.encode(clearIndex));
        pool.fulfillWinner(drawId, clearIndex, proof);

        address[] memory parts = pool.participants();
        address winner = parts[clearIndex];
        address loser = winner == alice ? bob : alice;
        uint256 loserPk = winner == alice ? BOB_PK : ALICE_PK;
        uint256 winnerPk = winner == alice ? ALICE_PK : BOB_PK;

        // Only the winner may claim.
        vm.prank(loser);
        vm.expectRevert(ConfidentialPrizePool.NotWinner.selector);
        pool.claim(drawId);

        uint64 winnerBalanceBefore =
            _userDecryptUint64(cusdt.confidentialBalanceOf(winner), winner, winnerPk, address(cusdt));

        vm.prank(winner);
        pool.claim(drawId);

        // Winner's wallet grew by exactly the pot; the pot emptied; double-claim reverts.
        assertEq(
            _userDecryptUint64(cusdt.confidentialBalanceOf(winner), winner, winnerPk, address(cusdt)),
            winnerBalanceBefore + 777e6
        );
        assertEq(uint128(decrypt(pool.prizeLiquidity())), 0);
        assertEq(uint128(decrypt(vault.totalAssets())), 1500e6); // principal untouched

        vm.prank(winner);
        vm.expectRevert(ConfidentialPrizePool.DrawAlreadyClaimed.selector);
        pool.claim(drawId);

        // Privacy: the loser cannot decrypt the winner's position. Checked via try/catch
        // on a public re-entry wrapper: userDecrypt's own ACL pre-checks make benign
        // external calls before reverting, which would otherwise consume vm.expectRevert.
        ConfidentialPrizePool.Draw memory d = pool.getDraw(drawId);
        euint64 winnerPosition = vault.positionOf(d.winner);
        euint64 liquidity = pool.prizeLiquidity();
        bytes memory loserSig = signUserDecrypt(loserPk, address(vault));
        try this.probeDecrypt(euint64.unwrap(winnerPosition), loser, address(vault), loserSig) {
            revert("loser must not be able to decrypt the winner's position");
        } catch (bytes memory reason) {
            require(
                bytes4(reason) == FhevmTest.UserNotAuthorizedForDecrypt.selector,
                "unexpected error decrypting winner position"
            );
        }

        // ...and nobody but the pool can read its own liquidity handle.
        bytes memory loserSigPool = signUserDecrypt(loserPk, address(pool));
        try this.probeDecrypt(euint64.unwrap(liquidity), loser, address(pool), loserSigPool) {
            revert("loser must not be able to decrypt the prize liquidity");
        } catch (bytes memory reason) {
            require(
                bytes4(reason) == FhevmTest.UserNotAuthorizedForDecrypt.selector,
                "unexpected error decrypting liquidity"
            );
        }
    }

    /// @notice Public re-entry point so tests can expect reverts from the internal
    /// FhevmTest.userDecrypt without its benign ACL staticcalls eating vm.expectRevert.
    function probeDecrypt(bytes32 handle, address user, address contractAddress, bytes memory signature)
        external
        returns (uint256)
    {
        return userDecrypt(handle, user, contractAddress, signature);
    }

    function test_draw_revertsInsideCooldown() public {
        _deposit(alice, ALICE_PK, 1000e6);
        pool.draw();

        vm.warp(block.timestamp + 30 seconds);
        vm.prank(bob);
        vm.expectRevert(ConfidentialPrizePool.DrawTooSoon.selector);
        pool.draw();

        vm.warp(block.timestamp + 2 days); // cooldown elapsed
        pool.draw(); // now fine
    }

    function test_fulfill_rejectsWrongClearIndex() public {
        _deposit(alice, ALICE_PK, 1000e6);
        vm.warp(block.timestamp + 2 days);
        uint256 drawId = pool.draw();

        euint8 seedIndex = pool.seedIndexOf(drawId);
        uint8 clearIndex = uint8(decrypt(seedIndex));
        uint8 wrongIndex = clearIndex == 0 ? 1 : 0;

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(seedIndex);
        bytes memory badProof = buildDecryptionProof(handles, abi.encode(wrongIndex));

        vm.expectRevert(); // KMS signature check must fail for mismatched cleartext
        pool.fulfillWinner(drawId, wrongIndex, badProof);

        bytes memory goodProof = buildDecryptionProof(handles, abi.encode(clearIndex));
        pool.fulfillWinner(drawId, clearIndex, goodProof);
    }

    function test_weightsDriveDrawProbabilityDeterministicallyAtBounds() public {
        // Sanity: with everyone's weight zero except one participant, that participant
        // always wins regardless of randomness (interval partition covers [0,T) fully).
        _deposit(alice, ALICE_PK, 1000e6);
        vm.warp(block.timestamp + 200);
        _deposit(bob, BOB_PK, 500e6);
        // Empty bob's position entirely: withdraw clamps to full balance.
        (externalEuint64 enc, bytes memory proof) = encryptUint64(type(uint64).max, bob, address(vault));
        vm.prank(bob);
        vault.withdraw(enc, proof);
        // Bob's checkpoint balance is 0 -> zero weight; Alice is the only eligible user.

        vm.warp(block.timestamp + 1 days);
        uint256 drawId = pool.draw();

        euint8 seedIndex = pool.seedIndexOf(drawId);
        uint8 clearIndex = uint8(decrypt(seedIndex));
        assertEq(clearIndex, 0); // alice

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(seedIndex);
        pool.fulfillWinner(drawId, clearIndex, buildDecryptionProof(handles, abi.encode(clearIndex)));
        assertEq(pool.getDraw(drawId).winner, alice);
    }
}
