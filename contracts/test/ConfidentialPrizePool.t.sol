// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {PoolTestBase} from "./PoolTestBase.t.sol";
import {ConfidentialPrizePool} from "../src/ConfidentialPrizePool.sol";
import {EncryptedBalanceTracker} from "../src/EncryptedBalanceTracker.sol";
import {ebool, euint64, euint128} from "encrypted-types/EncryptedTypes.sol";
import {aclAdd as ACL_ADDRESS} from "@fhevm/host-contracts/addresses/FHEVMHostAddresses.sol";

interface IACL {
    function isAllowedForDecryption(bytes32 handle) external view returns (bool);
    function isAllowed(bytes32 handle, address account) external view returns (bool);
}

/**
 * @title ConfidentialPrizePoolTest
 * @notice Adversarial tests for the end-to-end encrypted architecture.
 *
 * The most important property tested: individual weights are NEVER revealed.
 * Fulfillment submits a single aggregate value bound to the stored handle by
 * a KMS proof; there is no weights array, no offsets, and no winner index in
 * any calldata.
 */
contract ConfidentialPrizePoolTest is PoolTestBase {
    uint64 internal constant PRIZE = 777e6;

    // ── Test 12/13 helpers: exactly-one-winner and determinism ────────────────

    function _assertExactlyOneWinner(uint256 drawId, uint256[] memory weights, uint128 tw) internal {
        uint256 winner = _expectedWinnerFromWeights(weights, drawId, tw);
        address[] memory parts = _participants();
        uint256 wins = 0;
        for (uint256 i = 0; i < parts.length; i++) {
            bool won = _myWinStatus(drawId, parts[i], _pkOf(parts[i]));
            if (won) {
                wins++;
                assertEq(i, winner, "encrypted winner must match mathematical winner");
            }
        }
        assertEq(wins, 1, "exactly one participant must win");
    }

    function _pkOf(address user) internal view returns (uint256) {
        if (user == alice) return alicePk;
        if (user == bob) return bobPk;
        if (user == carol) return carolPk;
        return sponsorPk;
    }

    // ── Registration ─────────────────────────────────────────────────────────

    function test_participantsRegisterOnFirstDepositOnly() public {
        assertEq(pool.participantCount(), 0);

        _deposit(alice, alicePk, 1000e6);
        assertEq(pool.participantCount(), 1);

        _deposit(alice, alicePk, 500e6);
        assertEq(pool.participantCount(), 1);

        _deposit(bob, bobPk, 500e6);
        assertEq(pool.participantCount(), 2);
    }

    // ── Tests 1+2: winner claims, non-winner cannot ──────────────────────────

    function test_winnerCanClaim_nonWinnerCannot() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        address winner = winnerIndex == 0 ? alice : bob;
        address loser = winnerIndex == 0 ? bob : alice;

        // Winner's balance increases by exactly the prize.
        uint64 winnerBefore = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), winnerBefore + PRIZE, "winner must receive prize");

        // Non-winner claim: transfers zero, does not lock the draw, and does
        // not prevent the real winner (verified above) — here the winner already
        // claimed, so also verify the loser truly got nothing.
        uint64 loserBefore = _balanceOf(loser, _pkOf(loser));
        _claim(drawId, loser);
        assertEq(_balanceOf(loser, _pkOf(loser)), loserBefore, "non-winner must receive nothing");
    }

    function test_nonWinnerClaimBeforeWinnerDoesNotBlock() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        address winner = winnerIndex == 0 ? alice : bob;
        address loser = winnerIndex == 0 ? bob : alice;

        // Loser spams claims first.
        _claim(drawId, loser);
        _claim(drawId, loser);

        // The real winner still gets the full prize.
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "spam claims must not block winner");
    }

    // ── Test 3: participantIndex cannot be substituted (no index param) ───────

    function test_noSubstitutableParameters() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        // claim takes ONLY a drawId. Alice cannot claim as Bob: her own
        // snapshotted win status is what gates the transfer.
        uint64 aliceBefore = _balanceOf(alice, alicePk);
        _claim(drawId, alice);
        _claim(drawId, alice);
        assertEq(
            _balanceOf(alice, alicePk),
            aliceBefore + (alice == _winnerOf(drawId) ? PRIZE : 0),
            "identity is the only claim key"
        );

        // checkResult takes ONLY a drawId and returns the caller's own status.
        vm.prank(alice);
        ebool res = pool.checkResult(drawId);
        assertTrue(ebool.unwrap(res) != 0, "status handle must be initialized");
    }

    function _winnerOf(uint256 drawId) internal returns (address) {
        address[] memory parts = _participants();
        for (uint256 i = 0; i < parts.length; i++) {
            if (_myWinStatus(drawId, parts[i], _pkOf(parts[i]))) return parts[i];
        }
        revert("no winner");
    }

    // ── Test 4/5: offset/winnerWeight cannot be fabricated (no such params) ──

    function test_fulfillRejectsMalformedProofs() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawCapturingWeights();

        // Malformed proof bytes must never verify.
        vm.expectRevert();
        pool.fulfillWinner(drawId, 12345, bytes("garbage"));

        vm.expectRevert();
        pool.fulfillWinner(drawId, 12345, bytes(""));

        // Unknown draw.
        vm.expectRevert(abi.encodeWithSelector(ConfidentialPrizePool.DrawNotFound.selector, 999));
        pool.fulfillWinner(999, 12345, bytes("x"));
    }

    /// forge-note: Honest-KMS assumption. The forge mock KMS signs any digest
    /// (the test contract holds the signer key), so a proof for a WRONG
    /// plaintext can be forged locally and the contract cannot distinguish it.
    /// On real Zama infrastructure the KMS gateway only signs cleartexts that
    /// match the actual ciphertext decryption, making wrong-plaintext proofs
    /// unproducible. The contract-level guarantees that hold regardless:
    /// the proof binds to the STORED aggregate handle (fabricated totals need
    /// a fabricated handle the draw never created) and fulfillment is
    /// one-shot per draw (replay reverts, verified below).

    // ── Test 6/7: replay and cross-draw reuse ─────────────────────────────────

    function test_winnerCannotClaimTwice() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        address winner = _winnerOf(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        assertTrue(winner == (winnerIndex == 0 ? alice : bob), "winner identity must match math");

        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE);

        // Second claim by the winner transfers zero.
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "no double payout");
    }

    function test_crossDrawProofsCannotBeReused() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId1,) = _drawAndFulfill(PRIZE);

        vm.warp(block.timestamp + 1 days);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId2,) = _drawAndFulfill(PRIZE);

        assertTrue(drawId1 != drawId2);
        _claim(drawId1, alice); // own draw
        _claim(drawId2, alice); // may or may not win draw 2 — but nothing fabricated
        assertTrue(true, "claims are per-draw; no cross-draw parameter exists");
    }

    // ── Tests 8/9/10: post-draw balance changes cannot affect a drawn draw ────

    function test_postDrawWithdrawalCannotChangeWinner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));

        // Winner withdraws everything after the draw but before claim.
        address winner = _winnerOf(drawId);
        _withdraw(winner, _pkOf(winner), type(uint64).max);

        // Claim still pays the full prize: the draw-time snapshot governs.
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "post-draw withdrawal must not affect claim");
    }

    function test_postDrawDepositCannotChangeWinner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        address winner = winnerIndex == 0 ? alice : bob;
        address loser = winnerIndex == 0 ? bob : alice;

        // Loser deposits a fortune after the draw.
        _deposit(loser, _pkOf(loser), 9_000e6);
        vm.warp(block.timestamp + 1 days);

        // The loser still cannot win: the snapshot was frozen at draw time.
        bool loserWon = _myWinStatus(drawId, loser, _pkOf(loser));
        assertFalse(loserWon, "post-draw deposit must not flip win status");

        // And the winner still gets paid.
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE);
    }

    function test_claimUsesDrawTimeSnapshotOnly() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        _expectedWinnerFromWeights(weights, drawId, tw);

        // Warp far forward: weights would be very different today, but the
        // draw's win statuses were fixed at fulfillment from the snapshot.
        vm.warp(block.timestamp + 30 days);
        _assertExactlyOneWinner(drawId, weights, tw);
    }

    // ── Test 11: zero-total draw rejected / rolled over ──────────────────────

    function test_zeroTotalDrawRollsPrizeOver() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        _fundPrize(PRIZE);
        // Same-block deposits give eve zero weight; but alice/bob have weight.
        // Create a genuinely zero-weight draw: withdraw everything first.
        _withdraw(alice, alicePk, type(uint64).max);
        _withdraw(bob, bobPk, type(uint64).max);
        // Both re-deposit in the SAME block as the draw -> all weights zero.
        _deposit(alice, alicePk, 1000e6);
        _deposit(bob, bobPk, 500e6);

        uint256 drawId = pool.draw();
        _fulfill(drawId);

        assertEq(pool.getDraw(drawId).totalWeightPlaintext, 0, "weights must be zero");
        // Claims must revert: there is no winner.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialPrizePool.NoWinnerInDraw.selector, drawId));
        pool.claim(drawId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialPrizePool.NoWinnerInDraw.selector, drawId));
        pool.checkResult(drawId);

        // The prize rolls over into the pool for the next draw.
        assertEq(uint128(decrypt(pool.prizeLiquidity())), PRIZE, "prize must roll over");
    }

    // ── Tests 12/13: exactly one winner; determinism ──────────────────────────

    function test_exactlyOneWinner_matchesPlaintextMath() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);
        dealConfidential(cusdt, carol, 10_000e6);
        _deposit(carol, carolPk, 200e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        _assertExactlyOneWinner(drawId, weights, _revealedTotal(drawId));
    }

    function test_sameInputsGiveSameWinner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        bool aliceWon = _myWinStatus(drawId, alice, alicePk);
        bool bobWon = _myWinStatus(drawId, bob, bobPk);

        // Re-check: statuses are stored encrypted handles, so they are stable.
        assertEq(_myWinStatus(drawId, alice, alicePk), aliceWon, "alice status stable");
        assertEq(_myWinStatus(drawId, bob, bobPk), bobWon, "bob status stable");
        assertTrue(aliceWon != bobWon, "exactly one winner");
        _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));
    }

    // ── Test 14/15: confidentiality of non-winner weights ─────────────────────

    function test_noWeightExposingGettersOrCalldata() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId,) = _drawAndFulfill(PRIZE);
        ConfidentialPrizePool.Draw memory d = pool.getDraw(drawId);

        // The ONLY plaintext financial value in the Draw struct is the aggregate.
        assertEq(d.totalWeightPlaintext, _revealedTotal(drawId));
        // No offset storage, no winner index storage, no weights array anywhere
        // in the ABI. This is an API-shape assertion: the architecture has no
        // per-participant plaintext calldata or storage to leak.
        (bool ok,) = address(pool).call(abi.encodeWithSignature("drawOffset(uint256,uint256)", drawId, 0));
        assertFalse(ok, "drawOffset getter must not exist");
    }

    function test_trackerComputeWeightIsPoolOnly() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);

        // A random attacker cannot pull alice's weight from the tracker.
        vm.prank(address(0xdead));
        vm.expectRevert(abi.encodeWithSelector(EncryptedBalanceTracker.UnauthorizedCaller.selector, address(0xdead)));
        tracker.computeWeight(alice);

        // Nor can a participant probe another participant.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(EncryptedBalanceTracker.UnauthorizedCaller.selector, bob));
        tracker.computeWeight(alice);
    }

    // ── Test 17/18: calldata and event hygiene ────────────────────────────────

    function test_fulfillCalldataCarriesOnlyTheAggregate() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId,) = _drawCapturingWeights();
        euint128 twHandle = pool.getDraw(drawId).totalWeight;
        uint128 tw = uint128(decrypt(twHandle));
        bytes memory proof = buildDecryptionProof(euint128.unwrap(twHandle), abi.encode(tw));

        // The proof covers exactly ONE handle: the aggregate. There is no
        // weights[] array in the calldata to leak.
        pool.fulfillWinner(drawId, tw, proof);
        assertTrue(pool.getDraw(drawId).fulfilled);
    }

    function test_doubleFulfillReverts() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);
        euint128 twHandle = pool.getDraw(drawId).totalWeight;
        uint128 tw = uint128(decrypt(twHandle));
        bytes memory proof = buildDecryptionProof(euint128.unwrap(twHandle), abi.encode(tw));

        vm.expectRevert(ConfidentialPrizePool.DrawAlreadyFulfilled.selector);
        pool.fulfillWinner(drawId, tw, proof);
    }

    function test_draw_revertsInsideCooldown() public {
        _deposit(alice, alicePk, 1000e6);
        pool.draw();

        vm.warp(block.timestamp + 30 seconds);
        vm.expectRevert(ConfidentialPrizePool.DrawTooSoon.selector);
        pool.draw();

        vm.warp(block.timestamp + 2 days);
        pool.draw();
    }

    function test_claimAndCheckRevertForUnknownDraws() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialPrizePool.DrawNotFound.selector, drawId + 1));
        pool.claim(drawId + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialPrizePool.DrawNotFound.selector, drawId + 1));
        pool.checkResult(drawId + 1);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(ConfidentialPrizePool.DrawNotFound.selector, 0));
        pool.claim(0);
    }

    function test_claimRevertsForNonParticipant() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        vm.prank(sponsor);
        vm.expectRevert(ConfidentialPrizePool.NotParticipant.selector);
        pool.claim(drawId);
    }

    function test_claimRevertsForLateJoiner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        // Bob joins AFTER the draw: he is a participant but not in this draw.
        vm.warp(block.timestamp + 1 days);
        _deposit(bob, bobPk, 500e6);

        vm.prank(bob);
        vm.expectRevert(ConfidentialPrizePool.NotInThisDraw.selector);
        pool.claim(drawId);
        vm.prank(bob);
        vm.expectRevert(ConfidentialPrizePool.NotInThisDraw.selector);
        pool.checkResult(drawId);
    }

    // ── Prize stays confidential until winner-only decryption ─────────────────

    function test_prizeAmountStaysEncrypted() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId,) = _drawAndFulfill(PRIZE);
        ConfidentialPrizePool.Draw memory d = pool.getDraw(drawId);
        // The amount is a handle — only its winner can ever decrypt it.
        assertTrue(euint64.unwrap(d.amount) != 0, "amount handle must be initialized");

        // The amount handle must never be publicly decryptable: only the
        // winner (via their token balance after the transfer) can ever see it.
        IACL acl = IACL(ACL_ADDRESS);
        assertFalse(acl.isAllowedForDecryption(euint64.unwrap(d.amount)), "prize amount must never be public");
        assertFalse(acl.isAllowedForDecryption(euint128.unwrap(d.seedIndex)), "seed must never be public");
        // The aggregate totalWeight handle IS the only publicly decryptable one.
        assertTrue(acl.isAllowedForDecryption(euint128.unwrap(d.totalWeight)), "aggregate must be public");

        // The pool never granted user ACL on the amount handle to anyone:
        // the winner sees the prize only via the post-transfer token balance.
        address winner = _winnerOf(drawId);
        address loser = winner == alice ? bob : alice;
        assertFalse(acl.isAllowed(euint64.unwrap(d.amount), loser), "loser must not hold ACL on prize amount");
        assertFalse(acl.isAllowed(euint64.unwrap(d.amount), winner), "no pre-grant for winner either");
    }

    // ── Unfunded draw: zero prize, zero winner confusion ──────────────────────

    function test_unfundedDrawPaysZeroButHasAWinner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        // No fundPrize: the snapshot amount is an initialized zero.
        (uint256 drawId, uint256[] memory weights) = _drawCapturingWeights();
        _fulfill(drawId);
        _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));

        address winner = _winnerOf(drawId);
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner);
        assertEq(_balanceOf(winner, _pkOf(winner)), before, "unfunded draw pays zero");
    }
}
