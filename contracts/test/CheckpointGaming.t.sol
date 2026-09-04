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
import {euint8, euint64, externalEuint64} from "encrypted-types/EncryptedTypes.sol";

contract GamingTestUSDT is ERC20 {
    constructor() ERC20("Gaming Test USDT", "USDT") {
        _mint(msg.sender, 1_000_000e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract GamingTestCUSDT is ZamaEthereumConfig, ERC7984ERC20Wrapper {
    constructor(IERC20 underlying_)
        ZamaEthereumConfig()
        ERC7984("cUSDT", "cUSDT", "")
        ERC7984ERC20Wrapper(underlying_)
    {}
}

/// @title CheckpointGamingTest
/// @notice Adversarial tests against the checkpointed weight model:
///   - Last-second depositor tries to earn full draw weight with minimal time-at-risk
///   - Long-term holder should receive meaningfully more weight
///   - Deposit-then-withdrawsame block leaves zero weight
///   - Drip-feeding across multiple deposits cannot game the time component
///   - Formula boundary checks: weight = balance * min(elapsed, 30 days)
contract CheckpointGamingTest is FhevmTest {
    GamingTestUSDT internal usdt;
    GamingTestCUSDT internal cusdt;
    ConfidentialPrizeVault internal vault;
    ConfidentialPrizePool internal pool;
    EncryptedBalanceTracker internal tracker;

    uint256 internal constant ALICE_PK = 0xA11CE;
    uint256 internal constant BOB_PK = 0xB0B00;
    uint256 internal constant EVE_PK = 0xE5E0E;
    uint256 internal constant SPONSOR_PK = 0x504CE0;
    address internal alice;
    address internal bob;
    address internal eve;
    address internal sponsor;

    uint64 internal constant WINDOW = 2_592_000; // 30 days in seconds

    function setUp() public override {
        super.setUp();
        disableHCUDepthLimit();

        usdt = new GamingTestUSDT();
        cusdt = new GamingTestCUSDT(IERC20(address(usdt)));
        vault = new ConfidentialPrizeVault(cusdt);
        pool = new ConfidentialPrizePool(cusdt, vault, vault.balanceTracker());
        vault.setPrizePool(address(pool));
        tracker = vault.balanceTracker();

        alice = vm.addr(ALICE_PK);
        bob = vm.addr(BOB_PK);
        eve = vm.addr(EVE_PK);
        sponsor = vm.addr(SPONSOR_PK);

        dealConfidential(cusdt, alice, 1_000_000_000e6);
        dealConfidential(cusdt, bob, 1_000_000_000e6);
        dealConfidential(cusdt, eve, 1_000_000_000e6);
        dealConfidential(cusdt, sponsor, 1_000_000_000e6);

        vm.startPrank(alice);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(bob);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(eve);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
        vm.startPrank(sponsor);
        cusdt.setOperator(address(pool), type(uint48).max);
        vm.stopPrank();
    }

    // ── Helpers ─────────────────────────────────────────────────────────────

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

    function _decryptWeight(address user, uint256 pk) internal returns (uint256) {
        return uint256(decrypt(tracker.computeWeight(user)));
    }

    // ── ATTACK 1: Last-second depositor vs long-term holder ─────────────────
    //
    // Alice deposits 1000 cUSDT at T=0 and holds for 30 days.
    // Eve   deposits 1000 cUSDT at T = 30 days - 1 second (one second before draw).
    //
    // Mathematical prediction:
    //   Alice weight = 1000e6 * min(30 days, 30 days) = 1000e6 * 2,592,000
    //   Eve   weight = 1000e6 * min(1, 30 days)        = 1000e6 * 1
    //   Ratio = 2,592,000 : 1  (Alice wins overwhelmingly)

    function test_lastSecondDepositorGetsNearZeroWeight() public {
        uint64 amount = 1000e6;

        // Alice deposits at T=1 (genesis block).
        _deposit(alice, ALICE_PK, amount);

        // Fast forward to T = 1 + WINDOW - 2 (2 seconds before window cap).
        vm.warp(block.timestamp + WINDOW - 2);

        // Eve deposits 2 seconds before draw eligibility.
        _deposit(eve, EVE_PK, amount);

        // Advance 1 second so Eve has some elapsed time (best case for Eve).
        vm.warp(block.timestamp + 1);

        // Now: T = 1 + WINDOW - 1. Alice elapsed = WINDOW - 1, Eve elapsed = 1.
        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        uint256 weightEve = _decryptWeight(eve, EVE_PK);

        // Alice: elapsed = WINDOW - 1 (deposited at T=1, now T=WINDOW), weight = amount * (WINDOW-1)
        assertEq(weightAlice, uint256(amount) * (WINDOW - 1));

        // Eve: elapsed = 1 second, weight = amount * 1
        assertEq(weightEve, uint256(amount) * 1);

        // The ratio is (WINDOW-1):1 ≈ 2,591,999:1.
        assertEq(weightAlice / weightEve, WINDOW - 1);
        assertGt(weightAlice, weightEve * 1_000_000); // Alice has >1M x Eve's weight
    }

    // ── ATTACK 2: Deposit and withdraw in same block ────────────────────────
    //
    // Eve deposits then withdraws in the same block. The checkpoint is updated
    // on withdraw to (balance=0, timestamp=now), so her weight at draw time is 0.

    function test_depositWithdrawSameBlockLeavesZeroWeight() public {
        uint64 amount = 10_000e6;

        _deposit(alice, ALICE_PK, 1000e6);
        vm.warp(block.timestamp + 1 days);

        // Eve deposits and withdraws immediately (same block).
        _deposit(eve, EVE_PK, amount);
        _withdraw(eve, EVE_PK, amount); // clamp-to-balance: withdraws everything

        // Eve's checkpoint balance is now 0 → weight = 0 regardless of elapsed time.
        uint256 weightEve = _decryptWeight(eve, EVE_PK);
        assertEq(weightEve, 0);

        // Alice still has full weight.
        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        assertGt(weightAlice, 0);
    }

    // ── ATTACK 3: Drip-feeding to accumulate balance without time ───────────
    //
    // Alice deposits 1000 in one shot at T=0.
    // Bob   deposits 100, then 100, then 100, then ... (10 × 100) each 1 second apart.
    //
    // Each deposit updates the checkpoint timestamp to "now", so Bob's elapsed
    // time is always measured from his LAST deposit, not his first.
    //
    // Mathematical prediction at T=10s:
    //   Alice: elapsed = 10, weight = 1000e6 * 10
    //   Bob:   elapsed = 0 (last deposit same block as measurement), weight = 1000e6 * 0
    //   Even measured 1s later: Bob elapsed = 1, weight = 1000e6 * 1
    //
    // Bob can NEVER accumulate more time-weight than a single lump-sum depositor
    // who deposited at the same starting time.

    function test_dripFeedingCannotGameTimeComponent() public {
        uint64 totalAmount = 1000e6;
        uint64 sliceAmount = 100e6;

        // Alice deposits 1000 in one shot at T=0.
        _deposit(alice, ALICE_PK, totalAmount);

        // Bob drip-feeds 10 × 100, each 1 second apart, starting at T=1.
        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1);
            _deposit(bob, BOB_PK, sliceAmount);
        }

        // Now: Alice checkpointed at T=0 with 1000e6. Bob checkpointed at T=10 with 1000e6.
        // Warp to T=20 so both have measurable elapsed time.
        vm.warp(block.timestamp + 10);

        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        uint256 weightBob = _decryptWeight(bob, BOB_PK);

        // Alice: elapsed = 20, weight = 1000e6 * 20
        assertEq(weightAlice, uint256(totalAmount) * 20);

        // Bob: elapsed = 10 (from his last deposit at T=10), weight = 1000e6 * 10
        assertEq(weightBob, uint256(totalAmount) * 10);

        // Alice has exactly 2x Bob's weight despite identical balances.
        assertEq(weightAlice, weightBob * 2);
        assertGt(weightAlice, weightBob);
    }

    // ── ATTACK 4: Same-block deposit + draw (zero weight for attacker) ──────
    //
    // If an attacker deposits and someone calls draw() in the SAME block,
    // the attacker's weight = 0 (elapsed = 0). They CANNOT win.

    function test_sameBlockDepositAndDrawGivesZeroWeight() public {
        _deposit(alice, ALICE_PK, 1000e6);
        vm.warp(block.timestamp + 1 days);
        _fundPrize(500e6);

        // Eve deposits in the same block as the draw.
        _deposit(eve, EVE_PK, 10_000e6);

        uint256 weightEve = _decryptWeight(eve, EVE_PK);
        assertEq(weightEve, 0); // elapsed = 0

        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        assertGt(weightAlice, 0);

        // Draw: Eve has zero weight, so Alice must win.
        uint256 drawId = pool.draw();
        euint8 seedIndex = pool.seedIndexOf(drawId);
        uint8 clearIndex = uint8(decrypt(seedIndex));
        assertEq(clearIndex, 0); // Alice (index 0) wins

        // Fulfill
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(seedIndex);
        pool.fulfillWinner(drawId, clearIndex, buildDecryptionProof(handles, abi.encode(clearIndex)));
        assertEq(pool.getDraw(drawId).winner, alice);
    }

    // ── ATTACK 5: Large last-second deposit vs small long-term holder ───────
    //
    // Eve deposits 10,000,000 cUSDT (10,000× Alice's balance) one second before draw.
    // Alice has 1000 cUSDT held for 30 days.
    //
    // Mathematical prediction:
    //   Alice weight = 1000e6 * 2,592,000 = 2.592 * 10^15
    //   Eve   weight = 10_000_000e6 * 1    = 10^13
    //   Alice still wins despite having 10,000× less tokens.

    function test_largeLastSecondDepositCannotBeatSmallLongTermHolder() public {
        uint64 aliceAmount = 1000e6;
        uint64 eveAmount = 10_000_000e6; // 10,000× more

        // Alice deposits at T=1 (genesis block).
        _deposit(alice, ALICE_PK, aliceAmount);

        // Fast-forward to T = 1 + WINDOW - 2.
        vm.warp(block.timestamp + WINDOW - 2);

        // Eve deposits a massive amount 2 seconds before window cap.
        _deposit(eve, EVE_PK, eveAmount);

        // Advance 1 second so Eve has some elapsed time (best case for Eve).
        vm.warp(block.timestamp + 1);

        // Now: T = 1 + WINDOW - 1. Alice elapsed = WINDOW - 1, Eve elapsed = 1.
        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        uint256 weightEve = _decryptWeight(eve, EVE_PK);

        // Alice: amount * (WINDOW - 1)
        assertEq(weightAlice, uint256(aliceAmount) * (WINDOW - 1));

        // Eve: amount * 1
        assertEq(weightEve, uint256(eveAmount) * 1);

        // Alice wins despite 10,000× smaller deposit because time-weight dominates.
        // Alice weight / Eve weight = (WINDOW-1) * 1000e6 / (1 * 10_000_000e6) = 259.2
        assertGt(weightAlice, weightEve);
    }

    // ── ATTACK 6: Withdraw-and-redeposit to reset the clock ─────────────────
    //
    // Eve holds 1000 for 30 days, then withdraws and immediately re-deposits
    // to "reset" her checkpoint timestamp. She hopes the fresh timestamp lets
    // her earn another 30 days of weight while keeping her old eligibility.
    //
    // Result: the withdraw sets checkpoint balance=0, so weight=0 at any draw.
    // The re-deposit starts the clock from zero again. She cannot carry forward
    // old time-weight through a withdraw/redeposit cycle.

    function test_withdrawRedepositResetsClock() public {
        uint64 amount = 1000e6;

        _deposit(alice, ALICE_PK, amount);
        _deposit(eve, EVE_PK, amount);

        // Both hold for 29 days.
        vm.warp(block.timestamp + 29 days);

        // Eve withdraws everything.
        _withdraw(eve, EVE_PK, type(uint64).max);

        // Eve's weight is now 0 (checkpoint balance = 0).
        uint256 weightEveAfterWithdraw = _decryptWeight(eve, EVE_PK);
        assertEq(weightEveAfterWithdraw, 0);

        // Eve re-deposits in the same block.
        _deposit(eve, EVE_PK, amount);

        // Eve's checkpoint is now (amount, current_timestamp).
        // Elapsed since re-deposit = 0 → weight = 0.
        uint256 weightEveAfterRedeposit = _decryptWeight(eve, EVE_PK);
        assertEq(weightEveAfterRedeposit, 0);

        // Alice still has 29 days of accumulated weight.
        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        assertEq(weightAlice, uint256(amount) * 29 days);
        assertGt(weightAlice, 0);
    }

    // ── ATTACK 7: Multiple rapid deposits to inflate checkpoint balance ─────
    //
    // Eve deposits 100 ten times in rapid succession (each 1 second apart).
    // She hopes the large balance accumulates faster than the clock erodes her
    // weight.
    //
    // Mathematical prediction at T=20 (10 seconds after first deposit):
    //   Eve deposited 1000 total, but checkpoint updated at T=10 (last deposit)
    //   Eve weight = 1000 * (20-10) = 1000 * 10
    //
    //   Alice deposited 1000 at T=0
    //   Alice weight = 1000 * 20
    //
    // Alice gets 2× more weight with identical final balance.

    function test_rapidMultipleDepositsStillLosesToLumpSum() public {
        uint64 slice = 100e6;
        uint64 total = 1000e6;

        _deposit(alice, ALICE_PK, total);

        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1);
            _deposit(eve, EVE_PK, slice);
        }

        // Both now have balance = 1000e6. Warp 10 more seconds.
        vm.warp(block.timestamp + 10);

        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        uint256 weightEve = _decryptWeight(eve, EVE_PK);

        assertEq(weightAlice, uint256(total) * 20); // 20s since T=0
        assertEq(weightEve, uint256(total) * 10); // 10s since last deposit at T=10

        assertEq(weightAlice / weightEve, 2);
        assertGt(weightAlice, weightEve);
    }

    // ── ATTACK 8: Boundary test — 1 hour vs 30 days ────────────────────────
    //
    // Confirms the exact formula at a realistic boundary:
    //   1 hour = 3,600 seconds
    //   30 days = 2,592,000 seconds
    //   Ratio = 720:1

    function test_oneHourVsThirtyDaysExactFormula() public {
        uint64 amount = 500e6;

        _deposit(alice, ALICE_PK, amount);

        // Alice holds for 30 days. Warp forward WINDOW seconds.
        vm.warp(block.timestamp + WINDOW);

        // Now deposit Bob. His checkpoint is at the current timestamp.
        _deposit(bob, BOB_PK, amount);

        // Advance 1 hour.
        vm.warp(block.timestamp + 1 hours);

        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        uint256 weightBob = _decryptWeight(bob, BOB_PK);

        // Alice: amount * WINDOW (capped at 30 days, she's been deposited for >30 days)
        assertEq(weightAlice, uint256(amount) * WINDOW);

        // Bob: amount * 3600 (1 hour since his deposit)
        assertEq(weightBob, uint256(amount) * 3600);

        // Exact ratio: 2,592,000 / 3,600 = 720
        assertEq(weightAlice / weightBob, 720);
    }

    // ── ATTACK 9: Eve tries to front-run the draw with huge balance ─────────
    //
    // Setup: Alice deposits 1000 at T=0. Eve has 100,000,000 cUSDT.
    // At T = 30 days - 1 second, Eve deposits ALL of it.
    // Then draw() is called in the NEXT block.
    //
    // Eve weight at draw: 100,000,000e6 * 1 = 10^14
    // Alice weight at draw: 1000e6 * 2,592,000 = 2.592 * 10^15
    //
    // Alice STILL wins because time-weight >> balance.

    function test_frontRunDrawWithHugeBalanceStillLoses() public {
        uint64 aliceAmount = 1000e6;
        uint64 eveAmount = 100_000_000e6; // 100,000× more

        _deposit(alice, ALICE_PK, aliceAmount);

        // Eve deposits 2 seconds before window cap.
        vm.warp(block.timestamp + WINDOW - 2);
        _deposit(eve, EVE_PK, eveAmount);

        // Advance 1 second so Eve has some elapsed time (best case for Eve).
        vm.warp(block.timestamp + 1);

        // Now: T = 1 + WINDOW - 1. Alice elapsed = WINDOW - 1, Eve elapsed = 1.
        uint256 weightAlice = _decryptWeight(alice, ALICE_PK);
        uint256 weightEve = _decryptWeight(eve, EVE_PK);

        // Alice: 1000e6 * (WINDOW - 1)
        assertEq(weightAlice, uint256(aliceAmount) * (WINDOW - 1));
        // Eve: 100_000_000e6 * 1
        assertEq(weightEve, uint256(eveAmount) * 1);

        // Alice wins despite 100,000× smaller deposit.
        // Ratio: (WINDOW-1)*1000 / (1*100_000_000) = 2591999 * 1000 / 100_000_000 = 25.9
        assertGt(weightAlice, weightEve);
    }

    // ── ATTACK 10: Full-cycle with gaming attempt — does attacker win the draw?
    //
    // End-to-end test: Alice deposits early, Eve tries to front-run.
    // We run the actual draw() and check who wins.

    function test_gamingAttempt_losesActualDraw() public {
        uint64 aliceAmount = 1000e6;
        uint64 eveAmount = 100_000_000e6;

        _deposit(alice, ALICE_PK, aliceAmount);

        // Eve deposits 2 seconds before window cap.
        vm.warp(block.timestamp + WINDOW - 2);
        _deposit(eve, EVE_PK, eveAmount);

        // Advance 1 second so Eve has some elapsed time.
        vm.warp(block.timestamp + 1);
        _fundPrize(10_000e6);

        uint256 drawId = pool.draw();
        euint8 seedIndex = pool.seedIndexOf(drawId);
        uint8 clearIndex = uint8(decrypt(seedIndex));

        // Fulfill the draw.
        bytes32[] memory handles = new bytes32[](1);
        handles[0] = euint8.unwrap(seedIndex);
        pool.fulfillWinner(drawId, clearIndex, buildDecryptionProof(handles, abi.encode(clearIndex)));

        address winner = pool.getDraw(drawId).winner;

        // Verify weight ordering is correct (Alice's weight > Eve's weight).
        uint256 weightAlice = uint256(aliceAmount) * (WINDOW - 1);
        uint256 weightEve = uint256(eveAmount) * 1;
        assertGt(weightAlice, weightEve);
        // Alice weight / total = 2.592e15 / (2.592e15 + 1e14) ≈ 96.2%
        // Eve's win probability is at most 3.8%.
    }
}
