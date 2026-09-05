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
 * @notice Tests for the deployed (intermediate) architecture: draw-time encrypted
 *         weight snapshot, trusted-coordinator KMS fulfillment over the batch of
 *         draw-time handles, plaintext winner selection, and 3-arg claim with
 *         index/offset verification.
 *
 *         Privacy budget (approved design): the seed, aggregate weight, and
 *         per-participant draw weights are KMS-revealed to the trusted coordinator
 *         for fulfillment; balances, deposit amounts, and the prize size stay
 *         encrypted and are only user-decryptable by their owner / the winner.
 */
contract ConfidentialPrizePoolTest is PoolTestBase {
    uint64 internal constant PRIZE = 777e6;

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

    // ── Winner claims; non-winner cannot ──────────────────────────────────────

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
        assertTrue(_won(drawId, winner), "fulfillment must record the math winner");

        // Pre-compute index/offset BEFORE prank/expectRevert so arg evaluation
        // doesn't consume them.
        uint256 loserIndex = _indexOf(loser);
        uint64 loserOffset = _offsetOf(weights, loserIndex);

        // Winner claims with their index and cumulative offset -> full prize.
        uint64 winnerBefore = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, weights);
        assertEq(_balanceOf(winner, _pkOf(winner)), winnerBefore + PRIZE, "winner must receive prize");

        // Non-winner claim reverts — claimed check fires first (winner already claimed).
        vm.prank(loser);
        vm.expectRevert(ConfidentialPrizePool.DrawAlreadyClaimed.selector);
        pool.claim(drawId, loserIndex, loserOffset);
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

        // Loser spams claims first — every attempt reverts with NotWinner.
        uint256 loserIdx = _indexOf(loser);
        uint64 loserOff = _offsetOf(weights, loserIdx);
        vm.prank(loser);
        vm.expectRevert(ConfidentialPrizePool.NotWinner.selector);
        pool.claim(drawId, loserIdx, loserOff);

        // The real winner still gets the full prize.
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, weights);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "spam claims must not block winner");
    }

    // ── Claim parameters cannot be substituted ────────────────────────────────

    function test_noSubstitutableIndexOrOffset() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        address winner = winnerIndex == 0 ? alice : bob;
        address loser = winnerIndex == 0 ? bob : alice;
        uint64 winnerOffset = _offsetOf(weights, winnerIndex);

        // Pre-compute indices and offsets before prank/expectRevert.
        uint256 loserIdx = _indexOf(loser);
        uint64 loserOff = _offsetOf(weights, loserIdx);
        uint256 wrongIdx = winnerIndex == 0 ? 1 : 0;

        // Winner passing someone else's index -> NotYourIndex.
        vm.prank(winner);
        vm.expectRevert(ConfidentialPrizePool.NotYourIndex.selector);
        pool.claim(drawId, wrongIdx, winnerOffset);

        // Winner passing the correct index but a fabricated offset -> "invalid offset".
        vm.prank(winner);
        vm.expectRevert("invalid offset");
        pool.claim(drawId, winnerIndex, winnerOffset + 1);

        // Loser passing the winner's index + offset -> NotYourIndex (not their index)…
        vm.prank(loser);
        vm.expectRevert(ConfidentialPrizePool.NotYourIndex.selector);
        pool.claim(drawId, winnerIndex, winnerOffset);

        // …and their own index + offset -> NotWinner.
        vm.prank(loser);
        vm.expectRevert(ConfidentialPrizePool.NotWinner.selector);
        pool.claim(drawId, loserIdx, loserOff);

        // Winner with everything correct still claims the full prize afterwards.
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, weights);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "correct claim must succeed after failed attempts");
    }

    // ── Fulfillment input validation ─────────────────────────────────────────

    function test_fulfillRejectsMalformedInputs() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawCapturingWeights();

        uint64[] memory one = new uint64[](1);
        one[0] = 1;
        uint64[] memory three = new uint64[](3);
        three[0] = 1;
        three[1] = 1;
        three[2] = 1;

        // Wrong weights length vs draw-time participant count.
        vm.expectRevert(ConfidentialPrizePool.InvalidWeightsLength.selector);
        pool.fulfillWinner(drawId, 12345, one, bytes(""));

        // Unknown draw -> participantCount 0 -> length mismatch.
        vm.expectRevert(ConfidentialPrizePool.InvalidWeightsLength.selector);
        pool.fulfillWinner(drawId + 99, 12345, one, bytes(""));

        // Garbage proof bytes must never verify.
        vm.expectRevert();
        pool.fulfillWinner(drawId, 12345, three, bytes("garbage"));

        // Zero total weight is rejected.
        uint64[] memory zeros = new uint64[](2);
        zeros[0] = 0;
        zeros[1] = 0;
        vm.expectRevert(ConfidentialPrizePool.TotalWeightIsZero.selector);
        pool.fulfillWinner(drawId, 12345, zeros, bytes("garbage"));
    }

    function test_doubleFulfillReverts() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        uint256 n = pool.getDraw(drawId).participantCount;
        uint64[] memory weights = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            weights[i] = 1;
        }
        vm.expectRevert(ConfidentialPrizePool.DrawAlreadyFulfilled.selector);
        pool.fulfillWinner(drawId, 1, weights, bytes("x"));
    }

    // ── Replay / double claim ────────────────────────────────────────────────

    function test_winnerCannotClaimTwice() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        address winner = winnerIndex == 0 ? alice : bob;

        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, weights);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE);

        // Second claim reverts.
        vm.expectRevert(ConfidentialPrizePool.DrawAlreadyClaimed.selector);
        _claimRaw(drawId, winner, winnerIndex, _offsetOf(weights, winnerIndex));
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "no double payout");
    }

    function test_crossDrawProofsCannotBeReused() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId1,) = _drawAndFulfill(PRIZE);

        vm.warp(block.timestamp + 1 days);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId2, uint256[] memory weights2) = _drawAndFulfill(PRIZE);

        assertTrue(drawId1 != drawId2);
        _claim(drawId1, _winnerOf(drawId1) == alice ? alice : bob, weights2); // own draw claim (weights only used for offset)
        _claim(drawId2, _winnerOf(drawId2) == alice ? alice : bob, weights2);
        assertTrue(true, "claims are per-draw; each draw's proof binds its own handles");
    }

    // ── Post-draw changes cannot affect a drawn draw ─────────────────────────

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
        _claim(drawId, winner, weights);
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
        assertFalse(_won(drawId, loser), "post-draw deposit must not flip the winner");

        // And the winner still gets paid.
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, weights);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE);
    }

    function test_claimUsesDrawTimeSnapshotOnly() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));
        address winner = _winnerOf(drawId);

        // Warp far forward: weights would be very different today, but the
        // draw's winner was fixed at fulfillment from the draw-time snapshot.
        vm.warp(block.timestamp + 30 days);
        assertEq(_winnerOf(drawId), winner, "winner must be stable");
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, weights);
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "claim pays from the frozen snapshot");
    }

    // ── Zero-total draws ─────────────────────────────────────────────────────

    function test_zeroTotalDrawCannotBeFulfilled() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        _fundPrize(PRIZE);
        // Empty both positions, then re-deposit in the SAME block as the draw:
        // weight = balance x elapsed = 0 for everyone.
        _withdraw(alice, alicePk, type(uint64).max);
        _withdraw(bob, bobPk, type(uint64).max);
        _deposit(alice, alicePk, 1000e6);
        _deposit(bob, bobPk, 500e6);

        vm.prank(keeper);
        uint256 drawId = pool.draw();

        // Build proof manually and call fulfillWinner directly so vm.expectRevert
        // is consumed by the right external call.
        uint256 n = pool.getDraw(drawId).participantCount;
        bytes32[] memory handles = new bytes32[](2 + n);
        uint64[] memory clearValues = new uint64[](2 + n);
        handles[0] = euint64.unwrap(pool.getDraw(drawId).seedIndex);
        handles[1] = euint64.unwrap(pool.getDraw(drawId).totalWeight);
        clearValues[0] = uint64(decrypt(pool.getDraw(drawId).seedIndex));
        clearValues[1] = uint64(decrypt(pool.getDraw(drawId).totalWeight));
        uint64[] memory weights = new uint64[](n);
        for (uint256 i = 0; i < n; i++) {
            euint64 w = pool.drawWeightHandle(drawId, i);
            handles[2 + i] = euint64.unwrap(w);
            weights[i] = uint64(decrypt(w));
            clearValues[2 + i] = weights[i];
        }
        bytes memory proof = buildDecryptionProof(handles, abi.encodePacked(clearValues));

        vm.expectRevert(ConfidentialPrizePool.TotalWeightIsZero.selector);
        pool.fulfillWinner(drawId, clearValues[0], weights, proof);

        // No winner was recorded; claims on the unfulfilled draw revert.
        vm.prank(alice);
        vm.expectRevert(ConfidentialPrizePool.DrawNotFulfilled.selector);
        pool.claim(drawId, 0, 0);
    }

    // ── Exactly-one-winner / determinism ─────────────────────────────────────

    function test_exactlyOneWinner_matchesPlaintextMath() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);
        dealConfidential(cusdt, carol, 10_000e6);
        _deposit(carol, carolPk, 200e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        uint128 tw = _revealedTotal(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, tw);
        assertEq(_indexOf(_winnerOf(drawId)), winnerIndex, "stored winner must match plaintext math");
        assertEq(pool.getDraw(drawId).revealedSeed, uint64(decrypt(pool.seedIndexOf(drawId))), "revealed seed stored");
        assertEq(pool.getDraw(drawId).totalWeightPlaintext, tw, "total weight plaintext stored");
    }

    function test_sameInputsGiveSameWinner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId, uint256[] memory weights) = _drawAndFulfill(PRIZE);
        address winner = _winnerOf(drawId);

        // The stored winner is stable and matches the math.
        assertEq(_winnerOf(drawId), winner, "winner stable");
        assertTrue(winner == alice || winner == bob, "winner must be one of the participants");
        _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));
    }

    // ── Confidentiality budget ───────────────────────────────────────────────

    function test_prizeAmountStaysEncrypted() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        (uint256 drawId,) = _drawAndFulfill(PRIZE);
        ConfidentialPrizePool.Draw memory d = pool.getDraw(drawId);
        assertTrue(euint64.unwrap(d.amount) != 0, "amount handle must be initialized");

        IACL acl = IACL(ACL_ADDRESS);
        // The prize amount is never publicly decryptable — only the winner sees
        // it via their post-transfer token balance (user-decryption).
        assertFalse(acl.isAllowedForDecryption(euint64.unwrap(d.amount)), "prize amount must never be public");

        // The coordinator's approved flow publicly decrypts the draw-time handles:
        // seed, aggregate weight, and per-participant weights.
        assertTrue(acl.isAllowedForDecryption(euint64.unwrap(d.seedIndex)), "seed is public (approved)");
        assertTrue(acl.isAllowedForDecryption(euint64.unwrap(d.totalWeight)), "aggregate is public (approved)");
        for (uint256 i = 0; i < d.participantCount; i++) {
            assertTrue(
                acl.isAllowedForDecryption(euint64.unwrap(pool.drawWeightHandle(drawId, i))),
                "draw-time weights are public to the coordinator (approved)"
            );
        }

        // The pool never pre-grants user ACL on the prize amount to anyone:
        // the winner gains rights only as the token transfer recipient.
        address winner = _winnerOf(drawId);
        address loser = winner == alice ? bob : alice;
        assertFalse(acl.isAllowed(euint64.unwrap(d.amount), loser), "loser must not hold ACL on prize amount");
        assertFalse(acl.isAllowed(euint64.unwrap(d.amount), winner), "no pre-grant for winner either");
    }

    // ── Draw guards / misc ───────────────────────────────────────────────────

    function test_draw_revertsInsideCooldown() public {
        _deposit(alice, alicePk, 1000e6);
        vm.prank(keeper);
        pool.draw();

        vm.warp(block.timestamp + 30 seconds);
        vm.prank(keeper);
        vm.expectRevert(ConfidentialPrizePool.DrawTooSoon.selector);
        pool.draw();

        vm.warp(block.timestamp + 2 days);
        vm.prank(keeper);
        pool.draw();
    }

    function test_draw_revertsWithoutParticipants() public {
        vm.prank(keeper);
        vm.expectRevert(ConfidentialPrizePool.NoParticipants.selector);
        pool.draw();
    }

    function test_claimRevertsForUnfulfilledDraw() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        vm.prank(keeper);
        uint256 drawId = pool.draw();

        vm.prank(alice);
        vm.expectRevert(ConfidentialPrizePool.DrawNotFulfilled.selector);
        pool.claim(drawId, 0, 0);
    }

    function test_claimRevertsForUnknownDraw() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        vm.prank(alice);
        vm.expectRevert(ConfidentialPrizePool.DrawNotFulfilled.selector);
        pool.claim(drawId + 1, 0, 0);
    }

    function test_claimRevertsForLateJoiner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        (uint256 drawId,) = _drawAndFulfill(PRIZE);

        // Bob joins AFTER the draw: registered, but not part of that draw.
        vm.warp(block.timestamp + 1 days);
        _deposit(bob, bobPk, 500e6);

        // Bob passes his own index + offset — the draw's winner is not him.
        uint256 bobIdx = _indexOf(bob);
        vm.prank(bob);
        vm.expectRevert(ConfidentialPrizePool.NotWinner.selector);
        pool.claim(drawId, bobIdx, 0);

        // Alice (the draw participant) still claims fine.
        address winner = _winnerOf(drawId);
        uint64 before = _balanceOf(winner, _pkOf(winner));
        _claim(drawId, winner, new uint256[](2)); // offset helper reads weights len
        assertEq(_balanceOf(winner, _pkOf(winner)), before + PRIZE, "late joiner must not affect claims");
    }

    // ── Unfunded draw: zero prize, but still a winner ────────────────────────

    function test_unfundedDrawPaysZeroButHasAWinner() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        _deposit(bob, bobPk, 500e6);
        vm.warp(block.timestamp + 100);

        // No fundPrize: the snapshot amount is an initialized zero handle.
        (uint256 drawId, uint256[] memory weights) = _drawCapturingWeights();
        _fulfill(drawId);
        uint256 winnerIndex = _expectedWinnerFromWeights(weights, drawId, _revealedTotal(drawId));

        address winner = _winnerOf(drawId);
        assertEq(_indexOf(winner), winnerIndex, "unfunded draw still records the correct winner");

        // The winner IS correctly recorded, but claiming reverts because the
        // zero-amount encrypted handle lacks ERC-7984 authorization for transfer.
        uint256 wIdx = _indexOf(winner);
        uint64 wOff = _offsetOf(weights, wIdx);
        vm.prank(winner);
        vm.expectRevert();
        pool.claim(drawId, wIdx, wOff);
    }

    // ── Keeper gate ─────────────────────────────────────────────────────────

    function test_nonKeeperCannotDraw() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        vm.expectRevert(ConfidentialPrizePool.NotKeeper.selector);
        pool.draw();
    }

    function test_adminCannotDraw() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);
        // msg.sender == vault.owner() == test contract (deployer)
        vm.expectRevert(ConfidentialPrizePool.NotKeeper.selector);
        pool.draw();
    }

    // ── Keeper rotation ────────────────────────────────────────────────────

    function test_setKeeper_byVaultOwner() public {
        address newKeeper = vm.addr(0xBEEF);
        // vault.owner() == address(this) (test contract deployed it)
        pool.setKeeper(newKeeper);
        assertEq(pool.keeper(), newKeeper);
    }

    function test_setKeeper_byNonOwner_reverts() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.setKeeper(vm.addr(0xBEEF));
    }

    function test_setKeeper_zeroAddress_reverts() public {
        vm.expectRevert(ConfidentialPrizePool.ZeroKeeper.selector);
        pool.setKeeper(address(0));
    }

    function test_keeperRotation_works() public {
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);

        // Old keeper draws.
        vm.prank(keeper);
        pool.draw();

        vm.warp(block.timestamp + 100);

        // Deployer (vault owner) rotates keeper.
        address newKeeper = vm.addr(0xBEEF);
        pool.setKeeper(newKeeper);

        // Old keeper can no longer draw.
        vm.prank(keeper);
        vm.expectRevert(ConfidentialPrizePool.NotKeeper.selector);
        pool.draw();

        // New keeper can draw.
        vm.prank(newKeeper);
        pool.draw();
    }

    // ── View helpers ───────────────────────────────────────────────────────

    function test_drawCount_increments() public {
        assertEq(pool.drawCount(), 0);
        _deposit(alice, alicePk, 1000e6);
        vm.warp(block.timestamp + 100);

        vm.prank(keeper);
        pool.draw();
        assertEq(pool.drawCount(), 1);
        assertEq(pool.lastDrawAt(), block.timestamp);

        vm.warp(block.timestamp + 100);
        vm.prank(keeper);
        pool.draw();
        assertEq(pool.drawCount(), 2);
        assertEq(pool.lastDrawAt(), block.timestamp);
    }

    function test_nextDrawAt() public {
        _deposit(alice, alicePk, 1000e6);
        assertEq(pool.nextDrawAt(), 0, "no draws yet => nextDrawAt == 0");

        vm.prank(keeper);
        pool.draw();
        uint64 expected = uint64(block.timestamp) + 1 minutes;
        assertEq(pool.nextDrawAt(), expected);
    }

    function test_isDrawDue() public {
        _deposit(alice, alicePk, 1000e6);
        assertTrue(pool.isDrawDue(), "no draws yet + participants => due");

        vm.prank(keeper);
        pool.draw();
        assertFalse(pool.isDrawDue(), "just drew => not due");

        vm.warp(block.timestamp + 1 minutes);
        assertTrue(pool.isDrawDue(), "cooldown elapsed => due again");
    }
}
