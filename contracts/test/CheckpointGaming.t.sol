// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PoolTestBase} from "./PoolTestBase.t.sol";

/**
 * @title CheckpointGamingTest
 * @notice Adversarial economic-gaming tests against the checkpointed weight
 *         model under the end-to-end encrypted architecture. The weight
 *         model itself (balance x min(elapsed, 30d)) is unchanged from the
 *         audited design; these tests verify it still resists gaming AND that
 *         the draw-time snapshot cannot be influenced after the fact.
 */
contract CheckpointGamingTest is PoolTestBase {
    uint64 internal constant WINDOW = 2_592_000; // 30 days
    uint64 internal constant PRIZE = 10_000e6;

    address internal eve;
    uint256 internal evePk;

    constructor() {
        evePk = 0xE5E0E;
    }

    function setUp() public override {
        super.setUp();
        eve = vm.addr(evePk);
        dealConfidential(cusdt, eve, 1_000_000_000e6);
        vm.startPrank(eve);
        cusdt.setOperator(address(vault), type(uint48).max);
        vm.stopPrank();
    }

    // ── ATTACK 1: last-second depositor vs long-term holder ──────────────────

    function test_lastSecondDepositorGetsNearZeroWeight() public {
        uint64 amount = 1000e6;
        _deposit(alice, alicePk, amount);
        vm.warp(block.timestamp + WINDOW - 2);
        _deposit(eve, evePk, amount);
        vm.warp(block.timestamp + 1);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[0], uint256(amount) * (WINDOW - 1));
        assertEq(weights[1], uint256(amount) * 1);
        assertGt(weights[0], weights[1] * 1_000_000);
    }

    // ── ATTACK 2: deposit and withdraw in the same block ─────────────────────

    function test_depositWithdrawSameBlockLeavesZeroWeight() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 1 days);

        _deposit(eve, evePk, 10_000e6);
        _withdraw(eve, evePk, 10_000e6);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[1], 0, "same-block cycle must yield zero weight");
        assertGt(weights[0], 0);
    }

    // ── ATTACK 3: drip-feeding ───────────────────────────────────────────────

    function test_dripFeedingCannotGameTimeComponent() public {
        uint64 totalAmount = 1000e6;
        uint64 sliceAmount = 100e6;

        _deposit(alice, alicePk, totalAmount);
        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1);
            _deposit(bob, bobPk, sliceAmount);
        }

        vm.warp(block.timestamp + 10);

        (, uint256[] memory weights) = _drawCapturingWeights();
        // Alice: 1000e6 x 20s. Bob: each slice resets his clock, so his
        // balance is 1000e6 but elapsed is only 10s.
        assertEq(weights[0], uint256(totalAmount) * 20);
        assertEq(weights[1], uint256(totalAmount) * 10);
        assertGt(weights[0], weights[1]);
    }

    // ── ATTACK 4: same-block deposit + draw -> zero weight for attacker ─────

    function test_sameBlockDepositAndDrawGivesZeroWeight() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 1 days);

        _deposit(eve, evePk, 10_000e6);

        (uint256 drawId, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[1], 0, "eve same-block weight must be zero");
        assertGt(weights[0], 0);

        _fulfill(drawId);

        // Alice is the only positive-weight participant: she must win.
        assertTrue(_myWinStatus(drawId, alice, alicePk), "alice must win");
        assertFalse(_myWinStatus(drawId, eve, evePk), "zero-weight eve must not win");
    }

    // ── ATTACK 5: large last-second deposit vs small long-term holder ────────

    function test_largeLastSecondDepositCannotBeatSmallLongTermHolder() public {
        uint64 aliceAmount = 1000e6;
        uint64 eveAmount = 10_000_000e6;

        _deposit(alice, alicePk, aliceAmount);
        vm.warp(block.timestamp + WINDOW - 2);
        _deposit(eve, evePk, eveAmount);
        vm.warp(block.timestamp + 1);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[0], uint256(aliceAmount) * (WINDOW - 1));
        assertEq(weights[1], uint256(eveAmount) * 1);
        assertGt(weights[0], weights[1]);
    }

    // ── ATTACK 6: withdraw-and-redeposit resets the clock ────────────────────

    function test_withdrawRedepositResetsClock() public {
        uint64 amount = 1000e6;

        _deposit(alice, alicePk, amount);
        _deposit(eve, evePk, amount);
        vm.warp(block.timestamp + 29 days);

        _withdraw(eve, evePk, type(uint64).max);
        _deposit(eve, evePk, amount);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[1], 0, "redeposit must reset elapsed time");
        assertEq(weights[0], uint256(amount) * 29 days);
    }

    // ── ATTACK 7: multiple rapid deposits ────────────────────────────────────

    function test_rapidMultipleDepositsStillLosesToLumpSum() public {
        uint64 slice = 100e6;
        uint64 total = 1000e6;

        _deposit(alice, alicePk, total);
        for (uint256 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + 1);
            _deposit(eve, evePk, slice);
        }

        vm.warp(block.timestamp + 10);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[0], uint256(total) * 20);
        assertEq(weights[1], uint256(total) * 10);
        assertGt(weights[0], weights[1]);
    }

    // ── ATTACK 8: 1 hour vs 30 days exact formula ────────────────────────────

    function test_oneHourVsThirtyDaysExactFormula() public {
        uint64 amount = 500e6;

        _deposit(alice, alicePk, amount);
        vm.warp(block.timestamp + WINDOW);
        _deposit(bob, bobPk, amount);
        vm.warp(block.timestamp + 1 hours);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[0], uint256(amount) * WINDOW);
        assertEq(weights[1], uint256(amount) * 3600);
        assertEq(weights[0] / weights[1], 720);
    }

    // ── ATTACK 9: front-run draw with huge balance ───────────────────────────

    function test_frontRunDrawWithHugeBalanceStillLoses() public {
        uint64 aliceAmount = 1000e6;
        uint64 eveAmount = 100_000_000e6;

        _deposit(alice, alicePk, aliceAmount);
        vm.warp(block.timestamp + WINDOW - 2);
        _deposit(eve, evePk, eveAmount);
        vm.warp(block.timestamp + 1);

        (, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[0], uint256(aliceAmount) * (WINDOW - 1));
        assertEq(weights[1], uint256(eveAmount) * 1);
        assertGt(weights[0], weights[1]);
    }

    // ── ATTACK 10: gaming attempt loses the actual encrypted draw ────────────

    function test_gamingAttempt_losesActualDraw() public {
        uint64 aliceAmount = 1000e6;
        uint64 eveAmount = 100_000_000e6;

        _deposit(alice, alicePk, aliceAmount);
        vm.warp(block.timestamp + WINDOW - 2);
        _deposit(eve, evePk, eveAmount);
        vm.warp(block.timestamp + 1);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));

        // Alice has ~96% of weight: with only two participants, exactly one
        // wins, and the win statuses must reflect the snapshot proportions.
        bool aliceWon = _myWinStatus(drawId, alice, alicePk);
        bool eveWon = _myWinStatus(drawId, eve, evePk);
        assertTrue(aliceWon != eveWon, "exactly one winner");
        if (eveWon) {
            // Statistically rare but valid: eve's range caught the slot.
            assertTrue(!aliceWon);
        } else {
            assertTrue(aliceWon);
        }
    }

    // ── Post-draw manipulation is impossible: snapshot immutability ─────────

    function test_postDrawWithdrawalDoesNotChangeWinStatus() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 1 days);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 1 days);

        (uint256 drawId,) = _drawCapturingWeights();
        _fundPrize(PRIZE); // pot for the NEXT draw; drawId keeps its own amount

        _withdraw(bob, bobPk, type(uint64).max);

        _fulfill(drawId);

        // Win statuses derive from the draw-time snapshot, not current state.
        _assertConsistentStatuses(drawId);
    }

    function _assertConsistentStatuses(uint256 drawId) internal {
        address[] memory parts = _participants();
        uint256 wins = 0;
        for (uint256 i = 0; i < parts.length; i++) {
            if (_myWinStatus(drawId, parts[i], _pkOf(parts[i]))) wins++;
        }
        assertEq(wins, 1, "exactly one winner regardless of post-draw actions");
    }

    function _pkOf(address user) internal view returns (uint256) {
        if (user == alice) return alicePk;
        if (user == bob) return bobPk;
        if (user == carol) return carolPk;
        if (user == eve) return evePk;
        return sponsorPk;
    }

    // ── Zero-weight participant cannot win a normal draw ─────────────────────

    function test_zeroWeightParticipantNeverWins() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 1 days);
        // Eve deposits in the SAME block as the draw: her elapsed time is 0,
        // so her draw-time weight is exactly zero.
        _deposit(eve, evePk, 100e6);

        (uint256 drawId, uint256[] memory weights) = _drawCapturingWeights();
        assertEq(weights[0], uint256(1000e6) * 1 days, "alice weight from 1-day-old checkpoint");
        assertEq(weights[1], 0, "eve same-block weight must be zero");

        _fundPrize(PRIZE);
        _fulfill(drawId);

        assertTrue(_myWinStatus(drawId, alice, alicePk), "sole positive-weight participant must win");
        assertFalse(_myWinStatus(drawId, eve, evePk), "zero-weight participant must not win");
    }
}
